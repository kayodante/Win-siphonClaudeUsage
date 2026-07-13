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

/// Move the main window back to its persisted `window.x/y` before it is first
/// shown. If nothing is stored, or the saved spot lands (mostly) off the primary
/// monitor, leave the OS default position — self-heals a monitor that was
/// unplugged since the position was saved. Mirrors `floating::restore_position`.
pub fn restore_main_position(app: &AppHandle) {
    let Some(win) = app.get_webview_window("main") else {
        return;
    };
    let Some(ctx) = app.try_state::<crate::AppContext>() else {
        return;
    };
    let Some(bounds) = ctx.prefs.load().window else {
        return;
    };
    let (Some(x), Some(y)) = (bounds.x, bounds.y) else {
        return;
    };
    let (x, y) = (x as f64, y as f64);

    // Clamp against the primary monitor's logical work area.
    if let Ok(Some(monitor)) = app.primary_monitor() {
        let ms = monitor.scale_factor();
        let lw = monitor.size().width as f64 / ms;
        let lh = monitor.size().height as f64 / ms;

        let scale = win.scale_factor().unwrap_or(ms);
        let (ww, wh) = win
            .outer_size()
            .map(|s| (s.width as f64 / scale, s.height as f64 / scale))
            .unwrap_or((320.0, 700.0));

        let off_screen = x < 0.0 || y < 0.0 || x > lw - ww * 0.5 || y > lh - wh * 0.5;
        if off_screen {
            return;
        }
    }

    let _ = win.set_position(tauri::LogicalPosition::new(x, y));
}
