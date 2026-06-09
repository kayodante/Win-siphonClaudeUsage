import assert from 'node:assert/strict';
import test from 'node:test';

import { buildTrayStatus } from '../src/shared/trayStatus.js';

test('buildTrayStatus formats a rich English tooltip and menu items', () => {
  const status = buildTrayStatus(sampleState(), {
    lang: 'en',
    now: new Date('2026-05-04T12:05:00.000Z')
  });

  assert.equal(
    status.tooltip,
    [
      'Siphon',
      'Session: 42%',
      'Weekly: 64%',
      'Session reset: 17:42',
      'Updated: updated 2min ago'
    ].join('\n')
  );
  assert.deepEqual(status.menuItems, [
    { label: 'Session: 42%', enabled: false },
    { label: 'Weekly: 64%', enabled: false },
    { label: 'Session reset: 17:42', enabled: false },
    { label: 'Updated: updated 2min ago', enabled: false }
  ]);
});

test('buildTrayStatus formats Portuguese labels', () => {
  const status = buildTrayStatus(sampleState(), {
    lang: 'pt-BR',
    now: new Date('2026-05-04T12:05:00.000Z')
  });

  assert.match(status.tooltip, /Sessão: 42%/);
  assert.match(status.tooltip, /Semanal: 64%/);
  assert.match(status.tooltip, /Reset da sessão: 17:42/);
  assert.match(status.tooltip, /Atualizado: atualizado há 2min/);
});

test('buildTrayStatus handles missing quota and update data', () => {
  const status = buildTrayStatus({}, {
    lang: 'en',
    now: new Date('2026-05-04T12:05:00.000Z')
  });

  assert.equal(
    status.tooltip,
    [
      'Siphon',
      'Session: --',
      'Weekly: --',
      'Session reset: --:--',
      'Updated: never updated'
    ].join('\n')
  );
});

function sampleState() {
  return {
    quota: {
      session: {
        percent: 42.2,
        resetsAt: '2026-05-04T17:42:00.000'
      },
      weeklyAll: {
        percent: 64.1,
        resetsAt: '2026-05-08T00:00:00.000'
      }
    },
    lastUpdated: '2026-05-04T12:03:00.000Z'
  };
}
