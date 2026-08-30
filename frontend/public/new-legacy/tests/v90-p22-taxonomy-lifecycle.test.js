'use strict';
const fs=require('fs');
const path=require('path');
const vm=require('vm');
const assert=require('assert');
const ROOT=path.resolve(__dirname,'..');
const read=p=>fs.readFileSync(path.join(ROOT,p),'utf8');
const memory=new Map();
const localStorage={getItem:k=>memory.has(k)?memory.get(k):null,setItem:(k,v)=>memory.set(k,String(v)),removeItem:k=>memory.delete(k),key:i=>[...memory.keys()][i]||null,get length(){return memory.size}};
let role='teacher';
const window={localStorage,crypto:{randomUUID:()=>Math.random().toString(36).slice(2)},KGAuthCore:{currentUser:()=>({username:'user-1',displayName:'测试用户',role,status:'active'})}};
window.window=window;
const catalog={};const clone=value=>JSON.parse(JSON.stringify(value));
window.KGTeachingContentApi={readResource:(name,fallback)=>clone(catalog[name]??fallback),saveCatalogResource:async(name,rows)=>(catalog[name]=clone(rows)),saveSubjects:async rows=>(catalog.subjects=clone(rows)),saveTaxonomies:async rows=>(catalog.taxonomies=clone(rows)),saveActivityOverrides:async rows=>(catalog.activityOverrides=clone(rows)),saveCatalog:async patch=>{Object.entries(patch).forEach(([name,rows])=>catalog[name]=clone(rows));return clone(catalog)}};
window.KGAppStorage={readJSON:(k,f)=>{try{return memory.has(k)?JSON.parse(memory.get(k)):JSON.parse(JSON.stringify(f))}catch(e){return f}},writeJSON:(k,v)=>{memory.set(k,JSON.stringify(v));return true},remove:k=>memory.delete(k),exists:k=>memory.has(k)};
const context={window,console,Date,Math,JSON,Set,Map,Object,Array,String,Number,Boolean,Error,TypeError};
vm.createContext(context);
const load=p=>vm.runInContext(read(p),context,{filename:p});
[
  'src/86-activity-schema-v1.js','src/87-guided-learning-data.js','src/91-learning-content-core.js',
  'src/admin/00-admin-core.js','src/admin/10-content-repository.js','src/admin/11-local-content-repository.js','src/admin/20-admin-permission-service.js','src/admin/21-admin-audit-service.js','src/admin/22-admin-transaction-service.js','src/admin/30-reference-index-service.js','src/admin/31-subject-service.js','src/admin/32-taxonomy-service.js'
].forEach(load);
const W=context.window;
const repo=new W.KGLocalContentRepository({keys:W.KGLearningContent.storageKeys});
const permissions=new W.KGAdminPermissionService({auth:W.KGAuthCore});
const audit=new W.KGAdminAuditService(repo);
const transactions=new W.KGAdminTransactionService(repo,audit,permissions);
const references=new W.KGReferenceIndexService({content:W.KGLearningContent});
const service=new W.KGTaxonomyService({legacy:W.KGLearningContent,repository:repo,transactions,permissions,audit,references});

(async()=>{
const payload={id:'taxonomy-lifecycle',subjectId:'subject-pmp',name:{zh:'生命周期测试树'},nodes:[{id:'life-root',parentId:null,level:1,title:{zh:'根节点'},status:'active'}]};
const teacherDraft=await service.importVersion(payload,{fileName:'teacher-draft.json'});
assert(teacherDraft.valid,JSON.stringify(teacherDraft));
const denied=await service.deleteVersion(teacherDraft.taxonomy.id);
assert(!denied.valid,'teacher must not delete taxonomy versions');
assert((denied.errors||[]).some(message=>message.includes('权限')));

role='admin';
const removedDraft=await service.deleteVersion(teacherDraft.taxonomy.id);
assert(removedDraft.valid,JSON.stringify(removedDraft));
assert(!service.get(teacherDraft.taxonomy.id),'draft should be removed');
assert.equal(service.deletionRecords()[0].previousStatus,'draft');

const v2=await service.importVersion(payload,{fileName:'v2.json'});
assert(v2.valid,JSON.stringify(v2));
assert((await service.publish(v2.taxonomy.id,{notes:'publish v2'})).valid);
const v3=await service.createDraftFrom(v2.taxonomy.id);
assert(v3.valid,JSON.stringify(v3));
assert((await service.publish(v3.taxonomy.id,{notes:'publish v3'})).valid);
assert.equal(service.currentForSubject('subject-pmp').id,v3.taxonomy.id);

const currentDelete=await service.deleteVersion(v3.taxonomy.id);
assert(!currentDelete.valid,'current taxonomy must not be deleted');
assert((currentDelete.errors||[]).some(message=>message.includes('当前')));

const directPublishedDelete=await service.deleteVersion(v2.taxonomy.id);
assert(!directPublishedDelete.valid,'historical published taxonomy requires archive first');
assert(directPublishedDelete.requiresArchive===true);
const archived=await service.archive(v2.taxonomy.id,{notes:'old version'});
assert(archived.valid,JSON.stringify(archived));
assert.equal(service.get(v2.taxonomy.id).status,'archived');
const restored=await service.restoreArchived(v2.taxonomy.id);
assert(restored.valid,JSON.stringify(restored));
assert.equal(service.get(v2.taxonomy.id).status,'published');
assert.equal(service.currentForSubject('subject-pmp').id,v3.taxonomy.id,'restore must not change current');
assert((await service.archive(v2.taxonomy.id)).valid);

const activity=W.KGLearningContent.getActivities()[0];
const mapped=await W.KGLearningContent.mapActivities([activity.id],{taxonomyId:v2.taxonomy.id,primaryNodeId:'life-root',relatedNodeIds:[]});
assert(mapped.valid,JSON.stringify(mapped));
references.invalidate();
const blocked=await service.deleteVersion(v2.taxonomy.id);
assert(!blocked.valid,'referenced archived taxonomy must not be deleted');
assert(blocked.referenceCount>=1);
assert(blocked.references.some(item=>item.kind==='activity'));

const remapped=await W.KGLearningContent.mapActivities([activity.id],{taxonomyId:v3.taxonomy.id,primaryNodeId:'life-root',relatedNodeIds:[]});
assert(remapped.valid,JSON.stringify(remapped));
references.invalidate();
const deleted=await service.deleteVersion(v2.taxonomy.id,{notes:'no longer used'});
assert(deleted.valid,JSON.stringify(deleted));
assert(!service.get(v2.taxonomy.id));
assert.equal(service.deletionRecords()[0].taxonomyId,v2.taxonomy.id);
assert(service.releaseRecords().some(item=>item.action==='archive'));
assert(service.releaseRecords().some(item=>item.action==='restore'));
assert(transactions.snapshots().length>=1,'lifecycle operations should create snapshots');
assert(/^v9\.0-(?:p3\.3\.(?:3(?:\.\d+)?|4|5)|p3\.4|p3\.5(?:\.[12345678])?|p4\.0(?:\.[123])?|p4\.1(?:\.\d+)?)$/.test(read('VERSION').trim()));
console.log('v90-p22-taxonomy-lifecycle-ok');
})().catch(error=>{console.error(error);process.exitCode=1});
