# Design: CodexIsland-Inspired Improvements

**Date:** 2026-05-17  
**Source reference:** [ericjypark/codex-island](https://github.com/ericjypark/codex-island)  
**Status:** Approved

---

## Scope

Five targeted fixes derived from analysis of the CodexIsland macOS app, which solves the same problem (Claude usage display) and has evolved further. No new features — corrections and hardening only.

---

## Change 1 — HTTP 403 handling (`scope_insufficient`)

### Problem

Anthropic added `user:profile` to the required scope set on `/api/oauth/usage`. Tokens minted before this change return HTTP 403. Siphon's `quotaService.js` has no 403 branch, so it falls through to the generic `else` and emits `'Could not load quota data.'` — unhelpful and unactionable.

### Solution

**`quotaService.js`**  
Add a 403 branch that throws `new QuotaError('scope_insufficient', 'Re-authentication required.')`.

**`usageController.js`**  
Add `needsReauth: false` to initial state. Handle `scope_insufficient` in `refreshQuota`'s catch:
- Set `state.quotaError = 'error.scope_insufficient'`
- Set `state.needsReauth = true`
- Do **not** clear the token or set `isSignedIn = false` — the token is structurally valid; only the scope set is stale.

Reset `needsReauth = false` when:
- Sign-in completes successfully (end of `submitCode`)
- User signs out (`signOut`)

**Renderer**  
When `needsReauth === true`, render `error.scope_insufficient` string next to a "Entrar novamente" / "Re-authenticate" button that calls `window.siphon.startSignIn()`. The PKCE flow re-issues a token with `user:profile user:inference`, resolving the 403.

**`i18n.js`**  
Add key `error.scope_insufficient`:
- EN: `'Re-authentication required. Click to sign in again.'`
- pt-BR: `'Re-autenticação necessária. Clique para entrar novamente.'`

---

## Change 2 — User-Agent version bump

### Problem

Anthropic gates `/api/oauth/usage` on a CLI-style `User-Agent` header. Siphon sends `claude-code/2.1.0`; CodexIsland (and the current Claude Code CLI) send `claude-code/2.1.121`.

### Solution

One-line change in `quotaService.js`:
```
'User-Agent': 'claude-code/2.1.121'
```

---

## Change 3 — Pricing table corrections

### Problem

`BUNDLED_PRICING` in `localDataService.js` has incorrect rates for new-generation models. Confirmed against official Anthropic docs (`platform.claude.com/docs/en/docs/about-claude/models/overview`, retrieved 2026-05-17).

### Corrections

| Key | Input (current → correct) | Output (current → correct) |
|-----|--------------------------|---------------------------|
| `opus-4-7` | $15 → **$5** | $75 → **$25** |
| `haiku-4-5` | $0.80 → **$1** | $4 → **$5** |

Cache rates follow Anthropic's standard formula: `cacheRead = input × 0.10`, `cacheWrite = input × 1.25`. Update accordingly.

### Additions

| Key | Input | Output | cacheRead | cacheWrite |
|-----|-------|--------|-----------|------------|
| `opus-4-6` | $5 | $25 | $0.50 | $6.25 |
| `opus-4-5` | $5 | $25 | $0.50 | $6.25 |
| `opus-4-1` | $15 | $75 | $1.50 | $18.75 |

---

## Change 4 — JSONL dedup by `messageId:requestId`

### Problem

`parseJsonlChunk` processes every `assistant` record unconditionally. If a file is written to during parsing (e.g. crash recovery), a message can appear twice in the same file, inflating token counts and costs.

### Solution

In `parseJsonlFile`, create a local `seen = new Set()` before calling `parseJsonlChunk`. Pass it as a new parameter. Inside the loop:

```js
const messageId = record.message?.id ?? '';
const requestId = record.requestId ?? '';
if (messageId && requestId) {
  const dedupKey = `${messageId}:${requestId}`;
  if (seen.has(dedupKey)) continue;
  seen.add(dedupKey);
}
```

- Entries missing either ID are processed without dedup (matches CodexIsland behavior).
- `seen` is transient — created per `parseJsonlFile` call, never serialized to cache.
- Within-file dedup covers the realistic duplicate scenario; cross-file dedup is not implemented (session JSONL files are append-only and session-scoped, so cross-file duplication doesn't occur in practice).

---

## Change 5 — Synthetic model filter

### Problem

Claude Code occasionally writes records with model `<synthetic>` or `synthetic*` as placeholders. These have no real token cost and shouldn't inflate statistics.

### Solution

In `parseJsonlChunk`, immediately after extracting `model`, add:

```js
if (model === '<synthetic>' || model.startsWith('synthetic')) continue;
```

---

## Files changed

| File | Changes |
|------|---------|
| `src/main/quotaService.js` | 403 branch + User-Agent bump |
| `src/main/usageController.js` | `needsReauth` state field + `scope_insufficient` handler |
| `src/shared/i18n.js` | `error.scope_insufficient` strings (EN + pt-BR) |
| `src/main/localDataService.js` | Pricing corrections + dedup + synthetic filter |
| `src/renderer/renderer.js` | Re-auth button when `needsReauth === true` |

---

## Out of scope

- Cross-file JSONL dedup (not needed given session-scoped file model)
- Codex/ChatGPT support (macOS-only in CodexIsland)
- Sparkle auto-update (not applicable to Windows Electron)
- Pricing for Codex/OpenAI models
