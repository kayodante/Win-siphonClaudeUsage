import assert from 'node:assert/strict';
import EventEmitter from 'node:events';
import test from 'node:test';

import { FloatingWindowController } from '../src/main/floatingWindow.js';

test('show creates the PiP widget with fixed always-on-top options', async () => {
  const windows = [];
  const preferences = new MemoryPreferences({ floating: { enabled: true, x: null, y: null } });
  const controller = new FloatingWindowController({
    BrowserWindow: createFakeBrowserWindow(windows),
    htmlPath: 'floating.html',
    preloadPath: 'preload.cjs',
    preferences
  });

  await controller.show(sampleState());

  assert.equal(windows.length, 1);
  assert.deepEqual(
    pick(windows[0].options, [
      'width',
      'height',
      'resizable',
      'frame',
      'transparent',
      'backgroundMaterial',
      'alwaysOnTop',
      'skipTaskbar',
      'show'
    ]),
    {
      width: 220,
      height: 88,
      resizable: false,
      frame: false,
      transparent: true,
      backgroundMaterial: 'acrylic',
      alwaysOnTop: true,
      skipTaskbar: true,
      show: false
    }
  );
  assert.equal(windows[0].loadedFile, 'floating.html');
  assert.equal(windows[0].showInactiveCalls, 1);
});

test('show restores the persisted widget position', async () => {
  const windows = [];
  const preferences = new MemoryPreferences({ floating: { enabled: true, x: 42, y: 84 } });
  const controller = new FloatingWindowController({
    BrowserWindow: createFakeBrowserWindow(windows),
    htmlPath: 'floating.html',
    preloadPath: 'preload.cjs',
    preferences
  });

  await controller.show(sampleState());

  assert.deepEqual(windows[0].position, { x: 42, y: 84 });
});

test('syncState forwards state to the floating renderer', async () => {
  const windows = [];
  const controller = new FloatingWindowController({
    BrowserWindow: createFakeBrowserWindow(windows),
    htmlPath: 'floating.html',
    preloadPath: 'preload.cjs',
    preferences: new MemoryPreferences({ floating: { enabled: true, x: null, y: null } })
  });
  const state = sampleState();

  await controller.show(state);
  controller.syncState(state);

  assert.deepEqual(windows[0].webContents.messages.at(-1), ['state-changed', state]);
});

test('move persists the widget position after the debounce fires', async () => {
  const windows = [];
  const preferences = new MemoryPreferences({ floating: { enabled: true, x: null, y: null } });
  const controller = new FloatingWindowController({
    BrowserWindow: createFakeBrowserWindow(windows),
    clearTimeout: () => {},
    debounceMs: 250,
    htmlPath: 'floating.html',
    preloadPath: 'preload.cjs',
    preferences,
    setTimeout: callback => {
      callback();
      return 1;
    }
  });

  await controller.show(sampleState());
  windows[0].bounds = { x: 128, y: 256, width: 220, height: 80 };
  windows[0].emit('move');

  assert.deepEqual(preferences.setCalls, [
    ['floating.x', 128],
    ['floating.y', 256]
  ]);
});

test('restorePosition falls back to top-right when saved position is off all displays', async () => {
  const windows = [];
  const screen = createFakeScreen([{ bounds: { x: 0, y: 0, width: 1920, height: 1080 }, workArea: { x: 0, y: 0, width: 1920, height: 1040 } }]);
  // position is on a second monitor that is no longer connected
  const preferences = new MemoryPreferences({ floating: { enabled: true, x: 2500, y: 200 } });
  const controller = new FloatingWindowController({
    BrowserWindow: createFakeBrowserWindow(windows),
    htmlPath: 'floating.html',
    preloadPath: 'preload.cjs',
    preferences,
    screen
  });

  await controller.show(sampleState());

  // top-right of workArea: x = 0 + 1920 - 220 - 20 = 1680, y = 0 + 20 = 20
  assert.deepEqual(windows[0].position, { x: 1680, y: 20 });
});

test('restorePosition uses saved position when it lies on a connected display', async () => {
  const windows = [];
  const screen = createFakeScreen([{ bounds: { x: 0, y: 0, width: 1920, height: 1080 }, workArea: { x: 0, y: 0, width: 1920, height: 1040 } }]);
  const preferences = new MemoryPreferences({ floating: { enabled: true, x: 42, y: 84 } });
  const controller = new FloatingWindowController({
    BrowserWindow: createFakeBrowserWindow(windows),
    htmlPath: 'floating.html',
    preloadPath: 'preload.cjs',
    preferences,
    screen
  });

  await controller.show(sampleState());

  assert.deepEqual(windows[0].position, { x: 42, y: 84 });
});

test('hide destroys the active floating window', async () => {
  const windows = [];
  const controller = new FloatingWindowController({
    BrowserWindow: createFakeBrowserWindow(windows),
    htmlPath: 'floating.html',
    preloadPath: 'preload.cjs',
    preferences: new MemoryPreferences({ floating: { enabled: true, x: null, y: null } })
  });

  await controller.show(sampleState());
  controller.hide();

  assert.equal(windows[0].destroyed, true);
  assert.equal(controller.window, null);
});

function createFakeBrowserWindow(windows) {
  return class FakeBrowserWindow extends EventEmitter {
    constructor(options) {
      super();
      this.options = options;
      this.bounds = { x: 0, y: 0, width: options.width, height: options.height };
      this.webContents = {
        messages: [],
        send: (...message) => this.webContents.messages.push(message)
      };
      this.destroyed = false;
      this.loadedFile = null;
      this.position = null;
      this.showInactiveCalls = 0;
      this.showCalls = 0;
      windows.push(this);
    }

    async loadFile(file) {
      this.loadedFile = file;
    }

    setPosition(x, y) {
      this.position = { x, y };
      this.bounds.x = x;
      this.bounds.y = y;
    }

    showInactive() {
      this.showInactiveCalls += 1;
    }

    show() {
      this.showCalls += 1;
    }

    getBounds() {
      return this.bounds;
    }

    isDestroyed() {
      return this.destroyed;
    }

    destroy() {
      this.destroyed = true;
      this.emit('closed');
    }
  };
}

class MemoryPreferences {
  constructor(value) {
    this.value = value;
    this.setCalls = [];
  }

  get(path) {
    return path.split('.').reduce((current, key) => current?.[key], this.value);
  }

  set(path, value) {
    this.setCalls.push([path, value]);
    const parts = path.split('.');
    let current = this.value;
    for (const part of parts.slice(0, -1)) {
      current[part] ??= {};
      current = current[part];
    }
    current[parts.at(-1)] = value;
    return this.value;
  }
}

function sampleState() {
  return {
    preferences: { floating: { enabled: true, x: null, y: null } },
    quota: {
      session: {
        percent: 64,
        resetsAt: new Date('2026-04-29T18:00:00.000Z').toISOString()
      }
    }
  };
}

function pick(object, keys) {
  return Object.fromEntries(keys.map(key => [key, object[key]]));
}

function createFakeScreen(displays) {
  return {
    getAllDisplays: () => displays,
    getPrimaryDisplay: () => displays[0]
  };
}
