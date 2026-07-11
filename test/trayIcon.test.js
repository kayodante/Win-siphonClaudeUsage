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

  assert.equal(result.status, 0, describeFailure(result));
  assert.match(result.stdout, /"isEmpty":false/, describeFailure(result));
});

test('createTrayIcon returns a non-empty high icon', { skip: skipReason }, () => {
  const result = runProbe('high');

  assert.equal(result.status, 0, describeFailure(result));
  assert.match(result.stdout, /"isEmpty":false/, describeFailure(result));
});

test('createTrayIcon returns a non-empty critical icon', { skip: skipReason }, () => {
  const result = runProbe('critical');

  assert.equal(result.status, 0, describeFailure(result));
  assert.match(result.stdout, /"isEmpty":false/, describeFailure(result));
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
    timeout: 30_000,
    env: {
      ...process.env,
      ELECTRON_ENABLE_LOGGING: '0'
    }
  });
}

function describeFailure(result) {
  return [
    `status=${result.status}`,
    `signal=${result.signal}`,
    result.error ? `error=${result.error.message}` : null,
    `stdout=${result.stdout}`,
    `stderr=${result.stderr}`
  ]
    .filter(Boolean)
    .join(' ');
}
