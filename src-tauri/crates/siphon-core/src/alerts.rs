//! Port of `src/main/usageAlerts.js`. Pure threshold-crossing detector: feed it
//! successive session percents and it returns the notifications to fire. The
//! binary crate owns the actual toast delivery.

use crate::i18n::t;

/// A resolved notification (already localized) to display.
#[derive(Debug, Clone, PartialEq)]
pub struct Alert {
    pub title: String,
    pub body: String,
}

/// Tracks the last-known session percent across refreshes, exactly like the
/// `lastKnownSessionPercent` field.
#[derive(Default)]
pub struct UsageAlertService {
    last_known_session_percent: Option<f64>,
}

impl UsageAlertService {
    pub fn new() -> Self {
        Self::default()
    }

    /// Returns the alerts to fire for this state transition. `expire_alert` and
    /// `limit_alert` are the user's toggles; `lang` selects the strings.
    pub fn check(
        &mut self,
        percent: Option<f64>,
        expire_alert: bool,
        limit_alert: bool,
        lang: &str,
    ) -> Vec<Alert> {
        let Some(percent) = percent else {
            return Vec::new();
        };
        let prev = self.last_known_session_percent;
        self.last_known_session_percent = Some(percent);

        let Some(prev) = prev else {
            return Vec::new();
        };

        let mut alerts = Vec::new();
        if expire_alert && prev < 100.0 && percent >= 100.0 {
            alerts.push(Alert {
                title: t("notification.expireTitle", lang),
                body: t("notification.expireBody", lang),
            });
        }
        if limit_alert {
            if prev < 90.0 && percent >= 90.0 {
                alerts.push(Alert {
                    title: t("alert.critical.title", lang),
                    body: t("alert.critical.body", lang),
                });
            } else if prev < 70.0 && percent >= 70.0 {
                alerts.push(Alert {
                    title: t("alert.highUsage.title", lang),
                    body: t("alert.highUsage.body", lang),
                });
            }
        }
        alerts
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn no_alert_on_first_reading() {
        let mut svc = UsageAlertService::new();
        assert!(svc.check(Some(95.0), true, true, "en").is_empty());
    }

    #[test]
    fn fires_70_then_90_crossings() {
        let mut svc = UsageAlertService::new();
        svc.check(Some(50.0), false, true, "en"); // seed
        let a = svc.check(Some(75.0), false, true, "en");
        assert_eq!(a.len(), 1);
        assert_eq!(a[0].title, "High usage");
        let b = svc.check(Some(92.0), false, true, "en");
        assert_eq!(b[0].title, "Critical usage");
    }

    #[test]
    fn expire_alert_on_100() {
        let mut svc = UsageAlertService::new();
        svc.check(Some(99.0), true, false, "en");
        let a = svc.check(Some(100.0), true, false, "en");
        assert_eq!(a[0].title, "Session expired");
    }

    #[test]
    fn respects_toggles_off() {
        let mut svc = UsageAlertService::new();
        svc.check(Some(50.0), false, false, "en");
        assert!(svc.check(Some(100.0), false, false, "en").is_empty());
    }
}
