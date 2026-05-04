import assert from 'node:assert/strict';
import test from 'node:test';

import { PreferencesService } from '../src/main/preferencesService.js';
import { UsageController } from '../src/main/usageController.js';

test('controller does not arm reset scheduler when session reset notifications are disabled', async () => {
  const preferences = new PreferencesService(
    new MemoryStore({
      notifications: { sessionReset: false }
    })
  );
  const scheduler = new SchedulerSpy();
  const controller = createController({ preferences, scheduler });

  await controller.refreshQuota();

  assert.equal(scheduler.updateCalls, 0);
  assert.equal(scheduler.clearCalls, 1);
});

test('controller clears armed scheduler when session reset notifications are toggled off', async () => {
  const preferences = new PreferencesService(new MemoryStore(null));
  const scheduler = new SchedulerSpy();
  const controller = createController({ preferences, scheduler });

  await controller.refreshQuota();
  preferences.set('notifications.sessionReset', false);

  assert.equal(scheduler.updateCalls, 1);
  assert.equal(scheduler.clearCalls, 1);
});

test('controller state includes preferences snapshot', () => {
  const preferences = new PreferencesService(
    new MemoryStore({
      notifications: { sessionReset: false }
    })
  );
  const controller = createController({ preferences, scheduler: new SchedulerSpy() });

  assert.deepEqual(controller.getState().preferences, {
    language: 'en',
    notifications: { sessionReset: false },
    floating: { enabled: false, x: null, y: null }
  });
});

function createController({ preferences, scheduler }) {
  return new UsageController({
    preferences,
    resetScheduler: scheduler,
    tokenStore: {
      load: async () => null,
      clear: async () => {},
      save: async () => {}
    },
    quotaService: {
      fetchQuota: async () => ({
        session: {
          percent: 100,
          resetsAt: new Date('2026-04-29T18:00:00Z')
        },
        weeklyAll: null,
        weeklySonnet: null,
        weeklyOpus: null
      })
    },
    localService: {
      load: async () => ({
        todayStats: {},
        monthStats: {},
        recentDays: [],
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

  load() {
    return this.value;
  }

  save(value) {
    this.value = value;
  }
}
