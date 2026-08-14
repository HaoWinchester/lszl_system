'use strict';

const assert = require('assert/strict');
const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');
const read = file => fs.readFileSync(path.join(ROOT, file), 'utf8');

const index = read('index.html');
const chooser = read('src/31-learning-entry-chooser.js');
const answerCard = read('src/cards/answer-card.js');
const practiceMode = read('src/100-practice-mode.js');
const practiceCss = read('styles/practice-mode.css');
const flow = read('src/64-flow-orchestrator.js');
const trainingCss = read('styles/question-training.css');
const selectionCss = read('styles/home-selection-geometry-p4332.css');
const questionBank = read('question-bank.html');
const questionAdmin = read('src/65-question-bank-admin.js');

assert.match(index, /id="learningEntryBtn"[^>]*>学习入口<\/a>/);
assert.match(chooser, /global\.KGLearningEntryChooser\s*=\s*\{\s*init\s*,\s*show:\s*showDialog\s*\}/);

assert.match(flow, /type==='ANSWER_SUBMITTED'/);
assert.match(answerCard, /context\.dispatch\(\{type:'ANSWER_SUBMITTED'/);
assert.match(answerCard, /submitted\?'disabled="disabled" aria-disabled="true"'/);
assert.match(answerCard, /is-correct-flash/);
assert.match(answerCard, /is-wrong-flash/);
assert.match(trainingCss, /\.question-training-page \.q-option\.correct\{[^}]*#16a34a/);
assert.match(trainingCss, /\.question-training-page \.q-option\.wrong\{[^}]*#dc2626/);
assert.match(trainingCss, /@keyframes qt-option-correct-flash/);
assert.match(trainingCss, /@keyframes qt-option-wrong-flash/);
assert.match(trainingCss, /\.question-training-page \.q-option:disabled\{[^}]*pointer-events:none/);

assert.match(practiceMode, /function revealOptionResult\(selectedId,correctId\)/);
assert.match(practiceMode, /button\.classList\.add\('is-correct'\)/);
assert.match(practiceMode, /button\.classList\.add\('is-wrong'\)/);
assert.match(practiceMode, /state\.locked=true;lockOptions\(\);revealOptionResult\(optionId,question\.correctAnswer\)/);
assert.match(practiceCss, /\.practice-option\.is-correct\{[^}]*background:#dcfce7/);
assert.match(practiceCss, /\.practice-option\.is-wrong\{[^}]*background:#ffe4e6/);

assert.match(selectionCss, /--home-selection-blue:#1d6fd8/);
assert.match(selectionCss, /\.graph-element-resize-handle\.handle-n\{top:0!important;transform:translate\(-50%,-100%\)!important\}/);
assert.match(selectionCss, /\.graph-element-resize-handle\.handle-s\{top:100%!important;transform:translate\(-50%,0\)!important\}/);
assert.match(selectionCss, /\.graph-element-resize-handle\.handle-e\{left:100%!important;transform:translate\(0,-50%\)!important\}/);
assert.match(selectionCss, /\.graph-element-resize-handle\.handle-w\{left:0!important;transform:translate\(-100%,-50%\)!important\}/);

assert.match(questionBank, /id="qbQuestionSearch"[^>]*autocomplete="off"/);
assert.match(questionAdmin, /questionSearch\.value\s*=\s*''/);
assert.match(questionAdmin, /state\.questionSearch\s*=\s*''/);

console.log('learning-entry-answer-feedback-ok');
