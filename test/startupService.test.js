import assert from 'node:assert/strict';
import test from 'node:test';

import {
  applyStartupSettings,
  buildLoginItemSettings,
  shouldStartHidden,
  STARTUP_HIDDEN_ARG,
  STARTUP_REGISTRY_NAME
} from '../src/main/startupService.js';

test('disabled autostart clears the login item', () => {
  const app = new AppSpy();

  const settings = applyStartupSettings(
    app,
    { openAtLogin: false, showWindowOnLogin: false },
    { executablePath: 'C:\\Program Files\\Siphon\\Siphon.exe' }
  );

  assert.deepEqual(settings, {
    openAtLogin: false,
    path: 'C:\\Program Files\\Siphon\\Siphon.exe',
    args: [],
    name: STARTUP_REGISTRY_NAME
  });
  assert.deepEqual(app.settings, settings);
});

test('enabled autostart with hidden login writes the hidden argument', () => {
  const settings = buildLoginItemSettings(
    { openAtLogin: true, showWindowOnLogin: false },
    { executablePath: 'C:\\Program Files\\Siphon\\Siphon.exe' }
  );

  assert.deepEqual(settings.args, [STARTUP_HIDDEN_ARG]);
});

test('enabled autostart with show-window login writes no hidden argument', () => {
  const settings = buildLoginItemSettings(
    { openAtLogin: true, showWindowOnLogin: true },
    { executablePath: 'C:\\Program Files\\Siphon\\Siphon.exe' }
  );

  assert.deepEqual(settings.args, []);
});

test('service uses process.execPath and the Siphon registry name', () => {
  const settings = buildLoginItemSettings({ openAtLogin: true, showWindowOnLogin: true });

  assert.equal(settings.path, process.execPath);
  assert.equal(settings.name, 'Siphon');
});

test('shouldStartHidden reads the managed launch argument', () => {
  assert.equal(shouldStartHidden(['Siphon.exe', STARTUP_HIDDEN_ARG]), true);
  assert.equal(shouldStartHidden(['Siphon.exe']), false);
});

class AppSpy {
  setLoginItemSettings(settings) {
    this.settings = settings;
  }
}
