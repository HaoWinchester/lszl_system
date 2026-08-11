'use strict';

const assert = require('assert/strict');
const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');
const html = fs.readFileSync(path.join(ROOT, 'practice-mode.html'), 'utf8');

for (const id of [
  'practicePaperLibrary',
  'practiceLibraryFilters',
  'practiceLibraryMoreBtn',
  'practicePaperDrawer',
  'practiceHistoryOpenBtn',
  'practiceHistoryDrawer',
  'practiceClearHistoryBtn',
  'practiceToast',
]) {
  assert(html.includes(`id="${id}"`), `practice-mode.html missing ${id}`);
}

for (const script of [
  'src/59a-paper-learning-modes.js',
  'src/58-paper-access-service.js',
  'src/59-published-paper-repository.js',
  'src/100-practice-mode.js',
]) {
  assert(html.includes(script), `practice-mode.html missing ${script}`);
}

assert(html.includes('styles/focus-vega-typography.css'));
assert(html.includes('styles/learning-skin.css'));
assert(html.includes('data-learning-skin="focus-vega"'));
assert(html.includes('<div id="authDialogRoot"></div>'), '必须继续复用当前登录弹窗容器');
assert(html.includes('src/30-shared-auth-dialog.js'), '必须继续复用当前登录流程');
assert(!html.includes('src/30-standalone-auth-dialog.js'), '不得移入 updata 的独立登录实现');

console.log('v90-p43-practice-library-integration-ok');
