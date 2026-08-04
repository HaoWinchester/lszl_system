'use strict';
const fs=require('fs');
const path=require('path');
const vm=require('vm');
const assert=require('assert');
const ROOT=path.resolve(__dirname,'..');
const read=p=>fs.readFileSync(path.join(ROOT,p),'utf8');
const memory=new Map();
const localStorage={getItem:k=>memory.has(k)?memory.get(k):null,setItem:(k,v)=>memory.set(k,String(v)),removeItem:k=>memory.delete(k),key:i=>[...memory.keys()][i]||null,get length(){return memory.size}};
const activity={
  id:'activity-p33-linked',schemaVersion:1,type:'single_choice',
  content:{zh:{stem:'关联知识点的测试题',options:[{id:'A',text:'A'},{id:'B',text:'B'}],answer:'A'}},
  metadata:{subjectId:'subject-pmp',knowledge:{taxonomyId:'taxonomy-pmp-main',taxonomyVersion:1,primaryNodeId:'kp-pmp-rtm-bidirectional',relatedNodeIds:[],mappingStatus:'confirmed',pathSnapshot:[]},lifecycle:{status:'approved'}}
};
const window={localStorage,crypto:{randomUUID:()=>Math.random().toString(36).slice(2)},KGAuthCore:{currentUser:()=>({username:'admin-p33',displayName:'P3.3 测试管理员',role:'admin',status:'active'})},KGGuidedLearningData:{getActivityLibrary:()=>({[activity.id]:activity})}};window.window=window;
window.KGAppStorage={readJSON:(k,f)=>{try{return memory.has(k)?JSON.parse(memory.get(k)):JSON.parse(JSON.stringify(f))}catch(e){return f}},writeJSON:(k,v)=>{memory.set(k,JSON.stringify(v));return true},remove:k=>memory.delete(k),exists:k=>memory.has(k)};
const context={window,console,Date,Math,JSON,Set,Map,Object,Array,String,Number,Boolean,Error,TypeError};vm.createContext(context);
const load=p=>vm.runInContext(read(p),context,{filename:p});
['src/91-learning-content-core.js','src/admin/00-admin-core.js','src/admin/10-content-repository.js','src/admin/11-local-content-repository.js','src/admin/20-admin-permission-service.js','src/admin/21-admin-audit-service.js','src/admin/22-admin-transaction-service.js','src/admin/30-reference-index-service.js','src/admin/31-subject-service.js','src/admin/32-taxonomy-service.js'].forEach(load);
const W=context.window;
const repo=new W.KGLocalContentRepository({keys:W.KGLearningContent.storageKeys});
const permissions=new W.KGAdminPermissionService({auth:W.KGAuthCore});
const audit=new W.KGAdminAuditService(repo);
const transactions=new W.KGAdminTransactionService(repo,audit,permissions);
const references=new W.KGReferenceIndexService({content:W.KGLearningContent});
const service=new W.KGTaxonomyService({legacy:W.KGLearningContent,repository:repo,transactions,permissions,audit,references});

const current=service.currentForSubject('subject-pmp');
assert(current,'PMP current taxonomy should exist');
assert.equal(service.editMode(current),'current');
assert(service.canEdit(current),'current taxonomy should be editable');

const first=service.saveNode(current.id,{parentId:'kp-pmp-agile',title:{zh:'运营新增节点',en:'Operational Node'},description:{zh:'用于 P3.3 日常维护测试'},code:'PMP.AGILE.OPS',status:'active'});
assert(first.valid,JSON.stringify(first));
assert.equal(first.node.description.zh,'用于 P3.3 日常维护测试');
const firstId=first.node.id;

const edited=service.saveNode(current.id,{...first.node,title:{zh:'运营节点（已修改）',en:'Operational Node'},description:{zh:'说明已更新'}});
assert(edited.valid,JSON.stringify(edited));
assert.equal(edited.node.title.zh,'运营节点（已修改）');
assert.equal(edited.node.description.zh,'说明已更新');

const sibling=service.saveNode(current.id,{parentId:'kp-pmp-agile',title:{zh:'运营同级节点'},status:'active'});
assert(sibling.valid,JSON.stringify(sibling));
const beforeOrder=service.nodes(current.id,{includeDeprecated:true}).filter(n=>n.parentId==='kp-pmp-agile').map(n=>n.id);
const reordered=service.reorderNode(current.id,sibling.node.id,'up');
assert(reordered.valid,JSON.stringify(reordered));
const afterOrder=service.nodes(current.id,{includeDeprecated:true}).filter(n=>n.parentId==='kp-pmp-agile').map(n=>n.id);
assert.notDeepEqual(afterOrder,beforeOrder,'sibling order should change');

const moved=service.saveNode(current.id,{...edited.node,parentId:'kp-pmp-hybrid'});
assert(moved.valid,JSON.stringify(moved));
assert.equal(moved.node.parentId,'kp-pmp-hybrid');
assert.equal(moved.node.level,3);

let parentId='kp-pmp-rtm-bidirectional';
for(let level=7;level<=9;level++){
  const result=service.saveNode(current.id,{parentId,title:{zh:`第 ${level} 层运营节点`},status:'active'});
  assert(result.valid,JSON.stringify(result));
  assert.equal(result.node.level,level);
  parentId=result.node.id;
}
const tooDeep=service.saveNode(current.id,{parentId,title:{zh:'第 10 层错误节点'},status:'active'});
assert(!tooDeep.valid,'level 10 must be blocked');
assert((tooDeep.errors||[]).some(message=>message.includes('最多支持 9 层')));
const invalidStatus=service.saveNode(current.id,{...edited.node,status:'unknown'});
assert(!invalidStatus.valid,'unknown node status must be blocked');
assert((invalidStatus.errors||[]).some(message=>message.includes('启用或停用')));

const linkedCheck=service.nodeDeletionCheck(current.id,'kp-pmp-rtm-bidirectional');
assert(!linkedCheck.valid,'referenced node deletion must be blocked');
assert.equal(linkedCheck.usage.directActivityCount,1);
const linkedDeprecation=service.deprecateNode(current.id,'kp-pmp-rtm-bidirectional');
assert(!linkedDeprecation.valid,'node with active children must be handled before deactivation');

for(const nodeId of [parentId]){
  const result=service.deprecateNode(current.id,nodeId);
  assert(result.valid,JSON.stringify(result));
  const restored=service.restoreNode(current.id,nodeId);
  assert(restored.valid,JSON.stringify(restored));
  const deleted=service.deleteNode(current.id,nodeId);
  assert(deleted.valid,JSON.stringify(deleted));
}

const referencedLeaf=service.saveNode(current.id,{parentId:'kp-pmp-agile',id:'p33-referenced-leaf',title:{zh:'被题目引用的叶节点'},status:'active'});
assert(referencedLeaf.valid);
const library=W.KGLearningContent.getActivityLibrary();
library['activity-p33-linked'].metadata.knowledge.primaryNodeId='p33-referenced-leaf';
library['activity-p33-linked'].metadata.knowledge.taxonomyId=current.id;
assert(W.KGLearningContent.saveActivity(library['activity-p33-linked']).valid);
references.invalidate();
const protectedLeaf=service.nodeDeletionCheck(current.id,'p33-referenced-leaf');
assert(!protectedLeaf.valid);assert.equal(protectedLeaf.usage.directActivityCount,1);
const deactivated=service.deprecateNode(current.id,'p33-referenced-leaf');
assert(deactivated.valid,JSON.stringify(deactivated));
assert.equal(service.get(current.id).nodes.find(n=>n.id==='p33-referenced-leaf').status,'deprecated');
const restoredLeaf=service.restoreNode(current.id,'p33-referenced-leaf');
assert(restoredLeaf.valid);

const emptyLeaf=service.saveNode(current.id,{parentId:'kp-pmp-hybrid',title:{zh:'可删除空节点'},status:'active'});
assert(emptyLeaf.valid);
const emptyDelete=service.deleteNode(current.id,emptyLeaf.node.id);
assert(emptyDelete.valid,JSON.stringify(emptyDelete));

const imported=service.importVersion({id:'taxonomy-pmp-major',subjectId:'subject-pmp',name:{zh:'重大调整树'},nodes:[{id:'major-root',parentId:null,level:1,title:{zh:'重大调整'},status:'active'}]},{fileName:'major.json'});
assert(imported.valid);
const published=service.publish(imported.taxonomy.id);
assert(published.valid);
const historical=service.get(current.id);
assert.equal(service.editMode(historical),'');
assert(!service.saveNode(historical.id,{...historical.nodes[0],title:{zh:'历史版本不可修改'}}).valid,'historical published version must remain read-only');

const auditRows=audit.list();
const reorderAudit=auditRows.find(item=>item.action==='taxonomy.node.reorder');
assert(reorderAudit?.metadata?.before?.node?.id===sibling.node.id,'reorder audit should keep full before node');
assert(reorderAudit?.metadata?.after?.node?.id===sibling.node.id,'reorder audit should keep full after node');
const deleteAudit=auditRows.find(item=>item.action==='taxonomy.node.delete');
assert(Object.prototype.hasOwnProperty.call(deleteAudit?.metadata||{},'after')&&deleteAudit.metadata.after===null,'delete audit should explicitly record an empty after state');
const actions=auditRows.map(item=>item.action);
['taxonomy.node.create','taxonomy.node.update','taxonomy.node.reorder','taxonomy.node.deprecate','taxonomy.node.restore','taxonomy.node.delete'].forEach(action=>assert(actions.includes(action),`missing audit action ${action}`));
assert(transactions.snapshots().length>=10,'node writes should create lightweight recovery snapshots');
const taxonomySchema=JSON.parse(read('schemas/knowledge-taxonomy-schema-v1.json'));
assert.equal(taxonomySchema.properties.nodes.items.properties.level.maximum,9);
assert.equal(taxonomySchema.properties.maintenanceRevision.minimum,0);
assert(taxonomySchema.properties.nodes.items.properties.description,'node description schema is required');
assert(taxonomySchema.properties.nodes.items.properties.createdBy,'node actor metadata schema is required');
console.log('v90-p33-current-taxonomy-maintenance-ok');
