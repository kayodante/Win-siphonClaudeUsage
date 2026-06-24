// fallow-ignore-file unused-file -- spawned as child process by trayIcon.test.js, not a JS import
import assert from 'node:assert/strict';

import electron from 'electron';

import { createTrayIcon } from '../../src/main/trayIcon.js';

if (!process.versions.electron) {
  process.exit(0);
}

const { app } = electron;

let exitCode = 0;

app
  .whenReady()
  .then(() => {
    const level = process.argv.at(-1);
    const image = createTrayIcon(level);
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
