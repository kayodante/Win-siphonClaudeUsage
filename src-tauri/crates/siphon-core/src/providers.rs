//! Quota for the providers Siphon reads besides Claude (Codex, Antigravity),
//! and the notification channels every provider's session quota feeds. The
//! readers live in `codex.rs` / `antigravity.rs`; this is the shape they share
//! and the state the renderer gets under `state.codex` / `state.antigravity`.

use chrono::{DateTime, Utc};
use serde::{Deserialize, Serialize};

use crate::alerts::Alert;
use crate::format::parse_iso;
use crate::i18n::t;
use crate::quota::Slot;
use crate::state::{AppState, PeriodStats};

/// `live`: the last read succeeded. `closed`: the source is not running (the
/// Antigravity app is closed), so `sections` holds the last known reading.
/// `error`: the source answered with something Siphon could not read.
#[derive(Debug, Clone, Copy, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub enum ProviderStatus {
    Live,
    Closed,
    Error,
}

/// One quota window as the source reported it. `percent: None` is a window
/// the source lists but did not measure. `rolled_over` is one whose reset
/// passed after the reading: the old percent no longer applies and the new
/// window's is not known until the source reports again.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct ProviderWindow {
    pub percent: Option<f64>,
    pub resets_at: Option<String>,
    #[serde(default)]
    pub rolled_over: bool,
}

impl ProviderWindow {
    pub fn measured(percent: f64, resets_at: Option<String>) -> Self {
        ProviderWindow {
            percent: Some(percent),
            resets_at,
            rolled_over: false,
        }
    }

    /// The window as the alert and reset logic see it. A rolled-over window
    /// counts as 0%, the same as the window that just started, so the next
    /// reading's crossings are measured from zero.
    pub fn slot(&self) -> Option<Slot> {
        if self.rolled_over {
            return Some(Slot {
                percent: 0.0,
                resets_at: None,
            });
        }
        Some(Slot {
            percent: self.percent?,
            resets_at: self.resets_at.clone(),
        })
    }
}

/// One session + weekly pair. Codex has one (`codex`); Antigravity has two
/// (`gemini`, `thirdParty`), each with its own windows.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct QuotaSection {
    pub id: String,
    /// `None`: the source does not offer this window at all.
    pub session: Option<ProviderWindow>,
    pub weekly: Option<ProviderWindow>,
    /// The source says this group cannot be used right now (Antigravity's
    /// `disabled`), whatever its percentages read.
    #[serde(default)]
    pub blocked: bool,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct ProviderQuota {
    pub status: ProviderStatus,
    /// When the reading was taken (ISO-8601), not when Siphon last looked.
    pub updated_at: Option<String>,
    pub sections: Vec<QuotaSection>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub today_stats: Option<PeriodStats>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub month_stats: Option<PeriodStats>,
}

impl ProviderQuota {
    pub fn section(&self, id: &str) -> Option<&QuotaSection> {
        self.sections.iter().find(|s| s.id == id)
    }
}

/// What one attempt to read a provider found.
#[derive(Debug, Clone, PartialEq)]
pub enum Observation {
    /// The source is gone (no Codex `sessions` dir; no Antigravity server or
    /// known installation/data paths after successful inspection): the
    /// tab goes with it.
    NotInstalled,
    /// A reading, taken at `taken_at` (ISO-8601; `None` when the source did
    /// not date it).
    Reading {
        taken_at: Option<String>,
        sections: Vec<QuotaSection>,
    },
    /// Installed, but nothing new this attempt: the app is closed, the read
    /// failed, or the logs hold no reading yet.
    NoReading(ProviderStatus),
}

/// The one place a provider's state changes. Nothing but `NotInstalled`
/// discards what Siphon already knew, and a reading only replaces one it can
/// prove is older, so a failed read, an empty search or an older log line
/// never makes the numbers move backwards or vanish.
pub fn apply(
    previous: Option<ProviderQuota>,
    observation: Observation,
    now: DateTime<Utc>,
) -> Option<ProviderQuota> {
    let mut next = match observation {
        Observation::NotInstalled => return None,
        Observation::NoReading(status) => match previous {
            Some(previous) => ProviderQuota { status, ..previous },
            None => ProviderQuota {
                status,
                updated_at: None,
                sections: Vec::new(),
                today_stats: None,
                month_stats: None,
            },
        },
        Observation::Reading { taken_at, sections } => match previous {
            Some(previous) if !is_newer(taken_at.as_deref(), previous.updated_at.as_deref()) => {
                ProviderQuota {
                    status: ProviderStatus::Live,
                    ..previous
                }
            }
            Some(previous) => ProviderQuota {
                status: ProviderStatus::Live,
                updated_at: taken_at,
                sections,
                today_stats: previous.today_stats,
                month_stats: previous.month_stats,
            },
            None => ProviderQuota {
                status: ProviderStatus::Live,
                updated_at: taken_at,
                sections,
                today_stats: None,
                month_stats: None,
            },
        },
    };
    normalize_sections(&mut next.sections, now);
    Some(next)
}

/// An undated reading never replaces a dated one; equal stamps are the same
/// reading read twice.
fn is_newer(fresh: Option<&str>, known: Option<&str>) -> bool {
    match (fresh.and_then(parse_iso), known.and_then(parse_iso)) {
        (_, None) => true,
        (Some(fresh), Some(known)) => fresh > known,
        (None, Some(_)) => false,
    }
}

/// A window whose reset already passed has rolled over, whatever the last
/// reading said. Both sources go quiet between readings (Codex until its next
/// turn, Antigravity while closed), so this is what keeps an idle provider
/// from showing yesterday's 100%, without passing a guess off as a reading.
/// `resets_at` stays so re-normalizing is a no-op.
pub fn normalize_window(window: ProviderWindow, now: DateTime<Utc>) -> ProviderWindow {
    match window.resets_at.as_deref().and_then(parse_iso) {
        Some(at) if at <= now => ProviderWindow {
            percent: None,
            rolled_over: true,
            ..window
        },
        _ => window,
    }
}

pub fn normalize_sections(sections: &mut [QuotaSection], now: DateTime<Utc>) {
    for section in sections {
        section.session = section.session.take().map(|w| normalize_window(w, now));
        section.weekly = section.weekly.take().map(|w| normalize_window(w, now));
        // The block Antigravity reports lasts as long as the weekly window;
        // once that rolls over, the old reading no longer says it holds.
        if section.weekly.as_ref().is_some_and(|w| w.rolled_over) {
            section.blocked = false;
        }
    }
}

/// ISO string in the exact form `quota.rs` emits, so `new Date()` and the
/// reset scheduler's key comparison see the same text for the same instant.
pub fn iso(at: DateTime<Utc>) -> String {
    at.format("%Y-%m-%dT%H:%M:%S%.3fZ").to_string()
}

/// A session quota that gets its own threshold alerts and reset toast.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum Channel {
    Claude,
    Codex,
    AntigravityGemini,
    AntigravityThirdParty,
}

impl Channel {
    pub const ALL: [Channel; 4] = [
        Channel::Claude,
        Channel::Codex,
        Channel::AntigravityGemini,
        Channel::AntigravityThirdParty,
    ];

    pub fn id(self) -> &'static str {
        match self {
            Channel::Claude => "claude",
            Channel::Codex => "codex",
            Channel::AntigravityGemini => "antigravityGemini",
            Channel::AntigravityThirdParty => "antigravityThirdParty",
        }
    }

    /// The renderer tab (`claude`, `codex`, `antigravity`) this channel belongs to.
    pub const fn provider_id(self) -> &'static str {
        match self {
            Channel::Claude => "claude",
            Channel::Codex => "codex",
            Channel::AntigravityGemini | Channel::AntigravityThirdParty => "antigravity",
        }
    }

    /// Claude keeps the file it always had, so an armed reset survives the
    /// upgrade without a migration.
    pub fn reset_file(self) -> String {
        match self {
            Channel::Claude => "reset-notification.json".to_string(),
            other => format!("reset-notification-{}.json", other.id()),
        }
    }

    /// Prefix for the toasts. `None` for Claude, whose strings name it already.
    pub fn label(self, lang: &str) -> Option<String> {
        match self {
            Channel::Claude => None,
            Channel::Codex => Some("Codex".to_string()),
            Channel::AntigravityGemini => Some("Antigravity · Gemini".to_string()),
            Channel::AntigravityThirdParty => Some(format!(
                "Antigravity · {}",
                t("provider.antigravity.thirdParty", lang)
            )),
        }
    }

    fn section(self, state: &AppState) -> Option<&QuotaSection> {
        let (provider, section) = match self {
            Channel::Claude => return None,
            Channel::Codex => (state.codex.as_ref(), "codex"),
            Channel::AntigravityGemini => (state.antigravity.as_ref(), "gemini"),
            Channel::AntigravityThirdParty => (state.antigravity.as_ref(), "thirdParty"),
        };
        provider?.section(section)
    }

    /// The session window this channel watches, as the alert and reset logic
    /// read it (`ProviderWindow::slot`).
    pub fn session(self, state: &AppState) -> Option<Slot> {
        match self {
            Channel::Claude => state.quota.as_ref()?.session.clone(),
            _ => self.section(state)?.session.as_ref()?.slot(),
        }
    }

    /// A session reset only frees the provider when nothing else holds it: a
    /// blocked group or a spent weekly window keeps it unusable, so the reset
    /// toast would promise something that is not true.
    pub fn blocks_reset_toast(self, state: &AppState) -> bool {
        self.section(state).is_some_and(|s| {
            s.blocked
                || s.weekly
                    .as_ref()
                    .and_then(|w| w.percent)
                    .is_some_and(|p| p >= 100.0)
        })
    }

    /// Every channel plays the reset sound when reset toasts/sounds are enabled.
    pub fn plays_reset_sound(self) -> bool {
        true
    }

    pub fn reset_toast(self, lang: &str) -> Alert {
        match self.label(lang) {
            None => Alert {
                title: t("notification.resetTitle", lang),
                body: t("notification.resetBody", lang),
            },
            Some(label) => Alert {
                title: t("notification.providerResetTitle", lang).replace("{provider}", &label),
                body: t("notification.providerResetBody", lang).replace("{provider}", &label),
            },
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use chrono::TimeZone;

    fn window(percent: f64, resets_at: Option<&str>) -> ProviderWindow {
        ProviderWindow::measured(percent, resets_at.map(str::to_string))
    }

    fn section(id: &str, session: Option<ProviderWindow>) -> QuotaSection {
        QuotaSection {
            id: id.to_string(),
            session,
            weekly: None,
            blocked: false,
        }
    }

    fn reading(taken_at: &str, percent: f64) -> Observation {
        Observation::Reading {
            taken_at: Some(taken_at.to_string()),
            sections: vec![section("codex", Some(window(percent, None)))],
        }
    }

    fn now() -> DateTime<Utc> {
        Utc.with_ymd_and_hms(2026, 10, 22, 12, 0, 0).unwrap()
    }

    fn session_percent(quota: &Option<ProviderQuota>) -> Option<f64> {
        quota.as_ref()?.sections[0].session.as_ref()?.percent
    }

    #[test]
    fn a_passed_reset_rolls_the_window_over_without_inventing_a_reading() {
        let past = window(100.0, Some("2026-10-22T11:59:59.000Z"));
        let rolled = normalize_window(past, now());
        assert!(rolled.rolled_over);
        assert_eq!(rolled.percent, None, "the new window is not measured");
        assert_eq!(
            normalize_window(rolled.clone(), now()),
            rolled,
            "idempotent"
        );
        // The alert and reset logic still see a fresh window.
        assert_eq!(
            rolled.slot(),
            Some(Slot {
                percent: 0.0,
                resets_at: None
            })
        );

        let future = window(67.0, Some("2026-10-22T13:00:00.000Z"));
        assert_eq!(normalize_window(future.clone(), now()), future);
        // No reset time: nothing to compare against, keep the reading.
        assert_eq!(
            normalize_window(window(40.0, None), now()),
            window(40.0, None)
        );
    }

    #[test]
    fn an_unmeasured_window_gives_the_alert_logic_nothing() {
        let unknown = ProviderWindow {
            percent: None,
            resets_at: None,
            rolled_over: false,
        };
        assert_eq!(unknown.slot(), None);
    }

    #[test]
    fn a_weekly_rollover_lifts_the_reported_block() {
        let mut sections = vec![QuotaSection {
            weekly: Some(window(100.0, Some("2026-10-22T11:00:00.000Z"))),
            blocked: true,
            ..section("thirdParty", Some(window(0.0, None)))
        }];
        normalize_sections(&mut sections, now());
        assert!(!sections[0].blocked);
    }

    #[test]
    fn an_older_reading_never_replaces_a_newer_one() {
        let newer = apply(None, reading("2026-10-22T11:05:00.000Z", 60.0), now());
        let after = apply(
            newer.clone(),
            reading("2026-10-22T11:00:00.000Z", 40.0),
            now(),
        );
        assert_eq!(session_percent(&after), Some(60.0));
        assert_eq!(after.unwrap().updated_at, newer.unwrap().updated_at);
    }

    #[test]
    fn a_newer_reading_replaces_and_an_undated_one_does_not() {
        let known = apply(None, reading("2026-10-22T11:00:00.000Z", 40.0), now());
        let newer = apply(
            known.clone(),
            reading("2026-10-22T11:05:00.000Z", 60.0),
            now(),
        );
        assert_eq!(session_percent(&newer), Some(60.0));

        let undated = Observation::Reading {
            taken_at: None,
            sections: vec![section("codex", Some(window(90.0, None)))],
        };
        assert_eq!(
            session_percent(&apply(known, undated.clone(), now())),
            Some(40.0)
        );
        assert_eq!(session_percent(&apply(None, undated, now())), Some(90.0));
    }

    #[test]
    fn no_reading_keeps_the_numbers_and_reports_why() {
        let known = apply(None, reading("2026-10-22T11:00:00.000Z", 40.0), now());
        let failed = apply(
            known.clone(),
            Observation::NoReading(ProviderStatus::Error),
            now(),
        );
        assert_eq!(failed.as_ref().unwrap().status, ProviderStatus::Error);
        assert_eq!(session_percent(&failed), Some(40.0));
        // Recovery clears the status even when the reading is the same one.
        let recovered = apply(failed, reading("2026-10-22T11:00:00.000Z", 40.0), now());
        assert_eq!(recovered.unwrap().status, ProviderStatus::Live);

        // Nothing known yet: the tab still shows, with the reason and no rows.
        let first = apply(None, Observation::NoReading(ProviderStatus::Closed), now()).unwrap();
        assert_eq!(first.status, ProviderStatus::Closed);
        assert!(first.sections.is_empty());

        assert_eq!(apply(known, Observation::NotInstalled, now()), None);
    }

    #[test]
    fn kept_readings_still_roll_over() {
        let known = apply(
            None,
            Observation::Reading {
                taken_at: Some("2026-10-22T09:00:00.000Z".to_string()),
                sections: vec![section(
                    "codex",
                    Some(window(80.0, Some("2026-10-22T11:30:00.000Z"))),
                )],
            },
            Utc.with_ymd_and_hms(2026, 10, 22, 10, 0, 0).unwrap(),
        );
        assert_eq!(session_percent(&known), Some(80.0));
        let later = apply(known, Observation::NoReading(ProviderStatus::Live), now()).unwrap();
        assert!(later.sections[0].session.as_ref().unwrap().rolled_over);
    }

    #[test]
    fn all_channels_play_the_reset_sound() {
        for channel in Channel::ALL {
            assert!(channel.plays_reset_sound());
        }
    }

    #[test]
    fn a_blocked_or_spent_weekly_group_suppresses_the_reset_toast() {
        let provider = |sections| ProviderQuota {
            status: ProviderStatus::Live,
            updated_at: None,
            sections,
            today_stats: None,
            month_stats: None,
        };
        let mut blocked = section("thirdParty", Some(window(0.0, None)));
        blocked.blocked = true;
        let mut spent = section("gemini", Some(window(100.0, None)));
        spent.weekly = Some(window(100.0, Some("2026-10-27T00:00:00.000Z")));
        let state = AppState {
            codex: Some(provider(vec![section("codex", Some(window(100.0, None)))])),
            antigravity: Some(provider(vec![spent, blocked])),
            ..AppState::default()
        };
        assert!(!Channel::Claude.blocks_reset_toast(&state));
        assert!(!Channel::Codex.blocks_reset_toast(&state));
        assert!(Channel::AntigravityGemini.blocks_reset_toast(&state));
        assert!(Channel::AntigravityThirdParty.blocks_reset_toast(&state));
    }

    #[test]
    fn all_lists_channels_in_declaration_order() {
        // The controller indexes its per-channel state by `channel as usize`.
        for (i, channel) in Channel::ALL.iter().enumerate() {
            assert_eq!(*channel as usize, i);
        }
    }

    #[test]
    fn claude_keeps_its_reset_file_and_others_get_their_own() {
        assert_eq!(Channel::Claude.reset_file(), "reset-notification.json");
        assert_eq!(Channel::Codex.reset_file(), "reset-notification-codex.json");
        let files: std::collections::HashSet<_> =
            Channel::ALL.iter().map(|c| c.reset_file()).collect();
        assert_eq!(files.len(), Channel::ALL.len());
    }

    #[test]
    fn channels_map_to_their_renderer_provider_tab() {
        assert_eq!(Channel::Claude.provider_id(), "claude");
        assert_eq!(Channel::Codex.provider_id(), "codex");
        assert_eq!(Channel::AntigravityGemini.provider_id(), "antigravity");
        assert_eq!(Channel::AntigravityThirdParty.provider_id(), "antigravity");
    }

    #[test]
    fn channels_read_their_own_session() {
        let at = |id: &str, pct: f64| section(id, Some(window(pct, None)));
        let provider = |sections| ProviderQuota {
            status: ProviderStatus::Live,
            updated_at: None,
            sections,
            today_stats: None,
            month_stats: None,
        };
        let state = AppState {
            codex: Some(provider(vec![at("codex", 10.0)])),
            antigravity: Some(provider(vec![at("gemini", 20.0), at("thirdParty", 30.0)])),
            ..AppState::default()
        };
        let pct = |c: Channel| c.session(&state).map(|s| s.percent);
        assert_eq!(pct(Channel::Claude), None);
        assert_eq!(pct(Channel::Codex), Some(10.0));
        assert_eq!(pct(Channel::AntigravityGemini), Some(20.0));
        assert_eq!(pct(Channel::AntigravityThirdParty), Some(30.0));
    }

    #[test]
    fn reset_toasts_name_the_provider() {
        assert_eq!(
            Channel::Claude.reset_toast("en").title,
            "Claude session reset"
        );
        assert_eq!(
            Channel::Codex.reset_toast("en").title,
            "Codex session reset"
        );
        assert_eq!(
            Channel::AntigravityThirdParty.reset_toast("pt-BR").title,
            "Sessão do Antigravity · Claude e GPT reiniciada"
        );
        for lang in ["en", "pt-BR", "ja", "ko"] {
            let toast = Channel::Codex.reset_toast(lang);
            assert!(toast.title.contains("Codex") && toast.body.contains("Codex"));
        }
    }
}
