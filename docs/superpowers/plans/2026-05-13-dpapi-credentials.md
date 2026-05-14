# DPAPI-Protected Credentials Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Encrypt OAuth credentials with Windows DPAPI via Electron's `safeStorage`, with a one-time migration path from legacy plaintext JSON and a no-op fallback for tests.

**Architecture:** Inject a `crypto` adapter into `TokenStore` (default: `SafeStorageCrypto`, tests: `PlaintextCrypto`). Files are written as binary with a 1-byte format marker (`0x01` = DPAPI, `0x02` = plaintext). On `load()`, a file starting with `{` (0x7B) is recognized as legacy and silently migrated. `SafeStorageCrypto` uses `import('electron')` lazily so the module can be imported in the Node test runner.

**Tech Stack:** Node 22+, Electron 41 `safeStorage` API, `node --test` test runner.

---

## File Map

| File | Action |
|------|--------|
| `src/main/tokenStore.js` | Modify — add adapters, crypto param, Buffer I/O, migration |
| `test/tokenStore.test.js` | Create — 5 test cases with `PlaintextCrypto` |
| `ROADMAP.md` | Modify — move item from *Now* to *Done* |

No other files change. `main.js` keeps `new TokenStore()` unchanged.

---

## Format Reference

| First byte | Meaning | Written by |
|-----------|---------|------------|
| `0x7B` (`{`) | Legacy plaintext JSON | Old code (read-only, triggers migration) |
| `0x01` | DPAPI-encrypted blob | `SafeStorageCrypto.encrypt` |
| `0x02` | Plaintext UTF-8 JSON (test or safeStorage unavailable) | `PlaintextCrypto.encrypt` / `SafeStorageCrypto` fallback |

---

## Task 1: Write the failing test file

**Files:**
- Create: `test/tokenStore.test.js`

- [ ] **Step 1: Create `test/tokenStore.test.js` with this exact content**

```js
import assert from 'node:assert/strict';
import test from 'node:test';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { TokenStore, PlaintextCrypto } from '../src/main/tokenStore.js';

function tmpFile() {
  return path.join(os.tmpdir(), `siphon-test-${Date.now()}-${Math.random().toString(36).slice(2)}.json`);
}

test('load returns null when file is missing', async () => {
  const store = new TokenStore(tmpFile(), new PlaintextCrypto());
  assert.equal(await store.load(), null);
});

test('save and load roundtrip', async () => {
  const filePath = tmpFile();
  const store = new TokenStore(filePath, new PlaintextCrypto());
  const creds = { access_token: 'abc', refresh_token: 'xyz', expires_at: 9999 };

  await store.save(creds);
  assert.deepEqual(await store.load(), creds);

  await fs.unlink(filePath);
});

test('load migrates legacy plaintext JSON and re-saves in new format', async () => {
  const filePath = tmpFile();
  const creds = { access_token: 'migrate-me', refresh_token: 'r', expires_at: 1 };

  await fs.writeFile(filePath, JSON.stringify(creds), { mode: 0o600 });

  const store = new TokenStore(filePath, new PlaintextCrypto());
  assert.deepEqual(await store.load(), creds);

  // File re-saved in new format — must not start with '{'
  const raw = await fs.readFile(filePath);
  assert.notEqual(raw[0], 0x7b, 'migrated file should not start with {');

  await fs.unlink(filePath);
});

test('clear removes the file', async () => {
  const filePath = tmpFile();
  const store = new TokenStore(filePath, new PlaintextCrypto());

  await store.save({ access_token: 'x' });
  await store.clear();

  assert.equal(await store.load(), null);
});

test('clear on missing file is silent', async () => {
  const store = new TokenStore(tmpFile(), new PlaintextCrypto());
  await assert.doesNotReject(() => store.clear());
});
```

- [ ] **Step 2: Run just this test file to confirm it fails**

```
node --test test/tokenStore.test.js
```

Expected: error like `SyntaxError: The requested module '../src/main/tokenStore.js' does not provide an export named 'PlaintextCrypto'`.

---

## Task 2: Implement the updated tokenStore

**Files:**
- Modify: `src/main/tokenStore.js`

- [ ] **Step 1: Replace the entire content of `src/main/tokenStore.js` with**

```js
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

const MARKER_DPAPI = 0x01;
const MARKER_PLAIN = 0x02;
const MARKER_LEGACY = 0x7b; // '{'

export class PlaintextCrypto {
  encrypt(json) {
    return Buffer.concat([Buffer.from([MARKER_PLAIN]), Buffer.from(json, 'utf8')]);
  }

  decrypt(buf) {
    return buf.slice(1).toString('utf8');
  }
}

export class SafeStorageCrypto {
  async encrypt(json) {
    const { safeStorage } = await import('electron');
    if (!safeStorage.isEncryptionAvailable()) {
      console.warn('[tokenStore] safeStorage unavailable — credentials stored as plaintext');
      return Buffer.concat([Buffer.from([MARKER_PLAIN]), Buffer.from(json, 'utf8')]);
    }
    return Buffer.concat([Buffer.from([MARKER_DPAPI]), safeStorage.encryptString(json)]);
  }

  async decrypt(buf) {
    if (buf[0] === MARKER_PLAIN) {
      return buf.slice(1).toString('utf8');
    }
    const { safeStorage } = await import('electron');
    return safeStorage.decryptString(buf.slice(1));
  }
}

export class TokenStore {
  constructor(
    filePath = path.join(configDir(), 'credentials.json'),
    crypto = new SafeStorageCrypto()
  ) {
    this.filePath = filePath;
    this.crypto = crypto;
  }

  async load() {
    try {
      const buf = await fs.readFile(this.filePath);
      if (buf[0] === MARKER_LEGACY) {
        // Legacy plaintext JSON — migrate once
        const creds = JSON.parse(buf.toString('utf8'));
        await this.save(creds);
        return creds;
      }
      const json = await this.crypto.decrypt(buf);
      return JSON.parse(json);
    } catch (error) {
      if (error.code === 'ENOENT') return null;
      throw error;
    }
  }

  async save(credentials) {
    const dir = path.dirname(this.filePath);
    await fs.mkdir(dir, { recursive: true });
    const buf = await this.crypto.encrypt(JSON.stringify(credentials));
    const tmpPath = `${this.filePath}.tmp`;
    await fs.writeFile(tmpPath, buf, { mode: 0o600 });
    await fs.rename(tmpPath, this.filePath);
  }

  async clear() {
    try {
      await fs.unlink(this.filePath);
    } catch (error) {
      if (error.code !== 'ENOENT') throw error;
    }
  }
}

export function configDir() {
  const root = process.env.APPDATA || path.join(os.homedir(), 'AppData', 'Roaming');
  return path.join(root, 'Siphon');
}
```

- [ ] **Step 2: Run tokenStore tests to verify they pass**

```
node --test test/tokenStore.test.js
```

Expected output: all 5 tests pass, 0 failures.

- [ ] **Step 3: Run the full test suite to catch regressions**

```
npm test
```

Expected: all tests pass. If any fail, investigate — this change only touches `tokenStore.js`, so failures would indicate an import or API mismatch.

- [ ] **Step 4: Commit**

```
git add src/main/tokenStore.js test/tokenStore.test.js
git commit -m "feat(auth): DPAPI-protected credentials via safeStorage

Adds PlaintextCrypto and SafeStorageCrypto adapters to TokenStore.
Credentials are now encrypted with Windows DPAPI (via Electron safeStorage).
Legacy plaintext JSON files are detected on load and migrated silently.
PlaintextCrypto adapter lets tests run without an Electron context."
```

---

## Task 3: Update ROADMAP.md

**Files:**
- Modify: `ROADMAP.md`

- [ ] **Step 1: In `ROADMAP.md`, move the DPAPI item from the *Now* section to *Done***

Find and remove this block from **Now**:

```markdown
- **DPAPI-protected credentials.** Upgrade `%APPDATA%\Siphon\credentials.json`
  from mode `0600` JSON to Windows DPAPI-protected storage, with a one-time
  migration path for existing plaintext credentials and graceful fallback in
  development/tests. Touches `src/main/tokenStore.js` plus focused tests.
```

Add this block at the bottom of the **Done** section (before the `## Now` heading):

```markdown
**DPAPI-protected credentials**

- `PlaintextCrypto` and `SafeStorageCrypto` adapters injected into `TokenStore`.
- `SafeStorageCrypto` uses Electron `safeStorage` (DPAPI on Windows); falls back
  to plaintext with a warning when `isEncryptionAvailable()` is false.
- Files use a 1-byte format marker: `0x01` = DPAPI blob, `0x02` = plaintext,
  `0x7B` = legacy JSON (triggers one-time migration on load).
- `PlaintextCrypto` used in tests — no Electron context required.
- `main.js` unchanged: `new TokenStore()` gets DPAPI automatically.
```

- [ ] **Step 2: Verify the ROADMAP still looks right** — read it in the editor and confirm the *Now* section no longer mentions DPAPI and *Done* has the new entry.

- [ ] **Step 3: Commit**

```
git add ROADMAP.md
git commit -m "docs: mark DPAPI credentials as done in ROADMAP"
```
