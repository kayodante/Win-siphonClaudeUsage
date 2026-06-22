import assert from 'node:assert/strict';
import test from 'node:test';

import { isPeakHour, peakHoursLocalRange } from '../src/shared/peakHours.js';

// Peak window: weekdays, 5–11 AM Pacific. 2026-05-04 is a Monday; PT is on PDT
// (UTC-7) in May, so 5 AM PT = 12:00 UTC and 11 AM PT = 18:00 UTC.
test('isPeakHour is true at the start of the Pacific peak window on a weekday', () => {
  assert.equal(isPeakHour(new Date('2026-05-04T12:00:00.000Z')), true);
});

test('isPeakHour is false just before the Pacific peak window', () => {
  assert.equal(isPeakHour(new Date('2026-05-04T11:59:00.000Z')), false);
});

test('isPeakHour is false at the end boundary of the Pacific peak window', () => {
  assert.equal(isPeakHour(new Date('2026-05-04T18:00:00.000Z')), false);
});

test('isPeakHour is false on weekends even within the hour window', () => {
  // 2026-05-09 Sat, 2026-05-10 Sun — both at 15:00 UTC (8 AM PT).
  assert.equal(isPeakHour(new Date('2026-05-09T15:00:00.000Z')), false);
  assert.equal(isPeakHour(new Date('2026-05-10T15:00:00.000Z')), false);
});

test('isPeakHour tracks DST: 5 AM PST in January is 13:00 UTC', () => {
  // 2026-01-05 Monday. PT is on PST (UTC-8) in January.
  assert.equal(isPeakHour(new Date('2026-01-05T13:00:00.000Z')), true);
  assert.equal(isPeakHour(new Date('2026-01-05T12:59:00.000Z')), false);
});

test('peakHoursLocalRange returns two distinct formatted clock labels', () => {
  // Labels are rendered in the host locale/zone, so assert shape rather than
  // exact strings: both are non-empty time labels and the 6-hour window means
  // start and end never coincide.
  const { start, end } = peakHoursLocalRange(new Date('2026-05-04T16:00:00.000Z'), 'en-US');
  assert.match(start, /\d/);
  assert.match(end, /\d/);
  assert.notEqual(start, end);
});
