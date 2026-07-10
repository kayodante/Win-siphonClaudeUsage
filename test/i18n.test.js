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

test('refresh interval strings exist in both languages', () => {
  for (const lang of SUPPORTED_LANGUAGES) {
    assert.notEqual(t('settings.refreshInterval', lang), 'settings.refreshInterval');
    assert.notEqual(t('settings.refresh30s', lang), 'settings.refresh30s');
    assert.notEqual(t('settings.refresh5m', lang), 'settings.refresh5m');
    assert.notEqual(t('settings.refresh15m', lang), 'settings.refresh15m');
    assert.notEqual(t('error.saveRefresh', lang), 'error.saveRefresh');
  }
});

test('pace and tray strings exist in both languages', () => {
  for (const lang of SUPPORTED_LANGUAGES) {
    assert.notEqual(t('pace.no_data', lang), 'pace.no_data');
    assert.notEqual(t('pace.on_track', lang), 'pace.on_track');
    assert.notEqual(t('pace.high_pace', lang), 'pace.high_pace');
    assert.notEqual(t('pace.likely_out', lang), 'pace.likely_out');
    assert.notEqual(t('tray.session', lang), 'tray.session');
    assert.notEqual(t('tray.weekly', lang), 'tray.weekly');
    assert.notEqual(t('tray.sessionReset', lang), 'tray.sessionReset');
    assert.notEqual(t('tray.updated', lang), 'tray.updated');
  }
});

test('error.scope_insufficient exists in both languages', () => {
  for (const lang of SUPPORTED_LANGUAGES) {
    assert.notEqual(t('error.scope_insufficient', lang), 'error.scope_insufficient');
  }
});

test('threshold notification strings exist in both languages', () => {
  for (const lang of SUPPORTED_LANGUAGES) {
    assert.notEqual(t('notification.expireTitle', lang), 'notification.expireTitle');
    assert.notEqual(t('notification.expireBody', lang), 'notification.expireBody');
    assert.notEqual(t('settings.expireAlert', lang), 'settings.expireAlert');
    assert.notEqual(t('settings.limitAlert', lang), 'settings.limitAlert');
  }
});

test('quota mode and privacy strings exist in both languages', () => {
  for (const lang of SUPPORTED_LANGUAGES) {
    assert.notEqual(t('quota.suffix.used', lang), 'quota.suffix.used');
    assert.notEqual(t('quota.suffix.remaining', lang), 'quota.suffix.remaining');
    assert.notEqual(t('settings.quotaMode', lang), 'settings.quotaMode');
    assert.notEqual(t('settings.quotaModeUsed', lang), 'settings.quotaModeUsed');
    assert.notEqual(t('settings.quotaModeRemaining', lang), 'settings.quotaModeRemaining');
    assert.notEqual(t('settings.privacyMaskEmail', lang), 'settings.privacyMaskEmail');
  }
});
