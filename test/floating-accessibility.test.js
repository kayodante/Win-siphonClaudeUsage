import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import { SUPPORTED_LANGUAGES, t } from '../src/shared/i18n.js';
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


test('mini widget labels both quotas and reuses every tray status in used and remaining modes', async () => {
  const nodes = new Map();
  const node = () => ({
    dataset: {}, attributes: {}, textContent: '',
    addEventListener() {}, replaceChildren() {}, appendChild() {},
    setAttribute(name, value) { this.attributes[name] = value; }
  });
  const previousDocument = globalThis.document;
  const previousWindow = globalThis.window;
  let render;
  const state = {
    preferences: { floating: { style: 'mini' }, display: { quotaMode: 'used' }, language: 'en' },
    quota: { session: { percent: 25 }, weeklyAll: { percent: 75 } }
  };
  globalThis.document = {
    body: node(), documentElement: node(), createElement: node,
    querySelector(selector) {
      if (!nodes.has(selector)) nodes.set(selector, node());
      return nodes.get(selector);
    }
  };
  globalThis.window = { siphon: {
    onState(callback) { render = callback; },
    async getState() { return state; }
  } };

  try {
    await import('../src/renderer/floating.js');
    assert.equal(typeof render, 'function');
    for (const id of ['floatingMiniSessionGroup', 'floatingMiniWeeklyGroup']) {
      assert.match(floatingHtml, new RegExp('<span id="' + id + '"[^>]*role="group"[^>]*aria-label="[^" ]+[^\"]*"'));
    }
    assert.match(floatingHtml, /<svg class="floating-mini-weekly-icon"[^>]*aria-hidden="true"/);
    const levels = [[0, 'ok'], [50, 'warn'], [75, 'high'], [95, 'critical']];
    for (const lang of SUPPORTED_LANGUAGES) {
      state.preferences.language = lang;
      for (const mode of ['used', 'remaining']) {
        state.preferences.display.quotaMode = mode;
        const suffix = t('quota.suffix.' + mode, lang);
        for (const [session, sessionLevel] of levels) {
          for (const [weekly, weeklyLevel] of levels) {
            state.quota = { session: { percent: session }, weeklyAll: { percent: weekly } };
            render(state);
            const icon = '../assets/tray-icon/tray-' + sessionLevel + '-' + weeklyLevel;
            assert.equal(nodes.get('#floatingMiniLogo').src, icon + '.png');
            assert.equal(nodes.get('#floatingMiniLogo').srcset, icon + '@2x.png 2x');
            assert.ok(existsSync(new URL('../src/' + icon.slice(3) + '.png', import.meta.url)));
            assert.ok(existsSync(new URL('../src/' + icon.slice(3) + '@2x.png', import.meta.url)));
            assert.equal(nodes.get('#floatingMiniPercent').textContent, (mode === 'remaining' ? 100 - session : session) + '%');
            assert.equal(nodes.get('#floatingMiniWeekly').textContent, (mode === 'remaining' ? 100 - weekly : weekly) + '%');
            for (const [id, key, percent] of [
              ['#floatingMiniSessionGroup', 'home.session', session],
              ['#floatingMiniWeeklyGroup', 'home.weekly', weekly]
            ]) {
              const label = t(key, lang);
              assert.equal(nodes.get(id).attributes['aria-label'], label + ' (' + suffix + ')');
              assert.equal(nodes.get(id).title, label + ': ' + (mode === 'remaining' ? 100 - percent : percent) + '% ' + suffix);
            }
            assert.equal(nodes.get('#floatingLogo').src, '../assets/f-icon/f-icon-' + sessionLevel + '.png');
          }
        }
      }
    }
    state.preferences.display.quotaMode = 'remaining';
    for (const lang of SUPPORTED_LANGUAGES) {
      state.preferences.language = lang;
      for (const [percent, level] of levels) {
        state.quota = { session: { percent }, weeklyAll: { percent: 95 } };
        for (const showWeekly of [false, true, false]) {
          state.preferences.floating.showWeekly = showWeekly;
          render(state);
          assert.equal(nodes.get('#floatingMiniWeeklyGroup').hidden, !showWeekly);
          const icon = showWeekly ? '../assets/tray-icon/tray-' + level + '-critical' : '../assets/f-icon/f-icon-' + level;
          assert.equal(nodes.get('#floatingMiniLogo').src, icon + '.png');
          assert.equal(nodes.get('#floatingMiniLogo').srcset, icon + '@2x.png 2x');
          assert.ok(existsSync(new URL('../src/' + icon.slice(3) + '@2x.png', import.meta.url)));
          if (!showWeekly) assert.equal(nodes.get('#floatingMiniLogo').title, nodes.get('#floatingMiniSessionGroup').title);
          assert.equal(nodes.get('#floatingWeeklyValue').textContent, '5% ' + t('quota.suffix.remaining', lang));
        }
      }
    }
    for (const quota of [{}, { session: { percent: 25 } }, { weeklyAll: { percent: 75 } }]) {
      state.quota = quota;
      render(state);
      if (!quota.session) assert.equal(nodes.get('#floatingMiniPercent').textContent, '--');
      if (!quota.weeklyAll) assert.equal(nodes.get('#floatingMiniWeekly').textContent, '--');
    }
  } finally {
    globalThis.document = previousDocument;
    globalThis.window = previousWindow;
  }
});
