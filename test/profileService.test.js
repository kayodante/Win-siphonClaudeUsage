import assert from 'node:assert/strict';
import test from 'node:test';

import { ProfileService } from '../src/main/profileService.js';

test('fetchProfile returns profile fields from a full payload', async () => {
  const service = new ProfileService({
    tokenStore: tokenStoreWithCredentials(),
    fetchImpl: async (url, options) => {
      assert.equal(url, 'https://api.anthropic.com/api/oauth/profile');
      assert.equal(options.headers.Authorization, 'Bearer tok');
      assert.equal(options.headers.Accept, 'application/json');
      assert.equal(options.headers['Content-Type'], 'application/json');
      assert.equal(options.headers['anthropic-beta'], 'oauth-2025-04-20');
      assert.equal(options.headers['User-Agent'], 'claude-code/2.1.0');
      return jsonResponse(200, {
        name: 'Kayo Dante',
        email: 'kayo@example.com',
        plan: 'Pro'
      });
    }
  });

  assert.deepEqual(await service.fetchProfile(), {
    name: 'Kayo Dante',
    email: 'kayo@example.com',
    plan: 'Pro'
  });
});

test('fetchProfile returns null subfields for missing profile fields', async () => {
  const service = new ProfileService({
    tokenStore: tokenStoreWithCredentials(),
    fetchImpl: async () =>
      jsonResponse(200, {
        display_name: 'Designer',
        subscription: { tier: 'Max' }
      }),
    localLoader: async () => ({ name: null, email: null, plan: null })
  });

  assert.deepEqual(await service.fetchProfile(), {
    name: 'Designer',
    email: null,
    plan: 'Max'
  });
});

test('fetchProfile fills missing name and email from local credentials', async () => {
  const service = new ProfileService({
    tokenStore: tokenStoreWithCredentials(),
    fetchImpl: async () => jsonResponse(200, { plan: 'Pro' }),
    localLoader: async () => ({ name: 'Kayo Dante', email: 'kayo@example.com', plan: null })
  });

  assert.deepEqual(await service.fetchProfile(), {
    name: 'Kayo Dante',
    email: 'kayo@example.com',
    plan: 'Pro'
  });
});

test('fetchProfile returns null on 404 without throwing', async () => {
  const service = new ProfileService({
    tokenStore: tokenStoreWithCredentials(),
    fetchImpl: async () => jsonResponse(404, {})
  });

  assert.equal(await service.fetchProfile(), null);
});

test('fetchProfile clears credentials and returns null on 401', async () => {
  const tokenStore = tokenStoreWithCredentials();
  const service = new ProfileService({
    tokenStore,
    fetchImpl: async () => jsonResponse(401, {})
  });

  assert.equal(await service.fetchProfile(), null);
  assert.equal(tokenStore.cleared, true);
});

test('fetchProfile returns null on network errors', async () => {
  const service = new ProfileService({
    tokenStore: tokenStoreWithCredentials(),
    fetchImpl: async () => {
      throw new Error('network down');
    }
  });

  await withMutedProfileConsole(async () => {
    assert.equal(await service.fetchProfile(), null);
  });
});

test('fetchProfile returns null on abort', async () => {
  const service = new ProfileService({
    tokenStore: tokenStoreWithCredentials(),
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

  await withMutedProfileConsole(async () => {
    assert.equal(await service.fetchProfile(), null);
  });
});

function tokenStoreWithCredentials() {
  return {
    cleared: false,
    credentials: {
      accessToken: 'tok',
      refreshToken: null,
      expiresAt: new Date(Date.now() + 60_000).toISOString()
    },
    load: async function load() {
      return this.credentials;
    },
    save: async function save(credentials) {
      this.credentials = credentials;
    },
    clear: async function clear() {
      this.cleared = true;
      this.credentials = null;
    }
  };
}

function jsonResponse(status, payload) {
  return {
    status,
    headers: { get: () => null },
    json: async () => payload
  };
}

async function withMutedProfileConsole(fn) {
  const original = console.error;
  console.error = () => {};
  try {
    await fn();
  } finally {
    console.error = original;
  }
}
