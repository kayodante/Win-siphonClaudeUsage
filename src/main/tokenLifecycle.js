// Shared credential expiry + refresh logic used by both QuotaService and
// ProfileService. Each service keeps its own "missing/expired" handling
// (QuotaService throws QuotaError, ProfileService returns null); only the
// expiry check and the refresh-and-persist step are shared here.

// A token counts as expired 30s before its real expiry to avoid races.
export function isExpired(credentials) {
  if (!credentials.expiresAt) return false;
  return new Date(credentials.expiresAt).getTime() <= Date.now() + 30_000;
}

// If the access token is expired and a refresh token is available, refresh it
// and persist the new credentials. Returns the (possibly updated) credentials.
// OAuthService is imported lazily so it isn't loaded unless a refresh is needed.
export async function refreshIfExpired(tokenStore, credentials) {
  if (isExpired(credentials) && credentials.refreshToken) {
    credentials = await forceRefresh(tokenStore, credentials);
  }
  return credentials;
}

// Refresh the access token regardless of expiry and persist it. Used when the
// server rejects a token that still looks valid locally (e.g. a 401 that isn't
// an expiry race). Returns the refreshed credentials; throws if no refresh
// token is available or the refresh call fails.
export async function forceRefresh(tokenStore, credentials) {
  if (!credentials?.refreshToken) {
    throw new Error('No refresh token available.');
  }
  const { OAuthService } = await import('./oauthService.js');
  const refreshed = await new OAuthService().refresh(credentials.refreshToken);
  await tokenStore.save(refreshed);
  return refreshed;
}
