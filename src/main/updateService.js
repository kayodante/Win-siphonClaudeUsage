import fs from 'node:fs';
import https from 'node:https';
import { spawn, execFile } from 'node:child_process';

const REPO = 'kayodante/Win-siphonClaudeUsage';
const RELEASES_URL = `https://github.com/${REPO}/releases/latest`;
const WINGET_ID = 'kayodante.Siphon';

// True only when the winget catalog already carries a newer version of Siphon.
// The winget manifest lags the GitHub release by hours, so right after a release
// this returns false and the updater falls back to the direct .exe download.
export function wingetUpgradeAvailable() {
  return new Promise(resolve => {
    execFile('winget', ['upgrade', '--accept-source-agreements', '--disable-interactivity'], { timeout: 15000 }, (err, stdout) => {
      resolve(!err && typeof stdout === 'string' && stdout.includes(WINGET_ID));
    });
  });
}

// PowerShell that waits for the running Siphon.exe to exit (so the NSIS installer
// can replace the locked binary), runs the winget upgrade, then relaunches Siphon.
export function buildWingetUpgradeCommand({ pid, execPath } = {}) {
  const parts = [];
  const numericPid = Number(pid);
  if (Number.isInteger(numericPid)) parts.push(`try { Wait-Process -Id ${numericPid} -Timeout 30 } catch {}`);
  parts.push(`winget upgrade --id ${WINGET_ID} -e --silent --accept-package-agreements --accept-source-agreements --disable-interactivity`);
  if (execPath) parts.push(`Start-Process -FilePath '${String(execPath).replace(/'/g, "''")}'`);
  return parts.join('; ');
}

export function wingetUpgrade(opts = {}) {
  spawn('powershell', [
    '-NoProfile', '-NonInteractive', '-WindowStyle', 'Hidden',
    '-Command', buildWingetUpgradeCommand(opts)
  ], { detached: true, stdio: 'ignore' }).unref();
}

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

export async function checkForUpdate({ isPackaged, version, httpImpl = https, wingetCheck = wingetUpgradeAvailable } = {}) {
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
      const asset = release.assets?.find(
        a => a.name.endsWith('.exe') && !a.name.includes('Portable')
      );
      return {
        version: release.tag_name.replace(/^v/, ''),
        url: RELEASES_URL,
        downloadUrl: asset?.browser_download_url ?? null,
        checksumUrl: asset ? (release.assets?.find(a => a.name === `${asset.name}.sha256`)?.browser_download_url ?? null) : null,
        wingetUpgradeAvailable: await wingetCheck()
      };
    }
  } catch {
    // network error — silently ignore
  }
  return null;
}

export function downloadFile(downloadUrl, destPath, onProgress, httpImpl = https, trustedHosts = null) {
  return new Promise((resolve, reject) => {
    function get(url, depth = 0) {
      if (depth > 5) return reject(new Error('too many redirects'));
      const req = httpImpl.get(url, { headers: { 'User-Agent': 'Siphon-Windows' }, timeout: 30000 }, res => {
        if ([301, 302, 303, 307, 308].includes(res.statusCode)) {
          res.resume();
          const loc = res.headers?.location;
          if (!loc) return reject(new Error('redirect missing location'));
          let resolved;
          try { resolved = new URL(loc, url); } catch {
            return reject(new Error('invalid redirect location'));
          }
          if (resolved.protocol !== 'https:') return reject(new Error('insecure redirect'));
          if (trustedHosts && !trustedHosts.has(resolved.hostname)) {
            return reject(new Error('untrusted redirect host'));
          }
          return get(resolved.href, depth + 1);
        }
        if (res.statusCode !== 200) {
          res.resume();
          return reject(new Error(`HTTP ${res.statusCode}`));
        }
        const total = parseInt(res.headers?.['content-length'] || '0', 10);
        let received = 0;
        const file = fs.createWriteStream(destPath);
        file.on('error', err => { res.destroy(); fs.unlink(destPath, () => {}); reject(err); });
        res.on('data', chunk => {
          received += chunk.length;
          if (!file.write(chunk)) {
            res.pause?.();
            file.once('drain', () => res.resume?.());
          }
          if (total > 0) onProgress?.(Math.round((received / total) * 100));
        });
        res.on('end', () => file.end(() => resolve(destPath)));
        res.on('error', err => { file.destroy(); fs.unlink(destPath, () => {}); reject(err); });
      });
      req.on('error', err => { fs.unlink(destPath, () => {}); reject(err); });
      req.on('timeout', () => { req.destroy(); reject(new Error('download timeout')); });
    }
    get(downloadUrl);
  });
}
