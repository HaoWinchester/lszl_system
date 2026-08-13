'use strict';
const assert=require('assert');
const fs=require('fs');
const path=require('path');

const editor=fs.readFileSync(path.resolve(__dirname,'../src/10-graph-editor.js'),'utf8');
const start=editor.indexOf('function updateGraphModeIndicator()');
const end=editor.indexOf('function syncGraphModeClasses()',start);
const indicator=editor.slice(start,end);

assert(start>=0&&end>start,'图谱模式提示更新函数必须存在');
assert(!indicator.includes('退出心流'),'心流模式退出按钮仅显示“退出”');
assert(!indicator.includes('退出只看相关'),'只看相关模式退出按钮仅显示“退出”');
assert(indicator.includes("textContent='退出'"),'两种图谱模式都应把退出按钮文案设为“退出”');

console.log('v90-p415-graph-mode-exit-label-ok');
