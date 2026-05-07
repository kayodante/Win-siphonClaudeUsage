import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

// Fallback pricing (USD per million tokens) for when readout-pricing.json is absent.
// Keys must match what pricingKey() produces (no "claude-" prefix, no date suffix).
const BUNDLED_PRICING = {
  models: {
    'sonnet-4-6': { input: 3,    output: 15,   cacheRead: 0.30,  cacheWrite: 3.75  },
    'sonnet-4-5': { input: 3,    output: 15,   cacheRead: 0.30,  cacheWrite: 3.75  },
    'sonnet-4':   { input: 3,    output: 15,   cacheRead: 0.30,  cacheWrite: 3.75  },
    'opus-4-7':   { input: 15,   output: 75,   cacheRead: 1.50,  cacheWrite: 18.75 },
    'opus-4':     { input: 15,   output: 75,   cacheRead: 1.50,  cacheWrite: 18.75 },
    'haiku-4-5':  { input: 0.80, output: 4,    cacheRead: 0.08,  cacheWrite: 1.00  },
    'haiku-4':    { input: 0.25, output: 1.25, cacheRead: 0.03,  cacheWrite: 0.30  },
  }
};

export class LocalDataService {
  constructor(claudeDir = path.join(os.homedir(), '.claude')) {
    this.claudeDir = claudeDir;
    this.cachePath = path.join(claudeDir, 'readout-cost-cache.json');
    this.pricingPath = path.join(claudeDir, 'readout-pricing.json');
    this.projectsDir = path.join(claudeDir, 'projects');
  }

  async load(now = new Date()) {
    const [cache, pricingFile] = await Promise.all([
      readJson(this.cachePath),
      readJson(this.pricingPath)
    ]);

    // Legacy path: older Claude Code versions write readout-cost-cache.json
    if (cache) {
      return summarizeUsage(cache, pricingFile, now);
    }

    // Modern path: token data lives in per-session JSONL files under ~/.claude/projects/
    return summarizeFromJSONL(this.projectsDir, pricingFile ?? BUNDLED_PRICING, now);
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
        todayModels.set(model, { tokens, cost });
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
    addTokens(totals, entry.tokens, entry.cost);
    byModel[model] = toPerModelStats(model, entry.tokens, entry.cost);
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

async function summarizeFromJSONL(projectsDir, pricing, now) {
  const LOOKBACK_MS = 35 * 24 * 60 * 60 * 1000;
  const cutoff = new Date(now.getTime() - LOOKBACK_MS);

  // dayMap[dateKey][model] = { input, output, cacheRead, cacheWrite }
  const dayMap = {};

  let projectEntries;
  try {
    projectEntries = await fs.readdir(projectsDir, { withFileTypes: true });
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
      files = await fs.readdir(projectPath);
    } catch {
      continue;
    }

    for (const file of files) {
      if (!file.endsWith('.jsonl')) continue;
      const filePath = path.join(projectPath, file);

      try {
        const stat = await fs.stat(filePath);
        if (stat.mtimeMs < cutoff.getTime()) continue;
      } catch {
        continue;
      }

      let content;
      try {
        content = await fs.readFile(filePath, 'utf8');
      } catch {
        continue;
      }

      for (const line of content.split('\n')) {
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

        const dateKey = toLocalDateKey(entryTime);
        const model = record.message.model ?? 'unknown';
        const u = record.message.usage;

        if (!dayMap[dateKey]) dayMap[dateKey] = {};
        if (!dayMap[dateKey][model]) {
          dayMap[dateKey][model] = { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 };
        }
        const acc = dayMap[dateKey][model];
        acc.input     += u.input_tokens                  ?? 0;
        acc.output    += u.output_tokens                 ?? 0;
        acc.cacheRead += u.cache_read_input_tokens       ?? 0;
        acc.cacheWrite += u.cache_creation_input_tokens  ?? 0;
      }
    }
  }

  return summarizeUsage({ days: dayMap }, pricing, now);
}

async function readJson(filePath) {
  let raw;
  try {
    raw = await fs.readFile(filePath, 'utf8');
  } catch (error) {
    if (error.code === 'ENOENT') return null;
    throw error;
  }
  return JSON.parse(raw);
}
