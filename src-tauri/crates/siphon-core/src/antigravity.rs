//! Antigravity quota, read from the running Antigravity 2.x app. The quota
//! lives only in its local `language_server`, which serves a Connect RPC on a
//! loopback HTTPS port with a self-signed certificate and a per-launch CSRF
//! token:
//!
//! * the port: the app logs it to `%APPDATA%\Antigravity\logs\main.log`
//!   (`Local:       https://127.0.0.1:<port>/`) every time it changes;
//! * the token: only on the server's command line (`--csrf_token <uuid>`).
//!   Up to 2.15 the log carried it too; 2.16 stopped writing it there.
//!
//! The binary crate reads the command line and performs the POST; everything
//! that interprets what comes back is here. The server exists only while the
//! app is open, so a closed app is an expected state, not an error.

use std::path::PathBuf;

use serde_json::Value;

use crate::format::parse_iso;
use crate::providers::{iso, ProviderWindow, QuotaSection};

/// Connect path of the quota call, POSTed with a `{}` body.
pub const QUOTA_RPC_PATH: &str =
    "/exa.language_server_pb.LanguageServerService/RetrieveUserQuotaSummary";
pub const CSRF_HEADER: &str = "X-Codeium-Csrf-Token";

/// `%APPDATA%\Antigravity\logs\main.log`. Its presence is what "installed"
/// means for the tab.
pub fn main_log_path() -> Option<PathBuf> {
    let appdata = std::env::var_os("APPDATA")?;
    Some(
        PathBuf::from(appdata)
            .join("Antigravity")
            .join("logs")
            .join("main.log"),
    )
}

/// The newest loopback port the app logged. The host is never taken from the
/// log: the caller always talks to `127.0.0.1`.
pub fn find_port(main_log: &str) -> Option<u16> {
    let re = regex_lite::Regex::new(r"https://127\.0\.0\.1:(\d{1,5})/").ok()?;
    let last = re.captures_iter(main_log).last()?;
    last[1].parse::<u16>().ok().filter(|p| *p != 0)
}

/// The CSRF token from a process command line, but only when that process is
/// Antigravity's server: Windsurf and other Codeium builds run a
/// `language_server` too, and their token must not be sent anywhere.
pub fn csrf_token(command_line: &str) -> Option<String> {
    if !command_line.contains("--override_ide_name antigravity")
        && !command_line.contains("--app_data_dir antigravity")
    {
        return None;
    }
    let re = regex_lite::Regex::new(r"--csrf_token[ =](\S+)").ok()?;
    let token = re.captures(command_line)?[1].to_string();
    // A UUID today. Anything outside this set would not survive as a header
    // value anyway; refusing it here keeps a malformed line from reaching one.
    let plausible = (8..=128).contains(&token.len())
        && token
            .bytes()
            .all(|b| b.is_ascii_alphanumeric() || b == b'-' || b == b'_');
    plausible.then_some(token)
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

/// `RetrieveUserQuotaSummary` → the two sections the UI shows: `gemini`
/// (Gemini Flash / Pro) and `thirdParty` (Claude and GPT models). Other groups
/// (model-specific allowances such as Argon) are left out. `None` when the
/// payload has neither, or when not one of their windows carries a usable
/// value, which the caller reports as an unreadable response.
pub fn parse_quota_summary(raw: &Value) -> Option<Vec<QuotaSection>> {
    let groups = raw
        .pointer("/response/groups")
        .or_else(|| raw.get("groups"))?
        .as_array()?;
    let buckets: Vec<&Value> = groups
        .iter()
        .filter_map(|g| g.get("buckets")?.as_array())
        .flatten()
        .collect();
    let find = |id: &str| {
        buckets
            .iter()
            .find(|b| b.get("bucketId").and_then(Value::as_str) == Some(id))
            .copied()
    };

    let sections: Vec<QuotaSection> = [("gemini", "gemini"), ("thirdParty", "3p")]
        .into_iter()
        .filter_map(|(id, prefix)| {
            let session = find(&format!("{prefix}-5h"));
            let weekly = find(&format!("{prefix}-weekly"));
            if session.is_none() && weekly.is_none() {
                return None;
            }
            // `disabled` sits on the window that cannot be used even though
            // its own fraction may read full (the 5-hour one while the
            // weekly one is spent); it holds back the whole group.
            let blocked = [session, weekly]
                .into_iter()
                .flatten()
                .any(|b| b.get("disabled").and_then(Value::as_bool) == Some(true));
            Some(QuotaSection {
                id: id.to_string(),
                session: session.map(parse_bucket),
                weekly: weekly.map(parse_bucket),
                blocked,
            })
        })
        .collect();
    let measured = sections
        .iter()
        .flat_map(|s| [&s.session, &s.weekly])
        .flatten()
        .any(|w| w.percent.is_some());
    measured.then_some(sections)
}

/// A bucket without `remainingFraction` is unmeasured, not exhausted (sources
/// disagree on what proto3's omitted zero means here, and showing 100% used
/// for a quota nobody measured is the worse mistake), so it keeps its row
/// with no percent.
fn parse_bucket(bucket: &Value) -> ProviderWindow {
    let percent = bucket
        .get("remainingFraction")
        .and_then(Value::as_f64)
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
    fn maps_the_real_response_to_two_sections() {
        let raw: Value = serde_json::from_str(REAL_RESPONSE).unwrap();
        let sections = parse_quota_summary(&raw).unwrap();
        assert_eq!(sections.len(), 2, "Argon is left out");
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
    fn reads_the_token_only_from_antigravity_servers() {
        let ag = r"C:\Users\x\AppData\Local\Programs\antigravity\resources\bin\language_server.exe --standalone --override_ide_name antigravity --https_server_port 0 --csrf_token 0f8e2c1a-1111-4222-8333-944455556666 --app_data_dir antigravity";
        assert_eq!(
            csrf_token(ag).as_deref(),
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
}
