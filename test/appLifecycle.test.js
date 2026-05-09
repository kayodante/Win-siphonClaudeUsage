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

test('buildTrayMenuTemplate can prepend disabled status items', () => {
  const template = buildTrayMenuTemplate({
    statusItems: [
      { label: 'Sessão: 42%', enabled: false },
      { label: 'Atualizado: agora', enabled: false }
    ],
    showMainWindow: () => {},
    showFloatingWidget: () => {},
    showSettingsWindow: () => {},
    quit: () => {}
  });

  assert.deepEqual(
    template.map(item => item.type ?? `${item.label}:${item.enabled}`),
    [
      'Sessão: 42%:false',
      'Atualizado: agora:false',
      'separator',
      'Mostrar aplicativo:undefined',
      'Mostrar widget:undefined',
      'Configurações:undefined',
      'separator',
      'Sair:undefined'
    ]
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

test('startApplication can skip the initial window show', async () => {
  const calls = [];

  await startApplication({
    loadWindow: async () => calls.push('loadWindow'),
    showWindow: () => calls.push('showWindow'),
    showOnStart: false,
    startController: () => calls.push('startController'),
    onControllerError: () => calls.push('controllerError')
  });

  assert.deepEqual(calls, ['loadWindow', 'startController']);
});
