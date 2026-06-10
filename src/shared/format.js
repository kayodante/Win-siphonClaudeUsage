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
  if (value >= 85) return 'critical';
  if (value >= 70) return 'high';
  if (value >= 40) return 'warn';
  return 'ok';
}

export function clampPercent(value) {
  return Math.max(0, Math.min(100, Math.round(value)));
}

export function formatClockTime(date) {
  if (!date) return '--:--';
  const hours = String(date.getHours()).padStart(2, '0');
  const minutes = String(date.getMinutes()).padStart(2, '0');
  return `${hours}:${minutes}`;
}

export function formatTimeRemaining(date, now = new Date(), lang = 'en') {
  if (!date) return '';
  const diffMs = date.getTime() - now.getTime();
  if (diffMs <= 0) return lang === 'pt-BR' ? '0min restantes' : '0min remaining';
  const totalMinutes = Math.ceil(diffMs / 60_000);
  const hours = Math.floor(totalMinutes / 60);
  const minutes = totalMinutes % 60;
  if (hours > 0) {
    return lang === 'pt-BR'
      ? `${hours}h ${minutes}min restantes`
      : `${hours}h ${minutes}min remaining`;
  }
  return lang === 'pt-BR' ? `${minutes}min restantes` : `${minutes}min remaining`;
}

export function formatDaysRemaining(date, now = new Date(), lang = 'en') {
  if (!date) return '';
  const diffMs = date.getTime() - now.getTime();
  if (diffMs <= 0) return lang === 'pt-BR' ? 'Reseta em breve' : 'Resets soon';
  const days = Math.max(1, Math.ceil(diffMs / 86_400_000));
  if (days === 1) return lang === 'pt-BR' ? 'Reseta em 1 dia' : 'Resets in 1 day';
  return lang === 'pt-BR' ? `Reseta em ${days} dias` : `Resets in ${days} days`;
}

export function formatWeekdayClock(date, lang = 'en') {
  if (!date) return '--';
  const locale = lang === 'pt-BR' ? 'pt-BR' : 'en-US';
  const weekday = new Intl.DateTimeFormat(locale, { weekday: 'short' }).format(date);
  const cleaned = weekday.replace('.', '');
  const capitalized = cleaned.charAt(0).toUpperCase() + cleaned.slice(1);
  return `${capitalized}, ${formatClockTime(date)}`;
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

export function formatTokens(n) {
  if (n == null || Number.isNaN(n) || n === 0) return null;
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M tokens`;
  if (n >= 1_000) return `${(n / 1_000).toFixed(1)}K tokens`;
  return `${n} tokens`;
}

export function hydrateSlot(slot) {
  if (!slot) return null;
  return {
    percent: slot.percent,
    resetsAt: slot.resetsAt ? new Date(slot.resetsAt) : null
  };
}
