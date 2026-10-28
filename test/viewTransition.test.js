import assert from 'node:assert/strict';
import test from 'node:test';

import { createViewSwitcher } from '../src/renderer/viewTransition.js';

function fakeView(name, hidden = true) {
  return { name, hidden, style: {}, getBoundingClientRect: () => ({ width: 352 }) };
}

// Timers and frames that run only when the test says so.
function fakeClock() {
  let next = 1;
  const timers = new Map();
  const frames = [];
  return {
    setTimer: (fn) => { const id = next++; timers.set(id, fn); return id; },
    clearTimer: (id) => timers.delete(id),
    nextFrame: (fn) => frames.push(fn),
    runAll() {
      while (frames.length || timers.size) {
        while (frames.length) frames.shift()();
        for (const [id, fn] of [...timers]) { timers.delete(id); fn(); }
      }
    }
  };
}

function setup() {
  const claude = fakeView('claude', false);
  const codex = fakeView('codex');
  const onboard = fakeView('onboard');
  const settings = fakeView('settings');
  const views = [onboard, claude, codex, settings];
  const clock = fakeClock();
  const show = createViewSwitcher(views, clock);
  return { views, clock, show, claude, codex, settings };
}

test('a zero-duration crossfade settles synchronously without timers or animation frames', () => {
  const outgoing = fakeView('settings', false);
  const incoming = fakeView('provider');
  let visible = 0;
  let settled = 0;
  const show = createViewSwitcher([outgoing, incoming], {
    fadeMs: () => 0,
    setTimer: () => assert.fail('zero-duration transition queued a timer'),
    nextFrame: () => assert.fail('zero-duration transition queued a frame')
  });
  show(incoming, { onVisible: () => { visible++; }, onSettled: () => { settled++; } });
  assert.equal(outgoing.hidden, true);
  assert.equal(incoming.hidden, false);
  assert.equal(visible, 1);
  assert.equal(settled, 1);
});

function assertOnlyVisible(views, expected) {
  const visible = views.filter(v => !v.hidden).map(v => v.name);
  assert.deepEqual(visible, [expected.name]);
  for (const view of views) {
    for (const [prop, value] of Object.entries(view.style)) {
      assert.equal(value, '', `${view.name}.style.${prop} left as ${value}`);
    }
  }
}

test('A → B → A before the fade ends leaves A on screen', () => {
  const { views, clock, show, claude, codex } = setup();
  show(codex);
  show(claude);
  clock.runAll();
  assertOnlyVisible(views, claude);
});

test('A → B → settings before the fade ends leaves settings on screen', () => {
  const { views, clock, show, codex, settings } = setup();
  show(codex);
  show(settings);
  clock.runAll();
  assertOnlyVisible(views, settings);
});

test('an uninterrupted switch settles on the new view', () => {
  const { views, clock, show, codex } = setup();
  show(codex);
  assert.equal(codex.hidden, false, 'incoming is in the layout during the fade');
  clock.runAll();
  assertOnlyVisible(views, codex);
});

test('each switch settles exactly once, and the cancelled one never does', () => {
  const { clock, show, claude, codex } = setup();
  const settled = [];
  show(codex, { onSettled: () => settled.push('codex') });
  show(claude, { onSettled: () => settled.push('claude') });
  clock.runAll();
  assert.deepEqual(settled, ['claude']);
});
