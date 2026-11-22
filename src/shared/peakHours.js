// Official Anthropic peak hours for Claude usage: weekdays, 5–11 AM Pacific Time
// (8 AM–2 PM Eastern). Source: https://www.anthropic.com/news/higher-limits-spacex
// The window is anchored to America/Los_Angeles so it stays correct across DST.
const PEAK_TIME_ZONE = 'America/Los_Angeles';
const PEAK_HOURS_PT = { startHour: 5, endHour: 11 };

const ptFormatter = new Intl.DateTimeFormat('en-US', {
  timeZone: PEAK_TIME_ZONE,
  weekday: 'short',
  year: 'numeric',
  month: '2-digit',
  day: '2-digit',
  hour: '2-digit',
  minute: '2-digit',
  second: '2-digit',
  hour12: false
});
const localRangeFormatters = new Map();

function ptParts(date) {
  const parts = Object.fromEntries(ptFormatter.formatToParts(date).map(p => [p.type, p.value]));
  return {
    weekday: parts.weekday ?? '',
    year: Number(parts.year),
    month: Number(parts.month) - 1,
    day: Number(parts.day),
    hour: Number(parts.hour) % 24,
    minute: Number(parts.minute),
    second: Number(parts.second)
  };
}

export function isPeakHour(date = new Date()) {
  const { weekday, hour } = ptParts(date);
  if (weekday === 'Sat' || weekday === 'Sun') return false;
  return hour >= PEAK_HOURS_PT.startHour && hour < PEAK_HOURS_PT.endHour;
}

function ptHourToInstant(date, hourPT) {
  const { year, month, day } = ptParts(date);
  const guess = Date.UTC(year, month, day, hourPT, 0, 0);
  const g = ptParts(new Date(guess));
  const offsetMs = Date.UTC(g.year, g.month, g.day, g.hour, g.minute, g.second) - guess;
  return new Date(guess - offsetMs);
}

// Today's peak window (5–11 AM PT) expressed in the user's local time, formatted
// as short clock labels for display in the badge tooltip.
export function peakHoursLocalRange(date = new Date(), locale = undefined) {
  const localeKey = locale || 'default';
  let fmt = localRangeFormatters.get(localeKey);
  if (!fmt) {
    fmt = new Intl.DateTimeFormat(locale, { hour: 'numeric', minute: '2-digit' });
    localRangeFormatters.set(localeKey, fmt);
  }
  return {
    start: fmt.format(ptHourToInstant(date, PEAK_HOURS_PT.startHour)),
    end: fmt.format(ptHourToInstant(date, PEAK_HOURS_PT.endHour))
  };
}
