#!/usr/bin/env node
// Copy package.json's version into the Rust/Tauri manifests. `npm version` only
// touches package.json, but tauri.conf.json is where the built app reads the
// version it reports to the update check — if they drift, a release makes the
// app offer an update to itself forever. Wired to the `version` npm lifecycle
// hook so the documented bump command keeps every manifest in step.

import { readFileSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const defaultRoot = join(dirname(fileURLToPath(import.meta.url)), '..');

// Cargo.lock pins the workspace members' own versions too, so it drifts like
// the rest. Match the [[package]] block by name instead of by position.
const lockEntry = name =>
  new RegExp(`(\\[\\[package\\]\\]\\r?\\nname = "${name}"\\r?\\nversion = ")[^"]*(")`);

// Each manifest's own package version is the first match: [package] leads
// Cargo.toml, and "version" sits at the top level of tauri.conf.json. Anchored
// + first-match-only so dependency versions below are never touched.
export function syncWebsiteHtml(source, version) {
  return source
    .replace(/("softwareVersion":\s*)"[^"]*"/, `$1"${version}"`)
    .replace(
      /releases\/download\/v[^/"\s]+\/Siphon\.Setup\.[^/"\s]+\.exe/g,
      `releases/download/v${version}/Siphon.Setup.${version}.exe`
    );
}

export function syncVersion(root = defaultRoot) {
  const version = JSON.parse(readFileSync(join(root, 'package.json'), 'utf8')).version;
  const targets = [
    ['src-tauri/Cargo.toml', /^version = "[^"]*"/m, `version = "${version}"`],
    ['src-tauri/crates/siphon-core/Cargo.toml', /^version = "[^"]*"/m, `version = "${version}"`],
    ['src-tauri/tauri.conf.json', /^(\s*)"version": "[^"]*"/m, `$1"version": "${version}"`],
    ['src-tauri/Cargo.lock', lockEntry('siphon'), `$1${version}$2`],
    ['src-tauri/Cargo.lock', lockEntry('siphon-core'), `$1${version}$2`]
  ];

  let failed = false;
  for (const [file, pattern, replacement] of targets) {
    const path = join(root, file);
    const before = readFileSync(path, 'utf8');
    if (!pattern.test(before)) {
      console.error(`sync-version: no version field found in ${file}`);
      failed = true;
      continue;
    }
    const after = before.replace(pattern, replacement);
    if (after !== before) {
      writeFileSync(path, after);
      console.log(`sync-version: ${file} -> ${version}`);
    }
  }

  const websiteFile = 'docs/index.html';
  const websitePath = join(root, websiteFile);
  const before = readFileSync(websitePath, 'utf8');
  if (!/"softwareVersion":\s*"[^"]*"/.test(before) ||
      !/releases\/download\/v[^/"\s]+\/Siphon\.Setup\.[^/"\s]+\.exe/.test(before)) {
    console.error(`sync-version: no website version fields found in ${websiteFile}`);
    failed = true;
    return failed;
  }
  const after = syncWebsiteHtml(before, version);
  if (after !== before) {
    writeFileSync(websitePath, after);
    console.log(`sync-version: ${websiteFile} -> ${version}`);
  }

  return failed;
}

const invokedAsScript = process.argv[1] &&
  resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (invokedAsScript) {
  const root = process.argv[2] ? resolve(process.argv[2]) : defaultRoot;
  if (syncVersion(root)) process.exitCode = 1;
}
