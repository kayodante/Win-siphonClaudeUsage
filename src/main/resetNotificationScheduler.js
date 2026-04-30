const MAX_TIMER_DELAY_MS = 2_147_483_647;

export class ResetNotificationScheduler {
  constructor({
    now = () => new Date(),
    setTimer = setTimeout,
    clearTimer = clearTimeout,
    notify,
    loadState,
    saveState
  }) {
    this.now = now;
    this.setTimer = setTimer;
    this.clearTimer = clearTimer;
    this.notify = notify;
    this.loadState = loadState;
    this.saveState = saveState;
    this.timer = null;
    this.currentResetKey = null;
    this.lastFiredResetKey = null;
  }

  restore() {
    const state = this.loadState();
    if (!state?.resetsAt) return;
    const resetsAt = new Date(state.resetsAt);
    if (Number.isNaN(resetsAt.getTime())) {
      this.saveState(null);
      return;
    }
    this.#schedule(state.resetKey, resetsAt);
  }

  clear() {
    this.#clear();
    this.saveState(null);
  }

  updateFromQuota(quota) {
    const session = quota?.session;
    if (!session?.resetsAt) return;

    if (session.percent < 15) {
      this.#clear();
      this.saveState(null);
      return;
    }

    if (session.percent < 100) return;

    const resetsAt = new Date(session.resetsAt);
    if (Number.isNaN(resetsAt.getTime())) return;

    const resetKey = resetsAt.toISOString();
    if (resetKey === this.currentResetKey) return;
    if (resetKey === this.lastFiredResetKey) return;

    this.#clear();
    this.currentResetKey = resetKey;
    this.saveState({ resetKey, resetsAt: resetKey });
    this.#schedule(resetKey, resetsAt);
  }

  #schedule(resetKey, resetsAt) {
    this.currentResetKey = resetKey;
    const delayMs = resetsAt.getTime() - this.now().getTime();

    if (delayMs <= 0) {
      this.#fire(resetKey);
      return;
    }

    const nextDelay = Math.min(delayMs, MAX_TIMER_DELAY_MS);
    this.timer = this.setTimer(() => {
      this.timer = null;
      this.#schedule(resetKey, resetsAt);
    }, nextDelay);
  }

  #fire(resetKey) {
    this.notify({
      title: 'Claude session reset',
      body: 'Your Claude session limit should be available again.'
    });
    this.lastFiredResetKey = resetKey;
    if (this.currentResetKey === resetKey) {
      this.currentResetKey = null;
      this.saveState(null);
    }
  }

  #clear() {
    if (this.timer) {
      this.clearTimer(this.timer);
      this.timer = null;
    }
    this.currentResetKey = null;
  }
}
