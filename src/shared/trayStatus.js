import {
  formatClockTime,
  formatPercent,
  formatRelativeUpdated,
  hydrateSlot
} from './format.js';
import { t } from './i18n.js';

export function buildTrayStatus(state = {}, { lang = 'en', now = new Date() } = {}) {
  const session = hydrateSlot(state.quota?.session);
  const weekly = hydrateSlot(state.quota?.weeklyAll);
  const updatedAt = state.lastUpdated ? new Date(state.lastUpdated) : null;

  const rows = [
    [t('tray.session', lang), session ? formatPercent(session.percent) : '--'],
    [t('tray.weekly', lang), weekly ? formatPercent(weekly.percent) : '--'],
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
