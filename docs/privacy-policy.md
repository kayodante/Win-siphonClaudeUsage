# Privacy Policy

Siphon is a local Windows tray application. It does not collect, transmit, or sell personal data.

## Data stored locally

All data written by Siphon stays on your machine under `%APPDATA%\Siphon\`:

| File | Contents | Purpose |
|------|----------|---------|
| `credentials.json` | Anthropic OAuth access and refresh tokens | Authenticate usage API calls |
| `preferences.json` | Language, notification toggle, widget position, autostart and refresh interval | User preferences |
| `reset-notification.json` | Pending session-reset timestamp | Schedule Windows toast |
| `local-usage-cache.json` | Aggregated Claude Code JSONL usage metadata | Avoid re-reading unchanged session files |

Files are written with mode `0600` (owner read/write only) where supported.

## Data read from your machine

Siphon reads Claude Code's local usage files:

- `~/.claude/readout-cost-cache.json`
- `~/.claude/readout-pricing.json`
- `~/.claude/projects/**/*.jsonl`

These files are never uploaded or shared.

## External network requests

Siphon makes two types of outbound requests, both to Anthropic:

| Endpoint | Purpose |
|----------|---------|
| `https://claude.ai/` (OAuth PKCE flow) | Sign in — opens in your browser |
| `https://api.anthropic.com/api/oauth/usage` | Fetch session and weekly quota data |

No data is sent to any other third party. No analytics, no crash reporting, no telemetry.

## Credentials

OAuth tokens are stored locally and refreshed automatically. Siphon reuses the same OAuth client ID as Claude Code and never has access to your Anthropic account password.

## Changes

This policy may be updated alongside new app versions. Changes are noted in the release changelog.

## Contact

Questions or concerns: open an issue at https://github.com/kayodante/Win-siphonClaudeUsage/issues
