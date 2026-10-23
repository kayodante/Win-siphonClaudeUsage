export function resolveView(state, requestedView = 'main') {
  if (!state?.isSignedIn) return 'onboard';
  return requestedView === 'settings' ? 'settings' : 'main';
}

// Claude always has a tab; Codex and Antigravity only while their state
// exists (the provider is installed). A tab that disappears falls back to Claude.
export function resolveProvider(state, requested = 'claude') {
  return (requested === 'codex' || requested === 'antigravity') && state?.[requested]
    ? requested
    : 'claude';
}
