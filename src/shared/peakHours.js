export const PEAK_HOURS_UTC = { startHour: 13, endHour: 22 };

export function isPeakHour(date = new Date()) {
  const day = date.getUTCDay();
  if (day === 0 || day === 6) return false;
  const hour = date.getUTCHours();
  return hour >= PEAK_HOURS_UTC.startHour && hour < PEAK_HOURS_UTC.endHour;
}
