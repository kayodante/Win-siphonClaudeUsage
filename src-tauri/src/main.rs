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
            apply_autostart(
                &handle,
                initial.startup.open_at_login,
                initial.startup.show_window_on_login,
            );
            if initial.integration.launch_with_claude_code {
                if let Some(ctx) = handle.try_state::<AppContext>() {
                    let _ = ctx.claude_settings.enable();
                }
            }

            // Build the tray with the empty initial state.
            let initial_state = controller.get_state();
            tray::build(&handle, &initial_state)?;

            if !launch_hidden {
                windows_ctl::show_main(&handle);
            }

            // Boot the controller + refresh loop.
            let c = controller.clone();
            let p = prefs.clone();
            tauri::async_runtime::spawn(async move {
                c.start().await;
                let mut elapsed_since_quota = 0u64;
                loop {
                    let interval = refresh_interval_secs(&p);
                    tokio::time::sleep(Duration::from_secs(interval)).await;
                    c.refresh_local();
                    elapsed_since_quota += interval * 1000;
                    let quota_interval = interval.saturating_mul(1000).max(MIN_QUOTA_INTERVAL_MS);
                    if elapsed_since_quota >= quota_interval && c.get_state().is_signed_in {
                        c.refresh_quota().await;
                        elapsed_since_quota = 0;
                    }
                }
            });

            Ok(())
        })
        .on_window_event(|window, event| {
            // Closing the main window hides it (tray app), matching the old
            // `window.on('close')` guard.
            if window.label() == "main" {
                if let tauri::WindowEvent::CloseRequested { api, .. } = event {
                    api.prevent_close();
                    let _ = window.hide();
                }
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
        "claudePath" => ctx.controller.refresh_local(),
        p if p.starts_with("startup.") => {
            let s = &change.preferences.startup;
            apply_autostart(app, s.open_at_login, s.show_window_on_login);
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

fn apply_autostart(app: &tauri::AppHandle, enabled: bool, _show_window: bool) {
    use tauri_plugin_autostart::ManagerExt;
    let manager = app.autolaunch();
    let _ = if enabled {
        manager.enable()
    } else {
        manager.disable()
    };
}
