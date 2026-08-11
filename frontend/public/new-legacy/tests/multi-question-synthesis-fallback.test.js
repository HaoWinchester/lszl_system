'use strict';

const assert = require('assert/strict');
const fs = require('fs');
const path = require('path');

const controller = fs.readFileSync(
  path.resolve(__dirname, '..', 'src', '77-multi-question-workspace.js'),
  'utf8',
);

assert.match(controller, /function blankSynthesisDraft\(questions=\[\]\)/);
assert.match(controller, /valid:false/);
assert.match(controller, /请为每道题的正确选项绑定同一个且唯一的原则/);
assert.match(controller, /cardType:'user'/);
assert.match(controller, /title:'未命名原则卡'/);
assert.match(controller, /content:''/);
assert.match(controller, /if\(!resolved\?\.ok\)return blankSynthesisDraft\(questions\)/);
assert.match(controller, /if\(!payload\.valid\)\{notify\(payload\.error/);
assert.match(controller, /cardType:'system'/);

console.log('multi-question-synthesis-fallback-ok');
