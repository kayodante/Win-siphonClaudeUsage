import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';

export class ClaudeSettingsService {
  constructor({ exePath, settingsPath }) {
    this.exePath = exePath;
    this.settingsPath = settingsPath ?? path.join(os.homedir(), '.claude', 'settings.json');
  }

  _buildHookEntry() {
    return {
      _siphon: true,
      matcher: 'startup',
      hooks: [{
        type: 'command',
        command: this.exePath,
        async: true
      }]
    };
  }

  async _readSettings() {
    try {
      const content = await fs.readFile(this.settingsPath, 'utf8');
      return JSON.parse(content);
    } catch (err) {
      if (err.code === 'ENOENT') return null;
      throw err;
    }
  }

  async _writeSettings(settings) {
    const dir = path.dirname(this.settingsPath);
    const tmp = this.settingsPath + '.tmp';
    await fs.mkdir(dir, { recursive: true });
    await fs.writeFile(tmp, JSON.stringify(settings, null, 2), 'utf8');
    await fs.rename(tmp, this.settingsPath);
  }

  _hasSiphonInSettings(settings) {
    return (settings?.hooks?.SessionStart ?? []).some(e => e._siphon === true);
  }

  async enable() {
    const settings = await this._readSettings() ?? {};
    if (!settings.hooks) settings.hooks = {};
    const existing = Array.isArray(settings.hooks.SessionStart) ? settings.hooks.SessionStart : [];
    // Drop any prior siphon entries (marked or orphaned from older versions) pointing at our exe,
    // then add one fresh entry — keeps re-runs idempotent and self-healing after upgrades.
    const kept = existing.filter(e => e?.hooks?.[0]?.command !== this.exePath);
    const rebuilt = [...kept, this._buildHookEntry()];
    if (JSON.stringify(rebuilt) === JSON.stringify(existing)) return;
    settings.hooks.SessionStart = rebuilt;
    await this._writeSettings(settings);
  }

  async disable() {
    const settings = await this._readSettings();
    if (!settings?.hooks?.SessionStart) return;
    const filtered = settings.hooks.SessionStart.filter(
      e => e._siphon !== true && e?.hooks?.[0]?.command !== this.exePath
    );
    if (filtered.length === settings.hooks.SessionStart.length) return;
    settings.hooks.SessionStart = filtered;
    if (settings.hooks.SessionStart.length === 0) delete settings.hooks.SessionStart;
    if (Object.keys(settings.hooks).length === 0) delete settings.hooks;
    await this._writeSettings(settings);
  }

  async ensureEnabled() {
    return this.enable();
  }
}
