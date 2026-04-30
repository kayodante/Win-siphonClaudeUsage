import {
  formatCurrency,
  formatDayTime,
  formatPercent,
  formatRelativeUpdated,
  formatResetDistance,
  levelForPercent
} from '../shared/format.js';

const elements = {
  refreshButton: document.querySelector('#refreshButton'),
  historyButton: document.querySelector('#historyButton'),
  settingsButton: document.querySelector('#settingsButton'),
  backButton: document.querySelector('#backButton'),
  backFromHistoryButton: document.querySelector('#backFromHistoryButton'),
  mainView: document.querySelector('#mainView'),
  historyView: document.querySelector('#historyView'),
  settingsView: document.querySelector('#settingsView'),
  sessionPercent: document.querySelector('#sessionPercent'),
  sessionBar: document.querySelector('#sessionBar'),
  sessionReset: document.querySelector('#sessionReset'),
  notificationState: document.querySelector('#notificationState'),
  notificationStateLabel: document.querySelector('#notificationStateLabel'),
  notificationIconOn: document.querySelector('#notificationIconOn'),
  notificationIconOff: document.querySelector('#notificationIconOff'),
  weeklyAll: document.querySelector('#weeklyAll'),
  weeklySonnet: document.querySelector('#weeklySonnet'),
  todayCost: document.querySelector('#todayCost'),
  monthCost: document.querySelector('#monthCost'),
  authStatus: document.querySelector('#authStatus'),
  signInButton: document.querySelector('#signInButton'),
  signOutButton: document.querySelector('#signOutButton'),
  codeForm: document.querySelector('#codeForm'),
  codeInput: document.querySelector('#codeInput'),
  cancelAuthButton: document.querySelector('#cancelAuthButton'),
  recentDays: document.querySelector('#recentDays'),
  lastUpdated: document.querySelector('#lastUpdated'),
  configPath: document.querySelector('#configPath'),
  claudePath: document.querySelector('#claudePath'),
  settingsLogin: document.querySelector('#settingsLogin'),
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
let currentView = 'main';

elements.refreshButton.addEventListener('click', () => window.siphon.refresh());
elements.historyButton.addEventListener('click', () => showLocalView('history'));
elements.settingsButton.addEventListener('click', () => window.siphon.showSettingsView());
elements.backButton.addEventListener('click', () => window.siphon.showMainView());
elements.backFromHistoryButton.addEventListener('click', () => showLocalView('main'));
elements.signInButton.addEventListener('click', () => window.siphon.startSignIn());
elements.signOutButton.addEventListener('click', () => window.siphon.signOut());
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
elements.cancelAuthButton.addEventListener('click', () => window.siphon.cancelAuth());
elements.codeForm.addEventListener('submit', event => {
  event.preventDefault();
  const code = elements.codeInput.value.trim();
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
  const session = hydrateSlot(state.quota?.session);
  const weeklyAll = hydrateSlot(state.quota?.weeklyAll);
  const weeklySonnet = hydrateSlot(state.quota?.weeklySonnet);
  const notificationsEnabled = state.preferences?.notifications?.sessionReset ?? true;
  const floatingEnabled = state.preferences?.floating?.enabled ?? false;
  const sessionPercent = clampPercent(session?.percent ?? 0);

  elements.sessionPercent.textContent = session ? formatPercent(session.percent) : '--';
  elements.sessionBar.style.width = `${sessionPercent}%`;
  elements.sessionBar.dataset.level = levelForPercent(sessionPercent);
  elements.sessionReset.textContent = session
    ? `Resets ${formatResetDistance(session.resetsAt)} (${formatDayTime(session.resetsAt)})`
    : 'Sign in to load plan limits';

  renderNotificationPill(notificationsEnabled);

  elements.weeklyAll.textContent = weeklyAll ? formatPercent(weeklyAll.percent) : '--';
  elements.weeklySonnet.textContent = weeklySonnet ? formatPercent(weeklySonnet.percent) : '--';
  elements.todayCost.textContent = formatCurrency(state.todayStats?.cost);
  elements.monthCost.textContent = formatCurrency(state.monthStats?.cost);
  updateLastUpdatedLine();

  elements.authStatus.textContent = state.isSignedIn
    ? 'Signed in with Claude.'
    : state.awaitingCode
      ? 'Waiting for the authorization redirect.'
      : 'Not signed in.';
  elements.signInButton.hidden = state.isSignedIn || state.awaitingCode;
  elements.signOutButton.hidden = !state.isSignedIn;
  elements.settingsNotificationsToggle.checked = notificationsEnabled;
  elements.settingsFloatingToggle.checked = floatingEnabled;
  elements.codeForm.hidden = !state.awaitingCode;

  elements.errorText.textContent = [state.localError, state.quotaError, state.authError]
    .filter(Boolean)
    .join(' ');

  renderDays(state.recentDays ?? []);
  renderSettings(state);
}

function updateLastUpdatedLine() {
  if (!currentState) return;
  elements.lastUpdated.textContent = currentState.lastUpdated
    ? formatRelativeUpdated(new Date(currentState.lastUpdated))
    : '--';
}

function renderNotificationPill(enabled) {
  elements.notificationStateLabel.textContent = enabled ? 'On' : 'Off';
  elements.notificationState.dataset.tone = enabled ? 'accent' : 'muted';
  elements.notificationIconOn.hidden = !enabled;
  elements.notificationIconOff.hidden = enabled;
}

function renderDays(days) {
  elements.recentDays.replaceChildren(
    ...days.slice(0, 7).map(day => {
      const row = document.createElement('div');
      row.className = 'day-row';

      const date = document.createElement('span');
      date.className = 'date';
      date.textContent = day.date.slice(5);

      const cost = document.createElement('span');
      cost.className = 'cost';
      cost.textContent = formatCurrency(day.cost);

      row.append(date, cost);
      return row;
    })
  );
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

function renderSettings(state) {
  elements.configPath.textContent = appInfo.configDir;
  elements.claudePath.textContent = appInfo.claudeDir;
  elements.settingsLogin.textContent = state.isSignedIn
    ? 'Signed in'
    : state.awaitingCode
      ? 'Waiting for authorization'
      : 'Not signed in';
}

// IPC-driven views: 'main' and 'settings'. Triggered by tray menu or main process.
function showView(view) {
  currentView = view;
  const isSettings = view === 'settings';
  elements.mainView.hidden = isSettings;
  elements.historyView.hidden = true;
  elements.settingsView.hidden = !isSettings;
  if (currentState) {
    renderSettings(currentState);
  }
}

// Renderer-only navigation. Used for views the main process doesn't manage,
// like 'history'. Doesn't fire view-changed IPC.
function showLocalView(view) {
  currentView = view;
  elements.mainView.hidden = view !== 'main';
  elements.historyView.hidden = view !== 'history';
  elements.settingsView.hidden = view !== 'settings';
}
