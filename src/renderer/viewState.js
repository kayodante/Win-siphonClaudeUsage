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

export function detectThresholdCrossings(prevMap, currentMap, { expireSound = false, limitSound = false } = {}) {
  let playFull = false;
  let playLimit = false;

  if (prevMap && currentMap) {
    for (const [key, currentPct] of currentMap.entries()) {
      const prevPct = prevMap.get(key);
      if (prevPct != null) {
        if (expireSound && prevPct < 100 && currentPct >= 100) {
          playFull = true;
        } else if (limitSound && ((prevPct < 90 && currentPct >= 90) || (prevPct < 70 && currentPct >= 70))) {
          playLimit = true;
        }
      }
    }
  }

  return { playFull, playLimit };
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
