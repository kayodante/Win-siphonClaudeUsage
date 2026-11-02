import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

import {
  alertLevel,
  detectThresholdCrossings,
  extractChannelPercents,
  measuredPercent,
  providerSessionPeak,
  resolveProvider,
  resolveView
} from '../src/renderer/viewState.js';

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

test('a provider tab resolves only while that provider exists', () => {
  const codex = { status: 'live', updatedAt: null, sections: [] };
  assert.equal(resolveProvider({ codex }, 'codex'), 'codex');
  assert.equal(resolveProvider({ codex: null }, 'codex'), 'claude');
  assert.equal(resolveProvider({ codex }, 'antigravity'), 'claude');
  assert.equal(resolveProvider({ codex }, 'settings'), 'claude');
  assert.equal(resolveProvider(null, 'codex'), 'claude');
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


test('extractChannelPercents captures session percentages across all providers', () => {
  const state = {
    quota: { session: { percent: 45.2 } },
    codex: {
      sections: [
        { id: 'codex', session: { percent: 72.8, rolledOver: false } }
      ]
    },
    antigravity: {
      sections: [
        { id: 'gemini', session: { percent: 91.0, rolledOver: false } },
        { id: 'thirdParty', session: { percent: 100.0, rolledOver: false } },
        { id: 'argon', weekly: { percent: 50.0, rolledOver: false } }
      ]
    }
  };

  const map = extractChannelPercents(state);
  assert.equal(map.get('claude'), 45);
  assert.equal(map.get('codex:codex'), 73);
  assert.equal(map.get('antigravity:gemini'), 91);
  assert.equal(map.get('antigravity:thirdParty'), 100);
  assert.equal(map.has('antigravity:argon'), false);
});

test('extractChannelPercents maps rolled-over windows to 0%', () => {
  const state = {
    codex: {
      sections: [
        { id: 'codex', session: { percent: null, rolledOver: true } }
      ]
    }
  };

  const map = extractChannelPercents(state);
  assert.equal(map.get('codex:codex'), 0);
});

test('detectThresholdCrossings reports alerts per channel crossing', () => {
  const prev = new Map([
    ['claude', 60],
    ['codex:codex', 88],
    ['antigravity:gemini', 95]
  ]);
  const current = new Map([
    ['claude', 72],
    ['codex:codex', 92],
    ['antigravity:gemini', 100]
  ]);

  // Both limit and expire sounds enabled -> 100% takes precedence
  const res1 = detectThresholdCrossings(prev, current, { expireSound: true, limitSound: true });
  assert.equal(res1.playFull, true);

  // Only limit sound enabled
  const res2 = detectThresholdCrossings(prev, current, { expireSound: false, limitSound: true });
  assert.equal(res2.playFull, false);
  assert.equal(res2.playLimit, true);

  // Sounds disabled
  const res3 = detectThresholdCrossings(prev, current, { expireSound: false, limitSound: false });
  assert.equal(res3.playFull, false);
  assert.equal(res3.playLimit, false);

  // No previous map (first render)
  const res4 = detectThresholdCrossings(null, current, { expireSound: true, limitSound: true });
  assert.equal(res4.playFull, false);
  assert.equal(res4.playLimit, false);
});

test('providerSessionPeak keeps Claude, skips rolled-over sessions, uses weekly only without a session', () => {
  assert.deepEqual(providerSessionPeak({ quota: { session: { percent: 45.2 } } }, 'claude'), { percent: 45, sectionId: null });
  assert.deepEqual(providerSessionPeak({}, 'claude'), { percent: 0, sectionId: null });
  assert.deepEqual(providerSessionPeak({}, 'codex'), { percent: 0, sectionId: null });
  const antigravity = { sections: [
    { id: 'gemini', session: { percent: 40 } },
    { id: 'thirdParty', session: { percent: null, rolledOver: true }, weekly: { percent: 99 } },
    { id: 'argon', weekly: { percent: 80 } }
  ] };
  assert.deepEqual(providerSessionPeak({ antigravity }, 'antigravity'), { percent: 80, sectionId: 'argon' });
  const tie = { sections: [{ id: 'a', session: { percent: 0 } }, { id: 'b', session: { percent: 0 } }] };
  assert.deepEqual(providerSessionPeak({ codex: tie }, 'codex'), { percent: 0, sectionId: 'a' });
});

test('alertLevel uses the 70% and 90% banner thresholds', () => {
  assert.equal(alertLevel(69), null);
  assert.equal(alertLevel(70), 'high');
  assert.equal(alertLevel(89), 'high');
  assert.equal(alertLevel(90), 'critical');
});

test('measuredPercent treats unknown and rolled-over windows as unmeasured', () => {
  assert.equal(measuredPercent(null), null);
  assert.equal(measuredPercent({ percent: null }), null);
  assert.equal(measuredPercent({ percent: 50, rolledOver: true }), null);
  assert.equal(measuredPercent({ percent: 0 }), 0);
  assert.equal(measuredPercent({ percent: 120 }), 100);
});
