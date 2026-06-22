import assert from 'node:assert/strict';
import test from 'node:test';

import { isPeakHour } from '../src/shared/peakHours.js';

test('isPeakHour is true at the start of the UTC peak window on a weekday', () => {
  assert.equal(isPeakHour(new Date('2026-05-04T13:00:00.000Z')), true);
});

test('isPeakHour is false just before the UTC peak window', () => {
  assert.equal(isPeakHour(new Date('2026-05-04T12:59:00.000Z')), false);
});

test('isPeakHour is false at the end boundary of the UTC peak window', () => {
  assert.equal(isPeakHour(new Date('2026-05-04T22:00:00.000Z')), false);
});

test('isPeakHour is false on weekends even within the hour window', () => {
  assert.equal(isPeakHour(new Date('2026-05-09T15:00:00.000Z')), false);
  assert.equal(isPeakHour(new Date('2026-05-10T15:00:00.000Z')), false);
});
