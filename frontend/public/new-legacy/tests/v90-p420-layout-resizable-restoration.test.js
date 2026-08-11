'use strict';
const assert=require('assert/strict');
const fs=require('fs');
const path=require('path');
const ROOT=path.resolve(__dirname,'..');
const read=file=>fs.readFileSync(path.join(ROOT,file),'utf8');

for(const file of ['graph-model.js','graph-renderer.js','viewport-controller.js','selection-controller.js','drag-controller.js','connection-controller.js','history-controller.js','clipboard-controller.js','style-controller.js','graph-persistence.js']){
  assert(fs.existsSync(path.join(ROOT,'src/graph',file)),`graph kernel missing ${file}`);
}
const shared=read('src/admin/resizable-region.js');
for(const token of ['KGResizableRegion','data-kg-resizable-region','pointerdown','ArrowUp','ArrowDown','dblclick','kg_ui_resizable_region_v1__']) assert(shared.includes(token),`resizable module missing ${token}`);
const pages={
  'paper-management.html':['data-kg-resizable-key="paper-library"'],
  'feedback-management.html':['data-kg-resizable-key="feedback-workspace"'],
  'message-management.html':['data-kg-resizable-key="message-workspace"'],
  'user-management.html':['data-kg-resizable-key="user-list"','data-kg-resizable-key="user-operation-log"'],
  'system-settings.html':['data-kg-resizable-key="system-operation-log"'],
  'admin-operations.html':['data-kg-resizable-key="admin-audit-list"','data-kg-resizable-key="taxonomy-lifecycle-list"'],
  'admin-subjects.html':['data-kg-resizable-key="recall-import-history"','data-kg-resizable-key="recall-release-history"']
};
for(const [page,tokens] of Object.entries(pages)){
  const html=read(page);
  assert(html.includes('styles/resizable-region.css'),`${page} missing shared css`);
  assert(html.includes('src/admin/resizable-region.js'),`${page} missing shared js`);
  tokens.forEach(token=>assert(html.includes(token),`${page} missing ${token}`));
}
const workflow=read('src/97-teacher-question-workflow.js');
for(const token of ['trainingWorkspaceLeftHeight=880','trainingPreviewHeight=380','initTrainingHeightSplitters','tqTrainingWorkspaceHeightSplitter','tqTrainingPreviewSplitter','tq-training-option ${item.id===correct?\'correct\':\'\'}','tq-training-analysis','questionAnalysisInput']) assert(workflow.includes(token),`training workflow missing ${token}`);
assert(!workflow.slice(workflow.indexOf('function installTrainingPreview()'),workflow.indexOf('function configureSimple()')).includes('tq-training-answer'),'standalone answer panel should remain removed');
const css=read('styles/teacher-question-workflow.css');
for(const token of ['--tq-training-left-height','--tq-training-preview-height','.tq-training-workspace-height-splitter','.tq-training-preview-splitter','.tq-training-option.correct','.tq-training-analysis p']) assert(css.includes(token),`training css missing ${token}`);
assert(read('styles/paper-management.css').includes('height:480px;min-height:340px'));
assert(read('styles/engagement-admin.css').includes('.engagement-admin-main{display:grid;gap:20px}'));
console.log('v90-p420-layout-resizable-restoration-ok');
