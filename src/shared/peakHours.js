// Official Anthropic peak hours for Claude usage: weekdays, 5–11 AM Pacific Time
// (8 AM–2 PM Eastern). Source: https://www.anthropic.com/news/higher-limits-spacex
// The window is anchored to America/Los_Angeles so it stays correct across DST.
const PEAK_TIME_ZONE = 'America/Los_Angeles';
const PEAK_HOURS_PT = { startHour: 5, endHour: 11 };

const weekdayAndHourFormatters = new Map();

// Weekday + hour as observed in the peak time zone (DST handled by Intl).
function zonedWeekdayAndHour(date, timeZone) {
  let formatter = weekdayAndHourFormatters.get(timeZone);
  if (!formatter) {
    formatter = new Intl.DateTimeFormat('en-US', {
      timeZone,
      weekday: 'short',
      hour: '2-digit',
      hour12: false,
    });
    weekdayAndHourFormatters.set(timeZone, formatter);
  }
  const parts = formatter.formatToParts(date);
  const weekday = parts.find(p => p.type === 'weekday')?.value ?? '';
  let hour = parseInt(parts.find(p => p.type === 'hour')?.value ?? '0', 10);
  if (hour === 24) hour = 0; // some engines emit "24" at midnight
  return { weekday, hour };
}

export function isPeakHour(date = new Date()) {
  const { weekday, hour } = zonedWeekdayAndHour(date, PEAK_TIME_ZONE);
  if (weekday === 'Sat' || weekday === 'Sun') return false;
  return hour >= PEAK_HOURS_PT.startHour && hour < PEAK_HOURS_PT.endHour;
}

const zoneOffsetFormatters = new Map();

// Offset (ms) between `timeZone` wall-clock and UTC at the given instant.
function zoneOffsetMs(date, timeZone) {
  let formatter = zoneOffsetFormatters.get(timeZone);
  if (!formatter) {
    formatter = new Intl.DateTimeFormat('en-US', {
      timeZone,
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit',
      hour12: false,
    });
    zoneOffsetFormatters.set(timeZone, formatter);
  }
  const parts = formatter.formatToParts(date);
  const get = type => parts.find(p => p.type === type)?.value;
  let hour = get('hour');
  if (hour === '24') hour = '00';
  const asUTC = Date.UTC(
    Number(get('year')),
    Number(get('month')) - 1,
    Number(get('day')),
    Number(hour),
    Number(get('minute')),
    Number(get('second'))
  );
  return asUTC - date.getTime();
}

const zonedWallClockFormatters = new Map();

// Build the UTC instant matching a given wall-clock time in `timeZone`,
// on the same calendar day (in that zone) as `date`.
function zonedWallClockToInstant(date, timeZone, hourPT) {
  let formatter = zonedWallClockFormatters.get(timeZone);
  if (!formatter) {
    formatter = new Intl.DateTimeFormat('en-US', {
      timeZone,
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
    });
    zonedWallClockFormatters.set(timeZone, formatter);
  }
  const parts = formatter.formatToParts(date);
  const get = type => Number(parts.find(p => p.type === type)?.value);
  const guess = Date.UTC(get('year'), get('month') - 1, get('day'), hourPT, 0, 0);
  // Correct the guess by the zone offset measured at that approximate instant.
  return new Date(guess - zoneOffsetMs(new Date(guess), timeZone));
}

const localRangeFormatters = new Map();

// Today's peak window (5–11 AM PT) expressed in the user's local time, formatted
// as short clock labels for display in the badge tooltip.
export function peakHoursLocalRange(date = new Date(), locale = undefined) {
  const localeKey = locale || 'default';
  let fmt = localRangeFormatters.get(localeKey);
  if (!fmt) {
    fmt = new Intl.DateTimeFormat(locale, { hour: 'numeric', minute: '2-digit' });
    localRangeFormatters.set(localeKey, fmt);
  }
  const start = zonedWallClockToInstant(date, PEAK_TIME_ZONE, PEAK_HOURS_PT.startHour);
  const end = zonedWallClockToInstant(date, PEAK_TIME_ZONE, PEAK_HOURS_PT.endHour);
  return { start: fmt.format(start), end: fmt.format(end) };
}
