import path from 'node:path';
import { fileURLToPath } from 'node:url';

import electron from 'electron';

const { nativeImage } = electron;

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const assetRoot = path.resolve(__dirname, '..', '..', 'assets');

const ICONS = {
  ok: 'tray.png',
  warn: 'tray-warn.png',
  high: 'tray-high.png',
  critical: 'tray-danger.png',
  danger: 'tray-danger.png'
};

export function createTrayIcon(level = 'ok') {
  const filename = ICONS[level] ?? ICONS.ok;
  return nativeImage.createFromPath(path.join(assetRoot, filename));
}
