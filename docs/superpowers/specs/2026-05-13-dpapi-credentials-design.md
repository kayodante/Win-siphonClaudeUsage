# DPAPI-Protected Credentials

**Date:** 2026-05-13
**Status:** Approved
**Scope:** `src/main/tokenStore.js`, `test/tokenStore.test.js`, `ROADMAP.md`

## Problem

`credentials.json` stores OAuth tokens as plaintext JSON, protected only by
`0600` file permissions. Windows DPAPI can encrypt at the OS level so that
only the current Windows user can decrypt — file theft alone is not enough.

## Goal

Encrypt credentials with Electron's `safeStorage` (which delegates to DPAPI on
Windows). Migrate existing plaintext files silently on first load. Keep tests
working without Electron by injecting a no-op adapter.

## Architecture

### Crypto adapters

Two classes live in `tokenStore.js`:

```
PlaintextCrypto
  encrypt(json: string) → Buffer   // Buffer.from(json, 'utf8')
  decrypt(buf: Buffer) → string    // buf.toString('utf8')

SafeStorageCrypto
  encrypt(json: string) → Buffer   // lazy import('electron') → safeStorage.encryptString(json)
  decrypt(buf: Buffer) → string    // lazy import('electron') → safeStorage.decryptString(buf)
```

`SafeStorageCrypto` uses dynamic `import('electron')` inside each method so
that `tokenStore.js` has no top-level Electron import. The Node test runner
imports the file cleanly; tests pass `PlaintextCrypto` explicitly so the lazy
path is never triggered.

**Fallback when encryption unavailable:** `SafeStorageCrypto` checks
`safeStorage.isEncryptionAvailable()` before encrypting. If false (non-Windows
dev machine, app not yet ready), it logs a warning and falls back to plaintext
behavior — identical to `PlaintextCrypto`. Decryption follows the same guard:
if unavailable, treat the buffer as UTF-8 plaintext.

### TokenStore constructor

```js
constructor(filePath = path.join(configDir(), 'credentials.json'),
            crypto = new SafeStorageCrypto())
```

`main.js` keeps `new TokenStore()` unchanged — gets DPAPI automatically.
Tests pass `new TokenStore(tmpPath, new PlaintextCrypto())`.

### File format

| Format | Detection | When written |
|--------|-----------|--------------|
| Plaintext JSON | `buf[0] === 0x7B` (`{`) | legacy files only |
| DPAPI blob | anything else | all new saves |

The blob is the raw `Buffer` returned by `safeStorage.encryptString`. No
base64 wrapper, no JSON envelope.

### load()

1. Read file as `Buffer` (no encoding).
2. If `buf[0] === 0x7B` → plaintext. Parse JSON, call `save(creds)` to
   migrate, return creds.
3. Else → `crypto.decrypt(buf)` → `JSON.parse` → return creds.
4. `ENOENT` → return `null`.

### save()

```js
const buf = await this.crypto.encrypt(JSON.stringify(credentials));
await fs.mkdir(dir, { recursive: true });
await fs.writeFile(tmpPath, buf, { mode: 0o600 });
await fs.rename(tmpPath, filePath);
```

Atomic write (tmp + rename) preserved. `mode 0600` kept for defense in depth.

### clear()

Unchanged — unlinks the file, ignores `ENOENT`.

## Tests (`test/tokenStore.test.js`)

All tests use `PlaintextCrypto` and a temp directory.

| Test | Verifies |
|------|----------|
| missing file → null | ENOENT handling |
| save → load roundtrip | encrypted write + read |
| load plaintext JSON → migrates | migration path |
| clear removes file | unlink |
| clear on missing file is silent | ENOENT in clear |

## Changes summary

| File | Change |
|------|--------|
| `src/main/tokenStore.js` | Add adapters, inject crypto, Buffer I/O, migration |
| `test/tokenStore.test.js` | New — covers the five cases above |
| `ROADMAP.md` | Move item from *Now* → *Done* |

## What does NOT change

- Public API: `load()`, `save(creds)`, `clear()` — same signatures.
- All callers (`main.js`, `usageController.js`, `quotaService.js`,
  `profileService.js`) — zero changes.
- `configDir()` export — unchanged.
