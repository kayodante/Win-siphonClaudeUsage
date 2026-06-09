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
    const image = createAppIcon(nativeImage, projectRoot);
    const size = image.getSize();

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
