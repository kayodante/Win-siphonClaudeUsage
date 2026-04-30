# Architecture

How Siphon Windows is wired internally. Read this before changing anything
that crosses module boundaries.

## High-level shape

Three Electron contexts, isolated by `contextIsolation: true`:

```
┌──────────────────────────────────────────────────────────────────┐
│  Main process (Node, ESM)                                        │
│  src/main/main.js                                                │
│   ├── BrowserWindow ── loadFile(src/renderer/index.html)         │
│   ├── Tray ── createTrayIcon() + context menu                    │
│   ├── ipcMain handlers ── state:get / refresh / auth:* / view:*  │
│   └── UsageController                                            │
│        ├── LocalDataService   (~/.claude/readout-*.json)         │
│        ├── QuotaService       (api.anthropic.com/oauth/usage)    │
│        ├── OAuthService       (PKCE)                             │
│        ├── TokenStore         (%APPDATA%/Siphon/credentials.json)│
│        └── ResetNotificationScheduler                            │
│              └── JsonStore   (%APPDATA%/Siphon/reset-…json)      │
└──────────────────────────────────────────────────────────────────┘
                  │ IPC (channels, no shared memory)
                  ▼
┌──────────────────────────────────────────────────────────────────┐
│  Preload (CJS)                                                   │
│  src/main/preload.cjs                                            │
│   contextBridge.exposeInMainWorld('siphon', { … })               │
└──────────────────────────────────────────────────────────────────┘
                  │ window.siphon.*
                  ▼
┌──────────────────────────────────────────────────────────────────┐
│  Renderer (browser, ESM)                                         │
│  src/renderer/renderer.js  ←  src/shared/format.js               │
│   ├── render(state)  on every state-changed                      │
│   └── showView('main' | 'settings')                              │
└──────────────────────────────────────────────────────────────────┘
```

## Module map

### `src/main/main.js`
Entry point. Top-level `await app.whenReady()` runs because the package is
`type: "module"`. Builds the singletons (`tokenStore`, `resetStore`,
`resetScheduler`, `controller`), creates the window and tray, registers IPC,
then calls `startApplication` from `appLifecycle.js`.

Important window behavior: `window.on('close')` calls
`event.preventDefault()` and `window.hide()` unless `app.isQuitting` is set
— so the X button hides to tray, only the *Sair* menu item really quits.

`positionWindow()` snaps the window to the bottom-right of the display
nearest the tray, with a 16-px margin.

### `src/main/appLifecycle.js`
Two pure functions, kept apart from `main.js` so they're testable
(`test/appLifecycle.test.js`):

- `buildTrayMenuTemplate({ showMainWindow, showSettingsWindow, quit })` —
  three items: *Mostrar aplicativo*, *Configurações*, separator, *Sair*.
- `startApplication({ loadWindow, showWindow, startController, … })` —
  load the renderer file, show the window, start the controller.

### `src/main/trayIcon.js`
Single export `createTrayIcon(nativeImage)` that returns a `NativeImage`
built from a base64 PNG of a green "S" on a transparent background. This is
a placeholder — when a real icon ships, replace `GREEN_S_PNG` (or load
`assets/tray.png` directly).

### `src/main/usageController.js`
The `UsageController` is an `EventEmitter` and the single source of truth
for renderer state. It exposes:

- `start()` — restore reset scheduler, refresh local + quota, start the two
  intervals.
- `stop()` — clear both intervals (called from `before-quit`).
- `refreshAll()`, `refreshLocal()`, `refreshQuota()` — explicit refreshes.
- Auth flow: `startSignIn()`, `submitCode(rawCode)`, `cancelAuth()`,
  `signOut()`.
- `getState()` — synchronous snapshot for IPC `state:get`.

Every public method ends with `#emit()`, which fires the `'state'` event;
`main.js` forwards it to the renderer over `state-changed`.

State shape (rough):

```js
{
  todayStats:   { inputTokens, outputTokens, cacheReadTokens,
                  cacheWriteTokens, totalTokens, cost, isEmpty, byModel },
  monthStats:   { …same shape… },
  recentDays:   [{ date: 'YYYY-MM-DD', cost, models }],
  quota: {
    session:      { percent, resetsAt },   // 5-hour bucket
    weeklyAll:    { percent, resetsAt },   // 7-day, all models
    weeklySonnet: { percent, resetsAt },
    weeklyOpus:   { percent, resetsAt }
  },
  localError, quotaError, authError,
  isSignedIn, awaitingCode, lastUpdated
}
```

Rate-limit handling: if `QuotaService` throws `QuotaError('rate_limited')`
the controller stamps `rateLimitedUntil = Date.now() + retryAfter*1000` and
short-circuits subsequent `refreshQuota()` calls until that time.

### `src/main/localDataService.js`
Reads `~/.claude/readout-cost-cache.json` and `~/.claude/readout-pricing.json`,
walks `cache.days[YYYY-MM-DD][modelKey] = { input, output, cacheRead,
cacheWrite }`, and joins it against the pricing map (per million tokens) to
compute USD cost.

`pricingKey()` strips the `claude-` prefix and any `-YYYYMMDD` snapshot
suffix so `claude-sonnet-4-20250514` looks up `sonnet-4`. `findPrice()`
falls back through several name shapes for safety.

`shortName()` collapses any `*opus*`/`*sonnet*`/`*haiku*` into
`Opus`/`Sonnet`/`Haiku` for the UI.

### `src/main/quotaService.js`
HTTP call to `https://api.anthropic.com/api/oauth/usage`. Required headers:

```
Authorization: Bearer <accessToken>
Accept: application/json
Content-Type: application/json
anthropic-beta: oauth-2025-04-20
User-Agent: claude-code/2.1.0
```

The `User-Agent` and `anthropic-beta` strings are intentional — the endpoint
is the one Claude Code itself uses. Don't change them without checking
upstream.

`parseUsageResponse(raw)` maps four response keys to UI buckets:

| Response key            | Bucket name      |
| ----------------------- | ---------------- |
| `five_hour`             | `session`        |
| `seven_day`             | `weeklyAll`      |
| `seven_day_sonnet`      | `weeklySonnet`   |
| `seven_day_opus`        | `weeklyOpus`     |

`#validToken()` lazily refreshes via `OAuthService.refresh()` when the
stored credentials are within 30 seconds of expiry.

`QuotaError` codes used by the controller: `not_signed_in`, `unauthorized`,
`rate_limited` (carries `retryAfter`), `server`.

### `src/main/oauthService.js`
PKCE flow against the Claude Code client:

- `prepareFlow()` → returns `{ url, verifier, state }`. Auth URL is
  `https://claude.ai/oauth/authorize` with `code=true`, scopes
  `user:profile user:inference`, S256 challenge.
- `exchange(rawCode, verifier, state)` → POSTs to
  `https://platform.claude.com/v1/oauth/token`. `extractCode()` accepts
  either a raw code or the full redirect URL the user pasted from the
  browser.
- `refresh(refreshToken)` → same endpoint, `grant_type: refresh_token`.

Returns `{ accessToken, refreshToken, expiresAt }` (ISO string). Persisted
verbatim by `TokenStore`.

### `src/main/tokenStore.js`
File-backed store at `%APPDATA%\Siphon\credentials.json`. `load()` returns
`null` on `ENOENT` so the controller can treat a fresh install as
"signed out". `save()` writes with mode `0600`.

`configDir()` is the canonical source for the app's data folder — used by
`main.js` for both `tokenStore` and the reset scheduler's `JsonStore`.

### `src/main/jsonStore.js`
Tiny synchronous helper. Same `load()` / `save(value | null)` shape as
`TokenStore` but generic — `null` deletes the file. Sync calls are fine here
because the scheduler only persists at app start and on quota events.

### `src/main/resetNotificationScheduler.js` — the Windows-specific feature
Three things to know:

1. **Triggering rule**: `updateFromQuota(quota)` only arms when
   `session.percent >= 100`. If `session.percent < 15` it clears any
   pending state (the reset window has elapsed and a new session started).
2. **Persistence**: when armed, writes `{ resetKey, resetsAt }` to
   `%APPDATA%\Siphon\reset-notification.json`. `restore()` reads it on
   boot. `resetKey` is the ISO string of `resetsAt` and de-duplicates
   re-arms within the same window.
3. **Long-delay handling**: `setTimeout` only accepts up to ~24.8 days
   (`MAX_TIMER_DELAY_MS = 2_147_483_647`). The scheduler chains timers if
   the delay exceeds that. If `delayMs <= 0` (the reset has already
   passed by the time `restore()` runs), it fires immediately and clears
   state.

The scheduler is constructor-injected with `setTimer`/`clearTimer`/`now`/
`notify`/`loadState`/`saveState`, which is why the test file can drive it
synchronously.

### `src/main/preload.cjs`
The renderer's only door to Node. Exposes `window.siphon` with:

| Renderer call            | IPC channel        | Direction |
| ------------------------ | ------------------ | --------- |
| `getState()`             | `state:get`        | invoke    |
| `refresh()`              | `refresh`          | invoke    |
| `startSignIn()`          | `auth:start`       | invoke    |
| `submitCode(code)`       | `auth:submit`      | invoke    |
| `cancelAuth()`           | `auth:cancel`      | invoke    |
| `signOut()`              | `auth:sign-out`    | invoke    |
| `showMainView()`         | `view:show-main`   | invoke    |
| `showSettingsView()`     | `view:show-settings` | invoke  |
| `getAppInfo()`           | `app:info`         | invoke    |
| `onState(cb)`            | `state-changed`    | listen    |
| `onView(cb)`             | `view-changed`     | listen    |

Keep this CJS — the Electron preload runs before module sandboxing kicks in
and ESM preload has caveats.

### `src/renderer/`
Vanilla. `renderer.js` queries DOM nodes once, listens for state, and
re-renders. View switching is just toggling `[hidden]` between `#mainView`
and `#settingsView`. `formatResetDistance` and `formatDayTime` from
`src/shared/format.js` produce all the time strings.

### `src/shared/format.js`
Pure functions, no Electron deps — usable from main, renderer, and tests.

## Data flow on a normal tick

```
   every 30s                    every 120s (signed in)
       │                              │
       ▼                              ▼
LocalDataService.load()        QuotaService.fetchQuota()
       │                              │
       ▼                              ▼
summarizeUsage(cache, pricing) parseUsageResponse(raw)
       │                              │
       └────────────► UsageController state ◄──── auth methods
                          │
                          │  emit('state', state)
                          ▼
        main.js: window.webContents.send('state-changed', state)
                          │
                          ▼
        renderer.js: window.siphon.onState(render)
                          │
                          ▼
                       DOM updates
```

When `state.quota.session.percent >= 100`, the same emission path also
runs `resetScheduler.updateFromQuota(quota)` — that's the hook for the
notification.

## Reset notification lifecycle

```
sign-in → first quota tick → percent < 100 → nothing armed
                           ↘ percent ≥ 100 → save { resetKey, resetsAt }
                                            → setTimer(delay)

next ticks while armed     → same resetKey → no-op
                           → percent < 15 (new window) → clear state

timer fires                → notify({ title, body }) → clear state

app restart while armed    → JsonStore.load() → schedule(resetsAt)
                           → if resetsAt already past → fire immediately
```

## Test coverage

- `test/quota.test.js` — `parseUsageResponse` mapping.
- `test/localDataService.test.js` — pricing-key normalization, today/month
  aggregation, model rollups.
- `test/resetNotificationScheduler.test.js` — arm at 100%, dedupe by
  `resetKey`, clear at < 15%, restore from disk, long-delay clamp,
  fire-on-past-time.
- `test/appLifecycle.test.js` — tray menu template + start sequence.

Run with `npm test` (Node's built-in `--test` runner).
