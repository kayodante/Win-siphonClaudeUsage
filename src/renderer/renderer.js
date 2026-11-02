import {
  clampPercent,
  formatClockTime,
  formatCountdown,
  formatCurrency,
  formatPercent,
  formatTokens,
  formatWeekdayClock,
  hydrateSlot,
  levelForPercent,
  maskEmail,
  quotaDisplayValue
} from '../shared/format.js';
import { logSafeError, redactSensitive } from '../shared/diagnostics.js';
import { SUPPORTED_LANGUAGES, t, tFormat, formatCommandError } from '../shared/i18n.js';
import { buildUsagePace, SESSION_WINDOW_MS } from '../shared/pace.js';
import { isPeakHour, peakHoursLocalRange } from '../shared/peakHours.js';
import { buildProviderResetLine, buildSessionResetLine, buildWeeklyResetLine } from '../shared/resetCopy.js';
import { createViewSwitcher } from './viewTransition.js';
import { detectThresholdCrossings, extractChannelPercents, overviewProviders, resolveNavigation, resolveProvider, resolveView } from './viewState.js';

let i18nCache = null;

const elements = {
  overviewButton: document.querySelector('#overviewButton'),
  overviewView: document.querySelector('#overviewView'),
  overviewCards: document.querySelector('#overviewCards'),
  overviewCardTemplate: document.querySelector('#overviewCardTemplate'),
  overviewSectionTemplate: document.querySelector('#overviewSectionTemplate'),
  rail: document.querySelector('#navigationRail'),
  railToggleButton: document.querySelector('#railToggleButton'),
  refreshButton: document.querySelector('#refreshButton'),
  settingsButton: document.querySelector('#settingsButton'),
  backButton: document.querySelector('#backButton'),
  onboardView: document.querySelector('#onboardView'),
  onboardSignInButton: document.querySelector('#onboardSignInButton'),
  onboardCodeForm: document.querySelector('#onboardCodeForm'),
  onboardCodeInput: document.querySelector('#onboardCodeInput'),
  onboardCancelButton: document.querySelector('#onboardCancelButton'),
  onboardSecondary: document.querySelector('.onboard-secondary'),
  onboardWaiting: document.querySelector('#onboardWaiting'),
  onboardWaitingCancel: document.querySelector('#onboardWaitingCancel'),
  onboardWaitingCancelWrap: document.querySelector('#onboardWaitingCancelWrap'),
  onboardFallbackNotice: document.querySelector('#onboardFallbackNotice'),
  onboardWaitingHeadline: document.querySelector('#onboardWaitingHeadline'),
  onboardAuthUrl: document.querySelector('#onboardAuthUrl'),
  onboardCopyUrlButton: document.querySelector('#onboardCopyUrlButton'),
  onboardCountdown: document.querySelector('#onboardCountdown'),
  onboardHatchNotice: document.querySelector('#onboardHatchNotice'),
  mainView: document.querySelector('#mainView'),
  providerView: document.querySelector('#providerView'),
  providerHeading: document.querySelector('#providerHeading'),
  providerGroups: document.querySelector('#providerGroups'),
  providerCostGrid: document.querySelector('#providerCostGrid'),
  providerTodayCost: document.querySelector('#providerTodayCost'),
  providerTodayTokens: document.querySelector('#providerTodayTokens'),
  providerMonthCost: document.querySelector('#providerMonthCost'),
  providerMonthTokens: document.querySelector('#providerMonthTokens'),
  providerStatus: document.querySelector('#providerStatus'),
  railProviders: document.querySelector('.rail-providers'),
  providerClaudeButton: document.querySelector('#providerClaudeButton'),
  providerCodexButton: document.querySelector('#providerCodexButton'),
  providerAntigravityButton: document.querySelector('#providerAntigravityButton'),
  settingsView: document.querySelector('#settingsView'),
  sessionPercent: document.querySelector('#sessionPercent'),
  sessionQuotaSuffix: document.querySelector('#sessionQuotaSuffix'),
  sessionMeter: document.querySelector('#sessionMeter'),
  sessionReset: document.querySelector('#sessionReset'),
  sessionPace: document.querySelector('#sessionPace'),
  sessionPaceHint: document.querySelector('#sessionPaceHint'),
  peakHoursBadge: document.querySelector('#peakHoursBadge'),
  peakHoursInfo: document.querySelector('#peakHoursInfo'),
  weeklyPercent: document.querySelector('#weeklyPercent'),
  weeklyQuotaSuffix: document.querySelector('#weeklyQuotaSuffix'),
  weeklyMeter: document.querySelector('#weeklyMeter'),
  weeklyReset: document.querySelector('#weeklyReset'),
  extraUsageCard: document.querySelector('#extraUsageCard'),
  extraUsedCredits: document.querySelector('#extraUsedCredits'),
  extraMonthlyLimit: document.querySelector('#extraMonthlyLimit'),
  extraGauge: document.querySelector('#extraGauge'),
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
  settingsEmailToggle: document.querySelector('#settingsEmailToggle'),
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
  settingsQuotaMode: document.querySelector('#settingsQuotaMode'),
  settingsFloatingToggle: document.querySelector('#settingsFloatingToggle'),
  settingsPillWeeklyOption: document.querySelector('#settingsPillWeeklyOption'),
  settingsPillWeeklyToggle: document.querySelector('#settingsPillWeeklyToggle'),
  settingsStartupToggle: document.querySelector('#settingsStartupToggle'),
  settingsStartupShowWindowToggle: document.querySelector('#settingsStartupShowWindowToggle'),
  settingsUpdatesAutoCheckToggle: document.querySelector('#settingsUpdatesAutoCheckToggle'),
  settingsUpdatesAutoDownloadToggle: document.querySelector('#settingsUpdatesAutoDownloadToggle'),
  settingsLaunchWithClaudeCodeToggle: document.querySelector('#settingsLaunchWithClaudeCodeToggle'),
  settingsTabs: document.querySelector('#settingsTabs'),
  settingsTabsCard: document.querySelector('.settings-tabs-card'),
  settingsTabSystem: document.querySelector('#settingsTabSystem'),
  settingsTabNotification: document.querySelector('#settingsTabNotification'),
  settingsTabWidget: document.querySelector('#settingsTabWidget'),
  settingsTabSystemPanel: document.querySelector('#settingsTabSystemPanel'),
  settingsTabNotificationPanel: document.querySelector('#settingsTabNotificationPanel'),
  settingsTabWidgetPanel: document.querySelector('#settingsTabWidgetPanel'),
  settingsStylePicker: document.querySelector('#settingsStylePicker'),
  settingsStyleClassic: document.querySelector('#settingsStyleClassic'),
  settingsStyleMini: document.querySelector('#settingsStyleMini'),
  settingsTitle: document.querySelector('#settingsTitle'),
  errorText: document.querySelector('#errorText'),
  reauthButton: document.querySelector('#reauthButton'),
  appVersionText: document.querySelector('#appVersionText'),
  githubLink: document.querySelector('#githubLink'),
  highUsageBanner: document.querySelector('#highUsageBanner'),
  highUsageBannerTitle: document.querySelector('#highUsageBanner .usage-alert-title'),
  highUsageBannerDismiss: document.querySelector('#highUsageBannerDismiss'),
  criticalBanner: document.querySelector('#criticalBanner'),
  criticalBannerTitle: document.querySelector('#criticalBanner .usage-alert-title'),
  criticalBannerDismiss: document.querySelector('#criticalBannerDismiss'),
  offlineBanner: document.querySelector('#offlineBanner'),
  offlineBannerDismiss: document.querySelector('#offlineBannerDismiss'),
  updateBanner: document.querySelector('#updateBanner'),
  updateBannerVersion: document.querySelector('#updateBannerVersion'),
  updateBannerDownload: document.querySelector('#updateBannerDownload'),
  updateBannerDismiss: document.querySelector('#updateBannerDismiss'),
  downloadBanner: document.querySelector('#downloadBanner'),
  downloadBannerText: document.querySelector('#downloadBannerText'),
  politeAnnouncer: document.querySelector('#politeAnnouncer'),
  assertiveAnnouncer: document.querySelector('#assertiveAnnouncer'),
  tooltip: document.querySelector('#tooltip')
};

let appInfo = {
  configDir: '--',
  claudeDir: '--',
  notificationsSupported: false,
  isPackaged: false
};
let currentState = null;
let requestedView = 'main';
// Not persisted: the app always opens on Overview.
let requestedProvider = 'overview';
// View state lives up here, not beside renderActiveView: the bootstrap's
// first render() runs before module evaluation reaches the bottom half of
// this file, and a `let` read before its line throws.
const crossfadeTo = createViewSwitcher(
  [elements.onboardView, elements.overviewView, elements.mainView, elements.providerView, elements.settingsView],
  { fadeMs: () => cssMs('--duration-view-fade', 150), shiftPx: () => (reducedMotion() ? 0 : 6) }
);
let renderedView = null;
let renderedProvider = null;
const PROVIDER_NAMES = { claude: 'Claude Code', codex: 'Codex', antigravity: 'Antigravity' };
const overviewCards = new Map();
const groupCards = new Map();
const ENTER_SEQUENCE_MS = 900;
const ENTER_DEDUPE_MS = 250;
// An Overview card shows its source time once the reading is this old.
const STALE_READING_MS = 60 * 60 * 1000;
let enterSequenceTimer = null;
let windowEntranceFrame = null;
let lastEntranceAt = -Infinity;
let settingsReturnFocus = null;
let offlineDismissed = false;
let updateDismissed = false;
const highUsageDismissed = new Set();
const criticalDismissed = new Set();
let currentSettingsTab = 'system';
let _tabTransitioning = false;
let _tabTransitionTimer = null;
const prevChannelPercents = new Map();
let prevRenderedSessionPct = null;
let updateUrl = null;
let downloadState = 'idle'; // 'idle' | 'downloading' | 'ready'
let lastDownloadAnnouncementBucket = -1;
let updateVersion = null;
let updateDownloadUrl = null;
let updateChecksumUrl = null;
const animatingElements = new Map();

for (const announcer of [elements.politeAnnouncer, elements.assertiveAnnouncer]) {
  Object.assign(announcer.style, {
    position: 'fixed',
    width: '1px',
    height: '1px',
    overflow: 'hidden',
    clipPath: 'inset(50%)',
    whiteSpace: 'nowrap'
  });
}

const reducedMotion = () => window.matchMedia('(prefers-reduced-motion: reduce)').matches;
function cubicEaseOut(t) { return 1 - (1 - t) ** 3; }

// Durations live in styles.css. Reading them back here keeps a CSS transition
// and the JS timeout that waits on it from silently drifting apart.
function cssMs(name, fallback) {
  const raw = getComputedStyle(document.documentElement).getPropertyValue(name).trim();
  const value = parseFloat(raw);
  if (!Number.isFinite(value)) return fallback;
  return raw.endsWith('ms') ? value : value * 1000;
}

const lastAnnouncements = new WeakMap();

// The browser leg has two clocks: when we stop waiting (the backend's
// WAIT_TIMEOUT, mirrored here for display only) and when we offer the manual
// escape hatch. They are deliberately different — a hatch that opens at the
// deadline is the error screen, not an escape.
const AUTH_DEADLINE_MS = 150_000;
const AUTH_HATCH_MS = 60_000;

let authUrl = '';
let authWaitStartedAt = 0;
let authCountdownTimer = null;
let authHatchTimer = null;
let authOpenFailed = false;
let lastRenderedLang = 'en';

function announce(element, message) {
  const text = String(message ?? '').trim();
  if (!text || lastAnnouncements.get(element) === text) return;
  lastAnnouncements.set(element, text);
  element.textContent = '';
  requestAnimationFrame(() => { element.textContent = text; });
}

function setErrorText(message) {
  const text = String(message ?? '');
  if (elements.errorText.textContent === text) return;
  elements.errorText.textContent = text;
  if (text && elements.errorText.hidden) {
    announce(elements.assertiveAnnouncer, text);
  } else if (!text) {
    lastAnnouncements.delete(elements.assertiveAnnouncer);
    elements.assertiveAnnouncer.textContent = '';
  }
}

// Enter is CSS-only now (@starting-style fires the moment `hidden` clears), so
// JS just has to get out of the way. Exit still needs JS: the element has to
// stay in the DOM while it fades, so `hidden` is set on a timeout instead.
// A cancelled CSS animation never fires `animationend`, so the old
// `{ once: true }` listener bound on every show could dangle when a banner
// was hidden mid-enter; a transition retargets from wherever it actually is,
// so a hide landing mid-enter now fades from the current value instead of
// snapping to full opacity first.
const bannerLeaveTimers = new WeakMap();

function showBanner(el) {
  if (!el.hidden && !el.hasAttribute('data-leaving')) return;
  clearTimeout(bannerLeaveTimers.get(el));
  el.removeAttribute('data-leaving');
  el.hidden = false;
}

function hideBanner(el) {
  if (el.hidden || el.hasAttribute('data-leaving')) return;
  // Reduced motion keeps the exit's opacity fade (styles.css drops the travel).
  el.setAttribute('data-leaving', '');
  clearTimeout(bannerLeaveTimers.get(el));
  bannerLeaveTimers.set(el, setTimeout(() => {
    el.hidden = true;
    el.removeAttribute('data-leaving');
  }, cssMs('--duration-banner-leave', 160)));
}

function setDownloadUI(state, percent) {
  const btn = elements.updateBannerDownload;
  const dismiss = elements.updateBannerDismiss;
  const lang = currentState?.preferences?.language ?? 'en';
  const previousState = downloadState;
  downloadState = state;
  btn.dataset.state = state;
  if (state === 'downloading') {
    const progress = Math.max(0, Math.min(100, Math.round(Number(percent) || 0)));
    btn.textContent = `${progress}%`;
    btn.disabled = true;
    dismiss.hidden = true;
    // The one-line banner announces the start itself, so bucket 0 would be a
    // duplicate; progress buckets pick up at 25%.
    if (previousState !== 'downloading') lastDownloadAnnouncementBucket = 0;
    const bucket = Math.floor(progress / 25) * 25;
    if (bucket > lastDownloadAnnouncementBucket) {
      lastDownloadAnnouncementBucket = bucket;
      announce(elements.politeAnnouncer, `${t('update.title', lang)} ${bucket}%`);
    }
  } else if (state === 'ready') {
    btn.textContent = t('update.restart', lang);
    btn.disabled = false;
    dismiss.hidden = false;
  } else {
    btn.textContent = t('update.download', lang);
    btn.disabled = false;
    dismiss.hidden = false;
  }
  // The installer is already on disk — ask for the restart, not the download.
  if (state === 'ready') {
    elements.updateBannerVersion.textContent = t('update.readyToApply', lang);
    if (previousState !== 'ready') announce(elements.politeAnnouncer, elements.updateBannerVersion.textContent);
  } else if (updateVersion) {
    elements.updateBannerVersion.textContent = tFormat('update.available', lang, { version: updateVersion });
  }
  // The one-line notice owns the downloading state: it is all "I'm fetching
  // this" needs, and it is the only feedback left when the big banner was
  // dismissed. It has to name a version, so a renderer that opened mid-download
  // keeps the big banner and its percentage instead of showing a nameless line.
  if (state === 'downloading' && updateVersion) {
    elements.downloadBannerText.textContent = tFormat('update.downloading', lang, { version: updateVersion });
    showBanner(elements.downloadBanner);
    hideBanner(elements.updateBanner);
  } else {
    hideBanner(elements.downloadBanner);
  }
}


function handleToggleError(logMsg, error, event, errorKey) {
  logSafeError(logMsg, error);
  if (event && event.target && error?.kind !== 'claudeSettings') {
    event.target.checked = !event.target.checked;
  }
  const message = formatCommandError(error, currentLanguage(), errorKey);
  if (message && elements.errorText) {
    setErrorText(message);
  }
}

async function openExternal(url) {
  try {
    await window.siphon.openExternal(url);
  } catch (error) {
    logSafeError('Failed to open external link:', error);
    const message = formatCommandError(error, currentLanguage());
    if (message && elements.errorText) {
      setErrorText(message);
    }
  }
}
function triggerResetFlash(el = elements.sessionPercent) {
  if (reducedMotion() || !el) return;
  el.removeAttribute('data-just-reset');
  void el.offsetWidth;
  el.dataset.justReset = '';
  el.addEventListener('animationend', () => delete el.dataset.justReset, { once: true });
}

// Empty submit and a rejected auth_submit both land here. `.is-error` (the
// border + the routed message) and `.is-shaking` are kept orthogonal so a
// second failed attempt can replay the shake without flickering the border
// treatment off and back on — same reflow dance as triggerResetFlash.
function showCodeInputError(message) {
  const el = elements.onboardCodeInput;
  el.classList.add('is-error');
  setErrorText(message);
  if (reducedMotion()) return;
  el.classList.remove('is-shaking');
  void el.offsetWidth;
  el.classList.add('is-shaking');
  el.addEventListener('animationend', () => el.classList.remove('is-shaking'), { once: true });
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

// ── Tooltip (Today/Month "Usage estimate" info, peak hours, session pace) ──
// Native `title` can't do this job: the copy is multi-line and runs past
// 100 characters, and the triggers live inside .shell-scroll
// (overflow-y: auto), which would clip an absolutely positioned bubble.
// One fixed-position element, shared by every trigger, reads its text from
// dataset.tooltip — never `.title` for these — and repositions itself in
// viewport coordinates on every show. applyTranslations(),
// updateQuotaMeters() and renderPace() are the writers of that text.
const TOOLTIP_APPEAR_DELAY_MS = 80;
const TOOLTIP_WARM_MS = 300;
let tooltipTrigger = null;
let tooltipAppearTimer = null;
let tooltipWarmTimer = null;
let tooltipWarm = false;

function positionTooltip(anchor) {
  const tip = elements.tooltip;
  const rect = anchor.getBoundingClientRect();
  const tipRect = tip.getBoundingClientRect();
  const margin = 8;
  // Clamp horizontally to the viewport — the window's minimum width is
  // 300px and two of the three triggers sit near its right edge.
  let left = rect.left + rect.width / 2 - tipRect.width / 2;
  left = Math.max(margin, Math.min(left, window.innerWidth - tipRect.width - margin));
  let top = rect.top - tipRect.height - margin;
  const flipped = top < margin;
  if (flipped) top = rect.bottom + margin; // no room above: flip below
  tip.dataset.placement = flipped ? 'bottom' : 'top';
  // Grow from the trigger, not from the bubble's own centre, when the clamp
  // above has pushed the bubble sideways.
  tip.style.setProperty('--tooltip-origin-x', `${rect.left + rect.width / 2 - left}px`);
  tip.style.left = `${left}px`;
  tip.style.top = `${top}px`;
}

function showTooltip(trigger, anchor = trigger) {
  const text = trigger.dataset.tooltip;
  if (!text) return;
  clearTimeout(tooltipWarmTimer);
  clearTimeout(tooltipAppearTimer);
  if (tooltipWarm) {
    elements.tooltip.dataset.instant = '';
  } else {
    delete elements.tooltip.dataset.instant;
    tooltipAppearTimer = setTimeout(() => {
      tooltipWarm = true;
    }, TOOLTIP_APPEAR_DELAY_MS);
  }
  tooltipTrigger = trigger;
  elements.tooltip.textContent = text;
  positionTooltip(anchor);
  elements.tooltip.dataset.show = 'true';
}

function hideTooltip() {
  clearTimeout(tooltipAppearTimer);
  clearTimeout(tooltipWarmTimer);
  tooltipTrigger = null;
  elements.tooltip.dataset.show = 'false';
  if (tooltipWarm) {
    tooltipWarmTimer = setTimeout(() => {
      tooltipWarm = false;
      delete elements.tooltip.dataset.instant;
    }, TOOLTIP_WARM_MS);
  }
}

// Hovering anywhere on hoverTarget opens the trigger's tooltip; focus stays on
// the trigger. The peak badge uses this so the whole "PEAK" pill responds,
// not just its small info icon (which keeps keyboard focus).
function wireTooltip(trigger, hoverTarget = trigger) {
  hoverTarget.addEventListener('pointerenter', () => showTooltip(trigger, hoverTarget));
  hoverTarget.addEventListener('pointerleave', hideTooltip);
  trigger.addEventListener('focus', () => showTooltip(trigger));
  trigger.addEventListener('blur', hideTooltip);
}

document.querySelectorAll('.cost-info-btn').forEach(trigger => {
  wireTooltip(trigger, trigger.closest('.peak-badge') ?? trigger);
});
wireTooltip(elements.sessionPace);
document.addEventListener('keydown', event => {
  if (event.key === 'Escape' && tooltipTrigger) hideTooltip();
});
// The tooltip's position is computed once, on show; scrolling the panel
// underneath it would otherwise leave it pointing at empty space.
document.querySelector('.shell-scroll')?.addEventListener('scroll', hideTooltip, { passive: true });

elements.refreshButton.addEventListener('click', () => refreshNow());
elements.settingsButton.addEventListener('click', () => showView('settings'));
elements.settingsTabSystem.addEventListener('click', () => switchSettingsTab('system'));
elements.settingsTabNotification.addEventListener('click', () => switchSettingsTab('notification'));
elements.settingsTabWidget.addEventListener('click', () => switchSettingsTab('widget'));
elements.settingsTabs.addEventListener('keydown', event => {
  const tabs = [
    ['system', elements.settingsTabSystem],
    ['notification', elements.settingsTabNotification],
    ['widget', elements.settingsTabWidget]
  ];
  const currentIndex = tabs.findIndex(([, tab]) => tab === event.target);
  if (currentIndex < 0) return;

  let nextIndex;
  if (event.key === 'ArrowRight') nextIndex = (currentIndex + 1) % tabs.length;
  else if (event.key === 'ArrowLeft') nextIndex = (currentIndex - 1 + tabs.length) % tabs.length;
  else if (event.key === 'Home') nextIndex = 0;
  else if (event.key === 'End') nextIndex = tabs.length - 1;
  else return;

  event.preventDefault();
  switchSettingsTab(tabs[nextIndex][0], { focus: true });
});
elements.backButton.addEventListener('click', () => showView('main'));
elements.railToggleButton.addEventListener('click', () => {
  const toggle = () => {
    elements.rail.hidden = !elements.rail.hidden;
    renderNavigation(currentState);
  };
  // A View Transition animates snapshots (transform/opacity), so the rail can
  // slide out and back along the same edge without animating layout.
  if (document.startViewTransition && !reducedMotion()) document.startViewTransition(toggle);
  else toggle();
});
// Picking a provider always lands on its dashboard, Settings included.
for (const [provider, button] of [
  ['overview', elements.overviewButton],
  ['claude', elements.providerClaudeButton],
  ['codex', elements.providerCodexButton],
  ['antigravity', elements.providerAntigravityButton]
]) {
  button.addEventListener('click', () => {
    requestedProvider = provider;
    requestedView = 'main';
    if (currentState) render(currentState);
  });
}
elements.railProviders?.addEventListener('keydown', event => {
  const buttons = [
    elements.overviewButton,
    elements.providerClaudeButton,
    elements.providerCodexButton,
    elements.providerAntigravityButton
  ].filter(btn => btn && !btn.hidden);
  const currentIndex = buttons.indexOf(event.target);
  if (currentIndex < 0) return;

  let nextIndex;
  if (event.key === 'ArrowDown' || event.key === 'ArrowRight') {
    nextIndex = (currentIndex + 1) % buttons.length;
  } else if (event.key === 'ArrowUp' || event.key === 'ArrowLeft') {
    nextIndex = (currentIndex - 1 + buttons.length) % buttons.length;
  } else if (event.key === 'Home') {
    nextIndex = 0;
  } else if (event.key === 'End') {
    nextIndex = buttons.length - 1;
  } else {
    return;
  }

  event.preventDefault();
  buttons[nextIndex].focus();
  buttons[nextIndex].click();
});
async function beginSignIn() {
  try {
    const result = await window.siphon.startSignIn();
    authUrl = result?.url ?? '';
    authOpenFailed = result?.opened === false;
    startAuthWait(lastRenderedLang);
    render(await window.siphon.getState());
  } catch (error) {
    // A rejected startSignIn would otherwise leave the countdown ticking
    // toward a deadline no backend is honoring, with nothing on screen.
    logSafeError('Sign-in failed to start:', error);
    stopAuthWaitTimers();
    const message = formatCommandError(error, currentLanguage(), 'error.loadState');
    if (message && elements.errorText) setErrorText(message);
  }
}

elements.onboardSignInButton.addEventListener('click', beginSignIn);
elements.reauthButton.addEventListener('click', beginSignIn);
elements.onboardCancelButton.addEventListener('click', () => window.siphon.cancelAuth());
elements.onboardWaitingCancel.addEventListener('click', () => window.siphon.cancelAuth());
elements.onboardCopyUrlButton.addEventListener('click', async () => {
  if (!authUrl) return;
  try {
    await navigator.clipboard.writeText(authUrl);
  } catch (error) {
    // Clipboard can be refused (permissions, no focus). Never leave the user
    // guessing: fall back to selecting the text so Ctrl+C still works.
    logSafeError('Clipboard write failed:', error);
    const range = document.createRange();
    range.selectNodeContents(elements.onboardAuthUrl);
    const selection = window.getSelection();
    selection.removeAllRanges();
    selection.addRange(range);
    return;
  }
  elements.onboardCopyUrlButton.dataset.copied = 'true';
  announce(elements.politeAnnouncer, t('onboarding.copied', lastRenderedLang));
  setTimeout(() => elements.onboardCopyUrlButton.removeAttribute('data-copied'), 1600);
});
elements.signOutButton.addEventListener('click', () => window.siphon.signOut());
elements.editClaudePathButton.addEventListener('click', async () => {
  const selected = await window.siphon.pickFolder();
  if (!selected) return;
  try {
    await window.siphon.setPreference('claudePath', selected);
    appInfo = await window.siphon.getAppInfo();
    elements.claudePath.textContent = appInfo.claudeDir;
  } catch (error) {
    logSafeError('Failed to save Claude Code path:', error);
    const message = formatCommandError(error, currentLanguage());
    if (message && elements.errorText) {
      setErrorText(message);
    }
  }
});

// Window controls
document.querySelector('#minimizeButton').addEventListener('click', () => window.siphon.minimize());
document.querySelector('#closeButton').addEventListener('click', () => window.siphon.closeWindow());

// Rail: usage page + quit
document.querySelector('#openClaudeLink').addEventListener('click', event => {
  event.preventDefault();
  openExternal('https://claude.ai/settings/usage');
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
  highUsageDismissed.add(activeProvider());
  hideBanner(elements.highUsageBanner);
});
elements.criticalBannerDismiss.addEventListener('click', () => {
  criticalDismissed.add(activeProvider());
  hideBanner(elements.criticalBanner);
});
elements.settingsRefreshInterval.addEventListener('change', async event => {
  const previousValue = String(currentState?.preferences?.refresh?.intervalSeconds ?? 30);
  try {
    await window.siphon.setPreference('refresh.intervalSeconds', Number(event.target.value));
  } catch (error) {
    logSafeError('Failed to save refresh preference:', error);
    event.target.value = previousValue;
    const message = formatCommandError(error, currentLanguage(), 'error.saveRefresh');
    if (message && elements.errorText) setErrorText(message);
  }
});
elements.settingsFloatingToggle.addEventListener('change', async event => {
  try {
    await window.siphon.setPreference('floating.enabled', event.target.checked);
  } catch (error) {
    handleToggleError('Failed to save floating widget preference:', error, event, 'error.saveFloating');
  }
});
elements.settingsPillWeeklyToggle.addEventListener('change', async event => {
  try {
    await window.siphon.setPreference('floating.showWeekly', event.target.checked);
  } catch (error) {
    handleToggleError('Failed to save Pill weekly quota preference:', error, event, 'error.saveFloating');
  }
});

elements.settingsStyleClassic.addEventListener('click', async () => {
  try {
    await window.siphon.setPreference('floating.style', 'classic');
  } catch (error) {
    logSafeError('Failed to save widget style preference:', error);
    const message = formatCommandError(error, currentLanguage());
    if (message && elements.errorText) setErrorText(message);
  }
});
elements.settingsStyleMini.addEventListener('click', async () => {
  try {
    await window.siphon.setPreference('floating.style', 'mini');
  } catch (error) {
    logSafeError('Failed to save widget style preference:', error);
    const message = formatCommandError(error, currentLanguage());
    if (message && elements.errorText) setErrorText(message);
  }
});
elements.settingsStylePicker.addEventListener('keydown', event => {
  const options = [elements.settingsStyleClassic, elements.settingsStyleMini];
  const currentIndex = options.indexOf(event.target);
  if (currentIndex < 0) return;

  let nextIndex;
  if (event.key === 'ArrowRight' || event.key === 'ArrowDown') nextIndex = (currentIndex + 1) % options.length;
  else if (event.key === 'ArrowLeft' || event.key === 'ArrowUp') nextIndex = (currentIndex - 1 + options.length) % options.length;
  else if (event.key === 'Home') nextIndex = 0;
  else if (event.key === 'End') nextIndex = options.length - 1;
  else return;

  event.preventDefault();
  options[nextIndex].focus();
  options[nextIndex].click();
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
elements.settingsUpdatesAutoCheckToggle.addEventListener('change', async event => {
  try {
    await window.siphon.setPreference('updates.autoCheck', event.target.checked);
  } catch (error) {
    handleToggleError('Failed to save auto-update-check preference:', error, event);
  }
});
elements.settingsUpdatesAutoDownloadToggle.addEventListener('change', async event => {
  try {
    await window.siphon.setPreference('updates.autoDownload', event.target.checked);
  } catch (error) {
    handleToggleError('Failed to save auto-download preference:', error, event);
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
    const message = formatCommandError(error, previousLanguage, 'error.saveLanguage');
    if (message && elements.errorText) setErrorText(message);
  }
});
elements.settingsQuotaMode.addEventListener('change', async event => {
  const previousMode = currentState?.preferences?.display?.quotaMode ?? 'used';
  try {
    await window.siphon.setPreference('display.quotaMode', event.target.value);
  } catch (error) {
    logSafeError('Failed to save quota display mode:', error);
    event.target.value = previousMode;
    const message = formatCommandError(error, currentLanguage());
    if (message && elements.errorText) setErrorText(message);
  }
});
elements.settingsEmailToggle.addEventListener('click', async () => {
  const next = !(currentState?.preferences?.privacy?.maskEmail ?? false);
  try {
    await window.siphon.setPreference('privacy.maskEmail', next);
  } catch (error) {
    logSafeError('Failed to save email mask preference:', error);
    const message = formatCommandError(error, currentLanguage());
    if (message && elements.errorText) setErrorText(message);
  }
});
elements.onboardCodeForm.addEventListener('submit', async event => {
  event.preventDefault();
  const code = elements.onboardCodeInput.value.trim();
  if (!code) {
    showCodeInputError(t('error.submitCode', currentLanguage()));
    return;
  }
  try {
    await window.siphon.submitCode(code);
    elements.onboardCodeInput.classList.remove('is-error');
  } catch (error) {
    logSafeError('Failed to submit auth code:', error);
    showCodeInputError(formatCommandError(error, currentLanguage(), 'error.submitCode'));
  }
});

elements.githubLink.addEventListener('click', event => {
  event.preventDefault();
  openExternal('https://github.com/kayodante/Win-siphonClaudeUsage');
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
  if (downloadState === 'idle') {
    if (!updateDownloadUrl) { if (updateUrl) openExternal(updateUrl); return; }
    setDownloadUI('downloading', 0);
    window.siphon.downloadUpdate({ downloadUrl: updateDownloadUrl, checksumUrl: updateChecksumUrl, version: updateVersion });
  } else if (downloadState === 'ready') {
    window.siphon.installUpdate();
  }
});

window.siphon.onUpdateAvailable(({ version, url, downloadUrl, checksumUrl }) => {
  if (downloadState !== 'downloading') {
    updateUrl = url;
    updateVersion = version;
    updateDownloadUrl = downloadUrl ?? null;
    updateChecksumUrl = checksumUrl ?? null;
  }
  const lang = currentState?.preferences?.language ?? 'en';
  // A verified installer on disk outranks "available" — the 6-hour check
  // re-announcing the same version must not overwrite the restart prompt.
  if (downloadState !== 'ready') {
    elements.updateBannerVersion.textContent = tFormat('update.available', lang, { version });
  }
  if (!updateDismissed) {
    showBanner(elements.updateBanner);
    announce(elements.politeAnnouncer, `${t('update.title', lang)} ${elements.updateBannerVersion.textContent}`);
  }
});

window.siphon.onUpdateProgress(({ percent }) => {
  // Also covers the background auto-download, which nothing in the UI started.
  if (downloadState !== 'ready') setDownloadUI('downloading', percent);
});

window.siphon.onUpdateDownloaded(() => {
  setDownloadUI('ready', 100);
  // A verified installer on disk is new information — bring the restart prompt
  // back even if the available-banner had been dismissed.
  showBanner(elements.updateBanner);
});

window.siphon.onUpdateError(({ message } = {}) => {
  const lang = currentState?.preferences?.language ?? 'en';
  setDownloadUI('idle', 0);
  const errorText = tFormat('update.error', lang, { message: message || t('update.errorUnknown', lang) });
  elements.updateBannerVersion.textContent = errorText;
  announce(elements.assertiveAnnouncer, errorText);
  // The error text lives in the big banner, which setDownloadUI('idle') may
  // just have hidden coming out of 'downloading' — bring it back unless the
  // user dismissed it.
  if (!updateDismissed) showBanner(elements.updateBanner);
});

elements.notificationState.addEventListener('click', async () => {
  const enabled = currentState?.preferences?.notifications?.sessionReset ?? true;
  // Flip on the click, like the switches do, and put it back if saving fails.
  renderNotificationPill(!enabled);
  try {
    await window.siphon.setPreference('notifications.sessionReset', !enabled);
  } catch (error) {
    renderNotificationPill(enabled);
    handleToggleError('Failed to toggle notifications:', error, null, 'error.saveNotification');
  }
});

try {
  appInfo = await window.siphon.getAppInfo();
  if (appInfo.version && elements.appVersionText) {
    elements.appVersionText.textContent = `Siphon - Claude Usage  —  v ${appInfo.version}`;
  }
  window.siphon.onView(showView);
  window.siphon.onProviderSelect?.(provider => {
    if (provider === 'claude' || provider === 'codex' || provider === 'antigravity') {
      requestedProvider = provider;
      requestedView = 'main';
      if (currentState) render(currentState);
      else renderActiveView();
      queueWindowEntrance();
    }
  });


  if (!i18nCache) {
    i18nCache = {
      text: document.querySelectorAll('[data-i18n]'),
      title: document.querySelectorAll('[data-i18n-title]'),
      tooltip: document.querySelectorAll('[data-i18n-tooltip]'),
      ariaLabel: document.querySelectorAll('[data-i18n-aria-label]'),
      placeholder: document.querySelectorAll('[data-i18n-placeholder]')
    };
  }
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
    setErrorText(t('error.loadState', 'en'));
  }
}

function cancelCountUp(element) {
  const id = animatingElements.get(element);
  if (id != null) { cancelAnimationFrame(id); animatingElements.delete(element); }
}

function setPercentValue(element, value) {
  element.textContent = formatPercent(value);
}

function updateReading(element, target, setValue) {
  const value = target == null ? '' : String(target);
  const previous = element.dataset.entryValue;
  const unchanged = previous === value;
  element.dataset.entryValue = value;
  if (unchanged && animatingElements.has(element)) return;
  // A new reading travels from the one on screen, like a needle, instead of
  // being swapped in. Unknown readings and the entrance count-up keep their
  // own paths.
  if (!unchanged && previous && value && !animatingElements.has(element) && !document.body.dataset.entering) {
    animateCountUp(element, target, setValue, { duration: 400, from: Number(previous) });
    return;
  }
  cancelCountUp(element);
  setValue(element, target);
}

function animateCountUp(element, target, setValue, { duration = 650, delay = 0, from = 0 } = {}) {
  if (target == null || Number.isNaN(target) || reducedMotion()) { setValue(element, target); return; }
  cancelCountUp(element);
  setValue(element, from);
  const t0 = performance.now() + delay;
  function tick(now) {
    if (now < t0) { animatingElements.set(element, requestAnimationFrame(tick)); return; }
    const p = Math.min((now - t0) / duration, 1);
    setValue(element, from + cubicEaseOut(p) * (target - from));
    if (p < 1) animatingElements.set(element, requestAnimationFrame(tick));
    else animatingElements.delete(element);
  }
  animatingElements.set(element, requestAnimationFrame(tick));
}

function stopAuthWaitTimers() {
  clearInterval(authCountdownTimer);
  clearTimeout(authHatchTimer);
  authCountdownTimer = null;
  authHatchTimer = null;
}

function paintCountdown(lang) {
  const left = AUTH_DEADLINE_MS - (Date.now() - authWaitStartedAt);
  elements.onboardCountdown.textContent =
    tFormat('onboarding.waitingDeadline', lang, { time: formatCountdown(left) });
  // Park at 0:00 and stop. The backend owns the actual deadline; the renderer
  // must not decide the wait is over — its clock and tokio's can drift, and a
  // UI that gives up first would hide a callback still arriving.
  if (left <= 0) {
    clearInterval(authCountdownTimer);
    authCountdownTimer = null;
  }
}

function startAuthWait(lang) {
  stopAuthWaitTimers();
  authWaitStartedAt = Date.now();
  paintCountdown(lang);
  authCountdownTimer = setInterval(() => paintCountdown(lang), 1000);
  // Opener failure skips the delay: the user already knows the browser never
  // opened, so making them wait 60s for the alternative is pure friction.
  // Reveal the form with the notice. The render function computes this same
  // visibility, but nothing re-renders when a timer fires — waiting for the
  // next state emit would delay the hatch by up to the refresh interval.
  if (authOpenFailed) {
    elements.onboardHatchNotice.hidden = false;
    elements.onboardCodeForm.hidden = false;
    elements.onboardWaitingCancelWrap.hidden = true;
  } else {
    authHatchTimer = setTimeout(() => {
      elements.onboardHatchNotice.hidden = false;
      elements.onboardCodeForm.hidden = false;
      elements.onboardWaitingCancelWrap.hidden = true;
    }, AUTH_HATCH_MS);
  }
}

function render(state) {
  currentState = state;
  const lang = currentLanguage();
  lastRenderedLang = lang;
  applyTranslations(lang);
  if (!state.isSignedIn) {
    requestedView = 'main';
  }
  const session = hydrateSlot(state.quota?.session);
  const weekly = hydrateSlot(state.quota?.weeklyAll);
  const sessionPercent = clampPercent(session?.percent ?? 0);
  const weeklyPercent = clampPercent(weekly?.percent ?? 0);

  handleThresholdSounds(state);
  // Compact rows show the used/left suffix only in "left" mode, where the
  // number and the (always used) meter would otherwise disagree unlabelled.
  document.body.dataset.quotaMode = state.preferences?.display?.quotaMode ?? 'used';

  renderOverview(state, lang);
  renderProviderView(state, lang);
  renderQuotaSection({ state, session, weekly, sessionPercent, weeklyPercent, lang });
  indexQuotaRows(elements.mainView);
  renderActiveView();

  elements.signOutButton.hidden = !state.isSignedIn;
  const awaitingCode = Boolean(state.awaitingCode);
  const awaitingBrowser = Boolean(state.awaitingBrowser);
  elements.onboardSignInButton.hidden = awaitingCode || awaitingBrowser;
  elements.onboardSecondary.hidden = awaitingCode || awaitingBrowser;
  elements.onboardWaiting.hidden = !awaitingBrowser;

  if (awaitingBrowser) {
    elements.onboardWaitingHeadline.textContent =
      t(authOpenFailed ? 'onboarding.browserOpenFailed' : 'onboarding.waitingBrowser', lang);
    elements.onboardAuthUrl.textContent = authUrl;
    // Revealing an already-rendered live region is unreliably announced; the
    // dependable shape is a region that is present and empty, with the text put
    // in afterwards. Announce the deadline once here — never the ticking
    // countdown, which would speak 150 times.
    announce(elements.politeAnnouncer, `${elements.onboardWaitingHeadline.textContent} ${
      tFormat('onboarding.waitingDeadline', lang, { time: formatCountdown(AUTH_DEADLINE_MS) })}`);
  } else {
    lastAnnouncements.delete(elements.politeAnnouncer);
    stopAuthWaitTimers();
    elements.onboardHatchNotice.hidden = true;
    elements.onboardCopyUrlButton.removeAttribute('data-copied');
    authUrl = '';
    authOpenFailed = false;
  }

  // The paste form is the escape hatch while waiting, and the whole flow when
  // the backend put us in manual mode.
  elements.onboardCodeForm.hidden = !awaitingCode && elements.onboardHatchNotice.hidden;
  // One Cancel at a time: the code form brings its own, so the waiting-state
  // button stands down once the form is up.
  elements.onboardWaitingCancelWrap.hidden = !awaitingBrowser || !elements.onboardCodeForm.hidden;
  // The old notice claims the redirect failed. While still waiting it has not
  // failed yet, so the hatch supplies its own line and this one stays hidden.
  elements.onboardFallbackNotice.hidden = awaitingBrowser;

  renderSettingsControls(state, lang);
  renderBannersAndErrors(state, sessionPercent, lang);
  renderSettings(state, lang);
}

function providerSessionPeak(state, provider) {
  if (provider === 'claude') {
    const pct = clampPercent(state?.quota?.session?.percent ?? 0);
    return { percent: pct, sectionId: null };
  }
  let bestPercent = 0;
  let bestSectionId = null;
  for (const section of state?.[provider]?.sections ?? []) {
    const win = section?.session;
    if (win && win.percent != null && !win.rolledOver) {
      const pct = clampPercent(win.percent);
      if (pct > bestPercent || bestSectionId === null) {
        bestPercent = pct;
        bestSectionId = section.id;
      }
    } else if (!win) {
      // Sections without a session window (e.g. Gemini 4 Argon) contribute their weekly quota
      const weeklyWin = section?.weekly;
      if (weeklyWin && weeklyWin.percent != null && !weeklyWin.rolledOver) {
        const pct = clampPercent(weeklyWin.percent);
        if (pct > bestPercent || bestSectionId === null) {
          bestPercent = pct;
          bestSectionId = section.id;
        }
      }
    }
  }
  return { percent: bestPercent, sectionId: bestSectionId };
}

function handleThresholdSounds(state) {
  const expireSound = state.preferences?.notifications?.expireSound ?? false;
  const limitSound = state.preferences?.notifications?.limitSound ?? false;
  const currentChannels = extractChannelPercents(state);

  const { playFull, playLimit } = detectThresholdCrossings(prevChannelPercents, currentChannels, {
    expireSound,
    limitSound
  });

  if (playFull) {
    playFullSound();
  } else if (playLimit) {
    playLimitSound();
  }

  for (const key of prevChannelPercents.keys()) {
    if (!currentChannels.has(key)) prevChannelPercents.delete(key);
  }
  for (const [key, pct] of currentChannels.entries()) {
    prevChannelPercents.set(key, pct);
  }

  // Reset dismissed state per provider when percent drops back below threshold
  for (const provider of ['claude', 'codex', 'antigravity']) {
    const { percent } = providerSessionPeak(state, provider);
    if (percent < 70) {
      highUsageDismissed.delete(provider);
      criticalDismissed.delete(provider);
    } else if (percent < 90) {
      criticalDismissed.delete(provider);
    }
  }
}

function updateQuotaMeters({ session, sessionPercent, weekly, weeklyPercent, sessionPace, now, lang }) {
  setQuotaColorDrift(elements.sessionPercent, sessionPercent);
  setQuotaColorDrift(elements.weeklyPercent, weeklyPercent);

  renderMeter(elements.sessionMeter, sessionPercent);
  elements.sessionReset.textContent = buildSessionResetLine(session, now, lang);
  renderPace(elements.sessionPace, sessionPace, lang);
  renderPeakBadge(elements.peakHoursBadge, elements.peakHoursInfo, now, lang);

  renderMeter(elements.weeklyMeter, weeklyPercent);
  elements.weeklyReset.textContent = buildWeeklyResetLine(weekly, now, lang);
}

// Claude's peak-hours badge: on the Claude page and on its Overview card.
function renderPeakBadge(badge, info, now, lang) {
  const inPeakHours = isPeakHour(now);
  badge.hidden = !inPeakHours;
  if (!inPeakHours) return;
  const { start, end } = peakHoursLocalRange(now);
  const titleText = tFormat('home.peakHoursTooltip', lang, { start, end });
  // dataset.tooltip, not .title — see the custom tooltip wired up above,
  // which is what actually renders this copy.
  info.dataset.tooltip = titleText;
  info.setAttribute('aria-label', titleText);
  // This render loop runs every refresh tick; if the tooltip is already
  // open on this trigger, keep its visible text in sync rather than
  // waiting for the next hover/focus to pick up the new copy.
  if (tooltipTrigger === info) elements.tooltip.textContent = titleText;
}

function updateStatsAndPills({ state, notificationsEnabled, lang }) {
  renderNotificationPill(notificationsEnabled, lang);
  elements.todayTokens.textContent = formatTokens(state.todayStats?.totalTokens, lang) ?? '';
  elements.monthTokens.textContent = formatTokens(state.monthStats?.totalTokens, lang) ?? '';
  updateLastUpdatedLine();
}

function updateQuotaAnimations({ state, session, weekly, sessionPercent, weeklyPercent, mode = 'used' }) {
  const displaySession = quotaDisplayValue(sessionPercent, mode);
  const displayWeekly = quotaDisplayValue(weeklyPercent, mode);
  updateReading(elements.sessionPercent, session ? displaySession : null, setPercentValue);
  if (prevRenderedSessionPct !== null && prevRenderedSessionPct >= 95 && sessionPercent <= 5) {
    triggerResetFlash();
  }
  prevRenderedSessionPct = sessionPercent;

  updateReading(elements.weeklyPercent, weekly ? displayWeekly : null, setPercentValue);

  updateReading(elements.todayCost, state.todayStats?.cost, setCostValue);
  updateReading(elements.monthCost, state.monthStats?.cost, setCostValue);
}

function renderQuotaSection({ state, session, weekly, sessionPercent, weeklyPercent, lang }) {
  const now = new Date();
  const notificationsEnabled = state.preferences?.notifications?.sessionReset ?? true;
  const sessionPace = buildUsagePace({
    slot: session,
    now,
    windowMs: SESSION_WINDOW_MS
  });

  const mode = state.preferences?.display?.quotaMode ?? 'used';
  const suffixText = t(`quota.suffix.${mode}`, lang);
  elements.sessionQuotaSuffix.textContent = session ? suffixText : '';
  elements.weeklyQuotaSuffix.textContent = weekly ? suffixText : '';

  updateQuotaMeters({ session, sessionPercent, weekly, weeklyPercent, sessionPace, now, lang });
  renderExtraUsage(state.quota?.extraUsage);
  updateStatsAndPills({ state, notificationsEnabled, lang });

  updateQuotaAnimations({ state, session, weekly, sessionPercent, weeklyPercent, mode });
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
  elements.settingsQuotaMode.value = state.preferences?.display?.quotaMode ?? 'used';
  elements.settingsFloatingToggle.checked = state.preferences?.floating?.enabled ?? false;
  elements.settingsPillWeeklyOption.hidden = floatingStyle !== 'mini';
  elements.settingsPillWeeklyToggle.checked = state.preferences?.floating?.showWeekly ?? true;
  elements.settingsStyleClassic.dataset.active = String(floatingStyle === 'classic');
  elements.settingsStyleMini.dataset.active = String(floatingStyle === 'mini');
  elements.settingsStyleClassic.setAttribute('aria-checked', String(floatingStyle === 'classic'));
  elements.settingsStyleMini.setAttribute('aria-checked', String(floatingStyle === 'mini'));
  elements.settingsStyleClassic.tabIndex = floatingStyle === 'classic' ? 0 : -1;
  elements.settingsStyleMini.tabIndex = floatingStyle === 'mini' ? 0 : -1;
  elements.settingsStartupToggle.checked = startupOpenAtLogin;
  elements.settingsStartupToggle.disabled = !appInfo.isPackaged;
  elements.settingsStartupShowWindowToggle.checked = state.preferences?.startup?.showWindowOnLogin ?? false;
  elements.settingsStartupShowWindowToggle.disabled = !appInfo.isPackaged || !startupOpenAtLogin;
  elements.settingsLaunchWithClaudeCodeToggle.checked = state.preferences?.integration?.launchWithClaudeCode ?? false;
  elements.settingsLaunchWithClaudeCodeToggle.disabled = !appInfo.isPackaged;
  const autoCheck = state.preferences?.updates?.autoCheck ?? true;
  elements.settingsUpdatesAutoCheckToggle.checked = autoCheck;
  elements.settingsUpdatesAutoDownloadToggle.checked = state.preferences?.updates?.autoDownload ?? false;
  elements.settingsUpdatesAutoDownloadToggle.disabled = !autoCheck;
}

function renderBannersAndErrors(state, _sessionPercent, lang) {
  const active = activeProvider();
  const { percent: activePct, sectionId } = providerSessionPeak(state, active);
  const titlePrefix = active === 'antigravity' && sectionId ? `${groupTitle(sectionId, lang)} · ` : '';
  if (titlePrefix) {
    if (elements.highUsageBannerTitle) {
      elements.highUsageBannerTitle.textContent = `${titlePrefix}${t('alert.highUsage.title', lang)}`;
    }
    if (elements.criticalBannerTitle) {
      elements.criticalBannerTitle.textContent = `${titlePrefix}${t('alert.critical.title', lang)}`;
    }
  }

  if (activePct >= 90 && !criticalDismissed.has(active)) showBanner(elements.criticalBanner);
  else hideBanner(elements.criticalBanner);
  if (activePct >= 70 && activePct < 90 && !highUsageDismissed.has(active)) showBanner(elements.highUsageBanner);
  else hideBanner(elements.highUsageBanner);

  if (!state.isOffline) offlineDismissed = false;
  if (state.isOffline && !offlineDismissed) showBanner(elements.offlineBanner);
  else hideBanner(elements.offlineBanner);
  elements.reauthButton.hidden = !state.needsReauth || resolveView(state, requestedView) !== 'main' || !['overview', 'claude'].includes(active);
  elements.reauthButton.textContent = t('error.scope_insufficient', lang);
  setErrorText([
    state.localError ? t(state.localError, lang) : null,
    state.quotaError && !state.needsReauth ? t(state.quotaError, lang) : null,
    state.authError
  ].filter(Boolean).join(' '));
}

function updateLastUpdatedLine() {
  if (!currentState) return;
  const lang = currentLanguage();
  const provider = activeProvider();
  if (provider === 'claude' || provider === 'overview') {
    const stamp = currentState.lastUpdated;
    elements.lastUpdated.textContent = stamp
      ? tFormat('time.updated.at', lang, { time: formatClockTime(new Date(stamp)) })
      : '--';
    return;
  }
  // A provider's stamp is when its source last reported, which can be days
  // ago (Codex unused, Antigravity closed): name the day when it is not today.
  const time = providerReadingTime(currentState[provider], lang);
  if (!time) {
    elements.lastUpdated.textContent = '--';
    return;
  }
  const isLive = provider === 'antigravity' && currentState.antigravity?.status === 'live';
  const key = isLive ? 'time.updated.at' : 'provider.lastReading';
  elements.lastUpdated.textContent = tFormat(key, lang, { time });
}

function providerReadingTime(quota, lang) {
  if (!quota?.updatedAt) return '';
  const at = new Date(quota.updatedAt);
  return at.toDateString() === new Date().toDateString()
    ? formatClockTime(at)
    : formatWeekdayClock(at, lang);
}

function activeProvider() {
  return resolveProvider(currentState, requestedProvider);
}

function renderNavigation(state) {
  const active = resolveNavigation(state, requestedView, requestedProvider);
  for (const [provider, button] of [
    ['overview', elements.overviewButton],
    ['claude', elements.providerClaudeButton],
    ['codex', elements.providerCodexButton],
    ['antigravity', elements.providerAntigravityButton],
    ['settings', elements.settingsButton]
  ]) {
    if (provider === 'codex' || provider === 'antigravity') button.hidden = !state?.[provider];
    if (provider === active) {
      button.setAttribute('aria-current', 'page');
      delete button.dataset.alert;
    } else {
      button.removeAttribute('aria-current');
      const { percent } = providerSessionPeak(state, provider);
      if (percent >= 90) button.dataset.alert = 'critical';
      else if (percent >= 70) button.dataset.alert = 'high';
      else delete button.dataset.alert;
    }
  }
  const expanded = !elements.rail.hidden;
  elements.railToggleButton.setAttribute('aria-expanded', String(expanded));
  const label = t(expanded ? 'navigation.hideSidebar' : 'navigation.showSidebar', currentLanguage());
  elements.railToggleButton.setAttribute('aria-label', label);
  elements.railToggleButton.title = label;
}

function groupTitle(id, lang) {
  if (id === 'gemini') return 'Gemini';
  if (id === 'thirdParty') return t('provider.antigravity.thirdParty', lang);
  if (id === 'argon') return 'Gemini 4 Argon';
  return PROVIDER_NAMES[id] ?? id;
}

function providerStatusText(provider, quota, lang) {
  if (provider === 'codex') {
    if (quota.status === 'error') return t('provider.codex.error', lang);
    return quota.sections.length ? '' : t('provider.codex.empty', lang);
  }
  if (quota.status === 'error') return t('provider.antigravity.error', lang);
  if (quota.status === 'closed') return t('provider.antigravity.closed', lang);
  return '';
}

function renderProviderStatus(element, text, status) {
  element.hidden = !text;
  element.dataset.tone = status === 'error' ? 'error' : status === 'closed' ? 'warning' : 'info';
  element.querySelector('[data-status-text]').textContent = text;
}

// `window` is a `providers::ProviderWindow`, or null when the source does not
// offer that window at all — then the row is not shown.
function renderQuotaRow(row, label, window, kind, ctx) {
  row.hidden = !window;
  if (!window) return;
  const measured = window.percent != null && !window.rolledOver;
  const percent = clampPercent(measured ? window.percent : 0);
  row.querySelector('[data-label]').textContent = label;
  const value = row.querySelector('[data-percent]');
  const prevPct = value.dataset.prevPercent != null ? Number(value.dataset.prevPercent) : null;
  updateReading(value, measured ? quotaDisplayValue(percent, ctx.mode) : null, setPercentValue);
  if (measured) {
    if (prevPct !== null && kind === 'session' && prevPct >= 95 && percent <= 5) {
      triggerResetFlash(value);
    }
    value.dataset.prevPercent = String(percent);
  } else {
    delete value.dataset.prevPercent;
  }
  setQuotaColorDrift(value, percent);
  row.querySelector('[data-suffix]').textContent = measured ? t(`quota.suffix.${ctx.mode}`, ctx.lang) : '';
  const paceEl = row.querySelector('[data-pace]');
  if (paceEl) {
    const pace = buildUsagePace({
      slot: measured ? { percent, resetsAt: window.resetsAt ? new Date(window.resetsAt) : null } : null,
      now: ctx.now,
      windowMs: SESSION_WINDOW_MS
    });
    renderPace(paceEl, pace, ctx.lang);
  }
  renderMeter(row.querySelector('[data-meter]'), percent);
  const reset = buildProviderResetLine(window, kind, ctx);
  const resetLine = row.querySelector('[data-reset]');
  resetLine.textContent = reset;
  // On the reset line only: a `title` on the row would also cover the pace
  // badge and stack the OS tooltip on top of the designed one.
  resetLine.title = reset;
}

// Visible rows in reading order. The entrance staggers each row by its index
// (CSS `--row`, and the count-up delay reads `data-row`).
function indexQuotaRows(container) {
  [...container.querySelectorAll('.quota-row')].filter(row => !row.hidden).forEach((row, index) => {
    row.dataset.row = String(index);
    row.style.setProperty('--row', index);
  });
}

// Antigravity groups read Gemini first, then Argon, then Claude and GPT,
// whatever order the language server reports them in.
const SECTION_ORDER = ['gemini', 'argon', 'thirdParty'];

function orderSections(sections) {
  const rank = id => (SECTION_ORDER.includes(id) ? SECTION_ORDER.indexOf(id) : SECTION_ORDER.length);
  return [...sections].sort((a, b) => rank(a.id) - rank(b.id));
}

// The provider's main group gets the large session row; the others (and every
// Antigravity group but Gemini) show two compact rows under a group title.
function isCompactSection(provider, sectionId, index) {
  return provider === 'antigravity' ? sectionId !== 'gemini' : index > 0;
}

function createQuotaGroup(sectionId) {
  const group = elements.overviewSectionTemplate.content.firstElementChild.cloneNode(true);
  group.dataset.section = sectionId;
  wireTooltip(group.querySelector('[data-pace]'));
  return group;
}

// One quota group (session + weekly rows), shared by the Overview cards and
// the Codex / Antigravity pages. Reset lines are visible on every row, so a
// rolled-over or unknown window explains itself there.
function renderQuotaGroup(group, section, compact, ctx) {
  const { lang } = ctx;
  group.classList.toggle('overview-section--compact', compact);
  const heading = group.querySelector('[data-group-title]');
  heading.hidden = !compact;
  heading.textContent = groupTitle(section.id, lang);
  const rowCtx = { ...ctx, blocked: Boolean(section.blocked), weeklySpent: (section.weekly?.percent ?? 0) >= 100 };
  const [session, weekly] = group.querySelectorAll('.quota-row');
  session.classList.toggle('overview-compact', compact);
  session.querySelector('[data-pace]').hidden = compact;
  renderQuotaRow(session, t('home.session', lang), section.session, 'session', rowCtx);
  renderQuotaRow(weekly, t('home.weekly', lang), section.weekly, 'weekly', rowCtx);
  group.querySelector('[data-section-status]').textContent =
    !section.session && !section.weekly ? t('provider.window.unknown', lang) : '';
}

function renderOverview(state, lang) {
  if (!state.isSignedIn) return;
  const ctx = { now: new Date(), lang, mode: state.preferences?.display?.quotaMode ?? 'used' };
  const cards = overviewProviders(state).map(({ id, sections }) => {
    let card = overviewCards.get(id);
    if (!card) {
      card = elements.overviewCardTemplate.content.firstElementChild.cloneNode(true);
      card.dataset.provider = id;
      const title = card.querySelector('[data-overview-title]');
      title.id = `overview-${id}-heading`;
      title.textContent = PROVIDER_NAMES[id];
      card.setAttribute('aria-labelledby', title.id);
      const reading = card.querySelector('[data-overview-reading]');
      reading.id = `overview-${id}-reading`;
      card.setAttribute('aria-describedby', reading.id);
      const button = { claude: elements.providerClaudeButton, codex: elements.providerCodexButton, antigravity: elements.providerAntigravityButton }[id];
      card.querySelector('[data-overview-icon]').appendChild(button.querySelector('svg').cloneNode(true));
      // The card is a shortcut to the provider's page: the title button, or a
      // click on the card itself that is not on one of its own controls.
      card.addEventListener('click', event => {
        if (event.target.closest('button:not([data-overview-open]), [tabindex]')) return;
        const hadFocus = card.contains(document.activeElement);
        button.click();
        if (hadFocus) elements.providerHeading.focus({ preventScroll: true });
      });
      const peak = card.querySelector('[data-overview-peak]');
      wireTooltip(peak.querySelector('[data-peak-info]'), peak);
      overviewCards.set(id, card);
    }
    // Peak hours are Anthropic's, so only the Claude card carries the badge.
    const badge = card.querySelector('[data-overview-peak]');
    if (id === 'claude') {
      badge.querySelector('[data-peak-label]').textContent = t('home.peakHours', lang);
      renderPeakBadge(badge, badge.querySelector('[data-peak-info]'), ctx.now, lang);
    } else {
      badge.hidden = true;
    }
    const container = card.querySelector('[data-overview-sections]');
    const shown = [...container.children];
    const groups = orderSections(sections).map((section, index) => {
      const group = shown.find(node => node.dataset.section === section.id) ?? createQuotaGroup(section.id);
      renderQuotaGroup(group, section, isCompactSection(id, section.id, index), ctx);
      return group;
    });
    if (groups.length !== shown.length || groups.some((group, i) => group !== shown[i])) container.replaceChildren(...groups);
    const status = id === 'claude' ? '' : providerStatusText(id, state[id], lang);
    renderProviderStatus(card.querySelector('[data-overview-status]'), status || (!sections.length ? t('provider.window.unknown', lang) : ''), state[id]?.status);
    const time = providerReadingTime(state[id], lang);
    const reading = time ? tFormat('provider.lastReading', lang, { time }) : '';
    card.querySelector('[data-overview-open]').title = reading;
    card.querySelector('[data-overview-reading]').textContent = reading;
    const stale = card.querySelector('[data-overview-stale]');
    stale.hidden = !time || ctx.now - new Date(state[id].updatedAt) < STALE_READING_MS;
    stale.title = reading;
    stale.querySelector('[data-stale-text]').textContent = stale.hidden ? '' : time;
    return card;
  });
  const shown = [...elements.overviewCards.children];
  if (cards.length !== shown.length || cards.some((card, i) => card !== shown[i])) elements.overviewCards.replaceChildren(...cards);
  indexQuotaRows(elements.overviewCards);
}

function renderProviderView(state, lang) {
  const provider = activeProvider();
  const quota = state[provider];
  if (provider === 'claude' || !quota) return;
  if (elements.providerHeading) elements.providerHeading.textContent = PROVIDER_NAMES[provider];
  const ctx = { now: new Date(), lang, mode: state.preferences?.display?.quotaMode ?? 'used' };
  // One card per group. The main group has no title (the panel header names
  // the provider); the others are titled by their group heading.
  const cards = orderSections(quota.sections).map((section, index) => {
    let card = groupCards.get(section.id);
    if (!card) {
      card = document.createElement('section');
      card.className = 'card overview-card';
      card.append(createQuotaGroup(section.id));
      groupCards.set(section.id, card);
    }
    renderQuotaGroup(card.firstElementChild, section, isCompactSection(provider, section.id, index), ctx);
    const title = card.querySelector('[data-group-title]');
    title.id = `quota-${provider}-${section.id}-heading`;
    title.setAttribute('aria-level', '2');
    card.setAttribute('aria-labelledby', title.hidden ? 'providerHeading' : title.id);
    return card;
  });
  const shown = [...elements.providerGroups.children];
  if (cards.length !== shown.length || cards.some((card, i) => card !== shown[i])) {
    elements.providerGroups.replaceChildren(...cards);
  }
  indexQuotaRows(elements.providerGroups);
  const hasStats = Boolean(quota.todayStats || quota.monthStats);
  if (elements.providerCostGrid) {
    elements.providerCostGrid.hidden = !hasStats;
    if (hasStats) {
      updateReading(elements.providerTodayCost, quota.todayStats?.cost, setCostValue);
      elements.providerTodayTokens.textContent =
        formatTokens(quota.todayStats?.totalTokens, lang) ?? '';
      updateReading(elements.providerMonthCost, quota.monthStats?.cost, setCostValue);
      elements.providerMonthTokens.textContent =
        formatTokens(quota.monthStats?.totalTokens, lang) ?? '';
    }
  }
  renderProviderStatus(elements.providerStatus, providerStatusText(provider, quota, lang), quota.status);
}

function renderNotificationPill(enabled, lang = currentLanguage()) {
  elements.notificationState.dataset.tone = enabled ? 'accent' : 'muted';
  const label = t(enabled ? 'home.notif.on' : 'home.notif.off', lang);
  elements.notificationStateText.textContent = label;
  // The rail shows only the bell, so the state lives in the tooltip (and in
  // the hidden label above).
  elements.notificationState.title = label;
  if (enabled) {
    delete elements.notificationState.dataset.notifOff;
  } else {
    elements.notificationState.dataset.notifOff = '';
  }
  elements.notificationState.setAttribute('aria-pressed', String(enabled));
}

// A refresh that finishes mid-rotation used to yank the animation off the icon,
// snapping it back to 0deg. Hold the flag until the current turn completes so
// the spin always lands where it started.
function stopRefreshSpin() {
  const svg = elements.refreshButton.querySelector('svg');
  const spin = svg?.getAnimations?.()[0];
  const period = Number(spin?.effect?.getTiming?.().duration);
  if (!spin || reducedMotion() || !Number.isFinite(period) || period <= 0) {
    delete document.body.dataset.refreshing;
    return;
  }
  const elapsed = Number(spin.currentTime) || 0;
  setTimeout(() => {
    delete document.body.dataset.refreshing;
  }, period - (elapsed % period));
}

async function refreshNow() {
  document.body.dataset.refreshing = 'true';
  elements.refreshButton.disabled = true;
  try {
    await window.siphon.refresh();
  } catch (error) {
    logSafeError('Manual refresh failed:', error);
    setErrorText(t('error.loadState', currentLanguage()));
  } finally {
    elements.refreshButton.disabled = false;
    stopRefreshSpin();
  }
}

function renderPace(element, pace, lang = currentLanguage()) {
  if (!element) return;
  const status = pace?.status ?? 'no_data';
  element.dataset.status = status;
  const label = t(`pace.${status}`, lang);
  element.textContent = label;
  const hint = tFormat(`pace.${status}Tooltip`, lang, { time: formatClockTime(pace?.projectedDepletionAt) });
  element.dataset.tooltip = hint;
  if (element === elements.sessionPace) {
    elements.sessionPaceHint.textContent = hint;
  } else {
    element.setAttribute('aria-label', `${label} — ${hint}`);
  }
  // Runs every refresh tick: keep an open bubble in sync with the new copy.
  if (tooltipTrigger === element) elements.tooltip.textContent = hint;
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

// Extra-usage card: purchased credits beyond the plan quota. The card only
// exists when the account has the feature enabled (extra is non-null); it stays
// hidden and the layout is unchanged otherwise.
function renderExtraUsage(extra) {
  if (!extra) {
    hideBanner(elements.extraUsageCard);
    return;
  }
  showBanner(elements.extraUsageCard);
  elements.extraUsedCredits.textContent = formatCurrency(extra.usedCredits);
  elements.extraMonthlyLimit.textContent = formatCurrency(extra.monthlyLimit);
  // The ring takes the session meter's level colours for the share spent.
  const spent = extra.monthlyLimit > 0 ? clampPercent((extra.usedCredits / extra.monthlyLimit) * 100) : 0;
  elements.extraGauge.dataset.level = levelForPercent(spent);
  elements.extraGauge.style.setProperty('--gauge-fill', spent);
}

function renderMeter(meter, percent) {
  const total = Number(meter.dataset.segments ?? 40);
  const filled = Math.round((percent / 100) * total);
  // Nothing lit reads as an empty, neutral track rather than a faint green one.
  const level = filled === 0 ? 'zero' : levelForPercent(percent);
  if (meter.dataset.level === level && meter.dataset.filled === String(filled) && meter.children.length === total) return;
  meter.dataset.level = level;
  meter.dataset.filled = String(filled);
  meter.style.setProperty('--filled', filled); // width of the glow behind the filled run
  meter.style.setProperty('--segments', total);
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


function switchSettingsTab(name, { focus = false } = {}) {
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
  const tabIndexes = { system: 0, notification: 1, widget: 2 };
  const card = elements.settingsTabsCard;
  if (!panels[name]) return;
  if (name === currentSettingsTab) {
    if (focus) tabs[name].focus();
    return;
  }
  // Container-Follows-Content Rule (DESIGN.md §5): capture the card's height
  // before the outgoing panel is parked out of flow — mid-swap this is the
  // height the tween has reached, so an interrupted swap continues from it.
  const startHeight = card.getBoundingClientRect().height;
  const clearPanel = panel => {
    panel.style.position = '';
    panel.style.width = '';
    panel.style.pointerEvents = '';
    panel.style.opacity = '';
    panel.style.transform = '';
  };
  if (_tabTransitioning) {
    // The panel still arriving becomes the one leaving, from wherever its fade
    // had reached; only a third panel (already on its way out) is dropped.
    clearTimeout(_tabTransitionTimer);
    for (const [panelName, panel] of Object.entries(panels)) {
      if (panelName === currentSettingsTab || panelName === name) continue;
      panel.hidden = true;
      clearPanel(panel);
    }
    delete card.dataset.resizing;
    card.style.height = '';
    _tabTransitioning = false;
  }
  _tabTransitioning = true;
  const FADE_MS = cssMs('--duration-tab-fade', 110);
  const outgoing = panels[currentSettingsTab];
  const incoming = panels[name];
  // Panels travel the way the pill does; opacity only under reduced motion.
  const shift = (reducedMotion() ? 0 : 6) * Math.sign(tabIndexes[name] - tabIndexes[currentSettingsTab]);
  tabs[currentSettingsTab].classList.remove('settings-tab--active');
  tabs[name].classList.add('settings-tab--active');
  tabs[currentSettingsTab].setAttribute('aria-selected', 'false');
  tabs[name].setAttribute('aria-selected', 'true');
  tabs[currentSettingsTab].tabIndex = -1;
  tabs[name].tabIndex = 0;
  if (focus) tabs[name].focus();
  elements.settingsTabs.style.setProperty('--tab-index', tabIndexes[name]);
  currentSettingsTab = name;

  // Overlap the crossfade instead of running it twice. Parking the outgoing
  // panel out of flow (the card is position:relative) lets the incoming one
  // take its place at once, so a tab switch costs one fade, not two.
  const width = outgoing.getBoundingClientRect().width;
  outgoing.style.position = 'absolute';
  outgoing.style.width = `${width}px`;
  outgoing.style.pointerEvents = 'none';
  outgoing.style.opacity = '0';
  outgoing.style.transform = `translateX(${-shift}px)`;

  incoming.hidden = false;
  incoming.style.position = '';
  incoming.style.width = '';
  incoming.style.pointerEvents = '';
  incoming.style.opacity = '0';
  incoming.style.transform = `translateX(${shift}px)`;

  // Container-Follows-Content Rule: now that the outgoing panel is out of
  // flow and the incoming one is in it, the card's natural height is the
  // target. Pin it back to startHeight, force a reflow so that pin actually
  // lands, then write the target — the height transition (same
  // --duration-tab-fade token as the opacity fade above) animates between
  // the two instead of the card snapping to the incoming panel's height in
  // one frame.
  const targetHeight = card.getBoundingClientRect().height;
  card.style.height = `${startHeight}px`;
  void card.offsetHeight;
  // The height transition is gated on [data-resizing] so it exists only for
  // the length of this swap. The rule lets the card follow its content
  // mid-crossfade; it must not rubber-band when a window resize reflows the
  // panel's text.
  card.dataset.resizing = '';
  card.style.height = `${targetHeight}px`;

  requestAnimationFrame(() => {
    requestAnimationFrame(() => {
      if (currentSettingsTab !== name) return;
      incoming.style.opacity = '1';
      incoming.style.transform = '';
    });
  });

  _tabTransitionTimer = setTimeout(() => {
    outgoing.hidden = true;
    clearPanel(outgoing);
    clearPanel(incoming);
    card.style.height = '';
    delete card.dataset.resizing;
    _tabTransitioning = false;
    _tabTransitionTimer = null;
  }, FADE_MS);
}

function renderSettings(state, lang = currentLanguage()) {
  const profile = state.profile ?? {};
  elements.settingsName.textContent = profile.name ?? t('settings.signedInFallback', lang);

  const hasEmail = Boolean(profile.email);
  const maskEmailPref = state.preferences?.privacy?.maskEmail ?? false;
  elements.settingsEmail.hidden = !hasEmail;
  elements.settingsEmail.textContent = hasEmail
    ? (maskEmailPref ? maskEmail(profile.email) : profile.email)
    : '';
  elements.settingsEmailToggle.hidden = !hasEmail;
  elements.settingsEmailToggle.dataset.masked = String(maskEmailPref);

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


function focusAfterViewChange(activeView, previousView) {
  let target = null;
  if (activeView === 'settings') {
    const activeElement = document.activeElement;
    settingsReturnFocus = activeElement && activeElement !== document.body
      ? activeElement
      : elements.settingsButton;
    target = elements.settingsTitle;
  } else if (previousView === 'settings') {
    target = settingsReturnFocus?.isConnected ? settingsReturnFocus : elements.settingsButton;
    settingsReturnFocus = null;
  }
  if (!target) return;
  requestAnimationFrame(() => {
    if (document.body.dataset.view === activeView) target.focus({ preventScroll: true });
  });
}

function dashboardForProvider(provider) {
  return provider === 'overview' ? elements.overviewView : provider === 'claude' ? elements.mainView : elements.providerView;
}

function renderActiveView() {
  const activeView = resolveView(currentState, requestedView);
  const previousView = renderedView;
  const viewChanged = activeView !== previousView;
  const provider = activeProvider();
  const previousProvider = renderedProvider;
  if (viewChanged || provider !== previousProvider) stopEntranceSequence();
  if (activeView !== 'main') lastEntranceAt = -Infinity;
  renderedView = activeView;
  renderedProvider = provider;
  document.body.dataset.view = activeView;
  renderNavigation(currentState);
  const settings = activeView === 'settings';
  elements.backButton.hidden = !settings;
  elements.settingsTitle.hidden = !settings;
  elements.providerHeading.hidden = settings;
  elements.refreshButton.hidden = settings;
  elements.providerHeading.textContent = provider === 'overview' ? t('navigation.overview', currentLanguage()) : PROVIDER_NAMES[provider];
  // The header names the destination; it fades in with the view instead of
  // swapping a frame ahead of it (150ms, --duration-view-fade).
  if (viewChanged || provider !== previousProvider) {
    (settings ? elements.settingsTitle : elements.providerHeading).animate?.([{ opacity: 0 }, { opacity: 1 }], { duration: 150, easing: 'ease-out' });
  }
  // Rail order, Settings last: going down travels up, coming back reverses it.
  const rank = (view, id) => (view === 'settings' ? 4 : ['overview', 'claude', 'codex', 'antigravity'].indexOf(id));
  const direction = rank(activeView, provider) < rank(previousView, previousProvider) ? -1 : 1;
  const showClaudeErrors = activeView === 'main' && (provider === 'overview' || provider === 'claude');
  elements.errorText.hidden = !showClaudeErrors;
  elements.reauthButton.hidden = !showClaudeErrors || !currentState?.needsReauth;

  const mainPanel = dashboardForProvider(provider);
  const viewMap = { onboard: elements.onboardView, main: mainPanel, settings: elements.settingsView };
  crossfadeTo(viewMap[activeView], {
    direction,
    onVisible: () => {
      if (activeView === 'settings' && currentState) renderSettings(currentState);
      if (activeView === 'main' && previousView !== 'main') playEntranceSequence();
    },
    onSettled: () => {
      if (viewChanged) focusAfterViewChange(activeView, previousView);
    }
  });
}

function currentLanguage() {
  const lang = currentState?.preferences?.language;
  return SUPPORTED_LANGUAGES.includes(lang) ? lang : 'en';
}

function applyTranslations(lang) {
  document.documentElement.lang = lang;

  i18nCache.text.forEach(element => {
    const translated = t(element.dataset.i18n, lang);
    if (element.textContent !== translated) element.textContent = translated;
  });
  i18nCache.title.forEach(element => {
    element.title = t(element.dataset.i18nTitle, lang);
  });
  // Custom-tooltip triggers: write into dataset.tooltip instead of .title, or
  // the OS tooltip would reappear on top of the designed one on every
  // language change.
  i18nCache.tooltip.forEach(element => {
    element.dataset.tooltip = t(element.dataset.i18nTooltip, lang);
  });
  i18nCache.ariaLabel.forEach(element => {
    element.setAttribute('aria-label', t(element.dataset.i18nAriaLabel, lang));
  });
  i18nCache.placeholder.forEach(element => {
    element.setAttribute('placeholder', t(element.dataset.i18nPlaceholder, lang));
  });
}

function playSound(assetPath, volumeKey) {
  const audio = new Audio(assetPath);
  audio.volume = Math.max(0, Math.min(1, Number(currentState?.preferences?.notifications?.[volumeKey] ?? 1.0)));
  audio.play().catch(error => console.warn('Could not play sound', assetPath, redactSensitive(error)));
}

function playResetSound() {
  playSound('../assets/notificationReset.mp3', 'soundVolume');
}

function playLimitSound() {
  playSound('../assets/notificationAlert.mp3', 'limitSoundVolume');
}

function playFullSound() {
  playSound('../assets/notificationFull.mp3', 'expireSoundVolume');
}

function updateSliderFill(slider) {
  const min = Number(slider.min);
  const max = Number(slider.max);
  const pct = ((Number(slider.value) - min) / (max - min)) * 100;
  slider.style.setProperty('--slider-fill', `${pct}%`);
}



function stopEntranceSequence() {
  cancelAnimationFrame(windowEntranceFrame);
  windowEntranceFrame = null;
  clearTimeout(enterSequenceTimer);
  enterSequenceTimer = null;
  delete document.body.dataset.entering;
  for (const view of [elements.overviewView, elements.mainView, elements.providerView]) delete view.dataset.entering;
  for (const element of animatingElements.keys()) {
    cancelCountUp(element);
    const target = element.dataset.entryValue === '' ? null : Number(element.dataset.entryValue);
    const setValue = element.classList.contains('stat-value') ? setCostValue : setPercentValue;
    setValue(element, target);
  }
}

function playEntranceSequence() {
  if (!currentState || document.hidden || reducedMotion()) return;
  const view = resolveView(currentState, requestedView) === 'main' ? dashboardForProvider(activeProvider()) : null;
  const now = performance.now();
  if (view?.dataset.entering && now - lastEntranceAt < ENTER_DEDUPE_MS) return;
  if (view) lastEntranceAt = now;
  stopEntranceSequence();
  void document.body.offsetWidth;
  document.body.dataset.entering = '1';
  if (view) {
    view.dataset.entering = '1';
    for (const element of view.querySelectorAll('[data-entry-value]')) {
      if (element.dataset.entryValue === '') continue;
      const cost = element.classList.contains('stat-value');
      // Same row stagger as the CSS reveal (35ms per row, capped at six).
      const row = Math.min(Number(element.closest('.quota-row')?.dataset?.row) || 0, 6);
      animateCountUp(element, Number(element.dataset.entryValue), cost ? setCostValue : setPercentValue, {
        duration: cost ? 600 : 650,
        delay: cost ? 440 : 310 + row * 35
      });
    }
  }
  enterSequenceTimer = setTimeout(() => {
    if (view) delete view.dataset.entering;
    delete document.body.dataset.entering;
    enterSequenceTimer = null;
  }, ENTER_SEQUENCE_MS);
}

function queueWindowEntrance() {
  cancelAnimationFrame(windowEntranceFrame);
  windowEntranceFrame = requestAnimationFrame(() => {
    windowEntranceFrame = null;
    playEntranceSequence();
  });
}

// The native signal, emitted by `windows_ctl::show_window` for every tray or
// menu show and by the `Resized` handler for a taskbar restore. This is what
// actually fires on Windows.
// Coalesce native show/view/provider events before choosing the visible data.
window.siphon?.onWindowShown?.(queueWindowEntrance);

// Kept as a belt-and-braces second source: WebView2 does not update document
// visibility when the native window is hidden, but a future runtime (or a
// platform port) that does would land here. `ENTER_DEDUPE_MS` keeps the two
// from playing over each other.
document.addEventListener('visibilitychange', () => {
  if (document.hidden) return;
  queueWindowEntrance();
});

// The window is born hidden (`visible: false`) and shown from Rust's `setup()`
// hook, which races this module's load. When `show()` wins, the page is already
// visible by the time we get here and `visibilitychange` never fires — the boot
// entrance is simply lost, which is what happens under `npm start`. So play it
// straight away whenever we load into a visible window; only a genuinely hidden
// start waits for the event.
if (!document.hidden) queueWindowEntrance();
