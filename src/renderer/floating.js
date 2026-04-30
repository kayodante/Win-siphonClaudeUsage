import { formatPercent, formatResetDistance, levelForPercent } from '../shared/format.js';

const elements = {
  openButton: document.querySelector('#floatingOpenButton'),
  closeButton: document.querySelector('#floatingCloseButton'),
  percent: document.querySelector('#floatingPercent'),
  reset: document.querySelector('#floatingReset'),
  bar: document.querySelector('#floatingBar')
};

elements.openButton.addEventListener('click', () => {
  window.siphon.openMainWindowFromWidget();
});

elements.closeButton.addEventListener('click', event => {
  event.stopPropagation();
  window.siphon.closeFloatingWidget();
});

try {
  window.siphon.onState(render);
  render(await window.siphon.getState());
} catch (error) {
  console.error('Floating widget bootstrap failed', error);
  elements.percent.textContent = '--';
  elements.reset.textContent = 'Could not load state';
}

function render(state) {
  const session = hydrateSlot(state.quota?.session);
  const percent = clampPercent(session?.percent ?? 0);

  elements.percent.textContent = session ? formatPercent(session.percent) : '--';
  elements.reset.textContent = session
    ? `Reset ${formatResetDistance(session.resetsAt)}`
    : 'Sign in to load limits';
  elements.bar.style.width = `${percent}%`;
  elements.bar.dataset.level = levelForPercent(percent);
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
