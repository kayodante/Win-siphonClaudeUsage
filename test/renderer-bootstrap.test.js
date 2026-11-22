import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const lines = readFileSync(new URL('../src/renderer/renderer.js', import.meta.url), 'utf8').split('\n');

test('no top-level declaration follows the bootstrap\'s first render', () => {
  // Exact two-space-indented line: a four-space copy elsewhere lives inside a function.
  const anchor = lines.findIndex(line => line.replace(/\r$/, '') === '  render(await window.siphon.getState());');
  assert.notEqual(anchor, -1, 'bootstrap render line not found in renderer.js');

  // render() runs here, before module evaluation reaches later lines; a top-level
  // const/let read by it would still be in its temporal dead zone.
  const late = lines.slice(anchor + 1).findIndex(line => /^(const|let|var) /.test(line));
  assert.equal(
    late,
    -1,
    `top-level declaration after the bootstrap render (renderer.js:${anchor + late + 2}): ${lines[anchor + late + 1]}`
  );
});
