import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const read = path => readFileSync(join(root, path), 'utf8');

test('catalog exposes loading, error recovery, empty, and access states', () => {
  const page = read('pages/papers/index.wxml');
  assert.match(page, /wx:if="{{loading}}"/);
  assert.match(page, /bind:action="loadPapers"/);
  assert.match(page, /empty-state/);
  assert.match(page, /会员试卷/);
  assert.match(read('pages/papers/index.ts'), /contentRestricted/);
});

test('setup includes count, order, all supported paper modes, and resume recovery', () => {
  const page = `${read('pages/practice-setup/index.wxml')}\n${read('pages/practice-setup/index.ts')}\n${read('domain/mode-policy.ts')}`;
  for (const label of ['题量', '顺序出题', '随机出题', '普通练习', '挑战模式', '学霸模式']) {
    assert.match(page, new RegExp(label));
  }
  const source = read('pages/practice-setup/index.ts');
  assert.match(source, /RESUMABLE_SESSION_EXISTS/);
  assert.match(source, /继续上次/);
  assert.match(source, /放弃后重新开始/);
});

test('home loads authoritative summaries in parallel and every visible entry has a handler', () => {
  const source = read('pages/home/index.ts');
  assert.match(source, /Promise\.allSettled/);
  for (const call of ['listPublishedPapers', 'getOverview', 'getExperienceSummary', 'getRevengeSummary', 'getActiveSessions']) {
    assert.match(source, new RegExp(call));
  }
  const page = read('pages/home/index.wxml');
  assert.match(page, /bindtap="onContinue"/);
  assert.match(page, /bindtap="onBrowsePapers"/);
  assert.match(page, /bindtap="onMode"/);
});

test('new pages are declared and remain one-column mobile layouts', () => {
  const app = JSON.parse(read('app.json'));
  assert.ok(app.pages.includes('pages/papers/index'));
  assert.ok(app.pages.includes('pages/practice-setup/index'));
  assert.doesNotMatch(`${read('pages/papers/index.wxss')}\n${read('pages/practice-setup/index.wxss')}`, /grid-template-columns\s*:\s*repeat\([2-9]/);
});
