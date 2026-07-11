//! Main-window show/position helpers, ported from the `showMainWindow` /
//! `showSettingsWindow` / `positionWindow` functions in `main.js`.

use tauri::{AppHandle, Emitter, Manager};

pub fn show_main(app: &AppHandle) {
    show_window(app);
    send_view(app, "main");
}

pub fn show_settings(app: &AppHandle) {
    show_window(app);
    send_view(app, "settings");
}

fn show_window(app: &AppHandle) {
    if let Some(win) = app.get_webview_window("main") {
        let _ = win.show();
        let _ = win.unminimize();
        let _ = win.set_focus();
    }
}

fn send_view(app: &AppHandle, view: &str) {
    let _ = app.emit_to("main", "view-changed", view);
}
