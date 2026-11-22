//! Main-window show/position helpers, ported from the `showMainWindow` /
//! `showSettingsWindow` / `positionWindow` functions in `main.js`.

use tauri::{AppHandle, Emitter, Manager};

/// Logical-px floor for the main window's size, mirroring `minWidth`/
/// `minHeight` in `tauri.conf.json` — keep the two in sync. The OS only
/// enforces those against a manual drag-resize; `restore_main_position`'s
/// `set_size` call bypasses that clamp entirely, so a size smaller than this
/// (as happened when a stale, DPI-shrunk value was persisted — see the
/// `Resized` guard in `main.rs`) has to be floored here by hand.
/// 352 is the rail (64) plus the content well; raising it from 300 is also
/// what widens windows whose 320px size was persisted before the rail existed.
pub const MIN_W: f64 = 352.0;
pub const MIN_H: f64 = 700.0;

/// Logical width of the side rail — `.rail { width }` in styles.css, keep the
/// two in step. Collapsing the rail gives exactly this much back to the screen.
pub const RAIL_W: f64 = 62.0;

/// Whether the main window is currently narrowed by a collapsed rail. Not
/// persisted: the rail always boots expanded, which is why the `Resized`
/// handler in `main.rs` adds `RAIL_W` back before saving the width.
static RAIL_COLLAPSED: std::sync::atomic::AtomicBool = std::sync::atomic::AtomicBool::new(false);

pub fn rail_collapsed() -> bool {
    RAIL_COLLAPSED.load(std::sync::atomic::Ordering::Relaxed)
}

/// Narrow (or widen) the main window by the rail's width when the sidebar is
/// hidden (or shown), keeping the right edge where it is so the content well
/// never moves on screen — the left edge travels instead. Idempotent: asking
/// for the state the window is already in does nothing.
///
/// The minimum width follows along: lowered *before* shrinking (the OS would
/// otherwise clamp the new size back up) and raised only *after* growing.
pub fn set_rail_collapsed(app: &AppHandle, collapsed: bool) {
    use std::sync::atomic::Ordering;
    let Some(win) = app.get_webview_window("main") else {
        return;
    };
    if RAIL_COLLAPSED.swap(collapsed, Ordering::Relaxed) == collapsed {
        return;
    }
    if collapsed {
        let _ = win.set_min_size(Some(tauri::LogicalSize::new(MIN_W - RAIL_W, MIN_H)));
    }
    let (Ok(pos), Ok(size)) = (win.outer_position(), win.outer_size()) else {
        return;
    };
    let scale = win.scale_factor().unwrap_or(1.0);
    let delta = siphon_core::geometry::rail_delta_px(RAIL_W, scale) as i32;
    let delta = if collapsed { delta } else { -delta };
    let (x, y) = (pos.x + delta, pos.y);
    let (w, h) = (size.width as i32 - delta, size.height as i32);
    move_and_resize(&win, x, y, w, h);
    if !collapsed {
        let _ = win.set_min_size(Some(tauri::LogicalSize::new(MIN_W, MIN_H)));
    }
}

/// One atomic move+resize on Windows, so the right edge never twitches between
/// a separate `set_position` and `set_size`.
#[cfg(windows)]
fn move_and_resize(win: &tauri::WebviewWindow, x: i32, y: i32, w: i32, h: i32) {
    use windows::Win32::Foundation::HWND;
    use windows::Win32::UI::WindowsAndMessaging::{SetWindowPos, SWP_NOACTIVATE, SWP_NOZORDER};
    let Ok(handle) = win.hwnd() else { return };
    unsafe {
        let _ = SetWindowPos(HWND(handle.0 as _), None, x, y, w, h, SWP_NOZORDER | SWP_NOACTIVATE);
    }
}

#[cfg(not(windows))]
fn move_and_resize(win: &tauri::WebviewWindow, x: i32, y: i32, w: i32, h: i32) {
    let _ = win.set_position(tauri::PhysicalPosition::new(x, y));
    let _ = win.set_size(tauri::PhysicalSize::new(w.max(1) as u32, h.max(1) as u32));
}

/// Acrylic backdrop for a transparent, undecorated window, with the window's
/// own corners rounded to match.
///
/// `apply_acrylic` hands the backdrop to DWM, which paints it across the whole
/// window rect. The webview's `border-radius` only clips the HTML layer, so
/// without `DWMWCP_ROUND` the acrylic shows through outside the radius as four
/// grey corners. `DWMWCP_ROUND` is ~8px, matching `--radius-sm` on `.shell`
/// and `.floating-widget` — keep them in step. The attribute sticks for the
/// window's lifetime, so resizing does not need to re-apply it.
///
/// Rounding is Windows 11 only: on 10 the call fails and the corners stay
/// square, which needs no handling beyond ignoring it.
#[cfg(windows)]
pub fn apply_backdrop(win: &tauri::WebviewWindow) {
    use windows::Win32::Foundation::HWND;
    use windows::Win32::Graphics::Dwm::{
        DwmSetWindowAttribute, DWMWA_WINDOW_CORNER_PREFERENCE, DWMWCP_ROUND,
        DWM_WINDOW_CORNER_PREFERENCE,
    };

    let _ = window_vibrancy::apply_acrylic(win, Some((0, 0, 0, 190)));

    let Ok(handle) = win.hwnd() else { return };
    let preference = DWMWCP_ROUND;
    // Aligned with Tauri 2 and tauri-winrt-notification on windows 0.61; rebuild
    // the handle from the raw pointer rather than depending on both versions.
    unsafe {
        let _ = DwmSetWindowAttribute(
            HWND(handle.0 as _),
            DWMWA_WINDOW_CORNER_PREFERENCE,
            std::ptr::addr_of!(preference).cast(),
            std::mem::size_of::<DWM_WINDOW_CORNER_PREFERENCE>() as u32,
        );
    }
}

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
        // WebView2 keeps reporting the document as visible while the native
        // window is hidden, so `visibilitychange` never fires in the renderer
        // and the entrance choreography has no other way to know the window
        // just came back. Every show funnels through here.
        let _ = app.emit_to("main", "window-shown", ());
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
        .and_then(|(x, y)| siphon_core::geometry::fit_position(monitor, x, y, ww, wh))
        .unwrap_or_else(|| siphon_core::geometry::right_edge_position(monitor, ww, wh));
    let _ = win.set_position(tauri::PhysicalPosition::new(x, y));
}
