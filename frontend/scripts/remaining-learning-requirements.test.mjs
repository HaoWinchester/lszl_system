import {runNodeTestProcess} from './node-test-process.mjs';
import assert from 'node:assert/strict';
import test from 'node:test';
import {fileURLToPath} from 'node:url';

for (const file of ['practice-sound', 'knowledge-space-scene', 'knowledge-dashboard', 'knowledge-preview']) {
  test(`remaining learning: ${file}`, () => {
    const result = runNodeTestProcess(['--test', fileURLToPath(new URL(`../../new-legacy/tests/${file}.test.js`, import.meta.url))], {encoding:'utf8'});
    assert.equal(result.status, 0, result.stdout + '\n' + result.stderr);
  });
}
