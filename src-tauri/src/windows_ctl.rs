//! Main-window show/position helpers, ported from the `showMainWindow` /
//! `showSettingsWindow` / `positionWindow` functions in `main.js`.

use tauri::{AppHandle, Emitter, Manager};

/// Logical-px floor for the main window's size, mirroring `minWidth`/
/// `minHeight` in `tauri.conf.json` — keep the two in sync. The OS only
/// enforces those against a manual drag-resize; `restore_main_position`'s
/// `set_size` call bypasses that clamp entirely, so a size smaller than this
/// (as happened when a stale, DPI-shrunk value was persisted — see the
/// `Resized` guard in `main.rs`) has to be floored here by hand.
pub const MIN_W: f64 = 300.0;
pub const MIN_H: f64 = 700.0;

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

/// The primary monitor's physical rect, for the default placement in
/// `restore_main_position`. Same physical-pixels reasoning as `monitor_rects`
/// above — this just asks the OS to name one of them "primary" instead of
/// listing all of them. Falls back to the first connected monitor when the OS
/// won't name a primary at all.
fn primary_monitor_rect(app: &AppHandle) -> Option<siphon_core::geometry::MonitorRect> {
    if let Ok(Some(m)) = app.primary_monitor() {
        return Some((
            m.position().x as f64,
            m.position().y as f64,
            m.size().width as f64,
            m.size().height as f64,
        ));
    }
    monitor_rects(app).into_iter().next()
}

/// Move the main window back to its persisted `window.x/y` before it is first
/// shown. If nothing is stored yet (first launch), or the saved spot lands
/// (mostly) off every connected monitor — a monitor unplugged since it was
/// saved — park it at the primary monitor's top-right corner instead of
/// leaving whatever the OS defaulted to. Mirrors `floating::restore_position`.
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
    let bounds = ctx.prefs.load().window;

    // Size is independent of monitor placement (the OS clamps to
    // minWidth/minHeight from tauri.conf.json, but only against a manual
    // drag-resize — this call bypasses that), so restore it unconditionally,
    // floored at MIN_W/MIN_H in case a smaller size got persisted by a
    // previous, buggier launch (see MIN_W's doc comment for how that happened).
    //
    // Logical, matching what the resize handler saved and the units in
    // tauri.conf.json. Windows preserves a window's logical size across a
    // DPI change, so applying it here — before the move onto whichever monitor
    // the position belongs to — still lands the size the user left behind.
    if let Some((w, h)) = bounds.as_ref().and_then(|b| b.width.zip(b.height)) {
        let (w, h) = ((w as f64).max(MIN_W), (h as f64).max(MIN_H));
        let _ = win.set_size(tauri::LogicalSize::new(w, h));
    }

    // Read the physical size back after set_size, so both the visibility
    // check below and the fallback placement use the size actually applied —
    // not whatever size the window was born with.
    let (ww, wh) = win
        .outer_size()
        .map(|s| (s.width as f64, s.height as f64))
        .unwrap_or((320.0, 700.0));

    // Clamp against every connected monitor, not just the primary one — a
    // window parked on a secondary display is a valid saved position.
    let rects = monitor_rects(app);
    let saved_xy = bounds
        .and_then(|b| b.x.zip(b.y))
        .map(|(x, y)| (x as f64, y as f64));
    let saved_monitor =
        saved_xy.and_then(|(x, y)| siphon_core::geometry::monitor_containing(&rects, x, y, ww, wh));

    // With no monitor information at all, trust the saved spot rather than
    // fight the OS — same call `position_is_visible` makes for an empty list.
    if rects.is_empty() {
        if let Some((x, y)) = saved_xy {
            let _ = win.set_position(tauri::PhysicalPosition::new(x, y));
        }
        return;
    }

    // The display the window is about to live on: the one the saved spot sits
    // on, or the primary when nothing was stored (first launch) or the saved
    // spot fell off an unplugged monitor.
    let Some(monitor) = saved_monitor.or_else(|| primary_monitor_rect(app)) else {
        return;
    };

    // Shrink to fit that display before placing it. A logical size is
    // DPI-independent, so a window sized on a large monitor can be taller than
    // a smaller one is — without this it comes back hanging off the bottom.
    // Physical, because that is the space the monitor rect is in; the OS min
    // size does not fight back here, fitting the screen beats the MIN_H floor.
    let (ww, wh) = siphon_core::geometry::fit_size(monitor, ww, wh);
    let _ = win.set_size(tauri::PhysicalSize::new(ww as u32, wh as u32));

    // A valid saved spot survives the fit (the window only ever got smaller);
    // otherwise fall back to a defined placement instead of the OS default,
    // which is where the window-in-a-random-corner half of the bug came from.
    let (x, y) = saved_xy
        .filter(|_| saved_monitor.is_some())
        .unwrap_or_else(|| siphon_core::geometry::right_edge_position(monitor, ww, wh));
    let _ = win.set_position(tauri::PhysicalPosition::new(x, y));
}
