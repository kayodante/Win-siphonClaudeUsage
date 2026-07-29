//! Window-placement geometry shared by the main window and the floating widget.

/// A monitor's logical work area: `(x, y, width, height)`.
pub type MonitorRect = (f64, f64, f64, f64);

/// True when a saved logical position keeps at least half of a `w`×`h` window
/// on one of the connected monitors.
///
/// Multi-monitor aware on purpose: a spot on a secondary display (negative or
/// large coordinates) is perfectly valid, only a spot that lands on no display
/// at all — a monitor that was unplugged since the position was saved — is
/// rejected so the caller can fall back to its default placement. With no
/// monitor information at all, accept the position rather than fight the OS.
pub fn position_is_visible(monitors: &[MonitorRect], x: f64, y: f64, w: f64, h: f64) -> bool {
    if monitors.is_empty() {
        return true;
    }
    monitors.iter().any(|&(mx, my, mw, mh)| {
        x >= mx && y >= my && x <= mx + mw - w * 0.5 && y <= my + mh - h * 0.5
    })
}

#[cfg(test)]
mod tests {
    use super::*;

    // Primary 1920×1080 at the origin plus a secondary to its right.
    const TWO: [MonitorRect; 2] = [(0.0, 0.0, 1920.0, 1080.0), (1920.0, 0.0, 2560.0, 1440.0)];

    #[test]
    fn accepts_a_spot_on_the_primary_monitor() {
        assert!(position_is_visible(&TWO, 100.0, 100.0, 328.0, 732.0));
    }

    #[test]
    fn accepts_a_spot_on_a_secondary_monitor() {
        // The regression: valid on monitor 2, off-screen if only monitor 1 is checked.
        assert!(position_is_visible(&TWO, 3260.0, 368.0, 328.0, 732.0));
    }

    #[test]
    fn rejects_a_spot_on_no_monitor() {
        assert!(!position_is_visible(&TWO, 5200.0, 368.0, 328.0, 732.0));
        assert!(!position_is_visible(&TWO, -400.0, 100.0, 328.0, 732.0));
    }

    #[test]
    fn rejects_a_window_hanging_mostly_off_the_bottom() {
        assert!(!position_is_visible(&TWO, 100.0, 900.0, 328.0, 732.0));
    }

    #[test]
    fn accepts_anything_when_no_monitors_are_known() {
        assert!(position_is_visible(&[], 9000.0, 9000.0, 328.0, 732.0));
    }
}
