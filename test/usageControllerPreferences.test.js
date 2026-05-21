import assert from 'node:assert/strict';
import test from 'node:test';

import { PreferencesService } from '../src/main/preferencesService.js';
import { QuotaError } from '../src/main/quotaService.js';
import { UsageController } from '../src/main/usageController.js';

test('controller does not arm reset scheduler when session reset notifications are disabled', async () => {
  const preferences = new PreferencesService(
    new MemoryStore({
      notifications: { sessionReset: false }
    })
  );
  const scheduler = new SchedulerSpy();
  const controller = createController({ preferences, scheduler });

  await controller.start(); // Ensure preferences are loaded
  await controller.refreshQuota();

  assert.equal(scheduler.updateCalls, 0);
  assert.equal(scheduler.clearCalls, 1);
});

test('controller clears armed scheduler when session reset notifications are toggled off', async () => {
  const preferences = new PreferencesService(new MemoryStore(null));
  const scheduler = new SchedulerSpy();
  const controller = createController({ preferences, scheduler });

  await controller.start(); // Ensure preferences are loaded
  await controller.refreshQuota();
  await preferences.set('notifications.sessionReset', false);

  assert.equal(scheduler.updateCalls, 1);
  assert.equal(scheduler.clearCalls, 1);
});

test('controller state includes preferences snapshot', async () => {
  const preferences = new PreferencesService(
    new MemoryStore({
      notifications: { sessionReset: false }
    })
  );
  const controller = createController({ preferences, scheduler: new SchedulerSpy() });

  await controller.start();

  assert.deepEqual(controller.getState().preferences, {
    language: 'en',
    notifications: { sessionReset: false, sound: false, soundVolume: 1, limitSound: false, limitSoundVolume: 1 },
    floating: { enabled: false, expanded: false, x: null, y: null },
    startup: { openAtLogin: false, showWindowOnLogin: false },
    refresh: { intervalSeconds: 30 },
    integration: { launchWithClaudeCode: false },
    claudePath: null
  });
});

test('controller starts local timer at preference interval and quota timer at 120s minimum', async () => {
  const timers = new TimerSpy();
  const preferences = new PreferencesService(new MemoryStore(null));
  const controller = createController({
    preferences,
    scheduler: new SchedulerSpy(),
    timers
  });

  await controller.start();

  assert.deepEqual(timers.intervals, [30_000, 120_000]);
});

test('controller applies longer refresh interval to local and quota timers', async () => {
  const timers = new TimerSpy();
  const preferences = new PreferencesService(
    new MemoryStore({
      refresh: { intervalSeconds: 300 }
    })
  );
  const controller = createController({
    preferences,
    scheduler: new SchedulerSpy(),
    timers
  });

  await controller.start();

  assert.deepEqual(timers.intervals, [300_000, 300_000]);
});

test('controller reschedules timers when refresh interval preference changes', async () => {
  const timers = new TimerSpy();
  const preferences = new PreferencesService(new MemoryStore(null));
  const controller = createController({
    preferences,
    scheduler: new SchedulerSpy(),
    timers
  });

  await controller.start();
  await preferences.set('refresh.intervalSeconds', 900);

  assert.deepEqual(timers.cleared, [1, 2]);
  assert.deepEqual(timers.intervals, [30_000, 120_000, 900_000, 900_000]);
  assert.equal(controller.getState().preferences.refresh.intervalSeconds, 900);
});

test('controller records session quota history from successful quota refreshes', async () => {
  const preferences = new PreferencesService(new MemoryStore(null));
  const quotaResponses = [
    {
      session: { percent: 42.4, resetsAt: new Date('2026-04-29T18:00:00Z') },
      weeklyAll: null
    },
    {
      session: { percent: 47.8, resetsAt: new Date('2026-04-29T18:00:00Z') },
      weeklyAll: null
    }
  ];
  const controller = createController({
    preferences,
    scheduler: new SchedulerSpy(),
    quotaService: {
      fetchQuota: async () => quotaResponses.shift()
    },
    now: sequentialNow([
      new Date('2026-04-29T12:00:00.000Z'),
      new Date('2026-04-29T12:05:00.000Z')
    ])
  });

  await controller.refreshQuota();
  await controller.refreshQuota();

  assert.deepEqual(controller.getState().quotaHistory.session, [
    { timestamp: '2026-04-29T12:00:00.000Z', percent: 42.4 },
    { timestamp: '2026-04-29T12:05:00.000Z', percent: 47.8 }
  ]);
});

test('controller sets needsReauth and quotaError on scope_insufficient, keeps isSignedIn true', async () => {
  const controller = createController({
    scheduler: new SchedulerSpy(),
    quotaService: {
      fetchQuota: async () => {
        throw new QuotaError('scope_insufficient', 'Re-authentication required.');
      }
    }
  });

  await controller.refreshQuota();
  const state = controller.getState();

  assert.equal(state.needsReauth, true);
  assert.equal(state.quotaError, 'error.scope_insufficient');
  assert.equal(state.isSignedIn, true);
});

test('controller clears needsReauth after successful sign-in', async () => {
  // scopeThrows controls whether the mocked quotaService throws.
  // submitCode calls refreshQuota internally — we stop throwing after
  // the first call so that the re-auth success path can complete.
  let scopeThrows = true;
  const controller = createController({
    scheduler: new SchedulerSpy(),
    quotaService: {
      fetchQuota: async () => {
        if (scopeThrows) throw new QuotaError('scope_insufficient', 'Re-authentication required.');
        return { session: null, weeklyAll: null };
      }
    }
  });
  controller.oauthService = {
    exchange: async () => ({
      accessToken: 'new-tok',
      refreshToken: 'new-ref',
      expiresAt: new Date(Date.now() + 3600_000).toISOString()
    })
  };
  controller.tokenStore = { load: async () => null, save: async () => {}, clear: async () => {} };
  controller.authFlow = { verifier: 'v', state: 's' };

  await controller.refreshQuota();
  assert.equal(controller.getState().needsReauth, true);

  scopeThrows = false;
  await controller.submitCode('code123');
  assert.equal(controller.getState().needsReauth, false);
});

test('controller clears needsReauth on sign-out', async () => {
  const controller = createController({
    scheduler: new SchedulerSpy(),
    quotaService: {
      fetchQuota: async () => {
        throw new QuotaError('scope_insufficient', 'Re-authentication required.');
      }
    }
  });

  await controller.refreshQuota();
  assert.equal(controller.getState().needsReauth, true);

  await controller.signOut();
  assert.equal(controller.getState().needsReauth, false);
});

test('controller clears needsReauth when subsequent quota refresh succeeds', async () => {
  let shouldThrow = true;
  const controller = createController({
    scheduler: new SchedulerSpy(),
    quotaService: {
      fetchQuota: async () => {
        if (shouldThrow) throw new QuotaError('scope_insufficient', 'Re-authentication required.');
        return { session: { percent: 10, resetsAt: new Date() }, weeklyAll: null };
      }
    }
  });

  await controller.refreshQuota();
  assert.equal(controller.getState().needsReauth, true);

  shouldThrow = false;
  await controller.refreshQuota();
  assert.equal(controller.getState().needsReauth, false);
  assert.equal(controller.getState().quotaError, null);
});

function createController({ preferences, scheduler, timers, quotaService, now } = {}) {
  return new UsageController({
    preferences,
    resetScheduler: scheduler,
    timers,
    now,
    tokenStore: {
      load: async () => null,
      clear: async () => {},
      save: async () => {}
    },
    quotaService: quotaService ?? {
      fetchQuota: async () => ({
        session: {
          percent: 100,
          resetsAt: new Date('2026-04-29T18:00:00Z')
        },
        weeklyAll: null
      })
    },
    localService: {
      load: async () => ({
        todayStats: {},
        monthStats: {},
        lastUpdated: new Date('2026-04-29T12:00:00Z')
      })
    },
    openExternal: async () => {}
  });
}

class SchedulerSpy {
  constructor() {
    this.updateCalls = 0;
    this.clearCalls = 0;
  }

  restore() {}

  updateFromQuota() {
    this.updateCalls += 1;
  }

  clear() {
    this.clearCalls += 1;
  }
}

class MemoryStore {
  constructor(value) {
    this.value = value;
  }

  async load() {
    return this.value;
  }

  async save(value) {
    this.value = value;
  }
}

class TimerSpy {
  constructor() {
    this.nextId = 1;
    this.intervals = [];
    this.cleared = [];
  }

  setInterval(_callback, interval) {
    this.intervals.push(interval);
    return this.nextId++;
  }

  clearInterval(id) {
    this.cleared.push(id);
  }
}

function sequentialNow(values) {
  let index = 0;
  return () => values[Math.min(index++, values.length - 1)];
}
