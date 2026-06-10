const TRUSTED_EXTERNAL_HOSTS = [
  'claude.ai',
  'github.com'
];

export function isSafeExternalUrl(urlString) {
  try {
    const parsed = new URL(urlString);
    if (parsed.protocol !== 'https:') return false;
    if (!TRUSTED_EXTERNAL_HOSTS.includes(parsed.hostname)) return false;
    return true;
  } catch {
    return false;
  }
}
