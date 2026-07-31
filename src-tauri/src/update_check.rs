//! Periodic update check — restores the `checkForUpdate` half of the old
//! `updateService.js` that was not carried over in the Tauri migration.
//! Fetches the latest GitHub release, compares against the running version
//! (`siphon_core::updater::parse_release`) and emits `update-available` with
//! the payload the renderer's update banner expects. Download/verify/install
//! live in `updater_bin.rs`, driven by the renderer.

use std::time::Duration;

use serde_json::Value;
use tauri::{AppHandle, Emitter, Manager};

use siphon_core::updater::{parse_release, REPO};

const STARTUP_DELAY: Duration = Duration::from_secs(15);
const CHECK_INTERVAL: Duration = Duration::from_secs(6 * 60 * 60);
const FETCH_TIMEOUT: Duration = Duration::from_secs(15);

/// Start the periodic check loop: once shortly after boot, then every 6 hours.
/// Gated on `updates.autoCheck`; `main.rs` also calls `check_now` when the user
/// flips that pref on, so enabling it does not wait out the 6-hour interval.
pub fn spawn(app: AppHandle) {
    tauri::async_runtime::spawn(async move {
        tokio::time::sleep(STARTUP_DELAY).await;
        loop {
            check_once(&app).await;
            tokio::time::sleep(CHECK_INTERVAL).await;
        }
    });
}

/// One-shot check outside the loop (used when `updates.autoCheck` is enabled).
pub fn check_now(app: AppHandle) {
    tauri::async_runtime::spawn(async move {
        check_once(&app).await;
    });
}

/// Versions already downloaded in this run, so the 6-hour loop does not re-fetch
/// the same installer while the user leaves the banner sitting there.
static DOWNLOADED: std::sync::Mutex<Option<String>> = std::sync::Mutex::new(None);

async fn check_once(app: &AppHandle) {
    let prefs = match app.try_state::<crate::AppContext>() {
        Some(ctx) => ctx.prefs.load().updates,
        None => return,
    };
    if !prefs.auto_check {
        return;
    }
    let current = app.package_info().version.to_string();
    let Some(release) = fetch_latest_release().await else {
        return;
    };
    let Some(info) = parse_release(&release, &current) else {
        return;
    };
    let winget = tauri::async_runtime::spawn_blocking(winget_upgrade_available)
        .await
        .unwrap_or(false);
    let payload = info.to_payload(winget);
    let _ = app.emit("update-available", payload.clone());

    // winget installs own the upgrade path — nothing to download ourselves.
    if !prefs.auto_download || winget {
        return;
    }
    let already = DOWNLOADED.lock().unwrap().as_deref() == Some(info.version.as_str());
    if already || info.download_url.is_none() {
        return;
    }
    *DOWNLOADED.lock().unwrap() = Some(info.version.clone());
    crate::updater_bin::download(app.clone(), payload).await;
}

async fn fetch_latest_release() -> Option<Value> {
    let url = format!("https://api.github.com/repos/{REPO}/releases/latest");
    let client = reqwest::Client::builder()
        .timeout(FETCH_TIMEOUT)
        .build()
        .ok()?;
    let resp = client
        .get(&url)
        .header("User-Agent", "Siphon-Windows")
        .header("Accept", "application/vnd.github+json")
        .send()
        .await
        .ok()?;
    if !resp.status().is_success() {
        return None;
    }
    resp.json::<Value>().await.ok()
}

/// True when the app is installed via winget, so the renderer can offer the
/// winget upgrade path instead of the direct download.
#[cfg(windows)]
fn winget_upgrade_available() -> bool {
    use std::os::windows::process::CommandExt;
    const CREATE_NO_WINDOW: u32 = 0x0800_0000;
    std::process::Command::new("winget")
        .args([
            "list",
            "--exact",
            "--id",
            siphon_core::updater::WINGET_ID,
            "--disable-interactivity",
            "--accept-source-agreements",
        ])
        .creation_flags(CREATE_NO_WINDOW)
        .output()
        .map(|o| o.status.success())
        .unwrap_or(false)
}

#[cfg(not(windows))]
fn winget_upgrade_available() -> bool {
    false
}
