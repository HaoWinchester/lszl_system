'use strict';
const fs=require('fs');
const path=require('path');
const crypto=require('crypto');
const root=path.resolve(__dirname,'..');
const currentVersion=fs.readFileSync(path.join(root,'VERSION'),'utf8').trim();
if(currentVersion!=='v9.0-p3.2'){
  console.log('v90-p32-data-integrity-skipped-for',currentVersion);
  process.exit(0);
}
const manifest=JSON.parse(fs.readFileSync(path.join(root,'V9.0_P3.2_DATA_INTEGRITY.json'),'utf8'));
const hash=file=>crypto.createHash('sha256').update(fs.readFileSync(path.join(root,file))).digest('hex');
function assert(condition,message){if(!condition)throw new Error(message)}
assert(fs.readFileSync(path.join(root,'VERSION'),'utf8').trim()==='v9.0-p3.2','版本号应为 v9.0-p3.2');
assert(manifest.release==='v9.0-p3.2','发布清单版本号不正确');
assert(manifest.baseline==='v9.0-p2.2','开发基线必须保持 V9.0-P2.2');
assert(manifest.previousRelease==='v9.0-p3.1.1','直接开发基线应为 V9.0-P3.1.1');
const c=manifest.constraints||{};
assert(c.adminPrimaryNavigationCount===8&&c.adminPrimaryNavigationPosition==='top','后台一级导航必须保持八项顶部布局');
assert(c.subjectCreateEditReorder===true,'必须支持科目新增、编辑和排序');
assert(c.subjectDeactivateRestore===true,'必须支持科目停用和恢复');
assert(c.emptySubjectPermanentDelete===true,'空科目必须可以永久删除');
assert(c.usedSubjectDeleteBlocked===true,'有数据科目必须阻止永久删除');
assert(c.subjectWritesUseTransactions===true&&c.subjectWritesCreateSnapshots===true&&c.subjectWritesAudited===true,'科目写入必须受事务、快照和审计保护');
assert(c.currentTaxonomyDailyEditEnabled===false,'P3.2 不应提前开放 P3.3 当前知识树直接维护');
assert(c.p22SafeDeletionPreserved===true,'P2.2 知识树安全删除必须保留');
for(const [file,expected] of Object.entries(manifest.releaseFileSha256||{})){
  assert(fs.existsSync(path.join(root,file)),`${file} 不存在`);
  assert(hash(file)===expected,`${file} 与 V9.0-P3.2 发布清单不一致`);
}
console.log('v90-p32-data-integrity-ok',Object.keys(manifest.releaseFileSha256||{}).length);
