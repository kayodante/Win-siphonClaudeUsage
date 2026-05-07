import {
  formatClockTime,
  formatDaysRemaining,
  formatTimeRemaining,
  formatWeekdayClock
} from './format.js';
import { t, tFormat } from './i18n.js';

const SEPARATOR = ' · ';

export function buildSessionResetLine(slot, now = new Date(), lang = 'en') {
  if (!slot) return t('session.reset.empty', lang);

  const percent = clamp(slot.percent ?? 0);
  if (percent === 0) return t('session.reset.empty', lang);

  const time = formatClockTime(slot.resetsAt);
  const resetsLine = tFormat('reset.connector.at', lang, { time });

  if (percent >= 100) return `${t('session.reset.full', lang)}${SEPARATOR}${resetsLine}`;

  const remaining = formatTimeRemaining(slot.resetsAt, now, lang);
  return `${remaining}${SEPARATOR}${resetsLine}`;
}

export function buildWeeklyResetLine(slot, now = new Date(), lang = 'en') {
  if (!slot) return t('weekly.reset.empty', lang);

  const percent = clamp(slot.percent ?? 0);
  if (percent === 0) return t('weekly.reset.empty', lang);

  const weekday = formatWeekdayClock(slot.resetsAt, lang);

  if (percent >= 100) {
    const tail = tFormat('reset.connector.day', lang, { weekday });
    return `${t('weekly.reset.full', lang)}${SEPARATOR}${tail}`;
  }

  const days = formatDaysRemaining(slot.resetsAt, now, lang);
  return `${days}${SEPARATOR}${weekday}`;
}

function clamp(value) {
  if (typeof value !== 'number' || Number.isNaN(value)) return 0;
  return Math.max(0, Math.min(100, value));
}
