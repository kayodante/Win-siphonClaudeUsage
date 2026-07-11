//! The `state` object emitted to the renderer. Field names use camelCase so the
//! existing frontend (`renderer.js`, `floating.js`) consumes it unchanged — it
//! is byte-compatible with the object the Electron `UsageController` used to
//! send over `state-changed`.

use serde::{Deserialize, Serialize};

use crate::preferences::Preferences;
use crate::quota::Quota;

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct PeriodStats {
    pub input_tokens: u64,
    pub output_tokens: u64,
    pub cache_read_tokens: u64,
    pub cache_write_tokens: u64,
    pub total_tokens: u64,
    pub cost: f64,
    pub is_empty: bool,
    /// Keyed by model id; values are per-model stats.
    pub by_model: serde_json::Map<String, serde_json::Value>,
}

impl Default for PeriodStats {
    fn default() -> Self {
        PeriodStats {
            input_tokens: 0,
            output_tokens: 0,
            cache_read_tokens: 0,
            cache_write_tokens: 0,
            total_tokens: 0,
            cost: 0.0,
            is_empty: true,
            by_model: serde_json::Map::new(),
        }
    }
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Default)]
#[serde(rename_all = "camelCase")]
pub struct Profile {
    pub name: Option<String>,
    pub email: Option<String>,
    pub plan: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize, Default)]
#[serde(rename_all = "camelCase")]
pub struct AppState {
    pub today_stats: PeriodStats,
    pub month_stats: PeriodStats,
    pub quota: Option<Quota>,
    pub local_error: Option<String>,
    pub quota_error: Option<String>,
    pub auth_error: Option<String>,
    pub profile: Option<Profile>,
    pub preferences: Preferences,
    pub is_signed_in: bool,
    pub awaiting_code: bool,
    /// ISO-8601 string, matching the JS `Date.toISOString()` output.
    pub last_updated: Option<String>,
    pub is_offline: bool,
    pub needs_reauth: bool,
}
