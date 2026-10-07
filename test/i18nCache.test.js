import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync } from 'node:fs';

test('applyTranslations initializes and reads the DOM cache correctly across renders', () => {
  const rendererSource = readFileSync(new URL('../src/renderer/renderer.js', import.meta.url), 'utf8');

  // Strip everything after the last `function applyTranslations` declaration.
  // Actually, we can just grab the exact function string directly via regex to test it, but it relies on i18nCache in the global scope.
  // We can just construct a small script.

  let i18nCacheMatch = rendererSource.match(/if \(!i18nCache\) \{\s*i18nCache = \{.*?\};\s*\}/s);
  let applyTranslationsMatch = rendererSource.match(/function applyTranslations\(lang\) \{.*?\n\}/s);

  assert.ok(i18nCacheMatch, "i18nCache must be initialized before applying translations");
  assert.ok(applyTranslationsMatch, "applyTranslations function must exist");

  // Create an execution context to test this isolated snippet
  const testExecution = `
    let i18nCache = null;
    let document = {
      documentElement: { lang: '' },
      querySelectorAll: (selector) => {
        queryCount++;
        return [{
          dataset: { i18n: 'test_key', i18nTitle: 'title', i18nTooltip: 'tt', i18nAriaLabel: 'aria', i18nPlaceholder: 'ph' },
          setAttribute: () => {},
          textContent: '',
          title: ''
        }];
      }
    };

    let queryCount = 0;

    let t = (key) => key;

    // The extracted initialization logic
    ${i18nCacheMatch[0]}

    // The extracted function
    ${applyTranslationsMatch[0]}

    // It should throw if cache is not properly defined before the function.
    if (!i18nCache) throw new Error("Cache should be initialized");

    const initialQueryCount = queryCount;
    if (initialQueryCount === 0) throw new Error("Queries should have happened during initialization");

    // Now call it
    applyTranslations('en');

    if (queryCount > initialQueryCount) throw new Error("querySelectorAll should not be called inside applyTranslations");
    if (document.documentElement.lang !== 'en') throw new Error("Language should be applied");

    "SUCCESS";
  `;

  const result = (new Function(testExecution + ' return "SUCCESS";'))();
  assert.equal(result, "SUCCESS");
});
