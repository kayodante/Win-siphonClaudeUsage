import assert from 'node:assert/strict';

import electron from 'electron';

import { createTrayIcon } from '../../src/main/trayIcon.js';

if (!process.versions.electron) {
  process.exit(0);
}

const { app } = electron;

await app.whenReady();

try {
  const level = process.argv.at(-1);
  const image = createTrayIcon(level);
  const size = image.getSize();

  assert.equal(image.isEmpty(), false);
  assert.ok(size.width > 0);
  assert.ok(size.height > 0);

  process.stdout.write(JSON.stringify({ isEmpty: image.isEmpty(), size }));
} finally {
  app.quit();
}
