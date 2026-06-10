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

test('QuotaService.fetchQuota maps TypeError to QuotaError("network")', async () => {
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
    fetchImpl: async () => {
      throw new TypeError('Failed to fetch');
    }
  });

  await assert.rejects(() => service.fetchQuota(), error => {
    assert.ok(error instanceof QuotaError);
    assert.equal(error.code, 'network');
    assert.equal(error.message, 'Network unavailable.');
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

test('QuotaService.fetchQuota maps 403 to QuotaError("scope_insufficient")', async () => {
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
      status: 403,
      headers: { get: () => null }
    })
  });

  await assert.rejects(() => service.fetchQuota(), error => {
    assert.ok(error instanceof QuotaError);
    assert.equal(error.code, 'scope_insufficient');
    return true;
  });
});
test('QuotaService.fetchQuota passes through generic fetch errors', async () => {
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
    fetchImpl: async () => {
      throw new Error('Generic error');
    }
  });

  await assert.rejects(() => service.fetchQuota(), error => {
    assert.equal(error.message, 'Generic error');
    return true;
  });
});

test('QuotaService.fetchQuota returns parsed usage response on 200 OK', async () => {
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
      json: async () => ({
        five_hour: { utilization: 50, resets_at: '2026-04-27T18:30:00.000Z' },
        seven_day: { utilization: 25, resets_at: '2026-04-30T12:00:00Z' }
      })
    })
  });

  const quota = await service.fetchQuota();
  assert.equal(quota.session.percent, 50);
  assert.equal(quota.weeklyAll.percent, 25);
});

test('QuotaService.fetchQuota maps 500 status to QuotaError("server")', async () => {
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
      status: 500,
      headers: { get: () => null }
    })
  });

  await assert.rejects(() => service.fetchQuota(), error => {
    assert.ok(error instanceof QuotaError);
    assert.equal(error.code, 'server');
    return true;
  });
});

test('QuotaService.fetchQuota throws "not_signed_in" if no credentials', async () => {
  const service = new QuotaService({
    tokenStore: {
      load: async () => null,
      clear: async () => {},
      save: async () => {}
    },
    fetchImpl: async () => ({})
  });

  await assert.rejects(() => service.fetchQuota(), error => {
    assert.ok(error instanceof QuotaError);
    assert.equal(error.code, 'not_signed_in');
    return true;
  });
});

test('QuotaService.fetchQuota throws "not_signed_in" if expired and no refresh token', async () => {
  const service = new QuotaService({
    tokenStore: {
      load: async () => ({
        accessToken: 'tok',
        refreshToken: null,
        expiresAt: new Date(Date.now() - 60_000).toISOString()
      }),
      clear: async () => {},
      save: async () => {}
    },
    fetchImpl: async () => ({})
  });

  await assert.rejects(() => service.fetchQuota(), error => {
    assert.ok(error instanceof QuotaError);
    assert.equal(error.code, 'not_signed_in');
    return true;
  });
});

test('QuotaService.fetchQuota refreshes token if expired but has refresh token', async () => {
  // Since we can't easily mock dynamic imports in older Node.js versions without test.mock.module,
  // we can mock the global fetch used by the imported OAuthService.
  const originalFetch = globalThis.fetch;
  try {
    globalThis.fetch = async (url, options) => {
      if (url === 'https://platform.claude.com/v1/oauth/token') {
        const body = JSON.parse(options.body);
        assert.equal(body.grant_type, 'refresh_token');
        assert.equal(body.refresh_token, 'old_refresh');
        return {
          status: 200,
          json: async () => ({
            access_token: 'new_tok',
            refresh_token: 'new_refresh',
            expires_in: 3600
          })
        };
      }
      throw new Error(`Unexpected fetch call: ${url}`);
    };

    let savedCredentials = null;
    const service = new QuotaService({
      tokenStore: {
        load: async () => ({
          accessToken: 'old_tok',
          refreshToken: 'old_refresh',
          expiresAt: new Date(Date.now() - 60_000).toISOString()
        }),
        clear: async () => {},
        save: async (creds) => {
          savedCredentials = creds;
        }
      },
      fetchImpl: async (url, options) => {
        assert.match(options.headers.Authorization, /new_tok/);
        return {
          status: 200,
          headers: { get: () => null },
          json: async () => ({
            five_hour: { utilization: 10, resets_at: '2026-04-27T18:30:00.000Z' }
          })
        };
      }
    });

    const quota = await service.fetchQuota();
    assert.equal(quota.session.percent, 10);
    assert.equal(savedCredentials.accessToken, 'new_tok');
    assert.equal(savedCredentials.refreshToken, 'new_refresh');
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test('QuotaService.fetchQuota maps 429 to QuotaError("rate_limited") with default retryAfter when header is missing/invalid', async () => {
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
        get: name => (name === 'retry-after' ? 'invalid' : null)
      }
    })
  });

  await assert.rejects(() => service.fetchQuota(), error => {
    assert.ok(error instanceof QuotaError);
    assert.equal(error.code, 'rate_limited');
    assert.equal(error.retryAfter, 300);
    return true;
  });
});

test('parseUsageResponse handles missing utilization falling back to 0', () => {
  const quota = parseUsageResponse({
    five_hour: { resets_at: '2026-04-27T18:30:00.000Z' },
    seven_day: { resets_at: '2026-04-30T12:00:00Z' }
  });

  assert.equal(quota.session.percent, 0);
  assert.equal(quota.weeklyAll.percent, 0);
});

test('parseUsageResponse handles invalid resets_at date', () => {
  const quota = parseUsageResponse({
    five_hour: { utilization: 50, resets_at: 'invalid-date' }
  });

  assert.equal(quota.session.percent, 50);
  assert.equal(quota.session.resetsAt, null);
});

test('QuotaService.fetchQuota validToken returns if credentials lack expiresAt', async () => {
  const service = new QuotaService({
    tokenStore: {
      load: async () => ({
        accessToken: 'tok_no_expire'
        // Missing expiresAt property
      }),
      clear: async () => {},
      save: async () => {}
    },
    fetchImpl: async () => ({
      status: 200,
      headers: { get: () => null },
      json: async () => ({})
    })
  });

  // If validToken didn't throw, we reach fetchImpl which returns a valid but empty json,
  // then parseUsageResponse returns nulls.
  const result = await service.fetchQuota();
  assert.equal(result.session, null);
});

test('parseUsageResponse handles null value in parseDate', () => {
  const quota = parseUsageResponse({
    five_hour: { utilization: 50, resets_at: null }
  });

  assert.equal(quota.session.percent, 50);
  assert.equal(quota.session.resetsAt, null);
});
