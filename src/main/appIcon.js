import path from 'node:path';

export function resolveAppIconPath(projectRoot) {
  return path
    .join(projectRoot, 'assets', 'installer', 'icon.ico')
    .replace(`${path.sep}app.asar${path.sep}`, `${path.sep}app.asar.unpacked${path.sep}`);
}

export function createAppIcon(nativeImage, projectRoot) {
  return nativeImage.createFromPath(resolveAppIconPath(projectRoot));
}
