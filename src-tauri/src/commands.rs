//! `#[tauri::command]`s implementing the IPC contract that `preload.cjs` used to
//! expose as `window.siphon.*`. The frontend bridge (`siphonBridge.js`) maps each
//! old method onto one of these. Names are snake_case; the bridge does the
//! translation so the renderer is untouched.

use serde::Deserialize;
use serde_json::{json, Value};
use tauri::{AppHandle, Manager, State};

use siphon_core::security::is_safe_external_url;
use siphon_core::state::AppState;

use crate::{apply_pref_change, AppContext};

#[tauri::command]
pub fn state_get(ctx: State<'_, AppContext>) -> AppState {
    ctx.controller.get_state()
}

#[tauri::command]
pub async fn refresh(ctx: State<'_, AppContext>) -> Result<(), ()> {
    ctx.controller.clone().refresh_all().await;
    Ok(())
}

#[tauri::command]
pub async fn auth_start(app: AppHandle, ctx: State<'_, AppContext>) -> Result<String, ()> {
    let url = ctx.controller.start_sign_in().await;
    if is_safe_external_url(&url) {
        let _ = tauri_plugin_opener::OpenerExt::opener(&app).open_url(url.clone(), None::<&str>);
    }
    Ok(url)
}

#[tauri::command]
pub async fn auth_submit(ctx: State<'_, AppContext>, code: String) -> Result<(), ()> {
    ctx.controller.submit_code(code).await;
    Ok(())
}

#[tauri::command]
pub fn auth_cancel(ctx: State<'_, AppContext>) {
    ctx.controller.cancel_auth();
}

#[tauri::command]
pub async fn auth_sign_out(ctx: State<'_, AppContext>) -> Result<(), ()> {
    ctx.controller.sign_out().await;
    Ok(())
}

#[tauri::command]
pub fn prefs_get(ctx: State<'_, AppContext>) -> Value {
    serde_json::to_value(ctx.prefs.load()).unwrap_or(Value::Null)
}

const ALLOWED_PREFS: &[&str] = &[
    "language",
    "notifications.sessionReset",
    "notifications.sound",
    "notifications.soundVolume",
    "notifications.expireSound",
    "notifications.expireSoundVolume",
    "notifications.expireAlert",
    "notifications.limitSound",
    "notifications.limitSoundVolume",
    "notifications.limitAlert",
    "floating.enabled",
    "floating.expanded",
    "floating.x",
    "floating.y",
    "floating.style",
    "startup.openAtLogin",
    "startup.showWindowOnLogin",
    "refresh.intervalSeconds",
    "claudePath",
    "integration.launchWithClaudeCode",
    "privacy.maskEmail",
    "display.quotaMode",
];

#[derive(Deserialize)]
pub struct PrefSet {
    pub path: String,
    pub value: Value,
}

#[tauri::command]
pub async fn prefs_set(app: AppHandle, ctx: State<'_, AppContext>, args: PrefSet) -> Result<(), ()> {
    let PrefSet { path, value } = args;
    if !ALLOWED_PREFS.contains(&path.as_str()) {
        return Ok(());
    }
    // Value guards matching main.js registerPrefsIpc.
    if path == "refresh.intervalSeconds" {
        let n = value.as_u64().unwrap_or(0);
        if !crate::controller::ALLOWED_REFRESH_INTERVALS.contains(&n) {
            return Ok(());
        }
    }
    if path == "floating.style" {
        let s = value.as_str().unwrap_or("");
        if s != "classic" && s != "mini" {
            return Ok(());
        }
    }
    if path == "display.quotaMode" {
        let s = value.as_str().unwrap_or("");
        if s != "used" && s != "remaining" {
            return Ok(());
        }
    }
    if path == "integration.launchWithClaudeCode" {
        let enable = value.as_bool().unwrap_or(false);
        let res = if enable {
            ctx.claude_settings.enable()
        } else {
            ctx.claude_settings.disable()
        };
        if let Err(e) = res {
            log::error!("claude settings sync failed: {e}");
        }
    }
    match ctx.prefs.set(&path, value) {
        Ok(change) => apply_pref_change(&app, &ctx, &change),
        Err(e) => log::error!("[prefs:set] write failed: {e}"),
    }
    Ok(())
}

#[tauri::command]
pub fn view_show_main(app: AppHandle) {
    crate::windows_ctl::show_main(&app);
}

#[tauri::command]
pub fn view_show_settings(app: AppHandle) {
    crate::windows_ctl::show_settings(&app);
}

#[tauri::command]
pub fn floating_open_main(app: AppHandle) {
    crate::windows_ctl::show_main(&app);
}

#[tauri::command]
pub async fn floating_close(app: AppHandle, ctx: State<'_, AppContext>) -> Result<(), ()> {
    if let Ok(change) = ctx.prefs.set("floating.enabled", Value::Bool(false)) {
        apply_pref_change(&app, &ctx, &change);
    }
    Ok(())
}

#[tauri::command]
pub async fn floating_set_expanded(
    app: AppHandle,
    ctx: State<'_, AppContext>,
    expanded: bool,
) -> Result<(), ()> {
    if let Ok(change) = ctx.prefs.set("floating.expanded", Value::Bool(expanded)) {
        apply_pref_change(&app, &ctx, &change);
    }
    Ok(())
}

#[tauri::command]
pub fn app_info(app: AppHandle, ctx: State<'_, AppContext>) -> Value {
    json!({
        "configDir": siphon_core::json_store::config_dir().to_string_lossy(),
        "claudeDir": ctx.prefs.claude_dir().to_string_lossy(),
        "notificationsSupported": true,
        "version": app.package_info().version.to_string(),
        "isPackaged": !cfg!(debug_assertions),
    })
}

#[tauri::command]
pub fn window_minimize(app: AppHandle) {
    if let Some(win) = app.get_webview_window("main") {
        let _ = win.minimize();
    }
}

#[tauri::command]
pub fn window_close(app: AppHandle) {
    if let Some(win) = app.get_webview_window("main") {
        let _ = win.hide();
    }
}

#[tauri::command]
pub fn app_quit(app: AppHandle) {
    app.exit(0);
}

#[tauri::command]
pub fn shell_open_external(app: AppHandle, url: String) {
    if is_safe_external_url(&url) {
        let _ = tauri_plugin_opener::OpenerExt::opener(&app).open_url(url, None::<&str>);
    }
}

#[tauri::command]
pub async fn dialog_pick_folder(app: AppHandle, ctx: State<'_, AppContext>) -> Result<Option<String>, ()> {
    use tauri_plugin_dialog::DialogExt;
    let start = ctx.prefs.claude_dir();
    let (tx, rx) = tokio::sync::oneshot::channel();
    app.dialog()
        .file()
        .set_directory(start)
        .pick_folder(move |path| {
            let _ = tx.send(path.map(|p| p.to_string()));
        });
    Ok(rx.await.unwrap_or(None))
}

// The update commands are Windows-specific; see `crate::updater_bin`.
#[tauri::command]
pub async fn update_download(app: AppHandle, payload: Value) -> Result<(), ()> {
    crate::updater_bin::download(app, payload).await;
    Ok(())
}

#[tauri::command]
pub fn update_install(app: AppHandle) {
    crate::updater_bin::install(&app);
}

#[tauri::command]
pub fn update_install_via_winget(app: AppHandle) {
    crate::updater_bin::install_via_winget();
    app.exit(0);
}
