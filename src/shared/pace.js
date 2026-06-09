export const SESSION_WINDOW_MS = 5 * 60 * 60 * 1000;
export const WEEKLY_WINDOW_MS = 7 * 24 * 60 * 60 * 1000;

const HIGH_PACE_MARGIN_PERCENT = 10;
const EARLY_DEPLETION_MARGIN_MS = 30 * 60 * 1000;

export function buildUsagePace({
  slot,
  now = new Date(),
  windowMs = SESSION_WINDOW_MS,
  localHistory = null
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
  const localActivity = summarizeLocalActivity(localHistory, windowStart, currentTime);

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
    projectedDepletionAt,
    localActivity
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
    localActivity: { totalTokens: 0, cost: 0, bucketCount: 0 },
    ...overrides
  };
}

function projectDepletion({ percent, elapsedMs, windowStart }) {
  if (percent <= 0 || elapsedMs <= 0) return null;
  const projectedMs = (elapsedMs / percent) * 100;
  return new Date(windowStart.getTime() + projectedMs);
}

function summarizeLocalActivity(localHistory, windowStart, now) {
  const buckets = [
    ...(localHistory?.hourly ?? []).map(bucket => ({
      date: normalizeDate(bucket.hour),
      totalTokens: Number(bucket.totalTokens ?? 0),
      cost: Number(bucket.cost ?? 0)
    })),
    ...(localHistory?.daily ?? []).map(bucket => ({
      date: normalizeDate(`${bucket.date}T23:59:59.999`),
      totalTokens: Number(bucket.totalTokens ?? 0),
      cost: Number(bucket.cost ?? 0)
    }))
  ].filter(bucket =>
    bucket.date &&
    bucket.date >= windowStart &&
    bucket.date <= now
  );

  return buckets.reduce(
    (summary, bucket) => ({
      totalTokens: summary.totalTokens + (Number.isFinite(bucket.totalTokens) ? bucket.totalTokens : 0),
      cost: summary.cost + (Number.isFinite(bucket.cost) ? bucket.cost : 0),
      bucketCount: summary.bucketCount + 1
    }),
    { totalTokens: 0, cost: 0, bucketCount: 0 }
  );
}

function normalizeDate(value) {
  if (!value) return null;
  const date = value instanceof Date ? value : new Date(value);
  return Number.isNaN(date.getTime()) ? null : date;
}

function roundPercent(value) {
  return Math.round(value * 10) / 10;
}
