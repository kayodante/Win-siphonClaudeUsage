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
    monitors.is_empty() || monitor_containing(monitors, x, y, w, h).is_some()
}

/// The monitor a `w`×`h` window at `x, y` is (mostly) on — the same predicate
/// `position_is_visible` answers yes/no with, kept in one place so the caller
/// can also ask *which* display it landed on and size the window to fit it.
pub fn monitor_containing(
    monitors: &[MonitorRect],
    x: f64,
    y: f64,
    w: f64,
    h: f64,
) -> Option<MonitorRect> {
    monitors.iter().copied().find(|&(mx, my, mw, mh)| {
        x >= mx && y >= my && x <= mx + mw - w * 0.5 && y <= my + mh - h * 0.5
    })
}

/// A `w`×`h` window shrunk to fit inside `monitor`, keeping `EDGE_MARGIN` free
/// on both sides of each axis. Only ever shrinks.
///
/// Physical pixels, so this needs no scale factor: a size stored in logical px
/// is DPI-independent, which means a window that fit a 1920×1080 panel at 100%
/// is taller than the same panel at 150% — the screen lost logical height, the
/// window did not. Without this, a size saved on a large monitor came back
/// hanging off the bottom of a smaller one.
pub fn fit_size(monitor: MonitorRect, w: f64, h: f64) -> (f64, f64) {
    let (_, _, mw, mh) = monitor;
    (
        w.min(mw - EDGE_MARGIN * 2.0).max(1.0),
        h.min(mh - EDGE_MARGIN * 2.0).max(1.0),
    )
}

/// Gap kept between the window and the monitor edge, physical px.
const EDGE_MARGIN: f64 = 16.0;

/// Default placement for a `w`×`h` window: parked against the right edge of
/// `monitor`, `EDGE_MARGIN` in from the top-right corner. Used when nothing is
/// stored yet, or when the saved spot fell off an unplugged display.
pub fn right_edge_position(monitor: MonitorRect, w: f64, h: f64) -> (f64, f64) {
    let (mx, my, mw, mh) = monitor;
    let x = (mx + mw - w - EDGE_MARGIN).max(mx);
    // A window taller than the monitor is pulled up until its bottom edge sits
    // on the monitor's, so the margin never pushes it past `position_is_visible`.
    let y = (my + EDGE_MARGIN).min(my + mh - h).max(my);
    (x, y)
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

    #[test]
    fn parks_at_the_right_edge_of_the_primary_monitor() {
        assert_eq!(
            right_edge_position(TWO[0], 328.0, 732.0),
            (1920.0 - 328.0 - 16.0, 16.0)
        );
    }

    #[test]
    fn works_on_a_monitor_with_a_non_zero_origin() {
        assert_eq!(
            right_edge_position(TWO[1], 328.0, 732.0),
            (1920.0 + 2560.0 - 328.0 - 16.0, 16.0)
        );
    }

    #[test]
    fn a_too_wide_window_clamps_to_the_monitor_origin() {
        let (x, _) = right_edge_position(TWO[0], 3000.0, 732.0);
        assert_eq!(x, TWO[0].0);
    }

    #[test]
    fn names_the_monitor_a_window_sits_on() {
        assert_eq!(
            monitor_containing(&TWO, 3260.0, 368.0, 328.0, 732.0),
            Some(TWO[1])
        );
        assert_eq!(
            monitor_containing(&TWO, 100.0, 100.0, 328.0, 732.0),
            Some(TWO[0])
        );
        assert_eq!(monitor_containing(&TWO, 5200.0, 368.0, 328.0, 732.0), None);
    }

    #[test]
    fn shrinks_a_window_taller_than_its_monitor() {
        // 316×851 logical saved on a big display, restored on a 1920×1080 panel
        // at 150%: 1276 physical px of window against 1080 px of screen.
        let (w, h) = fit_size(TWO[0], 474.0, 1276.0);
        assert_eq!((w, h), (474.0, 1080.0 - 32.0));
    }

    #[test]
    fn leaves_a_window_that_already_fits_alone() {
        assert_eq!(fit_size(TWO[1], 328.0, 732.0), (328.0, 732.0));
    }

    #[test]
    fn a_fitted_window_at_the_right_edge_is_visible() {
        let (w, h) = fit_size(TWO[0], 474.0, 1276.0);
        let (x, y) = right_edge_position(TWO[0], w, h);
        assert!(position_is_visible(&TWO, x, y, w, h));
    }

    #[test]
    fn the_result_is_always_visible_on_its_monitor() {
        let (x, y) = right_edge_position(TWO[1], 328.0, 732.0);
        assert!(position_is_visible(&TWO, x, y, 328.0, 732.0));
    }
}
