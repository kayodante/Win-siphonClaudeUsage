//! Pure OAuth/PKCE helpers ported from `src/main/oauthService.js`. Building the
//! authorize URL, generating the PKCE verifier/challenge, extracting the pasted
//! code, assembling token-request bodies and parsing the token response are all
//! here; the binary crate performs the actual `POST`.

use base64::engine::general_purpose::URL_SAFE_NO_PAD;
use base64::Engine;
use chrono::{DateTime, Duration, Utc};
use serde_json::{json, Value};
use sha2::{Digest, Sha256};

use crate::token::Credentials;

pub const CLIENT_ID: &str = "9d1c250a-e61b-44d9-88ed-5944d1962f5e";
pub const REDIRECT_URI: &str = "https://platform.claude.com/oauth/code/callback";
pub const AUTH_URL: &str = "https://claude.ai/oauth/authorize";
pub const TOKEN_URL: &str = "https://platform.claude.com/v1/oauth/token";
pub const SCOPES: &[&str] = &["user:profile", "user:inference"];

/// A prepared sign-in flow: the URL to open plus the PKCE verifier and state to
/// keep for the exchange.
#[derive(Debug, Clone)]
pub struct AuthFlow {
    pub url: String,
    pub verifier: String,
    pub state: String,
}

/// Prepare a PKCE flow. `prepareFlow` in the original.
pub fn prepare_flow() -> AuthFlow {
    let verifier = random_url_string();
    let challenge = code_challenge(&verifier);
    let state = random_url_string();
    AuthFlow {
        url: authorize_url(&challenge, &state),
        verifier,
        state,
    }
}

/// Build the authorize URL with a given challenge + state (split out for tests).
pub fn authorize_url(challenge: &str, state: &str) -> String {
    let scope = SCOPES.join(" ");
    let params = [
        ("code", "true"),
        ("client_id", CLIENT_ID),
        ("response_type", "code"),
        ("redirect_uri", REDIRECT_URI),
        ("scope", &scope),
        ("code_challenge", challenge),
        ("code_challenge_method", "S256"),
        ("state", state),
    ];
    let query = params
        .iter()
        .map(|(k, v)| format!("{}={}", k, url_encode(v)))
        .collect::<Vec<_>>()
        .join("&");
    format!("{AUTH_URL}?{query}")
}

/// S256 challenge: base64url(sha256(verifier)). Matches `codeChallenge`.
pub fn code_challenge(verifier: &str) -> String {
    let digest = Sha256::digest(verifier.as_bytes());
    URL_SAFE_NO_PAD.encode(digest)
}

fn random_url_string() -> String {
    use rand::RngCore;
    let mut bytes = [0u8; 32];
    rand::thread_rng().fill_bytes(&mut bytes);
    URL_SAFE_NO_PAD.encode(bytes)
}

/// Extract the auth code from a pasted redirect URL or raw code. Matches
/// `extractCode`: take the part before `#`, and if it parses as a URL use its
/// `code` query param, otherwise return it verbatim.
pub fn extract_code(raw: &str) -> String {
    let trimmed = raw.trim();
    let first_part = trimmed.split('#').next().unwrap_or(trimmed);
    // Try to read a `code` query parameter out of a URL-shaped string.
    if let Some((_, query)) = first_part.split_once('?') {
        for pair in query.split('&') {
            if let Some(rest) = pair.strip_prefix("code=") {
                return url_decode(rest);
            }
        }
    }
    first_part.to_string()
}

/// Body for the authorization-code exchange.
pub fn exchange_body(code: &str, verifier: &str, state: &str) -> Value {
    json!({
        "grant_type": "authorization_code",
        "code": code,
        "state": state,
        "client_id": CLIENT_ID,
        "redirect_uri": REDIRECT_URI,
        "code_verifier": verifier,
    })
}

/// Body for a refresh-token grant.
pub fn refresh_body(refresh_token: &str) -> Value {
    json!({
        "grant_type": "refresh_token",
        "refresh_token": refresh_token,
        "client_id": CLIENT_ID,
    })
}

/// Whether a failed token-endpoint POST is fatal for the stored credentials.
/// 400/401/403 mean the grant itself was rejected (e.g. `invalid_grant`) — the
/// refresh token is dead and must be discarded. Anything else (429, 5xx,
/// network) is transient: keep the credentials and retry later.
pub fn refresh_failure_is_fatal(status: u16) -> bool {
    matches!(status, 400 | 401 | 403)
}

/// Parse a successful token response into `Credentials`. Matches `#postToken`'s
/// success branch (default 3600s expiry, `expiresAt` = now + expires_in).
pub fn parse_token_response(json: &Value, now: DateTime<Utc>) -> Result<Credentials, String> {
    let access_token = json
        .get("access_token")
        .and_then(|v| v.as_str())
        .filter(|s| !s.is_empty())
        .ok_or_else(|| "Auth failed: missing access token".to_string())?;
    let expires_in = json
        .get("expires_in")
        .and_then(|v| v.as_i64())
        .unwrap_or(3600);
    let expires_at = (now + Duration::seconds(expires_in))
        .format("%Y-%m-%dT%H:%M:%S%.3fZ")
        .to_string();
    Ok(Credentials {
        access_token: access_token.to_string(),
        refresh_token: json
            .get("refresh_token")
            .and_then(|v| v.as_str())
            .map(|s| s.to_string()),
        expires_at: Some(expires_at),
    })
}

// Minimal percent-encoding for query values (space, and reserved chars we emit).
fn url_encode(s: &str) -> String {
    let mut out = String::with_capacity(s.len());
    for b in s.bytes() {
        match b {
            b'A'..=b'Z' | b'a'..=b'z' | b'0'..=b'9' | b'-' | b'_' | b'.' | b'~' => {
                out.push(b as char)
            }
            _ => out.push_str(&format!("%{b:02X}")),
        }
    }
    out
}

fn url_decode(s: &str) -> String {
    let bytes = s.as_bytes();
    let mut out = Vec::with_capacity(bytes.len());
    let mut i = 0;
    while i < bytes.len() {
        if bytes[i] == b'%' && i + 2 < bytes.len() {
            if let Ok(v) = u8::from_str_radix(&s[i + 1..i + 3], 16) {
                out.push(v);
                i += 3;
                continue;
            }
        }
        out.push(bytes[i]);
        i += 1;
    }
    String::from_utf8_lossy(&out).into_owned()
}

#[cfg(test)]
mod tests {
    use super::*;
    use chrono::TimeZone;

    #[test]
    fn refresh_failure_classification() {
        // Grant rejected — stored refresh token is dead, clearing is correct.
        assert!(refresh_failure_is_fatal(400));
        assert!(refresh_failure_is_fatal(401));
        assert!(refresh_failure_is_fatal(403));
        // Transient — server/rate trouble, keep credentials and retry.
        assert!(!refresh_failure_is_fatal(429));
        assert!(!refresh_failure_is_fatal(500));
        assert!(!refresh_failure_is_fatal(502));
        assert!(!refresh_failure_is_fatal(503));
    }

    #[test]
    fn challenge_is_deterministic_base64url() {
        // Known S256 vector: base64url(sha256("verifier")) has no padding.
        let c = code_challenge("verifier");
        assert!(!c.contains('='));
        assert!(!c.contains('+'));
        assert!(!c.contains('/'));
        assert_eq!(c, code_challenge("verifier"));
    }

    #[test]
    fn authorize_url_contains_params() {
        let url = authorize_url("CHAL", "STATE");
        assert!(url.starts_with("https://claude.ai/oauth/authorize?"));
        assert!(url.contains("code_challenge=CHAL"));
        assert!(url.contains("code_challenge_method=S256"));
        assert!(url.contains("state=STATE"));
        assert!(url.contains(&format!("client_id={CLIENT_ID}")));
        assert!(url.contains("scope=user%3Aprofile%20user%3Ainference"));
    }

    #[test]
    fn extract_code_from_url_and_raw() {
        assert_eq!(
            extract_code("https://x/callback?code=ABC123&state=y#frag"),
            "ABC123"
        );
        assert_eq!(extract_code("  RAWCODE  "), "RAWCODE");
        assert_eq!(extract_code("RAWCODE#stuff"), "RAWCODE");
    }

    #[test]
    fn parses_token_response() {
        let now = Utc.with_ymd_and_hms(2026, 1, 1, 12, 0, 0).unwrap();
        let resp = json!({ "access_token": "tok", "refresh_token": "ref", "expires_in": 3600 });
        let creds = parse_token_response(&resp, now).unwrap();
        assert_eq!(creds.access_token, "tok");
        assert_eq!(creds.refresh_token.as_deref(), Some("ref"));
        assert_eq!(
            creds.expires_at.as_deref(),
            Some("2026-01-01T13:00:00.000Z")
        );
    }

    #[test]
    fn rejects_missing_access_token() {
        let now = Utc.with_ymd_and_hms(2026, 1, 1, 12, 0, 0).unwrap();
        assert!(parse_token_response(&json!({ "refresh_token": "x" }), now).is_err());
    }
}
