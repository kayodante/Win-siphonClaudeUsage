//! The side-effecting half of the updater (`updateService.js` + the download IPC
//! in `main.js`): download the installer to temp, verify its SHA-256, then spawn
//! it — or hand off to winget. Host allow-list + version validation come from
//! `siphon_core::security`.

use std::path::PathBuf;

use serde_json::{json, Value};
use sha2::{Digest, Sha256};
use tauri::{AppHandle, Emitter};

use siphon_core::security::{is_trusted_download_url, is_valid_version, TRUSTED_DOWNLOAD_HOSTS};
use siphon_core::updater::WINGET_ID;

fn emit_error(app: &AppHandle, message: &str) {
    let _ = app.emit("update:error", json!({ "message": message }));
}

pub async fn download(app: AppHandle, payload: Value) {
    let download_url = payload.get("downloadUrl").and_then(|v| v.as_str()).unwrap_or("");
    let checksum_url = payload.get("checksumUrl").and_then(|v| v.as_str());
    let version = payload.get("version").and_then(|v| v.as_str()).unwrap_or("");

    if !is_valid_version(version) {
        return emit_error(&app, "invalid version");
    }
    if !is_trusted_download_url(download_url)
        || checksum_url.map(|u| !is_trusted_download_url(u)).unwrap_or(false)
    {
        return emit_error(&app, "untrusted download URL");
    }

    let temp = std::env::temp_dir();
    let dest = temp.join(format!("Siphon-Setup-{version}.exe"));
    let checksum_path = temp.join(format!("Siphon-Setup-{version}.exe.sha256"));
    let effective_checksum = checksum_url
        .map(|s| s.to_string())
        .unwrap_or_else(|| format!("{download_url}.sha256"));

    let client = reqwest::Client::new();
    if let Err(e) = fetch_to_file(&client, download_url, &dest, Some(&app)).await {
        let _ = std::fs::remove_file(&dest);
        return emit_error(&app, &e);
    }
    if let Err(e) = fetch_to_file(&client, &effective_checksum, &checksum_path, None).await {
        let _ = std::fs::remove_file(&dest);
        return emit_error(&app, &e);
    }

    let expected = std::fs::read_to_string(&checksum_path)
        .ok()
        .and_then(|t| t.split_whitespace().next().map(|s| s.to_string()));
    let _ = std::fs::remove_file(&checksum_path);
    let actual = sha256_file(&dest);
    match (expected, actual) {
        (Some(exp), Ok(act)) if exp == act => {
            *PENDING.lock().unwrap() = Some(dest.clone());
            let _ = app.emit("update:downloaded", json!({ "filePath": dest.to_string_lossy() }));
        }
        _ => {
            let _ = std::fs::remove_file(&dest);
            emit_error(&app, "Checksum verification failed");
        }
    }
}

async fn fetch_to_file(
    client: &reqwest::Client,
    url: &str,
    dest: &PathBuf,
    progress: Option<&AppHandle>,
) -> Result<(), String> {
    use tokio::io::AsyncWriteExt;
    let resp = client
        .get(url)
        .header("User-Agent", "Siphon-Windows")
        .send()
        .await
        .map_err(|e| e.to_string())?;
    // reqwest follows redirects by default; re-validate the final host.
    if !TRUSTED_DOWNLOAD_HOSTS
        .iter()
        .any(|h| resp.url().host_str() == Some(*h))
    {
        return Err("untrusted redirect host".into());
    }
    if !resp.status().is_success() {
        return Err(format!("HTTP {}", resp.status().as_u16()));
    }
    let total = resp.content_length().unwrap_or(0);
    let mut received: u64 = 0;
    let mut file = tokio::fs::File::create(dest).await.map_err(|e| e.to_string())?;
    let mut stream = resp.bytes_stream();
    use futures_util::StreamExt;
    while let Some(chunk) = stream.next().await {
        let chunk = chunk.map_err(|e| e.to_string())?;
        received += chunk.len() as u64;
        file.write_all(&chunk).await.map_err(|e| e.to_string())?;
        if let (Some(app), true) = (progress, total > 0) {
            let percent = ((received as f64 / total as f64) * 100.0).round() as u64;
            let _ = app.emit("update:progress", json!({ "percent": percent }));
        }
    }
    file.flush().await.map_err(|e| e.to_string())?;
    Ok(())
}

fn sha256_file(path: &PathBuf) -> std::io::Result<String> {
    let bytes = std::fs::read(path)?;
    let digest = Sha256::digest(&bytes);
    Ok(hex(&digest))
}

fn hex(bytes: &[u8]) -> String {
    bytes.iter().map(|b| format!("{b:02x}")).collect()
}

static PENDING: std::sync::Mutex<Option<PathBuf>> = std::sync::Mutex::new(None);

pub fn install(app: &AppHandle) {
    let Some(path) = PENDING.lock().unwrap().take() else { return };
    // Validate it is the installer we downloaded to temp.
    let temp = std::env::temp_dir();
    let is_ours = path.starts_with(&temp)
        && path
            .file_name()
            .and_then(|n| n.to_str())
            .map(|n| n.starts_with("Siphon-Setup-") && n.ends_with(".exe"))
            .unwrap_or(false);
    if !is_ours || !path.exists() {
        emit_error(app, "invalid installer path");
        return;
    }
    #[cfg(windows)]
    {
        let _ = std::process::Command::new(&path).spawn();
    }
    #[cfg(not(windows))]
    {
        let _ = &path;
    }
}

/// Wait for this process to exit, run the winget upgrade, then relaunch. Matches
/// `buildWingetUpgradeCommand`.
pub fn install_via_winget() {
    #[cfg(windows)]
    {
        let pid = std::process::id();
        let exe = std::env::current_exe()
            .map(|p| p.to_string_lossy().replace('\'', "''"))
            .unwrap_or_default();
        let command = format!(
            "try {{ Wait-Process -Id {pid} -Timeout 30 }} catch {{}}; \
             winget upgrade --id {WINGET_ID} -e --silent --accept-package-agreements \
             --accept-source-agreements --disable-interactivity; \
             Start-Process -FilePath '{exe}'"
        );
        let _ = std::process::Command::new("powershell")
            .args([
                "-NoProfile",
                "-NonInteractive",
                "-WindowStyle",
                "Hidden",
                "-Command",
                &command,
            ])
            .spawn();
    }
}
