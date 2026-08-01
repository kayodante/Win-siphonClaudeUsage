import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const html = readFileSync(new URL('../src/renderer/index.html', import.meta.url), 'utf8');
const renderer = readFileSync(new URL('../src/renderer/renderer.js', import.meta.url), 'utf8');

function elementWithId(id) {
  const match = html.match(new RegExp(`<[^>]+\\bid="${id}"[^>]*>`, 's'));
  assert.ok(match, `missing #${id}`);
  return match[0];
}

test('main-window form controls use existing visible copy as accessible names', () => {
  assert.match(elementWithId('onboardCodeLabel'), /class="auth-title"[^>]+data-i18n="onboarding\.authTitle"/);
  assert.match(elementWithId('onboardCodeInput'), /aria-labelledby="onboardCodeLabel"/);

  for (const [control, key] of [
    ['settingsLanguage', 'settings.language'],
    ['settingsQuotaMode', 'settings.quotaMode'],
    ['settingsRefreshInterval', 'settings.refreshInterval']
  ]) {
    assert.match(html, new RegExp(`<label[^>]+for="${control}"[^>]+data-i18n="${key.replace('.', '\\.')}"`));
  }

  const checkboxIds = [
    'settingsLaunchWithClaudeCodeToggle', 'settingsStartupToggle',
    'settingsStartupShowWindowToggle', 'settingsUpdatesAutoCheckToggle',
    'settingsUpdatesAutoDownloadToggle', 'settingsNotificationsToggle',
    'settingsSoundToggle', 'settingsLimitAlertToggle', 'settingsLimitSoundToggle',
    'settingsExpireAlertToggle', 'settingsExpireSoundToggle', 'settingsFloatingToggle'
  ];
  for (const id of checkboxIds) assert.match(elementWithId(id), /aria-labelledby="[^"]+"/);

  for (const id of ['settingsSoundVolume', 'settingsLimitSoundVolume', 'settingsExpireSoundVolume']) {
    const input = elementWithId(id);
    assert.match(input, /type="range"/);
    assert.match(input, /aria-labelledby="[^"]+SectionHeading [^"]+VolumeLabel"/);
  }
});

test('settings tabs implement the complete automatic-activation keyboard pattern', () => {
  assert.match(elementWithId('settingsTabs'), /role="tablist"[^>]+aria-orientation="horizontal"/);
  assert.match(elementWithId('settingsTabSystem'), /role="tab"[^>]+aria-selected="true"[^>]+tabindex="0"/);
  for (const id of ['settingsTabNotification', 'settingsTabWidget']) {
    assert.match(elementWithId(id), /role="tab"[^>]+aria-selected="false"[^>]+tabindex="-1"/);
  }

  for (const key of ['ArrowRight', 'ArrowLeft', 'Home', 'End']) {
    assert.match(renderer, new RegExp(`event\\.key === '${key}'`));
  }
  assert.match(renderer, /function switchSettingsTab\(name, \{ focus = false \} = \{\}\)/);
  assert.match(renderer, /tabs\[currentSettingsTab\]\.tabIndex = -1;/);
  assert.match(renderer, /tabs\[name\]\.tabIndex = 0;/);
  assert.match(renderer, /if \(focus\) tabs\[name\]\.focus\(\);/);
  assert.match(renderer, /clearTimeout\(_tabTransitionTimer\);/);
  assert.match(renderer, /panel\.hidden = panelName !== currentSettingsTab;/);
});

test('settings navigation moves focus to context and restores the invoking control', () => {
  assert.match(elementWithId('settingsTitle'), /role="heading"[^>]+aria-level="1"[^>]+tabindex="-1"/);
  assert.match(renderer, /let settingsReturnFocus = null;/);
  assert.match(renderer, /const activeElement = document\.activeElement;/);
  assert.match(renderer, /activeElement && activeElement !== document\.body/);
  assert.match(renderer, /target = elements\.settingsTitle;/);
  assert.match(renderer, /settingsReturnFocus\?\.isConnected \? settingsReturnFocus : elements\.settingsButton/);
  assert.match(renderer, /target\.focus\(\{ preventScroll: true \}\)/);
});

test('widget style chooser exposes one selected radio and supports arrow navigation', () => {
  assert.match(elementWithId('settingsStylePicker'), /role="radiogroup"[^>]+aria-labelledby="settingsWidgetStyleHeading"/);
  assert.match(elementWithId('settingsStyleClassic'), /role="radio"[^>]+aria-checked="true"[^>]+tabindex="0"/);
  assert.match(elementWithId('settingsStyleMini'), /role="radio"[^>]+aria-checked="false"[^>]+tabindex="-1"/);
  assert.match(renderer, /settingsStyleClassic\.setAttribute\('aria-checked'/);
  assert.match(renderer, /settingsStyleMini\.setAttribute\('aria-checked'/);
  assert.match(renderer, /event\.key === 'ArrowRight' \|\| event\.key === 'ArrowDown'/);
  assert.match(renderer, /options\[nextIndex\]\.click\(\);/);
});

test('status changes use atomic live regions and deduplicated update milestones', () => {
  assert.match(elementWithId('highUsageBanner'), /role="status"[^>]+aria-live="polite"[^>]+aria-atomic="true"/);
  assert.match(elementWithId('criticalBanner'), /role="alert"[^>]+aria-live="assertive"[^>]+aria-atomic="true"/);
  assert.match(elementWithId('offlineBanner'), /role="status"[^>]+aria-live="polite"[^>]+aria-atomic="true"/);
  assert.match(elementWithId('errorText'), /role="alert"[^>]+aria-live="assertive"[^>]+aria-atomic="true"/);
  assert.match(elementWithId('updateBanner'), /role="region"[^>]+aria-labelledby="updateBannerTitle updateBannerVersion"/);
  assert.match(elementWithId('politeAnnouncer'), /role="status"[^>]+aria-live="polite"/);
  assert.match(elementWithId('assertiveAnnouncer'), /role="alert"[^>]+aria-live="assertive"/);
  assert.match(renderer, /lastAnnouncements\.get\(element\) === text/);
  assert.match(renderer, /lastAnnouncements\.delete\(elements\.assertiveAnnouncer\)/);
  assert.match(renderer, /if \(element\.textContent !== translated\) element\.textContent = translated;/);
  assert.match(renderer, /Math\.floor\(progress \/ 25\) \* 25/);
  assert.match(renderer, /bucket > lastDownloadAnnouncementBucket/);
});

test('each main-window view and data card has a programmatic heading', () => {
  for (const [view, heading] of [
    ['onboardView', 'onboardingHeading'],
    ['mainView', 'sessionHeading'],
    ['settingsView', 'settingsTitle']
  ]) assert.match(elementWithId(view), new RegExp(`aria-labelledby="${heading}"`));

  for (const id of [
    'onboardingHeading', 'sessionHeading', 'weeklyHeading', 'extraUsageHeading',
    'todayHeading', 'monthHeading', 'settingsTitle', 'settingsResetSectionHeading',
    'settingsLimitSectionHeading', 'settingsExpireSectionHeading', 'settingsWidgetStyleHeading'
  ]) assert.match(elementWithId(id), /role="heading"[^>]+aria-level="[12]"/);
});
