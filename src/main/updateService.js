import https from 'node:https';

const REPO = 'kayodante/Win-siphonClaudeUsage';
const RELEASES_URL = `https://github.com/${REPO}/releases/latest`;

function semver(v) {
  return v.replace(/^v/, '').split('.').map(Number);
}

export function isNewer(tag, current) {
  const [la, lb, lc] = semver(tag);
  const [ca, cb, cc] = semver(current);
  return la !== ca ? la > ca : lb !== cb ? lb > cb : lc > cc;
}

function fetchLatest(httpImpl = https) {
  return new Promise((resolve, reject) => {
    const req = httpImpl.get(
      `https://api.github.com/repos/${REPO}/releases/latest`,
      { headers: { 'User-Agent': 'Siphon-Windows', Accept: 'application/vnd.github+json' }, timeout: 10000 },
      res => {
        if (res.statusCode !== 200) { res.resume(); return reject(new Error(`HTTP ${res.statusCode}`)); }
        let body = '';
        let bodyBytes = 0;
        const MAX_BODY_BYTES = 512 * 1024;
        res.on('data', d => {
          bodyBytes += d.length;
          if (bodyBytes > MAX_BODY_BYTES) { req.destroy(new Error('response too large')); return; }
          body += d;
        });
        res.on('end', () => { try { resolve(JSON.parse(body)); } catch (e) { reject(e); } });
      }
    );
    req.on('error', reject);
    req.on('timeout', () => { req.destroy(); reject(new Error('timeout')); });
  });
}

export async function checkForUpdate({ isPackaged, version, httpImpl = https } = {}) {
  if (isPackaged === undefined || version === undefined) {
    const { app } = await import('electron');
    isPackaged ??= app.isPackaged;
    version ??= app.getVersion();
  }
  if (!isPackaged) return null;
  try {
    const release = await fetchLatest(httpImpl);
    if (release.draft || release.prerelease) return null;
    if (isNewer(release.tag_name, version)) {
      return { version: release.tag_name.replace(/^v/, ''), url: RELEASES_URL };
    }
  } catch {
    // network error — silently ignore
  }
  return null;
}
