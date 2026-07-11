//! Port of `src/main/jsonStore.js` and the `configDir()` helper from
//! `tokenStore.js`. Synchronous std::fs; the binary crate calls these from
//! `spawn_blocking` where it needs to stay off the async runtime.

use std::path::{Path, PathBuf};

use serde_json::Value;

/// `%APPDATA%\Siphon` on Windows; `~/.config/Siphon`-style fallback elsewhere so
/// tests and dev on non-Windows hosts still have a home. Matches the JS
/// `configDir()` (which reads `APPDATA` with a `~/AppData/Roaming` fallback).
pub fn config_dir() -> PathBuf {
    if let Ok(appdata) = std::env::var("APPDATA") {
        return Path::new(&appdata).join("Siphon");
    }
    let home = home_dir();
    home.join("AppData").join("Roaming").join("Siphon")
}

/// Default Claude Code data directory: `~/.claude`.
pub fn default_claude_dir() -> PathBuf {
    home_dir().join(".claude")
}

pub fn home_dir() -> PathBuf {
    #[cfg(windows)]
    {
        if let Ok(profile) = std::env::var("USERPROFILE") {
            return PathBuf::from(profile);
        }
    }
    if let Ok(home) = std::env::var("HOME") {
        return PathBuf::from(home);
    }
    PathBuf::from(".")
}

/// A JSON file with atomic writes (tmp + rename) and a corrupt-file tolerance
/// that resets to `None`, exactly like `JsonStore`.
pub struct JsonStore {
    pub path: PathBuf,
}

impl JsonStore {
    pub fn new<P: Into<PathBuf>>(path: P) -> Self {
        JsonStore { path: path.into() }
    }

    /// Returns `Ok(None)` when the file is absent or malformed; `Err` only on
    /// unexpected I/O errors.
    pub fn load(&self) -> std::io::Result<Option<Value>> {
        match std::fs::read_to_string(&self.path) {
            Ok(raw) => match serde_json::from_str::<Value>(&raw) {
                Ok(v) => Ok(Some(v)),
                Err(_) => Ok(None), // malformed → reset to defaults
            },
            Err(e) if e.kind() == std::io::ErrorKind::NotFound => Ok(None),
            Err(e) => Err(e),
        }
    }

    /// Write atomically. `None` deletes the file (matching `save(null)`).
    pub fn save(&self, value: Option<&Value>) -> std::io::Result<()> {
        if let Some(parent) = self.path.parent() {
            std::fs::create_dir_all(parent)?;
        }
        match value {
            None => match std::fs::remove_file(&self.path) {
                Ok(()) => Ok(()),
                Err(e) if e.kind() == std::io::ErrorKind::NotFound => Ok(()),
                Err(e) => Err(e),
            },
            Some(v) => {
                let tmp = self.path.with_extension("json.tmp");
                let serialized = serde_json::to_string_pretty(v)
                    .map_err(|e| std::io::Error::new(std::io::ErrorKind::InvalidData, e))?;
                std::fs::write(&tmp, serialized)?;
                set_owner_only(&tmp)?;
                std::fs::rename(&tmp, &self.path)?;
                Ok(())
            }
        }
    }
}

/// Restrict a file to the owner (mode 0600), matching the JS `{ mode: 0o600 }`.
/// No-op on non-Unix platforms.
pub fn set_owner_only(path: &Path) -> std::io::Result<()> {
    #[cfg(unix)]
    {
        use std::os::unix::fs::PermissionsExt;
        let perms = std::fs::Permissions::from_mode(0o600);
        std::fs::set_permissions(path, perms)?;
    }
    #[cfg(not(unix))]
    {
        let _ = path;
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;

    #[test]
    fn round_trips_and_deletes() {
        let dir = std::env::temp_dir().join(format!("siphon-jsonstore-{}", std::process::id()));
        let store = JsonStore::new(dir.join("x.json"));
        assert_eq!(store.load().unwrap(), None);

        store.save(Some(&json!({"a": 1}))).unwrap();
        assert_eq!(store.load().unwrap(), Some(json!({"a": 1})));

        store.save(None).unwrap();
        assert_eq!(store.load().unwrap(), None);
        let _ = std::fs::remove_dir_all(&dir);
    }

    #[test]
    fn malformed_json_resets() {
        let dir = std::env::temp_dir().join(format!("siphon-jsonstore-bad-{}", std::process::id()));
        std::fs::create_dir_all(&dir).unwrap();
        let path = dir.join("bad.json");
        std::fs::write(&path, "{ not json").unwrap();
        let store = JsonStore::new(&path);
        assert_eq!(store.load().unwrap(), None);
        let _ = std::fs::remove_dir_all(&dir);
    }
}
