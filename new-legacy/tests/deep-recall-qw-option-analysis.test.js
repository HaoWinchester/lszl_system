'use strict';

// V9.0-P4.5.30 · 深度回忆选项与解析对齐多题画布的静态合同测试。
// 断言：① kr 页加载 question-workspace.css（qw 选项/解析样式单一来源）；
// ② 旧 .kr-option 整行按钮样式与 hover 上浮已移除；③ 选项 DOM/交互走
// qw-card-option-key + is-correct-flash/is-wrong-flash/is-correct-active；
// ④ 关键词 token 无左右 padding；⑤ 解析按钮/面板与共享勾选偏好 key。

const assert = require('assert/strict');
const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');
const read = file => fs.readFileSync(path.join(ROOT, file), 'utf8');
const html = read('knowledge-recall.html');
const controller = read('src/86-knowledge-recall.js');
const css = read('styles/knowledge-recall.css');
const p4529 = read('styles/knowledge-recall-p4529.css');
const p4530 = read('styles/knowledge-recall-p4530.css');

// ① 样式单一来源：kr 页引入 question-workspace.css，新补丁最后加载
assert.match(html, /styles\/question-workspace\.css/);
assert.match(html, /styles\/knowledge-recall-p4530\.css[\s\S]*?styles\/learning-weekly-open-gate\.css/);
const qwIdx = html.indexOf('styles/question-workspace.css');
const p4530Idx = html.indexOf('styles/knowledge-recall-p4530.css');
assert.ok(qwIdx > html.indexOf('styles/knowledge-recall-p4529.css') && p4530Idx > qwIdx, 'question-workspace.css 应在 p4529 之后、p4530 之前加载');

// ② 旧整行按钮样式与 hover 上浮已移除（防回退）
assert.doesNotMatch(css, /\.kr-option:hover\{[\s\S]*?translateY/);
assert.doesNotMatch(css, /\.kr-option\{width:100%/);
assert.doesNotMatch(css, /krOptionCorrectFlash|krOptionIncorrectFlash/);
assert.doesNotMatch(p4529, /\.kr-option>strong/);

// ③ 选项结构与交互对齐 qw
assert.match(controller, /<ol class="qw-card-options">\$\{rows\.join\(''\)\}<\/ol>/);
assert.match(controller, /class="qw-card-option-key\$\{selected\?' is-answer-selected':''\}\$\{persistent\?' is-correct-active':''\}"/);
assert.match(controller, /closest\('\[data-qw-option-key\]'\)/);
assert.match(controller, /KR_OPTION_SINGLE_CLICK_DELAY=230/);
assert.match(controller, /const className=correct\?'is-correct-flash':'is-wrong-flash'/);
assert.match(controller, /toggleKrPersistentAnswer/);
assert.doesNotMatch(controller, /flashRecallOptionFeedback/);
// 双击取消未决单击（与 77-multi-question-workspace 行为一致）
assert.match(controller, /addEventListener\('dblclick'[\s\S]{0,220}clearTimeout\(krOptionClickTimer\)/);

// ④ 关键词 token 左右 padding 归零（间距与相邻文字一致）
assert.match(p4529, /\.kr-keyword-token\{[\s\S]{0,200}padding:0;/);
assert.doesNotMatch(p4529, /padding:0 2px/);

// ⑤ 解析按钮/面板与共享偏好
assert.match(html, /id="krAnalysisLayer"/);
assert.match(controller, /data-qw-action="analysis"/);
assert.match(controller, /qw-analysis-panel/);
assert.match(controller, /KR_ANALYSIS_SECTION_KEY='kg_multi_question_analysis_sections_v1'/);
assert.match(p4530, /\.knowledge-recall-page\{[\s\S]*?--qw-font-xs:12px/);

console.log('deep-recall-qw-option-analysis-ok');
