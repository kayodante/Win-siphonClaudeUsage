// fallow-ignore-file unused-file -- loaded via <script src> in index.html, not a JS import
import {
  clampPercent,
  formatCurrency,
  formatPercent,
  formatRelativeUpdated,
  formatTokens,
  hydrateSlot,
  levelForPercent
} from '../shared/format.js';
import { logSafeError, redactSensitive } from '../shared/diagnostics.js';
import { t, tFormat } from '../shared/i18n.js';
import { buildUsagePace, SESSION_WINDOW_MS } from '../shared/pace.js';
import { isPeakHour, peakHoursLocalRange } from '../shared/peakHours.js';
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
  peakHoursBadge: document.querySelector('#peakHoursBadge'),
  peakHoursInfo: document.querySelector('#peakHoursInfo'),
  weeklyPercent: document.querySelector('#weeklyPercent'),
  weeklyMeter: document.querySelector('#weeklyMeter'),
  weeklyReset: document.querySelector('#weeklyReset'),
  notificationState: document.querySelector('#notificationState'),
  notificationStateText: document.querySelector('#notificationStateText'),
  notificationIconOn: document.querySelector('#notificationIconOn'),
  notificationIconOff: document.querySelector('#notificationIconOff'),
  todayCost: document.querySelector('#todayCost'),
  todayTokens: document.querySelector('#todayTokens'),
  monthCost: document.querySelector('#monthCost'),
  monthTokens: document.querySelector('#monthTokens'),
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
  testSoundButton: document.querySelector('#testSoundButton'),
  settingsSoundVolume: document.querySelector('#settingsSoundVolume'),
  settingsExpireSoundToggle: document.querySelector('#settingsExpireSoundToggle'),
  testExpireSoundButton: document.querySelector('#testExpireSoundButton'),
  settingsExpireSoundVolume: document.querySelector('#settingsExpireSoundVolume'),
  settingsExpireAlertToggle: document.querySelector('#settingsExpireAlertToggle'),
  settingsLimitSoundToggle: document.querySelector('#settingsLimitSoundToggle'),
  testLimitSoundButton: document.querySelector('#testLimitSoundButton'),
  settingsLimitSoundVolume: document.querySelector('#settingsLimitSoundVolume'),
  settingsLimitAlertToggle: document.querySelector('#settingsLimitAlertToggle'),
  settingsRefreshInterval: document.querySelector('#settingsRefreshInterval'),
  settingsFloatingToggle: document.querySelector('#settingsFloatingToggle'),
  settingsStartupToggle: document.querySelector('#settingsStartupToggle'),
  settingsStartupShowWindowToggle: document.querySelector('#settingsStartupShowWindowToggle'),
  settingsLaunchWithClaudeCodeToggle: document.querySelector('#settingsLaunchWithClaudeCodeToggle'),
  settingsTabSystem: document.querySelector('#settingsTabSystem'),
  settingsTabNotification: document.querySelector('#settingsTabNotification'),
  settingsTabWidget: document.querySelector('#settingsTabWidget'),
  settingsTabSystemPanel: document.querySelector('#settingsTabSystemPanel'),
  settingsTabNotificationPanel: document.querySelector('#settingsTabNotificationPanel'),
  settingsTabWidgetPanel: document.querySelector('#settingsTabWidgetPanel'),
  settingsStyleClassic: document.querySelector('#settingsStyleClassic'),
  settingsStyleMini: document.querySelector('#settingsStyleMini'),
  errorText: document.querySelector('#errorText'),
  reauthButton: document.querySelector('#reauthButton'),
  appVersionText: document.querySelector('#appVersionText'),
  githubLink: document.querySelector('#githubLink'),
  highUsageBanner: document.querySelector('#highUsageBanner'),
  highUsageBannerDismiss: document.querySelector('#highUsageBannerDismiss'),
  criticalBanner: document.querySelector('#criticalBanner'),
  criticalBannerDismiss: document.querySelector('#criticalBannerDismiss'),
  offlineBanner: document.querySelector('#offlineBanner'),
  offlineBannerDismiss: document.querySelector('#offlineBannerDismiss'),
  updateBanner: document.querySelector('#updateBanner'),
  updateBannerVersion: document.querySelector('#updateBannerVersion'),
  updateBannerDownload: document.querySelector('#updateBannerDownload'),
  updateBannerDismiss: document.querySelector('#updateBannerDismiss')
};

let appInfo = {
  configDir: '--',
  claudeDir: '--',
  notificationsSupported: false,
  isPackaged: false
};
let currentState = null;
let requestedView = 'main';
let offlineDismissed = false;
let updateDismissed = false;
let highUsageDismissed = false;
let criticalDismissed = false;
let currentSettingsTab = 'system';
let _tabTransitioning = false;
let prevSessionPercent = null;
let prevRenderedSessionPct = null;
let prevRenderedWeeklyPct = null;
let updateUrl = null;
let downloadState = 'idle'; // 'idle' | 'downloading' | 'ready'
let downloadedFilePath = null;
let updateVersion = null;
let updateDownloadUrl = null;
let updateChecksumUrl = null;
let updateWingetManaged = false;
let isEntering = false;
let lastEnterTime = 0;
const animatingElements = new Map();

const reducedMotion = () => window.matchMedia('(prefers-reduced-motion: reduce)').matches;
function cubicEaseOut(t) { return 1 - (1 - t) ** 3; }

function showBanner(el) {
  if (!el.hidden && !el.hasAttribute('data-leaving')) return;
  el.removeAttribute('data-leaving');
  el.hidden = false;
  if (reducedMotion()) return;
  requestAnimationFrame(() => {
    el.setAttribute('data-entering', '');
    el.addEventListener('animationend', () => el.removeAttribute('data-entering'), { once: true });
  });
}

function hideBanner(el) {
  if (el.hidden || el.hasAttribute('data-leaving')) return;
  el.removeAttribute('data-entering');
  if (reducedMotion()) { el.hidden = true; return; }
  el.setAttribute('data-leaving', '');
  el.addEventListener('animationend', () => {
    el.hidden = true;
    el.removeAttribute('data-leaving');
  }, { once: true });
}

function flashUpdate(el) {
  if (reducedMotion()) return;
  el.classList.remove('data-updated');
  void el.offsetWidth;
  el.classList.add('data-updated');
  el.addEventListener('animationend', () => el.classList.remove('data-updated'), { once: true });
}

function setDownloadUI(state, percent) {
  const btn = elements.updateBannerDownload;
  const dismiss = elements.updateBannerDismiss;
  const lang = currentState?.preferences?.language ?? 'en';
  downloadState = state;
  btn.dataset.state = state;
  if (state === 'winget') {
    btn.textContent = lang === 'pt-BR' ? 'Atualizar e reiniciar' : 'Update & restart';
    btn.disabled = false;
    dismiss.hidden = false;
  } else if (state === 'updating') {
    btn.textContent = lang === 'pt-BR' ? 'Atualizando…' : 'Updating…';
    btn.disabled = true;
    dismiss.hidden = true;
  } else if (state === 'downloading') {
    btn.textContent = `${percent}%`;
    btn.disabled = true;
    dismiss.hidden = true;
  } else if (state === 'ready') {
    btn.textContent = lang === 'pt-BR' ? 'Instalar' : 'Install';
    btn.disabled = false;
    dismiss.hidden = false;
  } else {
    btn.textContent = lang === 'pt-BR' ? 'Baixar' : 'Download';
    btn.disabled = false;
    dismiss.hidden = false;
  }
}


function handleToggleError(logMsg, error, event, errorKey) {
  logSafeError(logMsg, error);
  if (event && event.target) {
    event.target.checked = !event.target.checked;
  }
  if (errorKey && elements.errorText) {
    elements.errorText.textContent = t(errorKey, currentLanguage());
  }
}
function triggerResetFlash() {
  if (reducedMotion()) return;
  const el = elements.sessionPercent;
  el.removeAttribute('data-just-reset');
  void el.offsetWidth;
  el.dataset.justReset = '';
  el.addEventListener('animationend', () => delete el.dataset.justReset, { once: true });
}

const QUOTA_COLOR_WAYPOINTS = [
  { at: 0,   l: 90, c: 0,     h: 92 },
  { at: 65,  l: 90, c: 0,     h: 92 },
  { at: 70,  l: 88, c: 0.163, h: 92 },
  { at: 90,  l: 72, c: 0.181, h: 46 },
  { at: 100, l: 58, c: 0.214, h: 17 }
];

function interpolateQuotaColor(pct) {
  const wps = QUOTA_COLOR_WAYPOINTS;
  if (pct <= wps[0].at) return wps[0];
  if (pct >= wps[wps.length - 1].at) return wps[wps.length - 1];
  for (let i = 0; i < wps.length - 1; i++) {
    if (wps[i].at <= pct && pct <= wps[i + 1].at) {
      const t = (pct - wps[i].at) / (wps[i + 1].at - wps[i].at);
      return {
        l: wps[i].l + t * (wps[i + 1].l - wps[i].l),
        c: wps[i].c + t * (wps[i + 1].c - wps[i].c),
        h: wps[i].h + t * (wps[i + 1].h - wps[i].h)
      };
    }
  }
  return wps[wps.length - 1];
}

function setQuotaColorDrift(element, pct) {
  const { l, c, h } = interpolateQuotaColor(pct);
  element.style.setProperty('--quota-l', `${l.toFixed(2)}%`);
  element.style.setProperty('--quota-c', c.toFixed(4));
  element.style.setProperty('--quota-h', h.toFixed(2));
}

elements.refreshButton.addEventListener('click', () => refreshNow());
elements.settingsButton.addEventListener('click', () => window.siphon.showSettingsView());
elements.settingsTabSystem.addEventListener('click', () => switchSettingsTab('system'));
elements.settingsTabNotification.addEventListener('click', () => switchSettingsTab('notification'));
elements.settingsTabWidget.addEventListener('click', () => switchSettingsTab('widget'));
elements.backButton.addEventListener('click', () => window.siphon.showMainView());
elements.onboardSignInButton.addEventListener('click', () => window.siphon.startSignIn());
elements.reauthButton.addEventListener('click', () => window.siphon.startSignIn());
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
    handleToggleError('Failed to save notification preference:', error, event, 'error.saveNotification');
  }
});
elements.settingsSoundToggle.addEventListener('change', async event => {
  try {
    await window.siphon.setPreference('notifications.sound', event.target.checked);
  } catch (error) {
    handleToggleError('Failed to save sound preference:', error, event);
  }
});
elements.testSoundButton.addEventListener('click', () => playResetSound());
elements.settingsSoundVolume.addEventListener('input', async event => {
  updateSliderFill(event.target);
  try {
    await window.siphon.setPreference('notifications.soundVolume', Number(event.target.value));
  } catch (error) {
    logSafeError('Failed to save volume preference:', error);
  }
});
elements.settingsExpireSoundToggle.addEventListener('change', async event => {
  try {
    await window.siphon.setPreference('notifications.expireSound', event.target.checked);
  } catch (error) {
    handleToggleError('Failed to save expire sound preference:', error, event);
  }
});
elements.testExpireSoundButton.addEventListener('click', () => playFullSound());
elements.settingsExpireSoundVolume.addEventListener('input', async event => {
  updateSliderFill(event.target);
  try {
    await window.siphon.setPreference('notifications.expireSoundVolume', Number(event.target.value));
  } catch (error) {
    logSafeError('Failed to save expire volume preference:', error);
  }
});
elements.settingsLimitSoundToggle.addEventListener('change', async event => {
  try {
    await window.siphon.setPreference('notifications.limitSound', event.target.checked);
  } catch (error) {
    handleToggleError('Failed to save limit sound preference:', error, event);
  }
});
elements.testLimitSoundButton.addEventListener('click', () => playLimitSound());
elements.settingsLimitSoundVolume.addEventListener('input', async event => {
  updateSliderFill(event.target);
  try {
    await window.siphon.setPreference('notifications.limitSoundVolume', Number(event.target.value));
  } catch (error) {
    logSafeError('Failed to save limit volume preference:', error);
  }
});
elements.settingsExpireAlertToggle.addEventListener('change', async event => {
  try {
    await window.siphon.setPreference('notifications.expireAlert', event.target.checked);
  } catch (error) {
    handleToggleError('Failed to save expire alert preference:', error, event);
  }
});
elements.settingsLimitAlertToggle.addEventListener('change', async event => {
  try {
    await window.siphon.setPreference('notifications.limitAlert', event.target.checked);
  } catch (error) {
    handleToggleError('Failed to save limit alert preference:', error, event);
  }
});
elements.highUsageBannerDismiss.addEventListener('click', () => {
  highUsageDismissed = true;
  hideBanner(elements.highUsageBanner);
});
elements.criticalBannerDismiss.addEventListener('click', () => {
  criticalDismissed = true;
  hideBanner(elements.criticalBanner);
});
elements.settingsRefreshInterval.addEventListener('change', async event => {
  const previousValue = String(currentState?.preferences?.refresh?.intervalSeconds ?? 30);
  try {
    await window.siphon.setPreference('refresh.intervalSeconds', Number(event.target.value));
  } catch (error) {
    logSafeError('Failed to save refresh preference:', error);
    event.target.value = previousValue;
    elements.errorText.textContent = t('error.saveRefresh', currentLanguage());
  }
});
elements.settingsFloatingToggle.addEventListener('change', async event => {
  try {
    await window.siphon.setPreference('floating.enabled', event.target.checked);
  } catch (error) {
    handleToggleError('Failed to save floating widget preference:', error, event, 'error.saveFloating');
  }
});
elements.settingsStyleClassic.addEventListener('click', async () => {
  try {
    await window.siphon.setPreference('floating.style', 'classic');
  } catch (error) {
    logSafeError('Failed to save widget style preference:', error);
  }
});
elements.settingsStyleMini.addEventListener('click', async () => {
  try {
    await window.siphon.setPreference('floating.style', 'mini');
  } catch (error) {
    logSafeError('Failed to save widget style preference:', error);
  }
});
elements.settingsStartupToggle.addEventListener('change', async event => {
  try {
    await window.siphon.setPreference('startup.openAtLogin', event.target.checked);
  } catch (error) {
    handleToggleError('Failed to save startup preference:', error, event, 'error.saveStartup');
  }
});
elements.settingsStartupShowWindowToggle.addEventListener('change', async event => {
  try {
    await window.siphon.setPreference('startup.showWindowOnLogin', event.target.checked);
  } catch (error) {
    handleToggleError('Failed to save startup window preference:', error, event, 'error.saveStartup');
  }
});
elements.settingsLaunchWithClaudeCodeToggle.addEventListener('change', async event => {
  try {
    await window.siphon.setPreference('integration.launchWithClaudeCode', event.target.checked);
  } catch (error) {
    handleToggleError('Failed to save launchWithClaudeCode preference:', error, event, 'error.saveLaunchWithClaudeCode');
  }
});
elements.settingsLanguage.addEventListener('change', async event => {
  const previousLanguage = currentLanguage();
  try {
    await window.siphon.setPreference('language', event.target.value);
  } catch (error) {
    logSafeError('Failed to save language preference:', error);
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
  window.siphon.openExternal('https://github.com/kayodante/Win-siphonClaudeUsage');
});
elements.offlineBannerDismiss.addEventListener('click', () => {
  offlineDismissed = true;
  hideBanner(elements.offlineBanner);
});

elements.updateBannerDismiss.addEventListener('click', () => {
  updateDismissed = true;
  setDownloadUI('idle', 0);
  hideBanner(elements.updateBanner);
});
elements.updateBannerDownload.addEventListener('click', () => {
  if (downloadState === 'winget') {
    setDownloadUI('updating', 0);
    window.siphon.installViaWinget();
  } else if (downloadState === 'idle') {
    if (!updateDownloadUrl) { if (updateUrl) window.siphon.openExternal(updateUrl); return; }
    setDownloadUI('downloading', 0);
    window.siphon.downloadUpdate({ downloadUrl: updateDownloadUrl, checksumUrl: updateChecksumUrl, version: updateVersion });
  } else if (downloadState === 'ready') {
    window.siphon.installUpdate(downloadedFilePath);
  }
});

window.siphon.onUpdateAvailable(({ version, url, downloadUrl, checksumUrl, wingetManaged }) => {
  if (downloadState !== 'downloading' && downloadState !== 'updating') {
    updateUrl = url;
    updateVersion = version;
    updateDownloadUrl = downloadUrl ?? null;
    updateChecksumUrl = checksumUrl ?? null;
    updateWingetManaged = Boolean(wingetManaged);
  }
  const lang = currentState?.preferences?.language ?? 'en';
  elements.updateBannerVersion.textContent =
    lang === 'pt-BR' ? `v${version} disponível.` : `v${version} is available.`;
  if (updateWingetManaged) setDownloadUI('winget', 0);
  if (!updateDismissed) showBanner(elements.updateBanner);
});

window.siphon.onUpdateProgress(({ percent }) => {
  if (downloadState === 'downloading') setDownloadUI('downloading', percent);
});

window.siphon.onUpdateDownloaded(({ filePath }) => {
  downloadedFilePath = filePath;
  setDownloadUI('ready', 100);
});

window.siphon.onUpdateError(() => {
  setDownloadUI('idle', 0);
});

elements.notificationState.addEventListener('click', async () => {
  const enabled = currentState?.preferences?.notifications?.sessionReset ?? true;
  try {
    await window.siphon.setPreference('notifications.sessionReset', !enabled);
    if (!reducedMotion()) {
      elements.notificationState.classList.remove('notif-pop');
      void elements.notificationState.offsetWidth;
      elements.notificationState.classList.add('notif-pop');
      elements.notificationState.addEventListener('animationend', () => {
        elements.notificationState.classList.remove('notif-pop');
      }, { once: true });
    }
  } catch (error) {
    handleToggleError('Failed to toggle notifications:', error, null, 'error.saveNotification');
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
  console.log(
    '%c⚡ Siphon %creads your Claude session before you think to check.',
    'font-family:monospace;font-weight:bold;font-size:12px;color:oklch(84.1% 0.238 128.85)',
    'font-family:monospace;font-size:12px;color:#555'
  );
  console.log('%cgithub.com/kayodante/Win-siphonClaudeUsage', 'font-family:monospace;font-size:10px;color:#3a3a3a');
} catch (error) {
  logSafeError('Renderer bootstrap failed:', error);
  if (elements.errorText) {
    elements.errorText.textContent = t('error.loadState', 'en');
  }
}

// Re-render the relative "updated Xs ago" line every 30s so it stays current
// even when no state event fires.
setInterval(updateLastUpdatedLine, 30_000);

function cancelCountUp(element) {
  const id = animatingElements.get(element);
  if (id != null) { cancelAnimationFrame(id); animatingElements.delete(element); }
}

function setPercentValue(element, value) {
  element.textContent = formatPercent(value);
}

function animateCountUp(element, target, setValue, { duration = 650, delay = 0 } = {}) {
  if (target == null || Number.isNaN(target) || reducedMotion()) { setValue(element, target); return; }
  cancelCountUp(element);
  setValue(element, 0);
  const t0 = performance.now() + delay;
  function tick(now) {
    if (now < t0) { animatingElements.set(element, requestAnimationFrame(tick)); return; }
    const p = Math.min((now - t0) / duration, 1);
    setValue(element, cubicEaseOut(p) * target);
    if (p < 1) animatingElements.set(element, requestAnimationFrame(tick));
    else animatingElements.delete(element);
  }
  animatingElements.set(element, requestAnimationFrame(tick));
}

function render(state) {
  currentState = state;
  const lang = currentLanguage();
  applyTranslations(lang);
  if (!state.isSignedIn) {
    requestedView = 'main';
  }
  const session = hydrateSlot(state.quota?.session);
  const weekly = hydrateSlot(state.quota?.weeklyAll);
  const sessionPercent = clampPercent(session?.percent ?? 0);
  const weeklyPercent = clampPercent(weekly?.percent ?? 0);

  handleThresholdSounds(state, sessionPercent);

  renderActiveView();
  renderQuotaSection({ state, session, weekly, sessionPercent, weeklyPercent, lang });

  elements.signOutButton.hidden = !state.isSignedIn;
  elements.onboardSignInButton.hidden = state.awaitingCode;
  elements.onboardSecondary.hidden = state.awaitingCode;
  elements.onboardCodeForm.hidden = !state.awaitingCode;

  renderSettingsControls(state, lang);
  renderBannersAndErrors(state, sessionPercent, lang);
  renderSettings(state, lang);
}

function handleThresholdSounds(state, sessionPercent) {
  const expireSoundEnabled = state.preferences?.notifications?.expireSound ?? false;
  const limitSoundEnabled = state.preferences?.notifications?.limitSound ?? false;

  // Threshold crossing detection — play sound on upward cross
  if (prevSessionPercent !== null) {
    if (expireSoundEnabled && prevSessionPercent < 100 && sessionPercent >= 100) playFullSound();
    else if (limitSoundEnabled && prevSessionPercent < 90 && sessionPercent >= 90) playLimitSound();
    else if (limitSoundEnabled && prevSessionPercent < 70 && sessionPercent >= 70) playLimitSound();
  }
  // Reset dismissed state when percent drops back below threshold
  if (sessionPercent < 70) {
    highUsageDismissed = false;
    criticalDismissed = false;
  } else if (sessionPercent < 90) {
    criticalDismissed = false;
  }
  prevSessionPercent = sessionPercent;
}

function updateQuotaMeters({ session, sessionPercent, weekly, weeklyPercent, sessionPace, now, lang }) {
  setQuotaColorDrift(elements.sessionPercent, sessionPercent);
  setQuotaColorDrift(elements.weeklyPercent, weeklyPercent);

  renderMeter(elements.sessionMeter, sessionPercent);
  elements.sessionReset.textContent = buildSessionResetLine(session, now, lang);
  renderPace(elements.sessionPace, sessionPace, lang);
  const inPeakHours = isPeakHour(now);
  elements.peakHoursBadge.hidden = !inPeakHours;
  if (inPeakHours) {
    const { start, end } = peakHoursLocalRange(now);
    elements.peakHoursInfo.title = tFormat('home.peakHoursTooltip', lang, { start, end });
  }

  renderMeter(elements.weeklyMeter, weeklyPercent);
  elements.weeklyReset.textContent = buildWeeklyResetLine(weekly, now, lang);
}

function updateStatsAndPills({ state, notificationsEnabled, lang }) {
  renderNotificationPill(notificationsEnabled, lang);
  elements.todayTokens.textContent = formatTokens(state.todayStats?.totalTokens) ?? '';
  elements.monthTokens.textContent = formatTokens(state.monthStats?.totalTokens) ?? '';
  updateLastUpdatedLine();
}

function updateQuotaAnimations({ state, session, weekly, sessionPercent, weeklyPercent, entering }) {
  if (entering) {
    animateCountUp(elements.sessionPercent, sessionPercent, setPercentValue, { duration: 650, delay: 310 });
    animateCountUp(elements.weeklyPercent, weeklyPercent, setPercentValue, { duration: 650, delay: 380 });
    animateCountUp(elements.todayCost, state.todayStats?.cost, setCostValue, { duration: 600, delay: 440 });
    animateCountUp(elements.monthCost, state.monthStats?.cost, setCostValue, { duration: 600, delay: 470 });
    prevRenderedSessionPct = sessionPercent;
    prevRenderedWeeklyPct = weeklyPercent;
  } else {
    cancelCountUp(elements.sessionPercent);
    elements.sessionPercent.textContent = session ? formatPercent(session.percent) : '--';
    if (prevRenderedSessionPct !== null && prevRenderedSessionPct >= 95 && sessionPercent <= 5) {
      triggerResetFlash();
    } else if (prevRenderedSessionPct !== null && prevRenderedSessionPct !== sessionPercent) {
      flashUpdate(elements.sessionPercent);
    }
    prevRenderedSessionPct = sessionPercent;

    cancelCountUp(elements.weeklyPercent);
    elements.weeklyPercent.textContent = weekly ? formatPercent(weekly.percent) : '--';
    if (prevRenderedWeeklyPct !== null && prevRenderedWeeklyPct !== weeklyPercent) {
      flashUpdate(elements.weeklyPercent);
    }
    prevRenderedWeeklyPct = weeklyPercent;

    if (!animatingElements.has(elements.todayCost))
      setCostValue(elements.todayCost, state.todayStats?.cost);
    if (!animatingElements.has(elements.monthCost))
      setCostValue(elements.monthCost, state.monthStats?.cost);
  }
}

function renderQuotaSection({ state, session, weekly, sessionPercent, weeklyPercent, lang }) {
  const now = new Date();
  const notificationsEnabled = state.preferences?.notifications?.sessionReset ?? true;
  const sessionPace = buildUsagePace({
    slot: session,
    now,
    windowMs: SESSION_WINDOW_MS
  });

  updateQuotaMeters({ session, sessionPercent, weekly, weeklyPercent, sessionPace, now, lang });
  updateStatsAndPills({ state, notificationsEnabled, lang });

  const entering = isEntering;
  isEntering = false;

  updateQuotaAnimations({ state, session, weekly, sessionPercent, weeklyPercent, entering });
}

function renderSettingsControls(state, lang) {
  const notificationsEnabled = state.preferences?.notifications?.sessionReset ?? true;
  const soundEnabled = state.preferences?.notifications?.sound ?? false;
  const soundVolume = state.preferences?.notifications?.soundVolume ?? 1.0;
  const expireSoundEnabled = state.preferences?.notifications?.expireSound ?? false;
  const expireSoundVolume = state.preferences?.notifications?.expireSoundVolume ?? 1.0;
  const limitSoundEnabled = state.preferences?.notifications?.limitSound ?? false;
  const limitSoundVolume = state.preferences?.notifications?.limitSoundVolume ?? 1.0;
  const startupOpenAtLogin = state.preferences?.startup?.openAtLogin ?? false;
  const floatingStyle = state.preferences?.floating?.style ?? 'classic';

  elements.settingsLanguage.value = lang;
  elements.settingsNotificationsToggle.checked = notificationsEnabled;
  elements.settingsSoundToggle.checked = soundEnabled;
  elements.settingsSoundVolume.value = String(soundVolume);
  elements.settingsSoundVolume.disabled = !soundEnabled;
  updateSliderFill(elements.settingsSoundVolume);
  elements.settingsExpireSoundToggle.checked = expireSoundEnabled;
  elements.settingsExpireSoundVolume.value = String(expireSoundVolume);
  elements.settingsExpireSoundVolume.disabled = !expireSoundEnabled;
  updateSliderFill(elements.settingsExpireSoundVolume);
  elements.settingsLimitSoundToggle.checked = limitSoundEnabled;
  elements.settingsLimitSoundVolume.value = String(limitSoundVolume);
  elements.settingsLimitSoundVolume.disabled = !limitSoundEnabled;
  updateSliderFill(elements.settingsLimitSoundVolume);
  elements.settingsExpireAlertToggle.checked = state.preferences?.notifications?.expireAlert ?? false;
  elements.settingsLimitAlertToggle.checked = state.preferences?.notifications?.limitAlert ?? false;
  elements.settingsRefreshInterval.value = String(state.preferences?.refresh?.intervalSeconds ?? 30);
  elements.settingsFloatingToggle.checked = state.preferences?.floating?.enabled ?? false;
  elements.settingsStyleClassic.dataset.active = String(floatingStyle === 'classic');
  elements.settingsStyleMini.dataset.active = String(floatingStyle === 'mini');
  elements.settingsStartupToggle.checked = startupOpenAtLogin;
  elements.settingsStartupToggle.disabled = !appInfo.isPackaged;
  elements.settingsStartupShowWindowToggle.checked = state.preferences?.startup?.showWindowOnLogin ?? false;
  elements.settingsStartupShowWindowToggle.disabled = !appInfo.isPackaged || !startupOpenAtLogin;
  elements.settingsLaunchWithClaudeCodeToggle.checked = state.preferences?.integration?.launchWithClaudeCode ?? false;
  elements.settingsLaunchWithClaudeCodeToggle.disabled = !appInfo.isPackaged;
}

function renderBannersAndErrors(state, sessionPercent, lang) {
  if (sessionPercent >= 90 && !criticalDismissed) showBanner(elements.criticalBanner);
  else hideBanner(elements.criticalBanner);
  if (sessionPercent >= 70 && sessionPercent < 90 && !highUsageDismissed) showBanner(elements.highUsageBanner);
  else hideBanner(elements.highUsageBanner);

  if (!state.isOffline) offlineDismissed = false;
  if (state.isOffline && !offlineDismissed) showBanner(elements.offlineBanner);
  else hideBanner(elements.offlineBanner);
  elements.reauthButton.hidden = !state.needsReauth;
  elements.reauthButton.textContent = t('error.scope_insufficient', lang);
  elements.errorText.textContent = [
    state.localError ? t(state.localError, lang) : null,
    state.quotaError && !state.needsReauth ? t(state.quotaError, lang) : null,
    state.authError
  ].filter(Boolean).join(' ');
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
  if (enabled) {
    delete elements.notificationState.dataset.notifOff;
  } else {
    elements.notificationState.dataset.notifOff = '';
  }
  elements.notificationState.setAttribute('aria-pressed', String(enabled));
}

async function refreshNow() {
  document.body.dataset.refreshing = 'true';
  elements.refreshButton.disabled = true;
  try {
    await window.siphon.refresh();
  } catch (error) {
    logSafeError('Manual refresh failed:', error);
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
  const total = 40;
  const level = levelForPercent(percent);
  const filled = Math.round((percent / 100) * total);
  if (meter.dataset.level === level && meter.dataset.filled === String(filled)) return;
  meter.dataset.level = level;
  meter.dataset.filled = String(filled);
  if (meter.children.length !== total) {
    meter.replaceChildren();
    const fragment = document.createDocumentFragment();
    for (let i = 0; i < total; i++) {
      const seg = document.createElement('div');
      seg.className = i < filled ? 'meter-segment active' : 'meter-segment';
      seg.style.setProperty('--i', i);
      fragment.appendChild(seg);
    }
    meter.appendChild(fragment);
    return;
  }
  for (let i = 0; i < total; i++) {
    meter.children[i].classList.toggle('active', i < filled);
  }
}


function switchSettingsTab(name) {
  if (name === currentSettingsTab || _tabTransitioning) return;
  _tabTransitioning = true;
  const FADE_MS = 120;
  const panels = {
    system: elements.settingsTabSystemPanel,
    notification: elements.settingsTabNotificationPanel,
    widget: elements.settingsTabWidgetPanel
  };
  const tabs = {
    system: elements.settingsTabSystem,
    notification: elements.settingsTabNotification,
    widget: elements.settingsTabWidget
  };
  const outgoing = panels[currentSettingsTab];
  const incoming = panels[name];
  tabs[currentSettingsTab].classList.remove('settings-tab--active');
  tabs[name].classList.add('settings-tab--active');
  tabs[currentSettingsTab].setAttribute('aria-selected', 'false');
  tabs[name].setAttribute('aria-selected', 'true');
  currentSettingsTab = name;
  outgoing.style.opacity = '0';
  setTimeout(() => {
    outgoing.hidden = true;
    outgoing.style.opacity = '';
    incoming.hidden = false;
    incoming.style.opacity = '0';
    requestAnimationFrame(() => {
      requestAnimationFrame(() => {
        incoming.style.opacity = '1';
        setTimeout(() => {
          incoming.style.opacity = '';
          _tabTransitioning = false;
        }, FADE_MS);
      });
    });
  }, FADE_MS);
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

function playSound(assetPath, volumeKey) {
  const audio = new Audio(assetPath);
  audio.volume = Math.max(0, Math.min(1, Number(currentState?.preferences?.notifications?.[volumeKey] ?? 1.0)));
  audio.play().catch(error => console.warn('Could not play sound', assetPath, redactSensitive(error)));
}

function playResetSound() {
  playSound('../../assets/notificationReset.mp3', 'soundVolume');
}

function playLimitSound() {
  playSound('../../assets/notificationAlert.mp3', 'limitSoundVolume');
}

function playFullSound() {
  playSound('../../assets/notificationFull.mp3', 'expireSoundVolume');
}

function updateSliderFill(slider) {
  const min = Number(slider.min);
  const max = Number(slider.max);
  const pct = ((Number(slider.value) - min) / (max - min)) * 100;
  slider.style.setProperty('--slider-fill', `${pct}%`);
}

function initDotMatrix() {
  const wrap = document.getElementById('lastUpdatedDot');
  if (!wrap) return;

  const N = 4;
  const CENTER = 1.5;
  const CORNERS = new Set(['0,0', '0,3', '3,0', '3,3']);
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
        span.dataset.zone = r < 0.8 ? 'c' : 'i';
      }
      wrap.appendChild(span);
      dots.push(span);
    }
  }

  function tick() {
    if (document.hidden) {
      requestAnimationFrame(tick);
      return;
    }

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
    const now = Date.now();
    if (now - lastEnterTime < 2000) return;
    lastEnterTime = now;
    isEntering = true;
    document.body.dataset.entering = '1';
    setTimeout(() => {
      delete document.body.dataset.entering;
    }, 900);
  }
});
