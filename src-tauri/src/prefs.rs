//! Preferences store — port of `preferencesService.js`. Wraps the `siphon_core`
//! merge/get/set helpers over an atomic JSON file, serializing writes behind a
//! mutex. `set`/`set_many` return the change list so the controller can react
//! (floating toggles, refresh interval, startup, claudePath) exactly like the
//! JS `change` events.

use std::path::PathBuf;
use std::sync::Mutex;

use serde_json::Value;
use siphon_core::json_store::JsonStore;
use siphon_core::preferences::{self, Preferences};

pub struct PrefsStore {
    store: JsonStore,
    cache: Mutex<Value>,
}

pub struct Change {
    pub path: String,
    pub value: Value,
    pub preferences: Preferences,
}

impl PrefsStore {
    pub fn new(path: PathBuf) -> Self {
        let store = JsonStore::new(path);
        let stored = store.load().ok().flatten();
        let cache = preferences::merge(stored.unwrap_or(Value::Null));
        PrefsStore {
            store,
            cache: Mutex::new(cache),
        }
    }

    pub fn load(&self) -> Preferences {
        let cache = self.cache.lock().unwrap();
        serde_json::from_value(cache.clone()).unwrap_or_default()
    }

    pub fn get(&self, path: &str) -> Option<Value> {
        let cache = self.cache.lock().unwrap();
        preferences::get_path(&cache, path).cloned()
    }

    /// Effective Claude dir: configured `claudePath` or `~/.claude`.
    pub fn claude_dir(&self) -> PathBuf {
        match self.get("claudePath") {
            Some(Value::String(s)) if !s.is_empty() => PathBuf::from(s),
            _ => siphon_core::json_store::default_claude_dir(),
        }
    }

    pub fn set(&self, path: &str, value: Value) -> std::io::Result<Change> {
        let prefs = {
            let mut cache = self.cache.lock().unwrap();
            preferences::set_path(&mut cache, path, value.clone());
            self.store.save(Some(&cache))?;
            serde_json::from_value(cache.clone()).unwrap_or_default()
        };
        Ok(Change {
            path: path.to_string(),
            value,
            preferences: prefs,
        })
    }

    pub fn set_many(&self, entries: Vec<(String, Value)>) -> std::io::Result<Vec<Change>> {
        let prefs = {
            let mut cache = self.cache.lock().unwrap();
            for (path, value) in &entries {
                preferences::set_path(&mut cache, path, value.clone());
            }
            self.store.save(Some(&cache))?;
            serde_json::from_value::<Preferences>(cache.clone()).unwrap_or_default()
        };
        Ok(entries
            .into_iter()
            .map(|(path, value)| Change {
                path,
                value,
                preferences: prefs.clone(),
            })
            .collect())
    }
}
