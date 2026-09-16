import {
  formatClockTime,
  formatDaysRemaining,
  formatTimeRemaining,
  formatWeekdayClock,
  remainingParts
} from './format.js';
import { t, tFormat } from './i18n.js';

const SEPARATOR = ' · ';
const DAY_MS = 86_400_000;

export function buildSessionResetLine(slot, now = new Date(), lang = 'en') {
  if (!slot) return t('session.reset.empty', lang);

  const percent = clamp(slot.percent ?? 0);
  if (percent === 0) return t('session.reset.empty', lang);

  const time = formatClockTime(slot.resetsAt);

  if (percent >= 100) {
    const { zero, hours, minutes } = remainingParts(slot.resetsAt, now);
    const resetsLine = zero
      ? tFormat('reset.connector.at', lang, { time })
      : hours > 0
        ? tFormat('reset.connector.exhausted_hourMin', lang, { hours, minutes, time })
        : tFormat('reset.connector.exhausted_min', lang, { minutes, time });
    return `${t('session.reset.full', lang)}${SEPARATOR}${resetsLine}`;
  }

  const resetsLine = tFormat('reset.connector.at', lang, { time });
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

  // Under a day left, days-granularity would round up to "1 day" for a reset
  // happening in a couple of hours — fall back to the hour/minute countdown.
  const diffMs = slot.resetsAt ? slot.resetsAt.getTime() - now.getTime() : 0;
  const remaining =
    diffMs > 0 && diffMs < DAY_MS
      ? formatTimeRemaining(slot.resetsAt, now, lang)
      : formatDaysRemaining(slot.resetsAt, now, lang);
  return `${remaining}${SEPARATOR}${weekday}`;
}

function clamp(value) {
  if (typeof value !== 'number' || Number.isNaN(value)) return 0;
  return Math.max(0, Math.min(100, value));
}
