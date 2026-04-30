import EventEmitter from 'node:events';

export const DEFAULT_PREFERENCES = Object.freeze({
  notifications: Object.freeze({
    sessionReset: true
  }),
  floating: Object.freeze({
    enabled: false,
    x: null,
    y: null
  })
});

export class PreferencesService extends EventEmitter {
  constructor(store) {
    super();
    this.store = store;
  }

  load() {
    return mergePreferences(this.store.load());
  }

  get(path) {
    return getPath(this.load(), path);
  }

  set(path, value) {
    const preferences = this.load();
    setPath(preferences, path, value);
    this.store.save(preferences);
    this.emit('change', { path, value, preferences });
    return preferences;
  }
}

function mergePreferences(stored) {
  return deepMerge(clone(DEFAULT_PREFERENCES), isPlainObject(stored) ? stored : {});
}

function deepMerge(target, source) {
  for (const [key, value] of Object.entries(source)) {
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
    if (!isPlainObject(current[part])) {
      current[part] = {};
    }
    current = current[part];
  }
  current[parts.at(-1)] = value;
}

function clone(value) {
  return structuredClone(value);
}

function isPlainObject(value) {
  return value != null && typeof value === 'object' && !Array.isArray(value);
}
