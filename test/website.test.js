import assert from 'node:assert/strict';
import { readFileSync, statSync } from 'node:fs';
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import test from 'node:test';
import { fileURLToPath } from 'node:url';
import { ESLint } from 'eslint';
import {
  DEMO_INTERVAL_MS,
  DEMO_STATE_IDS,
  initProductDemo,
  nextDemoIndex,
  shouldDemoAutoplay
} from '../docs/website/product-demo.js';

const websiteHtml = readFileSync(new URL('../docs/website/index.html', import.meta.url), 'utf8');
const websiteCss = readFileSync(new URL('../docs/website/styles.css', import.meta.url), 'utf8');
const projectRoot = fileURLToPath(new URL('../', import.meta.url));
const websiteDirectory = fileURLToPath(new URL('../docs/website/', import.meta.url));
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

test('hero image offers smaller AVIF and WebP sources without removing the PNG fallback', () => {
  assert.match(websiteHtml, /<picture class="hero-picture">/);
  assert.match(websiteHtml, /Hero-400\.avif 400w,\s*\.\.\/\.\.\/src\/assets\/Hero-720\.avif 720w/);
  assert.match(websiteHtml, /Hero-400\.webp 400w,\s*\.\.\/\.\.\/src\/assets\/Hero-720\.webp 720w/);
  assert.match(websiteHtml, /<img src="\.\.\/\.\.\/src\/assets\/Hero\.png"/);

  const pngSize = statSync(new URL('../src/assets/Hero.png', import.meta.url)).size;
  for (const file of ['Hero-400.avif', 'Hero-720.avif', 'Hero-400.webp', 'Hero-720.webp']) {
    assert.ok(statSync(new URL(`../src/assets/${file}`, import.meta.url)).size < pngSize);
  }
});

test('compact download button keeps a 44px minimum touch target', () => {
  const rule = websiteCss.match(/\.button-compact\s*\{([^}]+)\}/);
  assert.ok(rule, 'missing .button-compact rule');
  const height = rule[1].match(/min-height:\s*(\d+)px/);
  assert.ok(height, 'missing compact button min-height');
  assert.ok(Number(height[1]) >= 44);
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

const productImages = [
  'home-Ok.png', 'home-Warn.png', 'home-High.png',
  'home-Critical.png', 'home-Depleted.png',
  'floating_widget_classic.png',
  'floating_widget_classic-open.png',
  'floating_widget_pill.png'
];

test('feature narrative references every approved real-product image', () => {
  for (const file of productImages) {
    assert.match(websiteHtml, new RegExp(`src="\\.\\.\\/\\.\\.\\/src\\/assets\\/${file.replace('.', '\\.')}`));
    assert.ok(statSync(new URL(`../src/assets/${file}`, import.meta.url)).size > 0);
  }
});

test('feature narrative exposes five states and all six chapters', () => {
  assert.match(websiteHtml, /<link rel="icon"[^>]+favicon\.svg/);
  assert.match(websiteHtml, /href="#features">Features<\/a>/);
  assert.equal(websiteHtml.match(/data-demo-state="(?:ok|warn|high|critical|depleted)"/g)?.length, 5);
  assert.equal(websiteHtml.match(/data-demo-panel="(?:ok|warn|high|critical|depleted)"/g)?.length, 5);
  for (const heading of [
    'Read the signal', 'Act at the right moment', 'Keep it within reach',
    'Understand your usage', 'Fit it to your routine', 'Your usage stays yours'
  ]) assert.match(websiteHtml, new RegExp(heading));
});

test('usage supplements stay inside their corresponding definition values', () => {
  const instrument = websiteHtml.match(/<dl class="usage-instrument">([\s\S]*?)<\/dl>/);
  assert.ok(instrument, 'missing usage instrument');

  const readings = [...instrument[1].matchAll(/<div>([\s\S]*?)<\/div>/g)];
  assert.equal(readings.length, 2);
  for (const [, reading] of readings) {
    assert.match(reading, /<dt>[^<]+<\/dt><dd>[^<]+(?:<br>)?<span>[^<]+<\/span><\/dd>/);
    assert.doesNotMatch(reading, /<\/dd>\s*<span>/);
  }
});

test('feature demo CSS is namespaced and motion-safe', () => {
  assert.match(websiteCss, /\.app-demo\s+\[data-demo-state\]/);
  assert.match(websiteCss, /\.app-demo\s+\.demo-meter/);
  assert.match(websiteHtml, /class="demo-pace">On track/);
  assert.match(websiteHtml, /class="demo-peak">Peak hours/);
  assert.match(websiteCss, /\.demo-state-stage\s*>\s*figure/);
  assert.match(websiteCss, /\[data-demo-panel\]\[data-active="true"\]/);
  assert.match(websiteCss, /@media \(prefers-reduced-motion:\s*reduce\)[\s\S]*\.demo-state-stage/);
});

test('feature state controls retain a 44px touch target', () => {
  const rule = websiteCss.match(/\.app-demo\s+\[data-demo-state\]\s*\{([^}]+)\}/);
  assert.ok(rule);
  assert.match(rule[1], /min-height:\s*44px/);
});

test('product demo cycles through five states every two seconds', () => {
  assert.deepEqual(DEMO_STATE_IDS, ['ok', 'warn', 'high', 'critical', 'depleted']);
  assert.equal(DEMO_INTERVAL_MS, 2000);
  assert.equal(nextDemoIndex(0), 1);
  assert.equal(nextDemoIndex(4), 0);
});

test('product demo autoplays only when imagery is ready, visible, active, and unpaused', () => {
  const ready = {
    imagesReady: true,
    inView: true,
    pageVisible: true,
    reducedMotion: false,
    hovered: false,
    focused: false,
    manuallyPaused: false
  };

  assert.equal(shouldDemoAutoplay(ready), true);
  for (const flag of ['reducedMotion', 'hovered', 'focused', 'manuallyPaused']) {
    assert.equal(shouldDemoAutoplay({ ...ready, [flag]: true }), false);
  }
  assert.equal(shouldDemoAutoplay({ ...ready, inView: false }), false);
  assert.equal(shouldDemoAutoplay({ ...ready, pageVisible: false }), false);
  assert.equal(shouldDemoAutoplay({ ...ready, imagesReady: false }), false);
});

test('product demo remains within the static-site runtime boundary', () => {
  const productDemoSource = readFileSync(new URL('../docs/website/product-demo.js', import.meta.url), 'utf8');
  assert.doesNotMatch(productDemoSource, /window\.siphon|renderer\.js|siphonBridge|fetch\s*\(/);
  assert.match(websiteHtml, /<script type="module" src="product-demo\.js"><\/script>/);
});

function createDemoFixture({ controlCount = 5, panelCount = 5, legacyMotion = false } = {}) {
  const listeners = new Map();
  const createElement = stateId => ({
    dataset: stateId ? { demoState: stateId } : {},
    attributes: new Map(),
    addEventListener(type, listener) { this.listeners ??= new Map(); this.listeners.set(type, listener); },
    removeEventListener(type) { this.listeners?.delete(type); },
    setAttribute(name, value) { this.attributes.set(name, value); },
    querySelector() { return {}; }
  });
  const controls = Array.from({ length: controlCount }, (_, index) => createElement(DEMO_STATE_IDS[index]));
  const panels = Array.from({ length: panelCount }, () => createElement());
  const timers = [];
  const clearedTimers = [];
  const motionListeners = [];
  const removedMotionListeners = [];
  const mediaQuery = legacyMotion
    ? {
        matches: false,
        addListener(listener) { motionListeners.push(listener); },
        removeListener(listener) { removedMotionListeners.push(listener); }
      }
    : { matches: false, addEventListener() {}, removeEventListener() {} };
  const fixture = {
    timers,
    clearedTimers,
    motionListeners,
    removedMotionListeners,
    observer: null
  };
  const windowRef = {
    matchMedia() { return mediaQuery; },
    setTimeout(callback, delay) { timers.push({ callback, delay }); return timers.length; },
    clearTimeout(id) { clearedTimers.push(id); },
    IntersectionObserver: class {
      constructor(callback) { fixture.observer = callback; }
      observe() {}
      disconnect() {}
    }
  };
  const documentRef = {
    defaultView: windowRef,
    visibilityState: 'visible',
    addEventListener(type, listener) { listeners.set(type, listener); },
    removeEventListener(type) { listeners.delete(type); }
  };
  fixture.root = {
    dataset: {},
    ownerDocument: documentRef,
    querySelectorAll(selector) {
      return selector === '[data-demo-state]' ? controls : panels;
    },
    addEventListener(type, listener) { listeners.set(type, listener); },
    removeEventListener(type) { listeners.delete(type); },
    contains() { return false; }
  };
  fixture.controls = controls;
  fixture.panels = panels;
  return fixture;
}

test('product demo ignores empty or mismatched collections and wraps public state indexes', async () => {
  for (const options of [{ controlCount: 0, panelCount: 0 }, { controlCount: 2, panelCount: 1 }]) {
    const fixture = createDemoFixture(options);
    initProductDemo(fixture.root);
    fixture.observer?.([{ target: fixture.root, isIntersecting: true, intersectionRatio: 1 }]);
    await Promise.resolve();
    assert.equal(fixture.timers.length, 0);
  }

  const fixture = createDemoFixture();
  const demo = initProductDemo(fixture.root);
  demo.selectState(99);
  assert.equal(fixture.root.dataset.state, 'depleted');
  assert.equal(fixture.panels.filter(panel => panel.dataset.active === 'true').length, 1);
});

test('product demo observes legacy reduced-motion changes and removes its listener', async () => {
  const fixture = createDemoFixture({ legacyMotion: true });
  const demo = initProductDemo(fixture.root);
  fixture.observer([{ target: fixture.root, isIntersecting: true, intersectionRatio: 1 }]);
  await Promise.resolve();
  await Promise.resolve();
  assert.equal(fixture.motionListeners.length, 1);
  assert.equal(fixture.timers.length, 1);

  fixture.motionListeners[0]({ matches: true });
  assert.equal(fixture.clearedTimers.length, 1);
  demo.disconnect();
  assert.equal(fixture.removedMotionListeners.length, 1);
});
