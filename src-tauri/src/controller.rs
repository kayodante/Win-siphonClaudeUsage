//! Port of `src/main/usageController.js` — the orchestrator. Owns the shared
//! `AppState`, drives local/quota/profile refreshes, runs the sign-in flow and
//! emits `state-changed` to the renderer (plus updates the tray + floating
//! widget). Pure decisions come from `siphon-core`; this adds the async I/O,
//! timers and Tauri event plumbing.

use std::path::PathBuf;
use std::sync::atomic::{AtomicBool, Ordering};
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
use siphon_core::providers::{
    normalize_sections, Channel, ProviderQuota, ProviderStatus, QuotaSection,
};
use siphon_core::quota::{QuotaError, QuotaErrorCode, Slot};
use siphon_core::reset_scheduler::{decide_update, ResetDecision};
use siphon_core::state::AppState;
use siphon_core::token::Credentials;

use crate::http::{HttpClient, LoopbackError};
use crate::prefs::PrefsStore;
use crate::token_store::{read_claude_credentials, TokenStore};

pub const MIN_QUOTA_INTERVAL_SECS: i64 = 120;
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

/// Threshold alerts and the reset toast for one provider's session window.
/// Each channel keeps its own generation, so one provider's schedule or clear
/// never cancels another's timer.
struct ChannelRuntime {
    reset: Mutex<ResetRuntime>,
    alerts: Mutex<UsageAlertService>,
    reset_store: JsonStore,
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

/// Consecutive loopback timeouts that force the manual paste flow for the rest
/// of the run. See `Controller::loopback_timeouts`.
const LOOPBACK_TIMEOUT_LIMIT: u32 = 2;

pub struct Controller {
    app: AppHandle,
    pub prefs: std::sync::Arc<PrefsStore>,
    pub tokens: std::sync::Arc<TokenStore>,
    http: HttpClient,
    state: Mutex<AppState>,
    auth_flow: Mutex<Option<AuthFlow>>,
    /// Aborts the running loopback listener on cancel / sign-out / restart.
    auth_listener: Mutex<Option<tokio::task::AbortHandle>>,
    /// How many times *in a row* the loopback listener has timed out with the
    /// browser's connection never reaching it. At `LOOPBACK_TIMEOUT_LIMIT` the
    /// rest of the run goes straight to the manual paste flow.
    ///
    /// Counted rather than latched because one timeout is far more likely to be
    /// a user who walked away mid-authorization than a broken network, and
    /// latching on that would hand them the paste flow for every sign-in for
    /// the rest of the run with no explanation. A firewall that lets the bind
    /// succeed but blocks the browser's connection times out every single time,
    /// so it still reaches the limit and falls back for good.
    ///
    /// Reset to zero by any successful token exchange (`submit_code`) and by
    /// `sign_out`. A denied, malformed, or state-mismatched callback never
    /// increments it — the browser reached the listener fine in those cases.
    loopback_timeouts: Mutex<u32>,
    rate_limited_until: Mutex<Option<Instant>>,
    /// Indexed by `channel as usize`, built in `Channel::ALL` order.
    channels: [ChannelRuntime; 4],
    /// Set while an Antigravity read is in flight. The loop and the refresh
    /// button can ask at once; the second ask is dropped, not queued.
    antigravity_busy: AtomicBool,
    cache_path: PathBuf,
}

impl Controller {
    pub fn new(
        app: AppHandle,
        prefs: std::sync::Arc<PrefsStore>,
        tokens: std::sync::Arc<TokenStore>,
        cache_path: PathBuf,
        config_dir: PathBuf,
    ) -> Self {
        Controller {
            app,
            prefs,
            tokens,
            http: HttpClient::new(),
            state: Mutex::new(AppState::default()),
            auth_flow: Mutex::new(None),
            auth_listener: Mutex::new(None),
            loopback_timeouts: Mutex::new(0),
            rate_limited_until: Mutex::new(None),
            channels: Channel::ALL.map(|channel| ChannelRuntime {
                reset: Mutex::new(ResetRuntime::default()),
                alerts: Mutex::new(UsageAlertService::new()),
                reset_store: JsonStore::new(config_dir.join(channel.reset_file())),
            }),
            antigravity_busy: AtomicBool::new(false),
            cache_path,
        }
    }

    fn channel(&self, channel: Channel) -> &ChannelRuntime {
        &self.channels[channel as usize]
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
        let lang = state.preferences.language.clone();
        let expire = state.preferences.notifications.expire_alert;
        let limit = state.preferences.notifications.limit_alert;
        for channel in Channel::ALL {
            let percent = channel.session(state).map(|s| s.percent);
            let label = channel.label(&lang);
            let alerts = self.channel(channel).alerts.lock().unwrap().check(
                percent,
                expire,
                limit,
                &lang,
                label.as_deref(),
            );
            for alert in alerts {
                crate::notify::show(&self.app, &alert.title, &alert.body);
            }
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
        for channel in Channel::ALL {
            self.restore_reset(channel);
        }
        self.clone().refresh_local_blocking().await;
        self.refresh_antigravity().await;
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
        self.refresh_codex();
        self.emit();
    }

    /// Codex rides the local cadence: its quota is a file read too, and
    /// `refresh_local` already runs off the async runtime.
    fn refresh_codex(&self) {
        let home = siphon_core::codex::default_codex_home();
        let codex = siphon_core::codex::read_quota(&home, Utc::now());
        self.state.lock().unwrap().codex = codex;
        self.sync_reset(Channel::Codex);
    }

    /// Ask the running Antigravity app for its quota. Independent of the
    /// Claude sign-in. A closed app keeps the last reading (normalized, so a
    /// window that reset meanwhile reads 0%) under `status: closed`.
    pub async fn refresh_antigravity(&self) {
        if self.antigravity_busy.swap(true, Ordering::AcqRel) {
            return;
        }
        let read = self.read_antigravity().await;
        self.antigravity_busy.store(false, Ordering::Release);

        let now = Utc::now();
        {
            let mut state = self.state.lock().unwrap();
            state.antigravity = read.map(|(status, fresh)| {
                let previous = state.antigravity.take();
                let mut next = match fresh {
                    Some(sections) => ProviderQuota {
                        status,
                        updated_at: Some(siphon_core::providers::iso(now)),
                        sections,
                    },
                    None => ProviderQuota {
                        status,
                        updated_at: previous.as_ref().and_then(|p| p.updated_at.clone()),
                        sections: previous.map(|p| p.sections).unwrap_or_default(),
                    },
                };
                normalize_sections(&mut next.sections, now);
                next
            });
        }
        self.sync_reset(Channel::AntigravityGemini);
        self.sync_reset(Channel::AntigravityThirdParty);
        self.emit();
    }

    /// `None`: not installed. Otherwise the status, plus fresh sections when
    /// the read succeeded. The CSRF token lives only in this function.
    async fn read_antigravity(&self) -> Option<(ProviderStatus, Option<Vec<QuotaSection>>)> {
        use siphon_core::antigravity::{csrf_token, find_port, main_log_path, parse_quota_summary};
        let log = tokio::fs::read(main_log_path()?).await.ok()?;
        let port = find_port(&String::from_utf8_lossy(&log));
        let token = tauri::async_runtime::spawn_blocking(|| {
            crate::process::command_lines("language_server")
                .iter()
                .find_map(|line| csrf_token(line))
        })
        .await
        .ok()
        .flatten();
        let (Some(port), Some(token)) = (port, token) else {
            return Some((ProviderStatus::Closed, None));
        };
        Some(match self.http.antigravity_quota(port, &token).await {
            Ok(raw) => match parse_quota_summary(&raw) {
                Some(sections) => (ProviderStatus::Live, Some(sections)),
                None => (ProviderStatus::Error, None),
            },
            Err(LoopbackError::Unreachable) => (ProviderStatus::Closed, None),
            Err(LoopbackError::Unreadable) => (ProviderStatus::Error, None),
        })
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
            self.sync_reset(Channel::Claude);
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
        self.refresh_antigravity().await;
        if self.get_state().is_signed_in {
            self.refresh_quota().await;
        }
    }

    // ----- auth ------------------------------------------------------------

    pub async fn start_sign_in(self: std::sync::Arc<Self>) -> String {
        // A second click, or the re-auth button, must not leave a listener behind.
        self.abort_listener();

        let force_manual = *self.loopback_timeouts.lock().unwrap() >= LOOPBACK_TIMEOUT_LIMIT;
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
            // The paste form starts hidden while a listener is running — it
            // is `downgrade_to_paste` (fired when the listener times out)
            // that reveals it, letting a loopback-issued code be pasted by
            // hand once the socket has closed.
            state.awaiting_code = pending.is_none();
        }
        *self.auth_flow.lock().unwrap() = Some(flow);

        if let Some(pending) = pending {
            let loopback = pending.serve(expected_state.clone());
            *self.auth_listener.lock().unwrap() = Some(loopback.task.abort_handle());
            let controller = self.clone();
            tokio::spawn(async move {
                let outcome = loopback.task.await;
                // This waiter belongs to one specific flow. By the time it
                // wakes, that flow may have been cancelled (auth_flow ==
                // None) or superseded by a newer start_sign_in call (a
                // different flow's state) — cancel_auth / sign_out / the
                // newer start_sign_in already reset whatever state matters,
                // and a newer listener's AbortHandle in auth_listener must
                // not be clobbered by this stale waiter's cleanup. If the
                // current flow's state no longer matches the one this
                // waiter was serving, there is nothing left to do.
                let is_current = controller
                    .auth_flow
                    .lock()
                    .unwrap()
                    .as_ref()
                    .map(|f| f.state.as_str())
                    == Some(expected_state.as_str());
                if !is_current {
                    return;
                }
                match outcome {
                    Ok(Some(outcome)) => controller.complete_from_callback(outcome).await,
                    // Timed out: the browser's connection never reached the
                    // listener. This is the one case `loopback_timeouts`
                    // counts — see its doc comment.
                    Ok(None) => {
                        *controller.loopback_timeouts.lock().unwrap() += 1;
                        controller.downgrade_to_paste();
                    }
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
                // Cleared BEFORE the exchange: `submit_code`'s failure arm
                // restores the flow while either awaiting flag is set, and the
                // browser leg must decline that restore — this flow is
                // finished whatever the exchange returns.
                self.state.lock().unwrap().awaiting_browser = false;
                self.submit_code(code).await;
                {
                    let mut state = self.state.lock().unwrap();
                    // Whatever happened, the browser leg produced a terminal
                    // outcome — this flow is finished either way, so it
                    // returns to the call-to-action rather than the paste
                    // form; submit_code already set auth_error with the
                    // reason on failure.
                    state.awaiting_code = false;
                }
                if self.get_state().is_signed_in {
                    crate::windows_ctl::show_main(&self.app);
                }
                self.emit();
            }
            // The provider's `error` and `error_description` are both
            // attacker-influenced free text: anything on this machine can hit
            // the loopback port and name its own error. `http_response`
            // already refuses to echo them back into the browser; the same
            // rule applies toward the UI, or the app's own trusted error line
            // becomes a phishing surface ("Your session expired — re-authorize
            // at ..." in Siphon's voice). Logged for diagnosis, never shown.
            CallbackOutcome::Provider { error, description } => {
                log::warn!(
                    "oauth callback reported an error: {}",
                    siphon_core::diagnostics::redact_string(&match &description {
                        Some(d) => format!("{error}: {d}"),
                        None => error.clone(),
                    })
                );
                self.fail_loopback();
            }
            // Unreachable in practice — these are non-terminal, so the accept
            // loop answers them and keeps waiting rather than returning them
            // (see `CallbackOutcome::is_terminal`). Handled anyway: the enum is
            // public, and failing closed costs one line.
            CallbackOutcome::StateMismatch
            | CallbackOutcome::NoCode
            | CallbackOutcome::Malformed
            | CallbackOutcome::NotFound => {
                self.fail_loopback();
            }
        }
    }

    /// The loopback attempt did not produce a usable code. Return to the
    /// initial call-to-action with a fixed error. Does not touch
    /// `loopback_timeouts` — the browser reached the listener fine in every
    /// case that lands here, so the loopback flow is still worth trying on the
    /// next sign-in. Only the `Ok(None)` timeout arm in `start_sign_in`'s
    /// waiter increments it.
    fn fail_loopback(&self) {
        {
            let mut state = self.state.lock().unwrap();
            // Cancelled or already signed in — leave that state alone.
            if !state.awaiting_browser {
                return;
            }
            state.awaiting_browser = false;
            state.awaiting_code = false;
            // The flow is over; leave nothing for a later submit_code to spend.
            // cancel_auth and sign_out already do this — the invariant should
            // not depend on the renderer keeping the paste form hidden.
            *self.auth_flow.lock().unwrap() = None;
            // One fixed sentence, whatever the reason. The only reasons that
            // reach here carry provider- or stranger-supplied text, and that
            // text must never appear in Siphon's own error line.
            state.auth_error =
                Some("Sign-in was not completed in the browser. Please try again.".to_string());
        }
        self.emit();
    }

    /// The listener gave up, but the authorization may still be in flight — a
    /// user finishing 2FA at 2:40 gets their `?code=` in the address bar with
    /// nowhere to put it if we destroy the flow here. So the timeout is a
    /// downgrade, not a failure: the socket closes, the flow survives, and the
    /// paste form becomes the way home. `fail_loopback` still handles the cases
    /// where there is genuinely nothing to paste (denied, malformed, wrong
    /// state).
    fn downgrade_to_paste(&self) {
        {
            let mut state = self.state.lock().unwrap();
            // Cancelled or already signed in — leave that state alone.
            if !state.awaiting_browser {
                return;
            }
            state.awaiting_browser = false;
            state.awaiting_code = true;
            state.auth_error = None;
        }
        self.emit();
    }

    fn abort_listener(&self) {
        if let Some(handle) = self.auth_listener.lock().unwrap().take() {
            handle.abort();
        }
    }

    pub async fn submit_code(&self, raw_code: String) {
        let flow = match self.auth_flow.lock().unwrap().take() {
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
                // A sign-in got through, so whatever blocked the last loopback
                // attempt is not a standing condition. Start the count over.
                *self.loopback_timeouts.lock().unwrap() = 0;
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
                // A bad paste must not burn the flow — the user retypes and
                // tries again. Only a spent code (the Ok arm) ends it. But
                // restore only if a paste form is still up.
                let keep = {
                    let state = self.state.lock().unwrap();
                    // The paste form is reachable in BOTH states: `awaiting_code` is the
                    // backend-driven manual mode, and `awaiting_browser` covers the escape
                    // hatch, which the renderer reveals locally at 60s without changing
                    // backend state. `slot.is_none()` is what blocks a cancelled flow from
                    // being resurrected over a newer one — not this predicate.
                    state.awaiting_code || state.awaiting_browser
                };
                let mut slot = self.auth_flow.lock().unwrap();
                if keep && slot.is_none() {
                    *slot = Some(flow);
                }
                drop(slot);

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
        *self.loopback_timeouts.lock().unwrap() = 0;
        let _ = self.tokens.clear();
        // Only Claude's: signing out of Claude says nothing about Codex.
        self.clear_reset(Channel::Claude);
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

    /// Re-run the reset decision for `channel` against its current session
    /// window, or clear it when reset toasts are off.
    fn sync_reset(&self, channel: Channel) {
        if self.prefs.get("notifications.sessionReset") == Some(Value::Bool(true)) {
            let session = channel.session(&self.state.lock().unwrap()).cloned();
            self.update_reset(channel, session.as_ref());
        } else {
            self.clear_reset(channel);
        }
    }

    fn restore_reset(&self, channel: Channel) {
        let runtime = self.channel(channel);
        let Some(state) = runtime.reset_store.load().ok().flatten() else {
            return;
        };
        let Some(resets_at) = state.get("resetsAt").and_then(|v| v.as_str()) else {
            return;
        };
        let Ok(when) = chrono::DateTime::parse_from_rfc3339(resets_at) else {
            let _ = runtime.reset_store.save(None);
            return;
        };
        let key = state
            .get("resetKey")
            .and_then(|v| v.as_str())
            .unwrap_or(resets_at)
            .to_string();
        runtime.reset.lock().unwrap().current_key = Some(key.clone());
        self.arm_reset(channel, key, when.with_timezone(&Utc));
    }

    fn update_reset(&self, channel: Channel, session: Option<&Slot>) {
        let runtime = self.channel(channel);
        let (current, last) = {
            let r = runtime.reset.lock().unwrap();
            (r.current_key.clone(), r.last_fired_key.clone())
        };
        match decide_update(session, current.as_deref(), last.as_deref()) {
            ResetDecision::Clear => self.clear_reset(channel),
            ResetDecision::NoChange => {}
            ResetDecision::Schedule {
                reset_key,
                resets_at,
            } => {
                runtime.reset.lock().unwrap().current_key = Some(reset_key.clone());
                let _ = runtime.reset_store.save(Some(&serde_json::json!({
                    "resetKey": reset_key,
                    "resetsAt": siphon_core::providers::iso(resets_at),
                })));
                self.arm_reset(channel, reset_key, resets_at);
            }
        }
    }

    fn clear_reset(&self, channel: Channel) {
        let runtime = self.channel(channel);
        {
            let mut r = runtime.reset.lock().unwrap();
            r.current_key = None;
            r.generation += 1;
        }
        let _ = runtime.reset_store.save(None);
    }

    /// Spawn a task that fires `channel`'s reset toast at `resets_at`. Sleeps
    /// in chunks (`next_sleep_ms`) so system suspend cannot delay the toast
    /// indefinitely, and re-checks the channel's generation on every wake so a
    /// newer schedule / clear / sign-out cancels this task instead of producing
    /// a stale toast.
    fn arm_reset(&self, channel: Channel, reset_key: String, resets_at: chrono::DateTime<Utc>) {
        let app = self.app.clone();
        let generation = {
            let mut r = self.channel(channel).reset.lock().unwrap();
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
                if state.controller.channel(channel).reset.lock().unwrap().generation != generation {
                    return; // superseded — abandon silently
                }
            }
            let Some(state) = app.try_state::<crate::AppContext>() else {
                return;
            };
            let controller = state.controller.clone();
            {
                let mut r = controller.channel(channel).reset.lock().unwrap();
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
                let toast = channel.reset_toast(&prefs.load().language);
                crate::notify::show(&app, &toast.title, &toast.body);
                if prefs.get("notifications.sound") == Some(Value::Bool(true)) {
                    let _ = app.emit("play-reset-sound", ());
                }
            }
            let _ = controller.channel(channel).reset_store.save(None);
            // Refresh so the session reads 0% without a manual click,
            // regardless of whether the toast itself was shown.
            match channel {
                Channel::Claude => controller.refresh_quota().await,
                Channel::Codex => controller.refresh_local_blocking().await,
                Channel::AntigravityGemini | Channel::AntigravityThirdParty => {
                    controller.refresh_antigravity().await
                }
            }
        });
    }
}
