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

/// Physical work areas of every connected monitor, for
/// `siphon_core::geometry::position_is_visible`. Empty when the OS won't say.
///
/// Deliberately *not* divided by each monitor's scale factor: a monitor's
/// position is an offset in the shared virtual desktop, so scaling it by the
/// per-monitor DPI produces coordinates that belong to no space at all (a 125%
/// panel starting at physical x=2560 would report x=2048, overlapping the
/// monitor to its left). Physical pixels keep every rect comparable.
pub fn monitor_rects(app: &AppHandle) -> Vec<siphon_core::geometry::MonitorRect> {
    let Ok(monitors) = app.available_monitors() else {
        return Vec::new();
    };
    monitors
        .iter()
        .map(|m| {
            (
                m.position().x as f64,
                m.position().y as f64,
                m.size().width as f64,
                m.size().height as f64,
            )
        })
        .collect()
}

/// Move the main window back to its persisted `window.x/y` before it is first
/// shown. If nothing is stored, or the saved spot lands (mostly) off every
/// connected monitor, leave the OS default position — self-heals a monitor that
/// was unplugged since the position was saved. Mirrors
/// `floating::restore_position`.
///
/// Physical pixels throughout, matching what the move handler in `main.rs`
/// saved. A logical restore would be resolved against whichever monitor the
/// window currently sits on, so a position saved on a 125% panel came back
/// scaled by 1/1.25 once the window booted on a 100% monitor.
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

    // Size is independent of monitor placement (the OS clamps to
    // minWidth/minHeight from tauri.conf.json), so restore it unconditionally.
    //
    // Logical, matching what the resize handler saved and the units in
    // tauri.conf.json. Windows preserves a window's logical size across a
    // DPI change, so applying it here — before the move onto whichever monitor
    // the position belongs to — still lands the size the user left behind.
    if let (Some(w), Some(h)) = (bounds.width, bounds.height) {
        let _ = win.set_size(tauri::LogicalSize::new(w as f64, h as f64));
    }

    let (Some(x), Some(y)) = (bounds.x, bounds.y) else {
        return;
    };
    let (x, y) = (x as f64, y as f64);

    // Clamp against every connected monitor, not just the primary one — a
    // window parked on a secondary display is a valid saved position.
    let (ww, wh) = win
        .outer_size()
        .map(|s| (s.width as f64, s.height as f64))
        .unwrap_or((320.0, 700.0));
    if !siphon_core::geometry::position_is_visible(&monitor_rects(app), x, y, ww, wh) {
        return;
    }

    let _ = win.set_position(tauri::PhysicalPosition::new(x, y));
}
