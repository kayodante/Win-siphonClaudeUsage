//! Port of `src/shared/trayStatus.js`. Builds the tray tooltip + (disabled)
//! status menu rows from the current state. Consumes the native i18n subset.

use crate::format::{format_clock_time, format_quota_percent, format_relative_updated, parse_iso};
use crate::i18n::t;
use crate::state::AppState;
use chrono::Utc;

pub struct TrayStatus {
    pub tooltip: String,
    /// Disabled status rows to prepend to the tray menu.
    pub menu_items: Vec<String>,
}

/// Build tray tooltip + status rows. Matches `buildTrayStatus`.
pub fn build_tray_status(state: &AppState, lang: &str) -> TrayStatus {
    let now = Utc::now();
    let session = state.quota.as_ref().and_then(|q| q.session.as_ref());
    let weekly = state.quota.as_ref().and_then(|q| q.weekly_all.as_ref());
    let mode = state.preferences.display.quota_mode.as_str();
    let suffix = t(&format!("quota.suffix.{mode}"), lang);

    let session_val = match session {
        Some(s) => format_quota_percent(Some(s.percent), mode, &suffix),
        None => "--".to_string(),
    };
    let weekly_val = match weekly {
        Some(w) => format_quota_percent(Some(w.percent), mode, &suffix),
        None => "--".to_string(),
    };
    let session_reset = format_clock_time(
        session
            .and_then(|s| s.resets_at.as_deref())
            .and_then(parse_iso),
    );
    let updated =
        format_relative_updated(state.last_updated.as_deref().and_then(parse_iso), now, lang);

    let rows = [
        (t("tray.session", lang), session_val),
        (t("tray.weekly", lang), weekly_val),
        (t("tray.sessionReset", lang), session_reset),
        (t("tray.updated", lang), updated),
    ];

    let menu_items: Vec<String> = rows
        .iter()
        .map(|(label, value)| format!("{label}: {value}"))
        .collect();

    let mut tooltip_lines = vec!["Siphon".to_string()];
    tooltip_lines.extend(menu_items.iter().cloned());

    TrayStatus {
        tooltip: tooltip_lines.join("\n"),
        menu_items,
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn tooltip_has_all_rows() {
        let state = AppState::default();
        let status = build_tray_status(&state, "en");
        assert!(status.tooltip.starts_with("Siphon\n"));
        assert_eq!(status.menu_items.len(), 4);
        assert!(status.menu_items[0].starts_with("Session:"));
    }
}
