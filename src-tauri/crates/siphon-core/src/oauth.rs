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
/// The manual redirect: the page that displays the code for the user to copy.
/// Used when the loopback listener cannot be bound. `siphon-core` never chooses
/// between this and a loopback URI — the binary crate does.
pub const REDIRECT_URI: &str = "https://platform.claude.com/oauth/code/callback";
pub const AUTH_URL: &str = "https://claude.ai/oauth/authorize";
pub const TOKEN_URL: &str = "https://platform.claude.com/v1/oauth/token";
pub const SCOPES: &[&str] = &["user:profile", "user:inference"];

/// A prepared sign-in flow: the URL to open plus the PKCE verifier, the state
/// and the redirect the token exchange has to echo back.
#[derive(Debug, Clone)]
pub struct AuthFlow {
    pub url: String,
    pub verifier: String,
    pub state: String,
    pub redirect_uri: String,
}

/// Prepare a PKCE flow against a given redirect. `prepareFlow` in the original.
pub fn prepare_flow(redirect_uri: &str) -> AuthFlow {
    let verifier = random_url_string();
    let challenge = code_challenge(&verifier);
    let state = random_url_string();
    AuthFlow {
        url: authorize_url(&challenge, &state, redirect_uri),
        verifier,
        state,
        redirect_uri: redirect_uri.to_string(),
    }
}

/// Build the authorize URL with a given challenge, state and redirect.
pub fn authorize_url(challenge: &str, state: &str, redirect_uri: &str) -> String {
    let scope = SCOPES.join(" ");
    let params = [
        ("code", "true"),
        ("client_id", CLIENT_ID),
        ("response_type", "code"),
        ("redirect_uri", redirect_uri),
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

/// The redirect Siphon registers while its loopback listener is up. `localhost`
/// rather than `127.0.0.1` is deliberate: it is the exact string the
/// authorization server accepts for this client id, and what Claude Code sends.
pub fn loopback_redirect_uri(port: u16) -> String {
    format!("http://localhost:{port}/callback")
}

/// S256 challenge: base64url(sha256(verifier)). Matches `codeChallenge`.
pub fn code_challenge(verifier: &str) -> String {
    let digest = Sha256::digest(verifier.as_bytes());
    URL_SAFE_NO_PAD.encode(digest)
}

fn random_url_string() -> String {
    use rand::RngCore;
    let mut bytes = [0u8; 32];
    rand::rng().fill_bytes(&mut bytes);
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

/// Body for the authorization-code exchange. `redirect_uri` must be byte-for-byte
/// the one sent to the authorize endpoint or the grant is rejected.
pub fn exchange_body(code: &str, verifier: &str, state: &str, redirect_uri: &str) -> Value {
    json!({
        "grant_type": "authorization_code",
        "code": code,
        "state": state,
        "client_id": CLIENT_ID,
        "redirect_uri": redirect_uri,
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

pub(crate) fn url_decode(s: &str) -> String {
    let bytes = s.as_bytes();
    let mut out = Vec::with_capacity(bytes.len());
    let mut i = 0;
    while i < bytes.len() {
        if bytes[i] == b'%' && i + 2 < bytes.len() {
            // Check UTF-8 char boundaries before slicing. If the slice end falls
            // mid-character, treat `%` as literal to avoid panicking on hostile input.
            if s.is_char_boundary(i + 1) && s.is_char_boundary(i + 3) {
                if let Ok(v) = u8::from_str_radix(&s[i + 1..i + 3], 16) {
                    out.push(v);
                    i += 3;
                    continue;
                }
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
        let url = authorize_url("CHAL", "STATE", REDIRECT_URI);
        assert!(url.starts_with("https://claude.ai/oauth/authorize?"));
        assert!(url.contains("code_challenge=CHAL"));
        assert!(url.contains("code_challenge_method=S256"));
        assert!(url.contains("state=STATE"));
        assert!(url.contains(&format!("client_id={CLIENT_ID}")));
        assert!(url.contains("scope=user%3Aprofile%20user%3Ainference"));
        assert!(url.contains(&format!("redirect_uri={}", url_encode(REDIRECT_URI))));
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
    fn url_decode_percent_escapes() {
        // Standard percent-encoded characters.
        assert_eq!(url_decode("hello%20world"), "hello world");
        assert_eq!(url_decode("a%2Fb%2Bc"), "a/b+c");
        assert_eq!(url_decode("%2F%3F%40"), "/?@");
    }

    #[test]
    fn url_decode_non_hex_is_literal() {
        // Non-hex after `%` is treated as literal `%`.
        assert_eq!(url_decode("%ZZ"), "%ZZ");
        assert_eq!(url_decode("%1G"), "%1G");
        assert_eq!(url_decode("prefix%XYsuffix"), "prefix%XYsuffix");
    }

    #[test]
    fn url_decode_incomplete_percent_escapes() {
        // Bare `%` at end of input or followed by only one char.
        assert_eq!(url_decode("end%"), "end%");
        assert_eq!(url_decode("only%2"), "only%2");
        assert_eq!(url_decode("trailing%"), "trailing%");
    }

    #[test]
    fn url_decode_multibyte_chars_after_percent() {
        // Hostile input: `%` followed by multi-byte UTF-8 characters.
        // The Euro sign (€) is U+20AC, encoded as E2 82 AC in UTF-8.
        // "%€" has bytes [37, 226, 130, 172], where the slice end at
        // i+3 falls mid-character. Must not panic.
        assert_eq!(url_decode("%€"), "%€");
        assert_eq!(url_decode("code=%€value"), "code=%€value");

        // U+FFFD replacement character (EF BF BD, 3 bytes).
        // This can occur when from_utf8_lossy processes invalid bytes.
        assert_eq!(url_decode("%\u{FFFD}"), "%\u{FFFD}");
    }

    #[test]
    fn url_decode_mixed_valid_and_hostile() {
        // Ensure we don't panic even with mixed valid percent-escapes and hostile sequences.
        assert_eq!(url_decode("%20%€%2F"), " %€/");
        assert_eq!(url_decode("a%2Fb%€c%20d"), "a/b%€c d");
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

    #[test]
    fn authorize_url_carries_a_loopback_redirect() {
        let url = authorize_url("CHAL", "STATE", &loopback_redirect_uri(51234));
        assert!(url.contains("redirect_uri=http%3A%2F%2Flocalhost%3A51234%2Fcallback"));
    }

    #[test]
    fn loopback_redirect_uses_localhost_and_the_callback_path() {
        // `localhost`, not `127.0.0.1` — this is the exact string the
        // authorization server accepts for this client id.
        assert_eq!(loopback_redirect_uri(0), "http://localhost:0/callback");
        assert_eq!(loopback_redirect_uri(65535), "http://localhost:65535/callback");
    }

    #[test]
    fn exchange_body_echoes_the_flow_redirect() {
        let body = exchange_body("CODE", "VERIFIER", "STATE", "http://localhost:9/callback");
        assert_eq!(body["redirect_uri"], "http://localhost:9/callback");
        assert_eq!(body["grant_type"], "authorization_code");
        assert_eq!(body["code"], "CODE");
        assert_eq!(body["code_verifier"], "VERIFIER");
        assert_eq!(body["state"], "STATE");
        assert_eq!(body["client_id"], CLIENT_ID);
    }

    #[test]
    fn prepare_flow_generates_valid_entropy_and_url() {
        let flow1 = prepare_flow(REDIRECT_URI);
        let flow2 = prepare_flow(REDIRECT_URI);

        assert_eq!(flow1.verifier.len(), 43);
        assert_eq!(flow1.state.len(), 43);
        assert_eq!(flow2.verifier.len(), 43);
        assert_eq!(flow2.state.len(), 43);

        assert_ne!(flow1.verifier, flow2.verifier);
        assert_ne!(flow1.state, flow2.state);

        assert!(flow1.url.starts_with("https://claude.ai/oauth/authorize?"));
        assert!(flow1.url.contains(&format!("state={}", flow1.state)));
        assert!(flow1.url.contains("code_challenge="));
        assert_eq!(flow1.redirect_uri, REDIRECT_URI);
    }

    #[test]
    fn prepare_flow_keeps_the_redirect_it_was_given() {
        let flow = prepare_flow("http://localhost:4321/callback");
        assert_eq!(flow.redirect_uri, "http://localhost:4321/callback");
        assert!(flow
            .url
            .contains("redirect_uri=http%3A%2F%2Flocalhost%3A4321%2Fcallback"));
    }
}
