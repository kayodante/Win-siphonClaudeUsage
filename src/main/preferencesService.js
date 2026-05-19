import EventEmitter from 'node:events';

import { logSafeError } from '../shared/diagnostics.js';

export const DEFAULT_PREFERENCES = Object.freeze({
  language: 'en',
  notifications: Object.freeze({
    sessionReset: true,
    sound: false,
    soundVolume: 1.0,
    limitSound: false,
    limitSoundVolume: 1.0
  }),
  floating: Object.freeze({
    enabled: false,
    expanded: false,
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
  claudePath: null
});

export class PreferencesService extends EventEmitter {
  constructor(store) {
    super();
    this.store = store;
    this.writeQueue = Promise.resolve();
  }

  async load() {
    return mergePreferences(await this.store.load());
  }

  async get(path) {
    return getPath(await this.load(), path);
  }

  async set(path, value) {
    return this.enqueueWrite(async () => {
      const preferences = await this.load();
      setPath(preferences, path, value);
      await this.store.save(preferences);
      this.emit('change', { path, value, preferences });
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
  for (const [key, value] of Object.entries(source)) {
    if (key === '__proto__' || key === 'constructor' || key === 'prototype') continue;
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
