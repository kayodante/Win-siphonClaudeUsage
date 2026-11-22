import { readdir } from 'node:fs/promises';
import path from 'node:path';
import { spawnSync } from 'node:child_process';

for (const root of ['src', 'test', 'scripts', 'docs']) {
  const dir = path.resolve(root);
  for (const file of await readdir(dir, { recursive: true })) {
    if (!file.endsWith('.js') && !file.endsWith('.cjs')) continue;
    const result = spawnSync(process.execPath, ['--check', path.join(dir, file)], { stdio: 'inherit' });
    if (result.status !== 0) process.exit(result.status ?? 1);
  }
}
