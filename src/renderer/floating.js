import { formatClockTime, formatPercent, levelForPercent } from '../shared/format.js';
import { t, tFormat } from '../shared/i18n.js';

const METER_SEGMENTS = 20;

const elements = {
  openButton: document.querySelector('#floatingOpenButton'),
  closeButton: document.querySelector('#floatingCloseButton'),
  refreshButton: document.querySelector('#floatingRefreshButton'),
  titleLabel: document.querySelector('#floatingTitleLabel'),
  percent: document.querySelector('#floatingPercent'),
  resetLabel: document.querySelector('#floatingResetLabel'),
  resetTime: document.querySelector('#floatingResetTime'),
  meter: document.querySelector('#floatingMeter')
};

let currentLang = 'en';

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

try {
  window.siphon.onState(render);
  render(await window.siphon.getState());
} catch (error) {
  console.error('Floating widget bootstrap failed', error);
  elements.percent.textContent = '--';
  elements.resetLabel.textContent = t('floating.error', currentLang);
  elements.resetTime.textContent = '';
}

function render(state) {
  currentLang = languageOf(state);
  applyStaticLabels();

  const session = hydrateSlot(state.quota?.session);
  const percent = clampPercent(session?.percent ?? 0);

  elements.percent.textContent = session ? formatPercent(session.percent) : '--';

  elements.resetLabel.textContent = buildFloatingReset(session, currentLang);
  elements.resetTime.textContent = '';

  renderMeter(percent);
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

function hydrateSlot(slot) {
  if (!slot) return null;
  return {
    percent: slot.percent,
    resetsAt: slot.resetsAt ? new Date(slot.resetsAt) : null
  };
}

function clampPercent(value) {
  return Math.max(0, Math.min(100, Math.round(value)));
}
