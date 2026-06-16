export const SESSION_WINDOW_MS = 5 * 60 * 60 * 1000;
export const WEEKLY_WINDOW_MS = 7 * 24 * 60 * 60 * 1000;

const HIGH_PACE_MARGIN_PERCENT = 10;
const EARLY_DEPLETION_MARGIN_MS = 30 * 60 * 1000;

export function buildUsagePace({
  slot,
  now = new Date(),
  windowMs = SESSION_WINDOW_MS
} = {}) {
  const percent = Number(slot?.percent);
  const resetsAt = normalizeDate(slot?.resetsAt);
  const currentTime = normalizeDate(now) ?? new Date();

  if (!Number.isFinite(percent) || percent <= 0 || !resetsAt || !Number.isFinite(windowMs) || windowMs <= 0) {
    return emptyPace();
  }

  const windowStart = new Date(resetsAt.getTime() - windowMs);
  if (currentTime < windowStart || currentTime >= resetsAt) {
    return emptyPace({ percent, resetsAt, windowStart });
  }

  const elapsedMs = currentTime.getTime() - windowStart.getTime();
  const remainingMs = resetsAt.getTime() - currentTime.getTime();
  const elapsedPercent = roundPercent((elapsedMs / windowMs) * 100);
  const projectedDepletionAt = projectDepletion({ percent, elapsedMs, windowStart });

  let status = 'on_track';
  if (percent >= 100) {
    status = 'likely_out';
  } else if (
    percent >= 80 &&
    projectedDepletionAt &&
    projectedDepletionAt.getTime() <= resetsAt.getTime() - EARLY_DEPLETION_MARGIN_MS
  ) {
    status = 'likely_out';
  } else if (percent > elapsedPercent + HIGH_PACE_MARGIN_PERCENT) {
    status = 'high_pace';
  }

  return {
    status,
    percent: roundPercent(percent),
    elapsedPercent,
    remainingMs,
    resetsAt,
    windowStart,
    projectedDepletionAt
  };
}

function emptyPace(overrides = {}) {
  return {
    status: 'no_data',
    percent: null,
    elapsedPercent: null,
    remainingMs: null,
    resetsAt: null,
    windowStart: null,
    projectedDepletionAt: null,
    ...overrides
  };
}

function projectDepletion({ percent, elapsedMs, windowStart }) {
  if (percent <= 0 || elapsedMs <= 0) return null;
  const projectedMs = (elapsedMs / percent) * 100;
  return new Date(windowStart.getTime() + projectedMs);
}

function normalizeDate(value) {
  if (!value) return null;
  const date = value instanceof Date ? value : new Date(value);
  return Number.isNaN(date.getTime()) ? null : date;
}

function roundPercent(value) {
  return Math.round(value * 10) / 10;
}
