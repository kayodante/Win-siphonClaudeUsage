//! Typed errors returned by the Tauri `#[tauri::command]` layer.
//!
//! Serialized straight to the renderer, so `kind` is a stable contract:
//! the renderer maps it to an i18n string. `Display` is English, for logs.

#[derive(Debug, serde::Serialize)]
#[serde(tag = "kind", content = "detail", rename_all = "camelCase")]
pub enum CommandError {
    UnknownPreference(String),
    InvalidPreferenceValue { path: String, value: String },
    PrefWrite(String),
    ClaudeSettings(String),
    UnsafeUrl(String),
}

impl std::fmt::Display for CommandError {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        match self {
            Self::UnknownPreference(p) => write!(f, "unknown preference path: {p}"),
            Self::InvalidPreferenceValue { path, .. } => {
                write!(f, "invalid value for preference {path}")
            }
            Self::PrefWrite(e) => write!(f, "preference write failed: {e}"),
            Self::ClaudeSettings(e) => write!(f, "Claude Code settings sync failed: {e}"),
            Self::UnsafeUrl(u) => write!(f, "blocked external url: {u}"),
        }
    }
}

impl std::error::Error for CommandError {}

/// Every command in `commands.rs` returns this. Note that several commands are
/// infallible and still return it: Tauri requires a `Result` from any async
/// command taking `State<'_, _>`.
pub type CommandResult<T = ()> = Result<T, CommandError>;

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;

    #[test]
    fn unknown_preference_serializes_kind_and_detail() {
        let err = CommandError::UnknownPreference("nope.path".to_string());
        assert_eq!(
            serde_json::to_value(&err).unwrap(),
            json!({"kind": "unknownPreference", "detail": "nope.path"})
        );
    }

    #[test]
    fn invalid_preference_value_serializes_struct_detail() {
        let err = CommandError::InvalidPreferenceValue {
            path: "floating.style".to_string(),
            value: "\"neon\"".to_string(),
        };
        assert_eq!(
            serde_json::to_value(&err).unwrap(),
            json!({
                "kind": "invalidPreferenceValue",
                "detail": {"path": "floating.style", "value": "\"neon\""}
            })
        );
    }

    #[test]
    fn unsafe_url_display_is_english() {
        let err = CommandError::UnsafeUrl("ftp://x".to_string());
        assert_eq!(err.to_string(), "blocked external url: ftp://x");
    }
}
