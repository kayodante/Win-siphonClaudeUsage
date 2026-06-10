import assert from 'node:assert/strict';
import test from 'node:test';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { JsonStore } from '../src/main/jsonStore.js';

function tmpFile() {
  return path.join(os.tmpdir(), `siphon-jsonstore-test-${Date.now()}-${Math.random().toString(36).slice(2)}.json`);
}

test('load returns null when file is missing (ENOENT)', async () => {
  const store = new JsonStore(tmpFile());
  assert.equal(await store.load(), null);
});

test('load returns null when file contains malformed JSON (SyntaxError)', async () => {
  const filePath = tmpFile();
  await fs.writeFile(filePath, 'not valid json', { mode: 0o600 });

  const store = new JsonStore(filePath);

  const originalWarn = console.warn;
  let warnCalled = false;
  console.warn = () => { warnCalled = true; };

  try {
    assert.equal(await store.load(), null);
    assert.equal(warnCalled, true);
  } finally {
    console.warn = originalWarn;
    await fs.unlink(filePath);
  }
});

test('load throws on other errors (e.g. EISDIR)', async () => {
  const filePath = tmpFile();
  await fs.mkdir(filePath);

  const store = new JsonStore(filePath);

  await assert.rejects(() => store.load(), { code: 'EISDIR' });

  await fs.rmdir(filePath);
});

test('save writes valid JSON to file', async () => {
  const filePath = tmpFile();
  const store = new JsonStore(filePath);

  const data = { key: 'value', num: 42 };
  await store.save(data);

  const raw = await fs.readFile(filePath, 'utf8');
  assert.deepEqual(JSON.parse(raw), data);

  await fs.unlink(filePath);
});

test('save(null) removes the file', async () => {
  const filePath = tmpFile();
  await fs.writeFile(filePath, '{"key":"value"}', { mode: 0o600 });

  const store = new JsonStore(filePath);
  await store.save(null);

  await assert.rejects(() => fs.stat(filePath), { code: 'ENOENT' });
});

test('save(null) swallows ENOENT if file is already missing', async () => {
  const store = new JsonStore(tmpFile());
  await assert.doesNotReject(() => store.save(null));
});

test('save(null) throws on other unlink errors', async () => {
  const filePath = tmpFile();
  await fs.mkdir(filePath);

  const store = new JsonStore(filePath);
  await assert.rejects(() => store.save(null), (err) => err.code !== 'ENOENT');

  await fs.rmdir(filePath);
});
