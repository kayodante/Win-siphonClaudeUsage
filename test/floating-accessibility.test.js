import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const floatingHtml = readFileSync(new URL('../src/renderer/floating.html', import.meta.url), 'utf8');
const floatingJs = readFileSync(new URL('../src/renderer/floating.js', import.meta.url), 'utf8');

test('floating widget exposes an accessible disclosure relationship', () => {
  const expandButton = floatingHtml.match(/<button id="floatingExpandButton"[^>]*>/)?.[0];
  assert.ok(expandButton, 'missing floating widget expand button');
  assert.match(expandButton, /aria-expanded="false"/);
  assert.match(expandButton, /aria-controls="floatingExpandedPanel"/);
  assert.match(floatingHtml, /<section id="floatingExpandedPanel"[^>]*\shidden>/);
  assert.match(floatingJs, /elements\.expandButton\.setAttribute\('aria-expanded', String\(currentExpanded\)\)/);
  assert.match(floatingJs, /elements\.expandedPanel\.hidden = !currentExpanded/);
});

test('floating widget synchronizes the document language during every render', () => {
  const renderBody = floatingJs.match(/function render\(state\) \{([\s\S]*?)\n\}/)?.[1];
  assert.ok(renderBody, 'missing floating widget render function');
  assert.match(renderBody, /currentLang = languageOf\(state\)/);
  assert.match(renderBody, /document\.documentElement\.lang = currentLang/);
  assert.match(floatingJs, /window\.siphon\.onState\(render\)/);
  assert.match(floatingJs, /render\(await window\.siphon\.getState\(\)\)/);
});
