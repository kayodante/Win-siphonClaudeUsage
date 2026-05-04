const FETCH_TIMEOUT_MS = 15_000;

export class ProfileService {
  constructor({ tokenStore, fetchImpl = fetch, timeoutMs = FETCH_TIMEOUT_MS } = {}) {
    this.tokenStore = tokenStore;
    this.fetchImpl = fetchImpl;
    this.timeoutMs = timeoutMs;
    this.profileUrl = 'https://api.anthropic.com/api/oauth/profile';
  }

  async fetchProfile() {
    let token;
    try {
      token = await this.#validToken();
    } catch (error) {
      console.error('[profile] token validation failed', error);
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
        return extractProfile(await response.json());
      }

      if (response.status === 401) {
        await this.tokenStore.clear();
      }

      return null;
    } catch (error) {
      console.error('[profile] fetch failed', error);
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
  return {
    name: valueOrNull(payload?.name ?? payload?.full_name ?? payload?.display_name),
    email: valueOrNull(payload?.email),
    plan: valueOrNull(payload?.plan ?? payload?.subscription?.tier ?? payload?.subscription?.plan)
  };
}

function valueOrNull(value) {
  return value == null ? null : value;
}

function isExpired(credentials) {
  if (!credentials.expiresAt) return false;
  return new Date(credentials.expiresAt).getTime() <= Date.now() + 30_000;
}
