//! Tray icon + menu, ported from `trayIcon.js` and the `updateTray` logic in
//! `main.js`. The 16 colour-channel PNGs (session level × weekly level) are
//! embedded at compile time; the tooltip + status rows come from
//! `siphon_core::tray_status`.

use tauri::image::Image;
use tauri::menu::{Menu, MenuItem, PredefinedMenuItem};
use tauri::tray::{TrayIcon, TrayIconBuilder};
use tauri::{AppHandle, Manager};

use siphon_core::format::level_for_percent;
use siphon_core::state::AppState;
use siphon_core::tray_status::build_tray_status;

/// Embedded tray PNG for a (session, weekly) level pair. Levels are one of
/// `ok`/`warn`/`high`/`critical` (from `level_for_percent`).
fn icon_bytes(session: &str, weekly: &str) -> &'static [u8] {
    macro_rules! pick {
        ($($s:literal, $w:literal);+ $(;)?) => {
            match (session, weekly) {
                $(($s, $w) => include_bytes!(concat!("../../assets/tray-icon/tray-", $s, "-", $w, ".png")),)+
                _ => include_bytes!("../../assets/tray-icon/tray-ok-ok.png"),
            }
        };
    }
    pick!(
        "ok","ok"; "ok","warn"; "ok","high"; "ok","critical";
        "warn","ok"; "warn","warn"; "warn","high"; "warn","critical";
        "high","ok"; "high","warn"; "high","high"; "high","critical";
        "critical","ok"; "critical","warn"; "critical","high"; "critical","critical";
    )
}

pub fn build(app: &AppHandle, state: &AppState) -> tauri::Result<TrayIcon> {
    let menu = build_menu(app, state)?;
    let (session, weekly) = levels(state);
    let icon = Image::from_bytes(icon_bytes(session, weekly))?;
    TrayIconBuilder::with_id("main")
        .icon(icon)
        .tooltip("Siphon")
        .menu(&menu)
        .on_menu_event(on_menu_event)
        .on_tray_icon_event(|tray, event| {
            use tauri::tray::{MouseButton, MouseButtonState, TrayIconEvent};
            if let TrayIconEvent::DoubleClick {
                button: MouseButton::Left,
                button_state: MouseButtonState::Up,
                ..
            } = event
            {
                crate::windows_ctl::show_main(tray.app_handle());
            }
        })
        .build(app)
}

pub fn update(app: &AppHandle, state: &AppState) {
    let Some(tray) = app.tray_by_id("main") else { return };
    let (session, weekly) = levels(state);
    if let Ok(icon) = Image::from_bytes(icon_bytes(session, weekly)) {
        let _ = tray.set_icon(Some(icon));
    }
    let lang = state.preferences.language.clone();
    let status = build_tray_status(state, &lang);
    let _ = tray.set_tooltip(Some(status.tooltip));
    if let Ok(menu) = build_menu(app, state) {
        let _ = tray.set_menu(Some(menu));
    }
}

fn levels(state: &AppState) -> (&'static str, &'static str) {
    let session = level_for_percent(
        state
            .quota
            .as_ref()
            .and_then(|q| q.session.as_ref())
            .map(|s| s.percent)
            .unwrap_or(0.0),
    );
    let weekly = level_for_percent(
        state
            .quota
            .as_ref()
            .and_then(|q| q.weekly_all.as_ref())
            .map(|s| s.percent)
            .unwrap_or(0.0),
    );
    (session, weekly)
}

fn build_menu(app: &AppHandle, state: &AppState) -> tauri::Result<Menu<tauri::Wry>> {
    let lang = state.preferences.language.clone();
    let status = build_tray_status(state, &lang);
    let menu = Menu::new(app)?;
    for (i, row) in status.menu_items.iter().enumerate() {
        let item = MenuItem::with_id(app, format!("status_{i}"), row, false, None::<&str>)?;
        menu.append(&item)?;
    }
    menu.append(&PredefinedMenuItem::separator(app)?)?;
    menu.append(&MenuItem::with_id(app, "show", "Mostrar aplicativo", true, None::<&str>)?)?;
    menu.append(&MenuItem::with_id(app, "widget", "Widget flutuante", true, None::<&str>)?)?;
    menu.append(&MenuItem::with_id(app, "settings", "Configurações", true, None::<&str>)?)?;
    menu.append(&PredefinedMenuItem::separator(app)?)?;
    menu.append(&MenuItem::with_id(app, "restart", "Reiniciar", true, None::<&str>)?)?;
    menu.append(&MenuItem::with_id(app, "quit", "Sair", true, None::<&str>)?)?;
    Ok(menu)
}

fn on_menu_event(app: &AppHandle, event: tauri::menu::MenuEvent) {
    match event.id().as_ref() {
        "show" => crate::windows_ctl::show_main(app),
        "settings" => crate::windows_ctl::show_settings(app),
        "widget" => {
            let app = app.clone();
            tauri::async_runtime::spawn(async move {
                if let Some(ctx) = app.try_state::<crate::AppContext>() {
                    let enabled = ctx
                        .prefs
                        .get("floating.enabled")
                        .and_then(|v| v.as_bool())
                        .unwrap_or(false);
                    if let Ok(change) = ctx.prefs.set("floating.enabled", (!enabled).into()) {
                        crate::apply_pref_change(&app, &ctx, &change);
                    }
                }
            });
        }
        "restart" => {
            app.cleanup_before_exit();
            app.restart();
        }
        "quit" => app.exit(0),
        _ => {}
    }
}
