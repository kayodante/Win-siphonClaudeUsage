import { formatPercent, formatResetDistance, levelForPercent } from '../shared/format.js';

const METER_SEGMENTS = 20;

const elements = {
  openButton: document.querySelector('#floatingOpenButton'),
  closeButton: document.querySelector('#floatingCloseButton'),
  refreshButton: document.querySelector('#floatingRefreshButton'),
  percent: document.querySelector('#floatingPercent'),
  resetLabel: document.querySelector('#floatingResetLabel'),
  resetTime: document.querySelector('#floatingResetTime'),
  meter: document.querySelector('#floatingMeter')
};

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
  elements.resetLabel.textContent = 'Could not load state';
  elements.resetTime.textContent = '';
}

function render(state) {
  const session = hydrateSlot(state.quota?.session);
  const percent = clampPercent(session?.percent ?? 0);

  elements.percent.textContent = session ? formatPercent(session.percent) : '--';

  if (session) {
    elements.resetLabel.textContent = 'Reset ';
    elements.resetTime.textContent = formatResetDistance(session.resetsAt);
  } else {
    elements.resetLabel.textContent = 'Sign in';
    elements.resetTime.textContent = '';
  }

  renderMeter(percent);
}

function renderMeter(percent) {
  const level = levelForPercent(percent);
  const filled = Math.round((percent / 100) * METER_SEGMENTS);
  const meter = elements.meter;
  meter.dataset.level = level;
  meter.innerHTML = '';
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
