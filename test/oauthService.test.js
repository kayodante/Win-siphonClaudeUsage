import assert from 'node:assert/strict';
import test from 'node:test';

import { OAuthService } from '../src/main/oauthService.js';

test('prepareFlow generates correct URL and PKCE parameters', () => {
  const service = new OAuthService();
  const { url, verifier, state } = service.prepareFlow();

  assert.ok(verifier.length > 0);
  assert.ok(state.length > 0);

  const parsedUrl = new URL(url);
  assert.equal(parsedUrl.origin, 'https://claude.ai');
  assert.equal(parsedUrl.pathname, '/oauth/authorize');
  assert.equal(parsedUrl.searchParams.get('client_id'), service.clientId);
  assert.equal(parsedUrl.searchParams.get('response_type'), 'code');
  assert.equal(parsedUrl.searchParams.get('redirect_uri'), service.redirectUri);
  assert.equal(parsedUrl.searchParams.get('scope'), service.scopes.join(' '));
  assert.equal(parsedUrl.searchParams.get('code_challenge_method'), 'S256');
  assert.equal(parsedUrl.searchParams.get('state'), state);
  assert.ok(parsedUrl.searchParams.has('code_challenge'));
});

test('exchange posts correct payload for authorization code via callback URL', async () => {
  let fetchBody = null;
  const service = new OAuthService({
    fetchImpl: async (url, options) => {
      fetchBody = JSON.parse(options.body);
      return {
        status: 200,
        json: async () => ({ access_token: 'tok_123', refresh_token: 'ref_123', expires_in: 3600 })
      };
    }
  });

  const rawCode = 'http://localhost/callback?code=abc12345#hashpart';
  const result = await service.exchange(rawCode, 'test-verifier', 'test-state');

  assert.equal(fetchBody.grant_type, 'authorization_code');
  assert.equal(fetchBody.code, 'abc12345');
  assert.equal(fetchBody.state, 'test-state');
  assert.equal(fetchBody.code_verifier, 'test-verifier');
  assert.equal(fetchBody.client_id, service.clientId);
  assert.equal(fetchBody.redirect_uri, service.redirectUri);

  assert.equal(result.accessToken, 'tok_123');
  assert.equal(result.refreshToken, 'ref_123');
});

test('exchange handles raw code string directly', async () => {
  let fetchBody = null;
  const service = new OAuthService({
    fetchImpl: async (url, options) => {
      fetchBody = JSON.parse(options.body);
      return {
        status: 200,
        json: async () => ({ access_token: 'tok_123', refresh_token: null, expires_in: 3600 })
      };
    }
  });

  const rawCode = 'raw-code-123';
  await service.exchange(rawCode, 'test-verifier', 'test-state');

  assert.equal(fetchBody.code, 'raw-code-123');
});

test('refresh posts correct payload for refresh token', async () => {
  let fetchBody = null;
  const service = new OAuthService({
    fetchImpl: async (url, options) => {
      fetchBody = JSON.parse(options.body);
      return {
        status: 200,
        json: async () => ({ access_token: 'tok_new', refresh_token: 'ref_new', expires_in: 3600 })
      };
    }
  });

  const result = await service.refresh('ref_old');

  assert.equal(fetchBody.grant_type, 'refresh_token');
  assert.equal(fetchBody.refresh_token, 'ref_old');
  assert.equal(fetchBody.client_id, service.clientId);

  assert.equal(result.accessToken, 'tok_new');
  assert.equal(result.refreshToken, 'ref_new');
});

test('postToken throws error on non-200 status', async () => {
  const service = new OAuthService({
    fetchImpl: async () => ({
      status: 400,
      text: async () => 'Bad Request'
    })
  });

  await assert.rejects(
    () => service.exchange('code', 'verifier', 'state'),
    (err) => {
      assert.match(err.message, /Auth failed: Bad Request/);
      return true;
    }
  );
});

test('postToken throws error on missing access token in response', async () => {
  const service = new OAuthService({
    fetchImpl: async () => ({
      status: 200,
      json: async () => ({ some_other_key: 'value' })
    })
  });

  await assert.rejects(
    () => service.exchange('code', 'verifier', 'state'),
    (err) => {
      assert.match(err.message, /Auth failed: missing access token/);
      return true;
    }
  );
});

test('postToken uses default expires_in if not provided', async () => {
  const service = new OAuthService({
    fetchImpl: async () => ({
      status: 200,
      json: async () => ({ access_token: 'tok_no_expire' })
    })
  });

  const now = Date.now();
  const result = await service.exchange('code', 'verifier', 'state');

  const expiresAtMs = new Date(result.expiresAt).getTime();
  assert.ok(expiresAtMs >= now + 3500000 && expiresAtMs <= now + 3700000);
});
