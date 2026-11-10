import { clampPercent } from '../shared/format.js';

export function resolveView(state, requestedView = 'main') {
  if (!state?.isSignedIn) return 'onboard';
  return requestedView === 'settings' ? 'settings' : 'main';
}

// Claude always has a tab; Codex and Antigravity only while their state
// exists (the provider is installed). A tab that disappears falls back to Claude.
export function resolveProvider(state, requested = 'claude') {
  if (requested === 'overview') return 'overview';
  return (requested === 'codex' || requested === 'antigravity') && state?.[requested]
    ? requested
    : 'claude';
}

export function resolveNavigation(state, requestedView, requestedProvider) {
  const view = resolveView(state, requestedView);
  return view === 'onboard' ? null : view === 'settings' ? 'settings' : resolveProvider(state, requestedProvider);
}

export function overviewProviders(state) {
  return [
    { id: 'claude', sections: [{ id: 'claude', session: state?.quota?.session ?? null, weekly: state?.quota?.weeklyAll ?? null }] },
    ...['codex', 'antigravity'].filter(id => state?.[id]).map(id => ({ id, sections: state[id].sections ?? [] }))
  ];
}

// A window's percent, or null while it is unknown or waiting for a new reading.
export function measuredPercent(window) {
  return window && window.percent != null && !window.rolledOver ? clampPercent(window.percent) : null;
}

// A session quota that fell from nearly full to nearly empty has just reset.
export function isResetDrop(previous, current) {
  return previous != null && previous >= 95 && current <= 5;
}

// Highest session percent of a provider (Claude has one window; the others
// have sections). A section without a session window contributes its weekly
// one; a rolled-over session does not fall back to weekly.
export function providerSessionPeak(state, provider) {
  if (provider === 'claude') {
    return { percent: clampPercent(state?.quota?.session?.percent ?? 0), sectionId: null };
  }
  let best = { percent: 0, sectionId: null };
  for (const section of state?.[provider]?.sections ?? []) {
    const pct = measuredPercent(section?.session ?? section?.weekly);
    if (pct != null && (best.sectionId === null || pct > best.percent)) {
      best = { percent: pct, sectionId: section.id };
    }
  }
  return best;
}

export function alertLevel(percent) {
  if (percent >= 90) return 'critical';
  return percent >= 70 ? 'high' : null;
}

export function extractChannelPercents(state) {
  const channels = new Map();
  if (state?.quota?.session?.percent != null) {
    channels.set('claude', clampPercent(state.quota.session.percent));
  }
  for (const section of state?.codex?.sections ?? []) {
    if (section?.session) {
      const pct = section.session.rolledOver ? 0 : (section.session.percent != null ? clampPercent(section.session.percent) : null);
      if (pct != null) channels.set(`codex:${section.id}`, pct);
    }
  }
  for (const section of state?.antigravity?.sections ?? []) {
    if (section?.session) {
      const pct = section.session.rolledOver ? 0 : (section.session.percent != null ? clampPercent(section.session.percent) : null);
      if (pct != null) channels.set(`antigravity:${section.id}`, pct);
    }
  }
  return channels;
}

function crossedThreshold(prevPct, currentPct, threshold) {
  return prevPct != null && prevPct < threshold && currentPct >= threshold;
}

export function detectThresholdCrossings(prevMap, currentMap, { expireSound = false, limitSound = false } = {}) {
  if (!prevMap || !currentMap) return { playFull: false, playLimit: false };
  const crossed = threshold => [...currentMap].some(([key, pct]) => crossedThreshold(prevMap.get(key), pct, threshold));
  return {
    playFull: Boolean(expireSound && crossed(100)),
    playLimit: Boolean(limitSound && (crossed(90) || crossed(70)))
  };
}

function preference(preferences, path, fallback) {
  let value = preferences;
  for (const key of path.split('.')) value = value?.[key];
  return value ?? fallback;
}

// Derives the settings form's control state from preferences. Keys are names in
// the renderer's `elements` map; defaults match the preferences schema.
export function settingsControlState(preferences, { isPackaged }) {
  const pref = (path, fallback) => preference(preferences, path, fallback);
  const sound = (key) => pref(`notifications.${key}`, false);
  const volume = (key) => String(pref(`notifications.${key}`, 1.0));
  const openAtLogin = pref('startup.openAtLogin', false);
  const autoCheck = pref('updates.autoCheck', true);
  return {
    settingsNotificationsToggle: { checked: pref('notifications.sessionReset', true) },
    settingsSoundToggle: { checked: sound('sound') },
    settingsSoundVolume: { value: volume('soundVolume'), disabled: !sound('sound') },
    settingsExpireSoundToggle: { checked: sound('expireSound') },
    settingsExpireSoundVolume: { value: volume('expireSoundVolume'), disabled: !sound('expireSound') },
    settingsLimitSoundToggle: { checked: sound('limitSound') },
    settingsLimitSoundVolume: { value: volume('limitSoundVolume'), disabled: !sound('limitSound') },
    settingsExpireAlertToggle: { checked: pref('notifications.expireAlert', false) },
    settingsLimitAlertToggle: { checked: pref('notifications.limitAlert', false) },
    settingsRefreshInterval: { value: String(pref('refresh.intervalSeconds', 30)) },
    settingsQuotaMode: { value: pref('display.quotaMode', 'used') },
    settingsFloatingToggle: { checked: pref('floating.enabled', false) },
    settingsPillWeeklyOption: { hidden: pref('floating.style', 'classic') !== 'mini' },
    settingsPillWeeklyToggle: { checked: pref('floating.showWeekly', true) },
    settingsStartupToggle: { checked: openAtLogin, disabled: !isPackaged },
    settingsStartupShowWindowToggle: { checked: pref('startup.showWindowOnLogin', false), disabled: !isPackaged || !openAtLogin },
    settingsLaunchWithClaudeCodeToggle: { checked: pref('integration.launchWithClaudeCode', false), disabled: !isPackaged },
    settingsUpdatesAutoCheckToggle: { checked: autoCheck },
    settingsUpdatesAutoDownloadToggle: { checked: pref('updates.autoDownload', false), disabled: !autoCheck }
  };
}

export function showsClaudeErrors(view, provider) {
  return view === 'main' && (provider === 'overview' || provider === 'claude');
}

// Rail order, Settings last: going down travels up, coming back reverses it.
const RAIL_ORDER = ['overview', 'claude', 'codex', 'antigravity'];
const viewRank = (view, provider) => (view === 'settings' ? 4 : RAIL_ORDER.indexOf(provider));

export function viewDirection(view, provider, previousView, previousProvider) {
  return viewRank(view, provider) < viewRank(previousView, previousProvider) ? -1 : 1;
}

// Same row stagger as the CSS reveal (35ms per row, capped at six).
export function entranceCountUpTiming(cost, row) {
  return cost
    ? { duration: 600, delay: 440 }
    : { duration: 650, delay: 310 + Math.min(Number(row) || 0, 6) * 35 };
}
