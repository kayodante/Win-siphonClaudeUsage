import assert from 'node:assert/strict';
import test from 'node:test';

import { buildTrayMenuTemplate, startApplication } from '../src/main/appLifecycle.js';

test('buildTrayMenuTemplate exposes only the required right-click options', () => {
  const template = buildTrayMenuTemplate({
    showMainWindow: () => {},
    toggleFloatingWidget: () => {},
    showSettingsWindow: () => {},
    quit: () => {}
  });

  assert.deepEqual(
    template.map(labelOrSeparator),
    ['Mostrar aplicativo', 'Widget flutuante', 'Configurações', 'separator', 'Reiniciar', 'Sair']
  );
  assert.equal(template[1].type, 'checkbox');
  assert.equal(template[1].checked, false);
});

test('buildTrayMenuTemplate can prepend disabled status items', () => {
  const template = buildTrayMenuTemplate({
    statusItems: [
      { label: 'Sessão: 42%', enabled: false },
      { label: 'Atualizado: agora', enabled: false }
    ],
    showMainWindow: () => {},
    toggleFloatingWidget: () => {},
    showSettingsWindow: () => {},
    quit: () => {}
  });

  assert.deepEqual(
    template.map(item => item.type === 'separator' ? 'separator' : `${item.label}:${item.enabled}`),
    [
      'Sessão: 42%:false',
      'Atualizado: agora:false',
      'separator',
      'Mostrar aplicativo:undefined',
      'Widget flutuante:undefined',
      'Configurações:undefined',
      'separator',
      'Reiniciar:undefined',
      'Sair:undefined'
    ]
  );
});

test('buildTrayMenuTemplate marks the widget checkbox when floating is enabled', () => {
  const template = buildTrayMenuTemplate({
    floatingWidgetEnabled: true,
    showMainWindow: () => {},
    toggleFloatingWidget: () => {},
    showSettingsWindow: () => {},
    quit: () => {}
  });

  assert.equal(template[1].label, 'Widget flutuante');
  assert.equal(template[1].type, 'checkbox');
  assert.equal(template[1].checked, true);
});

function labelOrSeparator(item) {
  return item.type === 'separator' ? item.type : item.label;
}

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
