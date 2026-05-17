import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

import { JsonStore } from './jsonStore.js';
import { configDir } from './tokenStore.js';

// Fallback pricing (USD per million tokens) for when readout-pricing.json is absent.
// Keys must match what pricingKey() produces (no "claude-" prefix, no date suffix).
// Prices verified against platform.claude.com/docs (verified 2026-05-17).
// cacheRead = input × 0.10, cacheWrite = input × 1.25 (standard Anthropic formula).
const BUNDLED_PRICING = {
  models: {
    'sonnet-4-6': { input: 3,    output: 15,   cacheRead: 0.30,  cacheWrite: 3.75  },
    'sonnet-4-5': { input: 3,    output: 15,   cacheRead: 0.30,  cacheWrite: 3.75  },
    'sonnet-4':   { input: 3,    output: 15,   cacheRead: 0.30,  cacheWrite: 3.75  },
    'opus-4-7':   { input: 5,    output: 25,   cacheRead: 0.50,  cacheWrite: 6.25  },
    'opus-4-6':   { input: 5,    output: 25,   cacheRead: 0.50,  cacheWrite: 6.25  },
    'opus-4-5':   { input: 5,    output: 25,   cacheRead: 0.50,  cacheWrite: 6.25  },
    'opus-4-1':   { input: 15,   output: 75,   cacheRead: 1.50,  cacheWrite: 18.75 },
    'opus-4':     { input: 15,   output: 75,   cacheRead: 1.50,  cacheWrite: 18.75 },
    'haiku-4-5':  { input: 1,    output: 5,    cacheRead: 0.10,  cacheWrite: 1.25  },
    'haiku-4':    { input: 0.25, output: 1.25, cacheRead: 0.03,  cacheWrite: 0.30  },
  }
};

const CACHE_VERSION = 1;
const LOOKBACK_MS = 35 * 24 * 60 * 60 * 1000;
const MAX_HOURLY_BUCKETS = 72;

export class LocalDataService {
  constructor(claudeDir = path.join(os.homedir(), '.claude'), options = {}) {
    this.claudeDir = claudeDir;
    this.cachePath = path.join(claudeDir, 'readout-cost-cache.json');
    this.pricingPath = path.join(claudeDir, 'readout-pricing.json');
    this.projectsDir = path.join(claudeDir, 'projects');
    this.cacheStore = options.cacheStore ?? new JsonStore(path.join(configDir(), 'local-usage-cache.json'));
    this.fs = options.fsImpl ?? fs;
  }

  async load(now = new Date()) {
    const [cache, pricingFile] = await Promise.all([
      readJson(this.cachePath, this.fs),
      readJson(this.pricingPath, this.fs)
    ]);

    // Legacy path: older Claude Code versions write readout-cost-cache.json
    if (cache) {
      return summarizeUsage(cache, pricingFile, now);
    }

    // Modern path: token data lives in per-session JSONL files under ~/.claude/projects/
    return summarizeFromJSONL({
      projectsDir: this.projectsDir,
      pricing: pricingFile ?? BUNDLED_PRICING,
      now,
      cacheStore: this.cacheStore,
      fsImpl: this.fs
    });
  }
}

export function summarizeUsage(cache, pricing, now = new Date()) {
  const today = toLocalDateKey(now);
  const monthPrefix = today.slice(0, 7);
  const days = cache?.days ?? {};
  const todayModels = new Map();
  const monthModels = new Map();

  for (const [date, modelMap] of Object.entries(days)) {
    for (const [model, rawTokens] of Object.entries(modelMap ?? {})) {
      const tokens = normalizeTokens(rawTokens);
      const price = findPrice(pricing, model);
      const cost = price ? tokenCost(tokens, price) : 0;

      if (date === today) {
        const current = todayModels.get(model) ?? emptyAccumulator();
        todayModels.set(model, addTokens(current, tokens, cost));
      }

      if (date.startsWith(monthPrefix)) {
        const current = monthModels.get(model) ?? emptyAccumulator();
        monthModels.set(model, addTokens(current, tokens, cost));
      }
    }
  }

  return {
    todayStats: aggregateToday(todayModels),
    monthStats: aggregateMonth(monthModels),
    localHistory: buildLocalHistory({ days, pricing, now }),
    lastUpdated: now
  };
}

export function pricingKey(model) {
  const lower = model.toLowerCase().replace(/^claude-/, '');
  return lower.replace(/-\d{8}$/, '');
}

function findPrice(pricing, model) {
  const models = pricing?.models ?? {};
  const normalized = pricingKey(model);
  return (
    models[normalized] ??
    models[`claude-${normalized}`] ??
    models[model] ??
    models[model.toLowerCase()]
  );
}

function normalizeTokens(tokens) {
  return {
    input: Number(tokens?.input ?? 0),
    output: Number(tokens?.output ?? 0),
    cacheRead: Number(tokens?.cacheRead ?? tokens?.cache_read ?? 0),
    cacheWrite: Number(tokens?.cacheWrite ?? tokens?.cache_write ?? 0)
  };
}

function tokenCost(tokens, price) {
  const million = 1_000_000;
  return roundCost(
    (tokens.input / million) * Number(price.input ?? 0) +
      (tokens.output / million) * Number(price.output ?? 0) +
      (tokens.cacheRead / million) * Number(price.cacheRead ?? price.cache_read ?? 0) +
      (tokens.cacheWrite / million) * Number(price.cacheWrite ?? price.cache_write ?? 0)
  );
}

function aggregateToday(map) {
  const totals = emptyAccumulator();
  const byModel = {};
  for (const [model, entry] of map.entries()) {
    addTokens(totals, entry, entry.cost);
    byModel[model] = toPerModelStats(model, entry, entry.cost);
  }
  return toPeriodStats(totals, byModel);
}

function aggregateMonth(map) {
  const totals = emptyAccumulator();
  const byModel = {};
  for (const [model, entry] of map.entries()) {
    addTokens(totals, entry, entry.cost);
    byModel[model] = toPerModelStats(model, entry, entry.cost);
  }
  return toPeriodStats(totals, byModel);
}

function addTokens(target, tokens, cost) {
  target.inputTokens += tokens.input ?? tokens.inputTokens;
  target.outputTokens += tokens.output ?? tokens.outputTokens;
  target.cacheReadTokens += tokens.cacheRead ?? tokens.cacheReadTokens;
  target.cacheWriteTokens += tokens.cacheWrite ?? tokens.cacheWriteTokens;
  target.cost = roundCost(target.cost + cost);
  return target;
}

function emptyAccumulator() {
  return {
    inputTokens: 0,
    outputTokens: 0,
    cacheReadTokens: 0,
    cacheWriteTokens: 0,
    cost: 0
  };
}

function toPeriodStats(totals, byModel) {
  return {
    ...totals,
    totalTokens: totals.inputTokens + totals.outputTokens,
    isEmpty: totals.inputTokens + totals.outputTokens === 0 && totals.cost === 0,
    byModel
  };
}

function toPerModelStats(model, tokens, cost) {
  const input = tokens.input ?? tokens.inputTokens;
  const output = tokens.output ?? tokens.outputTokens;
  const cacheRead = tokens.cacheRead ?? tokens.cacheReadTokens;
  const cacheWrite = tokens.cacheWrite ?? tokens.cacheWriteTokens;
  return {
    modelKey: model,
    shortName: shortName(model),
    inputTokens: input,
    outputTokens: output,
    cacheReadTokens: cacheRead,
    cacheWriteTokens: cacheWrite,
    totalTokens: input + output,
    cost: roundCost(cost)
  };
}

function shortName(model) {
  const key = pricingKey(model);
  if (key.includes('opus')) return 'Opus';
  if (key.includes('sonnet')) return 'Sonnet';
  if (key.includes('haiku')) return 'Haiku';
  return key;
}

function toLocalDateKey(date) {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

function roundCost(value) {
  return Math.round(value * 100_000_000) / 100_000_000;
}

async function summarizeFromJSONL({ projectsDir, pricing, now, cacheStore, fsImpl }) {
  const cutoff = new Date(now.getTime() - LOOKBACK_MS);
  const cache = normalizeCache(await safeLoadCache(cacheStore));
  const nextFiles = {};

  let projectEntries;
  try {
    projectEntries = await fsImpl.readdir(projectsDir, { withFileTypes: true });
  } catch (error) {
    if (error.code === 'ENOENT') {
      const err = new Error('No Claude Code data found');
      err.code = 'ENODATA';
      throw err;
    }
    return summarizeUsage(null, null, now);
  }

  for (const entry of projectEntries) {
    if (!entry.isDirectory()) continue;
    const projectPath = path.join(projectsDir, entry.name);

    let files;
    try {
      files = await fsImpl.readdir(projectPath);
    } catch {
      continue;
    }

    for (const file of files) {
      if (!file.endsWith('.jsonl')) continue;
      const filePath = path.join(projectPath, file);

      let stat;
      try {
        stat = await fsImpl.stat(filePath);
        if (stat.mtimeMs < cutoff.getTime()) continue;
      } catch {
        continue;
      }

      const previous = cache.files[filePath];
      if (isUnchanged(previous, stat)) {
        nextFiles[filePath] = previous;
        continue;
      }

      nextFiles[filePath] = await parseJsonlFile({
        filePath,
        stat,
        previous,
        cutoff,
        fsImpl
      });
    }
  }

  const nextCache = {
    version: CACHE_VERSION,
    updatedAt: now.toISOString(),
    files: nextFiles
  };
  await cacheStore.save(nextCache);

  const days = mergeFileMaps(nextFiles, 'days');
  const hourly = mergeFileMaps(nextFiles, 'hourly');
  const summary = summarizeUsage({ days }, pricing, now);
  return {
    ...summary,
    localHistory: buildLocalHistory({ days, hourly, pricing, now })
  };
}

async function parseJsonlFile({ filePath, stat, previous, cutoff, fsImpl }) {
  const shouldAppend =
    previous &&
    Number(previous.parsedOffset) >= 0 &&
    stat.size >= previous.parsedOffset &&
    stat.size >= previous.size;
  const start = shouldAppend ? previous.parsedOffset : 0;
  const base = shouldAppend ? cloneFileAggregate(previous) : emptyFileAggregate(filePath);

  let chunk;
  try {
    chunk = await readRange(fsImpl, filePath, start);
  } catch {
    return base;
  }

  const parsed = parseJsonlChunk({
    chunk,
    previousRemainder: '',
    aggregate: base,
    cutoff
  });

  return {
    ...parsed.aggregate,
    path: filePath,
    mtimeMs: stat.mtimeMs,
    size: stat.size,
    parsedOffset: stat.size - Buffer.byteLength(parsed.remainder, 'utf8'),
    remainder: parsed.remainder
  };
}

function parseJsonlChunk({ chunk, previousRemainder, aggregate, cutoff }) {
  const text = `${previousRemainder}${chunk}`;
  const lines = text.split('\n');
  const endsWithNewline = text.endsWith('\n');
  const remainder = endsWithNewline ? '' : lines.pop() ?? '';

  for (const line of lines) {
    if (!line.trim()) continue;
    let record;
    try {
      record = JSON.parse(line);
    } catch {
      continue;
    }

    if (record.type !== 'assistant' || !record.message?.usage || !record.timestamp) continue;

    const entryTime = new Date(record.timestamp);
    if (Number.isNaN(entryTime.getTime()) || entryTime < cutoff) continue;

    const model = record.message.model ?? aggregate.lastModel ?? 'unknown';
    const tokens = normalizeJsonlUsage(record.message.usage);
    const dateKey = toLocalDateKey(entryTime);
    const hourKey = toHourKey(entryTime);

    addToNestedTokenMap(aggregate.days, dateKey, model, tokens);
    addToNestedTokenMap(aggregate.hourly, hourKey, model, tokens);
    aggregate.lastModel = model;
    aggregate.lastTokenTotals = tokens;
  }

  return { aggregate, remainder };
}

function buildLocalHistory({ days = {}, hourly = {}, pricing, now }) {
  const cutoff = new Date(now.getTime() - LOOKBACK_MS);
  return {
    hourly: aggregateHistory(hourly, pricing, cutoff, MAX_HOURLY_BUCKETS, 'hour'),
    daily: aggregateHistory(days, pricing, cutoff, 35, 'date')
  };
}

function aggregateHistory(bucketMap, pricing, cutoff, limit, labelKey) {
  return Object.entries(bucketMap)
    .filter(([key]) => {
      const date = new Date(labelKey === 'hour' ? key : `${key}T23:59:59.999`);
      return !Number.isNaN(date.getTime()) && date >= cutoff;
    })
    .sort(([a], [b]) => a.localeCompare(b))
    .slice(-limit)
    .map(([key, modelMap]) => {
      const totals = emptyAccumulator();
      for (const [model, rawTokens] of Object.entries(modelMap ?? {})) {
        const tokens = normalizeTokens(rawTokens);
        const price = findPrice(pricing, model);
        addTokens(totals, tokens, price ? tokenCost(tokens, price) : 0);
      }
      return {
        [labelKey]: key,
        ...toHistoryStats(totals)
      };
    });
}

function toHistoryStats(totals) {
  return {
    inputTokens: totals.inputTokens,
    outputTokens: totals.outputTokens,
    cacheReadTokens: totals.cacheReadTokens,
    cacheWriteTokens: totals.cacheWriteTokens,
    totalTokens: totals.inputTokens + totals.outputTokens,
    cost: totals.cost
  };
}

function addToNestedTokenMap(map, key, model, tokens) {
  map[key] ??= {};
  map[key][model] ??= { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 };
  map[key][model].input += tokens.input;
  map[key][model].output += tokens.output;
  map[key][model].cacheRead += tokens.cacheRead;
  map[key][model].cacheWrite += tokens.cacheWrite;
}

function normalizeJsonlUsage(usage) {
  return {
    input: Number(usage.input_tokens ?? 0),
    output: Number(usage.output_tokens ?? 0),
    cacheRead: Number(usage.cache_read_input_tokens ?? 0),
    cacheWrite: Number(usage.cache_creation_input_tokens ?? 0)
  };
}

function mergeFileMaps(files, key) {
  const merged = {};
  for (const fileCache of Object.values(files)) {
    for (const [bucket, modelMap] of Object.entries(fileCache?.[key] ?? {})) {
      for (const [model, tokens] of Object.entries(modelMap ?? {})) {
        addToNestedTokenMap(merged, bucket, model, normalizeTokens(tokens));
      }
    }
  }
  return merged;
}

function emptyFileAggregate(filePath) {
  return {
    path: filePath,
    mtimeMs: 0,
    size: 0,
    parsedOffset: 0,
    remainder: '',
    lastModel: null,
    lastTokenTotals: null,
    days: {},
    hourly: {}
  };
}

function cloneFileAggregate(fileCache) {
  return {
    ...emptyFileAggregate(fileCache.path),
    ...structuredClone(fileCache),
    days: structuredClone(fileCache.days ?? {}),
    hourly: structuredClone(fileCache.hourly ?? {})
  };
}

function isUnchanged(fileCache, stat) {
  return fileCache && fileCache.mtimeMs === stat.mtimeMs && fileCache.size === stat.size;
}

function normalizeCache(cache) {
  if (cache?.version !== CACHE_VERSION || !cache.files || typeof cache.files !== 'object') {
    return { version: CACHE_VERSION, files: {} };
  }
  return cache;
}

async function safeLoadCache(cacheStore) {
  try {
    return await cacheStore.load();
  } catch {
    return null;
  }
}

async function readRange(fsImpl, filePath, start) {
  if (typeof fsImpl.readRange === 'function') {
    return fsImpl.readRange(filePath, start);
  }

  if (start === 0) {
    return fsImpl.readFile(filePath, 'utf8');
  }

  const handle = await fsImpl.open(filePath, 'r');
  try {
    const stat = await handle.stat();
    const length = Math.max(0, stat.size - start);
    const buffer = Buffer.alloc(length);
    await handle.read(buffer, 0, length, start);
    return buffer.toString('utf8');
  } finally {
    await handle.close();
  }
}

function toHourKey(date) {
  return new Date(Date.UTC(
    date.getUTCFullYear(),
    date.getUTCMonth(),
    date.getUTCDate(),
    date.getUTCHours()
  )).toISOString();
}

async function readJson(filePath, fsImpl = fs) {
  let raw;
  try {
    raw = await fsImpl.readFile(filePath, 'utf8');
  } catch (error) {
    if (error.code === 'ENOENT') return null;
    throw error;
  }
  return JSON.parse(raw);
}
