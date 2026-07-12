//! Credential type + expiry logic (`tokenLifecycle.js`) and the marker-byte
//! encoding from `tokenStore.js`. The DPAPI cipher itself lives in the binary
//! crate (`src/token_store.rs`) behind the `Cipher` trait defined here, so the
//! on-disk format — including migration from legacy plaintext JSON — is decided
//! and tested in one place.

use chrono::{DateTime, Duration, Utc};
use serde::{Deserialize, Serialize};

/// OAuth credentials, serialized camelCase to stay byte-compatible with the
/// existing `credentials.json`.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct Credentials {
    pub access_token: String,
    #[serde(default)]
    pub refresh_token: Option<String>,
    /// ISO-8601, matching the JS `expiresAt`.
    #[serde(default)]
    pub expires_at: Option<String>,
}

impl Credentials {
    /// A token counts as expired 30s before its real expiry (matches `isExpired`).
    pub fn is_expired(&self, now: DateTime<Utc>) -> bool {
        match &self.expires_at {
            None => false,
            Some(iso) => match DateTime::parse_from_rfc3339(iso) {
                Ok(exp) => exp.with_timezone(&Utc) <= now + Duration::seconds(30),
                // Unparseable expiry → treat as not-expired, same as `new Date(NaN)`
                // comparisons which are always false in JS.
                Err(_) => false,
            },
        }
    }

    pub fn has_refresh_token(&self) -> bool {
        self.refresh_token
            .as_deref()
            .map(|s| !s.is_empty())
            .unwrap_or(false)
    }

    /// Keep the previous refresh token when a token-refresh response omits one
    /// (some providers only rotate it occasionally). Losing it would force a
    /// full re-login at the next expiry.
    pub fn preserving_refresh_from(mut self, previous: &Credentials) -> Self {
        if self.refresh_token.is_none() {
            self.refresh_token = previous.refresh_token.clone();
        }
        self
    }
}

// On-disk format markers, identical to `tokenStore.js`.
pub const MARKER_DPAPI: u8 = 0x01;
pub const MARKER_PLAIN: u8 = 0x02;
pub const MARKER_LEGACY: u8 = 0x7b; // '{' — legacy plaintext JSON

/// Encode a JSON string as the plaintext on-disk form (`0x02` + bytes).
pub fn encode_plaintext(json: &str) -> Vec<u8> {
    let mut out = Vec::with_capacity(json.len() + 1);
    out.push(MARKER_PLAIN);
    out.extend_from_slice(json.as_bytes());
    out
}

/// Decode a plaintext-marked buffer back to its JSON string.
pub fn decode_plaintext(buf: &[u8]) -> String {
    String::from_utf8_lossy(&buf[1..]).into_owned()
}

/// The DPAPI cipher, implemented in the binary crate. Kept as a trait so the
/// store's load/save (with legacy migration) is host-agnostic and testable with
/// a plaintext fake.
pub trait Cipher {
    fn encrypt(&self, json: &str) -> std::io::Result<Vec<u8>>;
    fn decrypt(&self, buf: &[u8]) -> std::io::Result<String>;
}

/// Plaintext cipher used on non-Windows hosts and in tests.
pub struct PlaintextCipher;

impl Cipher for PlaintextCipher {
    fn encrypt(&self, json: &str) -> std::io::Result<Vec<u8>> {
        Ok(encode_plaintext(json))
    }
    fn decrypt(&self, buf: &[u8]) -> std::io::Result<String> {
        Ok(decode_plaintext(buf))
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use chrono::TimeZone;

    fn now() -> DateTime<Utc> {
        Utc.with_ymd_and_hms(2026, 1, 1, 12, 0, 0).unwrap()
    }

    #[test]
    fn expiry_with_skew() {
        let mut c = Credentials {
            access_token: "a".into(),
            refresh_token: Some("r".into()),
            expires_at: Some("2026-01-01T12:00:20Z".into()), // 20s ahead < 30s skew
        };
        assert!(c.is_expired(now()));
        c.expires_at = Some("2026-01-01T13:00:00Z".into());
        assert!(!c.is_expired(now()));
        c.expires_at = None;
        assert!(!c.is_expired(now()));
    }

    #[test]
    fn plaintext_marker_round_trip() {
        let cipher = PlaintextCipher;
        let buf = cipher.encrypt("{\"a\":1}").unwrap();
        assert_eq!(buf[0], MARKER_PLAIN);
        assert_eq!(cipher.decrypt(&buf).unwrap(), "{\"a\":1}");
    }

    #[test]
    fn refresh_response_without_token_keeps_previous() {
        let old = Credentials {
            access_token: "old".into(),
            refresh_token: Some("keepme".into()),
            expires_at: None,
        };
        let refreshed = Credentials {
            access_token: "new".into(),
            refresh_token: None,
            expires_at: None,
        };
        let merged = refreshed.preserving_refresh_from(&old);
        assert_eq!(merged.refresh_token.as_deref(), Some("keepme"));
        assert_eq!(merged.access_token, "new");

        let rotated = Credentials {
            access_token: "new2".into(),
            refresh_token: Some("rotated".into()),
            expires_at: None,
        };
        assert_eq!(
            rotated
                .preserving_refresh_from(&old)
                .refresh_token
                .as_deref(),
            Some("rotated")
        );
    }
}
