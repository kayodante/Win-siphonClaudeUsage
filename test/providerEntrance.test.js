import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';
import test from 'node:test';
import { resolveView } from '../src/renderer/viewState.js';
import { formatPercent } from '../src/shared/format.js';
import { createViewSwitcher } from '../src/renderer/viewTransition.js';

const renderer = readFileSync(new URL('../src/renderer/renderer.js', import.meta.url), 'utf8');

function setup({ reduced = false } = {}) {
  const functions = ['renderActiveView', 'dashboardForProvider', 'playEntranceSequence', 'stopEntranceSequence', 'queueWindowEntrance', 'animateCountUp', 'cancelCountUp', 'setPercentValue', 'updateReading'];
  const code = functions.map(name => {
    const match = renderer.match(new RegExp(`function ${name}\\([^]*?\\n\\}`, 'm'));
    assert.ok(match, `missing ${name}`);
    return match[0];
  }).join('\n');
  const frames = new Map();
  const timers = new Map();
  let id = 0;
  let now = 0;
  const reading = (target, weekly = false) => ({
    dataset: { entryValue: String(target) }, textContent: String(target),
    classList: { contains: () => false }, closest: () => weekly ? {} : null
  });
  const view = () => ({ hidden: true, dataset: {}, style: {}, getBoundingClientRect: () => ({ width: 352 }), querySelectorAll() { return this.readings; }, readings: [reading(11), reading(2, true)] });
  const elements = {
    onboardView: view(), overviewView: view(), mainView: view(), providerView: view(), settingsView: view(),
    backButton: {}, settingsTitle: {}, providerHeading: {}, refreshButton: {}, errorText: {}, reauthButton: {}
  };
  const context = vm.createContext({
    elements, document: { body: { dataset: {}, offsetWidth: 352 }, hidden: false }, resolveView, formatPercent,
    performance: { now: () => now }, reducedMotion: () => reduced,
    requestAnimationFrame: callback => { frames.set(++id, callback); return id; },
    cancelAnimationFrame: key => frames.delete(key),
    setTimeout: callback => { timers.set(++id, callback); return id; }, clearTimeout: key => timers.delete(key),
    renderNavigation() {}, currentLanguage: () => 'en', t: () => 'Overview', renderSettings() {}, focusAfterViewChange() {},
    setCostValue: (element, value) => { element.textContent = String(value); },
    cubicEaseOut: t => 1 - (1 - t) ** 3,
    crossfadeTo(incoming, callbacks) {
      for (const key of ['onboardView', 'overviewView', 'mainView', 'providerView', 'settingsView']) elements[key].hidden = elements[key] !== incoming;
      callbacks.onVisible(); callbacks.onSettled();
    }
  });
  vm.runInContext(`
    let currentState = { isSignedIn: true };
    let requestedView = 'main', requestedProvider = 'overview', renderedView = null, renderedProvider = null;
    const PROVIDER_NAMES = { claude: 'Claude Code', codex: 'Codex', antigravity: 'Antigravity' };
    const ENTER_SEQUENCE_MS = 900, ENTER_DEDUPE_MS = 250;
    let enterSequenceTimer = null, windowEntranceFrame = null, lastEntranceAt = -Infinity;
    const animatingElements = new Map();
    function activeProvider() { return requestedProvider; }
    ${code}
    globalThis.navigate = (view, provider = requestedProvider) => { requestedView = view; requestedProvider = provider; renderActiveView(); };
    globalThis.activeCountUps = () => animatingElements.size;
  `, context);
  return { context, elements, frames, timers, advance: value => { now = value; } };
}

test('the first provider entry runs once; switching any provider settles readings without replay', () => {
  const { context, elements } = setup();
  context.navigate('main');
  assert.equal(elements.overviewView.dataset.entering, '1');
  assert.equal(context.activeCountUps(), 2);
  for (const provider of ['claude', 'codex', 'antigravity', 'overview']) {
    context.navigate('main', provider);
    assert.equal(context.activeCountUps(), 0);
    assert.ok(!Object.values(elements).some(el => el.dataset?.entering));
  }
  assert.equal(elements.overviewView.readings[0].textContent, '11%');
});

test('returning from Settings and reopening the window replay only the active dashboard', () => {
  const { context, elements, advance } = setup();
  context.navigate('main', 'codex');
  context.navigate('settings');
  assert.equal(context.activeCountUps(), 0);
  context.navigate('main', 'codex');
  assert.equal(elements.providerView.dataset.entering, '1');
  assert.equal(elements.mainView.dataset.entering, undefined);
  assert.equal(elements.overviewView.dataset.entering, undefined);
  advance(1000);
  context.playEntranceSequence();
  assert.equal(context.activeCountUps(), 2);
  context.playEntranceSequence();
  assert.equal(context.activeCountUps(), 2, 'duplicate native/visibility signals do not add count-ups');
});

test('leaving during entrance cancels stale timers and frames; a state refresh keeps the live count-up', () => {
  const { context, elements, frames, timers } = setup();
  context.navigate('main');
  const value = elements.overviewView.readings[0];
  context.updateReading(value, 11, context.setPercentValue);
  assert.equal(value.textContent, '0%');
  assert.equal(context.activeCountUps(), 2);
  context.navigate('settings');
  assert.equal(frames.size, 0);
  assert.equal(timers.size, 0);
  assert.equal(value.textContent, '11%');
  context.navigate('main');
  assert.equal(timers.size, 1);
});

test('reduced motion skips entrance and unknown readings never count up from zero', () => {
  const reduced = setup({ reduced: true });
  reduced.context.navigate('main');
  assert.equal(reduced.context.activeCountUps(), 0);
  assert.equal(reduced.elements.overviewView.dataset.entering, undefined);
  const normal = setup();
  normal.context.updateReading(normal.elements.overviewView.readings[0], null, normal.context.setPercentValue);
  normal.context.navigate('main');
  assert.equal(normal.elements.overviewView.readings[0].textContent, '--');
  assert.equal(normal.context.activeCountUps(), 1);
});

test('a state refresh during the real Settings return crossfade cannot consume entrance intent', () => {
  const { context, elements } = setup();
  const timers = new Map();
  let id = 0;
  context.crossfadeTo = createViewSwitcher(
    [elements.onboardView, elements.overviewView, elements.mainView, elements.providerView, elements.settingsView],
    { fadeMs: () => 150, setTimer: fn => { timers.set(++id, fn); return id; }, clearTimer: key => timers.delete(key), nextFrame: () => {} }
  );
  context.navigate('main', 'codex');
  context.navigate('settings');
  for (const timer of timers.values()) timer();
  timers.clear();
  context.navigate('main', 'codex');
  context.renderActiveView();
  assert.equal(elements.providerView.dataset.entering, '1');
  assert.equal(context.activeCountUps(), 2);
});

test('native show followed by toast provider selection animates the final provider once', () => {
  const { context, elements, frames } = setup();
  context.navigate('main', 'claude');
  context.queueWindowEntrance();
  context.navigate('main', 'codex');
  context.queueWindowEntrance();
  const [id, frame] = frames.entries().next().value;
  frames.delete(id);
  frame();
  assert.equal(elements.mainView.dataset.entering, undefined);
  assert.equal(elements.providerView.dataset.entering, '1');
  assert.equal(context.activeCountUps(), 2);
  context.queueWindowEntrance();
  const last = [...frames.entries()].at(-1);
  frames.delete(last[0]); last[1]();
  assert.equal(context.activeCountUps(), 2);
});
