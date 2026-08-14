'use strict';

const assert=require('assert/strict');
const fs=require('fs');
const path=require('path');

const root=path.resolve(__dirname,'..');
const read=file=>fs.readFileSync(path.join(root,file),'utf8');
const html=read('question-workspace.html');
const controller=read('src/108-multi-question-learning-assets.js');
const workspace=read('src/77-multi-question-workspace.js');

for(const id of [
  'qwPersonalCardsBtn','qwPersonalCardsCount','qwMistakesBtn','qwMistakesCount',
  'qwPersonalCardsDrawer','qwPersonalCardsSearch','qwPersonalCardsList','qwPersonalCardsRetry','qwPersonalCardsClose',
  'qwMistakesDrawer','qwMistakesSearch','qwMistakesList','qwMistakesRetry','qwMistakesClose',
  'qwPersonalCardEditor','qwPersonalCardEditorSave','qwPersonalCardConflictReload','qwLearningAssetsBackdrop'
])assert.match(html,new RegExp(`id="${id}"`),`${id} is required`);

assert.match(html,/data-personal-card-filter="active"/);
assert.match(html,/data-personal-card-filter="archived"/);
assert.match(html,/data-mistake-filter="active"/);
assert.match(html,/data-mistake-filter="mastered"/);
assert.match(controller,/KGPersonalSynthesisCardApi/);
assert.match(controller,/KGPracticeLearningApi/);
assert.match(controller,/insertPersonalCard/);
assert.match(controller,/addQuestionByReference/);
assert.match(controller,/data-card-action="edit"/);
assert.match(controller,/data-card-action="archive"/);
assert.match(controller,/data-card-action="restore"/);
assert.match(controller,/重新加载最新版本/);
assert.match(controller,/event\.key==='Escape'/);
assert.match(workspace,/function addQuestionByReference\(reference/);

console.log('multi-question-learning-assets-ok');
