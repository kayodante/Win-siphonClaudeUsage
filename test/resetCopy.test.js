import assert from 'node:assert/strict';
import test from 'node:test';

import { buildSessionResetLine, buildWeeklyResetLine } from '../src/shared/resetCopy.js';

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

test('session in progress shows remaining + clock in PT', () => {
  const slot = { percent: 25, resetsAt: new Date('2026-05-04T14:14:00Z') };
  const result = buildSessionResetLine(slot, NOW, 'pt-BR');
  assert.match(result, /restantes · Reseta às \d{2}:\d{2}$/);
});

test('session at 100% shows full message in PT', () => {
  const slot = { percent: 100, resetsAt: new Date('2026-05-04T14:14:00Z') };
  const result = buildSessionResetLine(slot, NOW, 'pt-BR');
  assert.match(result, /^Sessão esgotada · Reseta às \d{2}:\d{2}$/);
});

test('session at 100% shows full message in EN', () => {
  const slot = { percent: 100, resetsAt: new Date('2026-05-04T14:14:00Z') };
  const result = buildSessionResetLine(slot, NOW, 'en');
  assert.match(result, /^Session full · Resets at \d{2}:\d{2}$/);
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
