//! Pure decision logic ported from `src/main/resetNotificationScheduler.js`. The
//! timer arithmetic + persistence live in the binary crate; this decides *what*
//! to do given a fresh quota reading and the currently-tracked reset keys.

use chrono::{DateTime, Utc};

use crate::quota::Quota;

/// Max chunk for one timer sleep. The binary crate re-checks the wall clock
/// (and cancellation) on every wake, so a system suspend can delay the toast
/// by at most one chunk instead of indefinitely.
pub const RESET_POLL_CHUNK_MS: i64 = 60_000;

/// Milliseconds to sleep before re-checking, or `None` when `resets_at` is due.
pub fn next_sleep_ms(
    now: DateTime<Utc>,
    resets_at: DateTime<Utc>,
) -> Option<u64> {
    let remaining = (resets_at - now).num_milliseconds();
    if remaining <= 0 {
        return None;
    }
    Some(remaining.min(RESET_POLL_CHUNK_MS) as u64)
}

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

    #[test]
    fn next_sleep_is_none_when_due_or_past() {
        use chrono::TimeZone;
        let now = Utc.with_ymd_and_hms(2026, 7, 6, 15, 0, 0).unwrap();
        assert_eq!(next_sleep_ms(now, now), None);
        assert_eq!(next_sleep_ms(now, now - chrono::Duration::seconds(5)), None);
    }

    #[test]
    fn next_sleep_clamps_to_poll_chunk() {
        use chrono::TimeZone;
        let now = Utc.with_ymd_and_hms(2026, 7, 6, 12, 0, 0).unwrap();
        let far = now + chrono::Duration::hours(5);
        assert_eq!(next_sleep_ms(now, far), Some(RESET_POLL_CHUNK_MS as u64));
        let near = now + chrono::Duration::seconds(10);
        assert_eq!(next_sleep_ms(now, near), Some(10_000));
    }
}
