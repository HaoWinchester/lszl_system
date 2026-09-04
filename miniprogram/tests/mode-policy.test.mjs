import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

import { getModePolicy } from '../domain/mode-policy.ts';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const read = path => readFileSync(join(root, path), 'utf8');

test('competitive modes never reveal per-question answers', () => {
  for (const mode of ['challenge', 'scholar']) {
    const policy = getModePolicy(mode);
    assert.equal(policy.revealAfterAnswer, false);
    assert.equal(policy.revealAfterComplete, true);
    assert.equal(policy.showTimer, true);
  }
});

test('backend practice alias resolves to the normal mobile policy', () => {
  assert.deepEqual(getModePolicy('practice'), getModePolicy('normal'));
  assert.equal(getModePolicy('normal').revealAfterAnswer, true);
});

test('practice and setup consume the shared policy instead of local title maps', () => {
  assert.match(read('pages/practice/index.ts'), /getModePolicy/);
  assert.match(read('pages/practice-setup/index.ts'), /MODE_CHOICES/);
  assert.match(read('pages/practice/index.wxml'), /timerLabel/);
});
