'use strict';
const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const read=file=>fs.readFileSync(path.join(__dirname,'..',file),'utf8');

test('qw ink launcher is icon-only (no text label) while keeping accessible naming',()=>{
 const page=read('styles/question-workspace-page.css');
 assert.ok(!page.includes('画笔·文字'),'「画笔·文字」文字标签应已移除');
 assert.ok(!/\.qw-ink-launcher::after/.test(page),'不允许再用 ::after 注入按钮文字');
 const html=read('question-workspace.html');
 assert.match(html,/id="qwInkBtn"[^>]*aria-label="画笔与文字工具"/);
 assert.match(html,/id="qwInkBtn"[^>]*title="画笔、荧光笔、橡皮与文字"/);
});

test('question card red hover boundary is suppressed while ink drawing is active',()=>{
 const css=read('styles/question-workspace.css');
 assert.match(css,/\.canvas-ink-drawing \.qw-question-card:hover[\s\S]*?outline:none/,'画笔激活时悬浮红框需要排除');
 assert.match(css,/\.qw-question-card:hover[\s\S]*?outline:2px solid #ef4444/,'非绘画态的红框悬浮提醒需保留');
});
