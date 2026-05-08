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
    language: 'en',
    notifications: { sessionReset: false, sound: false },
    floating: { enabled: false, x: null, y: null },
    claudePath: null
  });
});

test('language defaults to English and survives set', () => {
  const store = new MemoryStore(null);
  const preferences = new PreferencesService(store);

  assert.equal(preferences.load().language, 'en');

  const snapshot = preferences.set('language', 'pt-BR');

  assert.equal(snapshot.language, 'pt-BR');
  assert.equal(store.value.language, 'pt-BR');
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
    language: 'en',
    notifications: { sessionReset: false, sound: false },
    floating: { enabled: false, x: null, y: null },
    claudePath: null
  });
  assert.deepEqual(store.value, snapshot);
});

test('set creates deep paths without dropping sibling defaults', () => {
  const store = new MemoryStore(null);
  const preferences = new PreferencesService(store);

  const snapshot = preferences.set('floating.x', 120);

  assert.deepEqual(snapshot, {
    language: 'en',
    notifications: { sessionReset: true, sound: false },
    floating: { enabled: false, x: 120, y: null },
    claudePath: null
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
      language: 'en',
      notifications: { sessionReset: false, sound: false },
      floating: { enabled: false, x: null, y: null },
      claudePath: null
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

test('setPath blocks prototype pollution', () => {
  const store = new MemoryStore(null);
  const preferences = new PreferencesService(store);

  preferences.set('__proto__.polluted', 'YES');
  assert.equal(({}).polluted, undefined);

  preferences.set('constructor.prototype.polluted2', 'YES');
  assert.equal(({}).polluted2, undefined);
});
