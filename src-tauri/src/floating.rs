//! Floating always-on-top widget, ported from `floatingWindow.js`. Two layouts
//! (classic / mini) with fixed sizes; acrylic background via `window-vibrancy`
//! on Windows. Position is persisted to `floating.x/y`.

use tauri::{AppHandle, Emitter, Manager, WebviewUrl, WebviewWindowBuilder};

use siphon_core::state::AppState;

const MINI: (f64, f64) = (71.0, 32.0);
const COMPACT: (f64, f64) = (220.0, 104.0);
const EXPANDED: (f64, f64) = (220.0, 192.0);

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

    // Persist position on move (debounced by the OS event cadence).
    let handle = app.clone();
    win.on_window_event(move |event| {
        if let tauri::WindowEvent::Moved(pos) = event {
            if let Some(ctx) = handle.try_state::<crate::AppContext>() {
                let _ = ctx.prefs.set_many(vec![
                    ("floating.x".into(), pos.x.into()),
                    ("floating.y".into(), pos.y.into()),
                ]);
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
    match (state.preferences.floating.x, state.preferences.floating.y) {
        (Some(x), Some(y)) => {
            let _ = win.set_position(tauri::LogicalPosition::new(x as f64, y as f64));
        }
        _ => {
            // Default to the top-right of the primary monitor.
            if let Ok(Some(monitor)) = app.primary_monitor() {
                let area = monitor.size();
                let scale = monitor.scale_factor();
                let (w, _) = size_for(
                    &state.preferences.floating.style,
                    state.preferences.floating.expanded,
                );
                let x = (area.width as f64 / scale) - w - 20.0;
                let _ = win.set_position(tauri::LogicalPosition::new(x.max(0.0), 20.0));
            }
        }
    }
}
