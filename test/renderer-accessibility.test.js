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
    'settingsExpireAlertToggle', 'settingsExpireSoundToggle', 'settingsFloatingToggle',
    'settingsPillWeeklyToggle'
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
  // The one-line download notice is its own live region, so the 0% bucket
  // would announce the same thing twice.
  assert.match(renderer, /lastDownloadAnnouncementBucket = 0;/);
  assert.match(elementWithId('downloadBanner'), /role="status"[^>]+aria-live="polite"[^>]+aria-atomic="true"/);
  assert.match(html, /<span class="dmx-scan" aria-hidden="true">/);
});

test('each main-window view and data card has a programmatic heading', () => {
  for (const [view, heading] of [
    ['onboardView', 'onboardingHeading'],
    ['overviewView', 'providerHeading'],
    ['mainView', 'providerHeading'],
    ['providerView', 'providerHeading'],
    ['settingsView', 'settingsTitle']
  ]) assert.match(elementWithId(view), new RegExp(`aria-labelledby="${heading}"`));

  for (const id of [
    'onboardingHeading', 'sessionHeading', 'weeklyHeading', 'extraUsageHeading',
    'todayHeading', 'monthHeading', 'providerHeading', 'providerTodayHeading',
    'providerMonthHeading', 'settingsTitle', 'settingsResetSectionHeading',
    'settingsLimitSectionHeading', 'settingsExpireSectionHeading', 'settingsWidgetStyleHeading'
  ]) assert.match(elementWithId(id), /role="heading"[^>]+aria-level="[12]"/);
});

test('the browser-wait state announces itself and can be cancelled', () => {
  // The wait copy is plain markup, not a live region of its own: revealing a
  // hidden region is unreliably announced, so the text is pushed through the
  // always-present #politeAnnouncer instead.
  const waiting = elementWithId('onboardWaiting');
  assert.doesNotMatch(waiting, /aria-live=/);
  assert.doesNotMatch(waiting, /role="status"/);
  assert.match(renderer, /announce\(elements\.politeAnnouncer, `\$\{elements\.onboardWaitingHeadline\.textContent\} \$\{\s*tFormat\('onboarding\.waitingDeadline', lang, \{ time: formatCountdown\(AUTH_DEADLINE_MS\) \}\)\}`\)/);

  assert.match(elementWithId('onboardWaitingCancel'), /data-i18n="onboarding\.cancel"/);
  assert.match(elementWithId('onboardFallbackNotice'), /data-i18n="onboarding\.manualFallback"/);
});

test('the renderer toggles the three onboarding states from state flags', () => {
  assert.match(renderer, /elements\.onboardWaiting\.hidden = !awaitingBrowser/);
  assert.match(renderer, /elements\.onboardCodeForm\.hidden = !awaitingCode/);
});

test('the sign-in waiting block exposes the authorize URL and its controls accessibly', () => {
  // The URL is long and wraps; a screen reader needs the button labelled by
  // its own copy, not by the URL it sits next to.
  const copyButton = elementWithId('onboardCopyUrlButton');
  assert.match(copyButton, /type="button"/);
  assert.match(copyButton, /data-i18n-aria-label="onboarding\.copyLink"/);

  // The countdown changes every second. It must NOT be a live region, or a
  // screen reader announces it 150 times; the deadline is announced once by
  // the polite announcer when the wait starts.
  const countdown = elementWithId('onboardCountdown');
  assert.match(countdown, /aria-hidden="true"/);
  assert.doesNotMatch(countdown, /aria-live/);

  // The URL itself is machine output, not authored prose.
  assert.match(elementWithId('onboardAuthUrl'), /<code\b/);
});

test('the escape hatch notice and headline are addressable for runtime copy swaps', () => {
  assert.match(elementWithId('onboardWaitingHeadline'), /data-i18n="onboarding\.waitingBrowser"/);
  assert.match(elementWithId('onboardHatchNotice'), /hidden/);
});


test('Pill weekly switch uses a visible translated label and is limited to the Pill style', () => {
  assert.match(elementWithId('settingsPillWeeklyOption'), /hidden/);
  assert.match(elementWithId('settingsPillWeeklyLabel'), /data-i18n="settings\.widget\.showWeekly"/);
  assert.match(elementWithId('settingsPillWeeklyToggle'), /type="checkbox"[^>]*aria-labelledby="settingsPillWeeklyLabel"/);
  assert.match(renderer, /settingsPillWeeklyOption\.hidden = floatingStyle !== 'mini'/);
  assert.match(renderer, /settingsPillWeeklyToggle\.checked = state\.preferences\?\.floating\?\.showWeekly \?\? true/);
  assert.match(renderer, /setPreference\('floating\.showWeekly', event\.target\.checked\)/);
});

test('icon-only rail buttons carry translated accessible names and tooltips', () => {
  for (const [id, key] of [
    ['refreshButton', 'topbar.refresh'],
    ['overviewButton', 'navigation.overview'],
    ['settingsButton', 'topbar.settings'],
    ['openClaudeLink', 'footer.openClaude'],
    ['footerQuitButton', 'footer.quit']
  ]) {
    const el = elementWithId(id);
    assert.match(el, new RegExp(`data-i18n-aria-label="${key.replace('.', '\.')}"`), `#${id} aria-label`);
    assert.match(el, new RegExp(`data-i18n-title="${key.replace('.', '\.')}"`), `#${id} title`);
  }
  assert.match(elementWithId('providerClaudeButton'), /aria-label="Claude"/);
  assert.doesNotMatch(elementWithId('providerClaudeButton'), /aria-current/, 'selection is resolved from signed-in view state');
  assert.match(elementWithId('railToggleButton'), /aria-controls="navigationRail"[^>]+aria-expanded="true"/);
});

test('Codex and Antigravity tabs are named and start hidden until detected', () => {
  for (const [id, name] of [['providerCodexButton', 'Codex'], ['providerAntigravityButton', 'Antigravity']]) {
    const el = elementWithId(id);
    assert.match(el, new RegExp(`aria-label="${name}"`), `#${id} aria-label`);
    assert.match(el, /\shidden[\s>]/, `#${id} hidden by default`);
    assert.doesNotMatch(el, /aria-current/, `#${id} is not the current tab at boot`);
  }
  assert.match(renderer, /elements\.railProviders\?\.addEventListener\('keydown'/);
  assert.match(html, /class="quota-pace"\s+data-pace\s+data-status="no_data"\s+tabindex="0"/);
});

test('the main window min width matches the Rust restore floor', () => {
  const conf = JSON.parse(readFileSync(new URL('../src-tauri/tauri.conf.json', import.meta.url), 'utf8'));
  const rust = readFileSync(new URL('../src-tauri/src/windows_ctl.rs', import.meta.url), 'utf8');
  const main = conf.app.windows.find(w => w.label === 'main');
  assert.equal(Number(rust.match(/pub const MIN_W: f64 = ([\d.]+);/)[1]), main.minWidth);
  assert.equal(Number(rust.match(/pub const MIN_H: f64 = ([\d.]+);/)[1]), main.minHeight);
});

test('quota suffixes are read, so "used" and "left" do not sound the same', () => {
  const suffixes = html.match(/<span class="quota-suffix"[^>]*>/g);
  assert.equal(suffixes.length, 6, 'Claude, provider and overview session + weekly');
  for (const suffix of suffixes) assert.doesNotMatch(suffix, /aria-hidden/);
});
