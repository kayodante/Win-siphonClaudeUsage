import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync } from 'node:fs';

test('applyTranslations caches DOM queries and updates text on subsequent renders', async () => {
  const rendererSource = readFileSync(new URL('../src/renderer/renderer.js', import.meta.url), 'utf8');

  // We are going to construct a test environment that supports top level awaits via async IIFE
  // without blindly removing all 'await's, as that changes bootstrap execution logic.

  // Strip imports so we can run the code block using eval
  let runnableSource = rendererSource.replace(/import\s+.*?\s+from\s+['"].*?['"];?/gs, '');
  runnableSource = runnableSource.replace('let i18nCache = null;', 'var i18nCache = null;');

  // Provide dependencies
  const scriptEnv = `
    const document = {
      createDocumentFragment: () => ({ appendChild: () => {} }),
      createElement: () => ({ className: '', dataset: {}, classList: { add: () => {}, remove: () => {} }, style: { setProperty: () => {} }, setAttribute: () => {} }),
      documentElement: { lang: '' },
      body: { dataset: {} },
      querySelector: () => ({ children: [], replaceChildren: () => {}, appendChild: () => {}, hasAttribute: () => false, setAttribute: () => {}, removeAttribute: () => {},
        addEventListener: () => {},
        style: {
          setProperty: () => {},
          pointerEvents: '',
          opacity: '',
          transform: ''
        },
        dataset: {},
        getBoundingClientRect: () => ({ left: 0, right: 0, width: 0, height: 0 })
      }),
      addEventListener: () => {}
    };

    const mockElements = {
      '[data-i18n]': [{ dataset: { i18n: 'test_key' }, textContent: '' }],
      '[data-i18n-title]': [{ dataset: { i18nTitle: 'test_title' }, title: '' }],
      '[data-i18n-tooltip]': [{ dataset: { i18nTooltip: 'test_tooltip', tooltip: '' } }],
      '[data-i18n-aria-label]': [{ dataset: { i18nAriaLabel: 'test_aria' }, setAttribute(k, v) { this[k] = v; } }],
      '[data-i18n-placeholder]': [{ dataset: { i18nPlaceholder: 'test_placeholder' }, setAttribute(k, v) { this[k] = v; } }]
    };

    let queryCount = 0;
    document.querySelectorAll = function(selector) {
      queryCount++;
      return mockElements[selector] || [];
    };

    let currentStateCallback = null;
    const window = {
      innerWidth: 1024,
      electron: { onStateChange: () => {} },
      matchMedia: () => ({ matches: false, addEventListener: () => {} }),
      siphon: {
        onView: () => {},
        onState: (cb) => { currentStateCallback = cb; },
        onResetSound: () => {},
        getState: () => Promise.resolve({ preferences: { language: 'en' } }),
        onWindowShown: () => {},
        getAppInfo: () => Promise.resolve({ version: '1.0' }),
        showMainView: () => {},
        cancelAuth: () => {},
        openExternal: () => {},
        openSettings: () => {},
        requestManualReset: () => {},
        onUpdateAvailable: () => {},
        onUpdateProgress: () => {},
        onUpdateDownloaded: () => {},
        installUpdate: () => {},
        onUpdateError: () => {},
        setPreference: () => Promise.resolve(),
        submitCode: () => Promise.resolve()
      }
    };
    const console = { log: () => {}, warn: () => {} };
    const setTimeout = (cb) => { cb(); };
    const clearTimeout = () => {};
    const setInterval = () => {};
    const requestAnimationFrame = (cb) => { cb(); };
    const getComputedStyle = () => ({ getPropertyValue: () => '0ms' });
    const navigator = { clipboard: { writeText: () => Promise.resolve() } };
    const clearInterval = () => {};
    class Audio { play() { return Promise.resolve(); } }

    const SUPPORTED_LANGUAGES = ['en', 'pt-BR'];
    const t = (key, lang) => key + '_' + lang;
    const tFormat = (key) => key;
    const formatCommandError = () => '';
    const hydrateSlot = (x) => x;
    const clampPercent = (x) => x;
    const logSafeError = () => {};
    const redactSensitive = () => {};
    const formatClockTime = () => '';
    const formatCountdown = () => '';
    const formatCurrency = () => '';
    const formatPercent = () => '';
    const formatTokens = () => '';
    const levelForPercent = () => '';
    const maskEmail = () => '';
    const quotaDisplayValue = () => '';
    const buildUsagePace = () => '';
    const SESSION_WINDOW_MS = 1000;
    const isPeakHour = () => false;
    const peakHoursLocalRange = () => '';
    const buildSessionResetLine = () => '';
    const buildWeeklyResetLine = () => '';
    const resolveView = () => 'main';
  `;

  const testExecution = `
    ${scriptEnv}

    // We execute the module inside an async IIFE to support top level await.
    // If it throws an error during bootstrap, we catch it and fail the test.
    try {
      ${runnableSource}
    } catch(e) {
      return "BOOTSTRAP_ERROR: " + e.message;
    }

    // Now verify the state after initial await resolution
    try {
      if (typeof i18nCache === 'undefined' || !i18nCache) throw new Error("i18nCache should be populated after bootstrap");

      const initialQueryCount = queryCount;
      if (initialQueryCount === 0) throw new Error("DOM queries should have executed during initialization");

      if (mockElements['[data-i18n]'][0].textContent !== 'test_key_en') throw new Error("Text content not translated to EN: " + mockElements['[data-i18n]'][0].textContent);
      if (mockElements['[data-i18n-title]'][0].title !== 'test_title_en') throw new Error("Title not translated to EN");
      if (mockElements['[data-i18n-aria-label]'][0]['aria-label'] !== 'test_aria_en') throw new Error("Aria label not translated to EN");

      // Simulate language change
      currentStateCallback({ preferences: { language: 'pt-BR' } });

      if (queryCount > initialQueryCount) throw new Error("querySelectorAll should not be called again after initial cache");

      if (document.documentElement.lang !== 'pt-BR') throw new Error("documentElement.lang did not update");
      if (mockElements['[data-i18n]'][0].textContent !== 'test_key_pt-BR') throw new Error("Text content not translated to pt-BR");
      if (mockElements['[data-i18n-title]'][0].title !== 'test_title_pt-BR') throw new Error("Title not translated to pt-BR");
      if (mockElements['[data-i18n-aria-label]'][0]['aria-label'] !== 'test_aria_pt-BR') throw new Error("Aria label not translated to pt-BR");

      return "SUCCESS";
    } catch (e) {
      return e.message;
    }
  `;

  const result = await (new Function('return (async function() {' + testExecution + '})();'))();
  assert.equal(result, "SUCCESS");
});
