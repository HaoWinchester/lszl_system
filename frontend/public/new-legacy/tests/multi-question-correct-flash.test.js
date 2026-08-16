'use strict';

const assert = require('assert/strict');
const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');
const read = file => fs.readFileSync(path.join(ROOT, file), 'utf8');
const controller = read('src/77-multi-question-workspace.js');
const css = read('styles/question-workspace.css');

assert.match(controller, /const CORRECT_FLASH_DURATION\s*=\s*560/);
// P4.5.37：本地判题（快照 correctAnswerId）即时闪烁，服务端同步走异步队列
assert.match(controller, /flashOption\(record,key,correct\?'is-correct-flash':'is-wrong-flash',correct\?CORRECT_FLASH_DURATION:WRONG_FLASH_DURATION\)/);
assert.match(controller, /function localAnswerCorrect\(record,key\)/);
assert.match(controller, /const canonical=correctAnswerId\(question\)\|\|String\(record\?\.node\?\.correctAnswer\|\|''\)/);
assert.match(controller, /await PracticeLearning\.answer\(item\.payload,\{skipRefresh:true\}\)/);
assert.match(css, /\.qw-card-option-key\.is-correct-flash\{animation:qw-option-correct-flash \.56s ease\}/);
assert.match(css, /@keyframes qw-option-correct-flash\{[\s\S]*?border-color:#16a34a[\s\S]*?background:#22c55e/);
assert.match(css, /@media\(prefers-reduced-motion:reduce\)\{[\s\S]*?\.qw-card-option-key\.is-correct-flash\{animation:none;background:#dcfce7;color:#166534;border-color:#16a34a\}/);

console.log('multi-question-correct-flash-ok');
