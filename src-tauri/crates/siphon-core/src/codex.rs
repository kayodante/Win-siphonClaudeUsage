//! Codex quota, read from the session logs Codex itself writes. Every turn
//! appends a `token_count` event to `<codex home>/sessions/YYYY/MM/DD/
//! rollout-*.jsonl` carrying the account's current rate limits:
//!
//! ```text
//! payload.rate_limits = { limit_id: "codex",
//!   primary:   { used_percent, window_minutes: 300,   resets_at: <epoch s> },  ← 5-hour session
//!   secondary: { used_percent, window_minutes: 10080, resets_at: <epoch s> } } ← weekly
//! ```
//!
//! No credentials and no network: the numbers are as fresh as the last Codex
//! turn on this machine, and `providers::normalize_slot` rolls a window over
//! once its reset passes.

use std::path::{Path, PathBuf};
use std::time::SystemTime;

use chrono::{DateTime, Utc};
use serde_json::Value;

use crate::format::parse_iso;
use crate::json_store::home_dir;
use crate::providers::{iso, normalize_sections, ProviderQuota, ProviderStatus, QuotaSection};
use crate::quota::Slot;

/// A `token_count` line is ~1 KB, so the tail of a file holds dozens of them.
const TAIL_BYTES: u64 = 512 * 1024;
/// A brand-new session has no `token_count` yet; fall back to older files.
const MAX_FILES: usize = 5;

/// `$CODEX_HOME` when set, else `~/.codex` — the same lookup Codex does.
pub fn default_codex_home() -> PathBuf {
    std::env::var_os("CODEX_HOME")
        .filter(|v| !v.is_empty())
        .map(PathBuf::from)
        .unwrap_or_else(|| home_dir().join(".codex"))
}

/// `None` when Codex is not installed (no `sessions` directory). An installed
/// Codex with no reading yet comes back with no sections.
pub fn read_quota(codex_home: &Path, now: DateTime<Utc>) -> Option<ProviderQuota> {
    let sessions = codex_home.join("sessions");
    if !sessions.is_dir() {
        return None;
    }
    // ponytail: stats every rollout on each refresh, O(files); cache by mtime
    // like local_data if the history ever makes this slow.
    let mut files = Vec::new();
    collect_rollouts(&sessions, &mut files);
    files.sort_by_key(|(modified, _)| std::cmp::Reverse(*modified));

    let reading = files
        .into_iter()
        .take(MAX_FILES)
        .find_map(|(_, path)| latest_reading(&read_tail(&path, TAIL_BYTES).ok()?));
    let (updated_at, sections) = match reading {
        Some((updated_at, mut section)) => {
            normalize_sections(std::slice::from_mut(&mut section), now);
            (updated_at, vec![section])
        }
        None => (None, Vec::new()),
    };
    Some(ProviderQuota {
        status: ProviderStatus::Live,
        updated_at,
        sections,
    })
}

fn collect_rollouts(dir: &Path, out: &mut Vec<(SystemTime, PathBuf)>) {
    let Ok(entries) = std::fs::read_dir(dir) else {
        return;
    };
    for entry in entries.flatten() {
        // `DirEntry::file_type` does not follow symlinks, so a linked
        // directory cannot send the walk in a loop.
        let Ok(kind) = entry.file_type() else {
            continue;
        };
        let path = entry.path();
        if kind.is_dir() {
            collect_rollouts(&path, out);
            continue;
        }
        let name = entry.file_name();
        let name = name.to_string_lossy();
        if kind.is_file() && name.starts_with("rollout-") && name.ends_with(".jsonl") {
            if let Ok(modified) = entry.metadata().and_then(|m| m.modified()) {
                out.push((modified, path));
            }
        }
    }
}

/// The last `max` bytes of `path`. When that cuts into the file, the first
/// (partial) line is dropped; lossy decoding absorbs a cut multi-byte char.
fn read_tail(path: &Path, max: u64) -> std::io::Result<String> {
    use std::io::{Read, Seek, SeekFrom};
    let mut file = std::fs::File::open(path)?;
    let start = file.metadata()?.len().saturating_sub(max);
    file.seek(SeekFrom::Start(start))?;
    let mut buf = Vec::new();
    file.read_to_end(&mut buf)?;
    if start > 0 {
        let cut = buf
            .iter()
            .position(|b| *b == b'\n')
            .map_or(buf.len(), |i| i + 1);
        buf.drain(..cut);
    }
    Ok(String::from_utf8_lossy(&buf).into_owned())
}

/// The newest account-wide rate-limit reading in `text`, with its timestamp.
/// Lines that are cut off (Codex still writing), unparseable, or about a
/// model-specific limit (`limit_id` other than `codex`) are skipped.
pub fn latest_reading(text: &str) -> Option<(Option<String>, QuotaSection)> {
    text.lines().rev().find_map(|line| {
        if !line.contains("\"rate_limits\"") {
            return None;
        }
        let event: Value = serde_json::from_str(line).ok()?;
        let payload = event.get("payload")?;
        if payload.get("type").and_then(Value::as_str) != Some("token_count") {
            return None;
        }
        let limits = payload.get("rate_limits").filter(|v| v.is_object())?;
        if let Some(id) = limits.get("limit_id").and_then(Value::as_str) {
            if id != "codex" {
                return None;
            }
        }
        let session = parse_window(limits.get("primary"));
        let weekly = parse_window(limits.get("secondary"));
        if session.is_none() && weekly.is_none() {
            return None;
        }
        let updated_at = event
            .get("timestamp")
            .and_then(Value::as_str)
            .and_then(parse_iso)
            .map(iso);
        Some((
            updated_at,
            QuotaSection {
                id: "codex".to_string(),
                session,
                weekly,
            },
        ))
    })
}

fn parse_window(window: Option<&Value>) -> Option<Slot> {
    let window = window?;
    let used = window.get("used_percent")?.as_f64()?;
    let resets_at = window
        .get("resets_at")
        .and_then(Value::as_i64)
        .and_then(|secs| DateTime::from_timestamp(secs, 0))
        .map(iso);
    Some(Slot {
        percent: used.clamp(0.0, 100.0),
        resets_at,
    })
}

#[cfg(test)]
mod tests {
    use super::*;
    use chrono::TimeZone;

    /// A real `token_count` line from a Codex 0.160 rollout (token counts only,
    /// no prompt text).
    const REAL_LINE: &str = r#"{"timestamp":"2026-10-22T12:13:23.892Z","ordinal":87,"type":"event_msg","payload":{"type":"token_count","info":{"total_token_usage":{"input_tokens":602759,"cached_input_tokens":501632,"cache_write_input_tokens":0,"output_tokens":4997,"reasoning_output_tokens":2082,"total_tokens":607756},"last_token_usage":{"input_tokens":103081,"cached_input_tokens":100480,"cache_write_input_tokens":0,"output_tokens":1849,"reasoning_output_tokens":1034,"total_tokens":104930},"model_context_window":475000},"rate_limits":{"limit_id":"codex","limit_name":null,"primary":{"used_percent":67.0,"window_minutes":300,"resets_at":1792688645},"secondary":{"used_percent":54.0,"window_minutes":10080,"resets_at":1793096377},"credits":{"has_credits":false,"unlimited":false,"balance":"0"},"individual_limit":null,"spend_control_reached":null,"plan_type":null,"rate_limit_reached_type":null}}}"#;

    fn line(limit_id: &str, primary: &str, secondary: &str) -> String {
        format!(
            r#"{{"timestamp":"2026-10-22T13:00:00.000Z","type":"event_msg","payload":{{"type":"token_count","rate_limits":{{"limit_id":"{limit_id}","primary":{primary},"secondary":{secondary}}}}}}}"#
        )
    }

    #[test]
    fn parses_a_real_rollout_line() {
        let (updated_at, section) = latest_reading(REAL_LINE).unwrap();
        assert_eq!(updated_at.as_deref(), Some("2026-10-22T12:13:23.892Z"));
        let session = section.session.unwrap();
        assert_eq!(session.percent, 67.0);
        assert_eq!(
            session.resets_at.as_deref(),
            Some("2026-10-22T17:04:05.000Z")
        );
        assert_eq!(section.weekly.unwrap().percent, 54.0);
    }

    #[test]
    fn the_last_account_reading_wins_over_model_limits_and_cut_lines() {
        let older = line("codex", r#"{"used_percent":10.0}"#, "null");
        let newer = line("codex", r#"{"used_percent":20.0}"#, "null");
        let spark = line("codex-spark", r#"{"used_percent":99.0}"#, "null");
        let cut = &newer[..newer.len() / 2];
        let text = [older, newer.clone(), spark, cut.to_string()].join("\n");
        let (_, section) = latest_reading(&text).unwrap();
        assert_eq!(section.session.unwrap().percent, 20.0);
        // `secondary: null` is a plan without that window, not a parse failure.
        assert!(section.weekly.is_none());
    }

    #[test]
    fn hostile_values_are_clamped_or_dropped_without_panicking() {
        let text = line(
            "codex",
            r#"{"used_percent":250.0,"resets_at":9223372036854775807}"#,
            r#"{"used_percent":"lots"}"#,
        );
        let (_, section) = latest_reading(&text).unwrap();
        let session = section.session.unwrap();
        assert_eq!(session.percent, 100.0);
        assert_eq!(session.resets_at, None);
        assert!(section.weekly.is_none());
        assert!(latest_reading(r#"{"rate_limits":null}"#).is_none());
    }

    #[test]
    fn reads_the_newest_rollout_and_rolls_over_passed_windows() {
        let home = std::env::temp_dir().join(format!("siphon-codex-{}", std::process::id()));
        let _ = std::fs::remove_dir_all(&home);
        let now = Utc.with_ymd_and_hms(2026, 10, 22, 18, 0, 0).unwrap();
        assert!(
            read_quota(&home, now).is_none(),
            "no sessions dir: not installed"
        );

        let day = home.join("sessions").join("2026").join("10").join("22");
        std::fs::create_dir_all(&day).unwrap();
        let empty = read_quota(&home, now).unwrap();
        assert!(empty.sections.is_empty(), "installed, no reading yet");

        // REAL_LINE's session reset (17:04:05) is before `now`, its weekly is not.
        std::fs::write(day.join("rollout-a.jsonl"), format!("{REAL_LINE}\n")).unwrap();
        let quota = read_quota(&home, now).unwrap();
        let section = &quota.sections[0];
        assert_eq!(section.session.as_ref().unwrap().percent, 0.0);
        assert_eq!(section.weekly.as_ref().unwrap().percent, 54.0);
        assert_eq!(
            quota.updated_at.as_deref(),
            Some("2026-10-22T12:13:23.892Z")
        );
        std::fs::remove_dir_all(&home).unwrap();
    }

    #[test]
    fn a_tail_that_cuts_into_a_line_drops_it() {
        let path = std::env::temp_dir().join(format!("siphon-codex-tail-{}", std::process::id()));
        std::fs::write(&path, "first line é\nsecond\nthird\n").unwrap();
        assert_eq!(read_tail(&path, 13).unwrap(), "third\n");
        assert_eq!(
            read_tail(&path, 1024).unwrap(),
            "first line é\nsecond\nthird\n"
        );
        std::fs::remove_file(&path).unwrap();
    }
}
