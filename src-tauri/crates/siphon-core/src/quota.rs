//! Port of `src/main/quotaService.js`. The `Quota` type is what the controller
//! serializes into `state.quota`; the parsing and HTTP-status → error mapping
//! are pure and tested here. The binary crate owns the request + token refresh.

use serde::{Deserialize, Serialize};
use serde_json::Value;

use crate::format::parse_iso;

/// A single quota bucket (session or weekly). `resetsAt` is an ISO string so the
/// renderer hydrates it with `new Date(...)` exactly as before.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct Slot {
    pub percent: f64,
    pub resets_at: Option<String>,
}

/// Purchased extra credits beyond the plan quota (only when enabled server-side).
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct ExtraUsage {
    pub monthly_limit: f64,
    pub used_credits: f64,
    pub utilization: f64,
}

/// A weekly quota the API scopes to one model (Fable today), from `limits[]`.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct ScopedSlot {
    /// The model's display name as the API sends it ("Fable").
    pub name: String,
    pub percent: f64,
    pub resets_at: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct Quota {
    pub session: Option<Slot>,
    pub weekly_all: Option<Slot>,
    pub extra_usage: Option<ExtraUsage>,
    #[serde(default)]
    pub weekly_scoped: Vec<ScopedSlot>,
}

/// Error codes matching `QuotaError.code` in the JS.
#[derive(Debug, Clone, PartialEq)]
pub enum QuotaErrorCode {
    NotSignedIn,
    Unauthorized,
    ScopeInsufficient,
    RateLimited { retry_after: u64 },
    Network,
    Server,
}

#[derive(Debug, Clone, thiserror::Error)]
#[error("{message}")]
pub struct QuotaError {
    pub code: QuotaErrorCode,
    pub message: String,
}

impl QuotaError {
    pub fn new(code: QuotaErrorCode, message: impl Into<String>) -> Self {
        QuotaError {
            code,
            message: message.into(),
        }
    }
}

/// Parse the raw usage payload into a `Quota`. Matches `parseUsageResponse`.
pub fn parse_usage_response(raw: &Value) -> Quota {
    Quota {
        session: parse_bucket(raw.get("five_hour")),
        weekly_all: parse_bucket(raw.get("seven_day")),
        extra_usage: parse_extra_usage(raw.get("extra_usage")),
        weekly_scoped: parse_weekly_scoped(raw.get("limits")),
    }
}

/// `limits[]` entries of kind `weekly_scoped` that name a model. Entries
/// scoped to something else (a surface) or without a percent are skipped.
fn parse_weekly_scoped(limits: Option<&Value>) -> Vec<ScopedSlot> {
    let Some(limits) = limits.and_then(|l| l.as_array()) else {
        return Vec::new();
    };
    limits
        .iter()
        .filter(|l| l.get("kind").and_then(|k| k.as_str()) == Some("weekly_scoped"))
        .filter_map(|l| {
            let name = l
                .pointer("/scope/model/display_name")
                .and_then(|n| n.as_str())
                .filter(|n| !n.trim().is_empty())?;
            Some(ScopedSlot {
                name: name.to_string(),
                percent: l.get("percent").and_then(|p| p.as_f64())?,
                resets_at: normalize_reset(l.get("resets_at")),
            })
        })
        .collect()
}

fn parse_bucket(bucket: Option<&Value>) -> Option<Slot> {
    let bucket = bucket?;
    if bucket.is_null() {
        return None;
    }
    let percent = bucket
        .get("utilization")
        .and_then(|v| v.as_f64())
        .unwrap_or(0.0);
    let resets_at = normalize_reset(bucket.get("resets_at"));
    Some(Slot { percent, resets_at })
}

/// Re-emit a valid ISO timestamp normalized so downstream `new Date()` is happy.
fn normalize_reset(value: Option<&Value>) -> Option<String> {
    let parsed = parse_iso(value?.as_str()?)?;
    Some(parsed.format("%Y-%m-%dT%H:%M:%S%.3fZ").to_string())
}

/// Matches `parseExtraUsage`: only present when `is_enabled === true`.
pub fn parse_extra_usage(extra: Option<&Value>) -> Option<ExtraUsage> {
    let extra = extra?;
    if extra.get("is_enabled").and_then(|v| v.as_bool()) != Some(true) {
        return None;
    }
    let num = |k: &str| extra.get(k).and_then(|v| v.as_f64()).unwrap_or(0.0);
    Some(ExtraUsage {
        // Credit fields arrive in cents; the UI formats them as dollars.
        monthly_limit: num("monthly_limit") / 100.0,
        used_credits: num("used_credits") / 100.0,
        utilization: num("utilization"),
    })
}

/// Map a non-200 status to a `QuotaError`, matching the switch in `fetchQuota`.
/// (200 is handled by the caller after parsing the body.)
pub fn error_for_status(status: u16, retry_after_header: Option<&str>) -> QuotaError {
    match status {
        401 => QuotaError::new(
            QuotaErrorCode::Unauthorized,
            "Session expired. Please sign in again.",
        ),
        403 => QuotaError::new(
            QuotaErrorCode::ScopeInsufficient,
            "Re-authentication required.",
        ),
        429 => {
            let retry_after = retry_after_header
                .and_then(|s| s.parse::<u64>().ok())
                .filter(|n| *n > 0)
                .unwrap_or(300);
            QuotaError::new(QuotaErrorCode::RateLimited { retry_after }, "Rate limited")
        }
        other => QuotaError::new(QuotaErrorCode::Server, format!("Server error ({other})")),
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;

    #[test]
    fn parses_buckets_and_extra() {
        let raw = json!({
            "five_hour": { "utilization": 42.5, "resets_at": "2026-07-06T15:00:00Z" },
            "seven_day": { "utilization": 10 },
            "extra_usage": { "is_enabled": true, "monthly_limit": 2000, "used_credits": 1556, "utilization": 77.8 }
        });
        let q = parse_usage_response(&raw);
        assert_eq!(q.session.as_ref().unwrap().percent, 42.5);
        assert!(q.session.as_ref().unwrap().resets_at.is_some());
        assert_eq!(q.weekly_all.as_ref().unwrap().percent, 10.0);
        // Cents in, dollars out.
        let extra = q.extra_usage.as_ref().unwrap();
        assert_eq!(extra.used_credits, 15.56);
        assert_eq!(extra.monthly_limit, 20.0);
    }

    /// Shape captured from the live endpoint on 2026-11-16.
    #[test]
    fn parses_model_scoped_weekly_limits() {
        let raw = json!({
            "limits": [
                { "kind": "session", "percent": 66, "resets_at": "2026-11-16T04:30:00.169584+00:00", "scope": null },
                { "kind": "weekly_all", "percent": 56, "resets_at": "2026-11-17T03:00:00.169602+00:00", "scope": null },
                { "kind": "weekly_scoped", "percent": 66, "resets_at": "2026-11-17T03:00:00.169856+00:00",
                  "scope": { "model": { "id": null, "display_name": "Fable" }, "surface": null } },
                { "kind": "weekly_scoped", "percent": 10, "scope": { "model": null, "surface": { "display_name": "Cowork" } } },
                { "kind": "weekly_scoped", "scope": { "model": { "display_name": "NoPercent" } } }
            ]
        });
        let scoped = parse_usage_response(&raw).weekly_scoped;
        assert_eq!(scoped.len(), 1);
        assert_eq!(scoped[0].name, "Fable");
        assert_eq!(scoped[0].percent, 66.0);
        assert_eq!(
            scoped[0].resets_at.as_deref(),
            Some("2026-11-17T03:00:00.169Z")
        );
    }

    #[test]
    fn missing_limits_means_no_scoped_quota() {
        assert!(parse_usage_response(&json!({})).weekly_scoped.is_empty());
        assert!(parse_usage_response(&json!({ "limits": null }))
            .weekly_scoped
            .is_empty());
    }

    #[test]
    fn extra_usage_hidden_when_disabled() {
        let raw = json!({ "extra_usage": { "is_enabled": false, "monthly_limit": 100 } });
        assert!(parse_usage_response(&raw).extra_usage.is_none());
    }

    #[test]
    fn status_mapping() {
        assert_eq!(
            error_for_status(401, None).code,
            QuotaErrorCode::Unauthorized
        );
        assert_eq!(
            error_for_status(403, None).code,
            QuotaErrorCode::ScopeInsufficient
        );
        assert_eq!(
            error_for_status(429, Some("120")).code,
            QuotaErrorCode::RateLimited { retry_after: 120 }
        );
        assert_eq!(
            error_for_status(429, None).code,
            QuotaErrorCode::RateLimited { retry_after: 300 }
        );
        assert_eq!(error_for_status(500, None).code, QuotaErrorCode::Server);
    }
}
