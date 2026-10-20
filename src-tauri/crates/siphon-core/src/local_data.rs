//! Port of `src/main/localDataService.js`. Two paths, same as the original:
//!   * legacy — summarise `readout-cost-cache.json`'s pre-aggregated `days` map;
//!   * modern — incrementally parse per-session JSONL under `~/.claude/projects/`
//!     with an on-disk cache keyed by (mtime, size, parsedOffset).
//!
//! The pure functions (`summarize_usage`, `parse_jsonl_chunk`) are unit-tested;
//! the filesystem orchestration is a straight port that also runs on non-Windows
//! hosts for testing.

use std::collections::BTreeMap;
use std::path::{Path, PathBuf};

use chrono::{DateTime, Duration, Utc};
use serde_json::{json, Map, Value};

use crate::format::{parse_iso, to_hour_key, to_local_date_key};
use crate::json_store::{default_claude_dir, JsonStore};
use crate::pricing::{find_price, round_cost, short_name, token_cost, Price, Tokens};
use crate::state::PeriodStats;

const CACHE_VERSION: u64 = 1;
const LOOKBACK_DAYS: i64 = 35;

#[derive(Debug, Clone)]
pub struct UsageSummary {
    pub today_stats: PeriodStats,
    pub month_stats: PeriodStats,
    pub last_updated: DateTime<Utc>,
}

#[derive(Debug, thiserror::Error)]
pub enum LocalError {
    #[error("no Claude Code data found")]
    NoData,
    #[error("io error: {0}")]
    Io(#[from] std::io::Error),
}

/// Reads `~/.claude` usage on each refresh. Mirrors `LocalDataService`.
pub struct LocalDataService {
    pub claude_dir: PathBuf,
    cache_path: PathBuf,
    pricing_path: PathBuf,
    projects_dir: PathBuf,
    cache_store: JsonStore,
}

impl LocalDataService {
    pub fn new(claude_dir: Option<PathBuf>, cache_store_path: PathBuf) -> Self {
        let claude_dir = claude_dir.unwrap_or_else(default_claude_dir);
        LocalDataService {
            cache_path: claude_dir.join("readout-cost-cache.json"),
            pricing_path: claude_dir.join("readout-pricing.json"),
            projects_dir: claude_dir.join("projects"),
            cache_store: JsonStore::new(cache_store_path),
            claude_dir,
        }
    }

    pub fn load(&self, now: DateTime<Utc>) -> Result<UsageSummary, LocalError> {
        let cache = read_json(&self.cache_path)?;
        let pricing = read_json(&self.pricing_path)?;

        // Legacy path first, exactly like the JS.
        if let Some(cache) = cache {
            let days = cache
                .get("days")
                .cloned()
                .unwrap_or(Value::Object(Map::new()));
            return Ok(summarize_usage(&days, pricing.as_ref(), now));
        }

        self.summarize_from_jsonl(pricing.as_ref(), now)
    }

    fn summarize_from_jsonl(
        &self,
        pricing: Option<&Value>,
        now: DateTime<Utc>,
    ) -> Result<UsageSummary, LocalError> {
        let cutoff = now - Duration::days(LOOKBACK_DAYS);
        let cache = normalize_cache(self.cache_store.load().ok().flatten());
        let project_entries = match std::fs::read_dir(&self.projects_dir) {
            Ok(entries) => entries,
            Err(e) if e.kind() == std::io::ErrorKind::NotFound => return Err(LocalError::NoData),
            // Any other read failure → behave like "no data on disk", summarising empty.
            Err(_) => return Ok(summarize_usage(&Value::Object(Map::new()), pricing, now)),
        };

        let mut project_paths = Vec::new();
        for project in project_entries.flatten() {
            if project.file_type().map(|t| t.is_dir()).unwrap_or(false) {
                project_paths.push(project.path());
            }
        }

        let mut next_files: Map<String, Value> = Map::new();

        if project_paths.is_empty() {
            let next_cache = json!({
                "version": CACHE_VERSION,
                "updatedAt": now.format("%Y-%m-%dT%H:%M:%S%.3fZ").to_string(),
                "files": Value::Object(next_files.clone()),
            });
            let _ = self.cache_store.save(Some(&next_cache));
            let days = merge_file_maps(&next_files, "days");
            return Ok(summarize_usage(&days, pricing, now));
        }

        // Spawn a thread scope to read and process project directories in parallel.
        // We use available_parallelism() but cap it to avoid excessive context switching,
        // as file IO parallelism has diminishing returns. Also cap it by the number of projects.
        let num_threads = std::thread::available_parallelism()
            .map(|n| n.get())
            .unwrap_or(4)
            .min(8)
            .min(project_paths.len());

        std::thread::scope(|s| {
            let mut handles = Vec::with_capacity(num_threads);
            let project_paths = &project_paths;
            let cache = &cache;

            for i in 0..num_threads {
                handles.push(s.spawn(move || {
                    let mut local_next_files: Map<String, Value> = Map::new();
                    // Interleave the paths among threads.
                    for (idx, path) in project_paths.iter().enumerate() {
                        if idx % num_threads != i {
                            continue;
                        }
                        let files = match std::fs::read_dir(path) {
                            Ok(f) => f,
                            Err(_) => continue,
                        };
                        for file in files.flatten() {
                            let path = file.path();
                            if path.extension().and_then(|e| e.to_str()) != Some("jsonl") {
                                continue;
                            }
                            let meta = match std::fs::metadata(&path) {
                                Ok(m) => m,
                                Err(_) => continue,
                            };
                            let mtime_ms = mtime_ms(&meta);
                            let size = meta.len();
                            if mtime_ms < cutoff.timestamp_millis() as f64 {
                                continue;
                            }
                            let key = path.to_string_lossy().to_string();
                            let previous = cache.get(&key).cloned();
                            if is_unchanged(previous.as_ref(), mtime_ms, size) {
                                local_next_files.insert(key.clone(), previous.unwrap());
                                continue;
                            }
                            let aggregate =
                                parse_jsonl_file(&path, previous.as_ref(), mtime_ms, size, cutoff);
                            local_next_files.insert(key, aggregate);
                        }
                    }
                    local_next_files
                }));
            }

            for handle in handles {
                let local_map = handle.join().unwrap();
                for (k, v) in local_map {
                    next_files.insert(k, v);
                }
            }
        });

        let next_cache = json!({
            "version": CACHE_VERSION,
            "updatedAt": now.format("%Y-%m-%dT%H:%M:%S%.3fZ").to_string(),
            "files": Value::Object(next_files.clone()),
        });
        let _ = self.cache_store.save(Some(&next_cache));

        let days = merge_file_maps(&next_files, "days");
        Ok(summarize_usage(&days, pricing, now))
    }
}

/// Summarise a pre-aggregated `days` map (date → model → tokens) into today/month
/// period stats. Port of `summarizeUsage`.
pub fn summarize_usage(days: &Value, pricing: Option<&Value>, now: DateTime<Utc>) -> UsageSummary {
    let today = to_local_date_key(now);
    let month_prefix = &today[..7];

    let mut today_models: BTreeMap<String, Accumulator> = BTreeMap::new();
    let mut month_models: BTreeMap<String, Accumulator> = BTreeMap::new();
    let mut price_cache: BTreeMap<String, Option<Price>> = BTreeMap::new();

    if let Some(days) = days.as_object() {
        for (date, model_map) in days {
            let Some(model_map) = model_map.as_object() else {
                continue;
            };
            for (model, raw_tokens) in model_map {
                let tokens = normalize_tokens(raw_tokens);
                let price = price_cache
                    .entry(model.clone())
                    .or_insert_with(|| find_price(pricing, model));
                let cost = price.map(|p| token_cost(tokens, p)).unwrap_or(0.0);

                if date == &today {
                    today_models
                        .entry(model.clone())
                        .or_default()
                        .add(tokens, cost);
                }
                if date.starts_with(month_prefix) {
                    month_models
                        .entry(model.clone())
                        .or_default()
                        .add(tokens, cost);
                }
            }
        }
    }

    UsageSummary {
        today_stats: aggregate_period(&today_models),
        month_stats: aggregate_period(&month_models),
        last_updated: now,
    }
}

#[derive(Default, Clone)]
struct Accumulator {
    input: i64,
    output: i64,
    cache_read: i64,
    cache_write: i64,
    cost: f64,
}

impl Accumulator {
    fn add(&mut self, tokens: Tokens, cost: f64) {
        self.input += tokens.input as i64;
        self.output += tokens.output as i64;
        self.cache_read += tokens.cache_read as i64;
        self.cache_write += tokens.cache_write as i64;
        self.cost = round_cost(self.cost + cost);
    }
}

fn aggregate_period(map: &BTreeMap<String, Accumulator>) -> PeriodStats {
    let mut totals = Accumulator::default();
    let mut by_model = Map::new();
    for (model, entry) in map {
        totals.input += entry.input;
        totals.output += entry.output;
        totals.cache_read += entry.cache_read;
        totals.cache_write += entry.cache_write;
        totals.cost = round_cost(totals.cost + entry.cost);
        by_model.insert(model.clone(), per_model_stats(model, entry));
    }
    let total_tokens = (totals.input + totals.output) as u64;
    PeriodStats {
        input_tokens: totals.input as u64,
        output_tokens: totals.output as u64,
        cache_read_tokens: totals.cache_read as u64,
        cache_write_tokens: totals.cache_write as u64,
        total_tokens,
        cost: totals.cost,
        is_empty: total_tokens == 0 && totals.cost == 0.0,
        by_model,
    }
}

fn per_model_stats(model: &str, entry: &Accumulator) -> Value {
    json!({
        "modelKey": model,
        "shortName": short_name(model),
        "inputTokens": entry.input,
        "outputTokens": entry.output,
        "cacheReadTokens": entry.cache_read,
        "cacheWriteTokens": entry.cache_write,
        "totalTokens": entry.input + entry.output,
        "cost": round_cost(entry.cost),
    })
}

fn normalize_tokens(v: &Value) -> Tokens {
    let num = |keys: &[&str]| -> f64 {
        for k in keys {
            if let Some(n) = v.get(*k).and_then(|x| x.as_f64()) {
                return n;
            }
        }
        0.0
    };
    Tokens {
        input: num(&["input"]),
        output: num(&["output"]),
        cache_read: num(&["cacheRead", "cache_read"]),
        cache_write: num(&["cacheWrite", "cache_write"]),
    }
}

// ----- JSONL incremental parsing -------------------------------------------

/// Parse a JSONL chunk, folding assistant-usage records into `days`/`hourly`
/// token maps. Returns the trailing partial line (`remainder`). Port of
/// `parseJsonlChunk`. `seen` de-dups within a single parse by `messageId:requestId`.
pub fn parse_jsonl_chunk(
    chunk: &str,
    days: &mut Map<String, Value>,
    hourly: &mut Map<String, Value>,
    last_model: &mut Option<String>,
    cutoff: DateTime<Utc>,
    seen: &mut std::collections::HashSet<String>,
) -> String {
    let mut remainder = String::new();
    let mut iter = chunk.split('\n').peekable();
    while let Some(line) = iter.next() {
        // The final element after the last '\n' is the partial line.
        if iter.peek().is_none() {
            remainder = line.to_string();
            break;
        }
        if line.trim().is_empty() || !line.contains("\"assistant\"") {
            continue;
        }
        let record: Value = match serde_json::from_str(line) {
            Ok(v) => v,
            Err(_) => continue,
        };
        if record.get("type").and_then(|v| v.as_str()) != Some("assistant") {
            continue;
        }
        let Some(message) = record.get("message") else {
            continue;
        };
        let Some(usage) = message.get("usage") else {
            continue;
        };
        let Some(timestamp) = record.get("timestamp").and_then(|v| v.as_str()) else {
            continue;
        };
        let Some(entry_time) = parse_iso(timestamp) else {
            continue;
        };
        if entry_time < cutoff {
            continue;
        }
        let model = message
            .get("model")
            .and_then(|v| v.as_str())
            .map(|s| s.to_string())
            .or_else(|| last_model.clone())
            .unwrap_or_else(|| "unknown".to_string());
        if model == "<synthetic>" || model.starts_with("synthetic") {
            continue;
        }
        let message_id = message.get("id").and_then(|v| v.as_str()).unwrap_or("");
        let request_id = record
            .get("requestId")
            .and_then(|v| v.as_str())
            .unwrap_or("");
        if !message_id.is_empty() && !request_id.is_empty() {
            let dedup_key = format!("{message_id}:{request_id}");
            if !seen.insert(dedup_key) {
                continue;
            }
        }
        let tokens = normalize_jsonl_usage(usage);
        let date_key = to_local_date_key(entry_time);
        let hour_key = to_hour_key(entry_time);
        add_to_nested(days, &date_key, &model, tokens);
        add_to_nested(hourly, &hour_key, &model, tokens);
        *last_model = Some(model);
    }
    remainder
}

fn normalize_jsonl_usage(usage: &Value) -> [i64; 4] {
    let n = |k: &str| usage.get(k).and_then(|v| v.as_i64()).unwrap_or(0);
    [
        n("input_tokens"),
        n("output_tokens"),
        n("cache_read_input_tokens"),
        n("cache_creation_input_tokens"),
    ]
}

fn add_to_nested(map: &mut Map<String, Value>, bucket: &str, model: &str, tokens: [i64; 4]) {
    let bucket_map = map
        .entry(bucket.to_string())
        .or_insert_with(|| Value::Object(Map::new()))
        .as_object_mut()
        .unwrap();
    let entry = bucket_map
        .entry(model.to_string())
        .or_insert_with(|| json!({ "input": 0, "output": 0, "cacheRead": 0, "cacheWrite": 0 }));
    let get = |e: &Value, k: &str| e.get(k).and_then(|v| v.as_i64()).unwrap_or(0);
    let merged = json!({
        "input": get(entry, "input") + tokens[0],
        "output": get(entry, "output") + tokens[1],
        "cacheRead": get(entry, "cacheRead") + tokens[2],
        "cacheWrite": get(entry, "cacheWrite") + tokens[3],
    });
    *entry = merged;
}

fn parse_jsonl_file(
    path: &Path,
    previous: Option<&Value>,
    mtime_ms: f64,
    size: u64,
    cutoff: DateTime<Utc>,
) -> Value {
    let parsed_offset = previous
        .and_then(|p| p.get("parsedOffset"))
        .and_then(|v| v.as_u64())
        .unwrap_or(0);
    let prev_size = previous
        .and_then(|p| p.get("size"))
        .and_then(|v| v.as_u64())
        .unwrap_or(0);
    let should_append = previous.is_some() && size >= parsed_offset && size >= prev_size;
    let start = if should_append { parsed_offset } else { 0 };

    let mut days = previous
        .filter(|_| should_append)
        .and_then(|p| p.get("days"))
        .and_then(|v| v.as_object().cloned())
        .unwrap_or_default();
    // `hourly` is not consumed yet — kept for cache parity with the macOS app
    // and a future hourly-stats view.
    let mut hourly = previous
        .filter(|_| should_append)
        .and_then(|p| p.get("hourly"))
        .and_then(|v| v.as_object().cloned())
        .unwrap_or_default();
    let mut last_model = previous
        .filter(|_| should_append)
        .and_then(|p| p.get("lastModel"))
        .and_then(|v| v.as_str())
        .map(|s| s.to_string());

    let chunk = read_range(path, start).unwrap_or_default();
    let mut seen = std::collections::HashSet::new();
    let remainder = parse_jsonl_chunk(
        &chunk,
        &mut days,
        &mut hourly,
        &mut last_model,
        cutoff,
        &mut seen,
    );

    json!({
        "path": path.to_string_lossy(),
        "mtimeMs": mtime_ms,
        "size": size,
        "parsedOffset": size - remainder.len() as u64,
        "lastModel": last_model,
        "days": Value::Object(days),
        "hourly": Value::Object(hourly),
    })
}

/// Merge the per-file token maps under `key` (`"days"` or `"hourly"`) into a
/// single bucket→model→tokens map. Port of `mergeFileMaps`.
pub fn merge_file_maps(files: &Map<String, Value>, key: &str) -> Value {
    let mut merged: Map<String, Value> = Map::new();
    for file_cache in files.values() {
        let Some(target) = file_cache.get(key).and_then(|v| v.as_object()) else {
            continue;
        };
        for (bucket, model_map) in target {
            let Some(model_map) = model_map.as_object() else {
                continue;
            };
            for (model, tokens) in model_map {
                let get = |k: &[&str]| -> i64 {
                    k.iter()
                        .find_map(|kk| tokens.get(*kk).and_then(|v| v.as_i64()))
                        .unwrap_or(0)
                };
                add_to_nested(
                    &mut merged,
                    bucket,
                    model,
                    [
                        get(&["input", "inputTokens"]),
                        get(&["output", "outputTokens"]),
                        get(&["cacheRead", "cache_read"]),
                        get(&["cacheWrite", "cache_write"]),
                    ],
                );
            }
        }
    }
    Value::Object(merged)
}

fn normalize_cache(cache: Option<Value>) -> Map<String, Value> {
    match cache {
        Some(Value::Object(obj))
            if obj.get("version").and_then(|v| v.as_u64()) == Some(CACHE_VERSION) =>
        {
            obj.get("files")
                .and_then(|v| v.as_object())
                .cloned()
                .unwrap_or_default()
        }
        _ => Map::new(),
    }
}

fn is_unchanged(file_cache: Option<&Value>, mtime_ms: f64, size: u64) -> bool {
    match file_cache {
        Some(c) => {
            c.get("mtimeMs").and_then(|v| v.as_f64()) == Some(mtime_ms)
                && c.get("size").and_then(|v| v.as_u64()) == Some(size)
        }
        None => false,
    }
}

fn read_range(path: &Path, start: u64) -> std::io::Result<String> {
    use std::io::{Read, Seek, SeekFrom};
    let mut file = std::fs::File::open(path)?;
    if start > 0 {
        file.seek(SeekFrom::Start(start))?;
    }
    let mut buf = String::new();
    file.read_to_string(&mut buf)?;
    Ok(buf)
}

fn read_json(path: &Path) -> std::io::Result<Option<Value>> {
    match std::fs::read_to_string(path) {
        Ok(raw) => Ok(serde_json::from_str(&raw).ok()),
        Err(e) if e.kind() == std::io::ErrorKind::NotFound => Ok(None),
        Err(e) => Err(e),
    }
}

fn mtime_ms(meta: &std::fs::Metadata) -> f64 {
    meta.modified()
        .ok()
        .and_then(|t| t.duration_since(std::time::UNIX_EPOCH).ok())
        .map(|d| d.as_secs_f64() * 1000.0)
        .unwrap_or(0.0)
}

#[cfg(test)]
mod tests {
    use super::*;
    use chrono::TimeZone;

    #[test]
    fn summarizes_today_and_month() {
        let now = Utc.with_ymd_and_hms(2026, 7, 6, 12, 0, 0).unwrap();
        let today = to_local_date_key(now);
        let days = json!({
            today.clone(): { "claude-opus-4-8": { "input": 1000000, "output": 1000000 } },
            "2026-07-01": { "claude-sonnet-5": { "input": 1000000, "output": 0 } },
            "2026-06-01": { "claude-opus-4-8": { "input": 1000000, "output": 0 } },
        });
        let summary = summarize_usage(&days, None, now);
        // Today: opus 1M in + 1M out = $5 + $25 = $30.
        assert_eq!(summary.today_stats.cost, 30.0);
        assert_eq!(summary.today_stats.total_tokens, 2_000_000);
        assert!(!summary.today_stats.is_empty);
        // Month (July): opus today ($30) + sonnet 1M in ($2) = $32.
        // The sonnet leg reads BUNDLED_PRICING, so a rate change lands here.
        assert_eq!(summary.month_stats.cost, 32.0);
    }

    #[test]
    fn empty_days_is_empty() {
        let now = Utc.with_ymd_and_hms(2026, 7, 6, 12, 0, 0).unwrap();
        let summary = summarize_usage(&json!({}), None, now);
        assert!(summary.today_stats.is_empty);
        assert!(summary.month_stats.is_empty);
    }

    #[test]
    fn full_filesystem_scan_aggregates_multiple_projects() {
        let dir = std::env::temp_dir().join(format!("siphon-local-data-{}", std::process::id()));
        std::fs::create_dir_all(&dir).unwrap();
        let store_path = dir.join("cache.json");
        let claude_dir = dir.join(".claude");
        let projects_dir = claude_dir.join("projects");
        std::fs::create_dir_all(&projects_dir).unwrap();

        // Project A: two files
        let proj_a = projects_dir.join("proj_a");
        std::fs::create_dir_all(&proj_a).unwrap();
        let file_a1 = proj_a.join("1.jsonl");
        let file_a2 = proj_a.join("2.jsonl");

        let ts1 = "2026-07-06T10:00:00.000Z";
        let record1 = json!({
            "type": "assistant", "timestamp": ts1,
            "message": { "model": "claude-opus", "usage": { "input_tokens": 100, "output_tokens": 50 } }
        }).to_string();
        std::fs::write(&file_a1, format!("{}\n", record1)).unwrap();

        let ts2 = "2026-07-06T11:00:00.000Z";
        let record2 = json!({
            "type": "assistant", "timestamp": ts2,
            "message": { "model": "claude-opus", "usage": { "input_tokens": 200, "output_tokens": 100 } }
        }).to_string();
        std::fs::write(&file_a2, format!("{}\n", record2)).unwrap();

        // Project B: one file
        let proj_b = projects_dir.join("proj_b");
        std::fs::create_dir_all(&proj_b).unwrap();
        let file_b1 = proj_b.join("1.jsonl");
        let ts3 = "2026-07-06T12:00:00.000Z";
        let record3 = json!({
            "type": "assistant", "timestamp": ts3,
            "message": { "model": "claude-sonnet", "usage": { "input_tokens": 500, "output_tokens": 0 } }
        }).to_string();
        std::fs::write(&file_b1, format!("{}\n", record3)).unwrap();

        let svc = LocalDataService::new(Some(claude_dir.clone()), store_path.clone());
        let now = chrono::Utc.with_ymd_and_hms(2026, 7, 6, 12, 0, 0).unwrap();

        // 1. Initial load
        let summary1 = svc.load(now).unwrap();
        assert_eq!(
            summary1.today_stats.total_tokens,
            100 + 50 + 200 + 100 + 500
        );

        // 2. Unchanged cached files (simulate refresh)
        let summary2 = svc.load(now).unwrap();
        assert_eq!(
            summary2.today_stats.total_tokens,
            100 + 50 + 200 + 100 + 500
        );

        // 3. Appended record
        let ts4 = "2026-07-06T12:30:00.000Z";
        let record4 = json!({
            "type": "assistant", "timestamp": ts4,
            "message": { "model": "claude-sonnet", "usage": { "input_tokens": 0, "output_tokens": 100 } }
        }).to_string();
        let mut appended = std::fs::read_to_string(&file_b1).unwrap();
        appended.push_str(&format!("{}\n", record4));
        std::fs::write(&file_b1, appended).unwrap();

        let summary3 = svc.load(now).unwrap();
        assert_eq!(
            summary3.today_stats.total_tokens,
            100 + 50 + 200 + 100 + 500 + 100
        );

        // 4. Removed file
        std::fs::remove_file(&file_a2).unwrap();
        let summary4 = svc.load(now).unwrap();
        // file_a2 had 300 tokens, so now we should have (total_prev - 300) = (950 + 100) - 300 = 750
        assert_eq!(summary4.today_stats.total_tokens, 100 + 50 + 500 + 100);

        let _ = std::fs::remove_dir_all(&dir);
    }

    #[test]
    fn parses_assistant_usage_and_dedups() {
        let now = Utc.with_ymd_and_hms(2026, 7, 6, 12, 0, 0).unwrap();
        let cutoff = now - Duration::days(35);
        let ts = "2026-07-06T10:00:00.000Z";
        let line = |mid: &str, rid: &str| {
            json!({
                "type": "assistant",
                "timestamp": ts,
                "requestId": rid,
                "message": {
                    "id": mid,
                    "model": "claude-opus-4-8",
                    "usage": { "input_tokens": 100, "output_tokens": 50,
                               "cache_read_input_tokens": 10, "cache_creation_input_tokens": 5 }
                }
            })
            .to_string()
        };
        // Two identical (mid,rid) records + a trailing partial line.
        let chunk = format!("{}\n{}\n{{partial", line("m1", "r1"), line("m1", "r1"));
        let mut days = Map::new();
        let mut hourly = Map::new();
        let mut last_model = None;
        let mut seen = std::collections::HashSet::new();
        let remainder = parse_jsonl_chunk(
            &chunk,
            &mut days,
            &mut hourly,
            &mut last_model,
            cutoff,
            &mut seen,
        );
        assert_eq!(remainder, "{partial");
        // Dedup: only counted once.
        let day = to_local_date_key(now);
        let entry = &days[&day]["claude-opus-4-8"];
        assert_eq!(entry["input"], 100);
        assert_eq!(entry["output"], 50);
        assert_eq!(last_model.as_deref(), Some("claude-opus-4-8"));
    }

    #[test]
    fn skips_synthetic_and_old_records() {
        let now = Utc.with_ymd_and_hms(2026, 7, 6, 12, 0, 0).unwrap();
        let cutoff = now - Duration::days(35);
        let synthetic = json!({
            "type": "assistant", "timestamp": "2026-07-06T10:00:00.000Z",
            "message": { "model": "<synthetic>", "usage": { "input_tokens": 1 } }
        })
        .to_string();
        let old = json!({
            "type": "assistant", "timestamp": "2020-01-01T00:00:00.000Z",
            "message": { "model": "claude-opus-4-8", "usage": { "input_tokens": 1 } }
        })
        .to_string();
        let chunk = format!("{synthetic}\n{old}\n");
        let mut days = Map::new();
        let mut hourly = Map::new();
        let mut lm = None;
        let mut seen = std::collections::HashSet::new();
        parse_jsonl_chunk(&chunk, &mut days, &mut hourly, &mut lm, cutoff, &mut seen);
        assert!(days.is_empty());
    }
    #[test]
    fn parses_escaped_strings_and_fallbacks() {
        let now = Utc.with_ymd_and_hms(2026, 7, 6, 12, 0, 0).unwrap();
        let cutoff = now - Duration::days(35);

        let chunk = r#"{"type": "assistant", "timestamp": "2026-07-06T10:00:00.000Z", "requestId": "req_1\\n", "message": {"id": "m1", "model": "claude-opus-4-8", "usage": {"input_tokens": 100, "output_tokens": 50, "cache_read_input_tokens": 10, "cache_creation_input_tokens": 5}}}
{"type": "assistant", "timestamp": "2026-07-06T10:00:00.000Z", "requestId": "req_2", "message": {"id": "m2", "model": 123, "usage": {"input_tokens": 50, "output_tokens": 20, "cache_read_input_tokens": 0, "cache_creation_input_tokens": 0}}}
{"type": "assistant", "timestamp": "2026-07-06T10:00:00.000Z", "requestId": "req_3", "message": {"id": "m3", "model": "claude-opus-4-8", "usage": {"input_tokens": "not a number", "output_tokens": 50, "cache_read_input_tokens": 10, "cache_creation_input_tokens": 5}}}
{"type": "assistant", "timestamp": "2026-07-06T10:00:00.000Z", "requestId": "req_4", "message": {"id": "m4", "model": "claude-opus-4-8"}}
{"type": "assistant", "timestamp": "2026-07-06T10:00:00.000Z", "requestId": "req_4", "message": {"id": "m4", "model": "claude-opus-4-8", "usage": {"input_tokens": 999}}}
{"type": "assistant", "timestamp": "2026-07-06T10:00:00.000Z"#;

        let mut days = Map::new();
        let mut hourly = Map::new();
        let mut last_model = None;
        let mut seen = std::collections::HashSet::new();

        let remainder = parse_jsonl_chunk(
            chunk,
            &mut days,
            &mut hourly,
            &mut last_model,
            cutoff,
            &mut seen,
        );
        assert_eq!(
            remainder,
            r#"{"type": "assistant", "timestamp": "2026-07-06T10:00:00.000Z"#
        );

        let day = to_local_date_key(now);

        // m1: 100
        // m2: 50 (model 123 falls back to None, which falls back to last_model = claude-opus-4-8)
        // m3: 0 (defaulted to 0 because "not a number" is not an i64)
        // m4 (no usage): skipped, meaning the deduplication key is NOT consumed!
        // m4 (with usage): 999
        // Total input: 100 + 50 + 0 + 999 = 1149
        let entry = &days[&day]["claude-opus-4-8"];
        assert_eq!(entry["input"], 1149);

        // m1: 50 + m2: 20 + m3: 50 + m4: 0 = 120
        assert_eq!(entry["output"], 120);
    }
}
