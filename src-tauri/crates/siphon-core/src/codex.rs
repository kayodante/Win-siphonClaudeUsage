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
//! turn on this machine. `providers::apply` keeps the newest reading across
//! attempts and marks a window rolled over once its reset passes.

use std::io::{Read, Seek, SeekFrom};
use std::ops::ControlFlow;
use std::path::{Path, PathBuf};
use std::time::SystemTime;

use chrono::{DateTime, Duration as ChronoDuration, Utc};
use serde_json::Value;

use crate::format::{parse_iso, to_local_date_key};
use crate::json_store::home_dir;
use crate::pricing::{round_cost, token_cost, Price, Tokens};
use crate::providers::{iso, Observation, ProviderStatus, ProviderWindow, QuotaSection};
use crate::state::PeriodStats;

/// Backward scan buffer size. Small enough to stay in L2 cache, large enough
/// to scan dozens of events per seek.
const CHUNK_BYTES: usize = 256 * 1024;
/// Rollout lines carrying inline base64 screenshots or tool outputs can run to
/// tens of megabytes, while `token_count`, `token_usage_record`, `turn_context`
/// and rate-limit error events are well under 64 KB. Skipping oversized lines
/// while walking backwards avoids allocating or decoding multi-megabyte lines.
const MAX_EVENT_LINE_BYTES: usize = 256 * 1024;
/// How far past a `token_count` line `read_usage` walks backwards looking for
/// a `turn_context` model name before checking the file header instead.
const MODEL_LOOKBACK_BYTES: usize = 512 * 1024;
/// Opening lines of a rollout (`session_meta` and the first `turn_context`),
/// checked when the tail had token counts without a nearby model name.
const HEAD_MODEL_BYTES: usize = 16 * 1024;
/// Files examined per quota attempt. Only files modified after the last known
/// reading are candidates, so a normal refresh reads one; the cap bounds the
/// first search on a history full of sessions that never reached Codex.
const MAX_FILES: usize = 40;
/// Directory entries stat'd before sorting by modification time. Guardian
/// auto-review subagents can create dozens of rollouts a day, while a resumed
/// thread stays in the `YYYY/MM/DD` folder of the day it was created.
const SCAN_MAX_FILES: usize = 2048;
const USAGE_LOOKBACK_DAYS: i64 = 35;
const USAGE_MAX_FILES: usize = 1024;

/// `$CODEX_HOME` when set, else `~/.codex` — falling back to the active WSL
/// distro's `~/.codex` (`\\wsl.localhost\<distro>\home\<user>\.codex`) when
/// `WSL_DISTRO_NAME` is present and the Windows home has no `sessions` dir.
pub fn default_codex_home() -> PathBuf {
    if let Some(env_home) = std::env::var_os("CODEX_HOME").filter(|v| !v.is_empty()) {
        return PathBuf::from(env_home);
    }
    let win_home = home_dir().join(".codex");
    if win_home.join("sessions").is_dir() {
        return win_home;
    }
    if let (Some(distro), Some(user)) = (
        std::env::var_os("WSL_DISTRO_NAME").filter(|v| !v.is_empty()),
        std::env::var_os("USERNAME").or_else(|| std::env::var_os("USER")),
    ) {
        let wsl_home = PathBuf::from(r"\\wsl.localhost")
            .join(distro)
            .join("home")
            .join(user)
            .join(".codex");
        if wsl_home.join("sessions").is_dir() {
            return wsl_home;
        }
    }
    win_home
}

/// What the rollouts say now. `known_at` is when the reading Siphon already
/// holds was taken: a file last modified before it cannot hold anything newer,
/// so it is not opened. The newest reading is chosen by the event's own
/// timestamp, never by which file changed last — any event (a tool output)
/// touches a file without carrying a new quota.
pub fn read_quota(codex_home: &Path, known_at: Option<DateTime<Utc>>) -> Observation {
    let sessions = codex_home.join("sessions");
    if !sessions.is_dir() {
        return Observation::NotInstalled;
    }
    let mut files = Vec::new();
    let mut failed = !collect_rollouts(&sessions, SCAN_MAX_FILES, &mut files);
    files.sort_by_key(|(modified, _)| std::cmp::Reverse(*modified));

    let mut best: Option<Reading> = None;
    let mut orphan_exceeded: Option<DateTime<Utc>> = None;
    for (modified, path) in files.into_iter().take(MAX_FILES) {
        let modified = DateTime::<Utc>::from(modified);
        let floor = if orphan_exceeded.is_some() && best.is_none() {
            None
        } else {
            best.as_ref().and_then(|(at, _)| *at).or(known_at)
        };
        if floor.is_some_and(|floor| modified < floor) {
            break; // sorted newest first: every file left is older still
        }
        match file_reading(&path) {
            Ok(FileReading::Reading(found))
                if best.as_ref().map_or(true, |b| is_later(&found, b)) =>
            {
                best = Some(found)
            }
            Ok(FileReading::Exceeded(Some(at)))
                if orphan_exceeded.map_or(true, |prev| at > prev) =>
            {
                orphan_exceeded = Some(at);
            }
            Ok(_) => {}
            Err(_) => failed = true,
        }
    }

    if let (Some((taken_at, section)), Some(exceeded)) = (&mut best, orphan_exceeded) {
        if taken_at.map_or(true, |t| exceeded >= t) {
            promote_exhausted(taken_at, section, Some(exceeded), None);
        }
    }
    if let (Some(known), Some((Some(taken), _))) = (known_at, &best) {
        if *taken <= known {
            best = None;
        }
    }

    match best {
        Some((taken_at, section)) => Observation::Reading {
            taken_at: taken_at.map(iso),
            sections: vec![section],
        },
        None if failed => Observation::NoReading(ProviderStatus::Error),
        None => Observation::NoReading(ProviderStatus::Live),
    }
}

type Reading = (Option<DateTime<Utc>>, QuotaSection);

enum FileReading {
    None,
    Exceeded(Option<DateTime<Utc>>),
    Reading(Reading),
}

/// A dated reading beats an undated one; between dated ones, the later wins.
fn is_later(found: &Reading, best: &Reading) -> bool {
    match (found.0, best.0) {
        (Some(found), Some(best)) => found > best,
        (found, best) => found.is_some() && best.is_none(),
    }
}

/// `false` when a directory could not be listed, so the caller can tell a
/// failed read from a history with nothing in it. Walks `YYYY/MM/DD` entries
/// newest-first so old months are not opened once `limit` recent rollouts are
/// found.
fn collect_rollouts(dir: &Path, limit: usize, out: &mut Vec<(SystemTime, PathBuf)>) -> bool {
    let Ok(read_dir) = std::fs::read_dir(dir) else {
        return false;
    };
    let mut entries: Vec<_> = read_dir.flatten().collect();
    entries.sort_by_key(|e| std::cmp::Reverse(e.file_name()));
    let mut complete = true;
    for entry in entries {
        // `DirEntry::file_type` does not follow symlinks, so a linked
        // directory cannot send the walk in a loop.
        let Ok(kind) = entry.file_type() else {
            continue;
        };
        let path = entry.path();
        if kind.is_dir() {
            if out.len() >= limit {
                break;
            }
            complete &= collect_rollouts(&path, limit, out);
            continue;
        }
        let name = entry.file_name();
        let name = name.to_string_lossy();
        if kind.is_file() && name.starts_with("rollout-") && name.ends_with(".jsonl") {
            match entry.metadata().and_then(|m| m.modified()) {
                Ok(modified) => out.push((modified, path)),
                Err(_) => complete = false,
            }
        }
    }
    complete
}

/// Scans `path` backwards in `CHUNK_BYTES` blocks, stitching lines across
/// chunk boundaries and skipping lines over `MAX_EVENT_LINE_BYTES` (such as
/// inline base64 screenshots or large tool outputs) without allocating them.
fn scan_lines_rev(
    path: &Path,
    mut visit: impl FnMut(&str) -> ControlFlow<()>,
) -> std::io::Result<()> {
    let mut file = std::fs::File::open(path)?;
    let mut pos = file.metadata()?.len();
    let mut buf = vec![0u8; CHUNK_BYTES];
    let mut carry: Vec<u8> = Vec::new();
    let mut carry_overflow = false;
    let mut scratch: Vec<u8> = Vec::new();

    let mut emit = |bytes: &[u8]| -> ControlFlow<()> {
        let bytes = bytes.strip_suffix(b"\r").unwrap_or(bytes);
        if bytes.is_empty() || bytes.len() > MAX_EVENT_LINE_BYTES {
            return ControlFlow::Continue(());
        }
        let line = String::from_utf8_lossy(bytes);
        visit(&line)
    };

    while pos > 0 {
        let read_len = (pos.min(CHUNK_BYTES as u64)) as usize;
        pos -= read_len as u64;
        file.seek(SeekFrom::Start(pos))?;
        file.read_exact(&mut buf[..read_len])?;
        let chunk = &buf[..read_len];

        if let Some(last_nl) = chunk.iter().rposition(|&b| b == b'\n') {
            let first_nl = chunk[..=last_nl]
                .iter()
                .position(|&b| b == b'\n')
                .unwrap_or(last_nl);
            let after_last = &chunk[last_nl + 1..];
            if !carry_overflow && after_last.len() + carry.len() <= MAX_EVENT_LINE_BYTES {
                let res = if carry.is_empty() {
                    emit(after_last)
                } else {
                    scratch.clear();
                    scratch.extend_from_slice(after_last);
                    scratch.extend_from_slice(&carry);
                    emit(&scratch)
                };
                if res.is_break() {
                    return Ok(());
                }
            }
            carry.clear();
            carry_overflow = false;

            if first_nl < last_nl {
                for line in chunk[first_nl + 1..last_nl].split(|&b| b == b'\n').rev() {
                    if emit(line).is_break() {
                        return Ok(());
                    }
                }
            }

            let before_first = &chunk[..first_nl];
            if pos == 0 {
                if emit(before_first).is_break() {
                    return Ok(());
                }
            } else if before_first.len() > MAX_EVENT_LINE_BYTES {
                carry_overflow = true;
            } else {
                carry.extend_from_slice(before_first);
            }
        } else if pos == 0 {
            if !carry_overflow && chunk.len() + carry.len() <= MAX_EVENT_LINE_BYTES {
                let res = if carry.is_empty() {
                    emit(chunk)
                } else {
                    scratch.clear();
                    scratch.extend_from_slice(chunk);
                    scratch.extend_from_slice(&carry);
                    emit(&scratch)
                };
                if res.is_break() {
                    return Ok(());
                }
            }
        } else if carry_overflow || chunk.len() + carry.len() > MAX_EVENT_LINE_BYTES {
            carry.clear();
            carry_overflow = true;
        } else {
            scratch.clear();
            scratch.extend_from_slice(chunk);
            scratch.extend_from_slice(&carry);
            std::mem::swap(&mut carry, &mut scratch);
        }
    }
    Ok(())
}

/// The file's newest reading (or rate-limit exhaustion signal) scanned
/// backwards from the end of the file, past any multi-megabyte tool or image
/// lines.
fn file_reading(path: &Path) -> std::io::Result<FileReading> {
    let mut scan = ReadingScan::default();
    scan_lines_rev(path, |line| scan.feed(line))?;
    Ok(scan.finish())
}

/// The newest account-wide rate-limit reading in `text`, with its timestamp.
/// Lines that are cut off (Codex still writing), unparseable, or about a
/// model-specific limit (`limit_id` other than `codex`) are skipped. When a
/// turn hits the quota wall (`codex_error_info: "usage_limit_exceeded"`),
/// Codex logs `limit_id: "premium"` with `primary: null` after the last 99%
/// reading; scanning backwards pairs that error with the active window and
/// promotes it to 100%.
pub fn latest_reading(text: &str) -> Option<Reading> {
    let mut scan = ReadingScan::default();
    for line in text.lines().rev() {
        if scan.feed(line).is_break() {
            break;
        }
    }
    match scan.finish() {
        FileReading::Reading(reading) => Some(reading),
        _ => None,
    }
}

#[derive(Default)]
struct ReadingScan {
    exceeded_at: Option<DateTime<Utc>>,
    saw_exceeded: bool,
    reading: Option<Reading>,
}

impl ReadingScan {
    fn feed(&mut self, line: &str) -> ControlFlow<()> {
        if !self.saw_exceeded && line.contains("\"usage_limit_exceeded\"") {
            if let Some(ts) = parse_limit_exceeded_line(line) {
                self.saw_exceeded = true;
                self.exceeded_at = ts;
                return ControlFlow::Continue(());
            }
        }
        if !line.contains("\"rate_limits\"") {
            return ControlFlow::Continue(());
        }
        let Some((mut taken_at, mut section, reached_hint)) = parse_rate_limits_line(line) else {
            return ControlFlow::Continue(());
        };
        if self.saw_exceeded || reached_hint.is_some() {
            promote_exhausted(&mut taken_at, &mut section, self.exceeded_at, reached_hint);
        }
        self.reading = Some((taken_at, section));
        ControlFlow::Break(())
    }

    fn finish(self) -> FileReading {
        if let Some(reading) = self.reading {
            FileReading::Reading(reading)
        } else if self.saw_exceeded {
            FileReading::Exceeded(self.exceeded_at)
        } else {
            FileReading::None
        }
    }
}

fn parse_limit_exceeded_line(line: &str) -> Option<Option<DateTime<Utc>>> {
    let event: Value = serde_json::from_str(line).ok()?;
    let payload = event.get("payload")?;
    let info = payload
        .get("codex_error_info")
        .or_else(|| payload.pointer("/error/codex_error_info"))
        .and_then(Value::as_str)?;
    if info != "usage_limit_exceeded" {
        return None;
    }
    let ts = event
        .get("timestamp")
        .and_then(Value::as_str)
        .and_then(parse_iso);
    Some(ts)
}

fn parse_rate_limits_line(
    line: &str,
) -> Option<(Option<DateTime<Utc>>, QuotaSection, Option<Kind>)> {
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
    let mut section = QuotaSection {
        id: "codex".to_string(),
        session: None,
        weekly: None,
        blocked: false,
    };
    for (key, by_position) in [("primary", Kind::Session), ("secondary", Kind::Weekly)] {
        let Some(raw) = limits.get(key) else {
            continue;
        };
        let (Some(kind), Some(window)) = (window_kind(raw, by_position), parse_window(raw)) else {
            continue;
        };
        let target = match kind {
            Kind::Session => &mut section.session,
            Kind::Weekly => &mut section.weekly,
        };
        target.get_or_insert(window);
    }
    if section.session.is_none() && section.weekly.is_none() {
        return None;
    }
    let reached_hint = limits
        .get("rate_limit_reached_type")
        .and_then(Value::as_str)
        .map(|s| {
            let lower = s.to_ascii_lowercase();
            if lower.contains("week") || lower.contains("secondary") {
                Kind::Weekly
            } else {
                Kind::Session
            }
        });
    let taken_at = event
        .get("timestamp")
        .and_then(Value::as_str)
        .and_then(parse_iso);
    Some((taken_at, section, reached_hint))
}

fn promote_exhausted(
    taken_at: &mut Option<DateTime<Utc>>,
    section: &mut QuotaSection,
    exceeded_at: Option<DateTime<Utc>>,
    reached_hint: Option<Kind>,
) {
    let target_kind = match reached_hint {
        Some(kind) => kind,
        None => match (&section.session, &section.weekly) {
            (Some(s), Some(w))
                if w.percent.unwrap_or(0.0) >= 99.0 && s.percent.unwrap_or(0.0) < 90.0 =>
            {
                Kind::Weekly
            }
            (Some(_), _) => Kind::Session,
            (None, Some(_)) => Kind::Weekly,
            (None, None) => return,
        },
    };
    let target = match target_kind {
        Kind::Session => section.session.as_mut(),
        Kind::Weekly => section.weekly.as_mut(),
    };
    let Some(window) = target else {
        return;
    };
    if let (Some(exceeded), Some(resets)) =
        (exceeded_at, window.resets_at.as_deref().and_then(parse_iso))
    {
        if resets <= exceeded {
            return;
        }
    }
    window.percent = Some(100.0);
    if let Some(exceeded) = exceeded_at {
        if taken_at.map_or(true, |t| exceeded > t) {
            *taken_at = Some(exceeded);
        }
    }
}

#[derive(Clone, Copy)]
enum Kind {
    Session,
    Weekly,
}

/// Which of Siphon's windows a Codex window is. Its length is what it means;
/// `primary` / `secondary` only decide when the length is missing, the way
/// Codex has always used them. A length Siphon has no window for (not 5 hours,
/// not 7 days) is left out rather than shown under the wrong name.
fn window_kind(raw: &Value, by_position: Kind) -> Option<Kind> {
    match raw.get("window_minutes") {
        None | Some(Value::Null) => Some(by_position),
        Some(minutes) => match minutes.as_i64()? {
            300 => Some(Kind::Session),
            10080 => Some(Kind::Weekly),
            _ => None,
        },
    }
}

fn parse_window(window: &Value) -> Option<ProviderWindow> {
    let used = window.get("used_percent")?.as_f64()?;
    let resets_at = window
        .get("resets_at")
        .and_then(Value::as_i64)
        .and_then(|secs| DateTime::from_timestamp(secs, 0))
        .map(iso);
    Some(ProviderWindow::measured(used.clamp(0.0, 100.0), resets_at))
}

#[derive(Debug, Clone)]
struct SessionUsage {
    taken_at: Option<DateTime<Utc>>,
    input_tokens: u64,
    cached_input_tokens: u64,
    cache_write_tokens: u64,
    output_tokens: u64,
    total_tokens: u64,
    model: String,
}

/// Aggregate Today and This Month token usage and estimated USD cost across
/// Codex rollouts in `<codex_home>/sessions`. Each rollout's last
/// `token_count` or `token_usage_record` event holds that session's cumulative
/// token usage, so scanning backwards from the end of each recent file sums
/// the month without loading full multi-megabyte transcripts into memory.
pub fn read_usage(codex_home: &Path, now: DateTime<Utc>) -> (PeriodStats, PeriodStats) {
    let mut today = PeriodStats::default();
    let mut month = PeriodStats::default();
    let sessions = codex_home.join("sessions");
    if !sessions.is_dir() {
        return (today, month);
    }
    let today_key = to_local_date_key(now);
    let month_prefix = &today_key[..7];
    let cutoff = now - ChronoDuration::days(USAGE_LOOKBACK_DAYS);

    let mut files = Vec::new();
    let _ = collect_rollouts(&sessions, SCAN_MAX_FILES, &mut files);
    files.sort_by_key(|(modified, _)| std::cmp::Reverse(*modified));

    for (modified, path) in files.into_iter().take(USAGE_MAX_FILES) {
        let modified_utc = DateTime::<Utc>::from(modified);
        if modified_utc < cutoff {
            break;
        }
        let Some(usage) = file_session_usage(&path) else {
            continue;
        };
        let when = usage.taken_at.unwrap_or(modified_utc);
        let day_key = to_local_date_key(when);
        if !day_key.starts_with(month_prefix) {
            continue;
        }
        let uncached_input = usage.input_tokens.saturating_sub(usage.cached_input_tokens);
        let cost = token_cost(
            Tokens {
                input: uncached_input as f64,
                output: usage.output_tokens as f64,
                cache_read: usage.cached_input_tokens as f64,
                cache_write: usage.cache_write_tokens as f64,
            },
            codex_price(&usage.model),
        );
        add_usage(&mut month, &usage, uncached_input, cost);
        if day_key == today_key {
            add_usage(&mut today, &usage, uncached_input, cost);
        }
    }
    today.cost = round_cost(today.cost);
    month.cost = round_cost(month.cost);
    (today, month)
}

fn add_usage(target: &mut PeriodStats, u: &SessionUsage, uncached_input: u64, cost: f64) {
    target.input_tokens += uncached_input;
    target.output_tokens += u.output_tokens;
    target.cache_read_tokens += u.cached_input_tokens;
    target.cache_write_tokens += u.cache_write_tokens;
    target.total_tokens += u.total_tokens;
    target.cost += cost;
    if u.total_tokens > 0 || cost > 0.0 {
        target.is_empty = false;
    }
}

fn file_session_usage(path: &Path) -> Option<SessionUsage> {
    let mut scan = UsageScan::default();
    scan_lines_rev(path, |line| scan.feed(line)).ok()?;
    if scan.usage.is_some() && scan.model.is_none() {
        scan.model = read_head_model(path);
    }
    scan.finish()
}

#[derive(Default)]
struct UsageScan {
    usage: Option<SessionUsage>,
    model: Option<String>,
    bytes_since_usage: usize,
}

impl UsageScan {
    fn feed(&mut self, line: &str) -> ControlFlow<()> {
        if self.model.is_none() && line.contains("\"model") {
            if let Some(m) = parse_model_line(line) {
                self.model = Some(m);
            }
        }
        if self.usage.is_none()
            && (line.contains("\"total_token_usage\"") || line.contains("\"thread_token_usage\""))
        {
            if let Some((usage, inline_model)) = parse_usage_line(line) {
                if self.model.is_none() {
                    self.model = inline_model;
                }
                self.usage = Some(usage);
            }
        }
        if self.usage.is_some() {
            if self.model.is_some() {
                return ControlFlow::Break(());
            }
            self.bytes_since_usage += line.len();
            if self.bytes_since_usage >= MODEL_LOOKBACK_BYTES {
                return ControlFlow::Break(());
            }
        }
        ControlFlow::Continue(())
    }

    fn finish(self) -> Option<SessionUsage> {
        let mut usage = self.usage?;
        usage.model = self.model.unwrap_or_else(|| "gpt-5-codex".to_string());
        Some(usage)
    }
}

fn parse_model_line(line: &str) -> Option<String> {
    let event: Value = serde_json::from_str(line).ok()?;
    event
        .pointer("/payload/model_name")
        .or_else(|| event.pointer("/payload/model"))
        .or_else(|| event.get("model"))
        .and_then(Value::as_str)
        .filter(|s| !s.is_empty())
        .map(str::to_string)
}

fn parse_usage_line(line: &str) -> Option<(SessionUsage, Option<String>)> {
    let event: Value = serde_json::from_str(line).ok()?;
    let payload = event.get("payload")?;
    let (total, inline_model) = match payload.get("type").and_then(Value::as_str) {
        Some("token_count") => (payload.pointer("/info/total_token_usage")?, None),
        Some("token_usage_record") => (
            payload.get("thread_token_usage")?,
            payload
                .get("model_name")
                .and_then(Value::as_str)
                .filter(|s| !s.is_empty())
                .map(str::to_string),
        ),
        _ => return None,
    };
    let num = |k: &str| total.get(k).and_then(Value::as_u64).unwrap_or(0);
    let input_tokens = num("input_tokens");
    let cached_input_tokens = num("cached_input_tokens");
    let cache_write_tokens = num("cache_write_input_tokens");
    let output_tokens = num("output_tokens");
    let total_tokens = total
        .get("total_tokens")
        .and_then(Value::as_u64)
        .unwrap_or(input_tokens + output_tokens);
    if total_tokens == 0 && input_tokens == 0 && output_tokens == 0 {
        return None;
    }
    let taken_at = event
        .get("timestamp")
        .and_then(Value::as_str)
        .and_then(parse_iso);
    Some((
        SessionUsage {
            taken_at,
            input_tokens,
            cached_input_tokens,
            cache_write_tokens,
            output_tokens,
            total_tokens,
            model: String::new(),
        },
        inline_model,
    ))
}

fn read_head_model(path: &Path) -> Option<String> {
    let mut file = std::fs::File::open(path).ok()?;
    let len = file.metadata().ok()?.len().min(HEAD_MODEL_BYTES as u64) as usize;
    let mut buf = vec![0u8; len];
    file.read_exact(&mut buf).ok()?;
    let text = String::from_utf8_lossy(&buf);
    text.lines().find_map(|line| {
        if !line.contains("\"model") {
            return None;
        }
        parse_model_line(line)
    })
}

fn codex_price(model: &str) -> Price {
    let lower = model.to_ascii_lowercase();
    if lower.contains("-pro") || lower == "o3-pro" {
        Price {
            input: 15.0,
            output: 60.0,
            cache_read: 1.50,
            cache_write: 15.0,
        }
    } else if lower.contains("o4-mini") || lower.contains("4.1-mini") || lower.contains("4-1-mini")
    {
        Price {
            input: 0.40,
            output: 1.60,
            cache_read: 0.10,
            cache_write: 0.40,
        }
    } else if lower.contains("mini") {
        Price {
            input: 0.25,
            output: 2.00,
            cache_read: 0.025,
            cache_write: 0.25,
        }
    } else if lower == "o3"
        || lower.starts_with("o3-")
        || lower.contains("4.1")
        || lower.contains("4-1")
    {
        Price {
            input: 2.00,
            output: 8.00,
            cache_read: 0.50,
            cache_write: 2.00,
        }
    } else {
        Price {
            input: 1.25,
            output: 10.0,
            cache_read: 0.125,
            cache_write: 1.25,
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use chrono::TimeZone;
    use std::time::Duration;

    /// A real `token_count` line from a Codex 0.160 rollout (token counts only,
    /// no prompt text).
    const REAL_LINE: &str = r#"{"timestamp":"2026-10-22T12:13:23.892Z","ordinal":87,"type":"event_msg","payload":{"type":"token_count","info":{"total_token_usage":{"input_tokens":602759,"cached_input_tokens":501632,"cache_write_input_tokens":0,"output_tokens":4997,"reasoning_output_tokens":2082,"total_tokens":607756},"last_token_usage":{"input_tokens":103081,"cached_input_tokens":100480,"cache_write_input_tokens":0,"output_tokens":1849,"reasoning_output_tokens":1034,"total_tokens":104930},"model_context_window":475000},"rate_limits":{"limit_id":"codex","limit_name":null,"primary":{"used_percent":67.0,"window_minutes":300,"resets_at":1792688645},"secondary":{"used_percent":54.0,"window_minutes":10080,"resets_at":1793096377},"credits":{"has_credits":false,"unlimited":false,"balance":"0"},"individual_limit":null,"spend_control_reached":null,"plan_type":null,"rate_limit_reached_type":null}}}"#;

    fn line_at(timestamp: &str, primary: &str, secondary: &str) -> String {
        format!(
            r#"{{"timestamp":"{timestamp}","type":"event_msg","payload":{{"type":"token_count","rate_limits":{{"limit_id":"codex","primary":{primary},"secondary":{secondary}}}}}}}"#
        )
    }

    fn line(limit_id: &str, primary: &str, secondary: &str) -> String {
        line_at("2026-10-22T13:00:00.000Z", primary, secondary).replace(
            r#""limit_id":"codex""#,
            &format!(r#""limit_id":"{limit_id}""#),
        )
    }

    fn session_of(reading: &Observation) -> Option<f64> {
        match reading {
            Observation::Reading { sections, .. } => sections[0].session.as_ref()?.percent,
            _ => None,
        }
    }

    /// A scratch `CODEX_HOME` with one day directory, removed on drop.
    struct Home(PathBuf);

    impl Home {
        fn new(name: &str) -> Self {
            let home =
                std::env::temp_dir().join(format!("siphon-codex-{name}-{}", std::process::id()));
            let _ = std::fs::remove_dir_all(&home);
            std::fs::create_dir_all(home.join("sessions/2026/10/22")).unwrap();
            Home(home)
        }

        /// Write a rollout and pin its mtime to `minutes` past 12:00 UTC.
        fn rollout(&self, name: &str, text: &str, minutes: u64) {
            let path = self
                .0
                .join("sessions/2026/10/22")
                .join(format!("rollout-{name}.jsonl"));
            std::fs::write(&path, text).unwrap();
            let noon = SystemTime::from(Utc.with_ymd_and_hms(2026, 10, 22, 12, 0, 0).unwrap());
            std::fs::File::options()
                .write(true)
                .open(&path)
                .unwrap()
                .set_modified(noon + Duration::from_secs(minutes * 60))
                .unwrap();
        }
    }

    impl Drop for Home {
        fn drop(&mut self) {
            let _ = std::fs::remove_dir_all(&self.0);
        }
    }

    fn pct(percent: f64) -> String {
        format!(r#"{{"used_percent":{percent},"window_minutes":300}}"#)
    }

    #[test]
    fn parses_a_real_rollout_line() {
        let (taken_at, section) = latest_reading(REAL_LINE).unwrap();
        assert_eq!(
            taken_at.map(iso).as_deref(),
            Some("2026-10-22T12:13:23.892Z")
        );
        let session = section.session.unwrap();
        assert_eq!(session.percent, Some(67.0));
        assert_eq!(
            session.resets_at.as_deref(),
            Some("2026-10-22T17:04:05.000Z")
        );
        assert_eq!(section.weekly.unwrap().percent, Some(54.0));
    }

    #[test]
    fn the_last_account_reading_wins_over_model_limits_and_cut_lines() {
        let older = line("codex", r#"{"used_percent":10.0}"#, "null");
        let newer = line("codex", r#"{"used_percent":20.0}"#, "null");
        let spark = line("codex-spark", r#"{"used_percent":99.0}"#, "null");
        let cut = &newer[..newer.len() / 2];
        let text = [older, newer.clone(), spark, cut.to_string()].join("\n");
        let (_, section) = latest_reading(&text).unwrap();
        assert_eq!(section.session.unwrap().percent, Some(20.0));
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
        assert_eq!(session.percent, Some(100.0));
        assert_eq!(session.resets_at, None);
        assert!(section.weekly.is_none());
        assert!(latest_reading(r#"{"rate_limits":null}"#).is_none());
    }

    #[test]
    fn windows_are_named_by_their_length() {
        let weekly_only = line(
            "codex",
            r#"{"used_percent":30.0,"window_minutes":10080}"#,
            "null",
        );
        let (_, section) = latest_reading(&weekly_only).unwrap();
        assert!(
            section.session.is_none(),
            "a 7-day primary is not a session"
        );
        assert_eq!(section.weekly.unwrap().percent, Some(30.0));

        let swapped = line(
            "codex",
            r#"{"used_percent":40.0,"window_minutes":10080}"#,
            r#"{"used_percent":50.0,"window_minutes":300}"#,
        );
        let (_, section) = latest_reading(&swapped).unwrap();
        assert_eq!(section.session.unwrap().percent, Some(50.0));
        assert_eq!(section.weekly.unwrap().percent, Some(40.0));

        let unknown = line(
            "codex",
            r#"{"used_percent":40.0,"window_minutes":60}"#,
            r#"{"used_percent":50.0,"window_minutes":10080}"#,
        );
        let (_, section) = latest_reading(&unknown).unwrap();
        assert!(
            section.session.is_none(),
            "an hour is no window Siphon shows"
        );
        assert_eq!(section.weekly.unwrap().percent, Some(50.0));
        let only_unknown = line(
            "codex",
            r#"{"used_percent":40.0,"window_minutes":60}"#,
            "null",
        );
        assert!(latest_reading(&only_unknown).is_none());

        // No length: the position decides, as before.
        let unlabeled = line(
            "codex",
            r#"{"used_percent":1.0}"#,
            r#"{"used_percent":2.0}"#,
        );
        let (_, section) = latest_reading(&unlabeled).unwrap();
        assert_eq!(section.session.unwrap().percent, Some(1.0));
        assert_eq!(section.weekly.unwrap().percent, Some(2.0));
    }

    #[test]
    fn not_installed_empty_and_a_real_reading() {
        let missing =
            std::env::temp_dir().join(format!("siphon-codex-none-{}", std::process::id()));
        assert_eq!(read_quota(&missing, None), Observation::NotInstalled);

        let home = Home::new("basic");
        assert_eq!(
            read_quota(&home.0, None),
            Observation::NoReading(ProviderStatus::Live),
            "installed, no reading yet"
        );
        home.rollout("a", &format!("{REAL_LINE}\n"), 30);
        let Observation::Reading { taken_at, sections } = read_quota(&home.0, None) else {
            panic!("expected a reading");
        };
        assert_eq!(taken_at.as_deref(), Some("2026-10-22T12:13:23.892Z"));
        assert_eq!(sections[0].session.as_ref().unwrap().percent, Some(67.0));
    }

    #[test]
    fn the_event_time_picks_the_reading_not_the_file_time() {
        let home = Home::new("order");
        // A holds the 12:00 reading but was touched last (a tool output at
        // 12:06 with no quota); B holds the 12:05 reading.
        let a = [
            line_at("2026-10-22T12:00:00.000Z", &pct(40.0), "null"),
            r#"{"timestamp":"2026-10-22T12:06:00.000Z","type":"response_item"}"#.to_string(),
        ]
        .join("\n");
        home.rollout("a", &a, 6);
        home.rollout(
            "b",
            &line_at("2026-10-22T12:05:00.000Z", &pct(60.0), "null"),
            5,
        );
        assert_eq!(session_of(&read_quota(&home.0, None)), Some(60.0));
    }

    #[test]
    fn files_older_than_the_known_reading_are_not_opened() {
        let home = Home::new("known");
        home.rollout(
            "old",
            &line_at("2026-10-22T12:01:00.000Z", &pct(90.0), "null"),
            1,
        );
        let known = Utc.with_ymd_and_hms(2026, 10, 22, 12, 5, 0).unwrap();
        assert_eq!(
            read_quota(&home.0, Some(known)),
            Observation::NoReading(ProviderStatus::Live)
        );
    }

    #[test]
    fn a_reading_behind_many_empty_sessions_is_still_found() {
        let home = Home::new("deep");
        home.rollout(
            "first",
            &line_at("2026-10-22T12:00:00.000Z", &pct(25.0), "null"),
            0,
        );
        for i in 1..=8 {
            home.rollout(&format!("empty-{i}"), r#"{"type":"session_meta"}"#, i);
        }
        assert_eq!(session_of(&read_quota(&home.0, None)), Some(25.0));
    }

    #[test]
    fn a_long_output_after_the_last_reading_does_not_hide_it() {
        let home = Home::new("long");
        // Multiple multi-megabyte tool output lines (> 5 MB total, exceeding
        // the old 512 KB and 4 MB fixed tail windows).
        let huge_image = format!(
            r#"{{"type":"response_item","output":"{}"}}"#,
            "A".repeat(2_800_000)
        );
        let text = [
            line_at("2026-10-22T12:00:00.000Z", &pct(33.0), "null"),
            huge_image.clone(),
            huge_image,
        ]
        .join("\n");
        home.rollout("a", &text, 1);
        assert_eq!(session_of(&read_quota(&home.0, None)), Some(33.0));
    }

    #[test]
    fn scan_lines_rev_stitches_chunk_boundaries_and_skips_oversized_lines() {
        let path = std::env::temp_dir().join(format!("siphon-codex-scan-{}", std::process::id()));
        let mut lines_written = Vec::new();
        for i in 0..4000 {
            lines_written.push(format!("line-{i}-é-{}", "x".repeat(120)));
        }
        let oversized = format!("oversized-{}", "Z".repeat(MAX_EVENT_LINE_BYTES + 50_000));
        let mut file_text = lines_written[..2000].join("\n");
        file_text.push('\n');
        file_text.push_str(&oversized);
        file_text.push('\n');
        file_text.push_str(&lines_written[2000..].join("\n"));
        file_text.push('\n');
        std::fs::write(&path, &file_text).unwrap();

        let mut collected = Vec::new();
        scan_lines_rev(&path, |line| {
            collected.push(line.to_string());
            ControlFlow::Continue(())
        })
        .unwrap();
        std::fs::remove_file(&path).unwrap();

        assert_eq!(collected.len(), lines_written.len());
        for (got, expected) in collected.iter().zip(lines_written.iter().rev()) {
            assert_eq!(got, expected);
        }
    }

    #[test]
    fn usage_limit_exceeded_promotes_the_active_window_to_100_percent() {
        // Real Codex 0.171 sequence when hitting the 5h limit: 99% reading,
        // then `error` + `token_count` with `limit_id: "premium", primary: null`
        // + `task_complete` with `codex_error_info: "usage_limit_exceeded"`.
        let reading_99 = r#"{"timestamp":"2026-11-21T15:27:04.260Z","type":"event_msg","payload":{"type":"token_count","rate_limits":{"limit_id":"codex","primary":{"used_percent":99.0,"window_minutes":300,"resets_at":1795286116},"secondary":{"used_percent":81.0,"window_minutes":10080,"resets_at":1795716022}}}}"#;
        let err_event = r#"{"timestamp":"2026-11-21T15:27:05.691Z","type":"event_msg","payload":{"type":"error","message":"You’ve hit your usage limit.","codex_error_info":"usage_limit_exceeded"}}"#;
        let premium_null = r#"{"timestamp":"2026-11-21T15:27:05.691Z","type":"event_msg","payload":{"type":"token_count","info":null,"rate_limits":{"limit_id":"premium","primary":null,"secondary":null}}}"#;
        let task_complete = r#"{"timestamp":"2026-11-21T15:27:05.697Z","type":"event_msg","payload":{"type":"task_complete","last_agent_message":null,"error":{"message":"You’ve hit your usage limit.","codex_error_info":"usage_limit_exceeded"}}}"#;

        let text = [reading_99, err_event, premium_null, task_complete].join("\n");
        let (taken_at, section) = latest_reading(&text).unwrap();
        assert_eq!(
            taken_at.map(iso).as_deref(),
            Some("2026-11-21T15:27:05.697Z")
        );
        let session = section.session.unwrap();
        assert_eq!(session.percent, Some(100.0));
        assert_eq!(
            session.resets_at.as_deref(),
            Some("2026-11-21T18:35:16.000Z")
        );
        assert_eq!(section.weekly.unwrap().percent, Some(81.0));

        // When a newer turn succeeds after the reset, the new reading wins.
        let after_reset = r#"{"timestamp":"2026-11-21T19:11:19.222Z","type":"event_msg","payload":{"type":"token_count","rate_limits":{"limit_id":"codex","primary":{"used_percent":4.0,"window_minutes":300,"resets_at":1795306235},"secondary":{"used_percent":82.0,"window_minutes":10080,"resets_at":1795716022}}}}"#;
        let resumed = [text.as_str(), after_reset].join("\n");
        let (_, resumed_section) = latest_reading(&resumed).unwrap();
        assert_eq!(resumed_section.session.unwrap().percent, Some(4.0));
    }

    #[test]
    fn usage_limit_exceeded_in_a_new_thread_promotes_the_previous_reading() {
        let home = Home::new("cross-file-exceeded");
        let reading_99 = r#"{"timestamp":"2026-10-22T12:10:00.000Z","type":"event_msg","payload":{"type":"token_count","rate_limits":{"limit_id":"codex","primary":{"used_percent":99.0,"window_minutes":300,"resets_at":1792688645},"secondary":{"used_percent":54.0,"window_minutes":10080,"resets_at":1793096377}}}}"#;
        home.rollout("thread-a", reading_99, 10);

        let new_thread_blocked = [
            r#"{"timestamp":"2026-10-22T12:12:00.000Z","type":"event_msg","payload":{"type":"token_count","info":null,"rate_limits":{"limit_id":"premium","primary":null,"secondary":null}}}"#,
            r#"{"timestamp":"2026-10-22T12:12:01.000Z","type":"event_msg","payload":{"type":"task_complete","error":{"codex_error_info":"usage_limit_exceeded"}}}"#,
        ]
        .join("\n");
        home.rollout("thread-b", &new_thread_blocked, 12);

        let known = Utc.with_ymd_and_hms(2026, 10, 22, 12, 10, 0).unwrap();
        let obs = read_quota(&home.0, Some(known));
        assert_eq!(session_of(&obs), Some(100.0));
    }

    #[test]
    fn resumed_session_in_older_day_folder_wins_over_subagent_flood() {
        let home = Home::new("subagent-flood");
        let older_day = home.0.join("sessions/2026/10/18");
        let newer_day = home.0.join("sessions/2026/10/22");
        std::fs::create_dir_all(&older_day).unwrap();

        let noon = SystemTime::from(Utc.with_ymd_and_hms(2026, 10, 22, 12, 0, 0).unwrap());
        // 90 Guardian review subagent rollouts in the newer day folder (more
        // than the old `MAX_FILES * 2 = 80` directory walk cap).
        for i in 0..90 {
            let p = newer_day.join(format!("rollout-2026-10-22T12-00-{i:02}-sub.jsonl"));
            std::fs::write(&p, line_at("2026-10-22T12:01:00.000Z", &pct(12.0), "null")).unwrap();
            std::fs::File::options()
                .write(true)
                .open(&p)
                .unwrap()
                .set_modified(noon + Duration::from_secs(60))
                .unwrap();
        }

        // Thread created 4 days earlier (`2026/10/18`) but resumed at 12:30 today.
        let resumed = older_day.join("rollout-2026-10-18T09-00-00-main.jsonl");
        std::fs::write(
            &resumed,
            line_at("2026-10-22T12:30:00.000Z", &pct(78.0), "null"),
        )
        .unwrap();
        std::fs::File::options()
            .write(true)
            .open(&resumed)
            .unwrap()
            .set_modified(noon + Duration::from_secs(30 * 60))
            .unwrap();

        assert_eq!(session_of(&read_quota(&home.0, None)), Some(78.0));
    }

    #[test]
    fn aggregates_today_and_month_tokens_and_cost() {
        let home = Home::new("usage");
        home.rollout("s1", REAL_LINE, 5);
        let same_day = Utc.with_ymd_and_hms(2026, 10, 22, 15, 0, 0).unwrap();
        let (today, month) = read_usage(&home.0, same_day);
        assert_eq!(today.total_tokens, 607_756);
        assert_eq!(month.total_tokens, 607_756);
        assert!(today.cost > 0.20 && today.cost < 0.30);
        assert!(!today.is_empty);

        let next_day = Utc.with_ymd_and_hms(2026, 10, 23, 15, 0, 0).unwrap();
        let (today_after, month_after) = read_usage(&home.0, next_day);
        assert_eq!(today_after.total_tokens, 0);
        assert!(today_after.is_empty);
        assert_eq!(month_after.total_tokens, 607_756);
        assert_eq!(month_after.cost, today.cost);
    }

    #[test]
    fn read_usage_handles_token_usage_record_and_large_trailing_outputs() {
        let home = Home::new("usage-modern");
        let turn_ctx = r#"{"timestamp":"2026-10-22T12:00:00.000Z","type":"turn_context","payload":{"model":"gpt-6.2-astra"}}"#;
        let usage_rec = r#"{"timestamp":"2026-10-22T12:05:00.000Z","type":"event_msg","payload":{"type":"token_usage_record","model_name":"gpt-6.2-astra","thread_token_usage":{"input_tokens":100000,"cached_input_tokens":50000,"cache_write_input_tokens":0,"output_tokens":5000,"total_tokens":105000}}}"#;
        let big_output = format!(
            r#"{{"timestamp":"2026-10-22T12:05:01.000Z","type":"response_item","output":"{}"}}"#,
            "B".repeat(900 * 1024)
        );
        let content = [turn_ctx, usage_rec, &big_output].join("\n");
        home.rollout("modern", &content, 10);

        let same_day = Utc.with_ymd_and_hms(2026, 10, 22, 15, 0, 0).unwrap();
        let (today, _) = read_usage(&home.0, same_day);
        assert_eq!(today.total_tokens, 105_000);
        assert_eq!(today.input_tokens, 50_000);
        assert_eq!(today.cache_read_tokens, 50_000);
        assert_eq!(today.output_tokens, 5_000);
        assert!(today.cost > 0.10);
    }
}
