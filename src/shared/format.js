import { t, tFormat } from './i18n.js';

const WEEKDAY_LOCALES = { en: 'en-US', 'pt-BR': 'pt-BR', ja: 'ja-JP' };

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

export function quotaDisplayValue(usedPercent, mode) {
  const used = clampPercent(usedPercent);
  return mode === 'remaining' ? 100 - used : used;
}

export function formatQuotaPercent(usedPercent, mode, suffix = '') {
  if (usedPercent == null || Number.isNaN(Number(usedPercent))) return '--';
  const base = formatPercent(quotaDisplayValue(usedPercent, mode));
  return suffix ? `${base} ${suffix}` : base;
}

export function maskEmail(email) {
  if (!email || typeof email !== 'string') return '';
  const at = email.indexOf('@');
  if (at === -1) return '*'.repeat(email.length);
  const local = email.slice(0, at);
  const domain = email.slice(at + 1);
  const maskedLocal = '*'.repeat(local.length);
  const dot = domain.lastIndexOf('.');
  if (dot === -1) return `${maskedLocal}@${'*'.repeat(domain.length)}`;
  const name = domain.slice(0, dot);
  const tld = domain.slice(dot);
  return `${maskedLocal}@${'*'.repeat(name.length)}${tld}`;
}

export function levelForPercent(value) {
  if (value >= 85) return 'critical';
  if (value >= 70) return 'high';
  if (value >= 40) return 'warn';
  return 'ok';
}

export function clampPercent(value) {
  const numeric = Number(value);
  if (!Number.isFinite(numeric)) return 0;
  return Math.max(0, Math.min(100, Math.round(numeric)));
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
  if (diffMs <= 0) return t('time.remaining.zero', lang);
  const totalMinutes = Math.ceil(diffMs / 60_000);
  const hours = Math.floor(totalMinutes / 60);
  const minutes = totalMinutes % 60;
  if (hours > 0) return tFormat('time.remaining.hourMin', lang, { hours, minutes });
  return tFormat('time.remaining.min', lang, { minutes });
}

export function formatDaysRemaining(date, now = new Date(), lang = 'en') {
  if (!date) return '';
  const diffMs = date.getTime() - now.getTime();
  if (diffMs <= 0) return t('time.days.soon', lang);
  const days = Math.max(1, Math.ceil(diffMs / 86_400_000));
  if (days === 1) return t('time.days.one', lang);
  return tFormat('time.days.n', lang, { days });
}

export function formatWeekdayClock(date, lang = 'en') {
  if (!date) return '--';
  const locale = WEEKDAY_LOCALES[lang] ?? WEEKDAY_LOCALES.en;
  const weekday = new Intl.DateTimeFormat(locale, { weekday: 'short' }).format(date);
  const cleaned = weekday.replace('.', '');
  const capitalized = cleaned.charAt(0).toUpperCase() + cleaned.slice(1);
  return `${capitalized}, ${formatClockTime(date)}`;
}

export function formatRelativeUpdated(date, now = new Date(), lang = 'en') {
  if (!date) return t('time.updated.never', lang);
  const target = date instanceof Date ? date : new Date(date);
  if (Number.isNaN(target.getTime())) return t('time.updated.never', lang);
  const diffMs = now.getTime() - target.getTime();
  if (diffMs < 0) return t('time.updated.now', lang);
  const seconds = Math.round(diffMs / 1000);
  if (seconds < 10) return t('time.updated.now', lang);
  if (seconds < 60) return tFormat('time.updated.seconds', lang, { seconds });
  const minutes = Math.round(seconds / 60);
  if (minutes < 60) return tFormat('time.updated.minutes', lang, { minutes });
  const hours = Math.round(minutes / 60);
  if (hours < 24) return tFormat('time.updated.hours', lang, { hours });
  const days = Math.round(hours / 24);
  return tFormat('time.updated.days', lang, { days });
}

export function formatTokens(n, lang = 'en') {
  if (n == null || Number.isNaN(n) || n === 0) return null;
  const value = n >= 1_000_000 ? `${(n / 1_000_000).toFixed(1)}M` : n >= 1_000 ? `${(n / 1_000).toFixed(1)}K` : `${n}`;
  return tFormat('format.tokens', lang, { value });
}

export function hydrateSlot(slot) {
  if (!slot) return null;
  return {
    percent: slot.percent,
    resetsAt: slot.resetsAt ? new Date(slot.resetsAt) : null
  };
}
