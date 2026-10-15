import {spawnSync} from 'node:child_process';
import assert from 'node:assert/strict';
import test from 'node:test';
import {fileURLToPath} from 'node:url';

test('shared danmaku design, icons and positioning contract', () => {
  const result = spawnSync(process.execPath, ['--test', fileURLToPath(new URL('../../new-legacy/tests/danmaku-design.test.js', import.meta.url))], {encoding: 'utf8'});
  assert.equal(result.status, 0, result.stdout + '\n' + result.stderr);
});
