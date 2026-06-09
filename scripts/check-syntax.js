import { readdir } from 'node:fs/promises';
import path from 'node:path';
import { spawnSync } from 'node:child_process';

const roots = ['src', 'test', 'scripts'];
const files = [];

for (const root of roots) {
  await walk(path.resolve(root));
}

for (const file of files) {
  const result = spawnSync(process.execPath, ['--check', file], { stdio: 'inherit' });
  if (result.status !== 0) {
    process.exit(result.status ?? 1);
  }
}

async function walk(dir) {
  const entries = await readdir(dir, { withFileTypes: true });
  for (const entry of entries) {
    const fullPath = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      await walk(fullPath);
    } else if (entry.name.endsWith('.js') || entry.name.endsWith('.cjs')) {
      files.push(fullPath);
    }
  }
}
