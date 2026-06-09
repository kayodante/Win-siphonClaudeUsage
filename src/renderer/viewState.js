export function resolveView(state, requestedView = 'main') {
  if (!state?.isSignedIn) return 'onboard';
  return requestedView === 'settings' ? 'settings' : 'main';
}
