'use strict';
const fs=require('fs');
const path=require('path');
const crypto=require('crypto');
const assert=require('assert');
const ROOT=path.resolve(__dirname,'..');
const currentVersion=fs.readFileSync(path.join(ROOT,'VERSION'),'utf8').trim();
if(currentVersion!=='v9.0-p3.3.1'){
  console.log('v90-p331-data-integrity-skipped-for',currentVersion);
  process.exit(0);
}
const manifest=JSON.parse(fs.readFileSync(path.join(ROOT,'V9.0_P3.3.1_DATA_INTEGRITY.json'),'utf8'));
const read=file=>fs.readFileSync(path.join(ROOT,file),'utf8');
const hash=file=>crypto.createHash('sha256').update(fs.readFileSync(path.join(ROOT,file))).digest('hex');

assert.equal(manifest.release,'v9.0-p3.3.1');
assert.equal(manifest.baseline,'v9.0-p2.2');
assert.equal(manifest.previousRelease,'v9.0-p3.3');
const c=manifest.constraints||{};
assert.equal(c.adminPrimaryNavigationCount,8);
assert.equal(c.adminPrimaryNavigationPosition,'top');
assert.equal(c.teacherWorkbenchShowsAdminTopNavigation,true);
assert.equal(c.teacherWorkbenchOverviewVisible,true);
assert.equal(c.teacherWorkflowPrimaryTabCount,4);
assert.equal(c.duplicateTeacherAdminEntryRemoved,true);
assert.equal(c.teacherAdminTopNavigationSticky,true);
assert.equal(c.teacherToolbarDoesNotCoverAdminNavigation,true);
assert.equal(c.generalAdminLayoutUnchanged,true);
assert.equal(c.p33CurrentTaxonomyMaintenancePreserved,true);
assert.equal(c.p34QuestionBulkMoveNotImplemented,true);

for(const [file,expected] of Object.entries(manifest.releaseFileSha256||{})){
  assert(fs.existsSync(path.join(ROOT,file)),`${file} 不存在`);
  assert.equal(hash(file),expected,`${file} 与 V9.0-P3.3.1 发布清单不一致`);
}

const workbench=read('teacher-workbench.html');
const course=read('course-admin.html');
const question=read('question-bank.html');
for(const [file,html] of [['teacher-workbench.html',workbench],['question-bank.html',question],['course-admin.html',course]]){
  const tabs=html.match(/<nav class="tw-tabs"[\s\S]*?<\/nav>/);
  assert(tabs,`${file} 缺少教师主导航`);
  assert.equal((tabs[0].match(/<a\b/g)||[]).length,4,`${file} 教师主导航数量不正确`);
  assert(!/>管理端<\/a>/.test(tabs[0]),`${file} 仍有重复管理端入口`);
}
assert(workbench.includes('class="teacher-admin-shell" data-admin-context="overview"'));
assert((workbench.match(/data-admin-nav=/g)||[]).length===8);
const css=read('styles/admin-context-nav.css');
assert(css.includes('body.teacher-admin-shell>.admin-context-nav{position:sticky;top:0;z-index:80}'));
assert(css.includes('body.teacher-admin-shell>.tw-topbar{top:42px}'));
assert(css.includes('body.teacher-admin-shell>.ca-app .tw-topbar{top:42px}'));
const taxonomyService=read('src/admin/32-taxonomy-service.js');
assert(taxonomyService.includes("if(item.status==='published'&&this.isCurrent(item))return 'current'"),'P3.3 当前知识树维护能力丢失');
console.log('v90-p331-data-integrity-ok',Object.keys(manifest.releaseFileSha256||{}).length);
