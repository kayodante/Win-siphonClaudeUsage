import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

test('i18nCache is initialized before the initial render reaches applyTranslations', () => {
  const rendererSource = readFileSync(new URL('../src/renderer/renderer.js', import.meta.url), 'utf8');

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
