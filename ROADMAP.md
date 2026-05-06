# Roadmap

Status of the Windows port and what's left to do. Compared against the
macOS app at
[appariciojunior/siphonClaudeUsage](https://github.com/appariciojunior/siphonClaudeUsage).

## Parity vs. macOS app

Feature-by-feature comparison against the macOS Swift original.

| Feature                                           | macOS | Windows | Notes |
| ------------------------------------------------- | :---: | :-----: | ----- |
| Tray / menu-bar icon                              |   ✓   |    ✓    | Final assets in `assets/tray*.png` wired through `trayIcon.js`. |
| Click tray to open popover                        |   ✓   |    ✓    | Windows wires **double-click** instead (more conventional on Windows). |
| Right-click tray menu                             |   ✓   |    ✓    | Items: *Mostrar aplicativo*, *Configurações*, *Sair*. |
| Session % + reset countdown                       |   ✓   |    ✓    |  |
| Weekly all + weekly Sonnet                        |   ✓   |    ✓    | Surfaces `extra_usage` credits when weekly Sonnet data is absent. |
| Today's USD cost                                  |   ✓   |    ✓    |  |
| This month's USD cost                             |   ✓   |    ✓    |  |
| Recent days breakdown                             |   ✓   |    ✓    | Now in a dedicated history view, opened via the topbar history button. |
| Local cost data refresh (~30 s)                   |   ✓   |    ✓    |  |
| OAuth quota refresh                               |   ✓   |    ✓    | Every 120 s on Windows. |
| OAuth PKCE sign-in (paste-redirect flow)          |   ✓   |    ✓    | Same client ID and endpoints as Claude Code. |
| Token auto-refresh                                |   ✓   |    ✓    | 30-second skew before expiry. |
| Credentials persisted at `0600`                   |   ✓   |    ✓    | `%APPDATA%\Siphon\credentials.json`. |
| Bundled display font                              | Inter |  Geist  | Geist + Geist Mono + Geist Pixel Line, loaded via `@font-face`. |
| Polished UI (post visual-polish pass)             |   ✓   |    ✓    | Carbon icons, `#000` background, borderless cards, pixel numerals. |
| Tray icon color-coded by usage level              |   ✓   |    ✓    | `updateTray()` swaps `tray.png` / `tray-warn.png` / `tray-danger.png` via `levelForPercent`. |
| Packaged installer                                |  DMG  |   NSIS  | `electron-builder.yml` configured (`npm run build:win`). Code signing deferred. |
| **Reset notification when session hits 100%**     |   —   |    ✓    | Windows-only addition (the reason this fork exists). |
| **Missed-reset notification on next launch**      |   —   |    ✓    | Fires once if the stored reset has already passed. |
| Code signing                                      |   ✓   |    ✗    | No certificate yet — deferred. |
| Autostart on login                                |   ✓   |    ✗    | Not implemented. |

## Done

Shipped. Captured here so it's not re-litigated:

**Visual polish pass**

- Background `#000000`, card `#0A0A0A`, no borders, `border-radius` ↦ `--radius-sm`.
- All icons migrated to Carbon (`Renew`, `ExecutionHistory`, `Settings`,
  `Lightning`, `Notification`, `NotificationOff`, `Close`, `ArrowLeft`, `Locked`).
- Quota panel renamed to *Sessão Atual*. Headline in `GeistPixel-Line` 56px.
- Stat grid is 2×2 (Weekly all · Weekly Sonnet · Hoje · Este mês). Pixel numerals at 24px.
- Recent days moved out of the main view into a dedicated *History* view,
  reached via the new history button in the topbar (renderer-only navigation,
  no IPC).
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

## Now

Quick wins ordered by speed-to-ship. Each is small, scoped to existing
modules, no new infrastructure.

### 1. Click-through from reset notification

When the reset toast fires, clicking it should open the main window.
Wire the toast's `click` event in `resetNotificationScheduler.js` (or
the consumer in `main.js`) to `window.show()` + `window.focus()`. Few
lines; no new IPC.

### 2. Offline / no-network banner

Surface a clean banner in the renderer instead of the raw `quotaError`
string. Detect network errors in `quotaService.js` (caught fetch /
`ENOTFOUND` / `ECONNREFUSED`), mark them on state, and render a
dismissable banner above the cards. i18n keys: `error.offline.title`,
`error.offline.body`. Renderer-only beyond one new state field.

### 3. Friendlier `LocalDataService` empty-state

Today, a missing `~/.claude/readout-cost-cache.json` collapses to
"Could not read". Distinguish *file missing* (Claude Code never ran)
from *parse error* (corrupted) and surface a localized copy. One
branch in `localDataService.js` + two i18n keys.

### 4. Window show animation

Add a short fade/slide on `window.show()` from the tray. CSS-only
(opacity + transform on the renderer root, triggered by a `body` data
attribute set on first paint). No native window APIs needed.

## Next

After the *Now* block ships. These need real work — new IPC, new
modules, or external dependencies.

- **Autostart on login.** `app.setLoginItemSettings({ openAtLogin: true,
  openAsHidden: true })` plus a `startup.openAtLogin` preference, a new
  toggle in *Configurações*, and IPC plumbing through
  `preferencesService`. Medium effort, all in-tree.
- **Code signing.** Acquire and integrate an EV / OV certificate so the
  installer doesn't trip SmartScreen. Blocks auto-update.

## Later

Lower priority.

- **Auto-update** with `electron-updater`. Needs signed builds first.
- **Anthropic API Key cost ingestion.** Considered and dropped; it requires
  an admin key, so it is out of scope for this tray app.

## Known issues / paper cuts

- No window animation when showing from tray; the macOS app's popover
  feels nicer (covered in *Now / 4*).
- `LocalDataService` errors collapse to a single string; if the user has
  never run Claude Code the message is technically "Could not read"
  rather than "Claude Code hasn't created the cache yet" (covered in
  *Now / 3*).
