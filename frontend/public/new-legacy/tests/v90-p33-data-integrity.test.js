'use strict';
const fs=require('fs');
const path=require('path');
const crypto=require('crypto');
const root=path.resolve(__dirname,'..');
const currentVersion=fs.readFileSync(path.join(root,'VERSION'),'utf8').trim();
if(currentVersion!=='v9.0-p3.3'){
  console.log('v90-p33-data-integrity-skipped-for',currentVersion);
  process.exit(0);
}
const manifest=JSON.parse(fs.readFileSync(path.join(root,'V9.0_P3.3_DATA_INTEGRITY.json'),'utf8'));
const hash=file=>crypto.createHash('sha256').update(fs.readFileSync(path.join(root,file))).digest('hex');
function assert(condition,message){if(!condition)throw new Error(message)}
assert(fs.readFileSync(path.join(root,'VERSION'),'utf8').trim()==='v9.0-p3.3','版本号应为 v9.0-p3.3');
assert(manifest.release==='v9.0-p3.3','发布清单版本号不正确');
assert(manifest.baseline==='v9.0-p2.2','长期开发基线必须保持 V9.0-P2.2');
assert(manifest.previousRelease==='v9.0-p3.2','直接开发基线应为 V9.0-P3.2');
const c=manifest.constraints||{};
assert(c.adminPrimaryNavigationCount===8&&c.adminPrimaryNavigationPosition==='top','后台一级导航必须保持八项顶部布局');
assert(c.currentTaxonomyDailyEditEnabled===true,'P3.3 必须开放当前知识树日常维护');
assert(c.currentTaxonomyEditDoesNotRequireRepublish===true,'当前知识树日常修改不得要求重新发布');
assert(c.draftTaxonomyEditable===true&&c.historicalPublishedReadOnly===true&&c.archivedTaxonomyReadOnly===true,'知识树版本编辑边界不正确');
assert(c.knowledgeTreeMaxDepth===9&&c.levelTenBlocked===true,'知识树必须继续限制为最多 9 层');
assert(c.nodeCreateEditMoveReorder===true&&c.nodeDeactivateRestore===true,'节点日常维护能力不完整');
assert(c.nodeWithChildrenDeleteBlocked===true&&c.nodeWithQuestionsDeleteBlocked===true&&c.emptyLeafDeleteAllowed===true,'节点安全删除规则不完整');
assert(c.currentNodeWritesUseTransactions===true&&c.currentNodeWritesCreateSnapshots===true&&c.currentNodeWritesAudited===true,'当前知识树写入必须受事务、恢复点和审计保护');
assert(c.paperStoresStableQuestionIds===true&&c.existingPaperUnaffectedByTaxonomyMove===true,'试卷与知识树必须保持解耦');
assert(c.studentKnowledgeTreeHidden===true,'学员端不得展示知识树');
assert(c.p32SubjectManagementPreserved===true&&c.p22SafeDeletionPreserved===true,'既有科目管理和历史版本安全删除必须保留');
for(const [file,expected] of Object.entries(manifest.releaseFileSha256||{})){
  assert(fs.existsSync(path.join(root,file)),`${file} 不存在`);
  assert(hash(file)===expected,`${file} 与 V9.0-P3.3 发布清单不一致`);
}
const service=fs.readFileSync(path.join(root,'src/admin/32-taxonomy-service.js'),'utf8');
assert(service.includes("if(item.status==='published'&&this.isCurrent(item))return 'current'"),'当前知识树编辑模式实现缺失');
assert(service.includes("只有当前知识树或草稿可以编辑"),'历史版本只读保护缺失');
const app=fs.readFileSync(path.join(root,'src/91-content-center-app.js'),'utf8');
assert(app.includes('当前知识树 · 运营维护模式'),'内容中心缺少当前知识树维护提示');
assert(app.includes('重大调整草稿模式'),'内容中心缺少草稿模式提示');
const schema=JSON.parse(fs.readFileSync(path.join(root,'schemas/knowledge-taxonomy-schema-v1.json'),'utf8'));
assert(schema.properties.maxDepth.maximum===9,'Schema 最大层级必须为 9');
assert(schema.properties.nodes.items.properties.description,'Schema 必须包含知识点说明');
assert(schema.properties.maintenanceRevision.minimum===0,'Schema 必须包含维护修订号');
console.log('v90-p33-data-integrity-ok',Object.keys(manifest.releaseFileSha256||{}).length);
