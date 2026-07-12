//! Periodic update check — restores the `checkForUpdate` half of the old
//! `updateService.js` that was not carried over in the Tauri migration.
//! Fetches the latest GitHub release, compares against the running version
//! (`siphon_core::updater::parse_release`) and emits `update-available` with
//! the payload the renderer's update banner expects. Download/verify/install
//! live in `updater_bin.rs`, driven by the renderer.

use std::time::Duration;

use serde_json::Value;
use tauri::{AppHandle, Emitter};

use siphon_core::updater::{parse_release, REPO};

const STARTUP_DELAY: Duration = Duration::from_secs(15);
const CHECK_INTERVAL: Duration = Duration::from_secs(6 * 60 * 60);
const FETCH_TIMEOUT: Duration = Duration::from_secs(15);

/// Start the periodic check loop: once shortly after boot, then every 6 hours.
pub fn spawn(app: AppHandle) {
    tauri::async_runtime::spawn(async move {
        tokio::time::sleep(STARTUP_DELAY).await;
        loop {
            check_once(&app).await;
            tokio::time::sleep(CHECK_INTERVAL).await;
        }
    });
}

async fn check_once(app: &AppHandle) {
    let current = app.package_info().version.to_string();
    let Some(release) = fetch_latest_release().await else { return };
    let Some(info) = parse_release(&release, &current) else { return };
    let winget = tauri::async_runtime::spawn_blocking(winget_upgrade_available)
        .await
        .unwrap_or(false);
    let _ = app.emit("update-available", info.to_payload(winget));
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
