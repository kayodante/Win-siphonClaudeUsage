import assert from 'node:assert/strict';
import test from 'node:test';
import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { ClaudeSettingsService } from '../src/main/claudeSettingsService.js';

async function tempDir() {
  return fs.mkdtemp(path.join(os.tmpdir(), 'siphon-css-test-'));
}

function makeService(settingsPath) {
  return new ClaudeSettingsService({ exePath: 'C:\\fake\\Siphon.exe', settingsPath });
}

async function readJson(p) {
  return JSON.parse(await fs.readFile(p, 'utf8'));
}

// ── enable ────────────────────────────────────────────────────────────────────

test('enable creates settings.json when file is missing', async () => {
  const dir = await tempDir();
  const sp = path.join(dir, 'settings.json');
  await makeService(sp).enable();
  const result = await readJson(sp);
  assert.equal(result.hooks.SessionStart.filter(e => e._siphon === true).length, 1);
  await fs.rm(dir, { recursive: true });
});

test('enable preserves existing top-level keys', async () => {
  const dir = await tempDir();
  const sp = path.join(dir, 'settings.json');
  await fs.writeFile(sp, JSON.stringify({ model: 'sonnet', autoUpdatesChannel: 'latest' }));
  await makeService(sp).enable();
  const result = await readJson(sp);
  assert.equal(result.model, 'sonnet');
  assert.equal(result.autoUpdatesChannel, 'latest');
  assert.equal(result.hooks.SessionStart.filter(e => e._siphon === true).length, 1);
  await fs.rm(dir, { recursive: true });
});

test('enable preserves other SessionStart hooks', async () => {
  const dir = await tempDir();
  const sp = path.join(dir, 'settings.json');
  await fs.writeFile(sp, JSON.stringify({
    hooks: { SessionStart: [{ hooks: [{ type: 'command', command: 'echo other' }] }] }
  }));
  await makeService(sp).enable();
  const result = await readJson(sp);
  const entries = result.hooks.SessionStart;
  assert.equal(entries.length, 2);
  assert.equal(entries.filter(e => e._siphon === true).length, 1);
  assert.equal(entries.filter(e => !e._siphon).length, 1);
  await fs.rm(dir, { recursive: true });
});

test('enable preserves non-SessionStart hook types', async () => {
  const dir = await tempDir();
  const sp = path.join(dir, 'settings.json');
  await fs.writeFile(sp, JSON.stringify({
    hooks: { PreToolUse: [{ matcher: 'Bash', hooks: [{ type: 'command', command: 'echo pre' }] }] }
  }));
  await makeService(sp).enable();
  const result = await readJson(sp);
  assert.ok(Array.isArray(result.hooks.PreToolUse));
  assert.equal(result.hooks.PreToolUse[0].hooks[0].command, 'echo pre');
  await fs.rm(dir, { recursive: true });
});

test('enable is idempotent — no duplicate hook on second call', async () => {
  const dir = await tempDir();
  const sp = path.join(dir, 'settings.json');
  const svc = makeService(sp);
  await svc.enable();
  await svc.enable();
  const result = await readJson(sp);
  assert.equal(result.hooks.SessionStart.filter(e => e._siphon === true).length, 1);
  await fs.rm(dir, { recursive: true });
});

test('enable hook command contains exePath', async () => {
  const dir = await tempDir();
  const sp = path.join(dir, 'settings.json');
  await makeService(sp).enable();
  const result = await readJson(sp);
  const entry = result.hooks.SessionStart.find(e => e._siphon === true);
  assert.equal(entry.hooks[0].command, 'C:\\fake\\Siphon.exe');
  await fs.rm(dir, { recursive: true });
});

test('enable hook has async: true', async () => {
  const dir = await tempDir();
  const sp = path.join(dir, 'settings.json');
  await makeService(sp).enable();
  const result = await readJson(sp);
  const hook = result.hooks.SessionStart.find(e => e._siphon === true).hooks[0];
  assert.equal(hook.shell, undefined);
  assert.equal(hook.async, true);
  await fs.rm(dir, { recursive: true });
});

test('enable throws on corrupted JSON — does not overwrite', async () => {
  const dir = await tempDir();
  const sp = path.join(dir, 'settings.json');
  await fs.writeFile(sp, 'not valid json', 'utf8');
  await assert.rejects(() => makeService(sp).enable(), SyntaxError);
  assert.equal(await fs.readFile(sp, 'utf8'), 'not valid json');
  await fs.rm(dir, { recursive: true });
});

// ── disable ───────────────────────────────────────────────────────────────────

test('disable removes siphon hook', async () => {
  const dir = await tempDir();
  const sp = path.join(dir, 'settings.json');
  const svc = makeService(sp);
  await svc.enable();
  await svc.disable();
  const result = await readJson(sp);
  assert.equal(result.hooks, undefined);
  await fs.rm(dir, { recursive: true });
});

test('disable leaves other SessionStart hooks intact', async () => {
  const dir = await tempDir();
  const sp = path.join(dir, 'settings.json');
  await fs.writeFile(sp, JSON.stringify({
    hooks: {
      SessionStart: [
        { _siphon: true, hooks: [{ type: 'command', command: 'echo siphon' }] },
        { hooks: [{ type: 'command', command: 'echo other' }] }
      ]
    }
  }));
  await makeService(sp).disable();
  const result = await readJson(sp);
  assert.equal(result.hooks.SessionStart.length, 1);
  assert.equal(result.hooks.SessionStart[0]._siphon, undefined);
  await fs.rm(dir, { recursive: true });
});

test('disable cleans up empty SessionStart but keeps other hook types', async () => {
  const dir = await tempDir();
  const sp = path.join(dir, 'settings.json');
  await fs.writeFile(sp, JSON.stringify({
    hooks: {
      SessionStart: [{ _siphon: true, hooks: [{ type: 'command', command: 'echo siphon' }] }],
      PreToolUse: [{ matcher: 'Bash', hooks: [{ type: 'command', command: 'echo pre' }] }]
    }
  }));
  await makeService(sp).disable();
  const result = await readJson(sp);
  assert.equal(result.hooks.SessionStart, undefined);
  assert.ok(Array.isArray(result.hooks.PreToolUse));
  await fs.rm(dir, { recursive: true });
});

test('disable removes hooks object when it becomes fully empty', async () => {
  const dir = await tempDir();
  const sp = path.join(dir, 'settings.json');
  await fs.writeFile(sp, JSON.stringify({
    model: 'sonnet',
    hooks: { SessionStart: [{ _siphon: true, hooks: [{ type: 'command', command: 'echo siphon' }] }] }
  }));
  await makeService(sp).disable();
  const result = await readJson(sp);
  assert.equal(result.model, 'sonnet');
  assert.equal(result.hooks, undefined);
  await fs.rm(dir, { recursive: true });
});

test('disable is idempotent when hook is absent', async () => {
  const dir = await tempDir();
  const sp = path.join(dir, 'settings.json');
  await fs.writeFile(sp, JSON.stringify({ model: 'sonnet' }));
  await assert.doesNotReject(() => makeService(sp).disable());
  const result = await readJson(sp);
  assert.equal(result.model, 'sonnet');
  await fs.rm(dir, { recursive: true });
});

test('disable is idempotent when file is missing', async () => {
  const dir = await tempDir();
  const sp = path.join(dir, 'missing.json');
  await assert.doesNotReject(() => makeService(sp).disable());
  await fs.rm(dir, { recursive: true });
});

