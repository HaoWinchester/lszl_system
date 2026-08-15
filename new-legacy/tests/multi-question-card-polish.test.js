'use strict';

// V9.0-P4.5.34 · 多题画布题目卡打磨合同测试。
// ① 题号徽标（paperIndex，与深度回忆同款）；② 取消"正在保存作答"常驻提示；
// ③ 解析按钮右下 + 面板视口感知定位；④ 生成归纳卡不再弹编辑弹窗；
// ⑤ 练习按钮居中加宽；⑥ 共同原则放宽为 principleIds 交集 + 预设以个人卡复制落地。

const assert = require('assert/strict');
const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');
const read = file => fs.readFileSync(path.join(ROOT, file), 'utf8');
const controller = read('src/77-multi-question-workspace.js');
const css = read('styles/question-workspace-p4534.css');
const html = read('question-workspace.html');

// ① 题号徽标
assert.match(controller, /qw-card-question-order-badge/);
assert.match(controller, /orderItem\.paperIndex/);
// ② pending 提示取消（error 重试保留）
assert.doesNotMatch(controller, /is-pending" data-qw-option-sync-status role="status">正在保存作答/);
assert.match(controller, /data-qw-option-retry/);
// ③ 面板视口感知（右侧溢出翻左侧）
assert.match(controller, /clientToWorld\(vpRect\.right-12,vpRect\.top\)\.x/);
assert.match(controller, /dataset\.side=x<Number\(node\.x\|\|0\)-12\?'left':'right'/);
assert.match(css, /\.qw-card-actions\.qw-card-learning-actions\{justify-content:flex-end\}/);
assert.match(html, /styles\/question-workspace-p4534\.css/);
// ④ 不弹编辑弹窗（quickCreateSynthesis 不再调用 openSynthesisModal）
const quick = controller.match(/async function quickCreateSynthesis\(\)\{[\s\S]*?\n  \}/)[0];
assert.doesNotMatch(quick, /openSynthesisModal/);
assert.match(quick, /focusNode\(result\.node\.id/);
// ⑥ 交集原则 + 预设复制为个人卡
assert.match(controller, /function commonPresetFromPrincipleIntersection/);
assert.match(controller, /principleIdsForQuestion\(question\)/);
assert.match(controller, /cardType:asPersonal\?'user':'system'/);
assert.match(controller, /typeof PersonalCards\.create==='function'/);
// ⑤ 练习按钮
assert.match(css, /\.qw-synthesis-practice-split\{display:flex;align-items:center;justify-content:center/);
assert.match(css, /\.qw-synthesis-practice-btn\{[\s\S]*?min-width:148px/);

console.log('multi-question-card-polish-ok');
