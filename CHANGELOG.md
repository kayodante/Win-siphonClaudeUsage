# Changelog

All notable changes to this project are documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project uses [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

Going forward: new changes land under `[Unreleased]`. On each tagged release,
that section is renamed to the version/date and a fresh empty `[Unreleased]`
is added above it.

## [Unreleased]

## [1.5.0] - 2026-07-10

### Added

- `CONTRIBUTING.md`, `SECURITY.md`, `CODE_OF_CONDUCT.md`, `SUPPORT.md`.
- GitHub issue templates (bug report, feature request) and PR template.
- `CODEOWNERS`.
- Bundled fallback pricing for Claude 5 models (`fable-5`, `sonnet-5`) and
  `opus-4-8`, so local usage cost no longer falls back to `$0` when
  `readout-pricing.json` is absent and those models are in the cache.
- ESLint (flat config, correctness-only: `no-unused-vars` / `no-undef`) as the
  second half of `npm run lint`, alongside the existing parse check.
- Settings toggle (System tab) to display quota percentages as *used* (default)
  or *remaining*, applied consistently across the Session/Weekly cards, the
  floating widget, and the tray tooltip/menu, with a localized suffix
  (`75% used` / `25% restante`). Persisted as `display.quotaMode`.
- Privacy mode: an eye toggle in the Settings account card masks the account
  email (`john.doe@gmail.com` → `********@*****.com`) for screenshots and screen
  shares. Persisted as `privacy.maskEmail`.

### Changed

- De-AI-ified README wording.
- Update banner now renders through the i18n layer instead of hardcoded
  `en`/`pt-BR` strings.
- Window bounds are persisted in a single write (`PreferencesService.setMany`)
  instead of four sequential writes per move/resize.

### Removed

- Dead code: unused `headroom-ai` dependency, orphaned i18n keys, an unused
  interval constant, orphaned `.last-updated` CSS, a macOS-only `activate`
  handler, a phantom `installUpdate` argument, and startup `console.log`
  breadcrumbs.

### Fixed

- `initDotMatrix` extracted to its own module (`src/renderer/dotMatrix.js`).

## [1.4.5] - 2026-06-26

### Fixed

- Launch Siphon via `Start-Process` for correct Windows GUI context. The
  `SessionStart` hook now wraps the exe in a PowerShell `Start-Process` call
  so Electron gets a proper detached GUI process — launching the exe
  directly as a child of Claude Code previously prevented the window from
  appearing.
- Hook detection updated to substring match so both old direct-exe entries
  and new `Start-Process` entries are recognized and deduplicated correctly.

## [1.4.3] - 2026-06-25

### Fixed

- Siphon was no longer launching automatically with Claude Code: the
  `SessionStart` hook entry never set a `matcher`, and the CLI stopped
  treating that as a wildcard. Hooks now explicitly set `matcher: "startup"`.
- `enable()`/`disable()` now also clean up any stale duplicate hook entries
  pointing at the same exe (marked or orphaned from older versions).

## [1.4.2] - 2026-06-24

### Changed

- Fallow cleanup: dropped unused `peakHours` exports, annotated Electron
  entry points (false positives), and extracted shared token lifecycle
  (`isExpired` + `refreshIfExpired`) into `tokenLifecycle.js`. No behavior
  change; all 230 tests pass.

## [1.4.0] - 2026-06-22

### Added

- Peak-hours badge: DST-correct window anchored to `America/Los_Angeles`
  (5–11 AM PT) via `Intl`, replacing the old fixed-UTC window.
- Tooltip shows the peak window in local time (`peakHoursLocalRange`).

### Changed

- Docs updated: README peak-hours + launch-with-Claude-Code bullets;
  `docs/api-and-data.md` `SessionStart` hook, integration preference, UA
  bumped to `2.1.121`.

## [1.2.3] - 2026-06-18

### Fixed

- Widget style cards in Settings now resize responsively instead of using a
  fixed width.
- Removed an unused `ruflo` dependency that broke `build:win` by pulling in a
  native module (`better-sqlite3`) incompatible with the Electron build
  toolchain.

## [1.1.0] - 2026-06-18

### Added

- App remembers the main window's position and size, reopening exactly
  where it was left on next launch.

### Fixed

- Worked around an Electron/Windows DPI bug that inflated the window size
  when the saved position was on a secondary monitor with a different scale
  factor.

## [1.0.7] - 2026-06-18

### Added

- Depleted pace badge.
- Winget/portable install docs.

### Fixed

- Replaced `shell.openPath` with a direct spawn for the update installer
  (security hardening).

## [1.0.5] - 2026-06-17

Merged PRs with improvements and fixes.

## [1.0.0] - 2026-06-09

### Fixed

- Fixed winget arch override and enforced artifact name in the build.

[Unreleased]: https://github.com/kayodante/Win-siphonClaudeUsage/compare/v1.4.5...HEAD
[1.4.5]: https://github.com/kayodante/Win-siphonClaudeUsage/compare/v1.4.3...v1.4.5
[1.4.3]: https://github.com/kayodante/Win-siphonClaudeUsage/compare/v1.4.2...v1.4.3
[1.4.2]: https://github.com/kayodante/Win-siphonClaudeUsage/compare/v1.4.0...v1.4.2
[1.4.0]: https://github.com/kayodante/Win-siphonClaudeUsage/compare/v1.2.3...v1.4.0
[1.2.3]: https://github.com/kayodante/Win-siphonClaudeUsage/compare/v1.1.0...v1.2.3
[1.1.0]: https://github.com/kayodante/Win-siphonClaudeUsage/compare/v1.0.7...v1.1.0
[1.0.7]: https://github.com/kayodante/Win-siphonClaudeUsage/compare/v1.0.5...v1.0.7
[1.0.5]: https://github.com/kayodante/Win-siphonClaudeUsage/compare/v1.0.0...v1.0.5
[1.0.0]: https://github.com/kayodante/Win-siphonClaudeUsage/releases/tag/v1.0.0
