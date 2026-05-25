import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

const MARKER_DPAPI = 0x01;
const MARKER_PLAIN = 0x02;
const MARKER_LEGACY = 0x7b; // '{'

export class PlaintextCrypto {
  encrypt(json) {
    return Buffer.concat([Buffer.from([MARKER_PLAIN]), Buffer.from(json, 'utf8')]);
  }

  decrypt(buf) {
    return buf.slice(1).toString('utf8');
  }
}

export class SafeStorageCrypto {
  async encrypt(json) {
    const { safeStorage } = await import('electron');
    if (!safeStorage.isEncryptionAvailable()) {
      console.warn('[tokenStore] safeStorage unavailable — credentials stored as plaintext');
      return Buffer.concat([Buffer.from([MARKER_PLAIN]), Buffer.from(json, 'utf8')]);
    }
    return Buffer.concat([Buffer.from([MARKER_DPAPI]), safeStorage.encryptString(json)]);
  }

  async decrypt(buf) {
    if (buf[0] === MARKER_PLAIN) {
      return buf.slice(1).toString('utf8');
    }
    if (buf[0] !== MARKER_DPAPI) {
      throw new Error(`tokenStore: unknown format marker 0x${buf[0]?.toString(16) ?? 'undefined'}`);
    }
    const { safeStorage } = await import('electron');
    return safeStorage.decryptString(buf.slice(1));
  }
}

export class TokenStore {
  constructor(
    filePath = path.join(configDir(), 'credentials.json'),
    crypto = new SafeStorageCrypto()
  ) {
    this.filePath = filePath;
    this.crypto = crypto;
  }

  async load() {
    try {
      const buf = await fs.readFile(this.filePath);
      if (buf[0] === MARKER_LEGACY) {
        // Legacy plaintext JSON — migrate once
        let creds;
        try {
          creds = JSON.parse(buf.toString('utf8'));
        } catch {
          return null;
        }
        try {
          await this.save(creds);
        } catch {
          // migration save failed; return credentials anyway
        }
        return creds;
      }
      const json = await this.crypto.decrypt(buf);
      return JSON.parse(json);
    } catch (error) {
      if (error.code === 'ENOENT') return null;
      throw error;
    }
  }

  async save(credentials) {
    const dir = path.dirname(this.filePath);
    await fs.mkdir(dir, { recursive: true });
    const buf = await this.crypto.encrypt(JSON.stringify(credentials));
    const tmpPath = `${this.filePath}.tmp`;
    await fs.writeFile(tmpPath, buf, { mode: 0o600 });
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
