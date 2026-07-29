//! Window-placement geometry shared by the main window and the floating widget.
//!
//! Everything here is in **physical** pixels, in the OS virtual-desktop space.
//! Logical (DPI-scaled) coordinates are per-monitor by definition, so on a
//! mixed-DPI setup — a 100% external monitor next to a 125% laptop panel —
//! there is no global logical space to save a position in: dividing a global
//! offset by one monitor's scale factor lands the window somewhere else
//! entirely. Physical pixels are the one coordinate space every monitor shares.

/// A monitor's physical work area: `(x, y, width, height)`.
pub type MonitorRect = (f64, f64, f64, f64);

/// Windows parks hidden and minimized windows at `-32000, -32000` and reports
/// it through a real move event. The cutoff sits well short of that so it also
/// catches values an older build wrote after dividing by a scale factor
/// (`-32000 / 1.25 = -25600`), while staying far past any real arrangement —
/// reaching `-10000` would take more than 10000px of displays left of the
/// primary.
const SENTINEL_LIMIT: f64 = -10000.0;

/// True when a move event is Windows' hide/minimize sentinel rather than a real
/// position. Persisting one of these loses the window's actual spot, so both
/// move handlers drop the event instead of writing it to preferences.
pub fn position_is_sentinel(x: f64, y: f64) -> bool {
    x <= SENTINEL_LIMIT || y <= SENTINEL_LIMIT
}

/// True when a saved physical position keeps at least half of a `w`×`h` window
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
    fn detects_the_windows_hide_sentinel() {
        assert!(position_is_sentinel(-32000.0, -32000.0));
        // Scaled by an old build that divided by a 125% scale factor.
        assert!(position_is_sentinel(-25600.0, -25600.0));
        // A window dragged onto a monitor left of the primary is not a sentinel.
        assert!(!position_is_sentinel(-1920.0, 100.0));
        assert!(!position_is_sentinel(3257.0, 369.0));
    }

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
