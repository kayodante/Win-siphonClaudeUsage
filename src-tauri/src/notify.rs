//! Thin wrapper over `tauri-plugin-notification` for the toasts Siphon shows
//! (reset, expire, 70/90% alerts). Silent, click focuses the main window is
//! handled by the OS default.

use tauri::AppHandle;
use tauri_plugin_notification::NotificationExt;

pub fn show(app: &AppHandle, title: &str, body: &str) {
    if let Err(e) = app
        .notification()
        .builder()
        .title(title)
        .body(body)
        .show()
    {
        log::error!("notification failed: {e}");
    }
}
