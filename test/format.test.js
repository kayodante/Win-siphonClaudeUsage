import assert from 'node:assert/strict';
import test from 'node:test';

import {
  formatClockTime,
  formatDaysRemaining,
  formatRelativeUpdated,
  formatResetDistance,
  formatTimeRemaining,
  formatWeekdayClock,
  levelForPercent
} from '../src/shared/format.js';

test('formatRelativeUpdated keeps English as the default language', () => {
  assert.equal(
    formatRelativeUpdated(
      new Date('2026-05-04T12:03:00Z'),
      new Date('2026-05-04T12:05:00Z')
    ),
    'updated 2min ago'
  );
});

test('formatRelativeUpdated localizes Portuguese output', () => {
  assert.equal(
    formatRelativeUpdated(
      new Date('2026-05-04T12:03:00Z'),
      new Date('2026-05-04T12:05:00Z'),
      'pt-BR'
    ),
    'atualizado há 2min'
  );
});

test('formatResetDistance keeps English as the default language', () => {
  assert.equal(
    formatResetDistance(
      new Date('2026-05-04T14:35:00Z'),
      new Date('2026-05-04T12:00:00Z')
    ),
    '2 hr 35 min'
  );
});

test('formatResetDistance localizes Portuguese output', () => {
  assert.equal(
    formatResetDistance(
      new Date('2026-05-04T14:35:00Z'),
      new Date('2026-05-04T12:00:00Z'),
      'pt-BR'
    ),
    '2 h 35 min'
  );
});

test('levelForPercent maps 0-39 to ok', () => {
  assert.equal(levelForPercent(0), 'ok');
  assert.equal(levelForPercent(25), 'ok');
  assert.equal(levelForPercent(39), 'ok');
});

test('levelForPercent maps 40-69 to warn', () => {
  assert.equal(levelForPercent(40), 'warn');
  assert.equal(levelForPercent(50), 'warn');
  assert.equal(levelForPercent(69), 'warn');
});

test('levelForPercent maps 70-84 to high', () => {
  assert.equal(levelForPercent(70), 'high');
  assert.equal(levelForPercent(80), 'high');
  assert.equal(levelForPercent(84), 'high');
});

test('levelForPercent maps 85-100 to critical', () => {
  assert.equal(levelForPercent(85), 'critical');
  assert.equal(levelForPercent(95), 'critical');
  assert.equal(levelForPercent(100), 'critical');
});

test('formatClockTime pads to HH:MM', () => {
  const date = new Date('2026-05-04T17:42:00');
  assert.equal(formatClockTime(date), '17:42');
});

test('formatClockTime handles null gracefully', () => {
  assert.equal(formatClockTime(null), '--:--');
});

test('formatTimeRemaining produces "Xh Ymin restantes" in PT', () => {
  assert.equal(
    formatTimeRemaining(
      new Date('2026-05-04T14:14:00Z'),
      new Date('2026-05-04T12:00:00Z'),
      'pt-BR'
    ),
    '2h 14min restantes'
  );
});

test('formatTimeRemaining produces "Xh Ymin remaining" in EN', () => {
  assert.equal(
    formatTimeRemaining(
      new Date('2026-05-04T14:14:00Z'),
      new Date('2026-05-04T12:00:00Z')
    ),
    '2h 14min remaining'
  );
});

test('formatTimeRemaining drops hour when under one hour', () => {
  assert.equal(
    formatTimeRemaining(
      new Date('2026-05-04T12:30:00Z'),
      new Date('2026-05-04T12:00:00Z'),
      'pt-BR'
    ),
    '30min restantes'
  );
});

test('formatDaysRemaining pluralizes correctly in PT', () => {
  assert.equal(
    formatDaysRemaining(
      new Date('2026-05-08T00:00:00Z'),
      new Date('2026-05-04T00:00:00Z'),
      'pt-BR'
    ),
    'Reseta em 4 dias'
  );
});

test('formatDaysRemaining handles singular day in EN', () => {
  assert.equal(
    formatDaysRemaining(
      new Date('2026-05-05T00:00:00Z'),
      new Date('2026-05-04T01:00:00Z')
    ),
    'Resets in 1 day'
  );
});

test('formatWeekdayClock combines weekday and 24h time', () => {
  const date = new Date('2026-05-05T00:00:00');
  const result = formatWeekdayClock(date, 'pt-BR');
  assert.match(result, /^[A-ZÁ-Ú][a-zá-ú]+, \d{2}:\d{2}$/);
});
