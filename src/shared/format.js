export function formatCurrency(value) {
  if (value == null || Number.isNaN(value)) return '--';
  return new Intl.NumberFormat('en-US', {
    style: 'currency',
    currency: 'USD',
    minimumFractionDigits: 2,
    maximumFractionDigits: 4
  }).format(value);
}

export function formatPercent(value) {
  if (value == null || Number.isNaN(value)) return '--';
  return `${Math.round(value)}%`;
}

export function levelForPercent(value) {
  if (value >= 95) return 'danger';
  if (value >= 80) return 'warn';
  return 'ok';
}

export function formatResetDistance(date, now = new Date()) {
  if (!date) return 'unknown';
  const diffMs = date.getTime() - now.getTime();
  if (diffMs <= 0) return 'soon';
  const totalMinutes = Math.ceil(diffMs / 60_000);
  const hours = Math.floor(totalMinutes / 60);
  const minutes = totalMinutes % 60;
  if (hours > 0) return `${hours} hr ${minutes} min`;
  return `${minutes} min`;
}

export function formatDayTime(date) {
  if (!date) return 'unknown';
  return new Intl.DateTimeFormat(undefined, {
    weekday: 'short',
    hour: 'numeric',
    minute: '2-digit'
  }).format(date);
}

export function formatRelativeUpdated(date, now = new Date()) {
  if (!date) return 'never updated';
  const target = date instanceof Date ? date : new Date(date);
  if (Number.isNaN(target.getTime())) return 'never updated';
  const diffMs = now.getTime() - target.getTime();
  if (diffMs < 0) return 'updated just now';
  const seconds = Math.round(diffMs / 1000);
  if (seconds < 10) return 'updated just now';
  if (seconds < 60) return `updated ${seconds}s ago`;
  const minutes = Math.round(seconds / 60);
  if (minutes < 60) return `updated ${minutes}min ago`;
  const hours = Math.round(minutes / 60);
  if (hours < 24) return `updated ${hours}h ago`;
  const days = Math.round(hours / 24);
  return `updated ${days}d ago`;
}
