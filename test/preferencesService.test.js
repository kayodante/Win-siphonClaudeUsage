import assert from 'node:assert/strict';
import test from 'node:test';

import { DEFAULT_PREFERENCES, PreferencesService } from '../src/main/preferencesService.js';

test('load returns defaults when store is missing', () => {
  const preferences = new PreferencesService(new MemoryStore(null));

  assert.deepEqual(preferences.load(), DEFAULT_PREFERENCES);
});

test('load merges partial stored preferences with defaults', () => {
  const preferences = new PreferencesService(
    new MemoryStore({
      notifications: { sessionReset: false }
    })
  );

  assert.deepEqual(preferences.load(), {
    notifications: { sessionReset: false },
    floating: { enabled: false, x: null, y: null }
  });
});

test('get reads a nested preference path', () => {
  const preferences = new PreferencesService(
    new MemoryStore({
      notifications: { sessionReset: false }
    })
  );

  assert.equal(preferences.get('notifications.sessionReset'), false);
});

test('set persists a nested change and returns the full snapshot', () => {
  const store = new MemoryStore(null);
  const preferences = new PreferencesService(store);

  const snapshot = preferences.set('notifications.sessionReset', false);

  assert.deepEqual(snapshot, {
    notifications: { sessionReset: false },
    floating: { enabled: false, x: null, y: null }
  });
  assert.deepEqual(store.value, snapshot);
});

test('set creates deep paths without dropping sibling defaults', () => {
  const store = new MemoryStore(null);
  const preferences = new PreferencesService(store);

  const snapshot = preferences.set('floating.x', 120);

  assert.deepEqual(snapshot, {
    notifications: { sessionReset: true },
    floating: { enabled: false, x: 120, y: null }
  });
});

test('set emits one change event after persisting', () => {
  const store = new MemoryStore(null);
  const preferences = new PreferencesService(store);
  const events = [];

  preferences.on('change', event => events.push(event));
  preferences.set('notifications.sessionReset', false);

  assert.equal(events.length, 1);
  assert.deepEqual(events[0], {
    path: 'notifications.sessionReset',
    value: false,
    preferences: {
      notifications: { sessionReset: false },
      floating: { enabled: false, x: null, y: null }
    }
  });
});

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
