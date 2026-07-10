import {
  formatClockTime,
  formatQuotaPercent,
  formatRelativeUpdated,
  hydrateSlot
} from './format.js';
import { t } from './i18n.js';

export function buildTrayStatus(state = {}, { lang = 'en', now = new Date() } = {}) {
  const session = hydrateSlot(state.quota?.session);
  const weekly = hydrateSlot(state.quota?.weeklyAll);
  const updatedAt = state.lastUpdated ? new Date(state.lastUpdated) : null;
  const mode = state.preferences?.display?.quotaMode ?? 'used';
  const suffix = t(`quota.suffix.${mode}`, lang);

  const rows = [
    [t('tray.session', lang), session ? formatQuotaPercent(session.percent, mode, suffix) : '--'],
    [t('tray.weekly', lang), weekly ? formatQuotaPercent(weekly.percent, mode, suffix) : '--'],
    [t('tray.sessionReset', lang), formatClockTime(session?.resetsAt)],
    [t('tray.updated', lang), formatRelativeUpdated(updatedAt, now, lang)]
  ];

  return {
    tooltip: ['Siphon', ...rows.map(([label, value]) => `${label}: ${value}`)].join('\n'),
    menuItems: rows.map(([label, value]) => ({
      label: `${label}: ${value}`,
      enabled: false
    }))
  };
}
