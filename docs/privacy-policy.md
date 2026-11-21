# Privacy Policy

Siphon is a local Windows tray application. It does not collect, transmit, or sell personal data.

## Data stored locally

All data written by Siphon stays on your machine under `%APPDATA%\Siphon\`:

| File | Contents | Purpose |
|------|----------|---------|
| `credentials.json` | Anthropic OAuth access and refresh tokens | Authenticate usage API calls |
| `preferences.json` | Language, notification toggle, widget position, autostart and refresh interval | User preferences |
| `reset-notification.json` | Pending Claude session-reset timestamp | Schedule Windows toast |
| `reset-notification-<provider>.json` | Pending Codex / Antigravity session-reset timestamp | Schedule Windows toast |
| `local-usage-cache.json` | Aggregated Claude Code JSONL usage metadata | Avoid re-reading unchanged session files |
| `antigravity-quota-cache.json` | Last known Antigravity quota percentages and reset times | Keep quota visible while Antigravity is closed |

Files are written with mode `0600` (owner read/write only) where supported.

## Data read from your machine

Siphon reads Claude Code's local usage files:

- `~/.claude/readout-cost-cache.json`
- `~/.claude/readout-pricing.json`
- `~/.claude/projects/**/*.jsonl`

When Codex is installed, Siphon also reads the rate-limit entries Codex writes
to its session logs (`~/.codex/sessions/**/rollout-*.jsonl`) to show your Codex
session and weekly limits. It reads only those entries' percentages and reset
times; it does not read `~/.codex/auth.json` or any other credential.

For Antigravity, Siphon reads the identified server process's command line,
Windows' PID-owned loopback listeners, and `~/.gemini/antigravity/daemon/hub_*.json`
discovery files. It sends that process's access token only to its verified
ports on `127.0.0.1` to request quota data.
`%APPDATA%\Antigravity\logs\main.log` and `language_server.log` are optional
port-ordering hints; missing or unreadable logs do not block process-based
discovery. Siphon checks whether `%APPDATA%\Antigravity`,
`%LOCALAPPDATA%\Programs\Antigravity`, and `~/.gemini/antigravity` exist to
distinguish a closed app from an absent installation. The token never leaves
your machine and is never stored or logged.

These files are never uploaded or shared.

## External network requests

Siphon makes outbound requests to two destinations — Anthropic, for your usage
data, and GitHub, for updates:

| Endpoint | Purpose |
|----------|---------|
| `https://claude.ai/` (OAuth PKCE flow) | Sign in — opens in your browser |
| `https://api.anthropic.com/api/oauth/usage` | Fetch session and weekly quota data |
| `https://api.github.com/repos/.../releases/latest` | Check for a newer version (can be turned off in Settings) |
| `https://github.com/` / `*.githubusercontent.com` | Download an update installer, only when an update is downloaded |

The GitHub requests carry no usage data, no account information, and no
identifier — they only ask what the latest release is and fetch a file.

The Antigravity quota request goes to `127.0.0.1` only — your own machine,
not the network.

No data is sent to any other third party. No analytics, no crash reporting, no telemetry.

## Credentials

OAuth tokens are stored locally and refreshed automatically. Siphon reuses the same OAuth client ID as Claude Code and never has access to your Anthropic account password.

## Changes

This policy may be updated alongside new app versions. Changes are noted in the release changelog.

## Contact

Questions or concerns: open an issue at https://github.com/kayodante/Win-siphonClaudeUsage/issues
