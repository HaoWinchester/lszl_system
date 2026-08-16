'use strict';

const assert=require('assert/strict');
const fs=require('fs');
const path=require('path');

const root=path.resolve(__dirname,'..');
const controller=fs.readFileSync(path.join(root,'src/77-multi-question-workspace.js'),'utf8');
const css=fs.readFileSync(path.join(root,'styles/question-workspace.css'),'utf8');

assert.match(controller,/const PracticeLearning=global\.KGPracticeLearningApi/);
assert.match(controller,/function practiceAnswerPayload\(record,key\)/);
assert.match(controller,/async function submitPracticeAnswer\(record,key/);
// P4.5.37：作答本地判题即时反馈 + 异步队列同步（pagehide/失败重试保留）
assert.match(controller,/localAnswerCorrect\(record,key\)/);
assert.match(controller,/enqueueAnswer\(payload,nodeId\)/);
assert.match(controller,/await PracticeLearning\.answer\(item\.payload,\{skipRefresh:true\}\)/);
assert.match(controller,/function failAnswerQueue\(rest,error\)/);
assert.match(controller,/pagehide.*flushAnswerQueue/s);
assert.match(controller,/data-qw-option-retry/);
assert.match(controller,/function retryPracticeAnswer\(record\)/);
assert.match(controller,/KGLearningSessionStore/);
assert.match(controller,/renderQuestionDock\(\)/);
assert.match(controller,/作答尚未保存/);
assert.match(css,/\.qw-option-sync-error/);
assert.match(css,/\.qw-card-option-key\.is-answer-selected/);

console.log('multi-question-mistake-sync-ok');
