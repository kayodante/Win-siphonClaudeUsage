# Roadmap

Status of the Windows port and what's left to do. Compared against the
macOS app at [appariciojunior/siphonClaudeUsage](https://github.com/appariciojunior/siphonClaudeUsage).

## Parity vs. macOS app

Feature-by-feature comparison against the macOS Swift original.

| Feature                                           | macOS | Windows | Notes |
| ------------------------------------------------- | :---: | :-----: | ----- |
| Tray / menu-bar icon                              |   ✓   |    ✓    | Final assets in `assets/tray*.png` wired through `trayIcon.js`. |
| Click tray to open popover                        |   ✓   |    ✓    | Windows wires **double-click** instead (more conventional on Windows). |
| Right-click tray menu                             |   ✓   |    ✓    | Shows live session/weekly/reset/update summary plus app/widget/settings/quit actions. |
| Session % + reset countdown                       |   ✓   |    ✓    |  |
| Weekly all + weekly Sonnet                        |   ✓   |    ✓    | Surfaces `extra_usage` credits when weekly Sonnet data is absent. |
| Today's USD cost                                  |   ✓   |    ✓    |  |
| This month's USD cost                             |   ✓   |    ✓    |  |
| Recent days breakdown                             |   ✓   |    ✗    | Removed; backing data dropped. May return as a dedicated view later. |
| Local cost data refresh (~30 s)                   |   ✓   |    ✓    | Default 30 s; configurable to 5, 15, or 30 min. |
| OAuth quota refresh                               |   ✓   |    ✓    | Uses the chosen refresh interval with a 120 s minimum on Windows. |
| OAuth PKCE sign-in (paste-redirect flow)          |   ✓   |    ✓    | Same client ID and endpoints as Claude Code. |
| Token auto-refresh                                |   ✓   |    ✓    | 30-second skew before expiry. |
| Credentials persisted at `0600`                   |   ✓   |    ✓    | `%APPDATA%\Siphon\credentials.json`. |
| Bundled display font                              | Inter |  Geist  | Geist + Geist Mono + Geist Pixel Line, loaded via `@font-face`. |
| Polished UI (post visual-polish pass)             |   ✓   |    ✓    | Carbon icons, `#000` background, borderless cards, pixel numerals. |
| Tray icon color-coded by usage level              |   ✓   |    ✓    | `updateTray()` swaps `tray.png` / `tray-warn.png` / `tray-danger.png` via `levelForPercent`. |
| Packaged installer                                |  DMG  |   NSIS  | `electron-builder.yml` configured (`npm run build:win`). Code signing deferred. |
| **Reset notification when session hits 100%**     |   —   |    ✓    | Windows-only addition (the reason this fork exists). |
| **Missed-reset notification on next launch**      |   —   |    ✓    | Fires once if the stored reset has already passed. |
| Code signing                                      |   ✓   |    ✗    | Deferred pending a paid signing route. |
| Autostart on login                                |   ✓   |    ✓    | Settings toggles for start with Windows + show window after login. |

## Done

Shipped. Captured here so it's not re-litigated:

**Visual polish pass**

- Background `#000000`, card `#0A0A0A`, no borders, `border-radius` ↦ `--radius-sm`.
- All icons migrated to Carbon (`Renew`, `ExecutionHistory`, `Settings`,
  `Lightning`, `Notification`, `NotificationOff`, `Close`, `ArrowLeft`, `Locked`).
- Quota panel renamed to *Sessão Atual*. Headline in `GeistPixel-Line` 56px.
- Stat grid is 2×2 (Weekly all · Weekly Sonnet · Hoje · Este mês). Pixel numerals at 24px.
- *Updated just now* line under the grid, centered, dot pulsing
  (`formatRelativeUpdated` in `src/shared/format.js`, refreshed every 30 s).
- Brand mark replaced by `assets/Logo.png` lockup (logo + wordmark in one
  image), 22px tall in the topbar.

**Session-reset notification toggle**

- `PreferencesService` over `JsonStore` at `%APPDATA%\Siphon\preferences.json`.
- `UsageController` consults `notifications.sessionReset` before arming
  the scheduler; clearing the toggle calls `resetScheduler.clear()`.
- IPC: `prefs:get`, `prefs:set`. Preferences ride along in `getState()`.
- Settings UI: real switch wired to the preference. Pill in main view
  reflects the live value (*On* with `Notification` icon, *Off* with
  `NotificationOff` icon).

**Floating widget (PiP-style)**

- 220 × 80, fixed, frameless, transparent, always-on-top, `skipTaskbar`.
- Opt-in via Settings switch + tray menu *Mostrar widget*.
- Position persisted to `preferences.json` (debounced on `move`).
- Consumes the existing `state-changed` channel; no duplicate controller.
- Drag region on the background; click on percent area opens the main window.

**UX polish (v0.2)**

- Reset toast click → `showMainWindow()`. `notif.on('click', ...)` in `main.js` notify callback.
- Offline banner: `QuotaError('network')` in `quotaService.js` on `TypeError` from fetch; `state.isOffline` flag in controller; dismissable `#offlineBanner` in renderer with `error.offline.title/body` i18n.
- Friendlier local data empty-state: `summarizeFromJSONL` throws `{ code: 'ENODATA' }` on ENOENT projectsDir; controller maps to `error.local.missing` / `error.local.corrupted` i18n keys; renderer translates via `t()`.
- Window show animation: CSS `@keyframes windowEnter` (opacity + translateY) on `body[data-entering]`; toggled by `visibilitychange` listener in renderer.

**Localization**

- UI strings externalized through `src/shared/i18n.js` with English and
  Brazilian Portuguese, live-switched from Settings via `preferences.json`.

**Real tray icon + color-coded levels**

- `trayIcon.js` loads `tray.png` / `tray-warn.png` / `tray-danger.png`
  (plus `@2x` variants) via `nativeImage.createFromPath`.
- `updateTray()` in `main.js` swaps the image based on `levelForPercent`
  of the session percent (ok < 80%, warn ≥ 80%, danger ≥ 95%).

**Packaging — `.exe` installer**

- `electron-builder` wired as devDependency, `npm run build:win` outputs
  to `dist/` via `electron-builder.yml`.
- NSIS, per-user, `oneClick: false`, `allowToChangeInstallationDirectory: true`.
- Installer icon, sidebar BMP, header BMP all wired from `assets/installer/`.
- Files included: `src/`, `assets/`, `package.json`. Excluded: `test/`,
  `scripts/`, `docs/`, `mockup.html`, `ROADMAP.md`, `ARCHITECTURE.md`.
- Start Menu shortcut placed inside a `Siphon` folder; optional desktop shortcut is opt-in during install.
- Code signing intentionally deferred (see *Next*).

**Autostart on login**

- `startup.openAtLogin` and `startup.showWindowOnLogin` persisted in
  `preferences.json`.
- `startupService.js` wraps `app.setLoginItemSettings()` with the app path,
  registry name `Siphon`, and a managed `--hidden` launch argument.
- Settings UI has two switches: *Start with Windows* and
  *Show window after login*. The second stays visible but disabled until
  autostart is enabled.
- Manual launches still show the main window; app-managed login launches
  stay hidden only when started with `--hidden`.

**Incremental usage history, refresh cadence, and sparklines**

- `LocalDataService` caches modern JSONL parsing in
  `%APPDATA%\Siphon\local-usage-cache.json` by path, `mtimeMs`, size,
  parsed byte offset, trailing remainder, last model, last token totals, and
  per-file day/hour aggregates.
- Local summaries still expose `todayStats` and `monthStats`, and now also
  expose `localHistory.hourly` and `localHistory.daily` for cost/token trends.
- `UsageController` keeps an in-memory `quotaHistory.session` trend for
  successful OAuth quota refreshes.
- Settings now has a refresh interval preference: 30 s, 5 min, 15 min, or
  30 min. Local polling uses the selected value; OAuth quota polling keeps a
  120 s floor and timers are rescheduled live.
- The Session, Today, and This Month cards render dependency-free SVG
  sparklines from the new history data.

**Usage pace, rich tray surface, and refresh glow**

- `src/shared/pace.js` classifies session/weekly quota pace as no data,
  on track, high pace, or likely to run out using reset windows plus local
  history context.
- The main Session and Weekly cards show a compact localized pace pill.
- `src/shared/trayStatus.js` builds the tray tooltip and disabled context-menu
  summary rows for session %, weekly %, session reset time, and last update.
- Manual refresh from the topbar adds a subtle renderer-only card glow while
  the refresh promise is pending.

## Now

(empty — all items shipped)

## Next

These need real work — new IPC, new modules, or external dependencies.

- **Privacy mode + safe diagnostics.** Add a setting to hide or partially
  redact profile email in the UI, and centralize redaction for logs/errors so
  OAuth codes, access tokens, refresh tokens, bearer headers, and callback URLs
  never appear in frontend-visible messages or copied diagnostics.

  - **Expand floating widget.** Today the widget is 220 × 80 with
  session % only. Add a small button at the bottom to expand the window to also show
  Weekly + cost, and later the trend/pace signals. Touches
  `src/renderer/floating.html` and the floating-widget controller in
  `src/main/main.js`.

- **DPAPI-protected credentials.** Upgrade `%APPDATA%\Siphon\credentials.json`
  from mode `0600` JSON to Windows DPAPI-protected storage, with a one-time
  migration path for existing plaintext credentials and graceful fallback in
  development/tests. Touches `src/main/tokenStore.js` plus focused tests.

## Later

- **Code signing route decision.** Deferred until a paid signing route is
  chosen. Microsoft's current SmartScreen docs say EV certificates no
  longer guarantee immediate SmartScreen bypass; Azure Artifact Signing
  Basic is a likely low-cost route at about US$ 9.99/month. This is a
  release decision, not an in-tree implementation task for this cycle.

- **Auto-update** with `electron-updater`. Needs signed builds first.

## Known issues / paper cuts

- No active paper cuts are tracked here right now.
