'use strict';

const assert = require('assert/strict');
const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');
const html = fs.readFileSync(path.join(ROOT, 'paper-management.html'), 'utf8');

for (const id of [
  'paperAccessLevelInput',
  'qbWithdrawPaperBtn',
  'qbUnarchivePaperBtn',
]) {
  assert(html.includes(`id="${id}"`), `paper-management.html missing ${id}`);
}

for (const mode of [
  'practice_mode',
  'deep_recall',
  'multi_question_canvas',
  'single_deep_study',
]) {
  assert(html.includes(`data-paper-mode="${mode}"`), `missing paper mode ${mode}`);
}

assert(html.includes('styles/focus-vega-teacher.css'), '现有 Focus/Vega 教师端皮肤必须保留');
assert(html.includes('data-ui-skin="focus-vega"'), '页面必须继续使用现有 UI 皮肤');
assert(html.includes('src/109-focus-vega-ui-icons.js'), '现有图标体系必须保留');

const domainIndex = html.indexOf('src/teacher/shared/domain-core.js');
const modesIndex = html.indexOf('src/59a-paper-learning-modes.js');
const releaseIndex = html.indexOf('src/teacher/paper-management/paper-release-service.js');
const adminIndex = html.indexOf('src/65-question-bank-admin.js');
assert(domainIndex > 0 && modesIndex > domainIndex && releaseIndex > modesIndex && adminIndex > releaseIndex,
  '发布领域模块必须在试卷管理入口前加载');

console.log('v90-p43-paper-management-integration-ok');
