import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

import { resolveView } from '../src/renderer/viewState.js';

test('signed out state always resolves to onboarding', () => {
  assert.equal(resolveView({ isSignedIn: false }, 'main'), 'onboard');
  assert.equal(resolveView({ isSignedIn: false, awaitingCode: true }, 'settings'), 'onboard');
});

test('signed in state respects main and settings views', () => {
  assert.equal(resolveView({ isSignedIn: true }, 'main'), 'main');
  assert.equal(resolveView({ isSignedIn: true }, 'settings'), 'settings');
});

test('signed in state defaults unknown views to main', () => {
  assert.equal(resolveView({ isSignedIn: true }, 'onboard'), 'main');
  assert.equal(resolveView({ isSignedIn: true }, undefined), 'main');
});

// `resolveView` reads `isSignedIn` and nothing else, so asserting that a
// signed-out state with `awaitingBrowser` resolves to 'onboard' proves nothing
// the first test does not already prove — it would keep passing if the flag
// were deleted. The falsifiable half of the loopback flow lives here instead:
// sign-in completes while the browser leg is still notionally in progress, and
// a mid-flow flag must never be allowed to pin a signed-in user to onboarding.
test('a signed-in state is not dragged back to onboarding by mid-flow flags', () => {
  assert.equal(resolveView({ isSignedIn: true, awaitingBrowser: true }, 'main'), 'main');
  assert.equal(resolveView({ isSignedIn: true, awaitingBrowser: true }, 'settings'), 'settings');
  assert.equal(resolveView({ isSignedIn: true, awaitingCode: true }, 'main'), 'main');
});

test('the waiting screen tears down its timers whenever the wait ends', () => {
  const renderer = readFileSync(new URL('../src/renderer/renderer.js', import.meta.url), 'utf8');
  // One teardown function, called from the single not-waiting branch — a
  // timer cleared in only some exit paths leaks a 1s interval for the rest
  // of the run and keeps rewriting a hidden element.
  assert.match(renderer, /function stopAuthWaitTimers\(\)/);
  assert.match(renderer, /clearInterval\(authCountdownTimer\)/);
  assert.match(renderer, /clearTimeout\(authHatchTimer\)/);
});

test('the escape hatch and the deadline use the agreed constants', () => {
  const renderer = readFileSync(new URL('../src/renderer/renderer.js', import.meta.url), 'utf8');
  assert.match(renderer, /const AUTH_DEADLINE_MS = 150_000;/);
  assert.match(renderer, /const AUTH_HATCH_MS = 60_000;/);
});
