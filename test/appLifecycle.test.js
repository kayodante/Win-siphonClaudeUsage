import assert from 'node:assert/strict';
import test from 'node:test';

import { buildTrayMenuTemplate, startApplication } from '../src/main/appLifecycle.js';

test('buildTrayMenuTemplate exposes only the required right-click options', () => {
  const template = buildTrayMenuTemplate({
    showMainWindow: () => {},
    showFloatingWidget: () => {},
    showSettingsWindow: () => {},
    quit: () => {}
  });

  assert.deepEqual(
    template.map(item => item.type ?? item.label),
    ['Mostrar aplicativo', 'Mostrar widget', 'Configurações', 'separator', 'Sair']
  );
});

test('startApplication shows the window before controller startup resolves', async () => {
  const calls = [];
  let resolveStart;
  const controller = {
    start: () =>
      new Promise(resolve => {
        resolveStart = resolve;
      })
  };

  const started = startApplication({
    loadWindow: async () => calls.push('loadWindow'),
    showWindow: () => calls.push('showWindow'),
    startController: () => {
      calls.push('startController');
      return controller.start();
    },
    onControllerError: () => calls.push('controllerError')
  });

  await Promise.resolve();

  assert.deepEqual(calls, ['loadWindow', 'showWindow', 'startController']);

  resolveStart();
  await started;
});
