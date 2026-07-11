//! Port of the numeric/percentage helpers from `src/shared/format.js` that the
//! native side needs (the renderer keeps its own JS copy). Only the functions
//! used by the tray/controller are ported here: `level_for_percent`,
//! `clamp_percent`, `quota_display_value`, `format_percent`,
//! `format_quota_percent`, `format_clock_time` and `format_relative_updated`.

use chrono::{DateTime, Local, TimeZone, Utc};

/// Tray colour bucket for a utilisation percent. Matches `levelForPercent`.
pub fn level_for_percent(value: f64) -> &'static str {
    if value >= 85.0 {
        "critical"
    } else if value >= 70.0 {
        "high"
    } else if value >= 40.0 {
        "warn"
    } else {
        "ok"
    }
}

/// Clamp to 0..=100 and round to an integer. Matches `clampPercent`.
pub fn clamp_percent(value: f64) -> i64 {
    if !value.is_finite() {
        return 0;
    }
    value.round().clamp(0.0, 100.0) as i64
}

/// `used` → percent as-is; `remaining` → 100 - percent. Matches `quotaDisplayValue`.
pub fn quota_display_value(used_percent: f64, mode: &str) -> i64 {
    let used = clamp_percent(used_percent);
    if mode == "remaining" {
        100 - used
    } else {
        used
    }
}

/// `"73%"`; `"--"` for non-finite. Matches `formatPercent` (rounds).
pub fn format_percent(value: Option<f64>) -> String {
    match value {
        Some(v) if v.is_finite() => format!("{}%", v.round() as i64),
        _ => "--".to_string(),
    }
}

/// `formatQuotaPercent`: display value in the requested mode + optional suffix.
pub fn format_quota_percent(used_percent: Option<f64>, mode: &str, suffix: &str) -> String {
    let base = match used_percent {
        Some(v) if v.is_finite() => format!("{}%", quota_display_value(v, mode)),
        _ => return "--".to_string(),
    };
    if suffix.is_empty() {
        base
    } else {
        format!("{base} {suffix}")
    }
}

/// `HH:MM` in local time, `--:--` when absent. Matches `formatClockTime`.
pub fn format_clock_time(date: Option<DateTime<Utc>>) -> String {
    match date {
        Some(d) => {
            let local = d.with_timezone(&Local);
            local.format("%H:%M").to_string()
        }
        None => "--:--".to_string(),
    }
}

/// `formatRelativeUpdated` — "updated 12s ago" etc., in `en` or `pt-BR`.
pub fn format_relative_updated(
    date: Option<DateTime<Utc>>,
    now: DateTime<Utc>,
    lang: &str,
) -> String {
    let pt = lang == "pt-BR";
    let never = if pt {
        "nunca atualizado"
    } else {
        "never updated"
    };
    let just_now = if pt {
        "atualizado agora mesmo"
    } else {
        "updated just now"
    };

    let target = match date {
        Some(d) => d,
        None => return never.to_string(),
    };
    let diff_ms = now.signed_duration_since(target).num_milliseconds();
    if diff_ms < 0 {
        return just_now.to_string();
    }
    let seconds = (diff_ms as f64 / 1000.0).round() as i64;
    if seconds < 10 {
        return just_now.to_string();
    }
    if seconds < 60 {
        return if pt {
            format!("atualizado há {seconds}s")
        } else {
            format!("updated {seconds}s ago")
        };
    }
    let minutes = (seconds as f64 / 60.0).round() as i64;
    if minutes < 60 {
        return if pt {
            format!("atualizado há {minutes}min")
        } else {
            format!("updated {minutes}min ago")
        };
    }
    let hours = (minutes as f64 / 60.0).round() as i64;
    if hours < 24 {
        return if pt {
            format!("atualizado há {hours}h")
        } else {
            format!("updated {hours}h ago")
        };
    }
    let days = (hours as f64 / 24.0).round() as i64;
    if pt {
        format!("atualizado há {days}d")
    } else {
        format!("updated {days}d ago")
    }
}

/// Parse an ISO-8601 string into a UTC datetime, mirroring `new Date(value)`.
pub fn parse_iso(value: &str) -> Option<DateTime<Utc>> {
    DateTime::parse_from_rfc3339(value)
        .ok()
        .map(|d| d.with_timezone(&Utc))
}

/// Local calendar-day key `YYYY-MM-DD`, matching `toLocalDateKey`.
pub fn to_local_date_key(date: DateTime<Utc>) -> String {
    date.with_timezone(&Local).format("%Y-%m-%d").to_string()
}

/// UTC hour bucket ISO string, matching `toHourKey` (truncates to the hour).
pub fn to_hour_key(date: DateTime<Utc>) -> String {
    let truncated = Utc
        .with_ymd_and_hms(
            date.format("%Y").to_string().parse().unwrap_or(1970),
            date.format("%m").to_string().parse().unwrap_or(1),
            date.format("%d").to_string().parse().unwrap_or(1),
            date.format("%H").to_string().parse().unwrap_or(0),
            0,
            0,
        )
        .single()
        .unwrap_or(date);
    // Emit with milliseconds + Z, matching `Date.toISOString()`.
    truncated.format("%Y-%m-%dT%H:%M:%S%.3fZ").to_string()
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn level_buckets() {
        assert_eq!(level_for_percent(90.0), "critical");
        assert_eq!(level_for_percent(85.0), "critical");
        assert_eq!(level_for_percent(70.0), "high");
        assert_eq!(level_for_percent(40.0), "warn");
        assert_eq!(level_for_percent(0.0), "ok");
    }

    #[test]
    fn clamp_and_display() {
        assert_eq!(clamp_percent(150.0), 100);
        assert_eq!(clamp_percent(-5.0), 0);
        assert_eq!(clamp_percent(f64::NAN), 0);
        assert_eq!(quota_display_value(30.0, "remaining"), 70);
        assert_eq!(quota_display_value(30.0, "used"), 30);
    }

    #[test]
    fn quota_percent_formatting() {
        assert_eq!(format_quota_percent(Some(30.0), "used", "used"), "30% used");
        assert_eq!(
            format_quota_percent(Some(30.0), "remaining", "left"),
            "70% left"
        );
        assert_eq!(format_quota_percent(None, "used", "used"), "--");
    }

    #[test]
    fn relative_updated_en_pt() {
        let now = Utc.with_ymd_and_hms(2026, 1, 1, 12, 0, 0).unwrap();
        let five_min_ago = now - chrono::Duration::minutes(5);
        assert_eq!(
            format_relative_updated(Some(five_min_ago), now, "en"),
            "updated 5min ago"
        );
        assert_eq!(
            format_relative_updated(Some(five_min_ago), now, "pt-BR"),
            "atualizado há 5min"
        );
        assert_eq!(format_relative_updated(None, now, "en"), "never updated");
    }
}
