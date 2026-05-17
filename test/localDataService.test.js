import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';

import { LocalDataService, summarizeUsage } from '../src/main/localDataService.js';

test('summarizeUsage aggregates today and month cost from Claude cache files', () => {
  const cache = {
    days: {
      '2026-04-01': {
        'claude-sonnet-4-5-20250929': {
          input: 1000,
          output: 2000,
          cache_read: 3000,
          cache_write: 4000
        }
      },
      '2026-04-27': {
        'claude-sonnet-4-5-20250929': {
          input: 2000,
          output: 1000,
          cache_read: 0,
          cache_write: 1000
        }
      }
    }
  };
  const pricing = {
    models: {
      'claude-sonnet-4-5': {
        input: 3,
        output: 15,
        cache_read: 0.3,
        cache_write: 3.75
      }
    }
  };

  const summary = summarizeUsage(cache, pricing, new Date('2026-04-27T10:00:00Z'));

  assert.equal(summary.todayStats.inputTokens, 2000);
  assert.equal(summary.todayStats.outputTokens, 1000);
  assert.equal(summary.todayStats.cacheWriteTokens, 1000);
  assert.equal(summary.todayStats.cost, 0.02475);
  assert.equal(summary.monthStats.inputTokens, 3000);
  assert.equal(summary.monthStats.outputTokens, 3000);
  assert.equal(summary.monthStats.cacheReadTokens, 3000);
  assert.equal(summary.monthStats.cacheWriteTokens, 5000);
  assert.equal(summary.monthStats.cost, 0.07365);
});

test('summarizeUsage handles missing cache (ENOENT path) without throwing', () => {
  const summary = summarizeUsage(null, null, new Date('2026-04-27T10:00:00Z'));
  assert.equal(summary.todayStats.isEmpty, true);
  assert.equal(summary.todayStats.cost, 0);
  assert.equal(summary.monthStats.cost, 0);
});

test('summarizeUsage handles missing pricing entry by counting tokens with cost 0', () => {
  const cache = {
    days: {
      '2026-04-27': {
        'claude-mystery-model-20260101': {
          input: 1000,
          output: 500,
          cacheRead: 0,
          cacheWrite: 0
        }
      }
    }
  };
  const summary = summarizeUsage(cache, { models: {} }, new Date('2026-04-27T10:00:00Z'));
  assert.equal(summary.todayStats.inputTokens, 1000);
  assert.equal(summary.todayStats.outputTokens, 500);
  assert.equal(summary.todayStats.cost, 0);
});

test('LocalDataService aggregates modern JSONL into stats and history', async () => {
  const tempDir = await makeClaudeDir();
  await writePricing(tempDir);
  const sessionPath = await writeSession(tempDir, 'project-a', 'session.jsonl', [
    assistantRecord('2026-04-27T10:15:00.000Z', 'claude-sonnet-4-5-20250929', {
      input_tokens: 1000,
      output_tokens: 2000,
      cache_read_input_tokens: 3000,
      cache_creation_input_tokens: 4000
    }),
    assistantRecord('2026-04-27T11:45:00.000Z', 'claude-sonnet-4-5-20250929', {
      input_tokens: 2000,
      output_tokens: 1000,
      cache_creation_input_tokens: 1000
    }),
    '{bad json'
  ]);
  const cacheStore = new MemoryStore(null);
  const service = new LocalDataService(tempDir, { cacheStore });

  const summary = await service.load(new Date('2026-04-27T12:00:00.000Z'));

  assert.equal(summary.todayStats.inputTokens, 3000);
  assert.equal(summary.todayStats.outputTokens, 3000);
  assert.equal(summary.todayStats.cacheReadTokens, 3000);
  assert.equal(summary.todayStats.cacheWriteTokens, 5000);
  assert.equal(summary.todayStats.cost, 0.07365);
  assert.deepEqual(summary.localHistory.hourly.map(bucket => bucket.hour), [
    '2026-04-27T10:00:00.000Z',
    '2026-04-27T11:00:00.000Z'
  ]);
  assert.deepEqual(summary.localHistory.daily.map(bucket => bucket.date), ['2026-04-27']);
  assert.equal(cacheStore.value.files[sessionPath].parsedOffset, Buffer.byteLength(await fs.readFile(sessionPath, 'utf8')));
  assert.equal(cacheStore.value.files[sessionPath].lastModel, 'claude-sonnet-4-5-20250929');
});

test('LocalDataService reuses unchanged JSONL cache without reading file content', async () => {
  const tempDir = await makeClaudeDir();
  await writePricing(tempDir);
  const sessionPath = await writeSession(tempDir, 'project-a', 'session.jsonl', [
    assistantRecord('2026-04-27T10:15:00.000Z', 'claude-sonnet-4-5-20250929', {
      input_tokens: 1000,
      output_tokens: 1000
    })
  ]);
  const cacheStore = new MemoryStore(null);
  const fsImpl = countingFs();
  const service = new LocalDataService(tempDir, { cacheStore, fsImpl });

  await service.load(new Date('2026-04-27T12:00:00.000Z'));
  await service.load(new Date('2026-04-27T12:00:00.000Z'));

  assert.equal(fsImpl.readRangeCalls.filter(call => call.filePath === sessionPath).length, 1);
});

test('LocalDataService reads only appended JSONL bytes when file grows', async () => {
  const tempDir = await makeClaudeDir();
  await writePricing(tempDir);
  const sessionPath = await writeSession(tempDir, 'project-a', 'session.jsonl', [
    assistantRecord('2026-04-27T10:15:00.000Z', 'claude-sonnet-4-5-20250929', {
      input_tokens: 1000,
      output_tokens: 1000
    })
  ]);
  const cacheStore = new MemoryStore(null);
  const fsImpl = countingFs();
  const service = new LocalDataService(tempDir, { cacheStore, fsImpl });

  await service.load(new Date('2026-04-27T12:00:00.000Z'));
  const firstOffset = cacheStore.value.files[sessionPath].parsedOffset;
  await fs.appendFile(
    sessionPath,
    `${JSON.stringify(assistantRecord('2026-04-27T11:15:00.000Z', 'claude-sonnet-4-5-20250929', {
      input_tokens: 2000,
      output_tokens: 1000
    }))}\n`
  );

  const summary = await service.load(new Date('2026-04-27T12:00:00.000Z'));

  assert.equal(summary.todayStats.inputTokens, 3000);
  assert.equal(summary.todayStats.outputTokens, 2000);
  assert.deepEqual(fsImpl.readRangeCalls.at(-1), { filePath: sessionPath, start: firstOffset });
});

test('LocalDataService carries an incomplete JSONL line across appends', async () => {
  const tempDir = await makeClaudeDir();
  await writePricing(tempDir);
  const projectDir = path.join(tempDir, 'projects', 'project-a');
  await fs.mkdir(projectDir, { recursive: true });
  const sessionPath = path.join(projectDir, 'session.jsonl');
  const record = assistantRecord('2026-04-27T10:15:00.000Z', 'claude-sonnet-4-5-20250929', {
    input_tokens: 1000,
    output_tokens: 500
  });
  await fs.writeFile(sessionPath, JSON.stringify(record));
  const cacheStore = new MemoryStore(null);
  const service = new LocalDataService(tempDir, { cacheStore });

  let summary = await service.load(new Date('2026-04-27T12:00:00.000Z'));
  assert.equal(summary.todayStats.isEmpty, true);
  assert.equal(cacheStore.value.files[sessionPath].parsedOffset, 0);
  assert.notEqual(cacheStore.value.files[sessionPath].remainder, '');

  await fs.appendFile(sessionPath, '\n');
  summary = await service.load(new Date('2026-04-27T12:00:00.000Z'));

  assert.equal(summary.todayStats.inputTokens, 1000);
  assert.equal(summary.todayStats.outputTokens, 500);
  assert.equal(cacheStore.value.files[sessionPath].remainder, '');
  assert.equal(cacheStore.value.files[sessionPath].parsedOffset, Buffer.byteLength(`${JSON.stringify(record)}\n`));
});

test('LocalDataService reprocesses JSONL from zero when file shrinks', async () => {
  const tempDir = await makeClaudeDir();
  await writePricing(tempDir);
  const sessionPath = await writeSession(tempDir, 'project-a', 'session.jsonl', [
    assistantRecord('2026-04-27T10:15:00.000Z', 'claude-sonnet-4-5-20250929', {
      input_tokens: 1000,
      output_tokens: 1000
    }),
    assistantRecord('2026-04-27T11:15:00.000Z', 'claude-sonnet-4-5-20250929', {
      input_tokens: 2000,
      output_tokens: 1000
    })
  ]);
  const cacheStore = new MemoryStore(null);
  const fsImpl = countingFs();
  const service = new LocalDataService(tempDir, { cacheStore, fsImpl });
  await service.load(new Date('2026-04-27T12:00:00.000Z'));

  await fs.writeFile(
    sessionPath,
    `${JSON.stringify(assistantRecord('2026-04-27T12:15:00.000Z', 'claude-sonnet-4-5-20250929', {
      input_tokens: 500,
      output_tokens: 250
    }))}\n`
  );
  const summary = await service.load(new Date('2026-04-27T13:00:00.000Z'));

  assert.equal(summary.todayStats.inputTokens, 500);
  assert.equal(summary.todayStats.outputTokens, 250);
  assert.deepEqual(fsImpl.readRangeCalls.at(-1), { filePath: sessionPath, start: 0 });
});

test('LocalDataService deduplicates JSONL entries with same messageId:requestId', async () => {
  const tempDir = await makeClaudeDir();
  await writePricing(tempDir);
  const duplicateRecord = JSON.stringify({
    type: 'assistant',
    timestamp: '2026-04-27T10:15:00.000Z',
    requestId: 'req-abc',
    message: {
      id: 'msg-xyz',
      model: 'claude-sonnet-4-5-20250929',
      usage: {
        input_tokens: 1000,
        output_tokens: 500
      }
    }
  });
  // Same messageId + requestId written twice
  const sessionPath = path.join(tempDir, 'projects', 'project-a', 'session.jsonl');
  await fs.mkdir(path.dirname(sessionPath), { recursive: true });
  await fs.writeFile(sessionPath, `${duplicateRecord}\n${duplicateRecord}\n`);
  const cacheStore = new MemoryStore(null);
  const service = new LocalDataService(tempDir, { cacheStore });

  const summary = await service.load(new Date('2026-04-27T12:00:00.000Z'));

  // Should count tokens once, not twice
  assert.equal(summary.todayStats.inputTokens, 1000);
  assert.equal(summary.todayStats.outputTokens, 500);
});

async function makeClaudeDir() {
  const tempDir = await fs.mkdtemp(path.join(os.tmpdir(), 'siphon-local-data-'));
  await fs.mkdir(path.join(tempDir, 'projects'), { recursive: true });
  return tempDir;
}

async function writePricing(claudeDir) {
  await fs.writeFile(
    path.join(claudeDir, 'readout-pricing.json'),
    JSON.stringify({
      models: {
        'claude-sonnet-4-5': {
          input: 3,
          output: 15,
          cache_read: 0.3,
          cache_write: 3.75
        }
      }
    })
  );
}

async function writeSession(claudeDir, projectName, fileName, records) {
  const projectDir = path.join(claudeDir, 'projects', projectName);
  await fs.mkdir(projectDir, { recursive: true });
  const filePath = path.join(projectDir, fileName);
  await fs.writeFile(
    filePath,
    `${records.map(record => typeof record === 'string' ? record : JSON.stringify(record)).join('\n')}\n`
  );
  return filePath;
}

function assistantRecord(timestamp, model, usage) {
  return {
    type: 'assistant',
    timestamp,
    message: {
      model,
      usage
    }
  };
}

function countingFs() {
  const readFileCounts = new Map();
  const api = {
    readdir: (...args) => fs.readdir(...args),
    stat: (...args) => fs.stat(...args),
    readFile: async (filePath, ...args) => {
      readFileCounts.set(filePath, (readFileCounts.get(filePath) ?? 0) + 1);
      return fs.readFile(filePath, ...args);
    },
    readRange: async (filePath, start) => {
      api.readRangeCalls.push({ filePath, start });
      const handle = await fs.open(filePath, 'r');
      try {
        const stat = await handle.stat();
        const length = Math.max(0, stat.size - start);
        const buffer = Buffer.alloc(length);
        await handle.read(buffer, 0, length, start);
        return buffer.toString('utf8');
      } finally {
        await handle.close();
      }
    },
    readRangeCalls: [],
    readFileCount: filePath => readFileCounts.get(filePath) ?? 0
  };
  return api;
}

class MemoryStore {
  constructor(value) {
    this.value = value;
  }

  async load() {
    return this.value;
  }

  async save(value) {
    this.value = structuredClone(value);
  }
}

