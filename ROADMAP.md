# Roadmap

Status of the Windows port and what's left to do. Compared against the
macOS app at
[appariciojunior/siphonClaudeUsage](https://github.com/appariciojunior/siphonClaudeUsage).

## Parity vs. macOS app

Feature-by-feature comparison against the macOS Swift original.

| Feature                                           | macOS | Windows | Notes |
| ------------------------------------------------- | :---: | :-----: | ----- |
| Tray / menu-bar icon                              |   ✓   |    ✓    | Final assets in `assets/tray*.png` ready; wiring scheduled in *Now / 1*. |
| Click tray to open popover                        |   ✓   |    ✓    | Windows wires **double-click** instead (more conventional on Windows). |
| Right-click tray menu                             |   ✓   |    ✓    | Items: *Mostrar aplicativo*, *Configurações*, *Sair*. |
| Session % + reset countdown                       |   ✓   |    ✓    |  |
| Weekly all + weekly Sonnet                        |   ✓   |    ✓    |  |
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
| **Reset notification when session hits 100%**     |   —   |    ✓    | Windows-only addition (the reason this fork exists). |
| **Missed-reset notification on next launch**      |   —   |    ✓    | Fires once if the stored reset has already passed. |
| Tray icon color-coded by usage level              |   ✓   |    ✗    | Bar in the window has `data-level`; tray icon itself doesn't change yet. |
| Packaged installer                                |  DMG  |    ✗    | No `electron-builder` config yet — see *Now*. |
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

## Now

Approved scope, in suggested execution order.

### 1. Real tray icon

Replace the placeholder `GREEN_S_PNG` in `trayIcon.js` with the final
asset. Both standard and HiDPI variants are already on disk:

- `assets/tray.png` (16×16, level=ok)
- `assets/tray@2x.png` (32×32, level=ok)
- `assets/tray-warn.png` + `assets/tray-warn@2x.png` (level=warn)
- `assets/tray-danger.png` + `assets/tray-danger@2x.png` (level=danger)

Use `nativeImage.createFromPath(...)` and load `tray.png` by default;
Electron picks `@2x` automatically on HiDPI when both files share the
same prefix.

### 2. Color-coded tray icon

Mirror the macOS behavior — swap the tray icon based on session %:

- `< 80%` → `tray.png` (ok)
- `>= 80%` → `tray-warn.png`
- `>= 95%` → `tray-danger.png`

Implement inside `updateTray()` in `main.js`. Reuse `levelForPercent`
logic from the renderer (or extract it into `src/shared/`). Calling
`tray.setImage(...)` with the path is enough; no recompositing needed.

### 3. Packaging — `.exe` installer

Decided scope:

- `electron-builder` as devDependency. Config in `electron-builder.yml`
  (more readable than inline `package.json`).
- App ID: `com.kayodante.siphon`.
- Product name: `Siphon`.
- Format: **NSIS only** (`.exe`). No MSI for now.
- Install scope: **per-user** (no admin prompt, fewer SmartScreen issues).
- NSIS options: `oneClick: false`, `perMachine: false`,
  `allowToChangeInstallationDirectory: true`.
- Windows icon: `assets/installer/icon.ico` (multi-resolution: 16, 24,
  32, 48, 64, 128, 256). Use it for the executable, the installer, and
  shortcuts.
- NSIS sidebar / header art: `assets/installer/installer-sidebar.bmp`
  (164×314) and `assets/installer/installer-header.bmp` (150×57). Wire
  them via `nsis.installerSidebar` and `nsis.installerHeader`.
- Code signing: **deferred**. README will document the SmartScreen
  workaround ("More info → Run anyway").
- Auto-update: **deferred** — depends on signing.
- Files included: `src/`, `assets/`, `package.json`. Excluded: `test/`,
  `scripts/`, `docs/`, `mockup.html`.
- New script: `npm run build:win`. Output to `dist/`.

## Next

After the *Now* block ships.

- **Code signing.** Acquire and integrate an EV / OV certificate so the
  installer doesn't trip SmartScreen.
- **Autostart on login.** `app.setLoginItemSettings({ openAtLogin: true,
  openAsHidden: true })` plus a checkbox in *Configurações*.
- **In-app OAuth redirect handler.** Today the user pastes the redirect
  URL back into Siphon. A small local HTTP listener on `127.0.0.1` (or
  a custom protocol handler) would let the browser hand the code back
  automatically.
- **Click-through from notification.** When the reset toast fires,
  clicking it should open the main window.
- **Offline / no-network state.** Surface a clean banner instead of the
  generic `quotaError` string.

## Later

Lower priority.

- **Auto-update** with `electron-updater`. Needs signed builds first.
- **Linux build.** Same Electron stack should work; tray UX differs and
  notifications use libnotify.
- **Anthropic API Key cost ingestion.** Considered and dropped; it requires
  an admin key, so it is out of scope for this tray app.

## Known issues / paper cuts

- The placeholder "S" icon doesn't render well at 16×16 on high-DPI
  displays — final asset will fix this.
- No window animation when showing from tray; the macOS app's popover
  feels nicer.
- `LocalDataService` errors collapse to a single string; if the user has
  never run Claude Code the message is technically "Could not read"
  rather than "Claude Code hasn't created the cache yet."
