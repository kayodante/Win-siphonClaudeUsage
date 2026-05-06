# Siphon Windows

A Windows tray version of [appariciojunior/siphonClaudeUsage](https://github.com/appariciojunior/siphonClaudeUsage). It keeps the core behavior of the macOS app:

- Reads Claude Code token cost files from `~/.claude/readout-cost-cache.json` and `~/.claude/readout-pricing.json`.
- Uses the Claude Code OAuth PKCE flow to read session and weekly plan usage.
- Shows session, weekly, daily cost, and monthly cost in a compact tray window.
- Refreshes local cost data every 30 seconds and quota data every 2 minutes.

The Windows-specific addition is reset scheduling: when the current five-hour session reaches 100% and the API returns a future `resets_at`, Siphon stores that reset time and schedules a Windows notification for when the session should be available again. If the app is opened after the reset time has already passed, it immediately sends the missed reset notification once.

## Requirements

- Windows 10 or later.
- Node.js 22 or later.
- Claude Code installed and used at least once.
- A Claude account with OAuth access to usage data.

## Installation

Download the latest Windows installer (`Siphon Setup <version>.exe`) from the eventual GitHub release for this project. Run it and follow the wizard:

- The installer is a per-user NSIS package — no admin elevation required.
- A Start Menu entry is created under a **Siphon** folder (Windows → All apps → Siphon → Siphon).
- The final wizard page offers an opt-in **"Criar atalho na area de trabalho"** checkbox (checked by default). Uncheck it to skip the desktop shortcut.

Microsoft Defender SmartScreen pode bloquear o instalador na primeira execução. Clique em "Mais informações" e depois "Executar mesmo assim".

Building from source: clone the repository, run `npm install`, then `npm run build:win`; the installer output will be in `dist/`.

## Development

```powershell
npm install
npm test
npm start
```

Credentials are stored under `%APPDATA%\Siphon\credentials.json`. Reset notification state is stored under `%APPDATA%\Siphon\reset-notification.json`.

## Notes

The app must be running in the tray to deliver a future reset notification at the exact reset time. If it was closed during the reset window, it will still notify once on the next launch if a pending reset was saved.
