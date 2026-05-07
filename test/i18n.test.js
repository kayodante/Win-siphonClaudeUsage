import assert from 'node:assert/strict';
import test from 'node:test';

import { SUPPORTED_LANGUAGES, t, tFormat } from '../src/shared/i18n.js';

test('SUPPORTED_LANGUAGES lists English and Brazilian Portuguese', () => {
  assert.deepEqual(SUPPORTED_LANGUAGES, ['en', 'pt-BR']);
});

test('known key in English returns English string', () => {
  assert.equal(t('settings.language', 'en'), 'Language');
});

test('known key in Portuguese returns Portuguese string', () => {
  assert.equal(t('settings.language', 'pt-BR'), 'Idioma');
});

test('unknown language falls back to English', () => {
  assert.equal(t('settings.language', 'fr'), 'Language');
});

test('missing key returns the key', () => {
  assert.equal(t('missing.translation.key', 'pt-BR'), 'missing.translation.key');
});

test('tFormat substitutes named parameters', () => {
  assert.equal(
    tFormat('reset.connector.at', 'pt-BR', { time: '17:42' }),
    'Reseta às 17:42'
  );
});

test('tFormat falls back to English when locale missing', () => {
  assert.equal(
    tFormat('reset.connector.day', 'fr', { weekday: 'Tue, 00:00' }),
    'Resets Tue, 00:00'
  );
});

test('tFormat leaves unknown placeholders intact', () => {
  assert.match(tFormat('reset.connector.at', 'en'), /\{time\}/);
});
