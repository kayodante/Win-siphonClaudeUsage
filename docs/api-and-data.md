# API and data reference

Schemas of every external data source Siphon Windows reads or writes.
Useful when debugging missing fields or planning new features.

All schemas below are *observed*, not officially documented by Anthropic.
They mirror what Claude Code itself writes to disk and what the macOS
Siphon app uses against the OAuth endpoint.

## 1. Local Claude Code files

Both files live under the user's `~/.claude/` directory and are written by
Claude Code itself. Siphon only reads them. On Windows that resolves to
`%USERPROFILE%\.claude\`.

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
User-Agent: claude-code/2.1.0
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
| `seven_day`          | `weeklyAll`      | Weekly all      |
| `seven_day_sonnet`   | `weeklySonnet`   | Weekly Sonnet   |
| `seven_day_opus`     | `weeklyOpus`     | (not yet shown) |

Each becomes `{ percent: Number, resetsAt: Date | null }`.

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
User-Agent: claude-code/2.1.0
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
client_id     = 9d1c250a-e61b-44d9-88ed-5944d1962f5e
redirect_uri  = https://platform.claude.com/oauth/code/callback
auth_url      = https://claude.ai/oauth/authorize
token_url     = https://platform.claude.com/v1/oauth/token
scopes        = user:profile user:inference
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

`extractCode()` accepts either the bare code string or the entire
redirect URL the user pasted from the browser address bar.

### Refresh

Same endpoint:

```jsonc
{
  "grant_type":    "refresh_token",
  "refresh_token": "…",
  "client_id":     "<clientId>"
}
```

`QuotaService.#validToken()` triggers a refresh when `expiresAt` is within
30 seconds. If the refresh fails the credentials are cleared and the
controller flips to `isSignedIn: false`.

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

Deleted by `TokenStore.clear()` on sign-out, on a `401`, or when refresh
fails.

### `%APPDATA%\Siphon\preferences.json`

Written by `PreferencesService` over `JsonStore`. Missing fields are merged
with defaults on load so old files remain valid.

```jsonc
{
  "language": "en",
  "notifications": {
    "sessionReset": true,
    "sound": false
  },
  "floating": {
    "enabled": false,
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
  "claudePath": null
}
```

`language` supports `en` and `pt-BR`; unknown values fall back to English in
the renderer. `refresh.intervalSeconds` supports `30`, `60`, `300`, and `900`;
local JSONL refresh uses that value, while OAuth quota polling keeps a
120-second minimum. `startup.showWindowOnLogin` only affects app-managed
Windows login launches; normal/manual launches still show the main window.

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
