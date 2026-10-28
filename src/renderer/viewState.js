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
