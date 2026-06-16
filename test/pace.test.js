import assert from 'node:assert/strict';
import test from 'node:test';

import {
  SESSION_WINDOW_MS,
  WEEKLY_WINDOW_MS,
  buildUsagePace
} from '../src/shared/pace.js';

test('buildUsagePace returns no_data when quota data is missing', () => {
  assert.equal(buildUsagePace({ slot: null }).status, 'no_data');
  assert.equal(buildUsagePace({ slot: { percent: 24 } }).status, 'no_data');
});

test('buildUsagePace classifies usage within elapsed time as on_track', () => {
  const pace = buildUsagePace({
    slot: {
      percent: 38,
      resetsAt: new Date('2026-05-04T17:00:00.000Z')
    },
    now: new Date('2026-05-04T14:00:00.000Z'),
    windowMs: SESSION_WINDOW_MS
  });

  assert.equal(pace.status, 'on_track');
  assert.equal(pace.elapsedPercent, 40);
});

test('buildUsagePace classifies usage above elapsed time as high_pace', () => {
  const pace = buildUsagePace({
    slot: {
      percent: 55,
      resetsAt: new Date('2026-05-04T17:00:00.000Z')
    },
    now: new Date('2026-05-04T14:00:00.000Z'),
    windowMs: SESSION_WINDOW_MS
  });

  assert.equal(pace.status, 'high_pace');
  assert.equal(pace.elapsedPercent, 40);
});

test('buildUsagePace classifies projected early depletion as likely_out', () => {
  const pace = buildUsagePace({
    slot: {
      percent: 85,
      resetsAt: new Date('2026-05-04T17:00:00.000Z')
    },
    now: new Date('2026-05-04T14:00:00.000Z'),
    windowMs: SESSION_WINDOW_MS
  });

  assert.equal(pace.status, 'likely_out');
  assert.equal(pace.projectedDepletionAt.toISOString(), '2026-05-04T14:21:10.588Z');
});

test('buildUsagePace uses the 5-hour session reset window', () => {
  const pace = buildUsagePace({
    slot: {
      percent: 50,
      resetsAt: new Date('2026-05-04T17:00:00.000Z')
    },
    now: new Date('2026-05-04T14:30:00.000Z'),
    windowMs: SESSION_WINDOW_MS
  });

  assert.equal(pace.windowStart.toISOString(), '2026-05-04T12:00:00.000Z');
  assert.equal(pace.elapsedPercent, 50);
});

test('buildUsagePace uses the 7-day weekly reset window', () => {
  const pace = buildUsagePace({
    slot: {
      percent: 25,
      resetsAt: new Date('2026-05-08T00:00:00.000Z')
    },
    now: new Date('2026-05-02T18:00:00.000Z'),
    windowMs: WEEKLY_WINDOW_MS
  });

  assert.equal(pace.windowStart.toISOString(), '2026-05-01T00:00:00.000Z');
  assert.equal(pace.elapsedPercent, 25);
  assert.equal(pace.status, 'on_track');
});
