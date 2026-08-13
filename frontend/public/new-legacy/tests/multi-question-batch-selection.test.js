'use strict';

const assert=require('assert/strict');
const fs=require('fs');
const path=require('path');

const root=path.resolve(__dirname,'..');
const html=fs.readFileSync(path.join(root,'question-workspace.html'),'utf8');
const script=fs.readFileSync(path.join(root,'src/77-multi-question-workspace.js'),'utf8');
const css=fs.readFileSync(path.join(root,'styles/question-workspace.css'),'utf8');

assert.match(html,/id="qwQuestionSelectionMeta"/);
assert.match(html,/id="qwQuestionSelectionClear"/);
assert.match(script,/selectedQuestionKeys:new Set\(\)/);
assert.match(script,/function selectedQuestionItems\(\)/);
assert.match(script,/function batchDragPayload\(item\)/);
assert.match(script,/kind:'question-batch'/);
assert.match(script,/function batchQuestionPositions\(count,anchor/);
assert.match(script,/function addQuestionItems\(items,anchor/);
assert.match(script,/data-qw-question-select/);
assert.match(script,/state\.selectedQuestionKeys\.clear\(\)/);
assert.match(script,/pushWorkspaceHistory\('批量加入题目'/);
assert.match(css,/\.qw-question-select/);
assert.match(css,/\.qw-question-selection-bar/);

console.log('multi-question-batch-selection-ok');
