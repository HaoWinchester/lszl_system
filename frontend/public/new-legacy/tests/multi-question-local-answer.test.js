'use strict';

// V9.0-P4.5.37 · 本地判题 + 异步队列同步 + 右键菜单文案 + 深度回忆保存优化 合同测试。

const assert = require('assert/strict');
const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');
const read = file => fs.readFileSync(path.join(ROOT, file), 'utf8');
const controller = read('src/77-multi-question-workspace.js');
const menu = read('src/graph/context-menu-controller.js');
const adapter = read('../frontend/scripts/new-legacy-assets/practice-learning-adapter.js').replace(
  // 上面 read 相对 ROOT 的父级目录不可靠，改用绝对路径重新读取
  '', '');
const adapterSrc = fs.readFileSync(path.resolve(ROOT, '..', 'frontend', 'scripts', 'new-legacy-assets', 'practice-learning-adapter.js'), 'utf8');
const recall = read('src/86-knowledge-recall.js');
const css = read('styles/knowledge-recall-p4537.css');
const html = read('knowledge-recall.html');

// ① 本地判题：快照 correctAnswer 优先，节点兜底
assert.match(controller, /function localAnswerCorrect\(record,key\)\{[\s\S]*?correctAnswerId\(question\)\|\|String\(record\?\.node\?\.correctAnswer\|\|''\)[\s\S]*?String\(key\|\|''\)===String\(canonical\)/);
// ② 队列：空闲批量 + 保序提交 + 失败塞回队首自动重试
assert.match(controller, /const ANSWER_FLUSH_DELAY=2500/);
assert.match(controller, /state\.answerQueue=\[\{payload:payload,nodeId:String\(nodeId\|\|''\)\}\]|state\.answerQueue\.push\(\{payload:payload,nodeId:String\(nodeId\|\|''\)\}\)/);
assert.match(controller, /顺序提交保序/);
assert.match(controller, /state\.answerQueue=\[\.\.\.rest,\.\.\.state\.answerQueue\]/);
assert.match(controller, /answerSync\.set\(item\.nodeId,\{\.\.\.syncState,pending:false,error:String\(error\?\.message/);
// ③ 退出保存：pagehide/beforeunload/visibilitychange + 学习进度 flush 链
assert.match(controller, /addEventListener\('pagehide',\(\)=>\{void flushAnswerQueue\(\)\}\)/);
assert.match(controller, /addEventListener\('beforeunload',\(\)=>\{void flushAnswerQueue\(\)\}\)/);
assert.match(controller, /document\.addEventListener\('visibilitychange',\(\)=>\{if\(document\.visibilityState==='hidden'\)void flushAnswerQueue\(\)\}\)/);
assert.match(controller, /void flushAnswerQueue\(\);return true\}/);
// ④ adapter keepalive（pagehide 时请求存活）
assert.match(adapterSrc, /keepalive: true/);
assert.match(adapterSrc, /options\.skipRefresh !== true/);
// ⑤ 右键菜单文案：三页统一"文字高清"
assert.match(menu, /actionButton\('refresh','文字高清',ICONS\.refresh/);
assert.doesNotMatch(menu, /'刷新'/);
// ⑥ 深度回忆：防抖 1200ms + 保存提醒默认隐藏仅失败显示
assert.match(recall, /progressSaveTimer=setTimeout\(\(\)=>\{progressSaveTimer=0;void writeProgressNow\(\)\},1200\)/);
assert.match(css, /\.kr-save-status\{display:none\}/);
assert.match(css, /\[data-state="failed"\],[\s\S]*?\[data-state="conflict"\]\{display:inline-flex\}/);
assert.match(html, /styles\/knowledge-recall-p4537\.css/);

console.log('multi-question-local-answer-ok');
