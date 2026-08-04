'use strict';
const fs=require('fs');
const path=require('path');
const assert=require('assert/strict');
const ROOT=path.resolve(__dirname,'..');
const read=file=>fs.readFileSync(path.join(ROOT,file),'utf8');
assert.equal(read('VERSION').trim(),'v9.0-p4.1.1');
assert(read('src/admin/00-admin-core.js').includes("VERSION='9.0-p4.1.1'"));
const page=read('question-bank.html');
for(const id of ['qbLibraryWorkbench','qbLibrarySplitter','qbBankPaneBody','qbQuestionPaneBody','qbLibraryQuestionPreviewPopover','qbLibraryQuestionPreviewTitle','qbLibraryQuestionPreviewMeta','qbLibraryQuestionPreviewContent','qbLibraryQuestionPreviewEditBtn','qbLibraryQuestionPreviewCloseBtn']){
  assert(page.includes(`id="${id}"`),`question-bank missing ${id}`);
}
assert(page.includes('data-library-pane-action="maximize"'));
assert(page.includes('data-library-pane-action="collapse"'));
const script=read('src/65-question-bank-admin.js');
for(const token of ['QUESTION_LIBRARY_WORKSPACE_LAYOUT_KEY','initLibraryWorkspaceControls','applyLibraryPaneRatio','setLibraryWorkspaceMode','openLibraryQuestionPreview','positionLibraryQuestionPreview','bindLibraryQuestionPreviewRow','editLibraryQuestionFromPreview','data-library-question-preview']){
  assert(script.includes(token),`question-bank script missing ${token}`);
}
const css=read('styles/question-bank-admin.css');
for(const token of ['.qb-management-splitter','.qb-library-question-preview-popover','.qb-library-question-preview-arrow','.qb-question-row.library-preview-active','#qbLibraryWorkbench #qbQuestionTabPanel #qbQuestionList']){
  assert(css.includes(token),`question-bank css missing ${token}`);
}
console.log('v90-p353-question-bank-workspace-static-ok');
