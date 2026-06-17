<div align="center">
  <img src="assets/Logo.png" alt="Siphon" height="40" />
  <br/>
  <br/>
  <p>A Windows tray app that tracks your Claude Code usage in real time.</p>

  [![License: MIT](https://img.shields.io/badge/License-MIT-blue.svg)](LICENSE)
  [![Electron](https://img.shields.io/badge/Electron-41-47848F?logo=electron&logoColor=white)](https://www.electronjs.org/)
  [![Node](https://img.shields.io/badge/Node-22%2B-5FA04E?logo=node.js&logoColor=white)](https://nodejs.org/)
  [![Platform](https://img.shields.io/badge/Platform-Windows%2010%2B-0078D4?logo=windows&logoColor=white)](https://www.microsoft.com/windows)

  <br/>
  <br/>
  <img src="assets/Hero.png" alt="Hero" />
</div>

---

Siphon sits quietly in your system tray and shows session quota, weekly limits, and daily/monthly usage — all pulled directly from Claude Code's local files and the Anthropic OAuth usage endpoint. No API keys, no configuration: if you use Claude Code, it just works.

The Windows-specific addition is a **reset notification**: when your five-hour session quota hits 100%, Siphon schedules a Windows toast for the exact moment it becomes available again. If the app was closed during that window, it fires the missed notification on the next launch.

This is a Windows port of [appariciojunior/siphonClaudeUsage](https://github.com/appariciojunior/siphonClaudeUsage).

## Features

* **Session quota** | Live progress bar showing your current 5-hour session usage with a reset countdown
* **Weekly limits** | Tracks the all-model weekly cap returned by the OAuth usage endpoint
* **Usage tracking** | Today's and this month's usage in USD, computed locally from Claude Code's usage and pricing files
* **Quota alerts** | In-app warning and critical banners at 70% and 90% session usage (dismissible per session); optional Windows toasts at 70%, 90%, and 100% thresholds — each independently configurable
* **Reset notification** | Windows toast when your session becomes available again — fires on next launch if the app was closed during the reset window
* **Sound alerts** | Three independent audio cues: session reset, session exhausted (100%), and quota warnings (70%/90%) — each with its own toggle, test button, and volume slider
* **Floating widget** | Always-on-top widget (PiP-style) you can drag anywhere on screen — two layouts: classic (session progress + expandable stats panel) and pill (compact icon + percentage bar)
* **Configurable refresh** | Local refresh defaults to 30 seconds, with 1, 5, and 15 minute options in Settings
* **Start with Windows** | Optional autostart, with a separate setting for whether the window appears after login
* **Pace indicator** | Session card shows whether your usage pace is on track or likely to exhaust the quota before it resets
* **Color-coded tray icon** | <img src="assets/tray-icon/tray-ok-high.png" width="18" alt="tray icon sample" /> - Icon encodes both session and weekly quota levels simultaneously — two independent color channels in one icon
* **Localization** | UI available in English and Brazilian Portuguese, switchable from Settings

## Requirements

- Windows 10 or later
- Node.js 22 or later (development only)
- [Claude Code](https://claude.ai/code) installed and used at least once

## Installation

### From the installer (recommended)

Download the latest `Siphon Setup <version>.exe` from [Releases](../../releases) and run it. The installer is per-user — no admin elevation required. A Start Menu entry is created under **Siphon**, and an optional desktop shortcut is offered on the final page.

### Portable

Download `Siphon-Portable-<version>.exe` from [Releases](../../releases) — no install, just run.

### Via winget

```powershell
winget install win-siphon
```

New releases go through [microsoft/winget-pkgs](https://github.com/microsoft/winget-pkgs) approval, so the winget version can lag a few days behind GitHub Releases.

## How it works

Siphon runs as three isolated Electron contexts:

```
Main process (Node, ESM)
  ├── UsageController
  │     ├── LocalDataService   — reads ~/.claude readouts or cached project JSONL on the selected cadence
  │     ├── QuotaService       — polls api.anthropic.com/api/oauth/usage with a 120 s minimum
  │     ├── OAuthService       — PKCE sign-in flow (same client ID as Claude Code)
  │     └── ResetNotificationScheduler — arms Windows toasts on quota exhaustion
  ├── FloatingWindow           — always-on-top mini widget (classic / pill layouts)
  └── IPC bridge
Preload (CJS)       — exposes window.siphon.* to the renderer
Renderer (ESM)      — vanilla JS + CSS, no framework
```

Usage figures are computed locally from Claude Code's usage data. Siphon first
uses the legacy token cache (`readout-cost-cache.json`) when present; otherwise
it scans modern per-session JSONL files under `~/.claude/projects/` and keeps an
internal incremental cache so unchanged session files are not re-read. Pricing
comes from `readout-pricing.json` when available, with bundled fallback prices
for known Claude models. No data leaves your machine for usage calculations.

### Data stored on disk

| File | Purpose |
|------|---------|
| `%APPDATA%\Siphon\credentials.json` | OAuth tokens (mode `0600`) |
| `%APPDATA%\Siphon\reset-notification.json` | Pending reset timestamp |
| `%APPDATA%\Siphon\preferences.json` | Language, notification toggle, widget position, autostart and refresh settings |
| `%APPDATA%\Siphon\local-usage-cache.json` | Rebuildable incremental cache for modern Claude Code JSONL usage files |

### Sign-in

Siphon reuses Claude Code's OAuth PKCE flow. When you click **Sign in**, a browser tab opens to Anthropic's auth page. After authorizing, paste the redirect URL back into the app. Tokens are refreshed automatically 30 seconds before expiry.

## Development

```powershell
npm test    # node --test (built-in Node test runner)
npm run lint  # syntax-only check
```

Tests live in `test/` and mirror the `src/main/` module structure. The test for `resetNotificationScheduler.test.js` covers the tricky timer-clamp and persistence paths — run it whenever you touch the scheduler.

## Privacy

- **On-device only** — outbound requests go exclusively to Anthropic (`api.anthropic.com`). No telemetry, no analytics, no third-party data sharing.
- **No disk scanning** — only reads known paths: `~/.claude/readout-*.json`, `~/.claude/projects/` JSONL files, and `%APPDATA%\Siphon\`.
- **Protected credentials** — OAuth tokens are encrypted with Windows DPAPI via Electron's `safeStorage` before being written to disk. Falls back to plaintext only if DPAPI is unavailable on the current machine.
- **Safe diagnostics** — any internal logs expose service/status metadata only, never raw tokens, OAuth values, or credentials.

See [docs/privacy-policy.md](docs/privacy-policy.md) for full details.

## Credits

Inspired by [siphonClaudeUsage](https://github.com/appariciojunior/siphonClaudeUsage/) (MIT)

## License

MIT — do whatever you like, attribution appreciated.
