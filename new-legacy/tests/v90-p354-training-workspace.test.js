'use strict';
const fs=require('fs');
const path=require('path');
const assert=require('assert/strict');
const ROOT=path.resolve(__dirname,'..');
const read=file=>fs.readFileSync(path.join(ROOT,file),'utf8');
assert.equal(read('VERSION').trim(),'v9.0-p4.1.1');
assert(read('src/admin/00-admin-core.js').includes("VERSION='9.0-p4.1.1'"));
const page=read('question-bank.html');
for(const id of ['qbTrainingBankField','qbTrainingBankSelect','tqTrainingWorkspaceSplitter']){
  assert(page.includes(`id="${id}"`),`question-bank missing ${id}`);
}
const admin=read('src/65-question-bank-admin.js');
for(const token of ['renderTrainingBankSelect','questionRowActionIcon','questionActionButton','qb-question-icon-action','kg-training-workspace-resized']){
  assert(admin.includes(token),`question-bank admin missing ${token}`);
}
const workflow=read('src/97-teacher-question-workflow.js');
for(const token of ['TRAINING_WORKSPACE_LAYOUT_KEY','initTrainingWorkspaceSplitter','applyTrainingWorkspaceRatio','persistTrainingWorkspaceRatio']){
  assert(workflow.includes(token),`teacher workflow missing ${token}`);
}
const workflowCss=read('styles/teacher-question-workflow.css');
for(const token of ['.qb-training-bank-selector','.tq-training-workspace-splitter','#qbQuestionList','min-height:280px']){
  assert(workflowCss.includes(token),`teacher workflow css missing ${token}`);
}
const adminCss=read('styles/question-bank-admin.css');
for(const token of ['.qb-question-icon-action','.qb-question-icon-action svg']){
  assert(adminCss.includes(token),`question bank css missing ${token}`);
}
console.log('v90-p354-training-workspace-static-ok');
