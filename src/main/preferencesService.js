import EventEmitter from 'node:events';
import os from 'node:os';
import path from 'node:path';

import { logSafeError } from '../shared/diagnostics.js';

export const DEFAULT_PREFERENCES = Object.freeze({
  language: 'en',
  notifications: Object.freeze({
    sessionReset: true,
    sound: false,
    soundVolume: 1.0,
    expireSound: false,
    expireSoundVolume: 1.0,
    expireAlert: false,
    limitSound: false,
    limitSoundVolume: 1.0,
    limitAlert: false
  }),
  floating: Object.freeze({
    enabled: false,
    expanded: false,
    style: 'classic',
    x: null,
    y: null
  }),
  startup: Object.freeze({
    openAtLogin: false,
    showWindowOnLogin: false
  }),
  refresh: Object.freeze({
    intervalSeconds: 30
  }),
  integration: Object.freeze({
    launchWithClaudeCode: false
  }),
  claudePath: null
});

export class PreferencesService extends EventEmitter {
  constructor(store) {
    super();
    this.store = store;
    this.writeQueue = Promise.resolve();
    this._cache = null;
  }

  async load() {
    if (!this._cache) {
      this._cache = mergePreferences(await this.store.load());
    }
    return structuredClone(this._cache);
  }

  async get(path) {
    if (!this._cache) {
      this._cache = mergePreferences(await this.store.load());
    }
    return getPath(this._cache, path);
  }

  async getClaudePath() {
    const configuredPath = await this.get('claudePath');
    return configuredPath || path.join(os.homedir(), '.claude');
  }

  async set(path, value) {
    return this.enqueueWrite(async () => {
      if (!this._cache) {
        this._cache = mergePreferences(await this.store.load());
      }
      setPath(this._cache, path, value);
      const preferences = structuredClone(this._cache);
      await this.store.save(preferences);
      this.emit('change', { path, value, preferences });
      return preferences;
    });
  }

  // Set multiple paths in a single write, then emit one 'change' event per path.
  // `entries` is an array of [path, value] pairs.
  async setMany(entries) {
    return this.enqueueWrite(async () => {
      if (!this._cache) {
        this._cache = mergePreferences(await this.store.load());
      }
      for (const [path, value] of entries) {
        setPath(this._cache, path, value);
      }
      const preferences = structuredClone(this._cache);
      await this.store.save(preferences);
      for (const [path, value] of entries) {
        this.emit('change', { path, value, preferences });
      }
      return preferences;
    });
  }

  enqueueWrite(operation) {
    const run = this.writeQueue.then(operation, operation);
    this.writeQueue = run.catch(err => logSafeError('[prefs] write failed:', err));
    return run;
  }
}

function mergePreferences(stored) {
  return deepMerge(clone(DEFAULT_PREFERENCES), isPlainObject(stored) ? stored : {});
}

function deepMerge(target, source) {
  for (const key in source) {
    if (!Object.prototype.hasOwnProperty.call(source, key)) continue;
    if (key === '__proto__' || key === 'constructor' || key === 'prototype') continue;
    const value = source[key];
    if (isPlainObject(value) && isPlainObject(target[key])) {
      deepMerge(target[key], value);
    } else {
      target[key] = clone(value);
    }
  }
  return target;
}

function getPath(object, path) {
  return path.split('.').reduce((current, key) => current?.[key], object);
}

function setPath(object, path, value) {
  const parts = path.split('.');
  let current = object;
  for (const part of parts.slice(0, -1)) {
    if (part === '__proto__' || part === 'constructor' || part === 'prototype') return;
    if (!isPlainObject(current[part])) {
      current[part] = {};
    }
    current = current[part];
  }
  const lastPart = parts.at(-1);
  if (lastPart !== '__proto__' && lastPart !== 'constructor' && lastPart !== 'prototype') {
    current[lastPart] = value;
  }
}

function clone(value) {
  return structuredClone(value);
}

function isPlainObject(value) {
  return value != null && typeof value === 'object' && !Array.isArray(value);
}
