import { t } from '../shared/i18n.js';

export class UsageAlertService {
  constructor({ showNotification }) {
    this.showNotification = showNotification;
    this.lastKnownSessionPercent = null;
  }

  async checkUsageAlerts(state) {
    const percent = state.quota?.session?.percent ?? null;
    if (percent === null) return;

    const lang = state.preferences?.language ?? 'en';
    const expireAlert = state.preferences?.notifications?.expireAlert ?? false;
    const limitAlert = state.preferences?.notifications?.limitAlert ?? false;
    const prev = this.lastKnownSessionPercent;

    this.lastKnownSessionPercent = percent;

    if (prev === null) return;

    if (expireAlert && prev < 100 && percent >= 100) {
      this.showNotification(t('notification.expireTitle', lang), t('notification.expireBody', lang));
    }

    if (limitAlert) {
      if (prev < 90 && percent >= 90) {
        this.showNotification(t('alert.critical.title', lang), t('alert.critical.body', lang));
      } else if (prev < 70 && percent >= 70) {
        this.showNotification(t('alert.highUsage.title', lang), t('alert.highUsage.body', lang));
      }
    }
  }
}
