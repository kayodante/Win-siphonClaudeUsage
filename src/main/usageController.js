import EventEmitter from 'node:events';

import { LocalDataService } from './localDataService.js';
import { OAuthService } from './oauthService.js';
import { DEFAULT_PREFERENCES } from './preferencesService.js';
import { ProfileService } from './profileService.js';
import { QuotaError, QuotaService } from './quotaService.js';

export class UsageController extends EventEmitter {
  constructor({
    localService = new LocalDataService(),
    quotaService,
    profileService,
    oauthService = new OAuthService(),
    preferences = createDefaultPreferences(),
    tokenStore,
    resetScheduler,
    openExternal
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
    this.authFlow = null;
    this.localTimer = null;
    this.quotaTimer = null;
    this.rateLimitedUntil = null;
    this.localInFlight = false;
    this.quotaInFlight = false;
    this.lastEmittedSnapshot = null;
    this.state = {
      todayStats: emptyStats(),
      monthStats: emptyStats(),
      recentDays: [],
      quota: null,
      localError: null,
      quotaError: null,
      authError: null,
      profile: null,
      preferences: this.preferences.load(),
      isSignedIn: false,
      awaitingCode: false,
      lastUpdated: null
    };
    this.preferences.on?.('change', event => this.#handlePreferenceChange(event));
  }

  async start() {
    this.state.isSignedIn = Boolean(await this.tokenStore.load());
    this.resetScheduler.restore();
    await this.refreshLocal();
    if (this.state.isSignedIn) {
      await this.refreshProfile();
      await this.refreshQuota();
    }
    this.localTimer = setInterval(() => this.refreshLocal(), 30_000);
    this.quotaTimer = setInterval(() => {
      if (this.state.isSignedIn) this.refreshQuota();
    }, 120_000);
    this.#emit();
  }

  stop() {
    clearInterval(this.localTimer);
    clearInterval(this.quotaTimer);
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
      this.state.recentDays = summary.recentDays.slice(0, 7);
      this.state.lastUpdated = summary.lastUpdated.toISOString();
      this.state.localError = null;
    } catch (error) {
      console.error('refreshLocal failed', error);
      this.state.localError =
        error instanceof SyntaxError
          ? 'Claude Code usage cache is corrupted.'
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
      this.state.quotaError = null;
      this.state.isSignedIn = true;
      if (this.preferences.get('notifications.sessionReset')) {
        this.resetScheduler.updateFromQuota(quota);
      } else {
        this.resetScheduler.clear();
      }
    } catch (error) {
      if (error instanceof QuotaError && error.code === 'rate_limited') {
        this.rateLimitedUntil = Date.now() + error.retryAfter * 1000;
        this.state.quotaError = null;
      } else if (error instanceof QuotaError && error.code === 'not_signed_in') {
        this.state.isSignedIn = false;
        this.state.quota = null;
      } else {
        console.error('refreshQuota failed', error);
        this.state.quotaError = error.message;
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
      await this.refreshProfile();
      await this.refreshQuota();
    } catch (error) {
      this.state.authError = error.message;
      this.#emit();
    }
  }

  async signOut() {
    await this.tokenStore.clear();
    this.authFlow = null;
    this.state.awaitingCode = false;
    this.state.isSignedIn = false;
    this.state.quota = null;
    this.state.profile = null;
    this.state.authError = null;
    this.state.quotaError = null;
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
      console.error('[profile] refresh failed', error);
      this.state.profile = null;
    }
  }

  #handlePreferenceChange(event) {
    this.state.preferences = event.preferences;
    if (event.path === 'notifications.sessionReset' && event.value === false) {
      this.resetScheduler.clear();
    }
    this.#emit();
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
    load: () => structuredClone(DEFAULT_PREFERENCES),
    get: path => path.split('.').reduce((current, key) => current?.[key], DEFAULT_PREFERENCES),
    on: () => {}
  };
}

function serializeQuota(quota) {
  return {
    session: serializeSlot(quota.session),
    weeklyAll: serializeSlot(quota.weeklyAll),
    weeklySonnet: serializeSlot(quota.weeklySonnet),
    weeklyOpus: serializeSlot(quota.weeklyOpus)
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
