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
