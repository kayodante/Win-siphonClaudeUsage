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

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct Quota {
    pub session: Option<Slot>,
    pub weekly_all: Option<Slot>,
    pub extra_usage: Option<ExtraUsage>,
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
    }
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
    let resets_at = bucket
        .get("resets_at")
        .and_then(|v| v.as_str())
        .filter(|s| parse_iso(s).is_some())
        .map(|s| {
            // Re-emit as a normalized ISO string so downstream `new Date()` is happy.
            parse_iso(s)
                .unwrap()
                .format("%Y-%m-%dT%H:%M:%S%.3fZ")
                .to_string()
        });
    Some(Slot { percent, resets_at })
}

/// Matches `parseExtraUsage`: only present when `is_enabled === true`.
pub fn parse_extra_usage(extra: Option<&Value>) -> Option<ExtraUsage> {
    let extra = extra?;
    if extra.get("is_enabled").and_then(|v| v.as_bool()) != Some(true) {
        return None;
    }
    let num = |k: &str| extra.get(k).and_then(|v| v.as_f64()).unwrap_or(0.0);
    Some(ExtraUsage {
        monthly_limit: num("monthly_limit"),
        used_credits: num("used_credits"),
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
            "extra_usage": { "is_enabled": true, "monthly_limit": 100, "used_credits": 25, "utilization": 25 }
        });
        let q = parse_usage_response(&raw);
        assert_eq!(q.session.as_ref().unwrap().percent, 42.5);
        assert!(q.session.as_ref().unwrap().resets_at.is_some());
        assert_eq!(q.weekly_all.as_ref().unwrap().percent, 10.0);
        assert_eq!(q.extra_usage.as_ref().unwrap().used_credits, 25.0);
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
