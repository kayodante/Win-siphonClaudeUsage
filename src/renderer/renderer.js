import {
  formatCurrency,
  formatPercent,
  formatRelativeUpdated,
  hydrateSlot,
  levelForPercent
} from '../shared/format.js';
import { t, tFormat } from '../shared/i18n.js';
import { buildUsagePace, SESSION_WINDOW_MS, WEEKLY_WINDOW_MS } from '../shared/pace.js';
import { buildSessionResetLine, buildWeeklyResetLine } from '../shared/resetCopy.js';
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
  onboardSecondary: document.querySelector('.onboard-secondary'),
  mainView: document.querySelector('#mainView'),
  settingsView: document.querySelector('#settingsView'),
  sessionPercent: document.querySelector('#sessionPercent'),
  sessionMeter: document.querySelector('#sessionMeter'),
  sessionReset: document.querySelector('#sessionReset'),
  sessionPace: document.querySelector('#sessionPace'),
  weeklyPercent: document.querySelector('#weeklyPercent'),
  weeklyMeter: document.querySelector('#weeklyMeter'),
  weeklyReset: document.querySelector('#weeklyReset'),
  weeklyPace: document.querySelector('#weeklyPace'),
  notificationState: document.querySelector('#notificationState'),
  notificationStateText: document.querySelector('#notificationStateText'),
  notificationIconOn: document.querySelector('#notificationIconOn'),
  notificationIconOff: document.querySelector('#notificationIconOff'),
  todayCost: document.querySelector('#todayCost'),
  monthCost: document.querySelector('#monthCost'),
  sessionSparkline: document.querySelector('#sessionSparkline'),
  todaySparkline: document.querySelector('#todaySparkline'),
  monthSparkline: document.querySelector('#monthSparkline'),
  signOutButton: document.querySelector('#signOutButton'),
  lastUpdated: document.querySelector('#lastUpdated'),
  claudePath: document.querySelector('#claudePath'),
  editClaudePathButton: document.querySelector('#editClaudePathButton'),
  settingsName: document.querySelector('#settingsName'),
  settingsEmail: document.querySelector('#settingsEmail'),
  settingsPlanRow: document.querySelector('#settingsPlanRow'),
  settingsPlan: document.querySelector('#settingsPlan'),
  settingsLanguage: document.querySelector('#settingsLanguage'),
  settingsNotificationsToggle: document.querySelector('#settingsNotificationsToggle'),
  settingsSoundToggle: document.querySelector('#settingsSoundToggle'),
  settingsRefreshInterval: document.querySelector('#settingsRefreshInterval'),
  settingsFloatingToggle: document.querySelector('#settingsFloatingToggle'),
  settingsStartupToggle: document.querySelector('#settingsStartupToggle'),
  settingsStartupShowWindowToggle: document.querySelector('#settingsStartupShowWindowToggle'),
  errorText: document.querySelector('#errorText'),
  appVersionText: document.querySelector('#appVersionText'),
  githubLink: document.querySelector('#githubLink'),
  offlineBanner: document.querySelector('#offlineBanner'),
  offlineBannerDismiss: document.querySelector('#offlineBannerDismiss')
};

let appInfo = {
  configDir: '--',
  claudeDir: '--',
  notificationsSupported: false
};
let currentState = null;
let requestedView = 'main';
let offlineDismissed = false;

elements.refreshButton.addEventListener('click', () => refreshNow());
elements.settingsButton.addEventListener('click', () => window.siphon.showSettingsView());
elements.backButton.addEventListener('click', () => window.siphon.showMainView());
elements.onboardSignInButton.addEventListener('click', () => window.siphon.startSignIn());
elements.onboardCancelButton.addEventListener('click', () => window.siphon.cancelAuth());
elements.signOutButton.addEventListener('click', () => window.siphon.signOut());
elements.editClaudePathButton.addEventListener('click', async () => {
  const selected = await window.siphon.pickFolder();
  if (!selected) return;
  await window.siphon.setPreference('claudePath', selected);
  appInfo = await window.siphon.getAppInfo();
  elements.claudePath.textContent = appInfo.claudeDir;
});

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
    elements.errorText.textContent = t('error.saveNotification', currentLanguage());
  }
});
elements.settingsSoundToggle.addEventListener('change', async event => {
  try {
    await window.siphon.setPreference('notifications.sound', event.target.checked);
  } catch (error) {
    console.error('Failed to save sound preference', error);
    event.target.checked = !event.target.checked;
  }
});
elements.settingsRefreshInterval.addEventListener('change', async event => {
  const previousValue = String(currentState?.preferences?.refresh?.intervalSeconds ?? 30);
  try {
    await window.siphon.setPreference('refresh.intervalSeconds', Number(event.target.value));
  } catch (error) {
    console.error('Failed to save refresh preference', error);
    event.target.value = previousValue;
    elements.errorText.textContent = t('error.saveRefresh', currentLanguage());
  }
});
elements.settingsFloatingToggle.addEventListener('change', async event => {
  try {
    await window.siphon.setPreference('floating.enabled', event.target.checked);
  } catch (error) {
    console.error('Failed to save floating widget preference', error);
    event.target.checked = !event.target.checked;
    elements.errorText.textContent = t('error.saveFloating', currentLanguage());
  }
});
elements.settingsStartupToggle.addEventListener('change', async event => {
  try {
    await window.siphon.setPreference('startup.openAtLogin', event.target.checked);
  } catch (error) {
    console.error('Failed to save startup preference', error);
    event.target.checked = !event.target.checked;
    elements.errorText.textContent = t('error.saveStartup', currentLanguage());
  }
});
elements.settingsStartupShowWindowToggle.addEventListener('change', async event => {
  try {
    await window.siphon.setPreference('startup.showWindowOnLogin', event.target.checked);
  } catch (error) {
    console.error('Failed to save startup window preference', error);
    event.target.checked = !event.target.checked;
    elements.errorText.textContent = t('error.saveStartup', currentLanguage());
  }
});
elements.settingsLanguage.addEventListener('change', async event => {
  const previousLanguage = currentLanguage();
  try {
    await window.siphon.setPreference('language', event.target.value);
  } catch (error) {
    console.error('Failed to save language preference', error);
    event.target.value = previousLanguage;
    elements.errorText.textContent = t('error.saveLanguage', previousLanguage);
  }
});
elements.onboardCodeForm.addEventListener('submit', event => {
  event.preventDefault();
  const code = elements.onboardCodeInput.value.trim();
  if (code) window.siphon.submitCode(code);
});

elements.githubLink.addEventListener('click', event => {
  event.preventDefault();
  window.siphon.openExternal('https://github.com/kayodante/siphonClaudeUsage');
});
elements.offlineBannerDismiss.addEventListener('click', () => {
  offlineDismissed = true;
  elements.offlineBanner.hidden = true;
});

elements.notificationState.addEventListener('click', async () => {
  const enabled = currentState?.preferences?.notifications?.sessionReset ?? true;
  try {
    await window.siphon.setPreference('notifications.sessionReset', !enabled);
  } catch (error) {
    console.error('Failed to toggle notifications', error);
    elements.errorText.textContent = t('error.saveNotification', currentLanguage());
  }
});

initDotMatrix();

try {
  appInfo = await window.siphon.getAppInfo();
  if (appInfo.version && elements.appVersionText) {
    elements.appVersionText.textContent = `Siphon - Claude Usage  —  v ${appInfo.version}`;
  }
  window.siphon.onView(showView);
  window.siphon.onState(render);
  window.siphon.onResetSound(playResetSound);
  render(await window.siphon.getState());
} catch (error) {
  console.error('Renderer bootstrap failed', error);
  if (elements.errorText) {
    elements.errorText.textContent = t('error.loadState', 'en');
  }
}

// Re-render the relative "updated Xs ago" line every 30s so it stays current
// even when no state event fires.
setInterval(updateLastUpdatedLine, 30_000);

function render(state) {
  currentState = state;
  const lang = currentLanguage();
  applyTranslations(lang);
  if (!state.isSignedIn) {
    requestedView = 'main';
  }
  const now = new Date();
  const session = hydrateSlot(state.quota?.session);
  const weekly = hydrateSlot(state.quota?.weeklyAll);
  const notificationsEnabled = state.preferences?.notifications?.sessionReset ?? true;
  const soundEnabled = state.preferences?.notifications?.sound ?? false;
  const floatingEnabled = state.preferences?.floating?.enabled ?? false;
  const startupOpenAtLogin = state.preferences?.startup?.openAtLogin ?? false;
  const startupShowWindow = state.preferences?.startup?.showWindowOnLogin ?? false;
  const refreshInterval = state.preferences?.refresh?.intervalSeconds ?? 30;
  const sessionPercent = clampPercent(session?.percent ?? 0);
  const weeklyPercent = clampPercent(weekly?.percent ?? 0);
  const sessionPace = buildUsagePace({
    slot: session,
    now,
    windowMs: SESSION_WINDOW_MS,
    localHistory: state.localHistory
  });
  const weeklyPace = buildUsagePace({
    slot: weekly,
    now,
    windowMs: WEEKLY_WINDOW_MS,
    localHistory: state.localHistory
  });

  renderActiveView();

  elements.sessionPercent.textContent = session ? formatPercent(session.percent) : '--';
  renderMeter(elements.sessionMeter, sessionPercent);
  elements.sessionReset.textContent = buildSessionResetLine(session, now, lang);
  renderPace(elements.sessionPace, sessionPace, lang);

  elements.weeklyPercent.textContent = weekly ? formatPercent(weekly.percent) : '--';
  renderMeter(elements.weeklyMeter, weeklyPercent);
  elements.weeklyReset.textContent = buildWeeklyResetLine(weekly, now, lang);
  renderPace(elements.weeklyPace, weeklyPace, lang);

  renderNotificationPill(notificationsEnabled, lang);
  renderSparkline(elements.sessionSparkline, (state.quotaHistory?.session ?? []).map(point => ({
    label: point.timestamp,
    value: point.percent
  })), { max: 100 });

  setCostValue(elements.todayCost, state.todayStats?.cost);
  setCostValue(elements.monthCost, state.monthStats?.cost);
  renderCostSparklines(state, now);
  updateLastUpdatedLine();

  elements.signOutButton.hidden = !state.isSignedIn;
  elements.onboardSignInButton.hidden = state.awaitingCode;
  elements.onboardSecondary.hidden = state.awaitingCode;
  elements.onboardCodeForm.hidden = !state.awaitingCode;
  elements.settingsLanguage.value = lang;
  elements.settingsNotificationsToggle.checked = notificationsEnabled;
  elements.settingsSoundToggle.checked = soundEnabled;
  elements.settingsRefreshInterval.value = String(refreshInterval);
  elements.settingsFloatingToggle.checked = floatingEnabled;
  elements.settingsStartupToggle.checked = startupOpenAtLogin;
  elements.settingsStartupShowWindowToggle.checked = startupShowWindow;
  elements.settingsStartupShowWindowToggle.disabled = !startupOpenAtLogin;

  if (!state.isOffline) offlineDismissed = false;
  elements.offlineBanner.hidden = !state.isOffline || offlineDismissed;
  elements.errorText.textContent = [
    state.localError ? t(state.localError, lang) : null,
    state.quotaError,
    state.authError
  ].filter(Boolean).join(' ');

  renderSettings(state, lang);
}

function updateLastUpdatedLine() {
  if (!currentState) return;
  const lang = currentLanguage();
  elements.lastUpdated.textContent = currentState.lastUpdated
    ? formatRelativeUpdated(new Date(currentState.lastUpdated), new Date(), lang)
    : '--';
}

function renderNotificationPill(enabled, lang = currentLanguage()) {
  elements.notificationState.dataset.tone = enabled ? 'accent' : 'muted';
  elements.notificationStateText.textContent =
    t(enabled ? 'home.notif.on' : 'home.notif.off', lang);
  elements.notificationIconOn.hidden = !enabled;
  elements.notificationIconOff.hidden = enabled;
  elements.notificationState.setAttribute('aria-pressed', String(enabled));
}

async function refreshNow() {
  document.body.dataset.refreshing = 'true';
  elements.refreshButton.disabled = true;
  try {
    await window.siphon.refresh();
  } catch (error) {
    console.error('Manual refresh failed', error);
    elements.errorText.textContent = t('error.loadState', currentLanguage());
  } finally {
    elements.refreshButton.disabled = false;
    delete document.body.dataset.refreshing;
  }
}

function renderPace(element, pace, lang = currentLanguage()) {
  if (!element) return;
  element.dataset.status = pace?.status ?? 'no_data';
  element.textContent = t(`pace.${pace?.status ?? 'no_data'}`, lang);
}

function renderCostSparklines(state, now) {
  const todayKey = toDateKey(now);
  const monthPrefix = todayKey.slice(0, 7);
  const hourlyToday = (state.localHistory?.hourly ?? [])
    .filter(bucket => toDateKey(new Date(bucket.hour)) === todayKey);
  const dailyMonth = (state.localHistory?.daily ?? [])
    .filter(bucket => bucket.date?.startsWith(monthPrefix));

  renderSparkline(elements.todaySparkline, hourlyToday.map(bucket => ({
    label: bucket.hour,
    value: trendValue(bucket)
  })));
  renderSparkline(elements.monthSparkline, dailyMonth.map(bucket => ({
    label: bucket.date,
    value: trendValue(bucket)
  })));
}

function clampPercent(value) {
  return Math.max(0, Math.min(100, Math.round(value)));
}

function setCostValue(element, cost) {
  element.replaceChildren();
  if (cost == null || Number.isNaN(cost)) {
    element.textContent = '--';
    return;
  }
  const formatted = formatCurrency(cost);
  const match = formatted.match(/^([^\d.\-]+)(.*)$/);
  if (!match) {
    element.textContent = formatted;
    return;
  }
  const [, symbol, amount] = match;
  const symbolSpan = document.createElement('span');
  symbolSpan.className = 'cost-symbol';
  symbolSpan.textContent = symbol;
  const amountSpan = document.createElement('span');
  amountSpan.className = 'cost-amount';
  amountSpan.textContent = amount;
  element.append(symbolSpan, amountSpan);
}

function renderMeter(meter, percent) {
  const total = 20;
  const level = levelForPercent(percent);
  const filled = Math.round((percent / 100) * total);
  meter.dataset.level = level;
  meter.replaceChildren();
  for (let i = 0; i < total; i++) {
    const seg = document.createElement('div');
    seg.className = i < filled ? 'meter-segment active' : 'meter-segment';
    meter.appendChild(seg);
  }
}

function renderSparkline(svg, points, options = {}) {
  if (!svg) return;
  svg.replaceChildren();
  const width = 120;
  const height = 28;
  const padding = 2;
  const values = points.map(point => Number(point.value ?? 0)).filter(Number.isFinite);
  if (values.length < 2) {
    svg.dataset.empty = 'true';
    const y = height / 2;
    const line = document.createElementNS('http://www.w3.org/2000/svg', 'path');
    line.setAttribute('class', 'sparkline-line');
    line.setAttribute('d', `M${padding} ${roundSvg(y)} L${width - padding} ${roundSvg(y)}`);
    svg.append(line);
    return;
  }

  delete svg.dataset.empty;
  const min = Math.min(0, ...values);
  const max = Math.max(options.max ?? 0, ...values);
  const span = max - min || 1;
  const step = (width - padding * 2) / (values.length - 1);
  const coordinates = values.map((value, index) => {
    const x = padding + index * step;
    const y = height - padding - ((value - min) / span) * (height - padding * 2);
    return [x, y];
  });
  const d = coordinates.map(([x, y], index) =>
    `${index === 0 ? 'M' : 'L'}${roundSvg(x)} ${roundSvg(y)}`
  ).join(' ');
  const areaD = `${d} L${roundSvg(coordinates.at(-1)[0])} ${height - padding} L${padding} ${height - padding} Z`;

  const area = document.createElementNS('http://www.w3.org/2000/svg', 'path');
  area.setAttribute('class', 'sparkline-area');
  area.setAttribute('d', areaD);

  const line = document.createElementNS('http://www.w3.org/2000/svg', 'path');
  line.setAttribute('class', 'sparkline-line');
  line.setAttribute('d', d);

  svg.append(area, line);
}

function trendValue(bucket) {
  const cost = Number(bucket?.cost ?? 0);
  if (cost > 0) return cost;
  return Number(bucket?.totalTokens ?? 0);
}

function roundSvg(value) {
  return Math.round(value * 100) / 100;
}

function toDateKey(date) {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

function renderSettings(state, lang = currentLanguage()) {
  const profile = state.profile ?? {};
  elements.settingsName.textContent = profile.name ?? t('settings.signedInFallback', lang);

  const hasEmail = Boolean(profile.email);
  elements.settingsEmail.hidden = !hasEmail;
  elements.settingsEmail.textContent = hasEmail ? profile.email : '';

  const hasPlan = Boolean(profile.plan);
  elements.settingsPlanRow.hidden = !hasPlan;
  elements.settingsPlan.textContent = hasPlan ? tFormat('settings.planLabel', lang, { plan: profile.plan }) : '';

  elements.settingsLanguage.value = lang;
  elements.claudePath.textContent = appInfo.claudeDir;
}

function showView(view) {
  if ((view === 'main' || view === 'settings') && (!currentState || currentState.isSignedIn)) {
    requestedView = view;
  }
  renderActiveView();
}

let _transitioning = false;

function renderActiveView() {
  const activeView = resolveView(currentState, requestedView);
  document.body.dataset.view = activeView;

  const viewMap = { onboard: elements.onboardView, main: elements.mainView, settings: elements.settingsView };
  const incoming = viewMap[activeView];
  const outgoing = Object.values(viewMap).find(v => !v.hidden && v !== incoming);

  if (!outgoing || _transitioning) {
    elements.onboardView.hidden = activeView !== 'onboard';
    elements.mainView.hidden = activeView !== 'main';
    elements.settingsView.hidden = activeView !== 'settings';
    if (activeView === 'settings' && currentState) renderSettings(currentState);
    return;
  }

  _transitioning = true;
  outgoing.style.opacity = '0';
  outgoing.style.transform = 'translateY(-6px)';

  setTimeout(() => {
    outgoing.hidden = true;
    outgoing.style.opacity = '';
    outgoing.style.transform = '';

    incoming.hidden = false;
    incoming.style.opacity = '0';
    incoming.style.transform = 'translateY(6px)';
    if (activeView === 'settings' && currentState) renderSettings(currentState);

    requestAnimationFrame(() => requestAnimationFrame(() => {
      incoming.style.opacity = '';
      incoming.style.transform = '';
      _transitioning = false;
    }));
  }, 150);
}

function currentLanguage() {
  return currentState?.preferences?.language === 'pt-BR' ? 'pt-BR' : 'en';
}

function applyTranslations(lang) {
  document.documentElement.lang = lang;

  document.querySelectorAll('[data-i18n]').forEach(element => {
    element.textContent = t(element.dataset.i18n, lang);
  });
  document.querySelectorAll('[data-i18n-title]').forEach(element => {
    element.title = t(element.dataset.i18nTitle, lang);
  });
  document.querySelectorAll('[data-i18n-aria-label]').forEach(element => {
    element.setAttribute('aria-label', t(element.dataset.i18nAriaLabel, lang));
  });
  document.querySelectorAll('[data-i18n-placeholder]').forEach(element => {
    element.setAttribute('placeholder', t(element.dataset.i18nPlaceholder, lang));
  });
}

function playResetSound() {
  const audio = new Audio('../../assets/notification.mp3');
  audio.play().catch(error => console.warn('Could not play reset sound', error));
}

function initDotMatrix() {
  const wrap = document.getElementById('lastUpdatedDot');
  if (!wrap) return;

  const N = 5;
  const CENTER = 2;
  const CORNERS = new Set(['0,0', '0,4', '4,0', '4,4']);
  const CYCLE_MS = 1400;

  const dots = [];
  for (let row = 0; row < N; row++) {
    for (let col = 0; col < N; col++) {
      const span = document.createElement('span');
      if (CORNERS.has(`${row},${col}`)) {
        span.className = 'dmx-dot dmx-inactive';
      } else {
        const r = Math.hypot(col - CENTER, row - CENTER);
        span.className = 'dmx-dot';
        span.dataset.zone = r < 0.55 ? 'c' : r < 1.65 ? 'i' : 'o';
      }
      wrap.appendChild(span);
      dots.push(span);
    }
  }

  function tick() {
    const phase = (performance.now() % CYCLE_MS) / CYCLE_MS;
    const beat = Math.sin(phase * Math.PI * 2);
    const spike = Math.sin(phase * Math.PI * 4);
    const pulse = Math.max(0, beat) + Math.max(0, spike) * 0.55;

    for (const dot of dots) {
      const z = dot.dataset.zone;
      if (!z) continue;
      dot.style.opacity =
        z === 'c' ? Math.min(1, 0.35 + pulse * 0.95) :
        z === 'i' ? 0.16 + pulse * 0.44 :
                    0.08 + pulse * 0.08;
    }
    requestAnimationFrame(tick);
  }
  requestAnimationFrame(tick);
}

document.addEventListener('visibilitychange', () => {
  if (!document.hidden) {
    document.body.dataset.entering = '1';
    document.body.addEventListener('animationend', () => {
      delete document.body.dataset.entering;
    }, { once: true });
  }
});
