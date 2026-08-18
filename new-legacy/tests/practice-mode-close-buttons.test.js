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
