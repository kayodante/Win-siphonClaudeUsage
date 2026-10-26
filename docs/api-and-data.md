# API and data reference

Schemas of every external data source Siphon Windows reads or writes.
Useful when debugging missing fields or planning new features.

All schemas below are *observed*, not officially documented by Anthropic.
They mirror what Claude Code itself writes to disk and what the macOS
Siphon app uses against the OAuth endpoint.

> **Note (v1.7.0):** the data shapes on this page are unchanged, but the
> JS-style function/class names cited below (`QuotaService.fetchQuota()`,
> `parseUsageResponse()`, `LocalDataService`, `TokenStore`, etc.) are now Rust
> ports in `src-tauri/crates/siphon-core` (parsing/mapping) and
> `src-tauri/src` (I/O). Names map 1:1 — e.g. `parseUsageResponse` →
> `quota::parse_usage_response`, `pricingKey` → `pricing::pricing_key`. See
> `ARCHITECTURE.md` for the module map.

## 1. Local Claude Code files

Both files live under the user's `~/.claude/` directory and are written by
Claude Code itself. Siphon only reads them. On Windows that resolves to
`%USERPROFILE%\.claude\`. (Siphon does write one other file in that
directory — a `SessionStart` hook in `~/.claude/settings.json`; see §4.)

### `~/.claude/readout-cost-cache.json`

Token totals grouped by date (local) and model key.

```jsonc
{
  "days": {
    "2026-04-27": {
      "claude-sonnet-4-20250514": {
        "input":      12345,
        "output":     6789,
        "cacheRead":  1024,
        "cacheWrite": 256
      },
      "claude-opus-4-1-20250805": {
        "input":      0,
        "output":     0,
        "cacheRead":  0,
        "cacheWrite": 0
      }
    },
    "2026-04-26": { /* … */ }
  }
}
```

Notes:

- Date keys are local-zone `YYYY-MM-DD` strings — `LocalDataService`
  derives "today" and "this month" from `new Date()` in the user's local
  zone.
- Model keys are full Claude Code identifiers, often suffixed with a
  `-YYYYMMDD` snapshot date. `pricingKey()` strips that suffix and the
  `claude-` prefix when matching against `readout-pricing.json`.
- Token field aliases tolerated by `normalizeTokens()`:
  `cacheRead` / `cache_read`, `cacheWrite` / `cache_write`.
- A missing top-level `days` key, or a missing model entry, is silently
  treated as zero — never as an error.

### `~/.claude/readout-pricing.json`

USD pricing per million tokens, keyed by model.

```jsonc
{
  "models": {
    "sonnet-4": {
      "input":      3.00,
      "output":    15.00,
      "cacheRead":  0.30,
      "cacheWrite": 3.75
    },
    "opus-4-1": {
      "input":     15.00,
      "output":    75.00,
      "cacheRead":  1.50,
      "cacheWrite":18.75
    },
    "haiku-3-5": {
      "input":      0.80,
      "output":     4.00,
      "cacheRead":  0.08,
      "cacheWrite": 1.00
    }
  }
}
```

Notes:

- Numbers are USD per **million** tokens. The cost formula is
  `(tokens / 1_000_000) * price` summed across the four channels.
- Lookup order in `findPrice()`: stripped key
  (e.g. `sonnet-4`), `claude-`-prefixed key, original model name, lowercased
  model name. First hit wins.
- `cacheRead` / `cache_read` and `cacheWrite` / `cache_write` are both
  accepted.
- If no price entry matches, that model contributes `cost = 0` but its
  tokens are still counted.

## 2. Anthropic OAuth usage endpoint

Used by `QuotaService.fetchQuota()`.

### Request

```
GET https://api.anthropic.com/api/oauth/usage
Authorization: Bearer <accessToken>
Accept: application/json
Content-Type: application/json
anthropic-beta: oauth-2025-04-20
User-Agent: claude-code/2.1.121
```

The `User-Agent` and `anthropic-beta` headers are not optional in
practice — without them the endpoint may reject or behave differently.
They match Claude Code's own client.

### Response (200)

```jsonc
{
  "five_hour": {
    "utilization": 42.7,
    "resets_at":   "2026-04-28T22:00:00Z"
  },
  "seven_day": {
    "utilization": 18.2,
    "resets_at":   "2026-05-02T00:00:00Z"
  },
  "seven_day_sonnet": {
    "utilization": 12.4,
    "resets_at":   "2026-05-02T00:00:00Z"
  },
  "seven_day_opus": {
    "utilization": 5.9,
    "resets_at":   "2026-05-02T00:00:00Z"
  }
}
```

`parseUsageResponse()` maps these to UI buckets:

| Response key         | Internal name    | UI label        |
| -------------------- | ---------------- | --------------- |
| `five_hour`          | `session`        | Session         |
| `seven_day`          | `weeklyAll`      | Weekly Limit    |
| `extra_usage`        | `extraUsage`     | Extra usage (conditional) |

Each becomes `{ percent: Number, resetsAt: Date | null }`.

`seven_day_sonnet` and `seven_day_opus` are per-model weekly buckets that
only come populated on Max plans (on Pro they arrive empty or absent). They
were displayed early in the port, intentionally removed, and are ignored by
the parser today.

The endpoint may also return an `extra_usage` object describing purchased
credits beyond the plan quota:

```jsonc
{
  "extra_usage": {
    "is_enabled":    true,
    "monthly_limit": 2000,  // cents — $20.00
    "used_credits":  1556,  // cents — $15.56
    "utilization":   77.8
  }
}
```

`monthly_limit` and `used_credits` are **cents**; `parse_extra_usage()` divides
them by 100 so the renderer's `formatCurrency()` prints dollars. `utilization`
is already a percentage and passes through untouched.

`parseExtraUsage()` maps this to `extraUsage: { monthlyLimit, usedCredits,
utilization }`, but only when `is_enabled` is `true` — otherwise it returns
`null` and the renderer's "Extra usage" card stays hidden, leaving the layout
unchanged. Accounts without the feature never see the card.

### Other status codes

| Status | Meaning                | Behavior in `QuotaService`                               |
| -----: | ---------------------- | -------------------------------------------------------- |
| 401    | Token rejected         | Clear `TokenStore`, throw `QuotaError('unauthorized')`.  |
| 429    | Rate limited           | Read `Retry-After` (default 300s), throw `QuotaError('rate_limited', { retryAfter })`. The controller pauses quota refresh until then. |
| Other  | Server error           | Throw `QuotaError('server', 'Server error (<status>)')`. |

### Profile endpoint

Used by `ProfileService.fetchProfile()` as a best-effort account lookup.
It uses the same OAuth token and required headers as the usage endpoint:

```
GET https://api.anthropic.com/api/oauth/profile
Authorization: Bearer <accessToken>
Accept: application/json
Content-Type: application/json
anthropic-beta: oauth-2025-04-20
User-Agent: claude-code/2.1.121
```

Observed response shapes vary, so Siphon accepts common aliases:

```jsonc
{
  "name": "Ada Lovelace",
  "full_name": "Ada Lovelace",
  "display_name": "Ada",
  "email": "ada@example.com",
  "plan": "Pro",
  "subscription": {
    "tier": "Pro",
    "plan": "Pro"
  }
}
```

The renderer receives a normalized object:

```jsonc
{
  "name": "Ada Lovelace",
  "email": "ada@example.com",
  "plan": "Pro"
}
```

Missing subfields are returned as `null`. `401` clears saved credentials;
`404`, server errors, network failures, and aborts return `null` silently.
The profile call never blocks sign-in, quota rendering, or local cost
rendering.

## 3. OAuth PKCE flow

`OAuthService` reuses Claude Code's client. The endpoint URLs and IDs are
hard-coded.

```
client_id       = 9d1c250a-e61b-44d9-88ed-5944d1962f5e
auth_url        = https://claude.ai/oauth/authorize
token_url       = https://platform.claude.com/v1/oauth/token
scopes          = user:profile user:inference

redirect_uri (loopback, preferred) = http://localhost:<ephemeral port>/callback
redirect_uri (manual fallback)     = https://platform.claude.com/oauth/code/callback
```

### Authorize URL (built in `prepareFlow()`)

```
https://claude.ai/oauth/authorize
  ?code=true
  &client_id=<clientId>
  &response_type=code
  &redirect_uri=<redirectUri>
  &scope=user%3Aprofile%20user%3Ainference
  &code_challenge=<S256 of verifier>
  &code_challenge_method=S256
  &state=<random>
```

`verifier` and `state` are 32 random bytes, base64url-encoded.

### Redirect handling

Siphon binds an ephemeral TCP port on `127.0.0.1` before building the authorize
URL and sends `http://localhost:<port>/callback` as the `redirect_uri`. The same
value is echoed in the token exchange — the two must match byte for byte.

The listener answers only `/callback`; anything else gets a 404 and the loop
keeps waiting. The `state` query parameter is compared against the one this
process generated, and a mismatch aborts without exchanging the code. On success
the browser gets `302 Location: https://platform.claude.com/oauth/code/success?app=claude-code`;
every failure gets a fixed-text 400 that never echoes the provider's message.

A stalled connection (no bytes sent, past a 10-second per-connection read
timeout) or a connection error is a non-event — it does not end the listener,
which otherwise keeps waiting for up to 150 seconds (`WAIT_TIMEOUT`). The
renderer mirrors that value as `AUTH_DEADLINE_MS` to draw a countdown on the
waiting screen, which also shows the authorize URL with a copy button and
reveals a manual paste field after 60 seconds — immediately instead if the OS
refused to open a browser. Neither a stalled connection nor a request the
listener cannot use ends the listener: a wrong or missing `state`, a missing
code, a malformed request line, or an unrelated path are all answered and
ignored, so a stranger who guesses the ephemeral port cannot end a sign-in
that is still in progress. Only the authorization server's own redirect — a
valid code, or a reported error — ends the loop, and not always the same way:
a reported error, a missing/malformed code, or a `state` mismatch discard the
flow outright, while a plain timeout instead downgrades it — the socket
closes but the flow (and its loopback `redirect_uri`) stays alive, so a code
that lands late can still be pasted by hand and still exchanges correctly.

If the bind fails, or **two consecutive** attempts in this run hit the
150-second timeout without a successful callback, the *next* sign-in attempt
falls back to `https://platform.claude.com/oauth/code/callback` and starts
directly in manual mode instead of opening a new listener — the original
flow, unchanged. A single timeout does not do that: it downgrades the current
attempt rather than ending it, so a user who steps away mid-authorization only
costs that one attempt; a firewall that blocks the browser's connection times
out every time and so still reaches the limit. A successful sign-in resets the
count. A denied authorization does not count toward the limit either — it
ends the flow outright rather than downgrading it, and the next attempt still
uses the loopback listener. The provider's `error` / `error_description` text
is attacker-influenced; it is logged and never shown in the app's own error
line, the same rule the 400 reply already follows. Parsing and classification
live in `siphon_core::oauth_callback`; the socket and the timeout/downgrade
decision live in `src-tauri/src/oauth_server.rs` and
`src-tauri/src/controller.rs`.

### Token exchange

```
POST https://platform.claude.com/v1/oauth/token
Content-Type: application/json

{
  "grant_type":    "authorization_code",
  "code":          "<extracted code>",
  "state":         "<state>",
  "client_id":     "<clientId>",
  "redirect_uri":  "<redirectUri>",
  "code_verifier": "<verifier>"
}
```

Response:

```jsonc
{
  "access_token":  "…",
  "refresh_token": "…",
  "expires_in":    3600
}
```

`OAuthService` normalizes that to:

```jsonc
{
  "accessToken":  "…",
  "refreshToken": "…",
  "expiresAt":    "2026-04-28T19:00:00.000Z"
}
```

`extract_code()` accepts either the bare code string or the entire redirect URL,
and is still used by the manual fallback path.

### Refresh

Same endpoint:

```jsonc
{
  "grant_type":    "refresh_token",
  "refresh_token": "…",
  "client_id":     "<clientId>"
}
```

`QuotaService.#validToken()` (`controller::valid_token`) triggers a refresh when
`expiresAt` is within 30 seconds. Failures are classified: a **rejected** grant
(`400`/`401`/`403` from the token endpoint) clears the credentials and flips the
controller to `isSignedIn: false`; a **transient** failure (network, `429`, or
`5xx`) keeps the credentials, reports offline (`isOffline: true`), and retries on
the next tick. See `siphon_core::oauth::refresh_failure_is_fatal`.

## 4. Files Siphon writes

Both inside the directory returned by `tokenStore.configDir()`, which
resolves to `%APPDATA%\Siphon\` on Windows (or
`<homedir>\AppData\Roaming\Siphon\` if `APPDATA` is unset).

### `%APPDATA%\Siphon\credentials.json`

Written by `TokenStore.save()` with mode `0600`.

```jsonc
{
  "accessToken":  "sk-ant-oauth-…",
  "refreshToken": "sk-ant-rt-…",
  "expiresAt":    "2026-04-28T19:00:00.000Z"
}
```

Deleted by `TokenStore.clear()` on sign-out, on a `401`, or when a refresh
grant is rejected (`400`/`401`/`403`). A transient refresh failure keeps the
file.

### `%APPDATA%\Siphon\preferences.json`

Written by `PreferencesService` over `JsonStore`. Missing fields are merged
with defaults on load so old files remain valid.

```jsonc
{
  "language": "en",
  "notifications": {
    "sessionReset": true,
    "sound": false,
    "soundVolume": 1.0,
    "expireSound": false,
    "expireSoundVolume": 1.0,
    "expireAlert": false,
    "limitSound": false,
    "limitSoundVolume": 1.0,
    "limitAlert": false
  },
  "floating": {
    "enabled": false,
    "expanded": false,
    "style": "classic",
    "showWeekly": true,
    "x": null,
    "y": null
  },
  "startup": {
    "openAtLogin": false,
    "showWindowOnLogin": false
  },
  "refresh": {
    "intervalSeconds": 30
  },
  "integration": {
    "launchWithClaudeCode": false
  },
  "updates": {
    "autoCheck": true,
    "autoDownload": false
  },
  "display": {
    "quotaMode": "used"
  },
  "privacy": {
    "maskEmail": false
  },
  "window": {
    "x": null,
    "y": null,
    "width": null,
    "height": null
  },
  "claudePath": null,
  "codexPath": null
}
```

`language` supports `en`, `pt-BR`, `ja`, and `ko`; unknown values fall back to English in
the renderer. `refresh.intervalSeconds` supports `30`, `60`, `300`, and `900`;
local JSONL refresh uses that value, while OAuth quota polling keeps a
120-second minimum. `startup.showWindowOnLogin` only affects app-managed
Windows login launches; normal/manual launches still show the main window.
`updates.autoCheck` (default `true`) gates the periodic GitHub release check;
`updates.autoDownload` (default `false`) additionally fetches the installer in
the background. `display.quotaMode` is `used` or `remaining` and flips only the
displayed percentage and its suffix — meters, colors, pace, and alert thresholds
stay on the raw *used* percent. `window.x/y` is the main window's **physical**
position, accepted on restore when at least half the window still lands on a
connected monitor (`siphon_core::geometry`), also the rule for the classic
floating widget. The mini widget accepts a saved origin on a connected monitor
and pulls its 71×32 or 136×32 logical-pixel footprint inside that monitor using its DPI;
a larger pill does not discard a position saved by the old 71px-wide widget.
Both floating layouts show used or remaining percentages according to
`display.quotaMode`. `floating.showWeekly` defaults to `true`: mini shows both
quotas with the two-channel tray icon. Setting it to `false` hides the weekly
group and restores the 71×32 session-only Pill, including its session icon. The
switch is available only when Pill is selected, and changes apply immediately.
Resizing uses the live window position so a recent drag is not undone. Classic
keeps its own weekly row and size regardless of this preference.
A disconnected display or a first launch falls back to the primary monitor's
top-right corner: 16 physical pixels in for the main window and 20 logical
pixels in for the floating widget. With no monitor information, the floating
widget trusts its saved position.
`window.width/height` is its size in **logical** pixels — physical position,
logical size, because a position is a point in the shared virtual desktop while
a size is a measurement Windows rescales across a DPI boundary. Size is restored
unconditionally, floored at 300×700 logical: the OS enforces
`minWidth`/`minHeight` only against a drag-resize, so the restore floors it by
hand. It is then shrunk to fit the display it is about to land on, since a
logical size is DPI-independent and a window sized on a large monitor can be
taller than a smaller one is.

### `%APPDATA%\Siphon\local-usage-cache.json`

Written by `LocalDataService` through `JsonStore`. This cache is internal and
safe to delete; it is rebuilt from Claude Code JSONL files.

```jsonc
{
  "version": 1,
  "updatedAt": "2026-04-28T19:00:00.000Z",
  "files": {
    "C:\\Users\\Ada\\.claude\\projects\\example\\session.jsonl": {
      "path": "C:\\Users\\Ada\\.claude\\projects\\example\\session.jsonl",
      "mtimeMs": 1777393200000,
      "size": 123456,
      "parsedOffset": 123456,
      "lastModel": "claude-sonnet-4-5-20250929",
      "lastTokenTotals": {
        "input": 120,
        "output": 80,
        "cacheRead": 0,
        "cacheWrite": 0
      },
      "days": {
        "2026-04-27": {
          "claude-sonnet-4-5-20250929": {
            "input": 1000,
            "output": 2000,
            "cacheRead": 0,
            "cacheWrite": 0
          }
        }
      },
      "hourly": {
        "2026-04-27T10:00:00.000Z": {
          "claude-sonnet-4-5-20250929": {
            "input": 1000,
            "output": 2000,
            "cacheRead": 0,
            "cacheWrite": 0
          }
        }
      }
    }
  }
}
```

Unchanged files are not re-read. Files that grow are read from
`parsedOffset`; files that shrink are parsed again from byte zero. Malformed
JSONL lines are skipped.

### `%APPDATA%\Siphon\reset-notification.json`

Written by `JsonStore.save()` from the reset scheduler with mode `0600`.

```jsonc
{
  "resetKey":  "2026-04-28T22:00:00.000Z",
  "resetsAt":  "2026-04-28T22:00:00.000Z"
}
```

`resetKey` and `resetsAt` are the same ISO string today — `resetKey` exists
as a stable identifier for de-duping arms within the same window. The file
is written when `session.percent` first crosses 100 with a future reset,
and cleared when the timer fires, when a new session starts
(`percent < 15`), or when the user signs out.

This file is Claude's. Codex and the two Antigravity groups each get their
own, same shape, from `providers::Channel::reset_file`:
`reset-notification-codex.json`, `reset-notification-antigravityGemini.json`,
`reset-notification-antigravityThirdParty.json`. Signing out of Claude clears
only Claude's.

### `~/.claude/settings.json` (the one exception outside `%APPDATA%`)

Written by `ClaudeSettings` (not `JsonStore`) when the
`integration.launchWithClaudeCode` preference is on. It adds a `SessionStart`
hook that starts Siphon if it is closed and preserves an already-running app's
visibility, focus, and current view. Siphon edits only its
own entry and leaves any other hooks untouched.

```jsonc
{
  "hooks": {
    "SessionStart": [
      {
        "matcher": "startup|resume",
        "hooks": [
          {
            "type": "command",
            "command": "C:\\…\\Siphon.exe",
            "args": ["--claude-hook"]
          }
        ]
      }
    ]
  }
}
```

This requires Claude Code's [exec-form hook support](https://code.claude.com/docs/en/hooks#exec-form-and-shell-form):
`command` is an executable path and `args` is a separate argument list, so no
PowerShell or other shell is created by this hook. The `--claude-hook` entry
point starts the same executable with `--from-claude`, null standard streams,
and Windows `DETACHED_PROCESS`, then exits before Tauri initializes. There is
no long-lived hook for Claude Code to wait for or cancel. A detached cold start
opens the window; an existing instance ignores `--from-claude` relaunches.
Concurrent session starts are still deduplicated by the single-instance plugin.
Manual launches continue to show the window. Windows autostart still uses
`--hidden`, with `startup.showWindowOnLogin` deciding first-launch visibility.

`enable()` appends this entry idempotently; `disable()` filters Siphon
entries back out and prunes the now-empty `SessionStart` / `hooks` keys.
Siphon recognizes its own entries by their command — the current exe path, or
legacy shell commands or exec-form commands launching another Siphon build
(dev, portable, an older install dir) — so one build's stale hook cannot linger
and start a second Siphon. Enabled hooks are migrated on app startup or when
the integration is enabled in Settings.
Writes go through a `.tmp` file + `rename` so a partial write can't corrupt
the user's Claude Code settings.

## 5. Codex session logs (read-only)

Read by `siphon_core::codex`. Codex (CLI and desktop app) appends one JSON
object per line to `<codex home>/sessions/YYYY/MM/DD/rollout-*.jsonl`, where
`<codex home>` is `preferences.codexPath`, `$CODEX_HOME`, `~/.codex`, or (when
`~/.codex/sessions` is absent on Windows and `$WSL_DISTRO_NAME` is set) a WSL
`\\wsl$\<distro>\home\<user>\.codex` directory. Every model turn adds a
`token_count` event carrying the account's current rate limits and cumulative
token usage (`info.total_token_usage`, paired with `turn_context.model` for
Today and This Month token/cost aggregation in `codex::read_usage`), observed on
Codex 0.160:

```jsonc
{
  "timestamp": "2026-10-22T12:13:23.892Z",      // → state.codex.updatedAt
  "type": "event_msg",
  "payload": {
    "type": "token_count",
    "info": { /* token totals — not read */ },
    "rate_limits": {
      "limit_id": "codex",                       // other ids (e.g. "codex-spark") are model-specific: skipped
      "primary":   { "used_percent": 67.0, "window_minutes": 300,   "resets_at": 1792688645 },  // → session
      "secondary": { "used_percent": 54.0, "window_minutes": 10080, "resets_at": 1793096377 },  // → weekly
      "credits": { /* not read */ }
    }
  }
}
```

- `resets_at` is Unix seconds; either window may be `null` (its row is then
  not shown).
- Windows are named by `window_minutes`: 300 → session, 10080 → weekly. A
  window without it falls back to its position (`primary` → session,
  `secondary` → weekly); any other length is left out.
- Siphon stats every `rollout-*.jsonl` and opens, newest mtime first, only
  those modified since the reading it already holds (up to 40 per attempt).
  In each it takes the **last** qualifying line of the last 512 KB, then of
  the last 4 MB if the shorter tail has none. Across files the reading with
  the latest event `timestamp` wins; mtime only bounds the search, since any
  event touches a file without carrying a new quota.
- `providers::apply` keeps the newest reading: an older or undated line, an
  empty search or a read error (`status: error`) never replaces or erases it.
- A window whose `resets_at` has passed is marked `rolledOver`
  (`providers::normalize_window`) and shown as waiting for a new reading,
  never as a measured 0%: the log only moves when Codex is used on this
  machine.
- `~/.codex/auth.json` is never read.

## 6. Antigravity local quota server (read-only, loopback)

Read by `siphon_core::antigravity` (parsing) and `controller::read_antigravity`
(I/O). Only the Antigravity 2.x app (`%LOCALAPPDATA%\Programs\Antigravity`) is
supported, and only while it runs: its `resources\bin\language_server.exe`
serves a Connect RPC on a loopback HTTPS port with a self-signed certificate.

- **Ports:** IPv4 loopback TCP listeners owned by each identified
  `language_server` PID, from `GetExtendedTcpTable` (`process.rs`). The newest
  port in `%APPDATA%\Antigravity\logs\main.log` (256 KB tail, full-file fallback)
  is an optional hint: it can prioritize or disambiguate only an already-owned
  port. An unowned, historical or reused log port is never a candidate. Missing
  and unreadable logs do not prevent valid process-based discovery.
- **CSRF token:** `--csrf_token <uuid>` on the `language_server` process
  command line (read with `NtQueryInformationProcess`, `process.rs`), taken only
  from a command line that also carries `--override_ide_name antigravity` or
  `--app_data_dir antigravity`. Antigravity ≤ 2.15 also logged it; 2.16 stopped.
  Identity flags require an exact `antigravity` value. A recognized server with
  no usable token is an error. Two with different tokens are disambiguated
  when only one process owns the logged loopback port; otherwise →
  `status: error`: Siphon does not guess.
- **Presence:** a running identified server establishes presence without files.
  With no such server, an existing `%APPDATA%\Antigravity` data directory or
  `%LOCALAPPDATA%\Programs\Antigravity` installation means `status: closed`.
  Only successful inspection finding no server and neither path yields
  `NotInstalled` (tab removed). Process/TCP enumeration, command-line access or
  presence-check errors yield `status: error`, preserving the previous reading.

### Request

```
POST https://127.0.0.1:<port>/exa.language_server_pb.LanguageServerService/RetrieveUserQuotaSummary
X-Codeium-Csrf-Token: <token>
Connect-Protocol-Version: 1
Content-Type: application/json

{}
```

Sent by a dedicated client: invalid certificates accepted, no proxy, no
redirects, 5-second timeout per request. Connection refused or timeout leads
to a fresh discovery: no server with installation evidence means `closed`;
a server still present but unreachable means `error`. Non-2xx (a stale token
gives 401) and unparseable bodies mean `error`.
Port/token association is rediscovered before every authenticated request,
including retries on another candidate. If it changed, the old attempt stops;
the next refresh can use the restarted server. No generic HTTP probe establishes
identity. Overlapping refreshes are dropped until state application finishes;
cancellation releases the guard. Failed reads preserve the previous reading.

### Response (200, observed on 2.16)

```jsonc
{
  "response": {
    "groups": [
      { "displayName": "Gemini Models", "buckets": [
          { "bucketId": "gemini-weekly", "window": "weekly", "remainingFraction": 0.976, "resetTime": "2026-10-27T21:11:10Z" },
          { "bucketId": "gemini-5h",     "window": "5h",     "remainingFraction": 1,     "resetTime": "2026-10-23T07:40:54Z" } ] },
      { "displayName": "Claude and GPT models", "buckets": [
          { "bucketId": "3p-weekly", "window": "weekly", "remainingFraction": 0, "resetTime": "2026-10-27T00:54:20Z" },
          { "bucketId": "3p-5h",     "window": "5h",     "remainingFraction": 1, "disabled": true, "resetTime": "2026-10-23T07:40:54Z" } ] },
      { "displayName": "Gemini 4 Argon", "buckets": [
          { "bucketId": "gemini-argon-wtu-weekly", "window": "weekly", "remainingFraction": 1, "resetTime": "2026-10-30T02:40:54Z" } ] }
    ]
  }
}
```

| Bucket | `state.antigravity.sections[]` |
|---|---|
| `gemini-5h` / `gemini-weekly` | `gemini` → `session` / `weekly` |
| `3p-5h` / `3p-weekly` | `thirdParty` → `session` / `weekly` |
| `gemini-argon-wtu-5h` / `gemini-argon-wtu-weekly` | `argon` → `session` / `weekly` |

The parser accepts `/response/groups`, `/summary/groups`, and root `groups`.
It preserves source-group identity: the three exact source display names above
scope their buckets; otherwise only unambiguous known bucket IDs infer a group.
No translated-name matching is performed. Repeated section IDs across source
groups or two buckets targeting the same window make the response unreadable.
Foreign IDs in an explicitly identified group cannot supply another group's quota.

An explicit `window` takes priority over the bucket-ID suffix: `5h` is session,
`weekly` is weekly (including a `-5h` ID explicitly marked `weekly`). Only an
absent `window` uses the known ID's duration. Unknown, empty, null or non-string
durations on recognized buckets make the response unreadable, preserving the
previous reading rather than inventing a session or hiding an offered window.
Weekly-only sections have no session row or session alert.

`percent = (1 − remainingFraction) × 100`, clamped. Besides the direct field,
`remaining.remainingFraction` and the tagged form
`remaining: { case: "remainingFraction", value: 0.25 }` are supported.
The summary envelope and nested forms are compatibility contracts exercised
by the external RPC parser and sanitized tests, not new live captures from
this Siphon session. CLI-only snake_case fields, generic `id` aliases and
model-specific quotas are not inferred from those CLI fixtures.
A bucket without
`remainingFraction` reads as unknown ("No reading available"), not as
exhausted. A response in which no window has a usable value is
`status: error`, not a reading. `disabled: true` (the 5-hour window while the
weekly one is spent) marks the section `blocked`: the card says so instead of
suggesting a message, and that section's session-reset toast is not shown
while the block lasts.

### Freshness and alternative source (deferred)

Manual and scheduled refresh still send `{}` to `RetrieveUserQuotaSummary`.
Win-CodexBar at `98a3ca7c7f6929f8fa6925ba9f4a0b5026a8791d`
(`rust/src/providers/antigravity/mod.rs:417–478`) sends `forceRefresh: true`
and optionally enriches or falls back through `GetUserStatus`. This proves its
implementation contract, not stale data or RPC compatibility on this machine.
No Antigravity process was available during this change, so neither feature
was adopted and polling/request timeouts remain unchanged.

Before adoption, capture sanitized local RPC responses and compare quota and
reset changes after use with and without `forceRefresh`, including latency.
Establish bounded fallback behavior and known window durations. Identity lookup
must remain optional and must never discard valid summary quota data; model
quotas without a duration must not become session/weekly quotas.

## Field cheat sheet

Quick reference for renaming or debugging.

| Concept             | Cache file field      | Pricing field         | Renderer state path                  |
| ------------------- | --------------------- | --------------------- | ------------------------------------ |
| Input tokens        | `input`               | `input`               | `todayStats.inputTokens`             |
| Output tokens       | `output`              | `output`              | `todayStats.outputTokens`            |
| Cache-read tokens   | `cacheRead` / `cache_read` | `cacheRead` / `cache_read` | `todayStats.cacheReadTokens`         |
| Cache-write tokens  | `cacheWrite` / `cache_write` | `cacheWrite` / `cache_write` | `todayStats.cacheWriteTokens`        |
| Session %           | —                     | —                     | `quota.session.percent`              |
| Session reset time  | —                     | —                     | `quota.session.resetsAt` (ISO string)|
