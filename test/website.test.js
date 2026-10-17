import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import test from 'node:test';
import { fileURLToPath } from 'node:url';
import { ESLint } from 'eslint';
import { initCopyButtons, initLanguage, initMobileMenu, initProductDemo, resolveLanguage } from '../docs/product-demo.js';

const websiteHtml = readFileSync(new URL('../docs/index.html', import.meta.url), 'utf8');
const websiteCss = readFileSync(new URL('../docs/styles.css', import.meta.url), 'utf8');
const projectRoot = fileURLToPath(new URL('../', import.meta.url));
const websiteDirectory = fileURLToPath(new URL('../docs/', import.meta.url));
const syntaxCheckerUrl = new URL('../scripts/check-syntax.js', import.meta.url).href;

async function createSyntaxCheckerSandbox(t) {
  const sandboxDirectory = await mkdtemp(path.join(tmpdir(), 'siphon-website-syntax-'));
  t.after(() => rm(sandboxDirectory, { recursive: true, force: true }));

  const malformedFixturePath = path.join(sandboxDirectory, 'docs', 'website', 'syntax-error.js');
  await Promise.all([
    mkdir(path.join(sandboxDirectory, 'src'), { recursive: true }),
    mkdir(path.join(sandboxDirectory, 'test'), { recursive: true }),
    mkdir(path.join(sandboxDirectory, 'scripts'), { recursive: true }),
    mkdir(path.dirname(malformedFixturePath), { recursive: true })
  ]);
  await writeFile(malformedFixturePath, 'function {\n');

  return { sandboxDirectory, malformedFixturePath };
}

test('syntax checker rejects malformed website JavaScript (regression: website omitted from syntax roots)', async t => {
  const { sandboxDirectory, malformedFixturePath } = await createSyntaxCheckerSandbox(t);
  const result = spawnSync(process.execPath, ['--input-type=module', '--eval', [
    `process.chdir(${JSON.stringify(sandboxDirectory)});`,
    `await import(${JSON.stringify(syntaxCheckerUrl)});`
  ].join(' ')], {
    cwd: projectRoot,
    encoding: 'utf8'
  });

  assert.equal(result.status, 1, `the syntax checker must reject malformed website JavaScript\n${result.stdout}${result.stderr}`);
  assert.match(`${result.stdout}${result.stderr}`, new RegExp(path.basename(malformedFixturePath)));
});

test('ESLint applies browser correctness rules to website JavaScript (regression: website omitted from browser lint scope)', async () => {
  const eslint = new ESLint({ cwd: projectRoot });
  const [result] = await eslint.lintText([
    "window.addEventListener('load', () => {});",
    'websiteCoverageMissing;'
  ].join('\n'), { filePath: path.join(websiteDirectory, 'browser-lint-error.js') });

  assert.equal(result.errorCount, 1, 'ESLint must reject undefined names in website JavaScript');
  assert.deepEqual(result.messages.map(({ line, ruleId, message }) => ({ line, ruleId, message })), [{
    line: 2,
    ruleId: 'no-undef',
    message: "'websiteCoverageMissing' is not defined."
  }]);
});

function cssToken(name) {
  const match = websiteCss.match(new RegExp(`${name}:\\s*([^;]+);`));
  assert.ok(match, `missing CSS token ${name}`);
  return match[1].trim();
}

function parseOklch(value) {
  const match = value.match(/^oklch\(([\d.]+)%\s+([\d.]+)\s+([\d.]+)/);
  assert.ok(match, `expected an opaque OKLCH color, got ${value}`);
  return {
    lightness: Number(match[1]) / 100,
    chroma: Number(match[2]),
    hue: Number(match[3]) * Math.PI / 180
  };
}

function oklchToLinearSrgb(value) {
  const { lightness, chroma, hue } = parseOklch(value);
  const a = chroma * Math.cos(hue);
  const b = chroma * Math.sin(hue);
  const l = (lightness + 0.3963377774 * a + 0.2158037573 * b) ** 3;
  const m = (lightness - 0.1055613458 * a - 0.0638541728 * b) ** 3;
  const s = (lightness - 0.0894841775 * a - 1.291485548 * b) ** 3;

  return [
    4.0767416621 * l - 3.3077115913 * m + 0.2309699292 * s,
    -1.2684380046 * l + 2.6097574011 * m - 0.3413193965 * s,
    -0.0041960863 * l - 0.7034186147 * m + 1.707614701 * s
  ].map(channel => Math.min(1, Math.max(0, channel)));
}

function contrastRatio(foreground, background) {
  const luminance = value => {
    const [red, green, blue] = oklchToLinearSrgb(value);
    return 0.2126 * red + 0.7152 * green + 0.0722 * blue;
  };
  const first = luminance(foreground);
  const second = luminance(background);
  return (Math.max(first, second) + 0.05) / (Math.min(first, second) + 0.05);
}

test('tertiary website text meets WCAG AA contrast on every surface where it appears', () => {
  const dim = cssToken('--dim');

  assert.ok(contrastRatio(dim, cssToken('--void')) >= 4.5);
  assert.ok(contrastRatio(dim, cssToken('--surface')) >= 4.5);
  assert.ok(contrastRatio(dim, cssToken('--surface-raised')) >= 4.5);
});

test('variable web fonts declare their weight range (regression: faux bold at every weight step)', () => {
  const variableFaces = [...websiteCss.matchAll(/@font-face\s*\{([^}]*Variable\.woff2[^}]*)\}/g)];
  assert.equal(variableFaces.length, 2, 'expected the Geist and Geist Mono variable faces');

  for (const [, body] of variableFaces) {
    assert.match(body, /font-weight:\s*100\s+900;/);
  }
});

test('social preview images use absolute HTTPS URLs', () => {
  for (const attribute of ['property="og:image"', 'name="twitter:image"']) {
    const match = websiteHtml.match(new RegExp(`<meta ${attribute} content="([^"]+)">`));
    assert.ok(match, `missing ${attribute}`);
    const imageUrl = new URL(match[1]);
    assert.equal(imageUrl.protocol, 'https:');
    assert.match(imageUrl.pathname, /\/Hero\.png$/);
  }
  assert.match(websiteHtml, /<meta name="twitter:image:alt" content="[^"]+">/);
});

test('privacy policy link resolves to a rendered page, not a raw Markdown download', () => {
  assert.match(websiteHtml, /href="privacy-policy\.html"/);
  assert.doesNotMatch(websiteHtml, /href="privacy-policy\.md"/);

  const policyHtml = readFileSync(new URL('../docs/privacy-policy.html', import.meta.url), 'utf8');
  assert.match(policyHtml, /<link rel="stylesheet" href="styles\.css">/);
  assert.match(policyHtml, /<title>Privacy Policy \| Siphon<\/title>/);

  for (const claim of [
    'does not collect, transmit, or sell personal data',
    'api.anthropic.com/api/oauth/usage',
    'No analytics, no crash reporting, no telemetry'
  ]) assert.ok(policyHtml.includes(claim), `privacy page missing: ${claim}`);
});

test('website release metadata and installer URLs are rewritten from one version', async () => {
  const { syncWebsiteHtml } = await import('../scripts/sync-version.js');
  assert.equal(typeof syncWebsiteHtml, 'function');

  const before = `
    "softwareVersion": "1.2.3",
    "downloadUrl": "https://github.com/kayodante/Win-siphonClaudeUsage/releases/download/v1.2.3/Siphon.Setup.1.2.3.exe"
    <a href="https://github.com/kayodante/Win-siphonClaudeUsage/releases/download/v1.2.3/Siphon.Setup.1.2.3.exe">Download</a>
  `;
  const after = syncWebsiteHtml(before, '9.8.7');

  assert.doesNotMatch(after, /1\.2\.3/);
  assert.match(after, /"softwareVersion": "9\.8\.7"/);
  assert.equal(after.match(/releases\/download\/v9\.8\.7\/Siphon\.Setup\.9\.8\.7\.exe/g)?.length, 2);
});

function createMobileMenuFixture({ targetExists = true } = {}) {
  const menuListeners = new Map();
  const documentListeners = new Map();
  const removedMenuListeners = [];
  const removedDocumentListeners = [];
  const focusCalls = [];
  const summary = { focus() { focusCalls.push({ target: 'summary' }); } };
  const destination = {
    focus(options) { focusCalls.push({ target: 'destination', options }); }
  };
  const documentRef = {
    getElementById(id) { return targetExists && id === 'features' ? destination : null; },
    addEventListener(type, listener) { documentListeners.set(type, listener); },
    removeEventListener(type, listener) {
      removedDocumentListeners.push({ type, listener });
      if (documentListeners.get(type) === listener) documentListeners.delete(type);
    }
  };
  const menu = {
    open: true,
    ownerDocument: documentRef,
    querySelector(selector) { return selector === 'summary' ? summary : null; },
    addEventListener(type, listener) { menuListeners.set(type, listener); },
    removeEventListener(type, listener) {
      removedMenuListeners.push({ type, listener });
      if (menuListeners.get(type) === listener) menuListeners.delete(type);
    }
  };
  const internalLink = {
    getAttribute(name) { return name === 'href' ? '#features' : null; },
    closest(selector) { return selector === 'a[href^="#"]' ? this : null; }
  };

  return {
    menu,
    menuListeners,
    documentListeners,
    removedMenuListeners,
    removedDocumentListeners,
    focusCalls,
    internalLink
  };
}

test('mobile menu closes on internal navigation and moves focus to the destination', () => {
  const fixture = createMobileMenuFixture();
  initMobileMenu(fixture.menu);
  const event = {
    target: fixture.internalLink,
    button: 0,
    defaultPrevented: false,
    altKey: false,
    ctrlKey: false,
    metaKey: false,
    shiftKey: false
  };

  fixture.menuListeners.get('click')(event);

  assert.equal(fixture.menu.open, false);
  assert.deepEqual(fixture.focusCalls, [{ target: 'destination', options: { preventScroll: true } }]);
});

test('mobile menu closes on Escape and returns focus to its summary', () => {
  const fixture = createMobileMenuFixture();
  initMobileMenu(fixture.menu);
  let prevented = false;

  fixture.documentListeners.get('keydown')({
    key: 'Escape',
    preventDefault() { prevented = true; }
  });

  assert.equal(prevented, true);
  assert.equal(fixture.menu.open, false);
  assert.deepEqual(fixture.focusCalls, [{ target: 'summary' }]);
});

test('mobile menu ignores modified navigation and cleans up its listeners', () => {
  const fixture = createMobileMenuFixture();
  const controller = initMobileMenu(fixture.menu);
  const clickListener = fixture.menuListeners.get('click');
  const keyListener = fixture.documentListeners.get('keydown');

  clickListener({
    target: fixture.internalLink,
    button: 0,
    defaultPrevented: false,
    altKey: false,
    ctrlKey: true,
    metaKey: false,
    shiftKey: false
  });
  assert.equal(fixture.menu.open, true);
  assert.deepEqual(fixture.focusCalls, []);

  controller.disconnect();
  assert.deepEqual(fixture.removedMenuListeners, [{ type: 'click', listener: clickListener }]);
  assert.deepEqual(fixture.removedDocumentListeners, [{ type: 'keydown', listener: keyListener }]);
});

test('copy button writes the command to the clipboard and reverts its label', async () => {
  assert.match(websiteHtml, /<code id="winget-command-text">winget install win-siphon<\/code>/);
  assert.match(websiteHtml, /data-copy-target="winget-command-text"/);

  const written = [];
  const timers = [];
  const button = {
    dataset: { copyTarget: 'winget-command-text', copyLabel: 'Copy', copiedLabel: 'Copied' },
    textContent: 'Copy',
    addEventListener(type, listener) { this.listeners ??= new Map(); this.listeners.set(type, listener); },
    removeEventListener(type) { this.listeners?.delete(type); }
  };
  const documentRef = {
    defaultView: {
      navigator: { clipboard: { async writeText(text) { written.push(text); } } },
      setTimeout(callback) { timers.push(callback); return timers.length; },
      clearTimeout() {}
    },
    querySelectorAll() { return [button]; },
    getElementById(id) {
      return id === 'winget-command-text' ? { textContent: '  winget install win-siphon  ' } : null;
    }
  };

  initCopyButtons(documentRef);
  await button.listeners.get('click')({ currentTarget: button });

  assert.deepEqual(written, ['winget install win-siphon']);
  assert.equal(button.textContent, 'Copied');
  assert.equal(button.dataset.copied, 'true');

  timers[0]();
  assert.equal(button.textContent, 'Copy');
  assert.equal(button.dataset.copied, undefined);
});

test('landing page reserves named media slots and keeps download URLs in version sync', async () => {
  const { syncWebsiteHtml } = await import('../scripts/sync-version.js');
  const { version } = JSON.parse(readFileSync(new URL('../package.json', import.meta.url), 'utf8'));
  assert.equal(syncWebsiteHtml(websiteHtml, version), websiteHtml);
  for (const slot of ['brand-3d', 'demo-dashboard', 'demo-widgets', 'demo-alerts']) {
    assert.ok(websiteHtml.includes(`data-asset-slot="${slot}"`));
  }
  const downloads = [...websiteHtml.matchAll(/<a\b[^>]*href="([^"]+)"[^>]*\sdownload>/g)];
  assert.equal(downloads.length, 3);
  for (const [, url] of downloads) {
    assert.equal(url, `https://github.com/kayodante/Win-siphonClaudeUsage/releases/download/v${version}/Siphon.Setup.${version}.exe`);
  }
  assert.doesNotMatch(websiteHtml, /hero-asciify\.js|<video\b/);
});

test('all translated content has English fallback and Portuguese does not require remote data', () => {
  const translations = [...websiteHtml.matchAll(/<([\w-]+)\b[^>]*\sdata-pt="([^"]+)"[^>]*>([^<]+)<\/\1>/g)];
  assert.ok(translations.length > 50, 'the complete narrative must be bilingual');
  for (const [, , pt, en] of translations) {
    assert.ok(pt.trim().length > 0);
    assert.ok(en.trim().length > 0);
  }
  assert.match(websiteHtml, /lang="en"/);
  assert.match(websiteHtml, /data-language="pt-BR"/);
  const source = readFileSync(new URL('../docs/product-demo.js', import.meta.url), 'utf8');
  assert.doesNotMatch(source, /window\.siphon|renderer\.js|siphonBridge|fetch\s*\(|innerHTML/);
});

test('controls retain touch targets and reduced motion disables entrances', () => {
  for (const selector of ['.button-compact', '.language-switch button', '.demo-tabs button', '.copy-button']) {
    const rule = websiteCss.slice(websiteCss.indexOf(`${selector} {`)).split('}')[0];
    assert.match(rule, /min-height: 44px/);
  }
  assert.match(websiteCss, /color-scheme: dark/);
  assert.match(websiteCss, /@media \(prefers-reduced-motion: no-preference\)[\s\S]*animation: panel-in/);
  const reduced = websiteCss.slice(websiteCss.indexOf('@media (prefers-reduced-motion: reduce)'));
  assert.match(reduced, /scroll-behavior: auto/);
  assert.match(reduced, /transition: none/);
  assert.doesNotMatch(reduced, /0\.01ms|!important/);
});

test('language selection honors saved choice, browser order, and unsupported preferences', () => {
  assert.equal(resolveLanguage('en', ['pt-BR']), 'en');
  assert.equal(resolveLanguage('pt-BR', ['en-US']), 'pt-BR');
  assert.equal(resolveLanguage('invalid', ['fr-FR', 'pt-BR', 'en']), 'pt-BR');
  assert.equal(resolveLanguage(null, ['en-US', 'pt-BR']), 'en');
  assert.equal(resolveLanguage(null, ['pt-PT']), 'pt-BR');
  assert.equal(resolveLanguage(null, ['ja']), 'en');
  assert.equal(resolveLanguage(null), 'en');
});

function elementStub(attributes = {}, textContent = '') {
  const values = new Map(Object.entries(attributes));
  const element = {
    textContent, dataset: {}, listeners: new Map(),
    getAttribute(name) { return values.get(name) ?? null; },
    setAttribute(name, value) {
      values.set(name, value);
      if (name.startsWith('data-')) this.dataset[name.slice(5).replace(/-([a-z])/g, (_, letter) => letter.toUpperCase())] = value;
    },
    addEventListener(type, listener) { this.listeners.set(type, listener); },
    removeEventListener(type) { this.listeners.delete(type); },
    focus() { this.focused = true; }
  };
  for (const [name, value] of Object.entries(attributes)) element.setAttribute(name, value);
  return element;
}

test('translation roundtrip covers text, accessible labels, metadata and blocked storage', () => {
  const text = elementStub({ 'data-pt': 'Recursos' }, 'Features');
  const label = elementStub({ 'data-pt-label': 'Navegação', 'aria-label': 'Navigation' });
  const meta = elementStub({ 'data-pt-content': 'Descrição', content: 'Description' });
  const copy = elementStub({ 'data-copy-target': 'command', 'data-copy-label': 'Copy', 'data-pt-copy-label': 'Copiar', 'data-copied-label': 'Copied', 'data-pt-copied-label': 'Copiado', 'data-error-label': 'Copy manually', 'data-pt-error-label': 'Copie manualmente' });
  const buttons = ['en', 'pt-BR'].map(language => elementStub({ 'data-language': language }));
  const switcher = { hidden: true, querySelectorAll: () => buttons };
  const nodes = [text, label, meta, copy];
  const writes = [];
  const doc = {
    documentElement: { lang: 'en' },
    defaultView: { navigator: { languages: ['pt-BR'] }, localStorage: {
      getItem() { throw new Error('blocked'); },
      setItem(key, value) { writes.push([key, value]); throw new Error('blocked'); }
    } },
    querySelector: () => switcher,
    querySelectorAll(selector) { return nodes.filter(node => node.getAttribute(selector.slice(1, -1)) !== null); }
  };
  const controller = initLanguage(doc);
  assert.equal(doc.documentElement.lang, 'pt-BR');
  assert.equal(text.textContent, 'Recursos');
  assert.equal(label.getAttribute('aria-label'), 'Navegação');
  assert.equal(meta.getAttribute('content'), 'Descrição');
  assert.equal(copy.dataset.copyLabel, 'Copiar');
  assert.equal(switcher.hidden, false);
  copy.dataset.copied = 'true';
  buttons[0].listeners.get('click')({ currentTarget: buttons[0] });
  assert.equal(text.textContent, 'Features');
  assert.equal(label.getAttribute('aria-label'), 'Navigation');
  assert.equal(meta.getAttribute('content'), 'Description');
  assert.equal(copy.textContent, 'Copied');
  assert.equal(doc.documentElement.lang, 'en');
  assert.equal(buttons[0].getAttribute('aria-pressed'), 'true');
  assert.deepEqual(writes, [['siphon-site-language', 'en']]);
  controller.setLanguage('pt-BR');
  assert.equal(copy.textContent, 'Copiado');
  controller.disconnect();
  assert.equal(buttons[0].listeners.size, 0);
});

test('demo tabs keep selection, visibility, keyboard focus and cleanup in sync', () => {
  const tabs = ['dashboard', 'widgets', 'alerts'].map(id => elementStub({ 'aria-controls': `panel-${id}` }));
  const panels = tabs.map(tab => ({ id: tab.getAttribute('aria-controls'), hidden: false }));
  const tablist = { hidden: true };
  const root = {
    querySelector: () => tablist,
    querySelectorAll: () => tabs,
    ownerDocument: { getElementById: id => panels.find(panel => panel.id === id) },
    contains: panel => panels.includes(panel)
  };
  const controller = initProductDemo(root);
  assert.deepEqual(panels.map(panel => panel.hidden), [false, true, true]);
  assert.equal(tablist.hidden, false);
  tabs[1].listeners.get('click')({ currentTarget: tabs[1] });
  assert.deepEqual(panels.map(panel => panel.hidden), [true, false, true]);
  let prevented = 0;
  const press = (index, key) => tabs[index].listeners.get('keydown')({ currentTarget: tabs[index], key, preventDefault() { prevented++; } });
  press(1, 'End');
  assert.equal(tabs[2].focused, true);
  assert.equal(tabs[2].tabIndex, 0);
  press(2, 'ArrowRight');
  assert.equal(tabs[0].getAttribute('aria-selected'), 'true');
  press(0, 'ArrowLeft');
  assert.equal(tabs[2].getAttribute('aria-selected'), 'true');
  press(2, 'Home');
  assert.equal(tabs[0].tabIndex, 0);
  press(0, 'Tab');
  assert.equal(prevented, 4);
  controller.selectTab(NaN);
  assert.deepEqual(panels.map(panel => panel.hidden), [false, true, true]);
  controller.disconnect();
  assert.equal(tabs[0].listeners.size, 0);
  root.ownerDocument.getElementById = () => null;
  assert.doesNotThrow(() => initProductDemo(root));
  assert.doesNotThrow(() => initProductDemo(null));
});

test('copy failures are visible and a late completion cannot update a disconnected button', async () => {
  const button = elementStub({ 'data-copy-target': 'command', 'data-copy-label': 'Copy', 'data-copied-label': 'Copied', 'data-error-label': 'Select and copy manually' });
  const timers = [];
  let finish;
  const doc = {
    querySelectorAll: () => [button],
    getElementById: () => ({ textContent: 'winget install win-siphon' }),
    defaultView: { navigator: {}, clearTimeout() {}, setTimeout(callback) { timers.push(callback); return timers.length; } }
  };
  const controller = initCopyButtons(doc);
  await button.listeners.get('click')({ currentTarget: button });
  assert.equal(button.textContent, 'Select and copy manually');
  assert.equal(button.dataset.copyError, 'true');
  timers[0]();
  assert.equal(button.textContent, 'Copy');
  doc.defaultView.navigator.clipboard = { writeText: () => new Promise(resolve => { finish = resolve; }) };
  const pending = button.listeners.get('click')({ currentTarget: button });
  controller.disconnect();
  finish();
  await pending;
  assert.equal(button.textContent, 'Copy');
  assert.equal(timers.length, 1);
});
