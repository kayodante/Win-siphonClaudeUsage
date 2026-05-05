export function formatCurrency(value) {
  if (value == null || Number.isNaN(value)) return '--';
  return new Intl.NumberFormat('en-US', {
    style: 'currency',
    currency: 'USD',
    minimumFractionDigits: 2,
    maximumFractionDigits: 2
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

export function formatResetDistance(date, now = new Date(), lang = 'en') {
  if (!date) return lang === 'pt-BR' ? 'desconhecido' : 'unknown';
  const diffMs = date.getTime() - now.getTime();
  if (diffMs <= 0) return lang === 'pt-BR' ? 'em breve' : 'soon';
  const totalMinutes = Math.ceil(diffMs / 60_000);
  const hours = Math.floor(totalMinutes / 60);
  const minutes = totalMinutes % 60;
  if (hours > 0) return lang === 'pt-BR' ? `${hours} h ${minutes} min` : `${hours} hr ${minutes} min`;
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

export function formatRelativeUpdated(date, now = new Date(), lang = 'en') {
  if (!date) return lang === 'pt-BR' ? 'nunca atualizado' : 'never updated';
  const target = date instanceof Date ? date : new Date(date);
  if (Number.isNaN(target.getTime())) return lang === 'pt-BR' ? 'nunca atualizado' : 'never updated';
  const diffMs = now.getTime() - target.getTime();
  if (diffMs < 0) return lang === 'pt-BR' ? 'atualizado agora mesmo' : 'updated just now';
  const seconds = Math.round(diffMs / 1000);
  if (seconds < 10) return lang === 'pt-BR' ? 'atualizado agora mesmo' : 'updated just now';
  if (seconds < 60) return lang === 'pt-BR' ? `atualizado há ${seconds}s` : `updated ${seconds}s ago`;
  const minutes = Math.round(seconds / 60);
  if (minutes < 60) return lang === 'pt-BR' ? `atualizado há ${minutes}min` : `updated ${minutes}min ago`;
  const hours = Math.round(minutes / 60);
  if (hours < 24) return lang === 'pt-BR' ? `atualizado há ${hours}h` : `updated ${hours}h ago`;
  const days = Math.round(hours / 24);
  return lang === 'pt-BR' ? `atualizado há ${days}d` : `updated ${days}d ago`;
}
