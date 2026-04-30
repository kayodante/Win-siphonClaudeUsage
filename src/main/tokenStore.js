import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

export class TokenStore {
  constructor(filePath = path.join(configDir(), 'credentials.json')) {
    this.filePath = filePath;
  }

  async load() {
    try {
      const raw = await fs.readFile(this.filePath, 'utf8');
      return JSON.parse(raw);
    } catch (error) {
      if (error.code === 'ENOENT') return null;
      throw error;
    }
  }

  async save(credentials) {
    await fs.mkdir(path.dirname(this.filePath), { recursive: true });
    const tmpPath = `${this.filePath}.tmp`;
    await fs.writeFile(tmpPath, JSON.stringify(credentials, null, 2), {
      mode: 0o600
    });
    await fs.rename(tmpPath, this.filePath);
  }

  async clear() {
    try {
      await fs.unlink(this.filePath);
    } catch (error) {
      if (error.code !== 'ENOENT') throw error;
    }
  }
}

export function configDir() {
  const root = process.env.APPDATA || path.join(os.homedir(), 'AppData', 'Roaming');
  return path.join(root, 'Siphon');
}
