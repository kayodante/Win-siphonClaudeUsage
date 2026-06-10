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

  async hasSiphonHook() {
    return this._hasSiphonInSettings(await this._readSettings());
  }

  async enable() {
    const settings = await this._readSettings() ?? {};
    if (this._hasSiphonInSettings(settings)) return;
    if (!settings.hooks) settings.hooks = {};
    if (!Array.isArray(settings.hooks.SessionStart)) settings.hooks.SessionStart = [];
    settings.hooks.SessionStart.push(this._buildHookEntry());
    await this._writeSettings(settings);
  }

  async disable() {
    const settings = await this._readSettings();
    if (!this._hasSiphonInSettings(settings)) return;
    settings.hooks.SessionStart = settings.hooks.SessionStart.filter(e => e._siphon !== true);
    if (settings.hooks.SessionStart.length === 0) delete settings.hooks.SessionStart;
    if (Object.keys(settings.hooks).length === 0) delete settings.hooks;
    await this._writeSettings(settings);
  }

  async ensureEnabled() {
    return this.enable();
  }
}
