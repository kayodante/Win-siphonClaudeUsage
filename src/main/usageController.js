import EventEmitter from 'node:events';

import { LocalDataService } from './localDataService.js';
import { OAuthService } from './oauthService.js';
import { DEFAULT_PREFERENCES } from './preferencesService.js';
import { ProfileService } from './profileService.js';
import { QuotaError, QuotaService } from './quotaService.js';
import { logSafeError, safeErrorMessage } from '../shared/diagnostics.js';

const DEFAULT_LOCAL_INTERVAL_MS = 30_000;
const MIN_QUOTA_INTERVAL_MS = 120_000;
const ALLOWED_REFRESH_INTERVALS = new Set([30, 300, 900, 1800]);
const MAX_QUOTA_HISTORY_POINTS = 96;

export class UsageController extends EventEmitter {
  constructor({
    localService = new LocalDataService(),
    quotaService,
    profileService,
    oauthService = new OAuthService(),
    preferences = createDefaultPreferences(),
    tokenStore,
    resetScheduler,
    openExternal,
    timers = globalThis,
    now = () => new Date()
  }) {
    super();
    this.localService = localService;
    this.oauthService = oauthService;
    this.preferences = preferences;
    this.tokenStore = tokenStore;
    this.quotaService = quotaService ?? new QuotaService({ tokenStore });
    this.profileService = profileService ?? new ProfileService({ tokenStore });
    this.resetScheduler = resetScheduler;
    this.openExternal = openExternal;
    this.timers = timers;
    this.now = now;
    this.authFlow = null;
    this.localTimer = null;
    this.quotaTimer = null;
    this.rateLimitedUntil = null;
    this.localInFlight = false;
    this.quotaInFlight = false;
    this.lastEmittedSnapshot = null;
    this.started = false;
    this.state = {
      todayStats: emptyStats(),
      monthStats: emptyStats(),
      localHistory: emptyLocalHistory(),
      quota: null,
      quotaHistory: emptyQuotaHistory(),
      localError: null,
      quotaError: null,
      authError: null,
      profile: null,
      preferences: structuredClone(DEFAULT_PREFERENCES),
      isSignedIn: false,
      awaitingCode: false,
      lastUpdated: null,
      isOffline: false,
      needsReauth: false
    };
    this.preferences.on?.('change', event => this.#handlePreferenceChange(event));
  }

  async start() {
    this.started = true;
    this.state.isSignedIn = Boolean(await this.tokenStore.load());
    this.state.preferences = await this.preferences.load();
    await this.resetScheduler.restore();
    await this.refreshLocal();
    if (this.state.isSignedIn) {
      await this.refreshProfile();
      await this.refreshQuota();
    }
    this.#scheduleTimers();
    this.#emit();
  }

  stop() {
    this.started = false;
    this.#clearTimers();
  }

  getState() {
    return this.state;
  }

  async refreshAll() {
    await this.refreshLocal();
    if (this.state.isSignedIn) await this.refreshQuota();
  }

  updateClaudePath(claudeDir) {
    this.localService = new LocalDataService(claudeDir);
  }

  async refreshLocal() {
    if (this.localInFlight) return;
    this.localInFlight = true;
    try {
      const summary = await this.localService.load();
      this.state.todayStats = summary.todayStats;
      this.state.monthStats = summary.monthStats;
      this.state.localHistory = summary.localHistory ?? emptyLocalHistory();
      this.state.lastUpdated = summary.lastUpdated.toISOString();
      this.state.localError = null;
    } catch (error) {
      logSafeError('refreshLocal failed:', error);
      this.state.localError =
        error instanceof SyntaxError
          ? 'error.local.corrupted'
          : error.code === 'ENODATA'
          ? 'error.local.missing'
          : 'Could not read ~/.claude usage files.';
    } finally {
      this.localInFlight = false;
    }
    this.#emit();
  }

  async refreshQuota() {
    if (this.rateLimitedUntil && Date.now() < this.rateLimitedUntil) return;
    if (this.quotaInFlight) return;
    this.quotaInFlight = true;

    try {
      const quota = await this.quotaService.fetchQuota();
      this.state.quota = serializeQuota(quota);
      this.#recordQuotaHistory(this.state.quota.session);
      this.state.quotaError = null;
      this.state.isSignedIn = true;
      this.state.isOffline = false;
      if (await this.preferences.get('notifications.sessionReset')) {
        await this.resetScheduler.updateFromQuota(quota);
      } else {
        await this.resetScheduler.clear();
      }
    } catch (error) {
      if (error instanceof QuotaError && error.code === 'rate_limited') {
        this.rateLimitedUntil = Date.now() + error.retryAfter * 1000;
        this.state.quotaError = null;
      } else if (error instanceof QuotaError && error.code === 'not_signed_in') {
        this.state.isSignedIn = false;
        this.state.quota = null;
      } else if (error instanceof QuotaError && error.code === 'scope_insufficient') {
        this.state.quotaError = 'error.scope_insufficient';
        this.state.needsReauth = true;
        this.state.isSignedIn = true;
      } else if (error instanceof QuotaError && error.code === 'network') {
        this.state.isOffline = true;
        this.state.quotaError = null;
      } else {
        logSafeError('refreshQuota failed:', error);
        this.state.quotaError = safeErrorMessage(error, 'Could not load quota data.');
      }
    } finally {
      this.quotaInFlight = false;
    }
    this.#emit();
  }

  async startSignIn() {
    this.state.authError = null;
    this.authFlow = this.oauthService.prepareFlow();
    this.state.awaitingCode = true;
    this.#emit();
    await this.openExternal(this.authFlow.url);
    return this.authFlow.url;
  }

  async submitCode(rawCode) {
    if (!this.authFlow) return;
    try {
      const credentials = await this.oauthService.exchange(
        rawCode,
        this.authFlow.verifier,
        this.authFlow.state
      );
      await this.tokenStore.save(credentials);
      this.authFlow = null;
      this.state.awaitingCode = false;
      this.state.isSignedIn = true;
      this.state.authError = null;
      this.state.needsReauth = false;
      await this.refreshProfile();
      await this.refreshQuota();
    } catch (error) {
      this.state.authError = safeErrorMessage(error, 'Authentication failed. Please try again.');
      this.#emit();
    }
  }

  async signOut() {
    await this.tokenStore.clear();
    await this.resetScheduler.clear();
    this.authFlow = null;
    this.state.awaitingCode = false;
    this.state.isSignedIn = false;
    this.state.quota = null;
    this.state.quotaHistory = emptyQuotaHistory();
    this.state.profile = null;
    this.state.authError = null;
    this.state.quotaError = null;
    this.state.needsReauth = false;
    this.#emit();
  }

  cancelAuth() {
    this.authFlow = null;
    this.state.awaitingCode = false;
    this.state.authError = null;
    this.#emit();
  }

  async refreshProfile() {
    try {
      this.state.profile = await this.profileService.fetchProfile();
    } catch (error) {
      logSafeError('[profile] refresh failed:', error);
      this.state.profile = null;
    }
    this.#emit();
  }

  async #handlePreferenceChange(event) {
    this.state.preferences = event.preferences;
    if (event.path === 'notifications.sessionReset' && event.value === false) {
      await this.resetScheduler.clear();
    }
    if (event.path === 'refresh.intervalSeconds' && this.started) {
      this.#scheduleTimers();
    }
    this.#emit();
  }

  #scheduleTimers() {
    this.#clearTimers();
    const interval = refreshIntervalMs(this.state.preferences);
    this.localTimer = this.timers.setInterval(() => this.refreshLocal(), interval);
    this.localTimer?.unref?.();
    this.quotaTimer = this.timers.setInterval(() => {
      if (this.state.isSignedIn) this.refreshQuota();
    }, Math.max(interval, MIN_QUOTA_INTERVAL_MS));
    this.quotaTimer?.unref?.();
  }

  #clearTimers() {
    if (this.localTimer != null) {
      this.timers.clearInterval(this.localTimer);
      this.localTimer = null;
    }
    if (this.quotaTimer != null) {
      this.timers.clearInterval(this.quotaTimer);
      this.quotaTimer = null;
    }
  }

  #recordQuotaHistory(session) {
    if (!session || session.percent == null) return;
    this.state.quotaHistory.session.push({
      timestamp: this.now().toISOString(),
      percent: session.percent
    });
    this.state.quotaHistory.session = this.state.quotaHistory.session.slice(-MAX_QUOTA_HISTORY_POINTS);
  }

  #emit() {
    const snapshot = JSON.stringify(this.state);
    if (snapshot === this.lastEmittedSnapshot) return;
    this.lastEmittedSnapshot = snapshot;
    this.emit('state', this.state);
  }
}

function createDefaultPreferences() {
  return {
    load: async () => structuredClone(DEFAULT_PREFERENCES),
    get: async path => path.split('.').reduce((current, key) => current?.[key], DEFAULT_PREFERENCES),
    on: () => {}
  };
}

function refreshIntervalMs(preferences) {
  const seconds = Number(preferences?.refresh?.intervalSeconds ?? 30);
  return (ALLOWED_REFRESH_INTERVALS.has(seconds) ? seconds : 30) * 1000;
}

function serializeQuota(quota) {
  return {
    session: serializeSlot(quota.session),
    weeklyAll: serializeSlot(quota.weeklyAll)
  };
}

function serializeSlot(slot) {
  if (!slot) return null;
  return {
    percent: slot.percent,
    resetsAt: slot.resetsAt?.toISOString() ?? null
  };
}

function emptyStats() {
  return {
    inputTokens: 0,
    outputTokens: 0,
    cacheReadTokens: 0,
    cacheWriteTokens: 0,
    totalTokens: 0,
    cost: 0,
    isEmpty: true,
    byModel: {}
  };
}

function emptyLocalHistory() {
  return {
    hourly: [],
    daily: []
  };
}

function emptyQuotaHistory() {
  return {
    session: []
  };
}
