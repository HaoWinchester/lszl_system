import assert from 'node:assert/strict';
import test from 'node:test';
import fs from 'node:fs';

const html = fs.readFileSync(new URL('../practice-mode.html', import.meta.url), 'utf8');
const css = fs.readFileSync(new URL('../styles/practice-mode.css', import.meta.url), 'utf8');

test('practice exit button keeps accessible contract', () => {
  assert.match(html, /id="practiceExitBtn"[^>]*aria-label="退出本次练习"/);
  assert.match(html, /id="practiceExitBtn"[^>]*>\s*<span[^>]*data-kg-icon="x"/);
});

test('paper drawer close button keeps accessible contract', () => {
  assert.match(html, /id="practicePaperDrawerClose"[^>]*aria-label="关闭试卷库"/);
});

test('close buttons use explicit centering styles', () => {
  assert.match(css, /\.practice-exit-btn\{[^}]*display:flex[^}]*align-items:center[^}]*justify-content:center/);
  assert.match(css, /\.practice-drawer-close\{[^}]*display:flex[^}]*align-items:center[^}]*justify-content:center/);
  assert.doesNotMatch(css, /\.practice-game-topbar>\.practice-exit-btn\{transform:(?!none)/);
});

// Task 6：答题卡收敛为单实例折叠抽屉，入口全宽度可见。
test('answer sheet collapses into one shared instance inside the drawer', () => {
  // 单实例渲染根必须位于抽屉 body 内
  const drawerMatch = html.match(/<div class="practice-drawer-backdrop practice-answer-sheet-drawer" id="practiceAnswerSheetDrawer"[\s\S]*?<\/div>\s*<\/section>/);
  assert.ok(drawerMatch, 'answer sheet drawer markup missing');
  assert.doesNotMatch(drawerMatch[0], /id="practiceAnswerSheetMobile"/);
  assert.match(drawerMatch[0], /<aside id="practiceAnswerSheet" class="practice-answer-sheet" aria-label="答题概览"><\/aside>/);
  // 全页只允许一个答题概览实例
  assert.equal((html.match(/aria-label="答题概览"/g) || []).length, 1);
  // 常驻侧栏与移动端第二实例移除
  assert.doesNotMatch(html, /id="practiceAnswerSheetMobile"/);
  assert.equal((html.match(/class="practice-answer-sheet"/g) || []).length, 1);
  // 开关按钮保留原 ID，语义变为唯一入口且始终可见
  assert.match(html, /id="practiceAnswerSheetMobileBtn"[^>]*aria-controls="practiceAnswerSheetDrawer"/);
});

test('desktop drops the persistent answer sheet gutter', () => {
  assert.doesNotMatch(css, /padding-right:324px/);
  assert.doesNotMatch(css, /\.practice-game\{width:min\(1200px,100%\)/);
  assert.doesNotMatch(css, /@media \(min-width:1024px\)\{\.practice-game\{padding-right:324px\}/);
});

test('toggle entry stays visible at every viewport width', () => {
  const rule = css.match(/\.practice-answer-sheet-mobile-btn\{[^}]*\}/);
  assert.ok(rule, 'mobile toggle style missing');
  assert.match(rule[0], /display:inline-flex/);
  assert.doesNotMatch(css, /\.practice-answer-sheet-mobile-btn\{display:none/);
});

test('drawer keeps a side-sheet form factor above the bottom-sheet breakpoint', () => {
  // 基础样式：右侧进入的窄抽屉，不带底部圆角弹层形态
  const drawer = css.match(/\.practice-answer-sheet-drawer \.practice-drawer\{[^}]*\}/);
  assert.ok(drawer, 'answer sheet drawer style missing');
  assert.doesNotMatch(drawer[0], /border-radius:22px 22px 0 0/);
  assert.match(drawer[0], /width:min\(420px/);
  // 窄屏才切换为全宽底部圆角抽屉
  const bottomSheet = css.match(/@media \(max-width:760px\)\{\.practice-answer-sheet-drawer[\s\S]*?\}\}/);
  assert.ok(bottomSheet, 'bottom-sheet media query missing');
  assert.match(bottomSheet[0], /width:100%/);
  assert.match(bottomSheet[0], /border-radius:22px 22px 0 0/);
});

test('exit confirm stacks three equal-width full-bleed buttons', () => {
  assert.match(css, /#practiceExitConfirm \.practice-exit-dialog>div\{\s*display:grid;\s*grid-template-columns:1fr;\s*gap:9px;?\s*\}/);
  assert.match(css, /#practiceExitConfirm \.practice-exit-dialog>div>button:not\(\[hidden\]\)\{\s*width:100%;\s*min-width:0;?\s*\}/);
  // 宽屏/窄屏通用 flex 拉伸规则只允许作用于其他弹窗（挑战失败/未答交卷），不允许命中退出弹窗
  assert.doesNotMatch(css, /\.practice-exit-dialog>div button\{flex:1 1 140px\}/);
  assert.doesNotMatch(css, /\.practice-exit-dialog>div\{flex-wrap:wrap\}\.practice-exit-dialog>div button\{flex:1 1 140px\}/);
});
