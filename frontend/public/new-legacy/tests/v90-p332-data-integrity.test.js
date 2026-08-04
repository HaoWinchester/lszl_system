'use strict';
const fs=require('fs');
const path=require('path');
const crypto=require('crypto');
const assert=require('assert');
const ROOT=path.resolve(__dirname,'..');
const currentVersion=fs.readFileSync(path.join(ROOT,'VERSION'),'utf8').trim();
if(currentVersion!=='v9.0-p3.3.2'){
  console.log('v90-p332-data-integrity-skipped-for',currentVersion);
  process.exit(0);
}
const manifest=JSON.parse(fs.readFileSync(path.join(ROOT,'V9.0_P3.3.2_DATA_INTEGRITY.json'),'utf8'));
const read=file=>fs.readFileSync(path.join(ROOT,file),'utf8');
const hash=file=>crypto.createHash('sha256').update(fs.readFileSync(path.join(ROOT,file))).digest('hex');

assert.equal(manifest.release,'v9.0-p3.3.2');
assert.equal(manifest.baseline,'v9.0-p2.2');
assert.equal(manifest.previousRelease,'v9.0-p3.3.1');
const c=manifest.constraints||{};
assert.equal(c.adminPrimaryNavigationCount,8);
assert.equal(c.adminPrimaryNavigationPosition,'top');
assert.equal(c.questionManagementWorkspaceTabCount,2);
assert.equal(c.questionEntryEmbeddedInQuestionManagement,true);
assert.equal(c.currentTaxonomyEmbeddedInSubjectsPage,true);
assert.equal(c.legacyQuestionStudioRedirectPreserved,true);
assert.equal(c.legacyContentCenterRedirectPreserved,true);
assert.equal(c.legacyStandaloneCompatibilityPreserved,true);
assert.equal(c.duplicateBusinessImplementationsCreated,false);
assert.equal(c.p33CurrentTaxonomyMaintenancePreserved,true);
assert.equal(c.knowledgeTreeMaxDepth,9);
assert.equal(c.studentKnowledgeTreeHidden,true);
assert.equal(c.p34QuestionBulkMoveNotImplemented,true);

for(const [file,expected] of Object.entries(manifest.releaseFileSha256||{})){
  assert(fs.existsSync(path.join(ROOT,file)),`${file} 不存在`);
  assert.equal(hash(file),expected,`${file} 与 V9.0-P3.3.2 发布清单不一致`);
}

const questions=read('question-bank.html');
assert.equal((questions.match(/data-question-workspace="/g)||[]).length,2);
assert(questions.includes('question-studio/index.html?embed=entry'));
const subjects=read('admin-subjects.html');
assert(subjects.includes('id="adminCurrentTreeFrame"'));
assert.equal((subjects.match(/data-admin-nav=/g)||[]).length,8);
const placement=read('styles/workspace-placement.css');
assert(placement.includes('data-embed-mode="knowledge"'));
assert(placement.includes('.cc-library-panel'));
const taxonomyService=read('src/admin/32-taxonomy-service.js');
assert(taxonomyService.includes("if(item.status==='published'&&this.isCurrent(item))return 'current'"),'P3.3 当前知识树维护能力丢失');
console.log('v90-p332-data-integrity-ok',Object.keys(manifest.releaseFileSha256||{}).length);
