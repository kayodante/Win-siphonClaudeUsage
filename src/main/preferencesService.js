import EventEmitter from 'node:events';

export const DEFAULT_PREFERENCES = Object.freeze({
  language: 'en',
  notifications: Object.freeze({
    sessionReset: true,
    sound: false
  }),
  floating: Object.freeze({
    enabled: false,
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
  }

  async load() {
    return mergePreferences(await this.store.load());
  }

  async get(path) {
    return getPath(await this.load(), path);
  }

  async set(path, value) {
    const preferences = await this.load();
    setPath(preferences, path, value);
    await this.store.save(preferences);
    this.emit('change', { path, value, preferences });
    return preferences;
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
