import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

import { resolveAppIconPath } from '../src/main/appIcon.js';

const electronPath = await loadElectronPath();

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const probePath = path.join(__dirname, 'fixtures', 'appIconProbe.mjs');

async function loadElectronPath() {
  try {
    return (await import('electron')).default;
  } catch {
    return null;
  }
}

test('resolveAppIconPath points to the installer icon in development', () => {
  const projectRoot = path.join('K:\\', 'Claude', 'PROJECTS', 'siphon');

  assert.equal(
    resolveAppIconPath(projectRoot),
    path.join(projectRoot, 'assets', 'installer', 'icon.ico')
  );
});

test('createAppIcon returns a non-empty native image', { skip: electronPath ? false : 'electron is not installed' }, () => {
  const result = spawnSync(electronPath, [probePath], {
    cwd: path.resolve(__dirname, '..'),
    encoding: 'utf8',
    timeout: 10_000,
    env: {
      ...process.env,
      ELECTRON_ENABLE_LOGGING: '0'
    }
  });

  assert.equal(result.status, 0, result.stderr);
  assert.match(result.stdout, /"isEmpty":false/);
});

test('resolveAppIconPath points outside app.asar when packaged', () => {
  const projectRoot = path.join(
    'C:\\',
    'Users',
    'kayod',
    'AppData',
    'Local',
    'Programs',
    'Siphon',
    'resources',
    'app.asar'
  );

  assert.equal(
    resolveAppIconPath(projectRoot),
    path.join(
      'C:\\',
      'Users',
      'kayod',
      'AppData',
      'Local',
      'Programs',
      'Siphon',
      'resources',
      'app.asar.unpacked',
      'assets',
      'installer',
      'icon.ico'
    )
  );
});
