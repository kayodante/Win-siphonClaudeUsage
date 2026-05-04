import assert from 'node:assert/strict';
import test from 'node:test';

import { formatRelativeUpdated, formatResetDistance } from '../src/shared/format.js';

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
