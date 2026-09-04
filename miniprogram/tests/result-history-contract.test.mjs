import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const read = path => readFileSync(join(root, path), 'utf8');

test('result presents actionable feedback without a dashboard card wall', () => {
  const page = read('pages/result/index.wxml');
  for (const label of ['正确率', '错题', '薄弱知识点', '查看解析', '再练一次']) {
    assert.match(page, new RegExp(label));
  }
  assert.doesNotMatch(read('pages/result/index.wxss'), /grid-template-columns:\s*repeat\([3-9]/);
});

test('result actions navigate to real learning flows', () => {
  const page = read('pages/result/index.wxml');
  assert.match(page, /bindtap="onRetry"/);
  assert.match(page, /bindtap="onRevenge"/);
  assert.match(page, /bindtap="onReview"/);
  const source = read('pages/result/index.ts');
  assert.match(source, /getReport/);
  assert.match(source, /getSession/);
});

test('history has loading, error recovery, empty, completed report, and resume paths', () => {
  const page = read('pages/history/index.wxml');
  assert.match(page, /wx:if="{{loading}}"/);
  assert.match(page, /bind:action="loadHistory"/);
  assert.match(page, /empty-state/);
  assert.match(page, /查看报告/);
  assert.match(page, /继续作答/);
  assert.match(read('pages/history/index.ts'), /listSessions/);
});

test('result and history routes are declared', () => {
  const pages = JSON.parse(read('app.json')).pages;
  assert.ok(pages.includes('pages/result/index'));
  assert.ok(pages.includes('pages/history/index'));
});
