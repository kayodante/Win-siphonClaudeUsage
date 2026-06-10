import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

const electronPath = await loadElectronPath();
const skipReason = electronPath ? false : 'electron is not installed';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const probePath = path.join(__dirname, 'fixtures', 'trayIconProbe.mjs');

test('createTrayIcon returns a non-empty warn icon', { skip: skipReason }, () => {
  const result = runProbe('warn');

  assert.equal(result.status, 0, result.stderr);
  assert.match(result.stdout, /"isEmpty":false/);
});

test('createTrayIcon returns a non-empty high icon', { skip: skipReason }, () => {
  const result = runProbe('high');

  assert.equal(result.status, 0, result.stderr);
  assert.match(result.stdout, /"isEmpty":false/);
});

test('createTrayIcon returns a non-empty critical icon', { skip: skipReason }, () => {
  const result = runProbe('critical');

  assert.equal(result.status, 0, result.stderr);
  assert.match(result.stdout, /"isEmpty":false/);
});

async function loadElectronPath() {
  try {
    return (await import('electron')).default;
  } catch {
    return null;
  }
}

function runProbe(level) {
  return spawnSync(electronPath, [probePath, level], {
    cwd: path.resolve(__dirname, '..'),
    encoding: 'utf8',
    timeout: 10_000,
    env: {
      ...process.env,
      ELECTRON_ENABLE_LOGGING: '0'
    }
  });
}
