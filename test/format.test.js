import assert from 'node:assert/strict';
import test from 'node:test';

import {
  clampPercent,
  formatClockTime,
  formatCurrency,
  formatDaysRemaining,
  formatPercent,
  formatQuotaPercent,
  formatRelativeUpdated,
  formatTimeRemaining,
  formatTokens,
  formatWeekdayClock,
  hydrateSlot,
  levelForPercent,
  quotaDisplayValue
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

test('clampPercent rounds and clamps to the 0-100 range', () => {
  assert.equal(clampPercent(54.4), 54);
  assert.equal(clampPercent(54.5), 55);
  assert.equal(clampPercent(-3), 0);
  assert.equal(clampPercent(120), 100);
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

test('formatCurrency renders USD with two fraction digits', () => {
  assert.equal(formatCurrency(0), '$0.00');
  assert.equal(formatCurrency(1.5), '$1.50');
  assert.equal(formatCurrency(1234.5), '$1,234.50');
});

test('formatCurrency returns -- for null and NaN', () => {
  assert.equal(formatCurrency(null), '--');
  assert.equal(formatCurrency(undefined), '--');
  assert.equal(formatCurrency(NaN), '--');
});

test('formatPercent rounds to a whole percent', () => {
  assert.equal(formatPercent(0), '0%');
  assert.equal(formatPercent(54.4), '54%');
  assert.equal(formatPercent(54.6), '55%');
});

test('formatPercent returns -- for null and NaN', () => {
  assert.equal(formatPercent(null), '--');
  assert.equal(formatPercent(NaN), '--');
});

test('formatTokens returns null for zero and nullish input', () => {
  assert.equal(formatTokens(0), null);
  assert.equal(formatTokens(null), null);
  assert.equal(formatTokens(undefined), null);
  assert.equal(formatTokens(NaN), null);
});

test('formatTokens scales into K and M with a unit suffix', () => {
  assert.equal(formatTokens(999), '999 tokens');
  assert.equal(formatTokens(1500), '1.5K tokens');
  assert.equal(formatTokens(2_000_000), '2.0M tokens');
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

test('hydrateSlot returns null for falsy input', () => {
  assert.equal(hydrateSlot(null), null);
  assert.equal(hydrateSlot(undefined), null);
});

test('hydrateSlot converts resetsAt to Date object', () => {
  const isoDate = '2026-05-04T12:00:00Z';
  const slot = { percent: 42, resetsAt: isoDate };
  const hydrated = hydrateSlot(slot);
  assert.equal(hydrated.percent, 42);
  assert.ok(hydrated.resetsAt instanceof Date);
  assert.equal(hydrated.resetsAt.toISOString(), new Date(isoDate).toISOString());
});

test('hydrateSlot handles missing resetsAt', () => {
  const slot = { percent: 10 };
  const hydrated = hydrateSlot(slot);
  assert.equal(hydrated.percent, 10);
  assert.equal(hydrated.resetsAt, null);
});

test('quotaDisplayValue returns used percent unchanged in used mode', () => {
  assert.equal(quotaDisplayValue(75, 'used'), 75);
});

test('quotaDisplayValue inverts in remaining mode', () => {
  assert.equal(quotaDisplayValue(75, 'remaining'), 25);
  assert.equal(quotaDisplayValue(0, 'remaining'), 100);
  assert.equal(quotaDisplayValue(100, 'remaining'), 0);
});

test('formatQuotaPercent appends a suffix when given one', () => {
  assert.equal(formatQuotaPercent(75, 'used', 'used'), '75% used');
  assert.equal(formatQuotaPercent(75, 'remaining', 'left'), '25% left');
});

test('formatQuotaPercent omits the space when suffix is empty', () => {
  assert.equal(formatQuotaPercent(75, 'used'), '75%');
});

test('formatQuotaPercent returns -- for null', () => {
  assert.equal(formatQuotaPercent(null, 'used', 'used'), '--');
});
