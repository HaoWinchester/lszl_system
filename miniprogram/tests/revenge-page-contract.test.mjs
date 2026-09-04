import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const read = path => readFileSync(join(root, path), 'utf8');

test('revenge flow requires remediation before verification', () => {
  const source = read('pages/revenge/index.ts');
  assert.match(source, /submitRevengeAnswer/);
  assert.match(source, /markRemediationReviewed/);
  assert.match(source, /getVerificationCandidate/);
  assert.match(source, /submitVerification/);
});

test('revenge uses a quiet three-step learning sequence with real states', () => {
  const page = read('pages/revenge/index.wxml');
  for (const label of ['重答原题', '阅读纠错', '变式验证', '暂无待处理错题']) {
    assert.match(page, new RegExp(label));
  }
  assert.match(page, /question-view/);
  assert.match(page, /remediation-note/);
  assert.doesNotMatch(read('pages/revenge/index.wxss'), /gradient|box-shadow|grid-template-columns\s*:\s*repeat\([3-9]/i);
});

test('remediation component avoids unsupported tag selectors', () => {
  const styles = read('components/remediation-note/index.wxss');
  assert.doesNotMatch(styles, /\.(?:answer|knowledge)-line text/);
});

test('revenge route and APIs are wired without a second mistake store', () => {
  assert.ok(JSON.parse(read('app.json')).pages.includes('pages/revenge/index'));
  const service = read('services/practice.ts');
  for (const path of ['revenge-answer', 'remediation-reviewed', 'verification-candidate', '/verification']) {
    assert.match(service, new RegExp(path));
  }
  assert.doesNotMatch(service, /createMistakeLedger|localMistakeStore/);
});

test('revenge page uses the shared title and metadata scale', () => {
  const styles = read('pages/revenge/index.wxss');
  assert.doesNotMatch(styles, /font-family/);
  assert.match(styles, /font-size:\s*var\(--font-display\)/);
  assert.match(styles, /font-size:\s*var\(--font-meta\)/);
});
