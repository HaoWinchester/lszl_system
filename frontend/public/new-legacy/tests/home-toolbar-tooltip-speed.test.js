'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const css = fs.readFileSync(
  path.resolve(__dirname, '..', 'styles', 'home-graph-components.css'),
  'utf8',
);

const homepageTooltipStart = css.indexOf(
  '.floating-tool-btn[data-tooltip]:hover::after,',
);
const homepageTooltipRule = css.slice(
  homepageTooltipStart,
  css.indexOf('\n.node-toolbar-btn[data-tooltip]:hover::after,', homepageTooltipStart),
);

assert.notEqual(homepageTooltipStart, -1, '主页工具栏提示的悬停样式必须存在');
assert.match(
  homepageTooltipRule,
  /transition-delay:60ms/,
  '主页工具栏的提示应在 60ms 内开始出现',
);
assert.doesNotMatch(
  homepageTooltipRule,
  /transition-delay:260ms/,
  '主页工具栏不应继续等待 260ms 才显示提示',
);

console.log('home-toolbar-tooltip-speed-ok');
