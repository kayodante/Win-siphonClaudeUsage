import https from 'node:https';
import { app } from 'electron';

const REPO = 'kayodante/Win-siphonClaudeUsage';
const RELEASES_URL = `https://github.com/${REPO}/releases/latest`;

function semver(v) {
  return v.replace(/^v/, '').split('.').map(Number);
}

function isNewer(tag, current) {
  const [la, lb, lc] = semver(tag);
  const [ca, cb, cc] = semver(current);
  return la !== ca ? la > ca : lb !== cb ? lb > cb : lc > cc;
}

function fetchLatest() {
  return new Promise((resolve, reject) => {
    const req = https.get(
      `https://api.github.com/repos/${REPO}/releases/latest`,
      { headers: { 'User-Agent': 'Siphon-Windows', Accept: 'application/vnd.github+json' }, timeout: 10000 },
      res => {
        if (res.statusCode !== 200) { res.resume(); return reject(new Error(`HTTP ${res.statusCode}`)); }
        let body = '';
        res.on('data', d => { body += d; });
        res.on('end', () => { try { resolve(JSON.parse(body)); } catch (e) { reject(e); } });
      }
    );
    req.on('error', reject);
    req.on('timeout', () => { req.destroy(); reject(new Error('timeout')); });
  });
}

export async function checkForUpdate() {
  if (!app.isPackaged) return null;
  try {
    const release = await fetchLatest();
    if (release.draft || release.prerelease) return null;
    if (isNewer(release.tag_name, app.getVersion())) {
      return { version: release.tag_name.replace(/^v/, ''), url: RELEASES_URL };
    }
  } catch {
    // network error — silently ignore
  }
  return null;
}
