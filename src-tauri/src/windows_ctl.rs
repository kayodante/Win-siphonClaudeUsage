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

/// Logical work areas of every connected monitor, for
/// `siphon_core::geometry::position_is_visible`. Empty when the OS won't say.
pub fn monitor_rects(app: &AppHandle) -> Vec<siphon_core::geometry::MonitorRect> {
    let Ok(monitors) = app.available_monitors() else {
        return Vec::new();
    };
    monitors
        .iter()
        .map(|m| {
            let s = m.scale_factor();
            (
                m.position().x as f64 / s,
                m.position().y as f64 / s,
                m.size().width as f64 / s,
                m.size().height as f64 / s,
            )
        })
        .collect()
}

/// Move the main window back to its persisted `window.x/y` before it is first
/// shown. If nothing is stored, or the saved spot lands (mostly) off every
/// connected monitor, leave the OS default position — self-heals a monitor that
/// was unplugged since the position was saved. Mirrors
/// `floating::restore_position`.
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

    // Clamp against every connected monitor, not just the primary one — a
    // window parked on a secondary display is a valid saved position.
    let scale = win.scale_factor().unwrap_or(1.0);
    let (ww, wh) = win
        .outer_size()
        .map(|s| (s.width as f64 / scale, s.height as f64 / scale))
        .unwrap_or((320.0, 700.0));
    if !siphon_core::geometry::position_is_visible(&monitor_rects(app), x, y, ww, wh) {
        return;
    }

    let _ = win.set_position(tauri::LogicalPosition::new(x, y));
}
