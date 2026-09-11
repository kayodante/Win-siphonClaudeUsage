import assert from 'node:assert/strict';
import test from 'node:test';

import { SUPPORTED_LANGUAGES, t, tFormat, formatCommandError } from '../src/shared/i18n.js';

test('SUPPORTED_LANGUAGES lists English, Brazilian Portuguese, Japanese, and Korean', () => {
  assert.deepEqual(SUPPORTED_LANGUAGES, ['en', 'pt-BR', 'ja', 'ko']);
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

test('command error strings exist in all supported languages', () => {
  const errorKeys = [
    'error.unknownPreference',
    'error.invalidPreferenceValue',
    'error.prefWrite',
    'error.claudeSettings',
    'error.unsafeUrl'
  ];
  for (const lang of SUPPORTED_LANGUAGES) {
    for (const key of errorKeys) {
      assert.notEqual(t(key, lang), key, `missing translation for ${key} in ${lang}`);
    }
  }
});

test('formatCommandError resolves typed errors and falls back gracefully', () => {
  assert.equal(
    formatCommandError({ kind: 'claudeSettings', detail: 'err' }, 'en'),
    'Saved, but could not update Claude Code settings.'
  );
  assert.equal(
    formatCommandError({ kind: 'claudeSettings', detail: 'err' }, 'pt-BR'),
    'Salvo, mas não foi possível atualizar as configurações do Claude Code.'
  );
  assert.equal(
    formatCommandError({ kind: 'prefWrite', detail: 'err' }, 'en'),
    'Could not save settings to disk.'
  );
  assert.equal(
    formatCommandError({ kind: 'unsafeUrl', detail: 'http://bad' }, 'en'),
    'Opening external link was blocked.'
  );
  assert.equal(
    formatCommandError({ kind: 'unknownPreference', detail: 'bad' }, 'en'),
    'Unknown setting.'
  );
  assert.equal(
    formatCommandError({ kind: 'invalidPreferenceValue', detail: {} }, 'en'),
    'Invalid setting value.'
  );

  // Fallback key when kind is absent or unmapped
  assert.equal(
    formatCommandError(null, 'en', 'error.saveNotification'),
    'Could not save notification preference.'
  );
  assert.equal(
    formatCommandError(new Error('plain error'), 'en', 'error.saveStartup'),
    'Could not save startup preference.'
  );
  assert.equal(
    formatCommandError({ kind: 'unrecognizedKind' }, 'en', 'error.saveFloating'),
    'Could not save floating widget preference.'
  );
  assert.equal(formatCommandError(null, 'en'), '');
});

test('the loopback sign-in copy exists in every supported language', () => {
  const keys = [
    'onboarding.redirect',
    'onboarding.waitingBrowser',
    'onboarding.waitingHint',
    'onboarding.manualFallback'
  ];
  for (const lang of SUPPORTED_LANGUAGES) {
    for (const key of keys) {
      const value = t(key, lang);
      assert.notEqual(value, key, `${key} is missing from ${lang}`);
      assert.ok(value.trim().length > 0, `${key} is empty in ${lang}`);
    }
  }
});

test('the sign-in copy no longer tells the user to paste the code', () => {
  assert.doesNotMatch(t('onboarding.redirect', 'en'), /paste/i);
  assert.doesNotMatch(t('onboarding.redirect', 'pt-BR'), /cole/i);
});
