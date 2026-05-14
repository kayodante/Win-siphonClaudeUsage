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
