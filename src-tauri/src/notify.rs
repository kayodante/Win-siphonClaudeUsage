//! Windows toasts Siphon shows (reset, expire, 70/90% alerts).
//!
//! Built straight on `tauri-winrt-notification` rather than
//! `tauri-plugin-notification`, because the plugin's desktop backend has no
//! activation callback — `on_action` exists only on mobile. Clicking a toast
//! has to reopen the main window (AAA-152), so this wraps the WinRT `Toast`
//! directly and keeps the shape the plugin produced: title, one body line,
//! silent (the renderer plays its own mp3), short duration.

use tauri::AppHandle;
use tauri_winrt_notification::{Duration, Toast};

pub fn show(app: &AppHandle, title: &str, body: &str) {
    // The AppUserModelID has to be one Windows knows about, and only the
    // installed app has it — the NSIS shortcut is what registers the bundle
    // identifier. In dev, fall back to the PowerShell id, same as the plugin
    // (via notify-rust) did before.
    let app_id = if tauri::is_dev() {
        Toast::POWERSHELL_APP_ID
    } else {
        &app.config().identifier
    };
    let handle = app.clone();
    // `Toast` wraps COM objects and is not `Send`, so it is built and shown on
    // the calling thread — no spawning. `show` only blocks for its own 10ms
    // sleep.
    let result = Toast::new(app_id)
        .title(title)
        .text1(body)
        .sound(None)
        .duration(Duration::Short)
        .on_activated(move |_action| {
            // Fires on a COM thread; Tauri marshals window calls to the event
            // loop itself. The user clicked, so taking focus is what they asked
            // for — unlike the SessionStart hook, which must not steal it.
            crate::windows_ctl::show_main(&handle);
            Ok(())
        })
        .show();
    if let Err(e) = result {
        log::error!("notification failed: {e}");
    }
}
