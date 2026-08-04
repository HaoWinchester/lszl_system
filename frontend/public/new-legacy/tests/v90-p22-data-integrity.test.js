'use strict';
const fs=require('fs');
const path=require('path');
const crypto=require('crypto');
const root=path.resolve(__dirname,'..');
const currentVersion=fs.readFileSync(path.join(root,'VERSION'),'utf8').trim();
if(currentVersion!=='v9.0-p2.2'){console.log('v90-p22-data-integrity-skipped-for',currentVersion);process.exit(0)}
const manifest=JSON.parse(fs.readFileSync(path.join(root,'V9.0_P2.2_DATA_INTEGRITY.json'),'utf8'));
const hash=file=>crypto.createHash('sha256').update(fs.readFileSync(path.join(root,file))).digest('hex');
function assert(condition,message){if(!condition)throw new Error(message)}
assert(fs.readFileSync(path.join(root,'VERSION'),'utf8').trim()==='v9.0-p2.2','版本号应为 v9.0-p2.2');
assert(manifest.release==='v9.0-p2.2','发布清单版本号不正确');
assert(manifest.constraints?.knowledgeTreeMaxDepth===9,'知识树最大层级应为 9');
assert(manifest.constraints?.oneCurrentTaxonomyPerSubject===true,'每个科目只能有一个当前知识树');
assert(manifest.constraints?.multiplePublishedHistoryAllowed===true,'应允许保留多个历史已发布版本');
assert(manifest.constraints?.currentTaxonomyDeleteBlocked===true,'当前知识树删除必须被阻止');
assert(manifest.constraints?.publishedArchiveBeforeDelete===true,'历史已发布版本必须先归档');
assert(manifest.constraints?.directReferenceBlocksDelete===true,'存在直接引用时必须阻止删除');
assert(manifest.constraints?.taxonomyDeleteAdminOnly===true,'归档与删除必须仅限管理员');
for(const [file,expected] of Object.entries(manifest.releaseFileSha256||{})){
  assert(fs.existsSync(path.join(root,file)),`${file} 不存在`);
  assert(hash(file)===expected,`${file} 与 V9.0-P2.2 发布清单不一致`);
}
const app=fs.readFileSync(path.join(root,'src/admin/50-admin-shell-app.js'),'utf8');
assert(app.includes('data-archive-taxonomy')&&app.includes('data-delete-taxonomy'),'管理端应提供归档与删除操作');
const service=fs.readFileSync(path.join(root,'src/admin/32-taxonomy-service.js'),'utf8');
assert(service.includes('deletionCheck(')&&service.includes('restoreArchived(')&&service.includes('taxonomyDeletions'),'知识树服务应提供安全删除生命周期');
console.log('v90-p22-data-integrity-ok',Object.keys(manifest.releaseFileSha256||{}).length);
