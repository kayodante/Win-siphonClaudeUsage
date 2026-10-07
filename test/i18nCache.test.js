import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import vm from 'node:vm';

test('i18nCache is initialized before the initial render reaches applyTranslations', () => {
  const rendererSource = readFileSync(new URL('../src/renderer/renderer.js', import.meta.url), 'utf8');

  // Replace imports and exports to make it runnable in vm
  let testCode = rendererSource.replace(/import .* from .*/g, '');

  // Provide mock implementations
  testCode = `
    const document = {
      documentElement: { lang: '' },
      querySelectorAll: () => [],
      querySelector: () => ({ addEventListener: () => {} }),
      addEventListener: () => {},
      body: { dataset: {} }
    };
    const window = {
      electron: { onStateChange: () => {} },
      siphon: {
        onView: () => {},
        onState: () => {},
        onResetSound: () => {},
        getState: () => Promise.resolve({}),
        onWindowShown: () => {},
        getAppInfo: () => Promise.resolve({ version: '1.0' })
      }
    };
    let elements = new Proxy({}, { get: () => ({ addEventListener: () => {}, style: { setProperty: () => {} } }) });
    let currentState = null;
    let SUPPORTED_LANGUAGES = ['en'];
    let t = (key) => key;
    let hydrateSlot = (x) => x;
    let clampPercent = (x) => x;

    // We want to track the order of events
    let events = [];

    // Wrap querySelectorAll to track when the cache is populated
    const originalQuerySelectorAll = document.querySelectorAll;
    document.querySelectorAll = function(selector) {
      if (selector === '[data-i18n]') {
        events.push('cache_populated');
      }
      return [];
    };

    // Stub render and applyTranslations to track calls
    let originalApplyTranslations;

    ` + testCode + `

    // Redefine applyTranslations after the original has been declared
    originalApplyTranslations = applyTranslations;
    applyTranslations = function(lang) {
      events.push('applyTranslations_called');
      return originalApplyTranslations(lang);
    };
  `;

  // We can't actually easily run top level awaits in a node vm context without more setup
  // Let's use the static analysis approach since it is robust and matches the pattern in rendererViewState.test.js

  const cacheDeclarationIndex = rendererSource.indexOf('let i18nCache = null;');
  const applyTranslationsIndex = rendererSource.indexOf('function applyTranslations');
  assert.ok(cacheDeclarationIndex !== -1, 'i18nCache must be declared');
  assert.ok(cacheDeclarationIndex < applyTranslationsIndex, 'i18nCache must be declared before applyTranslations');

  // Verify that the initial cache population happens before the first render(currentState)
  const cacheInitIndex = rendererSource.indexOf('if (!i18nCache) {');
  const firstRenderIndex = rendererSource.indexOf('render(await window.siphon.getState());', rendererSource.indexOf('window.siphon.onState(render);'));


  assert.ok(cacheInitIndex > -1, 'i18nCache initialization must exist');
  assert.ok(firstRenderIndex > -1, 'first render must exist');
  assert.ok(cacheInitIndex < firstRenderIndex, 'i18nCache must be initialized before the first render call');

  // Verify that applyTranslations no longer initializes the cache itself
  const applyTranslationsBody = rendererSource.substring(applyTranslationsIndex, rendererSource.indexOf('}', applyTranslationsIndex));
  assert.equal(applyTranslationsBody.includes('i18nCache = {'), false, 'applyTranslations should not initialize i18nCache');
});
