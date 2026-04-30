import assert from 'node:assert/strict';
import test from 'node:test';

import { ResetNotificationScheduler } from '../src/main/resetNotificationScheduler.js';

test('scheduler schedules one reset notification when session limit is reached', () => {
  const scheduled = [];
  const store = new Map();
  const now = new Date('2026-04-27T10:00:00Z');
  const scheduler = new ResetNotificationScheduler({
    now: () => now,
    setTimer: (callback, delayMs) => {
      scheduled.push({ callback, delayMs });
      return `timer-${scheduled.length}`;
    },
    clearTimer: () => {},
    notify: () => {},
    loadState: () => store.get('state') ?? null,
    saveState: state => store.set('state', state)
  });

  scheduler.updateFromQuota({
    session: {
      percent: 100,
      resetsAt: new Date('2026-04-27T12:00:00Z')
    }
  });
  scheduler.updateFromQuota({
    session: {
      percent: 100,
      resetsAt: new Date('2026-04-27T12:00:00Z')
    }
  });

  assert.equal(scheduled.length, 1);
  assert.equal(scheduled[0].delayMs, 7_200_000);
  assert.deepEqual(store.get('state'), {
    resetKey: '2026-04-27T12:00:00.000Z',
    resetsAt: '2026-04-27T12:00:00.000Z'
  });
});

test('scheduler fires immediately after restart if reset time already passed', () => {
  let notificationCount = 0;
  const scheduler = new ResetNotificationScheduler({
    now: () => new Date('2026-04-27T13:00:00Z'),
    setTimer: () => assert.fail('should not schedule a future timer'),
    clearTimer: () => {},
    notify: () => {
      notificationCount += 1;
    },
    loadState: () => ({
      resetKey: '2026-04-27T12:00:00.000Z',
      resetsAt: '2026-04-27T12:00:00.000Z'
    }),
    saveState: () => {}
  });

  scheduler.restore();

  assert.equal(notificationCount, 1);
});

test('scheduler does not refire same resetKey after notification has fired', () => {
  let notificationCount = 0;
  const scheduler = new ResetNotificationScheduler({
    now: () => new Date('2026-04-27T13:00:00Z'),
    setTimer: () => 'timer',
    clearTimer: () => {},
    notify: () => {
      notificationCount += 1;
    },
    loadState: () => null,
    saveState: () => {}
  });

  scheduler.updateFromQuota({
    session: {
      percent: 100,
      resetsAt: new Date('2026-04-27T12:00:00Z')
    }
  });

  scheduler.updateFromQuota({
    session: {
      percent: 100,
      resetsAt: new Date('2026-04-27T12:00:00Z')
    }
  });

  assert.equal(notificationCount, 1);
});

test('scheduler clears stale reset when a new session starts', () => {
  const savedStates = [];
  const scheduler = new ResetNotificationScheduler({
    now: () => new Date('2026-04-27T10:00:00Z'),
    setTimer: () => 'timer',
    clearTimer: () => {},
    notify: () => {},
    loadState: () => null,
    saveState: state => savedStates.push(state)
  });

  scheduler.updateFromQuota({
    session: {
      percent: 100,
      resetsAt: new Date('2026-04-27T12:00:00Z')
    }
  });
  scheduler.updateFromQuota({
    session: {
      percent: 2,
      resetsAt: new Date('2026-04-27T17:00:00Z')
    }
  });

  assert.equal(savedStates.at(-1), null);
});
