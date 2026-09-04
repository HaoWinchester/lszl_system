import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const repo = join(root, '..');
const read = path => readFileSync(join(root, path), 'utf8');
const readRepo = path => readFileSync(join(repo, path), 'utf8');

test('release documentation names every external gate', () => {
  const doc = read('docs/release-checklist.md');
  for (const item of ['WECHAT_MINI_APP_ID', '服务器域名', '隐私保护指引', '真机', 'UAT']) {
    assert.match(doc, new RegExp(item));
  }
});

test('acceptance checklist covers the complete learning and recovery loop', () => {
  const doc = read('docs/release-checklist.md');
  for (const item of ['绑定', '退出', '恢复', '单选', '多选', '双语', '图片', '挑战模式', '学霸模式', '错题复仇', '断网', '冲突', '答案泄露', '会员', '安全区']) {
    assert.match(doc, new RegExp(item));
  }
});

test('configuration contains mini-app server keys but no real secrets', () => {
  const env = readRepo('backend/.env.example');
  for (const key of ['WECHAT_MINI_APP_ID=', 'WECHAT_MINI_APP_SECRET=', 'WECHAT_MINI_ENABLE_DEMO=']) assert.match(env, new RegExp(key));
  assert.doesNotMatch(readRepo('miniprogram/project.config.json'), /wx[a-f0-9]{16}/i);
  assert.match(read('config/index.ts'), /uat\.aihuanpu\.com/);
  assert.match(read('config/index.ts'), /lszl\.aihuanpu\.com/);
});
