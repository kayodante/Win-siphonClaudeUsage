import assert from 'node:assert/strict';
import test from 'node:test';

import {
  buildProviderResetLine,
  buildSessionResetLine,
  buildWeeklyResetLine
} from '../src/shared/resetCopy.js';

const NOW = new Date('2026-05-04T12:00:00Z');

test('session at 0% shows empty prompt in PT', () => {
  const slot = { percent: 0, resetsAt: new Date('2026-05-04T17:42:00Z') };
  assert.equal(
    buildSessionResetLine(slot, NOW, 'pt-BR'),
    'Envie uma mensagem para iniciar'
  );
});

test('session at 0% shows empty prompt in EN', () => {
  const slot = { percent: 0, resetsAt: new Date('2026-05-04T17:42:00Z') };
  assert.equal(
    buildSessionResetLine(slot, NOW, 'en'),
    'Send a message to start'
  );
});

test('session at 0% shows empty prompt in KO', () => {
  const slot = { percent: 0, resetsAt: new Date('2026-05-04T17:42:00Z') };
  assert.equal(
    buildSessionResetLine(slot, NOW, 'ko'),
    '메시지를 보내 시작하세요'
  );
});

test('session in progress shows remaining + clock in PT', () => {
  const slot = { percent: 25, resetsAt: new Date('2026-05-04T14:14:00Z') };
  const result = buildSessionResetLine(slot, NOW, 'pt-BR');
  assert.match(result, /restantes · Reseta às \d{2}:\d{2}$/);
});

test('session at 100% shows full message + remaining time in PT', () => {
  const slot = { percent: 100, resetsAt: new Date('2026-05-04T14:14:00Z') };
  const result = buildSessionResetLine(slot, NOW, 'pt-BR');
  assert.match(result, /^Sessão esgotada · Reseta em \d+h \d+min, às \d{2}:\d{2}$/);
});

test('session at 100% shows full message + remaining time in EN', () => {
  const slot = { percent: 100, resetsAt: new Date('2026-05-04T14:14:00Z') };
  const result = buildSessionResetLine(slot, NOW, 'en');
  assert.match(result, /^Session full · Resets in \d+h \d+min, at \d{2}:\d{2}$/);
});

test('session at 100% shows full message + remaining time in KO', () => {
  const slot = { percent: 100, resetsAt: new Date('2026-05-04T14:14:00Z') };
  const result = buildSessionResetLine(slot, NOW, 'ko');
  assert.match(result, /^세션 한도 도달 · \d+시간 \d+분 후인 \d{2}:\d{2}에 리셋$/);
});

test('session at 100% with < 1h left shows minutes only in PT', () => {
  const slot = { percent: 100, resetsAt: new Date('2026-05-04T12:50:00Z') };
  const result = buildSessionResetLine(slot, NOW, 'pt-BR');
  assert.match(result, /^Sessão esgotada · Reseta em \d+min, às \d{2}:\d{2}$/);
});

test('null session shows empty prompt', () => {
  assert.equal(
    buildSessionResetLine(null, NOW, 'pt-BR'),
    'Envie uma mensagem para iniciar'
  );
});

test('weekly at 0% shows empty prompt', () => {
  const slot = { percent: 0, resetsAt: new Date('2026-05-08T00:00:00Z') };
  assert.equal(
    buildWeeklyResetLine(slot, NOW, 'pt-BR'),
    'Envie uma mensagem para iniciar'
  );
});

test('weekly in progress shows days + weekday in PT', () => {
  const slot = { percent: 25, resetsAt: new Date('2026-05-08T00:00:00Z') };
  const result = buildWeeklyResetLine(slot, NOW, 'pt-BR');
  assert.match(result, /^Reseta em \d+ dias? · /);
});

test('weekly resetting within a day shows hours/minutes, not "1 dia"', () => {
  const slot = { percent: 25, resetsAt: new Date('2026-05-04T23:59:00Z') };
  const result = buildWeeklyResetLine(slot, NOW, 'pt-BR');
  assert.match(result, /^\d+h \d+min restantes · /);
});

test('weekly at 100% shows limit reached in PT', () => {
  const slot = { percent: 100, resetsAt: new Date('2026-05-08T00:00:00Z') };
  const result = buildWeeklyResetLine(slot, NOW, 'pt-BR');
  assert.match(result, /^Limite atingido · Reseta /);
});

test('weekly at 100% shows limit reached in EN', () => {
  const slot = { percent: 100, resetsAt: new Date('2026-05-08T00:00:00Z') };
  const result = buildWeeklyResetLine(slot, NOW, 'en');
  assert.match(result, /^Limit reached · Resets /);
});

test('weekly at 100% shows limit reached in KO', () => {
  const slot = { percent: 100, resetsAt: new Date('2026-05-08T00:00:00Z') };
  const result = buildWeeklyResetLine(slot, NOW, 'ko');
  assert.match(result, /^한도 도달 · /);
});

test('a provider window says why it has no number, and only a measured zero says start', () => {
  const ctx = { now: NOW, lang: 'pt-BR' };
  const measuredZero = { percent: 0, resetsAt: '2026-05-04T17:42:00Z', rolledOver: false };
  assert.equal(buildProviderResetLine(measuredZero, 'session', ctx), 'Envie uma mensagem para iniciar');
  const unknown = { percent: null, resetsAt: '2026-05-04T17:42:00Z', rolledOver: false };
  assert.equal(buildProviderResetLine(unknown, 'session', ctx), 'Sem leitura disponível');
  assert.equal(buildProviderResetLine(unknown, 'weekly', ctx), 'Sem leitura disponível');
  const rolled = { percent: null, resetsAt: '2026-05-04T11:00:00Z', rolledOver: true };
  assert.equal(buildProviderResetLine(rolled, 'session', ctx), 'Reset previsto · aguardando nova leitura');
});

test('a blocked provider session never suggests sending a message', () => {
  const full = { percent: 0, resetsAt: '2026-05-04T17:42:00Z', rolledOver: false };
  const blocked = { now: NOW, lang: 'pt-BR', blocked: true, weeklySpent: true };
  assert.equal(buildProviderResetLine(full, 'session', blocked), 'Bloqueado pelo limite semanal');
  assert.equal(
    buildProviderResetLine(full, 'session', { ...blocked, weeklySpent: false }),
    'Bloqueado pelo provedor'
  );
  // The weekly row keeps its own reading.
  const weekly = { percent: 100, resetsAt: '2026-05-08T00:00:00Z', rolledOver: false };
  assert.match(buildProviderResetLine(weekly, 'weekly', blocked), /^Limite atingido · /);
});

test('a measured provider window reads like a Claude slot', () => {
  const window = { percent: 40, resetsAt: '2026-05-04T17:42:00Z', rolledOver: false };
  const slot = { percent: 40, resetsAt: new Date('2026-05-04T17:42:00Z') };
  assert.equal(
    buildProviderResetLine(window, 'session', { now: NOW, lang: 'en' }),
    buildSessionResetLine(slot, NOW, 'en')
  );
});
