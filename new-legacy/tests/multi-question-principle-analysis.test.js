'use strict';

// V9.0-P4.5.35 · 多题画布作答光标与原则解析合同测试。
// ① 作答提交期间不再禁用字母按钮（禁用触发 :disabled cursor:wait 漏斗光标；
//    防重复由 submitPracticeAnswer 的 pending promise 去重保证）；
// ② 解析面板新增"原则解析"段（题目关联原则的做题原则 = 原则名 + 启用预设内容）。

const assert = require('assert/strict');
const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');
const read = file => fs.readFileSync(path.join(ROOT, file), 'utf8');
const controller = read('src/77-multi-question-workspace.js');
const html = read('question-workspace.html');

// ① 无 pending 禁用（P4.5.37 起本地判题即时反馈，无等待期；同步走队列）
assert.doesNotMatch(controller, /syncState\.pending\?' disabled aria-disabled="true"':'/);
assert.match(controller, /function flushAnswerQueue\(\)/);

// ② 原则解析段
assert.match(controller, /ANALYSIS_SECTION_ORDER=\['analysis','answer','path','principle','concepts','clues','traps'\]/);
assert.match(controller, /principle:'原则解析'/);
assert.match(controller, /function principleAnalysisMarkup\(question=\{\},node=\{\}\)/);
assert.match(controller, /analysisSectionMarkup\('principle','原则解析',principleBody,'qw-analysis-principle'\)/);
// 原则来源：正确选项映射优先 + principleIds 兜底；内容取启用预设
assert.match(controller, /Array\.isArray\(optionMap\[answerId\]\)\)optionMap\[answerId\]\.forEach\(push\)/);
assert.match(controller, /Presets\.getByPrincipleId\?\.\(principleId,\{activeOnly:true\}\)/);
// 勾选变化会刷新面板内容（含新段）
assert.match(controller, /refreshAnalysisPanelContents\(\)/);
assert.match(html, /styles\/question-workspace-p4535\.css/);

console.log('multi-question-principle-analysis-ok');
