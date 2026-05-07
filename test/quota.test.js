import assert from 'node:assert/strict';
import test from 'node:test';

import { parseUsageResponse, QuotaError, QuotaService } from '../src/main/quotaService.js';

test('parseUsageResponse maps API buckets to display quota slots', () => {
  const quota = parseUsageResponse({
    five_hour: {
      utilization: 100,
      resets_at: '2026-04-27T18:30:00.000Z'
    },
    seven_day: {
      utilization: 42.5,
      resets_at: '2026-04-30T12:00:00Z'
    }
  });

  assert.equal(quota.session.percent, 100);
  assert.equal(quota.session.resetsAt.toISOString(), '2026-04-27T18:30:00.000Z');
  assert.equal(quota.weeklyAll.percent, 42.5);
});

test('parseUsageResponse returns nulls when buckets are missing', () => {
  const quota = parseUsageResponse({});
  assert.equal(quota.session, null);
  assert.equal(quota.weeklyAll, null);
});

test('parseUsageResponse tolerates null payload', () => {
  const quota = parseUsageResponse(null);
  assert.equal(quota.session, null);
  assert.equal(quota.weeklyAll, null);
});

test('QuotaService.fetchQuota maps malformed JSON to QuotaError("server")', async () => {
  const service = new QuotaService({
    tokenStore: {
      load: async () => ({
        accessToken: 'tok',
        refreshToken: null,
        expiresAt: new Date(Date.now() + 60_000).toISOString()
      }),
      clear: async () => {},
      save: async () => {}
    },
    fetchImpl: async () => ({
      status: 200,
      headers: { get: () => null },
      json: async () => {
        throw new SyntaxError('Unexpected token');
      }
    })
  });

  await assert.rejects(() => service.fetchQuota(), error => {
    assert.ok(error instanceof QuotaError);
    assert.equal(error.code, 'server');
    return true;
  });
});

test('QuotaService.fetchQuota maps abort to QuotaError("server") timeout', async () => {
  const service = new QuotaService({
    tokenStore: {
      load: async () => ({
        accessToken: 'tok',
        refreshToken: null,
        expiresAt: new Date(Date.now() + 60_000).toISOString()
      }),
      clear: async () => {},
      save: async () => {}
    },
    fetchImpl: async (_url, options) =>
      new Promise((_resolve, reject) => {
        options.signal.addEventListener('abort', () => {
          const error = new Error('aborted');
          error.name = 'AbortError';
          reject(error);
        });
      }),
    timeoutMs: 20
  });

  await assert.rejects(() => service.fetchQuota(), error => {
    assert.ok(error instanceof QuotaError);
    assert.equal(error.code, 'server');
    assert.match(error.message, /timed out/i);
    return true;
  });
});

test('QuotaService.fetchQuota maps 401 to QuotaError("unauthorized") and clears store', async () => {
  let cleared = false;
  const service = new QuotaService({
    tokenStore: {
      load: async () => ({
        accessToken: 'tok',
        refreshToken: null,
        expiresAt: new Date(Date.now() + 60_000).toISOString()
      }),
      clear: async () => {
        cleared = true;
      },
      save: async () => {}
    },
    fetchImpl: async () => ({
      status: 401,
      headers: { get: () => null }
    })
  });

  await assert.rejects(() => service.fetchQuota(), error => {
    assert.ok(error instanceof QuotaError);
    assert.equal(error.code, 'unauthorized');
    return true;
  });
  assert.equal(cleared, true);
});

test('QuotaService.fetchQuota maps 429 to QuotaError("rate_limited") with retryAfter', async () => {
  const service = new QuotaService({
    tokenStore: {
      load: async () => ({
        accessToken: 'tok',
        refreshToken: null,
        expiresAt: new Date(Date.now() + 60_000).toISOString()
      }),
      clear: async () => {},
      save: async () => {}
    },
    fetchImpl: async () => ({
      status: 429,
      headers: {
        get: name => (name === 'retry-after' ? '42' : null)
      }
    })
  });

  await assert.rejects(() => service.fetchQuota(), error => {
    assert.ok(error instanceof QuotaError);
    assert.equal(error.code, 'rate_limited');
    assert.equal(error.retryAfter, 42);
    return true;
  });
});
