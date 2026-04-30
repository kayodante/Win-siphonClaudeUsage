import fs from 'node:fs';
import path from 'node:path';

export class JsonStore {
  constructor(filePath) {
    this.filePath = filePath;
  }

  load() {
    try {
      return JSON.parse(fs.readFileSync(this.filePath, 'utf8'));
    } catch (error) {
      if (error.code === 'ENOENT') return null;
      throw error;
    }
  }

  save(value) {
    fs.mkdirSync(path.dirname(this.filePath), { recursive: true });
    if (value == null) {
      try {
        fs.unlinkSync(this.filePath);
      } catch (error) {
        if (error.code !== 'ENOENT') throw error;
      }
      return;
    }
    const tmpPath = `${this.filePath}.tmp`;
    fs.writeFileSync(tmpPath, JSON.stringify(value, null, 2), { mode: 0o600 });
    fs.renameSync(tmpPath, this.filePath);
  }
}
