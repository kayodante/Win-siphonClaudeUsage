import assert from 'node:assert/strict';
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
