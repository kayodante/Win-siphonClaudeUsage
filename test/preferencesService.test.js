import assert from 'node:assert/strict';
import test from 'node:test';

import { DEFAULT_PREFERENCES, PreferencesService } from '../src/main/preferencesService.js';
import { MemoryStore } from './helpers.js';

test('load returns defaults when store is missing', async () => {
  const preferences = new PreferencesService(new MemoryStore(null));

  assert.deepEqual(await preferences.load(), DEFAULT_PREFERENCES);
});

test('load merges partial stored preferences with defaults', async () => {
  const preferences = new PreferencesService(
    new MemoryStore({
      notifications: { sessionReset: false }
    })
  );

  assert.deepEqual(await preferences.load(), {
    language: 'en',
    notifications: { sessionReset: false, sound: false, soundVolume: 1, expireSound: false, expireSoundVolume: 1, expireAlert: false, limitSound: false, limitSoundVolume: 1, limitAlert: false },
    floating: { enabled: false, expanded: false, style: 'classic', x: null, y: null },
    startup: { openAtLogin: false, showWindowOnLogin: false },
    refresh: { intervalSeconds: 30 },
    integration: { launchWithClaudeCode: false },
    privacy: { maskEmail: false },
    display: { quotaMode: 'used' },
    claudePath: null
  });
});

test('language defaults to English and survives set', async () => {
  const store = new MemoryStore(null);
  const preferences = new PreferencesService(store);

  assert.equal((await preferences.load()).language, 'en');

  const snapshot = await preferences.set('language', 'pt-BR');

  assert.equal(snapshot.language, 'pt-BR');
  assert.equal(store.value.language, 'pt-BR');
});

test('get reads a nested preference path', async () => {
  const preferences = new PreferencesService(
    new MemoryStore({
      notifications: { sessionReset: false }
    })
  );

  assert.equal(await preferences.get('notifications.sessionReset'), false);
});

test('set persists a nested change and returns the full snapshot', async () => {
  const store = new MemoryStore(null);
  const preferences = new PreferencesService(store);

  const snapshot = await preferences.set('notifications.sessionReset', false);

  assert.deepEqual(snapshot, {
    language: 'en',
    notifications: { sessionReset: false, sound: false, soundVolume: 1, expireSound: false, expireSoundVolume: 1, expireAlert: false, limitSound: false, limitSoundVolume: 1, limitAlert: false },
    floating: { enabled: false, expanded: false, style: 'classic', x: null, y: null },
    startup: { openAtLogin: false, showWindowOnLogin: false },
    refresh: { intervalSeconds: 30 },
    integration: { launchWithClaudeCode: false },
    privacy: { maskEmail: false },
    display: { quotaMode: 'used' },
    claudePath: null
  });
  assert.deepEqual(store.value, snapshot);
});

test('set creates deep paths without dropping sibling defaults', async () => {
  const store = new MemoryStore(null);
  const preferences = new PreferencesService(store);

  const snapshot = await preferences.set('floating.x', 120);

  assert.deepEqual(snapshot, {
    language: 'en',
    notifications: { sessionReset: true, sound: false, soundVolume: 1, expireSound: false, expireSoundVolume: 1, expireAlert: false, limitSound: false, limitSoundVolume: 1, limitAlert: false },
    floating: { enabled: false, expanded: false, style: 'classic', x: 120, y: null },
    startup: { openAtLogin: false, showWindowOnLogin: false },
    refresh: { intervalSeconds: 30 },
    integration: { launchWithClaudeCode: false },
    privacy: { maskEmail: false },
    display: { quotaMode: 'used' },
    claudePath: null
  });
});

test('refresh interval defaults to 30 seconds and survives set', async () => {
  const store = new MemoryStore(null);
  const preferences = new PreferencesService(store);

  assert.equal((await preferences.load()).refresh.intervalSeconds, 30);

  const snapshot = await preferences.set('refresh.intervalSeconds', 300);

  assert.equal(snapshot.refresh.intervalSeconds, 300);
  assert.equal(store.value.refresh.intervalSeconds, 300);
});

test('set emits one change event after persisting', async () => {
  const store = new MemoryStore(null);
  const preferences = new PreferencesService(store);
  const events = [];

  preferences.on('change', event => events.push(event));
  await preferences.set('notifications.sessionReset', false);

  assert.equal(events.length, 1);
  assert.deepEqual(events[0], {
    path: 'notifications.sessionReset',
    value: false,
    preferences: {
      language: 'en',
      notifications: { sessionReset: false, sound: false, soundVolume: 1, expireSound: false, expireSoundVolume: 1, expireAlert: false, limitSound: false, limitSoundVolume: 1, limitAlert: false },
      floating: { enabled: false, expanded: false, style: 'classic', x: null, y: null },
      startup: { openAtLogin: false, showWindowOnLogin: false },
      refresh: { intervalSeconds: 30 },
      integration: { launchWithClaudeCode: false },
      privacy: { maskEmail: false },
      display: { quotaMode: 'used' },
      claudePath: null
    }
  });
});

test('setMany persists every path in a single write and emits one event per path', async () => {
  const store = new CountingMemoryStore(null);
  const preferences = new PreferencesService(store);
  const events = [];
  preferences.on('change', event => events.push(event));

  const snapshot = await preferences.setMany([
    ['window.x', 10],
    ['window.y', 20],
    ['window.width', 320],
    ['window.height', 700]
  ]);

  assert.equal(store.saveCount, 1);
  assert.deepEqual(snapshot.window, { x: 10, y: 20, width: 320, height: 700 });
  assert.equal(store.value.window.width, 320);
  assert.deepEqual(events.map(e => e.path), [
    'window.x', 'window.y', 'window.width', 'window.height'
  ]);
  assert.deepEqual(events.map(e => e.value), [10, 20, 320, 700]);
  // Every event carries the final merged snapshot.
  assert.equal(events.at(-1).preferences.window.height, 700);
});

class CountingMemoryStore extends MemoryStore {
  constructor(value) {
    super(value);
    this.saveCount = 0;
  }

  async save(value) {
    this.saveCount += 1;
    await super.save(value);
  }
}

test('concurrent set calls are serialized without dropping sibling changes', async () => {
  const store = new SlowMemoryStore(null);
  const preferences = new PreferencesService(store);

  await Promise.all([
    preferences.set('floating.x', 128),
    preferences.set('floating.y', 256),
    preferences.set('language', 'pt-BR')
  ]);

  assert.equal(store.value.floating.x, 128);
  assert.equal(store.value.floating.y, 256);
  assert.equal(store.value.language, 'pt-BR');
});

class SlowMemoryStore extends MemoryStore {
  async save(value) {
    await Promise.resolve();
    this.value = value;
  }
}

test('setPath blocks prototype pollution', async () => {
  const store = new MemoryStore(null);
  const preferences = new PreferencesService(store);

  await preferences.set('__proto__.polluted', 'YES');
  assert.equal(({}).polluted, undefined);

  await preferences.set('constructor.prototype.polluted2', 'YES');
  assert.equal(({}).polluted2, undefined);
});

test('limitAlert and expireAlert default to false', async () => {
  const preferences = new PreferencesService(new MemoryStore(null));
  const loaded = await preferences.load();
  assert.equal(loaded.notifications.limitAlert, false);
  assert.equal(loaded.notifications.expireAlert, false);
});

test('DEFAULT_PREFERENCES includes privacy.maskEmail false and display.quotaMode used', async () => {
  const store = { load: async () => ({}), save: async () => {} };
  const prefs = new PreferencesService(store);
  const loaded = await prefs.load();
  assert.equal(loaded.privacy.maskEmail, false);
  assert.equal(loaded.display.quotaMode, 'used');
});
