//! Floating always-on-top widget, ported from `floatingWindow.js`. Two layouts
//! (classic / mini) with fixed sizes; acrylic background via `window-vibrancy`
//! on Windows, with the window's own corners rounded to match. Position is
//! persisted to `floating.x/y`.

use tauri::{AppHandle, Emitter, Manager, WebviewUrl, WebviewWindowBuilder};

use siphon_core::state::AppState;

const MINI: (f64, f64) = (71.0, 32.0);
const MINI_WEEKLY: (f64, f64) = (136.0, 32.0);
const COMPACT: (f64, f64) = (220.0, 104.0);
const EXPANDED: (f64, f64) = (220.0, 192.0);

/// Latest dragged position waiting to be persisted. `Some` also means a
/// flush task is already scheduled (trailing debounce, one write per burst).
static PENDING_POS: std::sync::Mutex<Option<(i64, i64)>> = std::sync::Mutex::new(None);
const POS_FLUSH_DELAY_MS: u64 = 500;

/// Bumped by every `create`; the topmost-keeper task exits when it no longer
/// matches, so re-enabling the widget can never leave two loops running.
static RAISE_GEN: std::sync::atomic::AtomicU64 = std::sync::atomic::AtomicU64::new(0);
const RAISE_INTERVAL_MS: u64 = 2000;

/// Put the widget back at the top of the topmost band.
///
/// `WebviewWindow::set_always_on_top(true)` cannot do this: tao diffs window
/// flags and returns early when nothing changed, so re-asserting `true` on a
/// window that is already topmost issues no `SetWindowPos` at all. Windows
/// orders the topmost band by activation, so any *other* topmost window
/// (Task Manager, a game or capture overlay, another widget) activated after
/// us sits above the widget permanently. Re-issuing `HWND_TOPMOST` restores
/// the order; `SWP_NOACTIVATE` keeps focus where the user left it.
#[cfg(windows)]
fn raise(win: &tauri::WebviewWindow) {
    use windows::Win32::Foundation::HWND;
    use windows::Win32::UI::WindowsAndMessaging::{
        SetWindowPos, HWND_TOPMOST, SWP_NOACTIVATE, SWP_NOMOVE, SWP_NOSIZE,
    };

    let Ok(handle) = win.hwnd() else { return };
    // Aligned with Tauri 2 and tauri-winrt-notification on windows 0.61; rebuild the
    // handle from the raw pointer rather than depending on both versions.
    unsafe {
        let _ = SetWindowPos(
            HWND(handle.0 as _),
            Some(HWND_TOPMOST),
            0,
            0,
            0,
            0,
            SWP_NOMOVE | SWP_NOSIZE | SWP_NOACTIVATE,
        );
    }
}

#[cfg(not(windows))]
fn raise(win: &tauri::WebviewWindow) {
    let _ = win.set_always_on_top(true);
}

/// Round the window itself, so the acrylic backdrop stops squaring off the
/// widget's corners.
///
/// `apply_acrylic` hands the backdrop to DWM, which paints it across the whole
/// window rect. The webview's `border-radius` only clips the HTML layer, so the
/// acrylic kept showing through outside the radius as four grey corners.
/// `DWMWCP_ROUND` is ~8px, matching `--radius-sm` on `.floating-widget` — keep
/// the two in step. The attribute sticks for the window's lifetime, so resizing
/// between compact and expanded does not need to re-apply it.
///
/// Windows 11 only: on 10 the call fails and the corners stay square, which is
/// exactly today's rendering, so the failure needs no handling beyond ignoring
/// it.
#[cfg(windows)]
fn round_corners(win: &tauri::WebviewWindow) {
    use windows::Win32::Foundation::HWND;
    use windows::Win32::Graphics::Dwm::{
        DwmSetWindowAttribute, DWMWA_WINDOW_CORNER_PREFERENCE, DWMWCP_ROUND,
        DWM_WINDOW_CORNER_PREFERENCE,
    };

    let Ok(handle) = win.hwnd() else { return };
    let preference = DWMWCP_ROUND;
    // Same raw-pointer rebuild as `raise`, for the same version-skew reason.
    unsafe {
        let _ = DwmSetWindowAttribute(
            HWND(handle.0 as _),
            DWMWA_WINDOW_CORNER_PREFERENCE,
            std::ptr::addr_of!(preference).cast(),
            std::mem::size_of::<DWM_WINDOW_CORNER_PREFERENCE>() as u32,
        );
    }
}

fn size_for(style: &str, expanded: bool, show_weekly: bool) -> (f64, f64) {
    if style == "mini" {
        if show_weekly {
            MINI_WEEKLY
        } else {
            MINI
        }
    } else if expanded {
        EXPANDED
    } else {
        COMPACT
    }
}

/// Reconcile the widget window with the current state (create/show/sync/close).
/// Mirrors `syncFloatingWindow`.
pub fn sync(app: &AppHandle, state: &AppState) {
    let enabled = state.preferences.floating.enabled;
    if !enabled {
        if let Some(win) = app.get_webview_window("floating") {
            let _ = win.close();
        }
        return;
    }

    if let Some(win) = app.get_webview_window("floating") {
        apply_size(app, &win, state);
        let _ = win.emit("state-changed", state);
        raise(&win);
    } else {
        create(app, state);
    }
}

fn create(app: &AppHandle, state: &AppState) {
    let style = state.preferences.floating.style.clone();
    let (w, h) = size_for(
        &style,
        state.preferences.floating.expanded,
        state.preferences.floating.show_weekly,
    );
    let builder = WebviewWindowBuilder::new(
        app,
        "floating",
        WebviewUrl::App("renderer/floating.html".into()),
    )
    .title("Siphon Widget")
    .inner_size(w, h)
    .resizable(false)
    .decorations(false)
    .transparent(true)
    .shadow(false)
    .always_on_top(true)
    .skip_taskbar(true)
    .visible(false);

    let win = match builder.build() {
        Ok(w) => w,
        Err(e) => {
            log::error!("floating widget failed: {e}");
            return;
        }
    };

    restore_position(
        app,
        &win,
        state,
        state
            .preferences
            .floating
            .x
            .zip(state.preferences.floating.y),
    );

    #[cfg(windows)]
    if style != "mini" {
        use window_vibrancy::apply_acrylic;
        let _ = apply_acrylic(&win, Some((0, 0, 0, 190)));
        round_corners(&win);
    }

    let _ = win.show();
    raise(&win);
    let _ = win.emit("state-changed", state);

    // Keep the widget on top for as long as it exists. A refresh tick would be
    // far too coarse (30 s of the widget sitting behind another topmost window).
    // ponytail: 2 s poll; `RegisterShellHookWindow` + HSHELL_WINDOWACTIVATED
    // would make this event-driven if the delay ever becomes noticeable.
    let generation = RAISE_GEN.fetch_add(1, std::sync::atomic::Ordering::Relaxed) + 1;
    let keeper = app.clone();
    tauri::async_runtime::spawn(async move {
        loop {
            tokio::time::sleep(std::time::Duration::from_millis(RAISE_INTERVAL_MS)).await;
            if RAISE_GEN.load(std::sync::atomic::Ordering::Relaxed) != generation {
                return;
            }
            let Some(win) = keeper.get_webview_window("floating") else {
                return;
            };
            raise(&win);
        }
    });

    let handle = app.clone();
    win.on_window_event(move |event| {
        if let tauri::WindowEvent::Moved(pos) = event {
            // Physical pixels, unscaled: see `windows_ctl::monitor_rects`.
            // Closing the widget fires a move to Windows' off-screen sentinel —
            // persisting that would lose the real position.
            if siphon_core::geometry::position_is_sentinel(pos.x as f64, pos.y as f64) {
                return;
            }
            let schedule_flush = {
                let mut p = PENDING_POS.lock().unwrap();
                let first = p.is_none();
                *p = Some((pos.x as i64, pos.y as i64));
                first
            };
            if schedule_flush {
                let handle = handle.clone();
                tauri::async_runtime::spawn(async move {
                    tokio::time::sleep(std::time::Duration::from_millis(POS_FLUSH_DELAY_MS)).await;
                    let Some((x, y)) = PENDING_POS.lock().unwrap().take() else {
                        return;
                    };
                    if let Some(ctx) = handle.try_state::<crate::AppContext>() {
                        let _ = ctx.prefs.set_many(vec![
                            ("floating.x".into(), x.into()),
                            ("floating.y".into(), y.into()),
                        ]);
                    }
                });
            }
        }
    });
}

fn apply_size(app: &AppHandle, win: &tauri::WebviewWindow, state: &AppState) {
    let (w, h) = size_for(
        &state.preferences.floating.style,
        state.preferences.floating.expanded,
        state.preferences.floating.show_weekly,
    );
    let size = tauri::LogicalSize::new(w, h);
    let physical_size = size.to_physical::<u32>(win.scale_factor().unwrap_or(1.0));
    if win.inner_size().ok() == Some(physical_size) {
        return;
    }
    let position = win.outer_position().ok().map(|p| (p.x as i64, p.y as i64));
    if win.set_size(size).is_ok() && state.preferences.floating.style == "mini" {
        // Use the live position: a recent drag may still be waiting for its save.
        restore_position(app, win, state, position);
    }
}

fn restore_position(
    app: &AppHandle,
    win: &tauri::WebviewWindow,
    state: &AppState,
    saved_position: Option<(i64, i64)>,
) {
    let style = &state.preferences.floating.style;
    let (w, h) = size_for(
        style,
        state.preferences.floating.expanded,
        state.preferences.floating.show_weekly,
    );
    let monitors = app.available_monitors().unwrap_or_default();

    if let Some((x, y)) = saved_position {
        let (x, y) = (x as f64, y as f64);
        let restored = monitors.iter().find_map(|monitor| {
            let position = monitor.position();
            let size = monitor.size();
            let rect = (
                position.x as f64,
                position.y as f64,
                size.width as f64,
                size.height as f64,
            );
            // The destination monitor owns the physical size, not the screen we booted on.
            let (w, h) = (w * monitor.scale_factor(), h * monitor.scale_factor());
            if style == "mini" {
                siphon_core::geometry::fit_position(rect, x, y, w, h)
            } else {
                siphon_core::geometry::monitor_containing(&[rect], x, y, w, h).map(|_| (x, y))
            }
        });
        if let Some((x, y)) = restored.or_else(|| monitors.is_empty().then_some((x, y))) {
            let _ = win.set_position(tauri::PhysicalPosition::new(x, y));
            return;
        }
    }

    let (x, y) = app
        .primary_monitor()
        .ok()
        .flatten()
        .map(|monitor| {
            let scale = monitor.scale_factor();
            let margin = 20.0 * scale;
            let (mx, my) = (monitor.position().x as f64, monitor.position().y as f64);
            (
                (mx + monitor.size().width as f64 - w * scale - margin).max(mx),
                (my + margin)
                    .min(my + monitor.size().height as f64 - h * scale)
                    .max(my),
            )
        })
        .unwrap_or((20.0, 20.0));
    let _ = win.set_position(tauri::PhysicalPosition::new(x, y));
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn weekly_option_only_changes_the_pill_width() {
        assert_eq!(size_for("mini", false, false), (71.0, 32.0));
        assert_eq!(size_for("mini", true, false), (71.0, 32.0));
        assert_eq!(size_for("mini", false, true), (136.0, 32.0));
        assert_eq!(size_for("mini", true, true), (136.0, 32.0));
        for show_weekly in [false, true] {
            assert_eq!(size_for("classic", false, show_weekly), COMPACT);
            assert_eq!(size_for("classic", true, show_weekly), EXPANDED);
        }
    }
}
