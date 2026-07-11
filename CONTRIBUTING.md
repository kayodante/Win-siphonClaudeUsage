# Contributing to Siphon

Thanks for considering a contribution. Siphon is a solo-maintained Windows
tray app, so keeping changes small and focused makes review faster for
everyone.

## Dev setup

- Node.js 22 or later.
- Windows 10+ (the app is Windows-only — DPAPI credential storage, the tray
  icon, and the toast notifications all depend on Win32 APIs).

Siphon is a Rust/Tauri 2 app — you also need the Rust toolchain
(`rustc`/`cargo`), `cargo tauri` (tauri-cli), and the
[Tauri prerequisites](https://tauri.app/start/prerequisites/) (WebView2 + MSVC).

```powershell
npm install        # renderer/lint tooling
npm start          # cargo tauri dev — run against src/renderer
```

## Before opening a PR

```powershell
npm test           # node --test — renderer/shared JS units (test/*.test.js)
npm run test:rust  # cargo test -p siphon-core — Rust core logic
npm run lint       # syntax check via scripts/check-syntax.js + eslint
```

All must pass. The reset scheduler, quota, OAuth/PKCE and usage-parsing logic
now live in the `siphon-core` crate and are covered by `cargo test` — run it
whenever you touch that logic (its timer-clamp and persistence edge cases are
easy to break without noticing).

## PR expectations

- **Bump `package.json` version on every commit** — run
  `npm version <patch|minor|major> --no-git-tag-version` before committing.
  `feat` → minor, `fix`/`chore`/`style`/`refactor` → patch, breaking change →
  major. Include the updated `package.json` in the same commit.
- Keep the diff scoped to one change. Unrelated cleanup makes review harder
  and slows down merging.
- No bundler, TypeScript, UI framework, or native module additions without
  discussing first — see `CLAUDE.md` for why.
- If your change affects behavior documented in `CLAUDE.md`, `ARCHITECTURE.md`,
  or `ROADMAP.md`, update those files in the same PR.
- User-facing strings go through `src/shared/i18n.js` (English + Brazilian
  Portuguese). Internal logs and errors stay in English.
- Add an entry under `[Unreleased]` in `CHANGELOG.md` for user-facing
  changes. On each tagged release, `[Unreleased]` gets renamed to the new
  version/date and a fresh empty section goes above it.

## Reporting bugs / requesting features

Use the GitHub issue templates — they ask for the details needed to
reproduce (Siphon version, Windows version, install method). See
`SUPPORT.md` if you have a usage question rather than a bug report.

## Security issues

Do not open a public issue for a security vulnerability — see
`SECURITY.md`.
