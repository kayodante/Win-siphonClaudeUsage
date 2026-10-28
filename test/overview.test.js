import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync } from 'node:fs';
import { overviewProviders, resolveNavigation, resolveProvider } from '../src/renderer/viewState.js';

test('overview is available without installing another provider', () => {
  assert.equal(resolveProvider({}, 'overview'), 'overview');
  assert.deepEqual(overviewProviders({}), [
    { id: 'claude', sections: [{ id: 'claude', session: null, weekly: null }] }
  ]);
});

test('overview retains source windows and all Antigravity groups without inventing readings', () => {
  const session = { percent: 0, resetsAt: null };
  const weekly = { percent: 99, resetsAt: '2026-10-28T12:00:00Z' };
  const codex = { status: 'error', sections: [{ id: 'codex', session: { percent: null, rolledOver: true } }] };
  const antigravity = { status: 'closed', sections: [
    { id: 'gemini', session, weekly },
    { id: 'thirdParty', blocked: true, session, weekly },
    { id: 'argon', weekly }
  ] };
  const state = { quota: { session, weeklyAll: weekly }, codex, antigravity };
  const before = structuredClone(state);
  const providers = overviewProviders(state);
  assert.deepEqual(providers.map(p => p.id), ['claude', 'codex', 'antigravity']);
  assert.equal(providers[0].sections[0].session, session);
  assert.equal(providers[0].sections[0].weekly, weekly);
  assert.equal(providers[1].sections, codex.sections);
  assert.equal(providers[2].sections, antigravity.sections);
  assert.equal(providers[2].sections[2].session, undefined);
  assert.deepEqual(state, before);
  assert.deepEqual(overviewProviders({ codex: { sections: [] } })[1].sections, []);
});

test('Settings selection follows the visible view and Back restores the selected dashboard', () => {
  const state = { isSignedIn: true, codex: { sections: [] } };
  for (const provider of ['overview', 'claude', 'codex']) {
    assert.equal(resolveNavigation(state, 'main', provider), provider);
    assert.equal(resolveNavigation(state, 'settings', provider), 'settings');
    assert.equal(resolveNavigation(state, 'main', provider), provider);
  }
  assert.equal(resolveNavigation({ isSignedIn: false }, 'settings', 'overview'), null);
  assert.equal(resolveNavigation({ isSignedIn: true }, 'main', 'codex'), 'claude');
});

test('a visible Overview error uses its own alert region without a duplicate announcement', () => {
  const source = readFileSync(new URL('../src/renderer/renderer.js', import.meta.url), 'utf8');
  const definition = source.match(/function setErrorText\(message\) \{[\s\S]*?\n\}/)[0];
  const elements = { errorText: { hidden: false, textContent: '' }, mainView: { hidden: true }, assertiveAnnouncer: {} };
  const announcements = [];
  const setErrorText = new Function('elements', 'announce', 'lastAnnouncements', `${definition}; return setErrorText;`)(
    elements, (_element, message) => announcements.push(message), new WeakMap()
  );
  setErrorText('Network unavailable');
  assert.equal(elements.errorText.textContent, 'Network unavailable');
  assert.deepEqual(announcements, []);
  elements.errorText.hidden = true;
  setErrorText('Authentication failed');
  assert.deepEqual(announcements, ['Authentication failed']);
});
