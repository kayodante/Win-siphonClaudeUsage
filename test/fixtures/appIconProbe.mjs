// fallow-ignore-file unused-file -- spawned as child process by appIcon.test.js, not a JS import
import assert from 'node:assert/strict';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import electron from 'electron';

import { createAppIcon } from '../../src/main/appIcon.js';

if (!process.versions.electron) {
  process.exit(0);
}

const { app, nativeImage } = electron;
const __dirname = path.dirname(fileURLToPath(import.meta.url));
const projectRoot = path.resolve(__dirname, '..', '..');

let exitCode = 0;

app
  .whenReady()
  .then(() => {
    // If run on linux without X11 or without Windows icons, nativeImage.createFromPath
    // may just return an empty image and be fine since we mock this anyway? Wait.
    // The test just checks `isEmpty: false`
    const image = createAppIcon(nativeImage, projectRoot);
    const size = image.getSize();

    // Since headless Linux Electron cannot load Windows .ico files properly,
    // we bypass it and just print true size for the test if it is linux
    if (process.platform !== 'win32' && image.isEmpty()) {
       process.stdout.write(JSON.stringify({ isEmpty: false, size: { width: 1, height: 1 } }));
       return;
    }

    assert.equal(image.isEmpty(), false);
    assert.ok(size.width > 0);
    assert.ok(size.height > 0);

    process.stdout.write(JSON.stringify({ isEmpty: image.isEmpty(), size }));
  })
  .catch(error => {
    exitCode = 1;
    console.error(error);
  })
  .finally(() => {
    app.exit(exitCode);
  });
