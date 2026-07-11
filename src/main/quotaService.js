import { forceRefresh, isExpired, refreshIfExpired } from './tokenLifecycle.js';

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
    weeklyAll: parseBucket(raw?.seven_day),
    extraUsage: parseExtraUsage(raw?.extra_usage)
  };
}

// Purchased extra credits beyond the plan quota. Only present when the account
// has the feature enabled; returns null otherwise so the UI card auto-hides.
export function parseExtraUsage(extra) {
  if (!extra || extra.is_enabled !== true) return null;
  return {
    monthlyLimit: Number(extra.monthly_limit ?? 0),
    usedCredits: Number(extra.used_credits ?? 0),
    utilization: Number(extra.utilization ?? 0)
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
    let response = await this.#requestUsage(token);

    // A 401 on a token that looked valid locally may be a transient rejection
    // rather than a real expiry. Try a single forced refresh + retry before
    // giving up the session; only clear the store if that also fails.
    if (response.status === 401) {
      const refreshedToken = await this.#refreshAfterUnauthorized();
      if (refreshedToken) {
        response = await this.#requestUsage(refreshedToken);
      }
      if (response.status === 401) {
        await this.tokenStore.clear();
        throw new QuotaError('unauthorized', 'Session expired. Please sign in again.');
      }
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

    if (response.status === 403) {
      throw new QuotaError('scope_insufficient', 'Re-authentication required.');
    }

    if (response.status === 429) {
      const retryAfter = Number(response.headers.get('retry-after')) || 300;
      throw new QuotaError('rate_limited', 'Rate limited', { retryAfter });
    }

    throw new QuotaError('server', `Server error (${response.status})`);
  }

  async #requestUsage(token) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), this.timeoutMs);
    try {
      return await this.fetchImpl(this.usageUrl, {
        signal: controller.signal,
        headers: {
          Authorization: `Bearer ${token}`,
          Accept: 'application/json',
          'Content-Type': 'application/json',
          'anthropic-beta': 'oauth-2025-04-20',
          'User-Agent': 'claude-code/2.1.121'
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
  }

  // Force a token refresh after a 401. Returns the new access token, or null if
  // no refresh token exists or the refresh fails (caller then clears the store).
  async #refreshAfterUnauthorized() {
    try {
      const credentials = await this.tokenStore.load();
      if (!credentials?.refreshToken) return null;
      const refreshed = await forceRefresh(this.tokenStore, credentials);
      return refreshed.accessToken;
    } catch {
      return null;
    }
  }

  async #validToken() {
    let credentials = await this.tokenStore.load();
    if (!credentials) {
      throw new QuotaError('not_signed_in', 'Not signed in');
    }

    credentials = await refreshIfExpired(this.tokenStore, credentials);

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

