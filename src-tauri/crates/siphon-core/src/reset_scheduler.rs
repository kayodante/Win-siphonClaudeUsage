//! Pure decision logic ported from `src/main/resetNotificationScheduler.js`. The
//! timer arithmetic + persistence live in the binary crate; this decides *what*
//! to do given a fresh quota reading and the currently-tracked reset keys.

use chrono::{DateTime, Utc};

use crate::quota::Quota;

/// The i64-ms clamp on JS timers (`MAX_TIMER_DELAY_MS`). The binary crate uses
/// this to re-arm long waits in chunks.
pub const MAX_TIMER_DELAY_MS: i64 = 2_147_483_647;

#[derive(Debug, Clone, PartialEq)]
pub enum ResetDecision {
    /// Nothing to do (percent in the "already tracked" / not-full band).
    NoChange,
    /// Cancel any pending toast and clear persisted state.
    Clear,
    /// Arm a toast for `resets_at`; persist `reset_key`.
    Schedule {
        reset_key: String,
        resets_at: DateTime<Utc>,
    },
}

/// Decide the scheduler action for a new quota reading. Mirrors
/// `updateFromQuota`: below 15% clears, below 100% is a no-op, at 100% schedules
/// for a not-already-tracked/fired reset key.
pub fn decide_update(
    quota: &Quota,
    current_reset_key: Option<&str>,
    last_fired_reset_key: Option<&str>,
) -> ResetDecision {
    let Some(session) = &quota.session else {
        return ResetDecision::NoChange;
    };
    let Some(resets_at_raw) = &session.resets_at else {
        return ResetDecision::NoChange;
    };

    if session.percent < 15.0 {
        return ResetDecision::Clear;
    }
    if session.percent < 100.0 {
        return ResetDecision::NoChange;
    }

    let Ok(resets_at) = DateTime::parse_from_rfc3339(resets_at_raw) else {
        return ResetDecision::NoChange;
    };
    let resets_at = resets_at.with_timezone(&Utc);
    let reset_key = resets_at.format("%Y-%m-%dT%H:%M:%S%.3fZ").to_string();

    if Some(reset_key.as_str()) == current_reset_key
        || Some(reset_key.as_str()) == last_fired_reset_key
    {
        return ResetDecision::NoChange;
    }

    ResetDecision::Schedule {
        reset_key,
        resets_at,
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::quota::Slot;

    fn quota_with(percent: f64, resets_at: Option<&str>) -> Quota {
        Quota {
            session: Some(Slot {
                percent,
                resets_at: resets_at.map(|s| s.to_string()),
            }),
            weekly_all: None,
            extra_usage: None,
        }
    }

    #[test]
    fn clears_below_15() {
        let q = quota_with(10.0, Some("2026-07-06T15:00:00.000Z"));
        assert_eq!(decide_update(&q, None, None), ResetDecision::Clear);
    }

    #[test]
    fn no_change_between_15_and_100() {
        let q = quota_with(80.0, Some("2026-07-06T15:00:00.000Z"));
        assert_eq!(decide_update(&q, None, None), ResetDecision::NoChange);
    }

    #[test]
    fn schedules_at_100() {
        let q = quota_with(100.0, Some("2026-07-06T15:00:00.000Z"));
        match decide_update(&q, None, None) {
            ResetDecision::Schedule { reset_key, .. } => {
                assert_eq!(reset_key, "2026-07-06T15:00:00.000Z");
            }
            other => panic!("expected Schedule, got {other:?}"),
        }
    }

    #[test]
    fn no_reschedule_for_same_key() {
        let q = quota_with(100.0, Some("2026-07-06T15:00:00.000Z"));
        let key = "2026-07-06T15:00:00.000Z";
        assert_eq!(decide_update(&q, Some(key), None), ResetDecision::NoChange);
        assert_eq!(decide_update(&q, None, Some(key)), ResetDecision::NoChange);
    }
}
