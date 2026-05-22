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
│        ├── LocalDataService   (~/.claude usage files)             │
│        ├── QuotaService       (api.anthropic.com/api/oauth/usage) │
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
then calls `startApplication` from `appLifecycle.js`. It also applies
`preferences.startup` through `startupService.js` so Windows login items
stay in sync with Settings.

Important window behavior: `window.on('close')` calls
`event.preventDefault()` and `window.hide()` unless `app.isQuitting` is set
— so the X button hides to tray, only the *Sair* menu item really quits.

`positionWindow()` snaps the window to the bottom-right of the display
nearest the tray, with a 16-px margin.

### `src/main/appLifecycle.js`
Two pure functions, kept apart from `main.js` so they're testable
(`test/appLifecycle.test.js`):

- `buildTrayMenuTemplate({ showMainWindow, showFloatingWidget, showSettingsWindow, restart, quit })` —
  *Mostrar aplicativo*, *Mostrar widget*, *Configurações*, separator, *Reiniciar*, *Sair*.
- `startApplication({ loadWindow, showWindow, showOnStart, startController, onControllerError })` —
  load the renderer file, optionally show the window, start the controller.

### `src/main/appIcon.js`
Resolves the app icon path (`assets/installer/icon.ico`) and rewrites
`app.asar` → `app.asar.unpacked` so the packaged installer can find the
`.ico` file. Used for the BrowserWindow icon.

### `src/main/trayIcon.js`
Single export `createTrayIcon(level = 'ok')` that returns a `NativeImage`
loaded from `assets/tray.png` / `tray-warn.png` / `tray-danger.png` based
on the level. `main.js` calls it from `updateTray` when
`levelForPercent(session)` changes.

### `src/main/floatingWindow.js`
`FloatingWindowController` owns the optional always-on-top widget
(220×88, frameless, transparent, `skipTaskbar`). It restores its position
from `preferences.floating.{x,y}`, debounces position saves on `move`,
and forwards `state-changed` to the widget renderer.

### `src/main/preferencesService.js`
`PreferencesService` (EventEmitter) wraps a `JsonStore` over
`%APPDATA%\Siphon\preferences.json`. Exposes `load() / get(path) / set(path, value)`,
deep-merges over `DEFAULT_PREFERENCES`, and emits `'change'` on writes.
Schema: `language`, `notifications.{sessionReset, sound, soundVolume, expireSound, expireSoundVolume, limitSound, limitSoundVolume}`,
`floating.{enabled, expanded, style, x, y}`, `startup.{openAtLogin, showWindowOnLogin}`,
`refresh.intervalSeconds`, `integration.launchWithClaudeCode`, `claudePath`.
Refresh interval supports 30 seconds, 1, 5, 15, and 30 minutes.

**Important:** new preference paths must be added to the `ALLOWED` set in
`main.js` `registerIpc()` — `prefs:set` silently drops unknown paths.

### `src/main/startupService.js`
Small testable wrapper around Electron login items. It translates
`preferences.startup` into `app.setLoginItemSettings({ openAtLogin, path,
args, name })`, always using `process.execPath` and registry name `Siphon`.
When autostart is enabled and `showWindowOnLogin` is false, it adds the
managed `--hidden` argument. `main.js` uses that same argument to skip only
the initial window show while still creating the tray, controller,
notifications, and floating-widget plumbing.

### `src/main/profileService.js`
Best-effort fetch against `https://api.anthropic.com/api/oauth/profile`
to surface user name / email / plan in Settings. Falls back to reading
`~/.claude/.credentials.json` (`claudeAiOauth.subscriptionType`) when
the endpoint omits a field. All errors are swallowed — the UI tolerates
`profile === null`.

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
  localHistory: {
    hourly:      [{ hour, inputTokens, outputTokens, totalTokens, cost }],
    daily:       [{ date, inputTokens, outputTokens, totalTokens, cost }]
  },
  quota: {
    session:      { percent, resetsAt },   // 5-hour bucket
    weeklyAll:    { percent, resetsAt },   // 7-day, all models
  },
  quotaHistory: { session: [{ timestamp, percent }] },
  preferences,  // full PreferencesService snapshot
  profile:      { name, email, plan } | null,
  localError, quotaError, authError,
  isSignedIn, awaitingCode, lastUpdated, isOffline,
  needsReauth  // true when last quota fetch returned scope_insufficient (403)
}
```

Rate-limit handling: if `QuotaService` throws `QuotaError('rate_limited')`
the controller stamps `rateLimitedUntil = Date.now() + retryAfter*1000` and
short-circuits subsequent `refreshQuota()` calls until that time.

### `src/main/localDataService.js`
Reads Claude Code usage data from two shapes:

- Legacy: `~/.claude/readout-cost-cache.json` plus
  `~/.claude/readout-pricing.json`. It walks
  `cache.days[YYYY-MM-DD][modelKey] = { input, output, cacheRead,
  cacheWrite }` and joins it against the pricing map (per million tokens).
- Modern: if the legacy cache is absent, it scans per-session JSONL files
  under `~/.claude/projects/` for the last 35 days and aggregates assistant
  message usage. Parsed JSONL metadata and aggregates are persisted in
  `%APPDATA%/Siphon/local-usage-cache.json` by path, mtime, size, parsed byte
  offset, trailing partial line, last model, and last token totals. Unchanged
  files are reused; appended files are read from the last parsed offset; shrunk
  files are rebuilt from byte zero. If `readout-pricing.json` is absent,
  bundled fallback prices are used.

Both paths return the same `todayStats` and `monthStats` shape. Modern JSONL
also returns `localHistory.hourly` and `localHistory.daily` for pace and trend
context.

`pricingKey()` strips the `claude-` prefix and any `-YYYYMMDD` snapshot
suffix so `claude-sonnet-4-20250514` looks up `sonnet-4`. `findPrice()`
falls back through several name shapes for safety.

JSONL parsing deduplicates records by `messageId:requestId` so a record
written twice in the same file is counted once. Records with model
`<synthetic>` or `synthetic*` are skipped entirely.

`shortName()` collapses any `*opus*`/`*sonnet*`/`*haiku*` into
`Opus`/`Sonnet`/`Haiku` for the UI.

### `src/main/quotaService.js`
HTTP call to `https://api.anthropic.com/api/oauth/usage`. Required headers:

```
Authorization: Bearer <accessToken>
Accept: application/json
Content-Type: application/json
anthropic-beta: oauth-2025-04-20
User-Agent: claude-code/2.1.121
```

The `User-Agent` and `anthropic-beta` strings are intentional — the endpoint
is the one Claude Code itself uses. Don't change them without checking
upstream.

`parseUsageResponse(raw)` maps the response keys currently shown by the UI:

| Response key            | Bucket name      |
| ----------------------- | ---------------- |
| `five_hour`             | `session`        |
| `seven_day`             | `weeklyAll`      |

`#validToken()` lazily refreshes via `OAuthService.refresh()` when the
stored credentials are within 30 seconds of expiry.

`QuotaError` codes used by the controller: `not_signed_in`, `unauthorized`,
`rate_limited` (carries `retryAfter`), `scope_insufficient` (HTTP 403 — token
valid but missing `user:profile` scope; sets `needsReauth = true`, token kept),
`server`.

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

`SafeStorageCrypto` encrypts the JSON payload via Electron `safeStorage`
(DPAPI on Windows) before writing. A 1-byte marker identifies the format:
`0x01` = DPAPI blob, `0x02` = plaintext fallback (when
`isEncryptionAvailable()` is false), `0x7B` = legacy plain JSON (migrated
on first load). `PlaintextCrypto` is the test-only adapter — no Electron
context required.

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

| Renderer call                   | IPC channel             | Direction |
| ------------------------------- | ----------------------- | --------- |
| `getState()`                    | `state:get`             | invoke    |
| `refresh()`                     | `refresh`               | invoke    |
| `startSignIn()`                 | `auth:start`            | invoke    |
| `submitCode(code)`              | `auth:submit`           | invoke    |
| `cancelAuth()`                  | `auth:cancel`           | invoke    |
| `signOut()`                     | `auth:sign-out`         | invoke    |
| `getPreferences()`              | `prefs:get`             | invoke    |
| `setPreference(path, value)`    | `prefs:set`             | invoke    |
| `showMainView()`                | `view:show-main`        | invoke    |
| `showSettingsView()`            | `view:show-settings`    | invoke    |
| `openMainWindowFromWidget()`    | `floating:open-main`    | invoke    |
| `closeFloatingWidget()`         | `floating:close`        | invoke    |
| `getAppInfo()`                  | `app:info`              | invoke    |
| `pickFolder()`                  | `dialog:pick-folder`    | invoke    |
| `minimize()`                    | `window:minimize`       | invoke    |
| `closeWindow()`                 | `window:close`          | invoke    |
| `quit()`                        | `app:quit`              | invoke    |
| `openExternal(url)`             | `shell:open-external`   | invoke    |
| `onState(cb)`                   | `state-changed`         | listen    |
| `onView(cb)`                    | `view-changed`          | listen    |
| `onResetSound(cb)`              | `play-reset-sound`      | listen    |

Keep this CJS — the Electron preload runs before module sandboxing kicks in
and ESM preload has caveats.

### `src/renderer/`
Vanilla. `renderer.js` queries DOM nodes once, listens for state, and
re-renders. View switching is just toggling `[hidden]` between `#mainView`
and `#settingsView`. `formatResetDistance` and `formatDayTime` from
`src/shared/format.js` produce all the time strings.

### `src/shared/diagnostics.js`
Pure redaction helpers, no Electron deps. `redactSensitive(value)` strips
bearer tokens, OAuth codes, and known sensitive keys (`access_token`,
`refresh_token`, `code`, `code_verifier`, `state`) from strings, objects,
and `Error` stacks. `logSafeError(label, error)` is a drop-in for
`console.error` that passes output through `redactSensitive` first.
Used by main-process auth and quota paths to prevent raw secrets from
appearing in logs.

### `src/shared/format.js`
Pure functions, no Electron deps — usable from main, renderer, and tests.

## Data flow on a normal tick

```
   selected cadence             max(selected cadence, 120s)
       │                              │
       ▼                              ▼
LocalDataService.load()        QuotaService.fetchQuota()
       │                              │
       ▼                              ▼
summarizeUsage/read JSONL     parseUsageResponse(raw)
incremental cache/history     in-memory session history
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
- `test/localDataService.test.js` — pricing-key normalization, legacy cache
  aggregation, JSONL fallback, incremental cache reuse, append/shrink handling,
  history buckets, model rollups.
- `test/resetNotificationScheduler.test.js` — arm at 100%, dedupe by
  `resetKey`, clear at < 15%, restore from disk, long-delay clamp,
  fire-on-past-time.
- `test/appLifecycle.test.js` — tray menu template + start sequence.
- `test/startupService.test.js` — Windows login-item settings and `--hidden`
  launch detection.
- `test/appIcon.test.js` — `resolveAppIconPath` asar-unpacked rewrite.
- `test/trayIcon.test.js` — level → asset filename mapping.
- `test/floatingWindow.test.js` — show/hide lifecycle, position persistence,
  multi-display visibility check.
- `test/preferencesService.test.js` — deep merge, dot-path get/set, change
  events, default schema.
- `test/profileService.test.js` — endpoint mapping, local fallback,
  expired-token handling.
- `test/format.test.js` — currency / percent / level / reset distance /
  relative-updated formatting.
- `test/i18n.test.js` — fallback to English, supported-language guard.
- `test/rendererViewState.test.js` — `resolveView` view selection.
- `test/usageControllerPreferences.test.js` — preferences-driven scheduler
  arming, refresh interval timers, quota history, state preferences snapshot,
  `scope_insufficient` → `needsReauth` state transitions.
- `test/usageControllerProfile.test.js` — profile lifecycle and sign-out
  reset.

Run with `npm test` (Node's built-in `--test` runner).
