import assert from 'node:assert/strict';
import EventEmitter from 'node:events';
import test from 'node:test';

import { FloatingWindowController } from '../src/main/floatingWindow.js';

test('show creates the PiP widget with fixed always-on-top options', async () => {
  const windows = [];
  const preferences = new MemoryPreferences({ floating: { enabled: true, expanded: false, x: null, y: null } });
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
      height: 104,
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
  const preferences = new MemoryPreferences({ floating: { enabled: true, expanded: false, x: 42, y: 84 } });
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
    preferences: new MemoryPreferences({ floating: { enabled: true, expanded: false, x: null, y: null } })
  });
  const state = sampleState();

  await controller.show(state);
  controller.syncState(state);

  assert.deepEqual(windows[0].webContents.messages.at(-1), ['state-changed', state]);
});

test('move persists the widget position after the debounce fires', async () => {
  const windows = [];
  const preferences = new MemoryPreferences({ floating: { enabled: true, expanded: false, x: null, y: null } });
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
  windows[0].bounds = { x: 128, y: 256, width: 220, height: 102 };
  windows[0].emit('move');
  await Promise.resolve();

  assert.deepEqual(preferences.setCalls, [
    ['floating.x', 128],
    ['floating.y', 256]
  ]);
});

test('restorePosition falls back to top-right when saved position is off all displays', async () => {
  const windows = [];
  const screen = createFakeScreen([{ bounds: { x: 0, y: 0, width: 1920, height: 1080 }, workArea: { x: 0, y: 0, width: 1920, height: 1040 } }]);
  // position is on a second monitor that is no longer connected
  const preferences = new MemoryPreferences({ floating: { enabled: true, expanded: false, x: 2500, y: 200 } });
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
  const preferences = new MemoryPreferences({ floating: { enabled: true, expanded: false, x: 42, y: 84 } });
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

test('restorePosition falls back when the saved window would be partially offscreen', async () => {
  const windows = [];
  const screen = createFakeScreen([{ bounds: { x: 0, y: 0, width: 1920, height: 1080 }, workArea: { x: 0, y: 0, width: 1920, height: 1040 } }]);
  const preferences = new MemoryPreferences({ floating: { enabled: true, expanded: false, x: 1850, y: 1000 } });
  const controller = new FloatingWindowController({
    BrowserWindow: createFakeBrowserWindow(windows),
    htmlPath: 'floating.html',
    preloadPath: 'preload.cjs',
    preferences,
    screen
  });

  await controller.show(sampleState());

  assert.deepEqual(windows[0].position, { x: 1680, y: 20 });
});

test('hide destroys the active floating window', async () => {
  const windows = [];
  const controller = new FloatingWindowController({
    BrowserWindow: createFakeBrowserWindow(windows),
    htmlPath: 'floating.html',
    preloadPath: 'preload.cjs',
    preferences: new MemoryPreferences({ floating: { enabled: true, expanded: false, x: null, y: null } })
  });

  await controller.show(sampleState());
  controller.hide();

  assert.equal(windows[0].destroyed, true);
  assert.equal(controller.window, null);
});

test('show creates the expanded widget when the preference is active', async () => {
  const windows = [];
  const preferences = new MemoryPreferences({ floating: { enabled: true, expanded: true, x: null, y: null } });
  const controller = new FloatingWindowController({
    BrowserWindow: createFakeBrowserWindow(windows),
    htmlPath: 'floating.html',
    preloadPath: 'preload.cjs',
    preferences
  });

  await controller.show(sampleState({ expanded: true }));

  assert.deepEqual(
    pick(windows[0].options, ['width', 'height', 'minWidth', 'minHeight', 'maxWidth', 'maxHeight']),
    {
      width: 220,
      height: 192,
      minWidth: 220,
      minHeight: 192,
      maxWidth: 220,
      maxHeight: 192
    }
  );
});

test('setExpanded persists preference and resizes an open widget', async () => {
  const windows = [];
  const preferences = new MemoryPreferences({ floating: { enabled: true, expanded: false, x: null, y: null } });
  const controller = new FloatingWindowController({
    BrowserWindow: createFakeBrowserWindow(windows),
    htmlPath: 'floating.html',
    preloadPath: 'preload.cjs',
    preferences
  });

  await controller.show(sampleState());
  await controller.setExpanded(true);

  assert.deepEqual(preferences.setCalls.at(-1), ['floating.expanded', true]);
  assert.deepEqual(windows[0].contentSizeCalls.at(-1), [220, 192, false]);

  await controller.setExpanded(false);

  assert.deepEqual(preferences.setCalls.at(-1), ['floating.expanded', false]);
  assert.deepEqual(windows[0].contentSizeCalls.at(-1), [220, 104, false]);
});

test('show creates a 71x32 mini widget when style is mini', async () => {
  const windows = [];
  const preferences = new MemoryPreferences({
    floating: { enabled: true, expanded: false, style: 'mini', x: null, y: null }
  });
  const controller = new FloatingWindowController({
    BrowserWindow: createFakeBrowserWindow(windows),
    htmlPath: 'floating.html',
    preloadPath: 'preload.cjs',
    preferences
  });

  await controller.show(sampleState({ style: 'mini' }));

  assert.deepEqual(
    pick(windows[0].options, [
      'width',
      'height',
      'minWidth',
      'minHeight',
      'maxWidth',
      'maxHeight',
      'thickFrame',
      'useContentSize',
      'backgroundColor',
      'backgroundMaterial'
    ]),
    {
      width: 71,
      height: 32,
      minWidth: 71,
      minHeight: 32,
      maxWidth: 71,
      maxHeight: 32,
      thickFrame: false,
      useContentSize: true,
      backgroundColor: '#00000000',
      backgroundMaterial: 'none'
    }
  );
  assert.deepEqual(windows[0].contentSizeCalls.at(-1), [71, 32, false]);
});

test('syncState clears native acrylic when an open widget switches to mini', async () => {
  const windows = [];
  const controller = new FloatingWindowController({
    BrowserWindow: createFakeBrowserWindow(windows),
    htmlPath: 'floating.html',
    preloadPath: 'preload.cjs',
    preferences: new MemoryPreferences({
      floating: { enabled: true, expanded: false, style: 'classic', x: null, y: null }
    })
  });

  await controller.show(sampleState({ style: 'classic' }));
  controller.syncState(sampleState({ style: 'mini' }));

  assert.deepEqual(windows[0].contentSizeCalls.at(-1), [71, 32, false]);
  assert.deepEqual(windows[0].backgroundMaterialCalls.at(-1), 'none');
  assert.deepEqual(windows[0].backgroundColorCalls.at(-1), '#00000000');
});

test('show cleans up a failed load so the next call can retry with a fresh window', async () => {
  const windows = [];
  let loadAttempts = 0;
  const controller = new FloatingWindowController({
    BrowserWindow: createFakeBrowserWindow(windows, {
      loadFile: async function loadFile(file) {
        loadAttempts += 1;
        this.loadedFile = file;
        if (loadAttempts === 1) throw new Error('load failed');
      }
    }),
    htmlPath: 'floating.html',
    preloadPath: 'preload.cjs',
    preferences: new MemoryPreferences({ floating: { enabled: true, expanded: false, x: null, y: null } })
  });

  await assert.rejects(() => controller.show(sampleState()), /load failed/);

  assert.equal(windows[0].destroyed, true);
  assert.equal(controller.window, null);
  assert.equal(controller.loaded, false);

  await controller.show(sampleState());

  assert.equal(windows.length, 2);
  assert.equal(windows[1].loadedFile, 'floating.html');
  assert.equal(windows[1].showInactiveCalls, 1);
});

function createFakeBrowserWindow(windows, { loadFile: loadFileOverride } = {}) {
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
      this.sizeCalls = [];
      this.contentSizeCalls = [];
      this.backgroundColorCalls = [];
      this.backgroundMaterialCalls = [];
      this.showInactiveCalls = 0;
      this.showCalls = 0;
      this.alwaysOnTopCalls = [];
      windows.push(this);
    }

    async loadFile(file) {
      if (loadFileOverride) {
        return loadFileOverride.call(this, file);
      }
      this.loadedFile = file;
    }

    setPosition(x, y) {
      this.position = { x, y };
      this.bounds.x = x;
      this.bounds.y = y;
    }

    setSize(width, height, animate = false) {
      this.sizeCalls.push([width, height, animate]);
      this.bounds.width = width;
      this.bounds.height = height;
    }

    setContentSize(width, height, animate = false) {
      this.contentSizeCalls.push([width, height, animate]);
      this.bounds.width = width;
      this.bounds.height = height;
    }

    setBackgroundColor(color) {
      this.backgroundColorCalls.push(color);
    }

    setBackgroundMaterial(material) {
      this.backgroundMaterialCalls.push(material);
    }

    setAlwaysOnTop(flag, level) {
      this.alwaysOnTopCalls.push([flag, level]);
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

function sampleState({ expanded = false, style = 'classic' } = {}) {
  return {
    preferences: { floating: { enabled: true, expanded, style, x: null, y: null } },
    quota: {
      session: {
        percent: 64,
        resetsAt: new Date('2026-04-29T18:00:00.000Z').toISOString()
      },
      weeklyAll: {
        percent: 32,
        resetsAt: new Date('2026-05-01T18:00:00.000Z').toISOString()
      }
    },
    todayStats: { cost: 1.25 },
    monthStats: { cost: 12.5 }
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
