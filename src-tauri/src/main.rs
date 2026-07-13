// Prevents an extra console window on Windows in release.
#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

//! Siphon (Tauri) entry point. Wires the plugins, builds the shared
//! `AppContext`, registers the IPC commands that replace `preload.cjs`, creates
//! the tray + main window and starts the refresh loop. Mirrors the boot sequence
//! in the old `main.js` `onReady`.

mod claude_settings;
mod commands;
mod controller;
mod floating;
mod http;
mod notify;
mod prefs;
mod token_store;
mod tray;
mod update_check;
mod updater_bin;
mod windows_ctl;

use std::sync::Arc;
use std::time::Duration;

use tauri::{Emitter, Manager};

use claude_settings::ClaudeSettings;
use controller::{Controller, ALLOWED_REFRESH_INTERVALS, MIN_QUOTA_INTERVAL_MS};
use prefs::{Change, PrefsStore};
use siphon_core::json_store::config_dir;
use token_store::TokenStore;

const STARTUP_HIDDEN_ARG: &str = "--hidden";

/// Latest main-window position waiting to be persisted. `Some` also means a
/// flush task is already scheduled (trailing debounce, one write per drag burst).
/// Mirrors the floating widget's `PENDING_POS`.
static MAIN_PENDING_POS: std::sync::Mutex<Option<(i64, i64)>> = std::sync::Mutex::new(None);
const MAIN_POS_FLUSH_DELAY_MS: u64 = 500;

/// Managed application state, shared by every command and background task.
pub struct AppContext {
    pub controller: Arc<Controller>,
    pub prefs: Arc<PrefsStore>,
    pub tokens: Arc<TokenStore>,
    pub claude_settings: ClaudeSettings,
}

fn main() {
    let launch_hidden = std::env::args().any(|a| a == STARTUP_HIDDEN_ARG);

    tauri::Builder::default()
        .plugin(tauri_plugin_single_instance::init(|app, _argv, _cwd| {
            windows_ctl::show_main(app);
        }))
        .plugin(tauri_plugin_notification::init())
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_autostart::init(
            tauri_plugin_autostart::MacosLauncher::LaunchAgent,
            Some(vec![STARTUP_HIDDEN_ARG]),
        ))
        .setup(move |app| {
            let handle = app.handle().clone();

            let prefs = Arc::new(PrefsStore::new(config_dir().join("preferences.json")));
            let tokens = Arc::new(TokenStore::new());
            let cache_path = config_dir().join("local-usage-cache.json");
            let reset_path = config_dir().join("reset-notification.json");
            let exe_path = std::env::current_exe()
                .map(|p| p.to_string_lossy().into_owned())
                .unwrap_or_default();

            let controller = Arc::new(Controller::new(
                handle.clone(),
                prefs.clone(),
                tokens.clone(),
                cache_path,
                reset_path,
            ));

            app.manage(AppContext {
                controller: controller.clone(),
                prefs: prefs.clone(),
                tokens: tokens.clone(),
                claude_settings: ClaudeSettings::new(exe_path),
            });

            // Apply persisted autostart + launch-with-Claude-Code on boot.
            let initial = prefs.load();
            apply_autostart(&handle, initial.startup.open_at_login);
            if initial.integration.launch_with_claude_code {
                if let Some(ctx) = handle.try_state::<AppContext>() {
                    let _ = ctx.claude_settings.enable();
                }
            }

            // Build the tray with the empty initial state.
            let initial_state = controller.get_state();
            tray::build(&handle, &initial_state)?;

            // Put the window back where the user left it before first paint.
            // Runs even when launching hidden so a later tray-show is anchored.
            windows_ctl::restore_main_position(&handle);
            if siphon_core::preferences::show_window_at_boot(
                launch_hidden,
                initial.startup.show_window_on_login,
            ) {
                windows_ctl::show_main(&handle);
            }

            // Boot the controller + refresh loop.
            let c = controller.clone();
            let p = prefs.clone();
            tauri::async_runtime::spawn(async move {
                c.clone().start().await;
                let mut elapsed_since_quota = 0u64;
                loop {
                    let interval = refresh_interval_secs(&p);
                    tokio::time::sleep(Duration::from_secs(interval)).await;
                    c.clone().refresh_local_blocking().await;
                    elapsed_since_quota += interval * 1000;
                    let quota_interval = interval.saturating_mul(1000).max(MIN_QUOTA_INTERVAL_MS);
                    if elapsed_since_quota >= quota_interval && c.get_state().is_signed_in {
                        c.refresh_quota().await;
                        elapsed_since_quota = 0;
                    }
                }
            });

            // Periodic update check (boot + every 6h) → `update-available` event.
            update_check::spawn(handle.clone());

            Ok(())
        })
        .on_window_event(|window, event| {
            if window.label() != "main" {
                return;
            }
            match event {
                // Closing the main window hides it (tray app), matching the old
                // `window.on('close')` guard.
                tauri::WindowEvent::CloseRequested { api, .. } => {
                    api.prevent_close();
                    let _ = window.hide();
                }
                // Persist the position on drag so it survives a full quit, not
                // just a hide-to-tray. Debounced like the floating widget.
                tauri::WindowEvent::Moved(pos) => {
                    let scale = window.scale_factor().unwrap_or(1.0);
                    let lx = (pos.x as f64 / scale).round() as i64;
                    let ly = (pos.y as f64 / scale).round() as i64;
                    let schedule_flush = {
                        let mut p = MAIN_PENDING_POS.lock().unwrap();
                        let first = p.is_none();
                        *p = Some((lx, ly));
                        first
                    };
                    if schedule_flush {
                        let handle = window.app_handle().clone();
                        tauri::async_runtime::spawn(async move {
                            tokio::time::sleep(Duration::from_millis(MAIN_POS_FLUSH_DELAY_MS)).await;
                            let Some((x, y)) = MAIN_PENDING_POS.lock().unwrap().take() else {
                                return;
                            };
                            if let Some(ctx) = handle.try_state::<AppContext>() {
                                let _ = ctx.prefs.set_many(vec![
                                    ("window.x".into(), x.into()),
                                    ("window.y".into(), y.into()),
                                ]);
                            }
                        });
                    }
                }
                _ => {}
            }
        })
        .invoke_handler(tauri::generate_handler![
            commands::state_get,
            commands::refresh,
            commands::auth_start,
            commands::auth_submit,
            commands::auth_cancel,
            commands::auth_sign_out,
            commands::prefs_get,
            commands::prefs_set,
            commands::view_show_main,
            commands::view_show_settings,
            commands::floating_open_main,
            commands::floating_close,
            commands::floating_set_expanded,
            commands::app_info,
            commands::window_minimize,
            commands::window_close,
            commands::app_quit,
            commands::shell_open_external,
            commands::dialog_pick_folder,
            commands::update_download,
            commands::update_install,
            commands::update_install_via_winget,
        ])
        .run(tauri::generate_context!())
        .expect("error while running Siphon");
}

fn refresh_interval_secs(prefs: &PrefsStore) -> u64 {
    let n = prefs
        .get("refresh.intervalSeconds")
        .and_then(|v| v.as_u64())
        .unwrap_or(30);
    if ALLOWED_REFRESH_INTERVALS.contains(&n) {
        n
    } else {
        30
    }
}

/// React to a preference change, mirroring the `preferences.on('change')`
/// handler in the old `main.js`. Always re-syncs `state.preferences` (which
/// re-emits and re-renders the tray + widget); a few paths need extra work.
pub fn apply_pref_change(app: &tauri::AppHandle, ctx: &AppContext, change: &Change) {
    ctx.controller.sync_preferences();

    match change.path.as_str() {
        "claudePath" => {
            let c = ctx.controller.clone();
            tauri::async_runtime::spawn(async move {
                c.refresh_local_blocking().await;
            });
        }
        p if p.starts_with("startup.") => {
            let s = &change.preferences.startup;
            apply_autostart(app, s.open_at_login);
        }
        _ => {}
    }
    // Re-render immediately for widget open/close/style changes. Mirror the
    // controller's emit side effects so the floating window is created/closed
    // synchronously instead of waiting for the next refresh tick.
    let state = ctx.controller.get_state();
    let _ = app.emit("state-changed", &state);
    crate::tray::update(app, &state);
    crate::floating::sync(app, &state);
}

fn apply_autostart(app: &tauri::AppHandle, enabled: bool) {
    use tauri_plugin_autostart::ManagerExt;
    let manager = app.autolaunch();
    let _ = if enabled {
        manager.enable()
    } else {
        manager.disable()
    };
}
