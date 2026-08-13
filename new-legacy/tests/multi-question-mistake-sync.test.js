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
assert.match(controller,/PracticeLearning\.answer\(payload\)/);
assert.doesNotMatch(controller,/PracticeLearning\.answer\(\{[^}]*correct/s);
assert.match(controller,/if\(current\?\.pending\)return current\.promise/);
assert.match(controller,/data-qw-option-retry/);
assert.match(controller,/submitPracticeAnswer\(record,key,\{retryPayload:current\.payload/);
assert.match(controller,/result\.correct\?'is-correct-flash':'is-wrong-flash'/);
assert.match(controller,/recordPracticeAttempt\(record,key,'',Boolean\(result\.correct\)\)/);
assert.match(controller,/作答尚未保存/);
assert.match(css,/\.qw-option-sync-error/);
assert.match(css,/\.qw-card-option-key\.is-answer-selected/);

console.log('multi-question-mistake-sync-ok');
