import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

export class LocalDataService {
  constructor(claudeDir = path.join(os.homedir(), '.claude')) {
    this.cachePath = path.join(claudeDir, 'readout-cost-cache.json');
    this.pricingPath = path.join(claudeDir, 'readout-pricing.json');
  }

  async load(now = new Date()) {
    const [cache, pricing] = await Promise.all([
      readJson(this.cachePath),
      readJson(this.pricingPath)
    ]);
    return summarizeUsage(cache, pricing, now);
  }
}

export function summarizeUsage(cache, pricing, now = new Date()) {
  const today = toLocalDateKey(now);
  const monthPrefix = today.slice(0, 7);
  const days = cache?.days ?? {};
  const todayModels = new Map();
  const monthModels = new Map();
  const recentDays = [];

  for (const [date, modelMap] of Object.entries(days)) {
    let dayCost = 0;
    for (const [model, rawTokens] of Object.entries(modelMap ?? {})) {
      const tokens = normalizeTokens(rawTokens);
      const price = findPrice(pricing, model);
      const cost = price ? tokenCost(tokens, price) : 0;
      dayCost += cost;

      if (date === today) {
        todayModels.set(model, { tokens, cost });
      }

      if (date.startsWith(monthPrefix)) {
        const current = monthModels.get(model) ?? emptyAccumulator();
        monthModels.set(model, addTokens(current, tokens, cost));
      }
    }
    recentDays.push({ date, cost: roundCost(dayCost) });
  }

  return {
    todayStats: aggregateToday(todayModels),
    monthStats: aggregateMonth(monthModels),
    recentDays: recentDays.sort((a, b) => b.date.localeCompare(a.date)),
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
