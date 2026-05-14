import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import electron from 'electron';

const { nativeImage } = electron;

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const iconRoot = path.resolve(__dirname, '..', '..', 'assets', 'tray-icon');

export function createTrayIcon(sessionLevel = 'ok', weeklyLevel = 'ok') {
  const base = `tray-${sessionLevel}-${weeklyLevel}`;
  const image = nativeImage.createEmpty();
  image.addRepresentation({
    scaleFactor: 1.0,
    buffer: fs.readFileSync(path.join(iconRoot, `${base}.png`))
  });
  image.addRepresentation({
    scaleFactor: 2.0,
    buffer: fs.readFileSync(path.join(iconRoot, `${base}@2x.png`))
  });
  return image;
}
