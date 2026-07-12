//! Port of `src/main/preferencesService.js`. The typed `Preferences` struct
//! mirrors `DEFAULT_PREFERENCES`; the free-standing `merge`, `get_path` and
//! `set_path` helpers operate on `serde_json::Value` so the dotted-path
//! `prefs:set` contract works exactly like the JS deep-merge (including the
//! `__proto__` / `constructor` / `prototype` guards).

use serde::{Deserialize, Serialize};
use serde_json::{Map, Value};

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct Notifications {
    pub session_reset: bool,
    pub sound: bool,
    pub sound_volume: f64,
    pub expire_sound: bool,
    pub expire_sound_volume: f64,
    pub expire_alert: bool,
    pub limit_sound: bool,
    pub limit_sound_volume: f64,
    pub limit_alert: bool,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct Floating {
    pub enabled: bool,
    pub expanded: bool,
    pub style: String,
    pub x: Option<i64>,
    pub y: Option<i64>,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct Startup {
    pub open_at_login: bool,
    pub show_window_on_login: bool,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct Refresh {
    pub interval_seconds: u64,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct Integration {
    pub launch_with_claude_code: bool,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct Privacy {
    pub mask_email: bool,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct Display {
    pub quota_mode: String,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct WindowBounds {
    pub x: Option<i64>,
    pub y: Option<i64>,
    pub width: Option<i64>,
    pub height: Option<i64>,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct Preferences {
    pub language: String,
    pub notifications: Notifications,
    pub floating: Floating,
    pub startup: Startup,
    pub refresh: Refresh,
    pub integration: Integration,
    pub privacy: Privacy,
    pub display: Display,
    pub claude_path: Option<String>,
    #[serde(default)]
    pub window: Option<WindowBounds>,
}

impl Default for Preferences {
    fn default() -> Self {
        Preferences {
            language: "en".to_string(),
            notifications: Notifications {
                session_reset: true,
                sound: false,
                sound_volume: 1.0,
                expire_sound: false,
                expire_sound_volume: 1.0,
                expire_alert: false,
                limit_sound: false,
                limit_sound_volume: 1.0,
                limit_alert: false,
            },
            floating: Floating {
                enabled: false,
                expanded: false,
                style: "classic".to_string(),
                x: None,
                y: None,
            },
            startup: Startup {
                open_at_login: false,
                show_window_on_login: false,
            },
            refresh: Refresh {
                interval_seconds: 30,
            },
            integration: Integration {
                launch_with_claude_code: false,
            },
            privacy: Privacy { mask_email: false },
            display: Display {
                quota_mode: "used".to_string(),
            },
            claude_path: None,
            window: None,
        }
    }
}

impl Preferences {
    /// Default preferences as a `Value` (used as the deep-merge base).
    pub fn default_value() -> Value {
        serde_json::to_value(Preferences::default()).expect("defaults serialize")
    }

    /// Merge stored JSON over the defaults and deserialize. Unknown keys in the
    /// stored blob are preserved through the merge but dropped on typed
    /// deserialization — same observable behaviour as the JS `mergePreferences`.
    pub fn merged(stored: Option<Value>) -> Preferences {
        let value = merge(stored.unwrap_or(Value::Null));
        serde_json::from_value(value).unwrap_or_default()
    }
}

const FORBIDDEN: [&str; 3] = ["__proto__", "constructor", "prototype"];

fn is_plain_object(v: &Value) -> bool {
    v.is_object()
}

/// Deep-merge `stored` over `DEFAULT_PREFERENCES`, returning a merged `Value`.
pub fn merge(stored: Value) -> Value {
    let mut base = Preferences::default_value();
    if let Value::Object(src) = stored {
        deep_merge(base.as_object_mut().unwrap(), &src);
    }
    base
}

fn deep_merge(target: &mut Map<String, Value>, source: &Map<String, Value>) {
    for (key, value) in source {
        if FORBIDDEN.contains(&key.as_str()) {
            continue;
        }
        match (target.get_mut(key), value) {
            (Some(t), s) if is_plain_object(t) && is_plain_object(s) => {
                deep_merge(t.as_object_mut().unwrap(), s.as_object().unwrap());
            }
            _ => {
                target.insert(key.clone(), value.clone());
            }
        }
    }
}

/// Read a dotted path (e.g. `"notifications.sound"`) from `object`.
pub fn get_path<'a>(object: &'a Value, path: &str) -> Option<&'a Value> {
    let mut current = object;
    for key in path.split('.') {
        current = current.get(key)?;
    }
    Some(current)
}

/// Write `value` at a dotted path, creating intermediate objects. Guards against
/// prototype-pollution keys exactly like the JS `setPath`.
pub fn set_path(object: &mut Value, path: &str, value: Value) {
    let parts: Vec<&str> = path.split('.').collect();
    let mut current = object;
    for part in &parts[..parts.len() - 1] {
        if FORBIDDEN.contains(part) {
            return;
        }
        let Some(map) = current.as_object_mut() else { return };
        let entry = map
            .entry(part.to_string())
            .or_insert_with(|| Value::Object(Map::new()));
        if !entry.is_object() {
            *entry = Value::Object(Map::new());
        }
        current = entry;
    }
    let last = parts[parts.len() - 1];
    if !FORBIDDEN.contains(&last) {
        if let Some(map) = current.as_object_mut() {
            map.insert(last.to_string(), value);
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;

    #[test]
    fn defaults_round_trip() {
        let prefs = Preferences::merged(None);
        assert_eq!(prefs.language, "en");
        assert!(prefs.notifications.session_reset);
        assert_eq!(prefs.refresh.interval_seconds, 30);
        assert_eq!(prefs.display.quota_mode, "used");
        assert_eq!(prefs.floating.style, "classic");
    }

    #[test]
    fn stored_overrides_defaults() {
        let stored = json!({
            "language": "pt-BR",
            "notifications": { "sound": true },
            "refresh": { "intervalSeconds": 300 }
        });
        let prefs = Preferences::merged(Some(stored));
        assert_eq!(prefs.language, "pt-BR");
        assert!(prefs.notifications.sound);
        // Untouched nested default preserved by deep-merge.
        assert!(prefs.notifications.session_reset);
        assert_eq!(prefs.refresh.interval_seconds, 300);
    }

    #[test]
    fn get_and_set_dotted_paths() {
        let mut v = Preferences::default_value();
        assert_eq!(
            get_path(&v, "notifications.sound"),
            Some(&Value::Bool(false))
        );
        set_path(&mut v, "notifications.sound", Value::Bool(true));
        assert_eq!(
            get_path(&v, "notifications.sound"),
            Some(&Value::Bool(true))
        );
    }

    #[test]
    fn set_path_blocks_prototype_pollution() {
        let mut v = Preferences::default_value();
        set_path(&mut v, "__proto__.polluted", Value::Bool(true));
        assert!(get_path(&v, "__proto__.polluted").is_none());
    }

    #[test]
    fn set_path_through_scalar_replaces_instead_of_panicking() {
        let mut v = json!({ "language": "en" });
        set_path(&mut v, "language.nested", Value::Bool(true));
        assert_eq!(get_path(&v, "language.nested"), Some(&Value::Bool(true)));
    }
}
