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
use crate::state::AppState;

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

/// One session + weekly pair. Codex has one (`codex`); Antigravity has two
/// (`gemini`, `thirdParty`), each with its own windows.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct QuotaSection {
    pub id: String,
    pub session: Option<Slot>,
    pub weekly: Option<Slot>,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct ProviderQuota {
    pub status: ProviderStatus,
    /// When the reading was taken (ISO-8601), not when Siphon last looked.
    pub updated_at: Option<String>,
    pub sections: Vec<QuotaSection>,
}

impl ProviderQuota {
    pub fn section(&self, id: &str) -> Option<&QuotaSection> {
        self.sections.iter().find(|s| s.id == id)
    }
}

/// A window whose reset already passed has rolled over, whatever the last
/// reading said. Both sources go quiet between readings (Codex until its next
/// turn, Antigravity while closed), so this is what keeps an idle provider
/// from showing yesterday's 100%.
pub fn normalize_slot(slot: Slot, now: DateTime<Utc>) -> Slot {
    match slot.resets_at.as_deref().and_then(parse_iso) {
        Some(at) if at <= now => Slot {
            percent: 0.0,
            resets_at: None,
        },
        _ => slot,
    }
}

pub fn normalize_sections(sections: &mut [QuotaSection], now: DateTime<Utc>) {
    for section in sections {
        section.session = section.session.take().map(|s| normalize_slot(s, now));
        section.weekly = section.weekly.take().map(|s| normalize_slot(s, now));
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
                t("provider.antigravityThirdParty", lang)
            )),
        }
    }

    /// The session window this channel watches.
    pub fn session(self, state: &AppState) -> Option<&Slot> {
        let (provider, section) = match self {
            Channel::Claude => return state.quota.as_ref()?.session.as_ref(),
            Channel::Codex => (state.codex.as_ref(), "codex"),
            Channel::AntigravityGemini => (state.antigravity.as_ref(), "gemini"),
            Channel::AntigravityThirdParty => (state.antigravity.as_ref(), "thirdParty"),
        };
        provider?.section(section)?.session.as_ref()
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

    fn slot(percent: f64, resets_at: Option<&str>) -> Slot {
        Slot {
            percent,
            resets_at: resets_at.map(str::to_string),
        }
    }

    #[test]
    fn a_passed_reset_rolls_the_window_over() {
        let now = Utc.with_ymd_and_hms(2026, 10, 22, 12, 0, 0).unwrap();
        let past = slot(100.0, Some("2026-10-22T11:59:59.000Z"));
        assert_eq!(normalize_slot(past, now), slot(0.0, None));
        let future = slot(67.0, Some("2026-10-22T13:00:00.000Z"));
        assert_eq!(normalize_slot(future.clone(), now), future);
        // No reset time: nothing to compare against, keep the reading.
        assert_eq!(normalize_slot(slot(40.0, None), now), slot(40.0, None));
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
    fn channels_read_their_own_session() {
        let section = |id: &str, pct: f64| QuotaSection {
            id: id.to_string(),
            session: Some(slot(pct, None)),
            weekly: None,
        };
        let provider = |sections| ProviderQuota {
            status: ProviderStatus::Live,
            updated_at: None,
            sections,
        };
        let state = AppState {
            codex: Some(provider(vec![section("codex", 10.0)])),
            antigravity: Some(provider(vec![
                section("gemini", 20.0),
                section("thirdParty", 30.0),
            ])),
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
