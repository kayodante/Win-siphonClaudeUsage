//! Port of `src/main/usageController.js` — the orchestrator. Owns the shared
//! `AppState`, drives local/quota/profile refreshes, runs the sign-in flow and
//! emits `state-changed` to the renderer (plus updates the tray + floating
//! widget). Pure decisions come from `siphon-core`; this adds the async I/O,
//! timers and Tauri event plumbing.

use std::path::PathBuf;
use std::sync::Mutex;
use std::time::{Duration, Instant};

use chrono::Utc;
use serde_json::Value;
use tauri::{AppHandle, Emitter, Manager};

use siphon_core::alerts::UsageAlertService;
use siphon_core::json_store::JsonStore;
use siphon_core::local_data::LocalDataService;
use siphon_core::oauth::{self, AuthFlow};
use siphon_core::oauth_callback::CallbackOutcome;
use siphon_core::quota::{QuotaError, QuotaErrorCode};
use siphon_core::reset_scheduler::{decide_update, ResetDecision};
use siphon_core::state::AppState;
use siphon_core::token::Credentials;

use crate::http::HttpClient;
use crate::prefs::PrefsStore;
use crate::token_store::{read_claude_credentials, TokenStore};

pub const MIN_QUOTA_INTERVAL_MS: u64 = 120_000;
pub const ALLOWED_REFRESH_INTERVALS: [u64; 4] = [30, 60, 300, 900];

#[derive(Default)]
struct ResetRuntime {
    current_key: Option<String>,
    last_fired_key: Option<String>,
    /// Bumped on every arm/clear; a spawned timer task only fires if its
    /// captured generation is still current. This is the Rust equivalent of
    /// the JS `clearTimeout`.
    generation: u64,
}

/// Result of attempting a refresh-token grant.
enum RefreshOutcome {
    /// New credentials saved to the token store.
    Refreshed(Credentials),
    /// The grant was rejected — stored credentials are dead.
    Rejected,
    /// Network/server trouble — keep stored credentials, retry later.
    Transient,
}

pub struct Controller {
    app: AppHandle,
    pub prefs: std::sync::Arc<PrefsStore>,
    pub tokens: std::sync::Arc<TokenStore>,
    http: HttpClient,
    state: Mutex<AppState>,
    auth_flow: Mutex<Option<AuthFlow>>,
    /// Aborts the running loopback listener on cancel / sign-out / restart.
    auth_listener: Mutex<Option<tokio::task::AbortHandle>>,
    /// Set once a loopback attempt failed in this run. A firewall that lets the
    /// bind succeed but blocks the browser's connection would otherwise loop
    /// forever, so the next sign-in goes straight to the manual flow.
    loopback_failed: Mutex<bool>,
    rate_limited_until: Mutex<Option<Instant>>,
    reset: Mutex<ResetRuntime>,
    alerts: Mutex<UsageAlertService>,
    cache_path: PathBuf,
    reset_store: JsonStore,
}

impl Controller {
    pub fn new(
        app: AppHandle,
        prefs: std::sync::Arc<PrefsStore>,
        tokens: std::sync::Arc<TokenStore>,
        cache_path: PathBuf,
        reset_store_path: PathBuf,
    ) -> Self {
        Controller {
            app,
            prefs,
            tokens,
            http: HttpClient::new(),
            state: Mutex::new(AppState::default()),
            auth_flow: Mutex::new(None),
            auth_listener: Mutex::new(None),
            loopback_failed: Mutex::new(false),
            rate_limited_until: Mutex::new(None),
            reset: Mutex::new(ResetRuntime::default()),
            alerts: Mutex::new(UsageAlertService::new()),
            cache_path,
            reset_store: JsonStore::new(reset_store_path),
        }
    }

    pub fn get_state(&self) -> AppState {
        self.state.lock().unwrap().clone()
    }

    fn emit(&self) {
        let state = self.state.lock().unwrap().clone();
        let _ = self.app.emit("state-changed", &state);
        crate::tray::update(&self.app, &state);
        crate::floating::sync(&self.app, &state);
        self.check_alerts(&state);
    }

    fn check_alerts(&self, state: &AppState) {
        let percent = state
            .quota
            .as_ref()
            .and_then(|q| q.session.as_ref())
            .map(|s| s.percent);
        let lang = state.preferences.language.clone();
        let expire = state.preferences.notifications.expire_alert;
        let limit = state.preferences.notifications.limit_alert;
        let alerts = self
            .alerts
            .lock()
            .unwrap()
            .check(percent, expire, limit, &lang);
        for alert in alerts {
            crate::notify::show(&self.app, &alert.title, &alert.body);
        }
    }

    /// Run `refresh_local` off the async runtime (file I/O + JSONL parse).
    pub async fn refresh_local_blocking(self: std::sync::Arc<Self>) {
        let _ = tauri::async_runtime::spawn_blocking(move || self.refresh_local()).await;
    }

    pub async fn start(self: std::sync::Arc<Self>) {
        {
            let mut state = self.state.lock().unwrap();
            state.is_signed_in = self.tokens.load().ok().flatten().is_some();
            state.preferences = self.prefs.load();
        }
        self.restore_reset().await;
        self.clone().refresh_local_blocking().await;
        if self.get_state().is_signed_in {
            self.refresh_profile().await;
            self.refresh_quota().await;
        }
        self.emit();
    }

    pub fn refresh_local(&self) {
        let claude_dir = self.prefs.claude_dir();
        let service = LocalDataService::new(Some(claude_dir), self.cache_path.clone());
        let result = service.load(Utc::now());
        {
            let mut state = self.state.lock().unwrap();
            match result {
                Ok(summary) => {
                    state.today_stats = summary.today_stats;
                    state.month_stats = summary.month_stats;
                    state.last_updated = Some(
                        summary
                            .last_updated
                            .format("%Y-%m-%dT%H:%M:%S%.3fZ")
                            .to_string(),
                    );
                    state.local_error = None;
                }
                Err(siphon_core::local_data::LocalError::NoData) => {
                    state.local_error = Some("error.local.missing".to_string());
                }
                Err(e) => {
                    log::error!("refreshLocal failed: {e}");
                    state.local_error = Some("Could not read ~/.claude usage files.".to_string());
                }
            }
        }
        self.emit();
    }

    pub async fn refresh_quota(&self) {
        if let Some(until) = *self.rate_limited_until.lock().unwrap() {
            if Instant::now() < until {
                return;
            }
        }
        let token = match self.valid_token().await {
            Ok(t) => t,
            Err(e) => {
                self.apply_quota_error(e);
                self.emit();
                return;
            }
        };

        let (mut status, mut retry_after, mut body) = match self.http.get_usage(&token).await {
            Ok(r) => r,
            Err(e) => {
                self.apply_quota_error(e);
                self.emit();
                return;
            }
        };

        // Single forced refresh + retry on a 401, matching fetchQuota — but a
        // transient refresh failure must not sign the user out.
        if status == 401 {
            match self.force_refresh().await {
                RefreshOutcome::Refreshed(creds) => {
                    match self.http.get_usage(&creds.access_token).await {
                        Ok(r) => {
                            status = r.0;
                            retry_after = r.1;
                            body = r.2;
                        }
                        Err(e) => {
                            self.apply_quota_error(e);
                            self.emit();
                            return;
                        }
                    }
                    if status == 401 {
                        let _ = self.tokens.clear();
                        self.apply_quota_error(QuotaError::new(
                            QuotaErrorCode::Unauthorized,
                            "Session expired. Please sign in again.",
                        ));
                        self.emit();
                        return;
                    }
                }
                RefreshOutcome::Transient => {
                    self.apply_quota_error(QuotaError::new(
                        QuotaErrorCode::Network,
                        "Could not refresh token (network).",
                    ));
                    self.emit();
                    return;
                }
                RefreshOutcome::Rejected => {
                    let _ = self.tokens.clear();
                    self.apply_quota_error(QuotaError::new(
                        QuotaErrorCode::Unauthorized,
                        "Session expired. Please sign in again.",
                    ));
                    self.emit();
                    return;
                }
            }
        }

        if status == 200 {
            let quota = HttpClient::parse_usage(&body);
            {
                let mut state = self.state.lock().unwrap();
                state.quota = Some(quota.clone());
                state.quota_error = None;
                state.needs_reauth = false;
                state.is_signed_in = true;
                state.is_offline = false;
            }
            if self.prefs.get("notifications.sessionReset") == Some(Value::Bool(true)) {
                self.update_reset_from_quota(&quota).await;
            } else {
                self.clear_reset().await;
            }
        } else {
            self.apply_quota_error(siphon_core::quota::error_for_status(
                status,
                retry_after.as_deref(),
            ));
        }
        self.emit();
    }

    fn apply_quota_error(&self, error: QuotaError) {
        let mut state = self.state.lock().unwrap();
        match error.code {
            QuotaErrorCode::RateLimited { retry_after } => {
                *self.rate_limited_until.lock().unwrap() =
                    Some(Instant::now() + Duration::from_secs(retry_after));
                state.quota_error = None;
            }
            QuotaErrorCode::NotSignedIn | QuotaErrorCode::Unauthorized => {
                state.is_signed_in = false;
                state.quota = None;
            }
            QuotaErrorCode::ScopeInsufficient => {
                state.quota_error = Some("error.scope_insufficient".to_string());
                state.needs_reauth = true;
                state.is_signed_in = true;
            }
            QuotaErrorCode::Network => {
                state.is_offline = true;
                state.quota_error = None;
            }
            QuotaErrorCode::Server => {
                state.quota_error = Some(siphon_core::diagnostics::safe_error_message(
                    &error.message,
                    "Could not load quota data.",
                ));
            }
        }
    }

    /// Load credentials, refreshing if expired. A transiently-failed refresh
    /// keeps the stored credentials and reports `Network` so the next tick
    /// retries; only a rejected grant (or no refresh token) clears them.
    async fn valid_token(&self) -> Result<String, QuotaError> {
        let creds = self
            .tokens
            .load()
            .ok()
            .flatten()
            .ok_or_else(|| QuotaError::new(QuotaErrorCode::NotSignedIn, "Not signed in"))?;
        if !creds.is_expired(Utc::now()) {
            return Ok(creds.access_token);
        }
        if creds.has_refresh_token() {
            match self.refresh_credentials(&creds).await {
                RefreshOutcome::Refreshed(c) => return Ok(c.access_token),
                RefreshOutcome::Transient => {
                    return Err(QuotaError::new(
                        QuotaErrorCode::Network,
                        "Could not refresh token (network).",
                    ));
                }
                RefreshOutcome::Rejected => {}
            }
        }
        let _ = self.tokens.clear();
        Err(QuotaError::new(
            QuotaErrorCode::NotSignedIn,
            "Not signed in",
        ))
    }

    async fn force_refresh(&self) -> RefreshOutcome {
        let Some(creds) = self.tokens.load().ok().flatten() else {
            return RefreshOutcome::Rejected;
        };
        if !creds.has_refresh_token() {
            return RefreshOutcome::Rejected;
        }
        self.refresh_credentials(&creds).await
    }

    async fn refresh_credentials(&self, creds: &Credentials) -> RefreshOutcome {
        let Some(refresh_token) = creds.refresh_token.as_deref() else {
            return RefreshOutcome::Rejected;
        };
        match self
            .http
            .post_token(oauth::refresh_body(refresh_token))
            .await
        {
            Ok(new_creds) => {
                let refreshed = new_creds.preserving_refresh_from(creds);
                let _ = self.tokens.save(&refreshed);
                RefreshOutcome::Refreshed(refreshed)
            }
            Err(crate::http::TokenError::Rejected(_)) => RefreshOutcome::Rejected,
            Err(crate::http::TokenError::Transient(_)) => RefreshOutcome::Transient,
        }
    }

    pub async fn refresh_profile(&self) {
        let token = match self.valid_token().await {
            Ok(t) => t,
            Err(_) => {
                self.state.lock().unwrap().profile = None;
                self.emit();
                return;
            }
        };
        let mut profile = self.http.get_profile(&token).await;
        if let Some(p) = profile.take() {
            let local = read_claude_credentials()
                .map(|v| siphon_core::profile::read_local_profile(&v))
                .unwrap_or_default();
            self.state.lock().unwrap().profile = Some(siphon_core::profile::merge_local(p, &local));
        } else {
            self.state.lock().unwrap().profile = None;
        }
        self.emit();
    }

    pub async fn refresh_all(self: std::sync::Arc<Self>) {
        self.clone().refresh_local_blocking().await;
        if self.get_state().is_signed_in {
            self.refresh_quota().await;
        }
    }

    // ----- auth ------------------------------------------------------------

    pub async fn start_sign_in(self: std::sync::Arc<Self>) -> String {
        // A second click, or the re-auth button, must not leave a listener behind.
        self.abort_listener();

        let force_manual = *self.loopback_failed.lock().unwrap();
        let pending = if force_manual {
            None
        } else {
            crate::oauth_server::bind().await.ok()
        };
        let redirect_uri = match &pending {
            Some(p) => oauth::loopback_redirect_uri(p.port),
            None => oauth::REDIRECT_URI.to_string(),
        };

        let flow = oauth::prepare_flow(&redirect_uri);
        let url = flow.url.clone();
        let expected_state = flow.state.clone();
        {
            let mut state = self.state.lock().unwrap();
            state.auth_error = None;
            state.awaiting_browser = pending.is_some();
            // The paste form is only reachable when there is no listener — a code
            // issued against a loopback redirect cannot be exchanged any other way.
            state.awaiting_code = pending.is_none();
        }
        *self.auth_flow.lock().unwrap() = Some(flow);

        if let Some(pending) = pending {
            let loopback = pending.serve(expected_state);
            *self.auth_listener.lock().unwrap() = Some(loopback.task.abort_handle());
            let controller = self.clone();
            tokio::spawn(async move {
                match loopback.task.await {
                    Ok(Some(outcome)) => controller.complete_from_callback(outcome).await,
                    // Timed out: the browser never came back.
                    Ok(None) => controller.fail_loopback(None),
                    // Aborted by cancel_auth / sign_out / a restarted flow — that
                    // path already reset the state, so there is nothing to do.
                    Err(_) => {}
                }
            });
        }

        self.emit();
        url
    }

    async fn complete_from_callback(self: std::sync::Arc<Self>, outcome: CallbackOutcome) {
        *self.auth_listener.lock().unwrap() = None;
        match outcome {
            CallbackOutcome::Code(code) => {
                self.submit_code(code).await;
                {
                    let mut state = self.state.lock().unwrap();
                    // Whatever happened, the browser leg is over. A code issued
                    // against the loopback redirect cannot be re-submitted by
                    // hand, so a failed exchange returns to the call-to-action
                    // rather than the paste form; submit_code already set
                    // auth_error with the reason.
                    state.awaiting_browser = false;
                    state.awaiting_code = false;
                }
                if self.get_state().is_signed_in {
                    *self.loopback_failed.lock().unwrap() = false;
                    crate::windows_ctl::show_main(&self.app);
                }
                self.emit();
            }
            CallbackOutcome::Provider { error, description } => {
                self.fail_loopback(Some(description.unwrap_or(error)));
            }
            CallbackOutcome::StateMismatch => {
                self.fail_loopback(Some("Authentication failed: state mismatch".to_string()));
            }
            CallbackOutcome::NoCode | CallbackOutcome::Malformed | CallbackOutcome::NotFound => {
                self.fail_loopback(None);
            }
        }
    }

    /// The loopback attempt did not produce a usable code. Return to the initial
    /// call-to-action with an error; the next sign-in skips the listener.
    fn fail_loopback(&self, reason: Option<String>) {
        *self.loopback_failed.lock().unwrap() = true;
        {
            let mut state = self.state.lock().unwrap();
            // Cancelled or already signed in — leave that state alone.
            if !state.awaiting_browser {
                return;
            }
            state.awaiting_browser = false;
            state.awaiting_code = false;
            state.auth_error = Some(siphon_core::diagnostics::safe_error_message(
                reason
                    .as_deref()
                    .unwrap_or("Sign-in was not completed in the browser. Please try again."),
                "Authentication failed. Please try again.",
            ));
        }
        self.emit();
    }

    fn abort_listener(&self) {
        if let Some(handle) = self.auth_listener.lock().unwrap().take() {
            handle.abort();
        }
    }

    pub async fn submit_code(&self, raw_code: String) {
        let flow = match self.auth_flow.lock().unwrap().clone() {
            Some(f) => f,
            None => return,
        };
        let code = oauth::extract_code(&raw_code);
        match self
            .http
            .post_token(oauth::exchange_body(
                &code,
                &flow.verifier,
                &flow.state,
                &flow.redirect_uri,
            ))
            .await
        {
            Ok(creds) => {
                let _ = self.tokens.save(&creds);
                *self.auth_flow.lock().unwrap() = None;
                {
                    let mut state = self.state.lock().unwrap();
                    state.awaiting_code = false;
                    state.awaiting_browser = false;
                    state.is_signed_in = true;
                    state.auth_error = None;
                    state.needs_reauth = false;
                }
                self.refresh_profile().await;
                self.refresh_quota().await;
            }
            Err(err) => {
                self.state.lock().unwrap().auth_error =
                    Some(siphon_core::diagnostics::safe_error_message(
                        err.message(),
                        "Authentication failed. Please try again.",
                    ));
                self.emit();
            }
        }
    }

    pub async fn sign_out(&self) {
        self.abort_listener();
        *self.loopback_failed.lock().unwrap() = false;
        let _ = self.tokens.clear();
        self.clear_reset().await;
        *self.auth_flow.lock().unwrap() = None;
        {
            let mut state = self.state.lock().unwrap();
            state.awaiting_code = false;
            state.awaiting_browser = false;
            state.is_signed_in = false;
            state.quota = None;
            state.profile = None;
            state.auth_error = None;
            state.quota_error = None;
            state.needs_reauth = false;
        }
        self.emit();
    }

    pub fn cancel_auth(&self) {
        self.abort_listener();
        *self.auth_flow.lock().unwrap() = None;
        let mut state = self.state.lock().unwrap();
        state.awaiting_code = false;
        state.awaiting_browser = false;
        state.auth_error = None;
        drop(state);
        self.emit();
    }

    pub fn sync_preferences(&self) {
        self.state.lock().unwrap().preferences = self.prefs.load();
        self.emit();
    }

    // ----- reset scheduler -------------------------------------------------

    async fn restore_reset(&self) {
        let Some(state) = self.reset_store.load().ok().flatten() else {
            return;
        };
        let Some(resets_at) = state.get("resetsAt").and_then(|v| v.as_str()) else {
            return;
        };
        let Ok(when) = chrono::DateTime::parse_from_rfc3339(resets_at) else {
            let _ = self.reset_store.save(None);
            return;
        };
        let key = state
            .get("resetKey")
            .and_then(|v| v.as_str())
            .unwrap_or(resets_at)
            .to_string();
        self.reset.lock().unwrap().current_key = Some(key.clone());
        self.arm_reset(key, when.with_timezone(&Utc));
    }

    async fn update_reset_from_quota(&self, quota: &siphon_core::quota::Quota) {
        let (current, last) = {
            let r = self.reset.lock().unwrap();
            (r.current_key.clone(), r.last_fired_key.clone())
        };
        match decide_update(quota, current.as_deref(), last.as_deref()) {
            ResetDecision::Clear => self.clear_reset().await,
            ResetDecision::NoChange => {}
            ResetDecision::Schedule {
                reset_key,
                resets_at,
            } => {
                self.reset.lock().unwrap().current_key = Some(reset_key.clone());
                let _ = self.reset_store.save(Some(&serde_json::json!({
                    "resetKey": reset_key,
                    "resetsAt": resets_at
                        .format("%Y-%m-%dT%H:%M:%S%.3fZ")
                        .to_string(),
                })));
                self.arm_reset(reset_key, resets_at);
            }
        }
    }

    async fn clear_reset(&self) {
        {
            let mut r = self.reset.lock().unwrap();
            r.current_key = None;
            r.generation += 1;
        }
        let _ = self.reset_store.save(None);
    }

    /// Spawn a task that fires the reset toast at `resets_at`. Sleeps in
    /// chunks (`next_sleep_ms`) so system suspend cannot delay the toast
    /// indefinitely, and re-checks the generation on every wake so a newer
    /// schedule / clear / sign-out cancels this task instead of producing a
    /// stale toast.
    fn arm_reset(&self, reset_key: String, resets_at: chrono::DateTime<Utc>) {
        let app = self.app.clone();
        let generation = {
            let mut r = self.reset.lock().unwrap();
            r.generation += 1;
            r.generation
        };
        tauri::async_runtime::spawn(async move {
            while let Some(ms) = siphon_core::reset_scheduler::next_sleep_ms(Utc::now(), resets_at)
            {
                tokio::time::sleep(Duration::from_millis(ms)).await;
                let Some(state) = app.try_state::<crate::AppContext>() else {
                    return;
                };
                if state.controller.reset.lock().unwrap().generation != generation {
                    return; // superseded — abandon silently
                }
            }
            let Some(state) = app.try_state::<crate::AppContext>() else {
                return;
            };
            let controller = &state.controller;
            {
                let mut r = controller.reset.lock().unwrap();
                if r.generation != generation
                    || r.current_key.as_deref() != Some(reset_key.as_str())
                {
                    return; // superseded or cleared — the stale toast must not fire
                }
                r.last_fired_key = Some(reset_key.clone());
                r.current_key = None;
            }
            // Read prefs at fire time so a toggle flipped during the wait is honored.
            let prefs = &controller.prefs;
            if prefs.get("notifications.sessionReset") == Some(Value::Bool(true)) {
                let lang = prefs.load().language;
                let title = siphon_core::i18n::t("notification.resetTitle", &lang);
                let body = siphon_core::i18n::t("notification.resetBody", &lang);
                crate::notify::show(&app, &title, &body);
                if prefs.get("notifications.sound") == Some(Value::Bool(true)) {
                    let _ = app.emit("play-reset-sound", ());
                }
            }
            let _ = controller.reset_store.save(None);
            // Refresh so the session card reflects 0% without a manual click,
            // regardless of whether the toast itself was shown.
            controller.refresh_quota().await;
        });
    }
}
