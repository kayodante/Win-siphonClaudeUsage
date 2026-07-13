//! Async HTTP calls (the side-effecting half of quota/profile/oauth). All
//! request construction, response parsing and error mapping come from
//! `siphon-core`; this module only performs the transfer with `reqwest`.

use std::time::Duration;

use serde_json::Value;
use siphon_core::oauth::{self, TOKEN_URL};
use siphon_core::profile::extract_profile;
use siphon_core::quota::{self, Quota, QuotaError, QuotaErrorCode};
use siphon_core::state::Profile;
use siphon_core::token::Credentials;

const FETCH_TIMEOUT: Duration = Duration::from_secs(15);
const USAGE_URL: &str = "https://api.anthropic.com/api/oauth/usage";
const PROFILE_URL: &str = "https://api.anthropic.com/api/oauth/profile";

/// Outcome classification for token-endpoint POSTs (exchange and refresh).
#[derive(Debug)]
pub enum TokenError {
    /// Network trouble, 429/5xx, or a malformed body — retry later, do NOT
    /// discard stored credentials.
    Transient(String),
    /// The endpoint rejected the request (400/401/403) — the grant is bad.
    Rejected(String),
}

impl TokenError {
    pub fn message(&self) -> &str {
        match self {
            TokenError::Transient(m) | TokenError::Rejected(m) => m,
        }
    }
}

#[derive(Clone)]
pub struct HttpClient {
    client: reqwest::Client,
}

impl HttpClient {
    pub fn new() -> Self {
        HttpClient {
            client: reqwest::Client::builder()
                .timeout(FETCH_TIMEOUT)
                .build()
                .expect("reqwest client"),
        }
    }

    fn oauth_headers(token: &str) -> Result<reqwest::header::HeaderMap, QuotaError> {
        use reqwest::header::{HeaderMap, HeaderValue, ACCEPT, AUTHORIZATION, CONTENT_TYPE};
        let auth = HeaderValue::from_str(&format!("Bearer {token}")).map_err(|_| {
            QuotaError::new(
                QuotaErrorCode::NotSignedIn,
                "Stored token is invalid. Please sign in again.",
            )
        })?;
        let mut h = HeaderMap::new();
        h.insert(AUTHORIZATION, auth);
        h.insert(ACCEPT, HeaderValue::from_static("application/json"));
        h.insert(CONTENT_TYPE, HeaderValue::from_static("application/json"));
        h.insert("anthropic-beta", HeaderValue::from_static("oauth-2025-04-20"));
        h.insert(
            reqwest::header::USER_AGENT,
            HeaderValue::from_static("claude-code/2.1.121"),
        );
        Ok(h)
    }

    /// GET the usage endpoint with an already-valid token. Returns the raw
    /// `reqwest::Response` status + body so the caller can apply the 401-refresh
    /// dance from `QuotaService.fetchQuota`.
    pub async fn get_usage(&self, token: &str) -> Result<(u16, Option<String>, Value), QuotaError> {
        let resp = self
            .client
            .get(USAGE_URL)
            .headers(Self::oauth_headers(token)?)
            .send()
            .await
            .map_err(map_reqwest_err)?;
        let status = resp.status().as_u16();
        let retry_after = resp
            .headers()
            .get("retry-after")
            .and_then(|v| v.to_str().ok())
            .map(|s| s.to_string());
        let body = resp.json::<Value>().await.unwrap_or(Value::Null);
        Ok((status, retry_after, body))
    }

    /// Parse a 200 usage body into a `Quota`.
    pub fn parse_usage(body: &Value) -> Quota {
        quota::parse_usage_response(body)
    }

    /// GET the profile endpoint. Returns `None` on any non-200 or error, matching
    /// `ProfileService.fetchProfile`.
    pub async fn get_profile(&self, token: &str) -> Option<Profile> {
        let headers = Self::oauth_headers(token).ok()?;
        let resp = self
            .client
            .get(PROFILE_URL)
            .headers(headers)
            .send()
            .await
            .ok()?;
        if resp.status().as_u16() != 200 {
            return None;
        }
        let body = resp.json::<Value>().await.ok()?;
        Some(extract_profile(&body))
    }

    /// POST the token endpoint (exchange or refresh). Parses into `Credentials`.
    pub async fn post_token(&self, body: Value) -> Result<Credentials, TokenError> {
        let resp = self
            .client
            .post(TOKEN_URL)
            .header(reqwest::header::CONTENT_TYPE, "application/json")
            .json(&body)
            .send()
            .await
            .map_err(|e| TokenError::Transient(format!("Auth failed: {e}")))?;
        let status = resp.status().as_u16();
        if status != 200 {
            let text = resp.text().await.unwrap_or_default();
            let snippet: String = text.chars().take(1024).collect();
            let message = siphon_core::diagnostics::safe_error_message(
                &format!("Auth failed: {snippet}"),
                "Auth failed.",
            );
            return Err(if oauth::refresh_failure_is_fatal(status) {
                TokenError::Rejected(message)
            } else {
                TokenError::Transient(message)
            });
        }
        let json = resp
            .json::<Value>()
            .await
            .map_err(|_| TokenError::Transient("Auth failed: malformed response".to_string()))?;
        // A 200 with no access token is a server quirk, not a dead grant —
        // classify transient so a refresh never destroys credentials over it.
        oauth::parse_token_response(&json, chrono::Utc::now()).map_err(TokenError::Transient)
    }
}

fn map_reqwest_err(e: reqwest::Error) -> QuotaError {
    if e.is_timeout() {
        QuotaError::new(QuotaErrorCode::Server, "Quota request timed out.")
    } else if e.is_connect() || e.is_request() {
        QuotaError::new(QuotaErrorCode::Network, "Network unavailable.")
    } else {
        QuotaError::new(QuotaErrorCode::Server, "Quota request failed.")
    }
}

impl Default for HttpClient {
    fn default() -> Self {
        Self::new()
    }
}
