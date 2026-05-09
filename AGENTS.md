# AGENTS.md — Siphon Windows

Instructions for Codex working on this project.

## What this project is

Siphon Windows is an Electron tray app that mirrors the macOS Swift app at
[appariciojunior/siphonClaudeUsage](https://github.com/appariciojunior/siphonClaudeUsage).
It reads Claude Code local usage files and the Claude OAuth `/api/oauth/usage`
endpoint, then renders session/weekly/daily/monthly stats in a small tray
window. The Windows-specific addition is a reset notification scheduler:
when the 5-hour session quota hits 100% and the API returns a future
`resets_at`, the app schedules a Windows toast for that time. If the app
launches after a stored reset has already passed, it fires the missed toast
once.

## House rules (from the user's global AGENTS.md)

These override any default behavior — follow them on every turn:

1. **Read the user's files before doing anything.** Don't assume — open the
   relevant code first.
2. **Ask before executing.** Don't run `npm`, build commands, or anything
   with side effects without explicit confirmation.
3. **Show a plan first.** For any multi-step or non-trivial change, write the
   plan in chat and wait for approval before editing files.
4. **Never delete anything without asking first.** Includes `node_modules`,
   build outputs, generated files, anything.
5. **Before editing any file, read it first.** Before modifying a function,
   grep for all callers. Research before you edit.

The user is a designer, not a programmer. Don't dump code into chat unless
asked. Prefer file edits and short prose explanations.

When the user asks for a prompt, the prompt itself should be written in
English (the rest of the conversation stays in the user's language).

When a project change makes this document or `CLAUDE.md` inaccurate, edit both
files in the same session so they stay synchronized.

## Tech stack

- **Electron 41** (`type: "module"` — main process is ESM, preload is CJS).
- **Node 22+** required for the test runner and Electron.
- **No bundler.** Renderer loads `index.html` directly via `loadFile`; ES
  modules are imported with relative paths from `src/shared/`.
- **No framework** in the renderer — vanilla JS, hand-written CSS.
- **Tests**: `node --test` (built-in Node test runner). Files live in `test/`.

## Layout

```
src/
  main/           # Electron main process (Node, ESM)
    main.js       # entry — wires window, tray, IPC, controller
    appLifecycle.js
    appIcon.js    # BrowserWindow / installer icon path resolution
    trayIcon.js   # color-coded tray PNG assets by quota level
    floatingWindow.js  # always-on-top mini widget
    usageController.js   # orchestrates refresh + auth state
    localDataService.js  # reads ~/.claude/readout-*.json or projects/*.jsonl
    quotaService.js      # calls api.anthropic.com/api/oauth/usage
    oauthService.js      # PKCE flow, token exchange + refresh
    preferencesService.js # language, notifications, widget, startup, data path
    profileService.js    # best-effort account/profile lookup
    startupService.js    # Windows login item settings
    tokenStore.js        # credentials.json under %APPDATA%/Siphon
    jsonStore.js         # generic sync JSON file (mode 0600)
    resetNotificationScheduler.js  # the Windows-specific feature
    preload.cjs          # contextBridge — exposes window.siphon.*
  renderer/
    index.html
    renderer.js   # ESM, imports from ../shared/
    floating.html / floating.js
    styles.css
    viewState.js
  shared/
    format.js     # currency / percent / time helpers
    i18n.js       # English + pt-BR strings
    pace.js       # quota pace classification for session/weekly reset windows
    resetCopy.js  # reset countdown copy
    trayStatus.js # rich tray tooltip/context-menu summary copy
test/             # node --test files matching src/main/*
scripts/
  check-syntax.js # syntax-only lint pass
assets/
  tray*.png       # tray icons for ok/warn/high/danger quota levels
  installer/      # NSIS installer icon and artwork
```

## Data + state on disk

- **Credentials**: `%APPDATA%\Siphon\credentials.json` (mode `0600`,
  written by `TokenStore`).
- **Reset notification state**: `%APPDATA%\Siphon\reset-notification.json`
  (written by `JsonStore` when the scheduler arms).
- **Preferences**: `%APPDATA%\Siphon\preferences.json` (language,
  notifications, floating widget, startup, refresh interval, and Claude Code
  data path).
- **Incremental local usage cache**:
  `%APPDATA%\Siphon\local-usage-cache.json` (parsed JSONL metadata and
  aggregates; safe to rebuild).
- **Source data** (read-only, written by Claude Code itself):
  `~/.claude/readout-cost-cache.json`, `~/.claude/readout-pricing.json`, and
  modern per-session JSONL files under `~/.claude/projects/`.

## Refresh cadence

- Local cost cache → every **30 seconds by default** (`localTimer`), user
  configurable to 5, 15, or 30 minutes.
- OAuth quota → uses the chosen interval with a **120-second minimum**
  (`quotaTimer`), only when signed in.
- Rate-limit (`429`) → respects `Retry-After`, pauses quota refresh until
  `rateLimitedUntil`.

## Tray + window behavior (already implemented)

- Tray icon: `trayIcon.js` loads PNG assets from `assets/` and switches
  ok/warn/high/danger based on the 5-hour session percentage.
- **Double-click** the tray icon → main window shows.
- Tray tooltip and the top of the right-click menu show session %, weekly %,
  session reset time, and last update. The menu actions remain
  *Mostrar aplicativo* / *Mostrar widget* / *Configurações* / *Sair*.
  Built in `appLifecycle.buildTrayMenuTemplate` and `shared/trayStatus.js`.
- Closing the window hides it instead of quitting (`event.preventDefault()`
  + `window.hide()`); only `app.isQuitting` (set by *Sair*) actually exits.
- The optional floating widget is a frameless always-on-top mini window whose
  position is stored in preferences.

## Running and testing

The user runs these — Codex should not run them without asking.

```powershell
npm install   # one-time
npm test      # node --test against test/*.test.js
npm start     # electron .
npm run lint  # syntax-only check via scripts/check-syntax.js
npm run build:win  # electron-builder NSIS installer
```

## Conventions when editing

- Keep ESM in main and renderer; preload stays `.cjs`.
- New IPC channels: register in `main.js` `registerIpc()` and expose through
  `preload.cjs`'s `contextBridge.exposeInMainWorld('siphon', ...)`.
- Don't pull in TypeScript, bundlers, or UI frameworks without asking.
- Don't introduce native modules without asking — they complicate packaging.
- Strings the user sees can be Portuguese (settings labels already are);
  internal logs / errors stay in English.
- When touching the scheduler, run `test/resetNotificationScheduler.test.js`
  — it covers the tricky `setTimer` clamp and persistence paths.
- When touching behavior reflected in `AGENTS.md` or `CLAUDE.md`, update both
  files together so future agents get accurate project context.

## Things the user has flagged as "later"

See `ROADMAP.md`. Highlights: code signing, optional in-app handling of the
OAuth redirect (today it's copy-paste), notification click-through,
auto-update, Linux support, and API key ingestion.

## What not to touch without asking

- The OAuth client ID in `oauthService.js` — it matches Claude Code; changing
  it breaks sign-in.
- The headers in `quotaService.js` (`anthropic-beta`, `User-Agent`) — they're
  what the endpoint expects.
- File modes on `tokenStore.js` and `jsonStore.js` (`0600`) — credentials.

## Reference docs in this repo

- `README.md` — user-facing overview.
- `ARCHITECTURE.md` — code map and data-flow diagrams.
- `ROADMAP.md` — what's done, what's next.
- `docs/api-and-data.md` — schemas for the OAuth endpoint and the local
  Claude Code JSON files.

## graphify

This project has a graphify knowledge graph at graphify-out/.

Rules:
- Before answering architecture or codebase questions, read graphify-out/GRAPH_REPORT.md for god nodes and community structure
- If graphify-out/wiki/index.md exists, navigate it instead of reading raw files
- After modifying code files in this session, run `graphify update .` to keep the graph current (AST-only, no API cost)
