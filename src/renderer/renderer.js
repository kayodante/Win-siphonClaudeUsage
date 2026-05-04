import {
  formatCurrency,
  formatDayTime,
  formatPercent,
  formatRelativeUpdated,
  formatResetDistance,
  levelForPercent
} from '../shared/format.js';
import { resolveView } from './viewState.js';

const elements = {
  refreshButton: document.querySelector('#refreshButton'),
  settingsButton: document.querySelector('#settingsButton'),
  backButton: document.querySelector('#backButton'),
  onboardView: document.querySelector('#onboardView'),
  onboardSignInButton: document.querySelector('#onboardSignInButton'),
  onboardCodeForm: document.querySelector('#onboardCodeForm'),
  onboardCodeInput: document.querySelector('#onboardCodeInput'),
  onboardCancelButton: document.querySelector('#onboardCancelButton'),
  mainView: document.querySelector('#mainView'),
  settingsView: document.querySelector('#settingsView'),
  sessionPercent: document.querySelector('#sessionPercent'),
  sessionMeter: document.querySelector('#sessionMeter'),
  sessionReset: document.querySelector('#sessionReset'),
  notificationState: document.querySelector('#notificationState'),
  notificationStateLabel: document.querySelector('#notificationStateLabel'),
  notificationIconOn: document.querySelector('#notificationIconOn'),
  notificationIconOff: document.querySelector('#notificationIconOff'),
  weeklyAll: document.querySelector('#weeklyAll'),
  weeklySonnet: document.querySelector('#weeklySonnet'),
  todayCost: document.querySelector('#todayCost'),
  monthCost: document.querySelector('#monthCost'),
  signOutButton: document.querySelector('#signOutButton'),
  lastUpdated: document.querySelector('#lastUpdated'),
  claudePath: document.querySelector('#claudePath'),
  settingsNotificationsToggle: document.querySelector('#settingsNotificationsToggle'),
  settingsFloatingToggle: document.querySelector('#settingsFloatingToggle'),
  errorText: document.querySelector('#errorText')
};

let appInfo = {
  configDir: '--',
  claudeDir: '--',
  notificationsSupported: false
};
let currentState = null;
let requestedView = 'main';

elements.refreshButton.addEventListener('click', () => window.siphon.refresh());
elements.settingsButton.addEventListener('click', () => window.siphon.showSettingsView());
elements.backButton.addEventListener('click', () => window.siphon.showMainView());
elements.onboardSignInButton.addEventListener('click', () => window.siphon.startSignIn());
elements.onboardCancelButton.addEventListener('click', () => window.siphon.cancelAuth());
elements.signOutButton.addEventListener('click', () => window.siphon.signOut());

// Window controls
document.querySelector('#minimizeButton').addEventListener('click', () => window.siphon.minimize());
document.querySelector('#closeButton').addEventListener('click', () => window.siphon.closeWindow());

// Footer
document.querySelector('#openClaudeLink').addEventListener('click', event => {
  event.preventDefault();
  window.siphon.openExternal('https://claude.ai/settings/usage');
});
document.querySelector('#footerQuitButton').addEventListener('click', () => {
  window.siphon.quit();
});
elements.settingsNotificationsToggle.addEventListener('change', async event => {
  try {
    await window.siphon.setPreference('notifications.sessionReset', event.target.checked);
  } catch (error) {
    console.error('Failed to save notification preference', error);
    event.target.checked = !event.target.checked;
    elements.errorText.textContent = 'Could not save notification preference.';
  }
});
elements.settingsFloatingToggle.addEventListener('change', async event => {
  try {
    await window.siphon.setPreference('floating.enabled', event.target.checked);
  } catch (error) {
    console.error('Failed to save floating widget preference', error);
    event.target.checked = !event.target.checked;
    elements.errorText.textContent = 'Could not save floating widget preference.';
  }
});
document.querySelector('#toggleKeyVisibility').addEventListener('click', () => {
  const input = document.querySelector('#apiKeyInput');
  input.type = input.type === 'password' ? 'text' : 'password';
});
document.querySelector('#saveApiKeyButton').addEventListener('click', () => {
  elements.errorText.textContent = 'API key saving not yet implemented.';
  setTimeout(() => { elements.errorText.textContent = ''; }, 3000);
});
elements.onboardCodeForm.addEventListener('submit', event => {
  event.preventDefault();
  const code = elements.onboardCodeInput.value.trim();
  if (code) window.siphon.submitCode(code);
});

try {
  appInfo = await window.siphon.getAppInfo();
  window.siphon.onView(showView);
  window.siphon.onState(render);
  render(await window.siphon.getState());
} catch (error) {
  console.error('Renderer bootstrap failed', error);
  if (elements.errorText) {
    elements.errorText.textContent = 'Could not load app state. Try restarting Siphon.';
  }
}

// Re-render the relative "updated Xs ago" line every 30s so it stays current
// even when no state event fires.
setInterval(updateLastUpdatedLine, 30_000);

function render(state) {
  currentState = state;
  if (!state.isSignedIn) {
    requestedView = 'main';
  }
  const session = hydrateSlot(state.quota?.session);
  const weeklyAll = hydrateSlot(state.quota?.weeklyAll);
  const weeklySonnet = hydrateSlot(state.quota?.weeklySonnet);
  const notificationsEnabled = state.preferences?.notifications?.sessionReset ?? true;
  const floatingEnabled = state.preferences?.floating?.enabled ?? false;
  const sessionPercent = clampPercent(session?.percent ?? 0);

  renderActiveView();

  elements.sessionPercent.textContent = session ? formatPercent(session.percent) : '--';
  renderSessionBar(sessionPercent);
  elements.sessionReset.textContent = session
    ? `Resets in ${formatResetDistance(session.resetsAt)} · ${formatDayTime(session.resetsAt)}`
    : 'Sign in to load plan limits';

  renderNotificationPill(notificationsEnabled);

  elements.weeklyAll.textContent = weeklyAll ? formatPercent(weeklyAll.percent) : '--';
  elements.weeklySonnet.textContent = weeklySonnet ? formatPercent(weeklySonnet.percent) : '--';
  elements.todayCost.textContent = formatCurrency(state.todayStats?.cost);
  elements.monthCost.textContent = formatCurrency(state.monthStats?.cost);
  updateLastUpdatedLine();

  elements.signOutButton.hidden = !state.isSignedIn;
  elements.onboardSignInButton.hidden = state.awaitingCode;
  elements.onboardCodeForm.hidden = !state.awaitingCode;
  elements.settingsNotificationsToggle.checked = notificationsEnabled;
  elements.settingsFloatingToggle.checked = floatingEnabled;

  elements.errorText.textContent = [state.localError, state.quotaError, state.authError]
    .filter(Boolean)
    .join(' ');

  renderSettings(state);
}

function updateLastUpdatedLine() {
  if (!currentState) return;
  elements.lastUpdated.textContent = currentState.lastUpdated
    ? formatRelativeUpdated(new Date(currentState.lastUpdated))
    : '--';
}

function renderNotificationPill(enabled) {
  elements.notificationStateLabel.textContent = enabled ? 'Reset notification ON' : 'Reset notification OFF';
  elements.notificationState.dataset.tone = enabled ? 'accent' : 'muted';
  elements.notificationIconOn.hidden = !enabled;
  elements.notificationIconOff.hidden = enabled;
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

function renderSessionBar(percent) {
  const total = 20;
  const level = levelForPercent(percent);
  const filled = Math.round((percent / 100) * total);
  const meter = elements.sessionMeter;
  meter.dataset.level = level;
  meter.innerHTML = '';
  for (let i = 0; i < total; i++) {
    const seg = document.createElement('div');
    seg.className = i < filled ? 'meter-segment active' : 'meter-segment';
    meter.appendChild(seg);
  }
}

function renderSettings(_state) {
  elements.claudePath.textContent = appInfo.claudeDir;
}

function showView(view) {
  if ((view === 'main' || view === 'settings') && (!currentState || currentState.isSignedIn)) {
    requestedView = view;
  }
  renderActiveView();
}

function renderActiveView() {
  const activeView = resolveView(currentState, requestedView);
  elements.onboardView.hidden = activeView !== 'onboard';
  elements.mainView.hidden = activeView !== 'main';
  elements.settingsView.hidden = activeView !== 'settings';
  if (activeView === 'settings' && currentState) {
    renderSettings(currentState);
  }
}
