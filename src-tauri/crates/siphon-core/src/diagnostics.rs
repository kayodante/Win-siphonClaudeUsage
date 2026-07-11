//! Port of `src/shared/diagnostics.js`. Redacts secrets from strings before they
//! ever reach a log line. Mirrors the JS regex set exactly.

use std::sync::OnceLock;

use regex_lite::Regex;

const REDACTED: &str = "[REDACTED]";

// `regex_lite` keeps the dependency surface tiny; the patterns below match
// `redactString()` in the JS original.
fn patterns() -> &'static [(Regex, &'static str)] {
    static P: OnceLock<Vec<(Regex, &'static str)>> = OnceLock::new();
    P.get_or_init(|| {
        vec![
            (
                Regex::new(r"(?i)\bBearer\s+[A-Za-z0-9._~+/=-]+").unwrap(),
                "bearer",
            ),
            (
                Regex::new(
                    r"(?i)([?&](?:access_token|refresh_token|code|code_verifier|state)=)[^&#\s]+",
                )
                .unwrap(),
                "query",
            ),
            (
                Regex::new(r"(?i)\b(access_token|refresh_token|code|code_verifier|state)=([^&\s]+)")
                    .unwrap(),
                "pair",
            ),
            (
                Regex::new(
                    r#"("(?:access_token|refresh_token|accessToken|refreshToken|code_verifier|code|state)"\s*:\s*)"[^"]*""#,
                )
                .unwrap(),
                "json",
            ),
        ]
    })
}

/// Redact any secret-looking substring from `value`.
pub fn redact_string(value: &str) -> String {
    let mut out = value.to_string();
    for (re, kind) in patterns() {
        out = match *kind {
            "bearer" => re
                .replace_all(&out, format!("Bearer {REDACTED}"))
                .into_owned(),
            "query" => re
                .replace_all(&out, format!("${{1}}{REDACTED}"))
                .into_owned(),
            "pair" => re
                .replace_all(&out, format!("${{1}}={REDACTED}"))
                .into_owned(),
            "json" => re
                .replace_all(&out, format!("${{1}}\"{REDACTED}\""))
                .into_owned(),
            _ => out,
        };
    }
    out
}

/// Return a user-safe error message, falling back to `fallback` when empty.
pub fn safe_error_message(message: &str, fallback: &str) -> String {
    let redacted = redact_string(message);
    let trimmed = redacted.trim();
    if trimmed.is_empty() {
        fallback.to_string()
    } else {
        trimmed.to_string()
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn redacts_bearer_tokens() {
        let got = redact_string("Authorization: Bearer abc.def-123");
        assert_eq!(got, "Authorization: Bearer [REDACTED]");
    }

    #[test]
    fn redacts_query_params() {
        let got = redact_string("https://x/y?code=SECRET&other=ok");
        assert_eq!(got, "https://x/y?code=[REDACTED]&other=ok");
    }

    #[test]
    fn redacts_json_tokens() {
        let got = redact_string(r#"{"access_token":"zzz","plan":"pro"}"#);
        assert_eq!(got, r#"{"access_token":"[REDACTED]","plan":"pro"}"#);
    }

    #[test]
    fn falls_back_when_empty() {
        assert_eq!(safe_error_message("", "fallback"), "fallback");
    }
}
