//! Port of `claudeSettingsService.js`. Registers/removes a `SessionStart` hook in
//! `~/.claude/settings.json` that launches Siphon when a Claude Code session
//! starts. Atomic write (tmp + rename), idempotent.

use std::path::PathBuf;

use serde_json::{json, Value};

pub struct ClaudeSettings {
    exe_path: String,
    settings_path: PathBuf,
}

impl ClaudeSettings {
    pub fn new(exe_path: String) -> Self {
        ClaudeSettings {
            exe_path,
            settings_path: siphon_core::json_store::default_claude_dir().join("settings.json"),
        }
    }

    fn hook_entry(&self) -> Value {
        json!({
            "matcher": "startup|resume",
            "hooks": [{
                "type": "command",
                "command": format!("powershell -NoProfile -Command \"Start-Process '{}'\"", self.exe_path),
                "shell": "powershell",
                "async": true
            }]
        })
    }

    fn is_siphon_entry(&self, entry: &Value) -> bool {
        entry
            .pointer("/hooks/0/command")
            .and_then(|v| v.as_str())
            .map(|cmd| cmd == self.exe_path || cmd.contains(&self.exe_path))
            .unwrap_or(false)
    }

    fn read(&self) -> Option<Value> {
        let raw = std::fs::read_to_string(&self.settings_path).ok()?;
        serde_json::from_str(&raw).ok()
    }

    fn write(&self, settings: &Value) -> std::io::Result<()> {
        if let Some(dir) = self.settings_path.parent() {
            std::fs::create_dir_all(dir)?;
        }
        let tmp = self.settings_path.with_extension("json.tmp");
        std::fs::write(&tmp, serde_json::to_string_pretty(settings).unwrap())?;
        std::fs::rename(&tmp, &self.settings_path)?;
        Ok(())
    }

    pub fn enable(&self) -> std::io::Result<()> {
        let mut settings = self.read().unwrap_or_else(|| json!({}));
        let hooks = settings
            .as_object_mut()
            .unwrap()
            .entry("hooks")
            .or_insert_with(|| json!({}));
        let existing = hooks
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
        hooks
            .as_object_mut()
            .unwrap()
            .insert("SessionStart".into(), Value::Array(kept));
        self.write(&settings)
    }

    pub fn disable(&self) -> std::io::Result<()> {
        let Some(mut settings) = self.read() else { return Ok(()) };
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
        let hooks = settings.get_mut("hooks").unwrap().as_object_mut().unwrap();
        if filtered.is_empty() {
            hooks.remove("SessionStart");
        } else {
            hooks.insert("SessionStart".into(), Value::Array(filtered));
        }
        if hooks.is_empty() {
            settings.as_object_mut().unwrap().remove("hooks");
        }
        self.write(&settings)
    }
}
