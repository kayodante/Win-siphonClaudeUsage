import { logSafeError } from '../shared/diagnostics.js';
import { formatClockTime, formatCurrency, formatPercent, hydrateSlot, levelForPercent } from '../shared/format.js';
import { t, tFormat } from '../shared/i18n.js';

const METER_SEGMENTS = 20;

const LEVEL_ICONS = {
  ok: '../../assets/f-icon/f-icon-ok.png',
  warn: '../../assets/f-icon/f-icon-warn.png',
  high: '../../assets/f-icon/f-icon-high.png',
  critical: '../../assets/f-icon/f-icon-critical.png'
};

const elements = {
  logo: document.querySelector('#floatingLogo'),
  miniLogo: document.querySelector('#floatingMiniLogo'),
  miniPercent: document.querySelector('#floatingMiniPercent'),
  openButton: document.querySelector('#floatingOpenButton'),
  closeButton: document.querySelector('#floatingCloseButton'),
  expandButton: document.querySelector('#floatingExpandButton'),
  expandedPanel: document.querySelector('#floatingExpandedPanel'),
  refreshButton: document.querySelector('#floatingRefreshButton'),
  titleLabel: document.querySelector('#floatingTitleLabel'),
  percent: document.querySelector('#floatingPercent'),
  resetLabel: document.querySelector('#floatingResetLabel'),
  resetTime: document.querySelector('#floatingResetTime'),
  weeklyLabel: document.querySelector('#floatingWeeklyLabel'),
  weeklyValue: document.querySelector('#floatingWeeklyValue'),
  todayLabel: document.querySelector('#floatingTodayLabel'),
  todayValue: document.querySelector('#floatingTodayValue'),
  monthLabel: document.querySelector('#floatingMonthLabel'),
  monthValue: document.querySelector('#floatingMonthValue'),
  meter: document.querySelector('#floatingMeter')
};

let currentLang = 'en';
let currentExpanded = false;

elements.openButton.addEventListener('click', () => {
  window.siphon.openMainWindowFromWidget();
});

elements.closeButton.addEventListener('click', event => {
  event.stopPropagation();
  window.siphon.closeFloatingWidget();
});

elements.refreshButton.addEventListener('click', event => {
  event.stopPropagation();
  window.siphon.refresh();
});

elements.expandButton.addEventListener('click', event => {
  event.stopPropagation();
  window.siphon.setFloatingExpanded(!currentExpanded);
});

try {
  window.siphon.onState(render);
  render(await window.siphon.getState());
} catch (error) {
  logSafeError('Floating widget bootstrap failed:', error);
  elements.percent.textContent = '--';
  elements.percent.dataset.value = '--';
  elements.resetLabel.textContent = t('floating.error', currentLang);
  elements.resetTime.textContent = '';
}

function render(state) {
  document.body.dataset.style = state?.preferences?.floating?.style ?? 'classic';
  currentLang = languageOf(state);
  currentExpanded = Boolean(state.preferences?.floating?.expanded);
  applyStaticLabels();

  const session = hydrateSlot(state.quota?.session);
  const weekly = hydrateSlot(state.quota?.weeklyAll);
  const percent = clampPercent(session?.percent ?? 0);

  document.body.dataset.expanded = String(currentExpanded);
  elements.expandedPanel.hidden = !currentExpanded;
  const percentText = session ? formatPercent(session.percent) : '--';
  elements.percent.textContent = percentText;
  elements.percent.dataset.value = percentText;

  elements.resetLabel.textContent = buildFloatingReset(session, currentLang);
  elements.resetTime.textContent = '';

  elements.weeklyValue.textContent = weekly ? formatPercent(weekly.percent) : '--';
  elements.todayValue.textContent = formatCurrency(state.todayStats?.cost);
  elements.monthValue.textContent = formatCurrency(state.monthStats?.cost);

  renderMeter(percent);
  elements.logo.src = LEVEL_ICONS[levelForPercent(percent)] ?? LEVEL_ICONS.ok;
  if (elements.miniLogo) elements.miniLogo.src = LEVEL_ICONS[levelForPercent(percent)] ?? LEVEL_ICONS.ok;
  if (elements.miniPercent) elements.miniPercent.textContent = percentText;
}

function buildFloatingReset(session, lang) {
  if (!session) return t('floating.signIn', lang);
  const percent = clampPercent(session.percent ?? 0);
  if (percent === 0) return t('session.reset.empty', lang);
  return tFormat('reset.connector.at', lang, { time: formatClockTime(session.resetsAt) });
}

function applyStaticLabels() {
  elements.titleLabel.textContent = t('floating.title', currentLang);
  elements.refreshButton.setAttribute('aria-label', t('floating.refresh', currentLang));
  elements.closeButton.setAttribute('aria-label', t('floating.close', currentLang));
  elements.openButton.setAttribute('aria-label', t('floating.openMain', currentLang));
  elements.expandButton.setAttribute(
    'aria-label',
    t(currentExpanded ? 'floating.collapse' : 'floating.expand', currentLang)
  );
  elements.expandButton.title = t(currentExpanded ? 'floating.collapse' : 'floating.expand', currentLang);
  elements.weeklyLabel.textContent = t('floating.weekly', currentLang);
  elements.todayLabel.textContent = t('floating.today', currentLang);
  elements.monthLabel.textContent = t('floating.month', currentLang);
}

function languageOf(state) {
  return state?.preferences?.language === 'pt-BR' ? 'pt-BR' : 'en';
}

function renderMeter(percent) {
  const level = levelForPercent(percent);
  const filled = Math.round((percent / 100) * METER_SEGMENTS);
  const meter = elements.meter;
  meter.dataset.level = level;
  meter.replaceChildren();
  for (let i = 0; i < METER_SEGMENTS; i++) {
    const seg = document.createElement('div');
    seg.className = i < filled ? 'meter-segment active' : 'meter-segment';
    meter.appendChild(seg);
  }
}

function clampPercent(value) {
  return Math.max(0, Math.min(100, Math.round(value)));
}
