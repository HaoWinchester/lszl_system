'use strict';

// V9.0-P4.5.32 · 题目卡打磨合同测试。
// ① 作答选中视觉移除（闪烁后恢复原色，qw/kr 两页共用）；② 解析面板视口感知 +
// 画布 pan 守卫放行面板交互；③ 初始聚焦题目卡；④ 题目序号徽标；⑤ 滑入动画。

const assert = require('assert/strict');
const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');
const read = file => fs.readFileSync(path.join(ROOT, file), 'utf8');
const recall = read('src/86-knowledge-recall.js');
const qwCss = read('styles/question-workspace.css');
const css = read('styles/knowledge-recall-p4532.css');
const html = read('knowledge-recall.html');
const bankAdmin = read('src/65-question-bank-admin.js');

// ① 选中态规则保留（语义/防重复）但视觉归零，两页共用此单一来源
const selected = qwCss.match(/\.qw-card-option-key\.is-answer-selected\{[\s\S]*?\}/)[0];
assert.ok(!/ede9fe|6d5dfc|box-shadow:0 0 0/.test(selected), 'is-answer-selected 不应再有紫底/彩边/光环');
assert.match(selected, /background:transparent/);

// ② 解析面板：视口感知定位（右侧溢出翻左侧）+ pan 守卫放行面板与 summary
assert.match(recall, /worldRight/);
assert.match(recall, /panel\.dataset\.side=x<-width\/2-12\?'left':'right'/);
assert.match(recall, /\.qw-analysis-panel,summary,label/);

// ③ 初始聚焦题目卡（不再受恢复视图优先级影响）
assert.match(recall, /setTimeout\(\(\)=>\{centerOn\(0,0,true\);playQuestionCardEntry\(\)\},30\)/);

// ④ 序号徽标：目录顺序优先，预览回退 payload.questionOrder
assert.match(recall, /kr-question-order-badge/);
assert.match(recall, /question\.questionOrder/);
assert.match(bankAdmin, /payloadQuestion\.questionOrder=\{index:/);

// ⑤ 滑入动画：缓停曲线 + 可重触发 + reduced-motion 降级
assert.match(css, /@keyframes krCardSlideIn/);
assert.match(css, /cubic-bezier\(\.22,1,\.36,1\)/);
assert.match(css, /prefers-reduced-motion:reduce[\s\S]*?kr-card-enter\{animation:none\}/);
assert.match(recall, /function playQuestionCardEntry\(\)/);
assert.match(recall, /classList\.remove\('kr-card-enter'\);\s*void questionCard\.offsetWidth;\s*questionCard\.classList\.add\('kr-card-enter'\)/);
// 解析按钮贴右下
assert.match(css, /\.qw-card-actions\.qw-card-learning-actions\{justify-content:flex-end\}/);
assert.match(html, /styles\/knowledge-recall-p4532\.css/);

console.log('deep-recall-card-polish-ok');
