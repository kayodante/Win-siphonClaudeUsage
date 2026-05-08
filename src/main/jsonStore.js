import fs from 'node:fs/promises';
import path from 'node:path';

export class JsonStore {
  constructor(filePath) {
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

  async save(value) {
    await fs.mkdir(path.dirname(this.filePath), { recursive: true });
    if (value == null) {
      try {
        await fs.unlink(this.filePath);
      } catch (error) {
        if (error.code !== 'ENOENT') throw error;
      }
      return;
    }
    const tmpPath = `${this.filePath}.tmp`;
    await fs.writeFile(tmpPath, JSON.stringify(value, null, 2), { mode: 0o600 });
    await fs.rename(tmpPath, this.filePath);
  }
}
