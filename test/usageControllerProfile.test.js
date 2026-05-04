import assert from 'node:assert/strict';
import test from 'node:test';

import { UsageController } from '../src/main/usageController.js';

test('controller initializes profile state to null', () => {
  const controller = createController();

  assert.equal(controller.getState().profile, null);
});

test('refreshProfile stores the best-effort profile result', async () => {
  const profile = { name: 'Kayo Dante', email: 'kayo@example.com', plan: 'Pro' };
  const controller = createController({
    profileService: {
      fetchProfile: async () => profile
    }
  });

  await controller.refreshProfile();

  assert.deepEqual(controller.getState().profile, profile);
});

test('signOut clears profile before emitting state', async () => {
  const states = [];
  const controller = createController({
    profileService: {
      fetchProfile: async () => ({ name: 'Kayo Dante', email: null, plan: null })
    }
  });

  await controller.refreshProfile();
  controller.on('state', state => states.push(structuredClone(state)));
  await controller.signOut();

  assert.equal(controller.getState().profile, null);
  assert.equal(states.at(-1).profile, null);
});

function createController(overrides = {}) {
  return new UsageController({
    resetScheduler: {
      restore: () => {},
      updateFromQuota: () => {},
      clear: () => {}
    },
    tokenStore: {
      load: async () => null,
      clear: async () => {},
      save: async () => {}
    },
    quotaService: {
      fetchQuota: async () => ({
        session: null,
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
    openExternal: async () => {},
    ...overrides
  });
}
