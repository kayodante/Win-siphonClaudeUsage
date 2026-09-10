//! Typed errors returned by the Tauri `#[tauri::command]` layer.
//!
//! Serialized straight to the renderer, so `kind` is a stable contract:
//! the renderer maps it to an i18n string. `Display` is English, for logs.

#[derive(Debug, thiserror::Error, serde::Serialize)]
#[serde(tag = "kind", content = "detail", rename_all = "camelCase")]
pub enum CommandError {
    #[error("unknown preference path: {0}")]
    UnknownPreference(String),
    #[error("invalid value for preference {path}")]
    InvalidPreferenceValue { path: String, value: String },
    #[error("preference write failed: {0}")]
    PrefWrite(String),
    #[error("Claude Code settings sync failed: {0}")]
    ClaudeSettings(String),
    #[error("blocked external url: {0}")]
    UnsafeUrl(String),
}

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
