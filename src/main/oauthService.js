import crypto from 'node:crypto';

import { safeErrorMessage } from '../shared/diagnostics.js';

export class OAuthService {
  constructor({ fetchImpl = fetch } = {}) {
    this.fetchImpl = fetchImpl;
    this.clientId = '9d1c250a-e61b-44d9-88ed-5944d1962f5e';
    this.redirectUri = 'https://platform.claude.com/oauth/code/callback';
    this.authUrl = 'https://claude.ai/oauth/authorize';
    this.tokenUrl = 'https://platform.claude.com/v1/oauth/token';
    this.scopes = ['user:profile', 'user:inference'];
  }

  prepareFlow() {
    const verifier = randomUrlString();
    const challenge = codeChallenge(verifier);
    const state = randomUrlString();
    const url = new URL(this.authUrl);
    url.searchParams.set('code', 'true');
    url.searchParams.set('client_id', this.clientId);
    url.searchParams.set('response_type', 'code');
    url.searchParams.set('redirect_uri', this.redirectUri);
    url.searchParams.set('scope', this.scopes.join(' '));
    url.searchParams.set('code_challenge', challenge);
    url.searchParams.set('code_challenge_method', 'S256');
    url.searchParams.set('state', state);
    return { url: url.toString(), verifier, state };
  }

  async exchange(rawCode, verifier, state) {
    const code = extractCode(rawCode);
    return this.#postToken({
      grant_type: 'authorization_code',
      code,
      state,
      client_id: this.clientId,
      redirect_uri: this.redirectUri,
      code_verifier: verifier
    });
  }

  async refresh(refreshToken) {
    return this.#postToken({
      grant_type: 'refresh_token',
      refresh_token: refreshToken,
      client_id: this.clientId
    });
  }

  async #postToken(body) {
    const response = await this.fetchImpl(this.tokenUrl, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json'
      },
      body: JSON.stringify(body)
    });

    if (response.status !== 200) {
      const text = await response.text();
      throw new Error(safeErrorMessage(`Auth failed: ${text || response.status}`, 'Auth failed.'));
    }

    const json = await response.json();
    if (!json.access_token) {
      throw new Error('Auth failed: missing access token');
    }

    const expiresIn = Number(json.expires_in ?? 3600);
    return {
      accessToken: json.access_token,
      refreshToken: json.refresh_token ?? null,
      expiresAt: new Date(Date.now() + expiresIn * 1000).toISOString()
    };
  }
}

function extractCode(rawCode) {
  const trimmed = rawCode.trim();
  const [firstPart] = trimmed.split('#', 1);
  try {
    const url = new URL(firstPart);
    return url.searchParams.get('code') ?? firstPart;
  } catch {
    return firstPart;
  }
}

function randomUrlString() {
  return crypto.randomBytes(32).toString('base64url');
}

function codeChallenge(verifier) {
  return crypto.createHash('sha256').update(verifier).digest('base64url');
}
