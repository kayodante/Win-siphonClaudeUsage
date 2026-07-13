# Changelog

All notable changes to this project are documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project uses [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

Going forward: new changes land under `[Unreleased]`. On each tagged release,
that section is renamed to the version/date and a fresh empty `[Unreleased]`
is added above it.

## [Unreleased]

## [1.7.3] - 2026-07-12

### Fixed
- The main window now remembers its position across a full quit and relaunch,
  not just hide-to-tray. The position is saved on drag and restored before the
  window is first shown, clamped to the primary monitor so a stale off-screen
  spot self-heals to the default. (The Tauri migration only persisted the
  floating widget's position.)

## [1.7.2] - 2026-07-12

### Fixed
- Restored the automatic update check (lost in the 1.7.0 Tauri migration):
  the app now checks GitHub releases 15 s after boot and every 6 hours, and
  the in-app update banner works again.
- Updater downloads now have connect/read timeouts and no longer spam
  progress events.

### Changed
- Webview capabilities reduced to the minimum the renderer actually uses
  (defense in depth; no user-visible change).
- Removed dead code left over from the migration.

## [1.7.1] - 2026-07-12

### Fixed

- Reset toast timers are now cancelable: rescheduling, sign-out, or disabling
  the notification no longer leaves a stale toast armed, and system suspend
  can delay the toast by at most one minute.
- Local usage refresh no longer holds the state lock during JSONL parsing
  (UI could freeze on large first parses) and runs off the async runtime.
- `settings.json` integration no longer panics on a corrupt file and refuses
  to edit hooks when the app's own executable path is unknown (previously it
  could remove the user's other SessionStart hooks).
- The stored refresh token is preserved when a token refresh response omits
  a new one (prevented forced re-logins).
- Removed latent panics on preference-path traversal and on building the
  Authorization header from a tampered credentials file.
- Floating-widget drags now persist their position once per burst instead of
  writing preferences.json dozens of times per second.

## [1.7.0] - 2026-07-11

Runtime migration: Siphon now ships as a native **Rust/Tauri 2** app instead of
Electron. The user-facing app is unchanged — same tray UI, cards, floating
widget, notifications, OAuth sign-in, and reset scheduler — but it runs on a
much smaller, faster WebView2-based backend. The in-app updater ships the same
`Siphon.Setup.<version>.exe` installer, so existing installs update in place.

### Changed

- Backend rewritten from the Electron main process (Node/JS) to Rust/Tauri 2.
  Cross-platform logic (usage parsing, pricing, OAuth/PKCE, quota, preferences,
  reset scheduler) now lives in the `siphon-core` crate with its own tests; the
  Windows integration (tray, notifications, WebView2, DPAPI credentials) is in
  the `src-tauri` Tauri binary.
- The renderer is unchanged and now talks to the Rust backend through
  `src/renderer/siphonBridge.js`, which re-creates the exact `window.siphon.*`
  IPC surface on top of Tauri's global API.
- Installer is now produced by Tauri's NSIS bundler (`npm run build:win` →
  `cargo tauri build`), repackaged to `Siphon.Setup.<version>.exe` with a
  `.sha256` sidecar by `scripts/pack-release.ps1`.

### Removed

- The entire Electron implementation: `src/main/` (main process + preload),
  `electron-builder.yml`, the `electron`/`electron-builder` dependencies, and
  the Electron-specific JS test suite. `main` is now Rust/Tauri only.

## [1.6.0] - 2026-07-10

### Added

- "Extra usage" card on the main view for accounts that purchased credits
  beyond their plan quota. It reads the OAuth endpoint's `extra_usage` object
  and shows used vs. monthly-limit credits (`US$ used / US$ limit`) with a thin
  quota meter. The card only appears when the feature is enabled on the
  account; it stays hidden otherwise and the layout is unchanged.

### Fixed

- A `401` from the OAuth usage endpoint no longer signs you out on the first
  transient rejection. `QuotaService` now attempts a single forced token
  refresh and retries the request; credentials are only cleared if the refresh
  itself fails or the retry is still `401`. Matches the existing `403`
  re-auth pattern instead of wiping the session outright.

## [1.5.1] - 2026-07-10

### Fixed

- Update banner no longer stalls right after a release. The updater now checks
  whether the winget catalog *already has* the new version instead of only
  whether Siphon was installed via winget; since the winget manifest lags
  GitHub Releases by hours, the banner falls back to the direct `.exe`
  download in that window and only routes through winget once it catches up.
- The winget update path now waits for Siphon to exit before upgrading (so the
  installer can replace the locked executable) and relaunches the app
  afterward, matching the "Update & restart" button. Previously it quit while
  the upgrade was still running and never relaunched, so the app just closed
  and nothing happened.

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
