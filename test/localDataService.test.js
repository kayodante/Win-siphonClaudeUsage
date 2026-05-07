import assert from 'node:assert/strict';
import test from 'node:test';

import { summarizeUsage } from '../src/main/localDataService.js';

test('summarizeUsage aggregates today and month cost from Claude cache files', () => {
  const cache = {
    days: {
      '2026-04-01': {
        'claude-sonnet-4-5-20250929': {
          input: 1000,
          output: 2000,
          cache_read: 3000,
          cache_write: 4000
        }
      },
      '2026-04-27': {
        'claude-sonnet-4-5-20250929': {
          input: 2000,
          output: 1000,
          cache_read: 0,
          cache_write: 1000
        }
      }
    }
  };
  const pricing = {
    models: {
      'claude-sonnet-4-5': {
        input: 3,
        output: 15,
        cache_read: 0.3,
        cache_write: 3.75
      }
    }
  };

  const summary = summarizeUsage(cache, pricing, new Date('2026-04-27T10:00:00Z'));

  assert.equal(summary.todayStats.inputTokens, 2000);
  assert.equal(summary.todayStats.outputTokens, 1000);
  assert.equal(summary.todayStats.cacheWriteTokens, 1000);
  assert.equal(summary.todayStats.cost, 0.02475);
  assert.equal(summary.monthStats.inputTokens, 3000);
  assert.equal(summary.monthStats.outputTokens, 3000);
  assert.equal(summary.monthStats.cacheReadTokens, 3000);
  assert.equal(summary.monthStats.cacheWriteTokens, 5000);
  assert.equal(summary.monthStats.cost, 0.07365);
});

test('summarizeUsage handles missing cache (ENOENT path) without throwing', () => {
  const summary = summarizeUsage(null, null, new Date('2026-04-27T10:00:00Z'));
  assert.equal(summary.todayStats.isEmpty, true);
  assert.equal(summary.todayStats.cost, 0);
  assert.equal(summary.monthStats.cost, 0);
});

test('summarizeUsage handles missing pricing entry by counting tokens with cost 0', () => {
  const cache = {
    days: {
      '2026-04-27': {
        'claude-mystery-model-20260101': {
          input: 1000,
          output: 500,
          cacheRead: 0,
          cacheWrite: 0
        }
      }
    }
  };
  const summary = summarizeUsage(cache, { models: {} }, new Date('2026-04-27T10:00:00Z'));
  assert.equal(summary.todayStats.inputTokens, 1000);
  assert.equal(summary.todayStats.outputTokens, 500);
  assert.equal(summary.todayStats.cost, 0);
});

