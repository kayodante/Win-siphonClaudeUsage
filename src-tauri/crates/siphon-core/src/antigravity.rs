//! Antigravity quota, read from the running Antigravity 2.x app. The quota
//! lives only in its local `language_server`, which serves a Connect RPC on a
//! loopback HTTPS port with a self-signed certificate and a per-launch CSRF
//! token:
//!
//! * the ports: PID-owned loopback listeners; `main.log` is an optional hint
//!   that only prioritizes ports already owned by an identified server;
//! * the token: only on the server's command line (`--csrf_token <uuid>`).
//!   Up to 2.15 the log carried it too; 2.16 stopped writing it there.
//!
//! The binary crate reads the command line and performs the POST; everything
//! that interprets what comes back is here. The server exists only while the
//! app is open, so a closed app is an expected state, not an error.

use std::path::{Path, PathBuf};
use std::sync::OnceLock;

use regex_lite::Regex;
use serde_json::Value;

use crate::format::parse_iso;
use crate::providers::{iso, Observation, ProviderStatus, ProviderWindow, QuotaSection};

/// Connect path of the quota call, POSTed with a `{}` body.
pub const QUOTA_RPC_PATH: &str =
    "/exa.language_server_pb.LanguageServerService/RetrieveUserQuotaSummary";
pub const CSRF_HEADER: &str = "X-Codeium-Csrf-Token";
const LOG_TAIL_BYTES: u64 = 256 * 1024;

/// Optional port hint at `%APPDATA%\Antigravity\logs\main.log`.
pub fn main_log_path() -> Option<PathBuf> {
    let appdata = std::env::var_os("APPDATA")?;
    Some(
        PathBuf::from(appdata)
            .join("Antigravity")
            .join("logs")
            .join("main.log"),
    )
}

/// Optional fallback port hint at `%APPDATA%\Antigravity\logs\language_server.log`.
pub fn language_server_log_path() -> Option<PathBuf> {
    let appdata = std::env::var_os("APPDATA")?;
    Some(
        PathBuf::from(appdata)
            .join("Antigravity")
            .join("logs")
            .join("language_server.log"),
    )
}

fn port_regex() -> &'static Regex {
    static RE: OnceLock<Regex> = OnceLock::new();
    RE.get_or_init(|| Regex::new(r"https://127\.0\.0\.1:(\d{1,5})/").expect("valid port regex"))
}

fn ls_port_regex() -> &'static Regex {
    static RE: OnceLock<Regex> = OnceLock::new();
    RE.get_or_init(|| {
        Regex::new(r"Language server listening on random port at (\d{1,5}) for HTTPS")
            .expect("valid language_server port regex")
    })
}

fn token_regex() -> &'static Regex {
    static RE: OnceLock<Regex> = OnceLock::new();
    RE.get_or_init(|| Regex::new(r"--csrf_token[ =](\S+)").expect("valid csrf_token regex"))
}

/// Read the newest loopback port from `main.log`, checking the last 256 KB
/// first so a multi-megabyte log is not loaded into memory on every tick, and
/// falling back to the full file only if the tail held no port line.
pub fn read_log_port(path: &Path) -> std::io::Result<Option<u16>> {
    read_tail_port(path, find_port)
}

/// Read the newest HTTPS loopback port from `language_server.log`.
pub fn read_language_server_log_port(path: &Path) -> std::io::Result<Option<u16>> {
    read_tail_port(path, find_language_server_port)
}

fn read_tail_port(path: &Path, parser: fn(&str) -> Option<u16>) -> std::io::Result<Option<u16>> {
    use std::io::{Read, Seek, SeekFrom};
    let mut file = std::fs::File::open(path)?;
    let len = file.metadata()?.len();
    let start = len.saturating_sub(LOG_TAIL_BYTES);
    file.seek(SeekFrom::Start(start))?;
    let mut buf = Vec::new();
    file.read_to_end(&mut buf)?;
    if let Some(port) = parser(&String::from_utf8_lossy(&buf)) {
        return Ok(Some(port));
    }
    if start == 0 {
        return Ok(None);
    }
    file.seek(SeekFrom::Start(0))?;
    buf.clear();
    file.read_to_end(&mut buf)?;
    Ok(parser(&String::from_utf8_lossy(&buf)))
}

/// The newest loopback port the app logged. The host is never taken from the
/// log: the caller always talks to `127.0.0.1`.
pub fn find_port(main_log: &str) -> Option<u16> {
    let last = port_regex().captures_iter(main_log).last()?;
    last[1].parse::<u16>().ok().filter(|p| *p != 0)
}

/// The newest HTTPS loopback port logged in `language_server.log`.
pub fn find_language_server_port(ls_log: &str) -> Option<u16> {
    let last = ls_port_regex().captures_iter(ls_log).last()?;
    last[1].parse::<u16>().ok().filter(|p| *p != 0)
}

/// The CSRF token from a process command line, but only when that process is
/// Antigravity's server: Windsurf and other Codeium builds run a
/// `language_server` too, and their token must not be sent anywhere.
pub fn csrf_token(command_line: &str) -> Option<String> {
    if !is_antigravity(command_line) {
        return None;
    }
    let raw = &token_regex().captures(command_line)?[1];
    let token = raw.trim_matches(['"', '\'']).to_string();
    // A UUID today. Anything outside this set would not survive as a header
    // value anyway; refusing it here keeps a malformed line from reaching one.
    let plausible = (8..=128).contains(&token.len())
        && token
            .bytes()
            .all(|b| b.is_ascii_alphanumeric() || b == b'-' || b == b'_');
    plausible.then_some(token)
}

fn is_antigravity(command_line: &str) -> bool {
    static RE: OnceLock<Regex> = OnceLock::new();
    RE.get_or_init(|| {
        Regex::new(r#"(?:^|\s)--(?:override_ide_name|app_data_dir)[ =]["']?antigravity["']?(?:\s|$)"#)
            .expect("valid identity regex")
    })
    .is_match(command_line)
}

/// A running `language_server` process and the loopback TCP ports its PID is
/// listening on (`127.0.0.1`).
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct ServerProcess {
    pub command_line: String,
    pub ports: Vec<u16>,
}

/// Resolution of which loopback port(s) and CSRF token to query.
#[derive(Debug, PartialEq, Eq)]
pub enum EndpointPick {
    /// No Antigravity server is running: the app is closed.
    Closed,
    /// Candidate loopback ports (best first) and the CSRF token to send.
    Ready { ports: Vec<u16>, token: String },
    /// Running server(s) found, but port or token cannot be chosen safely.
    Ambiguous,
}

/// Combine the port from `main.log` with the running `language_server`
/// processes and their OS-owned loopback ports.
///
/// * If the kernel TCP table ties `log_port` to a process (or processes sharing
///   one token), that token wins even when another server with a different
///   token is also running.
/// * Otherwise, if all Antigravity processes share one token, only their
///   owned ports are candidates. An unowned log port is never authenticated.
pub fn resolve_endpoint(log_port: Option<u16>, processes: &[ServerProcess]) -> EndpointPick {
    if processes
        .iter()
        .any(|p| is_antigravity(&p.command_line) && csrf_token(&p.command_line).is_none())
    {
        return EndpointPick::Ambiguous;
    }
    let servers: Vec<(String, &[u16])> = processes
        .iter()
        .filter_map(|p| Some((csrf_token(&p.command_line)?, p.ports.as_slice())))
        .collect();
    if servers.is_empty() {
        return EndpointPick::Closed;
    }

    if let Some(port) = log_port.filter(|p| *p != 0) {
        let owners = servers
            .iter()
            .filter(|(_, ports)| ports.contains(&port))
            .map(|(t, _)| t.as_str());
        match unique_token(owners) {
            TokenPick::One(token) => {
                let mut ports = vec![port];
                for (t, p_ports) in &servers {
                    if *t == token {
                        for &p in *p_ports {
                            if p != 0
                                && !ports.contains(&p)
                                && !servers
                                    .iter()
                                    .any(|(other, owned)| *other != token && owned.contains(&p))
                            {
                                ports.push(p);
                            }
                        }
                    }
                }
                return EndpointPick::Ready { ports, token };
            }
            TokenPick::Ambiguous => return EndpointPick::Ambiguous,
            TokenPick::None => {}
        }
    }

    let TokenPick::One(token) = unique_token(servers.iter().map(|(t, _)| t.as_str())) else {
        return EndpointPick::Ambiguous;
    };

    let mut ports = Vec::new();
    for (_, p_ports) in &servers {
        for &p in *p_ports {
            if p != 0 && !ports.contains(&p) {
                ports.push(p);
            }
        }
    }
    if ports.is_empty() {
        EndpointPick::Ambiguous
    } else {
        EndpointPick::Ready { ports, token }
    }
}

/// Running processes establish presence even without any files. Inspection
/// failures are errors, never proof that an installation disappeared.
pub fn discover_endpoint(
    log_port: Option<u16>,
    processes: Result<&[ServerProcess], std::io::ErrorKind>,
    installed: Result<bool, std::io::ErrorKind>,
) -> Result<EndpointPick, Observation> {
    let error = || Observation::NoReading(ProviderStatus::Error);
    match resolve_endpoint(log_port, processes.map_err(|_| error())?) {
        EndpointPick::Ready { ports, token } => Ok(EndpointPick::Ready { ports, token }),
        EndpointPick::Ambiguous => Err(error()),
        EndpointPick::Closed => match installed {
            Ok(true) => Err(Observation::NoReading(ProviderStatus::Closed)),
            Ok(false) => Err(Observation::NotInstalled),
            Err(_) => Err(error()),
        },
    }
}

fn unique_token<'a>(tokens: impl IntoIterator<Item = &'a str>) -> TokenPick {
    let mut found: Option<String> = None;
    for token in tokens {
        match &found {
            Some(seen) if seen != token => return TokenPick::Ambiguous,
            _ => found = Some(token.to_string()),
        }
    }
    found.map_or(TokenPick::None, TokenPick::One)
}

/// The token to send, out of every `language_server` command line. Two
/// Antigravity servers can run at once (an update restarting one, a second
/// install); the port comes from the log and nothing ties it to either
/// process, so with two different tokens Siphon does not guess.
#[derive(Debug, PartialEq, Eq)]
pub enum TokenPick {
    /// No Antigravity server is running: the app is closed.
    None,
    One(String),
    Ambiguous,
}

pub fn pick_token<S: AsRef<str>>(command_lines: &[S]) -> TokenPick {
    let mut found: Option<String> = None;
    for token in command_lines.iter().filter_map(|l| csrf_token(l.as_ref())) {
        match &found {
            Some(seen) if *seen != token => return TokenPick::Ambiguous,
            _ => found = Some(token),
        }
    }
    found.map_or(TokenPick::None, TokenPick::One)
}

/// `RetrieveUserQuotaSummary` → the sections the UI shows: `gemini`
/// (Gemini Flash / Pro), `thirdParty` (Claude and GPT models), and `argon`
/// (Gemini 4 Argon). `None` when the payload has none of them, or when not one
/// of their windows carries a usable value, which the caller reports as an
/// unreadable response.
pub fn parse_quota_summary(raw: &Value) -> Option<Vec<QuotaSection>> {
    let groups = raw
        .pointer("/response/groups")
        .or_else(|| raw.pointer("/summary/groups"))
        .or_else(|| raw.get("groups"))?
        .as_array()?;
    let mut sections = Vec::new();
    for (id, prefix) in [
        ("gemini", "gemini"),
        ("thirdParty", "3p"),
        ("argon", "gemini-argon-wtu"),
    ] {
        let mut section = QuotaSection {
            id: id.to_string(),
            session: None,
            weekly: None,
            blocked: false,
        };
        let mut owner = None;
        for (group_index, group) in groups.iter().enumerate() {
            // These are source labels from the observed RPC fixture, not
            // translated UI titles or fuzzy model-name matching.
            let group_prefix = match group.get("displayName").and_then(Value::as_str) {
                Some("Gemini Models") => Some("gemini"),
                Some("Claude and GPT models") => Some("3p"),
                Some("Gemini 4 Argon") => Some("gemini-argon-wtu"),
                _ => None,
            };
            if group_prefix.is_some_and(|known| known != prefix) {
                continue;
            }
            let Some(buckets) = group.get("buckets").and_then(Value::as_array) else {
                continue;
            };
            if group_prefix.is_none() {
                let mut inferred_group = None;
                for (candidate, _) in buckets.iter().filter_map(bucket_identity) {
                    if inferred_group.is_some_and(|known| known != candidate) {
                        return None;
                    }
                    inferred_group = Some(candidate);
                }
            }
            for bucket in buckets {
                let Some((bucket_prefix, inferred)) = bucket_identity(bucket) else {
                    continue;
                };
                if bucket_prefix != prefix {
                    continue;
                }
                // A section belongs to one source group; never join buckets
                // from repeated IDs in unrelated groups or pick the first one.
                if owner.is_some_and(|index| index != group_index) {
                    return None;
                }
                owner = Some(group_index);
                let duration = match bucket.get("window") {
                    None => inferred,
                    Some(value) => value.as_str()?,
                };
                let target = match duration {
                    "5h" => &mut section.session,
                    "weekly" => &mut section.weekly,
                    _ => return None,
                };
                if target.replace(parse_bucket(bucket)).is_some() {
                    return None;
                }
                section.blocked |= bucket.get("disabled").and_then(Value::as_bool) == Some(true);
            }
        }
        if owner.is_some() {
            sections.push(section);
        }
    }
    let measured = sections
        .iter()
        .flat_map(|s| [&s.session, &s.weekly])
        .flatten()
        .any(|w| w.percent.is_some());
    measured.then_some(sections)
}

fn bucket_identity(bucket: &Value) -> Option<(&'static str, &'static str)> {
    match bucket.get("bucketId")?.as_str()? {
        "gemini-5h" => Some(("gemini", "5h")),
        "gemini-weekly" => Some(("gemini", "weekly")),
        "3p-5h" => Some(("3p", "5h")),
        "3p-weekly" => Some(("3p", "weekly")),
        "gemini-argon-wtu-5h" => Some(("gemini-argon-wtu", "5h")),
        "gemini-argon-wtu-weekly" => Some(("gemini-argon-wtu", "weekly")),
        _ => None,
    }
}

/// A bucket without `remainingFraction` is unmeasured, not exhausted (sources
/// disagree on what proto3's omitted zero means here, and showing 100% used
/// for a quota nobody measured is the worse mistake), so it keeps its row
/// with no percent.
fn parse_bucket(bucket: &Value) -> ProviderWindow {
    let percent = bucket
        .get("remainingFraction")
        .and_then(Value::as_f64)
        .or_else(|| {
            bucket
                .pointer("/remaining/remainingFraction")
                .and_then(Value::as_f64)
        })
        .or_else(|| {
            let remaining = bucket.get("remaining")?;
            (remaining.get("case")?.as_str()? == "remainingFraction")
                .then(|| remaining.get("value")?.as_f64())
                .flatten()
        })
        .map(|remaining| (1.0 - remaining.clamp(0.0, 1.0)) * 100.0);
    let resets_at = bucket
        .get("resetTime")
        .and_then(Value::as_str)
        .and_then(parse_iso)
        .map(iso);
    ProviderWindow {
        percent,
        resets_at,
        rolled_over: false,
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn server(token: &str, ports: &[u16]) -> ServerProcess {
        ServerProcess {
            command_line: format!(
                "language_server.exe --override_ide_name antigravity --csrf_token {token}"
            ),
            ports: ports.to_vec(),
        }
    }

    #[test]
    fn an_unowned_log_port_is_never_authenticated() {
        let processes = [server("aaaaaaaa-1111", &[50001])];
        assert_eq!(
            resolve_endpoint(Some(59999), &processes),
            EndpointPick::Ready {
                ports: vec![50001],
                token: "aaaaaaaa-1111".into(),
            }
        );
        assert_eq!(
            resolve_endpoint(Some(59999), &[server("aaaaaaaa-1111", &[])]),
            EndpointPick::Ambiguous
        );
    }

    #[test]
    fn every_fallback_port_must_have_an_unambiguous_token_owner() {
        let processes = [
            server("aaaaaaaa-1111", &[50001, 50002]),
            server("bbbbbbbb-2222", &[50002, 50003]),
        ];
        assert_eq!(
            resolve_endpoint(Some(50001), &processes),
            EndpointPick::Ready {
                ports: vec![50001],
                token: "aaaaaaaa-1111".into(),
            }
        );
        assert_eq!(
            resolve_endpoint(Some(50002), &processes),
            EndpointPick::Ambiguous
        );
    }

    #[test]
    fn identifiable_servers_with_missing_tokens_are_errors_not_closed() {
        let process = ServerProcess {
            command_line: "language_server.exe --override_ide_name antigravity".into(),
            ports: vec![50001],
        };
        assert_eq!(resolve_endpoint(None, &[process]), EndpointPick::Ambiguous);
        assert_eq!(csrf_token("language_server.exe --override_ide_name antigravity-other --csrf_token aaaaaaaa-1111"), None);
    }

    #[test]
    fn duration_overrides_the_bucket_id_and_unknown_duration_is_not_a_session() {
        let raw = serde_json::json!({"groups":[{"buckets":[
            {"bucketId":"gemini-5h","window":"weekly","remainingFraction":0.25}
        ]}]});
        let sections = parse_quota_summary(&raw).unwrap();
        assert!(sections[0].session.is_none());
        assert_eq!(sections[0].weekly.as_ref().unwrap().percent, Some(75.0));
        for duration in [
            serde_json::json!("daily"),
            serde_json::json!(""),
            serde_json::json!(300),
            Value::Null,
        ] {
            let mut raw = raw.clone();
            raw["groups"][0]["buckets"][0]["window"] = duration;
            assert!(parse_quota_summary(&raw).is_none());
        }
    }

    #[test]
    fn duplicate_windows_and_cross_group_ids_are_not_combined() {
        let raw = serde_json::json!({"groups":[
            {"buckets":[{"bucketId":"gemini-5h","remainingFraction":0.25}]},
            {"buckets":[{"bucketId":"gemini-5h","remainingFraction":0.9}]}
        ]});
        assert!(
            parse_quota_summary(&raw).is_none(),
            "no first-match winner across groups"
        );
        let raw = serde_json::json!({"groups":[{"buckets":[
            {"bucketId":"gemini-5h","window":"weekly","remainingFraction":0.25},
            {"bucketId":"gemini-weekly","remainingFraction":0.9}
        ]}]});
        assert!(
            parse_quota_summary(&raw).is_none(),
            "conflicting buckets target one window"
        );
    }

    #[test]
    fn summary_envelope_and_nested_rpc_fractions_preserve_measurements() {
        // Compatibility contracts from Win-CodexBar's RPC parser, not a live capture.
        for remaining in [
            serde_json::json!({"remainingFraction":0.25}),
            serde_json::json!({"case":"remainingFraction","value":0.25}),
        ] {
            let raw = serde_json::json!({"summary":{"groups":[{"buckets":[
                {"bucketId":"gemini-5h","window":"5h","remaining":remaining},
                {"bucketId":"gemini-weekly","window":"weekly"}
            ]}]}});
            let sections = parse_quota_summary(&raw).unwrap();
            assert_eq!(sections[0].session.as_ref().unwrap().percent, Some(75.0));
            assert_eq!(sections[0].weekly.as_ref().unwrap().percent, None);
        }
        let raw = serde_json::json!({"groups":[{"buckets":[
            {"bucketId":"gemini-5h","remaining":{"case":"other","value":0.25}}
        ]}]});
        assert!(parse_quota_summary(&raw).is_none());
    }

    #[test]
    fn restart_uses_only_the_new_instances_ports_and_token() {
        assert_eq!(
            resolve_endpoint(Some(50001), &[server("bbbbbbbb-2222", &[50002])]),
            EndpointPick::Ready {
                ports: vec![50002],
                token: "bbbbbbbb-2222".into(),
            }
        );
        assert_eq!(
            resolve_endpoint(
                None,
                &[
                    server("aaaaaaaa-1111", &[50001]),
                    server("bbbbbbbb-2222", &[50002])
                ]
            ),
            EndpointPick::Ambiguous
        );
    }

    #[test]
    fn discovery_uses_processes_without_a_log_and_preserves_failures() {
        use std::io::ErrorKind::PermissionDenied;
        let processes = [server("aaaaaaaa-1111", &[50001])];
        for installed in [Ok(false), Err(PermissionDenied)] {
            assert!(matches!(
                discover_endpoint(None, Ok(&processes), installed),
                Ok(EndpointPick::Ready { .. })
            ));
        }
        assert_eq!(
            discover_endpoint(None, Ok(&[]), Ok(false)),
            Err(Observation::NotInstalled)
        );
        assert_eq!(
            discover_endpoint(None, Ok(&[]), Ok(true)),
            Err(Observation::NoReading(ProviderStatus::Closed))
        );
        assert_eq!(
            discover_endpoint(None, Err(PermissionDenied), Ok(false)),
            Err(Observation::NoReading(ProviderStatus::Error))
        );
        assert_eq!(
            discover_endpoint(None, Ok(&[]), Err(PermissionDenied)),
            Err(Observation::NoReading(ProviderStatus::Error))
        );
    }

    #[test]
    fn buckets_keep_their_source_group_identity() {
        let raw = serde_json::json!({"groups":[
            {"displayName":"Gemini Models","buckets":[{"bucketId":"gemini-5h","remainingFraction":0.25}]},
            {"displayName":"Claude and GPT models","buckets":[
                {"bucketId":"gemini-5h","remainingFraction":0.9},
                {"bucketId":"3p-weekly","remainingFraction":0.5}
            ]}
        ]});
        let sections = parse_quota_summary(&raw).unwrap();
        assert_eq!(sections[0].session.as_ref().unwrap().percent, Some(75.0));
        assert_eq!(sections[1].weekly.as_ref().unwrap().percent, Some(50.0));
        assert!(sections[1].session.is_none());
    }

    #[test]
    fn unnamed_mixed_groups_are_ambiguous_not_an_identity_hint() {
        let raw = serde_json::json!({"groups":[{"displayName":"Unknown group","buckets":[
            {"bucketId":"gemini-5h","remainingFraction":0.9},
            {"bucketId":"3p-weekly","remainingFraction":0.5}
        ]}]});
        assert!(parse_quota_summary(&raw).is_none());
    }

    #[test]
    fn groups_without_buckets_do_not_discard_other_valid_quotas() {
        let raw = serde_json::json!({"groups":[
            {"displayName":"Future group"},
            {"displayName":"Gemini 4 Argon","buckets":null},
            {"buckets":[{"bucketId":"gemini-5h","remainingFraction":0.5}]}
        ]});
        let sections = parse_quota_summary(&raw).unwrap();
        assert_eq!(sections.len(), 1);
        assert_eq!(sections[0].session.as_ref().unwrap().percent, Some(50.0));
    }

    #[test]
    fn parsed_windows_keep_block_reset_and_notification_semantics() {
        use crate::providers::{apply, Channel};
        use crate::state::AppState;
        let raw: Value = serde_json::from_str(REAL_RESPONSE).unwrap();
        let now = parse_iso("2026-10-22T00:00:00Z").unwrap();
        let quota = apply(
            None,
            Observation::Reading {
                taken_at: Some(iso(now)),
                sections: parse_quota_summary(&raw).unwrap(),
            },
            now,
        );
        let state = AppState {
            antigravity: quota.clone(),
            ..Default::default()
        };
        assert_eq!(
            Channel::AntigravityGemini.session(&state).unwrap().percent,
            0.0
        );
        assert!(Channel::AntigravityThirdParty.blocks_reset_toast(&state));
        let later = parse_iso("2026-10-25T00:00:00Z").unwrap();
        let kept = apply(quota, Observation::NoReading(ProviderStatus::Error), later).unwrap();
        assert_eq!(kept.status, ProviderStatus::Error);
        assert!(kept.sections[0].session.as_ref().unwrap().rolled_over);
        assert_eq!(kept.sections[0].session.as_ref().unwrap().percent, None);
        assert!(kept.sections[1].blocked);
        assert!(kept.sections[2].session.is_none());
        let recovered = apply(
            Some(kept),
            Observation::Reading {
                taken_at: Some(iso(later)),
                sections: parse_quota_summary(&raw).unwrap(),
            },
            later,
        )
        .unwrap();
        assert_eq!(recovered.status, ProviderStatus::Live);
        assert!(recovered.sections[0].session.as_ref().unwrap().rolled_over);
    }

    /// A real `RetrieveUserQuotaSummary` response from Antigravity 2.16
    /// (descriptions trimmed). No account data in it.
    const REAL_RESPONSE: &str = r#"{"response":{"groups":[
      {"displayName":"Gemini Models","buckets":[
        {"bucketId":"gemini-weekly","window":"weekly","remainingFraction":0.9761623,"resetTime":"2026-10-27T21:11:10Z"},
        {"bucketId":"gemini-5h","window":"5h","remainingFraction":1,"resetTime":"2026-10-23T07:40:54Z"}]},
      {"displayName":"Claude and GPT models","buckets":[
        {"bucketId":"3p-weekly","window":"weekly","remainingFraction":0,"resetTime":"2026-10-27T00:54:20Z"},
        {"bucketId":"3p-5h","window":"5h","remainingFraction":1,"disabled":true,"resetTime":"2026-10-23T07:40:54Z"}]},
      {"displayName":"Gemini 4 Argon","buckets":[
        {"bucketId":"gemini-argon-wtu-weekly","window":"weekly","remainingFraction":1,"resetTime":"2026-10-30T02:40:54Z"}]}
    ]}}"#;

    #[test]
    fn maps_the_real_response_to_three_sections() {
        let raw: Value = serde_json::from_str(REAL_RESPONSE).unwrap();
        let sections = parse_quota_summary(&raw).unwrap();
        assert_eq!(sections.len(), 3);
        let gemini = &sections[0];
        assert_eq!(gemini.id, "gemini");
        assert_eq!(gemini.session.as_ref().unwrap().percent, Some(0.0));
        assert!(!gemini.blocked);
        let weekly = gemini.weekly.as_ref().unwrap();
        assert!((weekly.percent.unwrap() - 2.38377).abs() < 1e-3);
        assert_eq!(
            weekly.resets_at.as_deref(),
            Some("2026-10-27T21:11:10.000Z")
        );
        let third = &sections[1];
        assert_eq!(third.id, "thirdParty");
        assert_eq!(third.weekly.as_ref().unwrap().percent, Some(100.0));
        // A full 5-hour window behind a spent weekly one cannot be used.
        assert_eq!(third.session.as_ref().unwrap().percent, Some(0.0));
        assert!(third.blocked, "`disabled: true` blocks the group");
        let argon = &sections[2];
        assert_eq!(argon.id, "argon");
        assert!(argon.session.is_none(), "Argon has only a weekly bucket");
        assert_eq!(argon.weekly.as_ref().unwrap().percent, Some(0.0));
        assert_eq!(
            argon.weekly.as_ref().unwrap().resets_at.as_deref(),
            Some("2026-10-30T02:40:54.000Z")
        );
    }

    #[test]
    fn unmeasured_and_hostile_buckets() {
        let raw = serde_json::json!({ "groups": [{ "buckets": [
            { "bucketId": "gemini-5h", "resetTime": "2026-10-23T07:40:54Z" },
            { "bucketId": "gemini-weekly", "remainingFraction": -3, "resetTime": "not a date" },
        ]}]});
        let sections = parse_quota_summary(&raw).unwrap();
        let session = sections[0].session.as_ref().unwrap();
        assert_eq!(session.percent, None, "no fraction reads as unknown");
        assert!(session.resets_at.is_some());
        let weekly = sections[0].weekly.as_ref().unwrap();
        assert_eq!(weekly.percent, Some(100.0));
        assert_eq!(weekly.resets_at, None);
        // Absent from the payload: no row at all.
        assert!(sections.iter().all(|s| s.id != "thirdParty"));
        assert!(parse_quota_summary(&serde_json::json!({ "response": {} })).is_none());
        assert!(parse_quota_summary(&serde_json::json!({ "groups": [] })).is_none());
    }

    #[test]
    fn a_response_with_no_usable_value_is_not_a_reading() {
        let raw = serde_json::json!({ "groups": [{ "buckets": [
            { "bucketId": "gemini-5h" },
            { "bucketId": "3p-weekly", "remainingFraction": "half" },
        ]}]});
        assert!(parse_quota_summary(&raw).is_none());
    }

    #[test]
    fn zero_and_full_fractions_are_measurements() {
        let raw = serde_json::json!({ "groups": [{ "buckets": [
            { "bucketId": "gemini-5h", "remainingFraction": 0 },
            { "bucketId": "gemini-weekly", "remainingFraction": 1 },
        ]}]});
        let gemini = &parse_quota_summary(&raw).unwrap()[0];
        assert_eq!(gemini.session.as_ref().unwrap().percent, Some(100.0));
        assert_eq!(gemini.weekly.as_ref().unwrap().percent, Some(0.0));
    }

    #[test]
    fn two_servers_with_different_tokens_are_not_guessed_between() {
        let server = |token: &str| {
            format!("language_server.exe --override_ide_name antigravity --csrf_token {token}")
        };
        let a = server("aaaaaaaa-1111-4222-8333-944455556666");
        let b = server("bbbbbbbb-1111-4222-8333-944455556666");
        let windsurf = "language_server.exe --ide_name windsurf --csrf_token cccccccc-1111";
        assert_eq!(pick_token::<&str>(&[]), TokenPick::None);
        assert_eq!(pick_token(&[windsurf]), TokenPick::None);
        assert_eq!(
            pick_token(&[a.as_str(), windsurf, a.as_str()]),
            TokenPick::One("aaaaaaaa-1111-4222-8333-944455556666".to_string())
        );
        assert_eq!(pick_token(&[a, b]), TokenPick::Ambiguous);
    }

    #[test]
    fn takes_the_newest_logged_port() {
        let log = "\
[2026-10-22 23:20:14.179] [info]    Local:       https://127.0.0.1:62935/
Host bridge server listening on http://127.0.0.1:60106
[2026-10-22 23:22:05.511] [info]    Local:       https://127.0.0.1:50083/
";
        assert_eq!(find_port(log), Some(50083));
        assert_eq!(find_port("https://127.0.0.1:0/"), None);
        assert_eq!(find_port("https://127.0.0.1:99999/"), None);
        assert_eq!(find_port("http://127.0.0.1:60106"), None);
        assert_eq!(find_port("https://evil.example:443/"), None);
    }

    #[test]
    fn takes_the_newest_port_from_language_server_log() {
        let log = "\
I1026 17:22:34.019406 server.go:672] Language server will attempt to listen on host localhost
I1026 17:22:34.033718 server.go:687] Language server listening on random port at 52609 for HTTPS (gRPC)
I1026 17:22:34.033718 server.go:695] Language server listening on random port at 52610 for HTTP
";
        assert_eq!(find_language_server_port(log), Some(52609));
        assert_eq!(find_language_server_port("random port at 0 for HTTPS"), None);
        assert_eq!(find_language_server_port("random port at 70000 for HTTPS"), None);
        assert_eq!(find_language_server_port("random port at 52610 for HTTP"), None);
    }

    #[test]
    fn reads_the_token_only_from_antigravity_servers() {
        let ag = r"C:\Users\x\AppData\Local\Programs\antigravity\resources\bin\language_server.exe --standalone --override_ide_name antigravity --https_server_port 0 --csrf_token 0f8e2c1a-1111-4222-8333-944455556666 --app_data_dir antigravity";
        assert_eq!(
            csrf_token(ag).as_deref(),
            Some("0f8e2c1a-1111-4222-8333-944455556666")
        );
        let ag_quoted = r#"language_server.exe --override_ide_name="antigravity" --csrf_token="0f8e2c1a-1111-4222-8333-944455556666" --app_data_dir="antigravity""#;
        assert_eq!(
            csrf_token(ag_quoted).as_deref(),
            Some("0f8e2c1a-1111-4222-8333-944455556666")
        );
        let ag_single_quotes = r"language_server.exe --override_ide_name 'antigravity' --csrf_token '0f8e2c1a-1111-4222-8333-944455556666'";
        assert_eq!(
            csrf_token(ag_single_quotes).as_deref(),
            Some("0f8e2c1a-1111-4222-8333-944455556666")
        );
        let windsurf = "language_server_windows_x64.exe --ide_name windsurf --csrf_token 0f8e2c1a-1111-4222-8333-944455556666";
        assert_eq!(csrf_token(windsurf), None);
        let injected =
            "language_server.exe --override_ide_name antigravity --csrf_token bad\u{7}token";
        assert_eq!(csrf_token(injected), None);
        assert_eq!(
            csrf_token("language_server.exe --override_ide_name antigravity"),
            None
        );
    }

    #[test]
    fn resolves_endpoint_from_pid_ports_and_disambiguates_two_servers() {
        let proc_with = |token: &str, ports: &[u16]| ServerProcess {
            command_line: format!(
                "language_server.exe --override_ide_name antigravity --csrf_token {token}"
            ),
            ports: ports.to_vec(),
        };
        let a = proc_with("aaaaaaaa-1111-4222-8333-944455556666", &[50083, 60106]);
        let b = proc_with("bbbbbbbb-1111-4222-8333-944455556666", &[51200]);

        assert_eq!(resolve_endpoint(Some(50083), &[]), EndpointPick::Closed);

        // Two servers with different tokens, but the OS TCP table ties 50083 to `a`.
        assert_eq!(
            resolve_endpoint(Some(50083), &[a.clone(), b.clone()]),
            EndpointPick::Ready {
                ports: vec![50083, 60106],
                token: "aaaaaaaa-1111-4222-8333-944455556666".to_string(),
            }
        );

        // When main.log rotated or has no port, falls back to the single server's owned ports.
        assert_eq!(
            resolve_endpoint(None, std::slice::from_ref(&b)),
            EndpointPick::Ready {
                ports: vec![51200],
                token: "bbbbbbbb-1111-4222-8333-944455556666".to_string(),
            }
        );

        // Two servers with different tokens and no matching port: still refuses to guess.
        assert_eq!(
            resolve_endpoint(Some(59999), &[a, b]),
            EndpointPick::Ambiguous
        );
    }
}
