//! Port of `claudeSettingsService.js`. Registers/removes a `SessionStart` hook in
//! `~/.claude/settings.json` that launches Siphon when a Claude Code session
//! starts. Atomic write (tmp + rename), idempotent.

use std::path::PathBuf;

use serde_json::{json, Value};

use crate::launch::CLAUDE_HOOK_ARG;

pub struct ClaudeSettings {
    exe_path: String,
    settings_path: PathBuf,
}

/// Recognizes legacy shell hooks by their first single-quoted executable.
/// A user's hook that merely mentions a Siphon state file is left alone.
fn launches_siphon(cmd: &str) -> bool {
    cmd.split('\'').nth(1).is_some_and(is_siphon_executable)
}

fn is_siphon_executable(target: &str) -> bool {
    target.rsplit(['\\', '/']).next().is_some_and(|file| {
        let file = file.to_ascii_lowercase();
        file.starts_with("siphon") && file.ends_with(".exe")
    })
}

impl ClaudeSettings {
    pub fn new(exe_path: String) -> Self {
        Self::with_paths(
            exe_path,
            siphon_core::json_store::default_claude_dir().join("settings.json"),
        )
    }

    fn with_paths(exe_path: String, settings_path: PathBuf) -> Self {
        ClaudeSettings {
            exe_path,
            settings_path,
        }
    }

    fn hook_entry(&self) -> Value {
        json!({
            "matcher": "startup|resume",
            "hooks": [{
                "type": "command",
                // Exec form avoids creating a shell; the exe detaches itself.
                "command": self.exe_path,
                "args": [CLAUDE_HOOK_ARG]
            }]
        })
    }

    /// Matches the current exe path *and* any hook launching another Siphon
    /// build (dev, portable, an older install dir). Without the second case
    /// every build location leaves its own entry behind and each Claude Code
    /// session starts one Siphon per stale hook.
    fn is_siphon_entry(&self, entry: &Value) -> bool {
        let Some(hook) = entry.pointer("/hooks/0") else {
            return false;
        };
        let Some(cmd) = hook.get("command").and_then(|v| v.as_str()) else {
            return false;
        };
        cmd == self.exe_path
            || cmd.contains(&self.exe_path)
            || launches_siphon(cmd)
            || (hook.get("args").is_some_and(Value::is_array) && is_siphon_executable(cmd))
    }

    /// Returns `None` for a missing, unparsable, or non-object settings file so
    /// callers can start from an empty object instead of panicking.
    fn read(&self) -> Option<Value> {
        let raw = std::fs::read_to_string(&self.settings_path).ok()?;
        let v: Value = serde_json::from_str(&raw).ok()?;
        v.is_object().then_some(v)
    }

    fn write(&self, settings: &Value) -> std::io::Result<()> {
        if let Some(dir) = self.settings_path.parent() {
            std::fs::create_dir_all(dir)?;
        }
        let serialized = serde_json::to_string_pretty(settings)
            .map_err(|e| std::io::Error::new(std::io::ErrorKind::InvalidData, e))?;
        let tmp = self.settings_path.with_extension("json.tmp");
        std::fs::write(&tmp, serialized)?;
        std::fs::rename(&tmp, &self.settings_path)?;
        Ok(())
    }

    fn check_exe_path(&self) -> std::io::Result<()> {
        // An empty exe path would make `is_siphon_entry` match every hook
        // (contains("") is always true) and destroy the user's other hooks.
        if self.exe_path.is_empty() {
            return Err(std::io::Error::new(
                std::io::ErrorKind::InvalidInput,
                "siphon exe path unknown; refusing to edit settings.json",
            ));
        }
        Ok(())
    }

    pub fn enable(&self) -> std::io::Result<()> {
        self.check_exe_path()?;
        let mut settings = self.read().unwrap_or_else(|| json!({}));
        let Some(root) = settings.as_object_mut() else {
            return Ok(());
        };
        let hooks = root.entry("hooks").or_insert_with(|| json!({}));
        if !hooks.is_object() {
            *hooks = json!({});
        }
        let Some(hooks_map) = hooks.as_object_mut() else {
            return Ok(());
        };
        let existing = hooks_map
            .get("SessionStart")
            .and_then(|v| v.as_array())
            .cloned()
            .unwrap_or_default();
        let mut kept: Vec<Value> = existing
            .iter()
            .filter(|e| !self.is_siphon_entry(e))
            .cloned()
            .collect();
        kept.push(self.hook_entry());
        if Value::Array(kept.clone()) == Value::Array(existing) {
            return Ok(());
        }
        hooks_map.insert("SessionStart".into(), Value::Array(kept));
        self.write(&settings)
    }

    pub fn disable(&self) -> std::io::Result<()> {
        self.check_exe_path()?;
        let Some(mut settings) = self.read() else {
            return Ok(());
        };
        let Some(existing) = settings
            .pointer("/hooks/SessionStart")
            .and_then(|v| v.as_array())
            .cloned()
        else {
            return Ok(());
        };
        let filtered: Vec<Value> = existing
            .iter()
            .filter(|e| !self.is_siphon_entry(e))
            .cloned()
            .collect();
        if filtered.len() == existing.len() {
            return Ok(());
        }
        let hooks_empty = {
            let Some(hooks) = settings.get_mut("hooks").and_then(|h| h.as_object_mut()) else {
                return Ok(());
            };
            if filtered.is_empty() {
                hooks.remove("SessionStart");
            } else {
                hooks.insert("SessionStart".into(), Value::Array(filtered));
            }
            hooks.is_empty()
        };
        if hooks_empty {
            if let Some(root) = settings.as_object_mut() {
                root.remove("hooks");
            }
        }
        self.write(&settings)
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn temp_dir(name: &str) -> PathBuf {
        let dir = std::env::temp_dir().join(format!(
            "siphon-claude-settings-{name}-{}",
            std::process::id()
        ));
        std::fs::create_dir_all(&dir).unwrap();
        dir
    }

    #[test]
    fn enable_survives_non_object_root() {
        let dir = temp_dir("badroot");
        let path = dir.join("settings.json");
        std::fs::write(&path, "[1,2,3]").unwrap();
        let svc = ClaudeSettings::with_paths("C:\\apps\\siphon.exe".into(), path.clone());
        svc.enable().unwrap(); // must not panic; rewrites as an object
        let v: Value = serde_json::from_str(&std::fs::read_to_string(&path).unwrap()).unwrap();
        assert!(v.pointer("/hooks/SessionStart/0/hooks/0/command").is_some());
        let _ = std::fs::remove_dir_all(&dir);
    }

    #[test]
    fn empty_exe_path_is_rejected() {
        let dir = temp_dir("emptyexe");
        let svc = ClaudeSettings::with_paths(String::new(), dir.join("settings.json"));
        assert!(svc.enable().is_err());
        assert!(svc.disable().is_err());
        let _ = std::fs::remove_dir_all(&dir);
    }

    #[test]
    fn enable_replaces_hooks_from_other_siphon_builds() {
        let dir = temp_dir("otherbuilds");
        let path = dir.join("settings.json");
        std::fs::write(
            &path,
            r#"{"hooks":{"SessionStart":[
                {"matcher":"startup|resume","hooks":[{"type":"command","command":"powershell -NoProfile -Command \"Start-Process 'C:\\old\\Programs\\Siphon\\Siphon.exe'\""}]},
                {"matcher":"startup|resume","hooks":[{"type":"command","command":"powershell -NoProfile -Command \"Start-Process 'K:\\repo\\target\\debug\\siphon.exe'\""}]},
                {"matcher":"startup|resume","hooks":[{"type":"command","command":"powershell -NoProfile -Command \"Start-Process 'K:\\repo\\nsis\\Siphon.Portable.1.7.3.exe'\""}]},
                {"matcher":"startup|resume","hooks":[{"type":"command","command":"Start-Process 'K:\\repo\\target\\release\\siphon.exe' -ArgumentList '--hidden'","shell":"powershell"}]},
                {"matcher":"startup|resume","hooks":[{"type":"command","command":"C:\\other\\Siphon.Portable.1.15.0.exe","args":["--claude-hook"]}]},
                {"matcher":"startup","hooks":[{"type":"command","command":"powershell -NoProfile -Command \"Set-Content -Path 'K:\\other\\state.json'\""}]}
            ]}}"#,
        )
        .unwrap();
        let svc = ClaudeSettings::with_paths("C:\\apps\\siphon.exe".into(), path.clone());
        svc.enable().unwrap();
        let v: Value = serde_json::from_str(&std::fs::read_to_string(&path).unwrap()).unwrap();
        let entries = v
            .pointer("/hooks/SessionStart")
            .unwrap()
            .as_array()
            .unwrap();
        // the foreign state-file hook plus exactly one Siphon launcher
        assert_eq!(entries.len(), 2);
        assert!(entries[0].to_string().contains("state.json"));
        let cmd = entries[1]
            .pointer("/hooks/0/command")
            .and_then(|v| v.as_str())
            .unwrap();
        // Exec-form hooks pass the executable and arguments without a shell.
        assert_eq!(cmd, "C:\\apps\\siphon.exe");
        assert_eq!(
            entries[1].pointer("/hooks/0/args"),
            Some(&json!(["--claude-hook"]))
        );
        assert!(entries[1].pointer("/hooks/0/shell").is_none());
        assert!(entries[1].pointer("/hooks/0/async").is_none());
        let _ = std::fs::remove_dir_all(&dir);
    }

    #[test]
    fn exec_hook_preserves_special_characters_and_is_idempotent() {
        let dir = temp_dir("execpath");
        let path = dir.join("settings.json");
        let exe = "C:\\Users\\O'Brien $test`\\Siphon\\siphon.exe";
        let svc = ClaudeSettings::with_paths(exe.into(), path.clone());
        svc.enable().unwrap();
        let first = std::fs::read_to_string(&path).unwrap();
        svc.enable().unwrap();
        assert_eq!(std::fs::read_to_string(&path).unwrap(), first);
        let settings: Value = serde_json::from_str(&first).unwrap();
        assert_eq!(
            settings.pointer("/hooks/SessionStart/0/hooks/0/command"),
            Some(&json!(exe))
        );
        let _ = std::fs::remove_dir_all(&dir);
    }

    #[test]
    fn disable_keeps_foreign_hooks() {
        let dir = temp_dir("foreign");
        let path = dir.join("settings.json");
        std::fs::write(
            &path,
            r#"{"hooks":{"SessionStart":[{"matcher":"startup","hooks":[{"type":"command","command":"echo hi"}]}]}}"#,
        )
        .unwrap();
        let svc = ClaudeSettings::with_paths("C:\\apps\\siphon.exe".into(), path.clone());
        svc.disable().unwrap();
        assert!(std::fs::read_to_string(&path).unwrap().contains("echo hi"));
        let _ = std::fs::remove_dir_all(&dir);
    }

    #[test]
    fn disable_removes_other_exec_form_siphon_builds_but_keeps_foreign_hooks() {
        let dir = temp_dir("disableexec");
        let path = dir.join("settings.json");
        let foreign = json!({"hooks": [{
            "type": "command",
            "command": "Write-Output 'C:\\other\\Siphon\\state.json'",
            "shell": "powershell"
        }]});
        std::fs::write(&path, json!({"hooks": {"SessionStart": [
            {"hooks": [{"type": "command", "command": "C:\\old\\SIPHON.exe", "args": ["--claude-hook"]}]},
            foreign.clone()
        ]}, "theme": "dark"}).to_string()).unwrap();
        let svc = ClaudeSettings::with_paths("C:\\apps\\siphon.exe".into(), path.clone());
        svc.disable().unwrap();
        let settings: Value =
            serde_json::from_str(&std::fs::read_to_string(&path).unwrap()).unwrap();
        assert_eq!(settings["hooks"]["SessionStart"], json!([foreign]));
        assert_eq!(settings["theme"], "dark");
        let _ = std::fs::remove_dir_all(&dir);
    }
}
