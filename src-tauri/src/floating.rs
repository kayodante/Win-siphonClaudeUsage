//! Floating always-on-top widget, ported from `floatingWindow.js`. Two layouts
//! (classic / mini) with fixed sizes; acrylic background via `window-vibrancy`
//! on Windows. Position is persisted to `floating.x/y`.

use tauri::{AppHandle, Emitter, Manager, WebviewUrl, WebviewWindowBuilder};

use siphon_core::state::AppState;

const MINI: (f64, f64) = (71.0, 32.0);
const COMPACT: (f64, f64) = (220.0, 104.0);
const EXPANDED: (f64, f64) = (220.0, 192.0);

/// Latest dragged position waiting to be persisted. `Some` also means a
/// flush task is already scheduled (trailing debounce, one write per burst).
static PENDING_POS: std::sync::Mutex<Option<(i64, i64)>> = std::sync::Mutex::new(None);
const POS_FLUSH_DELAY_MS: u64 = 500;

fn size_for(style: &str, expanded: bool) -> (f64, f64) {
    if style == "mini" {
        MINI
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
        apply_size(&win, state);
        let _ = win.emit("state-changed", state);
        let _ = win.set_always_on_top(true);
    } else {
        create(app, state);
    }
}

fn create(app: &AppHandle, state: &AppState) {
    let style = state.preferences.floating.style.clone();
    let (w, h) = size_for(&style, state.preferences.floating.expanded);
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

    restore_position(app, &win, state);

    #[cfg(windows)]
    if style != "mini" {
        use window_vibrancy::apply_acrylic;
        let _ = apply_acrylic(&win, Some((0, 0, 0, 190)));
    }

    let _ = win.show();
    let _ = win.set_always_on_top(true);
    let _ = win.emit("state-changed", state);

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
                    tokio::time::sleep(std::time::Duration::from_millis(POS_FLUSH_DELAY_MS))
                        .await;
                    let Some((x, y)) = PENDING_POS.lock().unwrap().take() else { return };
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

fn apply_size(win: &tauri::WebviewWindow, state: &AppState) {
    let (w, h) = size_for(
        &state.preferences.floating.style,
        state.preferences.floating.expanded,
    );
    let _ = win.set_size(tauri::LogicalSize::new(w, h));
}

fn restore_position(app: &AppHandle, win: &tauri::WebviewWindow, state: &AppState) {
    // Physical pixels throughout, matching what the move handler saved — see
    // `windows_ctl::monitor_rects` for why logical coordinates cannot be
    // compared across monitors.
    let (w, h) = win.outer_size().map(|s| (s.width as f64, s.height as f64)).unwrap_or_else(|_| {
        size_for(
            &state.preferences.floating.style,
            state.preferences.floating.expanded,
        )
    });

    // Default top-right anchor on the primary monitor, inset by a 20px margin
    // scaled to that monitor's DPI.
    let (mut default_x, mut default_y) = (20.0_f64, 20.0_f64);
    if let Ok(Some(monitor)) = app.primary_monitor() {
        let margin = 20.0 * monitor.scale_factor();
        let (mx, my) = (monitor.position().x as f64, monitor.position().y as f64);
        default_x = (mx + monitor.size().width as f64 - w - margin).max(mx);
        default_y = my + margin;
    }

    // Saved position, else the default anchor.
    let (mut x, mut y) = match (state.preferences.floating.x, state.preferences.floating.y) {
        (Some(sx), Some(sy)) => (sx as f64, sy as f64),
        _ => (default_x, default_y),
    };

    // Clamp: if the saved position lands (mostly) off every connected monitor,
    // fall back to the default anchor. Self-heals stale/corrupt coordinates,
    // while keeping a widget parked on a secondary display where it was.
    if !siphon_core::geometry::position_is_visible(
        &crate::windows_ctl::monitor_rects(app),
        x,
        y,
        w,
        h,
    ) {
        x = default_x;
        y = default_y;
    }

    let _ = win.set_position(tauri::PhysicalPosition::new(x, y));
}
