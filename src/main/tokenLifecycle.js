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
    const { OAuthService } = await import('./oauthService.js');
    credentials = await new OAuthService().refresh(credentials.refreshToken);
    await tokenStore.save(credentials);
  }
  return credentials;
}
