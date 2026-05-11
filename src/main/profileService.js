import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

import { logSafeError } from '../shared/diagnostics.js';

const FETCH_TIMEOUT_MS = 15_000;

export class ProfileService {
  constructor({ tokenStore, fetchImpl = fetch, timeoutMs = FETCH_TIMEOUT_MS, localLoader = readLocalProfile } = {}) {
    this.tokenStore = tokenStore;
    this.fetchImpl = fetchImpl;
    this.timeoutMs = timeoutMs;
    this.localLoader = localLoader;
    this.profileUrl = 'https://api.anthropic.com/api/oauth/profile';
  }

  async fetchProfile() {
    let token;
    try {
      token = await this.#validToken();
    } catch (error) {
      logSafeError('[profile] token validation failed:', error);
      return null;
    }

    if (!token) return null;

    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), this.timeoutMs);

    try {
      const response = await this.fetchImpl(this.profileUrl, {
        signal: controller.signal,
        headers: {
          Authorization: `Bearer ${token}`,
          Accept: 'application/json',
          'Content-Type': 'application/json',
          'anthropic-beta': 'oauth-2025-04-20',
          'User-Agent': 'claude-code/2.1.0'
        }
      });

      if (response.status === 200) {
        const profile = extractProfile(await response.json());
        const local = await this.localLoader();
        if (!profile.plan) profile.plan = local.plan;
        if (!profile.name) profile.name = local.name;
        if (!profile.email) profile.email = local.email;
        return profile;
      }

      if (response.status === 401) {
        await this.tokenStore.clear();
      }

      return null;
    } catch (error) {
      logSafeError('[profile] fetch failed:', error);
      return null;
    } finally {
      clearTimeout(timer);
    }
  }

  async #validToken() {
    let credentials = await this.tokenStore.load();
    if (!credentials) return null;

    if (isExpired(credentials) && credentials.refreshToken) {
      const { OAuthService } = await import('./oauthService.js');
      credentials = await new OAuthService().refresh(credentials.refreshToken);
      await this.tokenStore.save(credentials);
    }

    if (isExpired(credentials)) {
      await this.tokenStore.clear();
      return null;
    }

    return credentials.accessToken;
  }
}

function extractProfile(payload) {
  // Some endpoints nest user info under "account"
  const account = payload?.account ?? payload;
  return {
    name: valueOrNull(
      account?.name ?? account?.full_name ?? account?.display_name
    ),
    email: valueOrNull(account?.email),
    plan: valueOrNull(
      payload?.plan ?? payload?.subscription?.tier ?? payload?.subscription?.plan ??
      account?.plan ?? account?.subscription?.tier
    )
  };
}

function valueOrNull(value) {
  return value == null ? null : value;
}

function isExpired(credentials) {
  if (!credentials.expiresAt) return false;
  return new Date(credentials.expiresAt).getTime() <= Date.now() + 30_000;
}

async function readLocalProfile() {
  try {
    const credPath = path.join(os.homedir(), '.claude', '.credentials.json');
    const raw = await fs.readFile(credPath, 'utf8');
    const data = JSON.parse(raw);
    const oauth = data?.claudeAiOauth ?? {};
    return {
      name: valueOrNull(oauth.accountName ?? oauth.name ?? data.name),
      email: valueOrNull(oauth.accountEmail ?? oauth.email ?? data.email),
      plan: formatPlan(oauth.subscriptionType)
    };
  } catch {
    return { name: null, email: null, plan: null };
  }
}

function formatPlan(type) {
  if (!type) return null;
  const normalized = type.toLowerCase().replace(/^claude_/, '');
  return normalized.charAt(0).toUpperCase() + normalized.slice(1);
}
