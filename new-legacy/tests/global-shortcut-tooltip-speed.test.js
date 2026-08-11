'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const root = path.resolve(__dirname, '..');
const shortcuts = fs.readFileSync(path.join(root, 'src', '39-global-shortcuts.js'), 'utf8');
const styles = fs.readFileSync(path.join(root, 'styles', 'global-shortcuts.css'), 'utf8');

assert.match(
  shortcuts,
  /data-global-shortcut="\$\{item\.id\}"\s+data-tooltip="\$\{escapeHTML\(item\.label\)\}"\s+aria-label="\$\{escapeHTML\(item\.label\)\}"/,
  '全局快捷图标必须使用自定义提示并保留无障碍名称',
);
assert.doesNotMatch(
  shortcuts,
  /data-global-shortcut="\$\{item\.id\}"[^>]*\btitle=/,
  '全局快捷图标不能再使用浏览器原生 title 提示',
);
assert.match(
  shortcuts,
  /kg-global-shortcuts-grip" data-tooltip="按住拖拽快捷栏"/,
  '拖拽手柄也必须使用自定义提示',
);
assert.doesNotMatch(
  shortcuts,
  /id="kgGlobalShortcutsHandle"[^>]*\btitle=/,
  '拖拽手柄容器不能保留浏览器原生 title 提示',
);
assert.match(
  shortcuts,
  /toggle\.dataset\.tooltip\s*=/,
  '排布切换按钮必须动态更新自定义提示',
);
assert.match(
  styles,
  /\.kg-global-shortcuts \[data-tooltip\]::after/,
  '全局快捷栏必须有自定义提示样式',
);
assert.match(
  styles,
  /transition-delay:0ms/,
  '全局快捷提示第一次悬停也必须零延迟启动',
);

console.log('global-shortcut-tooltip-speed-ok');
