export class QuotaError extends Error {
  constructor(code, message, options = {}) {
    super(message);
    this.name = 'QuotaError';
    this.code = code;
    this.retryAfter = options.retryAfter;
  }
}

export function parseUsageResponse(raw) {
  return {
    session: parseBucket(raw?.five_hour),
    weeklyAll: parseBucket(raw?.seven_day)
  };
}

const FETCH_TIMEOUT_MS = 15_000;

export class QuotaService {
  constructor({ tokenStore, fetchImpl = fetch, timeoutMs = FETCH_TIMEOUT_MS } = {}) {
    this.tokenStore = tokenStore;
    this.fetchImpl = fetchImpl;
    this.timeoutMs = timeoutMs;
    this.usageUrl = 'https://api.anthropic.com/api/oauth/usage';
  }

  async fetchQuota() {
    const token = await this.#validToken();
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), this.timeoutMs);
    let response;
    try {
      response = await this.fetchImpl(this.usageUrl, {
        signal: controller.signal,
        headers: {
          Authorization: `Bearer ${token}`,
          Accept: 'application/json',
          'Content-Type': 'application/json',
          'anthropic-beta': 'oauth-2025-04-20',
          'User-Agent': 'claude-code/2.1.0'
        }
      });
    } catch (error) {
      if (error?.name === 'AbortError') {
        throw new QuotaError('server', 'Quota request timed out.');
      }
      if (error instanceof TypeError) {
        throw new QuotaError('network', 'Network unavailable.');
      }
      throw error;
    } finally {
      clearTimeout(timer);
    }

    if (response.status === 200) {
      let payload;
      try {
        payload = await response.json();
      } catch {
        throw new QuotaError('server', 'Malformed response from quota endpoint.');
      }
      return parseUsageResponse(payload);
    }

    if (response.status === 401) {
      await this.tokenStore.clear();
      throw new QuotaError('unauthorized', 'Session expired. Please sign in again.');
    }

    if (response.status === 429) {
      const retryAfter = Number(response.headers.get('retry-after')) || 300;
      throw new QuotaError('rate_limited', 'Rate limited', { retryAfter });
    }

    throw new QuotaError('server', `Server error (${response.status})`);
  }

  async #validToken() {
    let credentials = await this.tokenStore.load();
    if (!credentials) {
      throw new QuotaError('not_signed_in', 'Not signed in');
    }

    if (isExpired(credentials) && credentials.refreshToken) {
      const { OAuthService } = await import('./oauthService.js');
      credentials = await new OAuthService().refresh(credentials.refreshToken);
      await this.tokenStore.save(credentials);
    }

    if (isExpired(credentials)) {
      await this.tokenStore.clear();
      throw new QuotaError('not_signed_in', 'Not signed in');
    }

    return credentials.accessToken;
  }
}

function parseBucket(bucket) {
  if (!bucket) return null;
  return {
    percent: Number(bucket.utilization ?? 0),
    resetsAt: parseDate(bucket.resets_at)
  };
}

function parseDate(value) {
  if (!value) return null;
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? null : date;
}

function isExpired(credentials) {
  if (!credentials.expiresAt) return false;
  return new Date(credentials.expiresAt).getTime() <= Date.now() + 30_000;
}
