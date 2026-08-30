'use strict';
const fs=require('fs');
const path=require('path');
const vm=require('vm');
const assert=require('assert');
const ROOT=path.resolve(__dirname,'..');
const read=p=>fs.readFileSync(path.join(ROOT,p),'utf8');
const memory=new Map();
const localStorage={getItem:k=>memory.has(k)?memory.get(k):null,setItem:(k,v)=>memory.set(k,String(v)),removeItem:k=>memory.delete(k),key:i=>[...memory.keys()][i]||null,get length(){return memory.size}};
const window={localStorage,crypto:{randomUUID:()=>Math.random().toString(36).slice(2)},KGAuthCore:{currentUser:()=>({username:'teacher-1',displayName:'测试教师',role:'teacher'})}};
window.window=window;
const catalog={};const clone=value=>JSON.parse(JSON.stringify(value));
window.KGTeachingContentApi={readResource:(name,fallback)=>clone(catalog[name]??fallback),saveCatalogResource:async(name,rows)=>(catalog[name]=clone(rows)),saveSubjects:async rows=>(catalog.subjects=clone(rows)),saveTaxonomies:async rows=>(catalog.taxonomies=clone(rows)),saveActivityOverrides:async rows=>(catalog.activityOverrides=clone(rows)),saveCatalog:async patch=>{Object.entries(patch).forEach(([name,rows])=>catalog[name]=clone(rows));return clone(catalog)}};
window.KGAppStorage={readJSON:(k,f)=>{try{return memory.has(k)?JSON.parse(memory.get(k)):JSON.parse(JSON.stringify(f))}catch(e){return f}},writeJSON:(k,v)=>{memory.set(k,JSON.stringify(v));return true},remove:k=>memory.delete(k),exists:k=>memory.has(k)};
const context={window,console,Date,Math,JSON,Set,Map,Object,Array,String,Number,Boolean,Error,TypeError};vm.createContext(context);
const load=p=>vm.runInContext(read(p),context,{filename:p});
[
  'src/admin/00-admin-core.js','src/admin/10-content-repository.js','src/admin/11-local-content-repository.js','src/admin/20-admin-permission-service.js','src/admin/21-admin-audit-service.js','src/admin/22-admin-transaction-service.js','src/admin/30-reference-index-service.js','src/admin/31-subject-service.js','src/admin/32-taxonomy-service.js'
].forEach(load);
const W=context.window;
const repo=new W.KGLocalContentRepository();
assert(W.KGContentRepository.contract(repo).valid,'repository contract should pass');
const permissions=new W.KGAdminPermissionService({auth:W.KGAuthCore});
assert(permissions.can('importTaxonomies'),'teacher should import taxonomy versions');
assert(!permissions.can('editSubjects'),'teacher should not edit subjects');
const audit=new W.KGAdminAuditService(repo);const tx=new W.KGAdminTransactionService(repo,audit,permissions);

(async()=>{
await repo.write('subjects',[{id:'original'}]);
assert.equal(repo.read('subjects',[])[0].id,'original','teaching resources must persist through the typed API');
const failed=tx.execute({name:'retired-sync-transaction'});
assert(!failed.valid,'synchronous browser transactions must be retired');
assert.deepEqual(tx.snapshots(),[],'generic browser snapshots must not be exposed');
const auditRecord=audit.record({action:'taxonomy.test',status:'failed'});
assert.equal(auditRecord.persisted,false,'unsupported browser audit writes must be explicit');
assert.equal(auditRecord.persistenceStatus,'unsupported');
assert.deepEqual(audit.list(),[],'unsupported audit writes must not claim durable history');

let taxonomies=[];
const subjects=[{id:'subject-new',code:'NEW',name:{zh:'新科目'}}];
catalog.subjects=clone(subjects);catalog.taxonomies=[];
const legacy={
  getSubjects:()=>JSON.parse(JSON.stringify(subjects)),subjectById:id=>subjects.find(item=>item.id===id)||null,
  getTaxonomies:subjectId=>JSON.parse(JSON.stringify(subjectId?taxonomies.filter(item=>item.subjectId===subjectId):taxonomies)),taxonomyById:id=>JSON.parse(JSON.stringify(taxonomies.find(item=>item.id===id)||null)),defaultTaxonomyForSubject:id=>taxonomies.find(item=>item.subjectId===id&&item.isDefault)||null,
  nodesForTaxonomy:id=>(taxonomies.find(item=>item.id===id)?.nodes||[]),validateTaxonomy:taxonomy=>{const ids=new Set();const errors=[];(taxonomy.nodes||[]).forEach(node=>{if(ids.has(node.id))errors.push('duplicate');ids.add(node.id);if(node.parentId&&!taxonomy.nodes.some(parent=>parent.id===node.parentId))errors.push('missing parent')});return {valid:!errors.length,errors,warnings:[]}},
  saveTaxonomies:rows=>{taxonomies=JSON.parse(JSON.stringify(rows));return {valid:true,taxonomies}},saveKnowledgeNode:()=>({valid:true}),deprecateKnowledgeNode:()=>({valid:true}),deleteKnowledgeNode:()=>({valid:true})
};
const refs={invalidate(){this.invalidated=true}};
const service=new W.KGTaxonomyService({legacy,repository:repo,transactions:tx,permissions,audit,references:refs});
const payload={id:'taxonomy-new',subjectId:'subject-new',name:{zh:'基础知识树'},nodes:[{id:'root',parentId:null,level:1,title:{zh:'根节点'}}]};
const first=await service.importVersion(payload,{fileName:'first.json'});
assert(first.valid,'first import should pass');assert.equal(first.taxonomy.version,1);assert.equal(first.taxonomy.versionLabel,'v1.0');assert.equal(taxonomies.length,1);
const second=await service.importVersion(payload,{fileName:'second.json'});
assert(second.valid,'second import should pass');assert.equal(second.taxonomy.version,2);assert.equal(second.taxonomy.versionLabel,'v2.0');assert.equal(taxonomies.length,2,'old taxonomy must remain');assert.notEqual(taxonomies[0].id,taxonomies[1].id,'taxonomy versions need unique ids');
assert.equal(service.importRecords().length,2,'import records should be derived from persisted taxonomy rows');
assert(service.importRecords().every(item=>item.derivedFromTaxonomy===true));

assert(/^v9\.0-(?:p3\.3\.(?:3(?:\.\d+)?|4|5)|p3\.4|p3\.5(?:\.[12345678])?|p4\.0(?:\.[123])?|p4\.1(?:\.\d+)?)$/.test(read('VERSION').trim()));
assert(read('admin-console.html').includes('src/admin/40-admin-service-registry.js'));
assert(read('content-center.html').includes('src/admin/41-learning-content-compat.js'));
assert(read('course-admin.html').includes('admin-console.html'));
assert(read('teacher-workbench.html').includes('admin-console.html'));
console.log('v90-p0-admin-foundation-ok');
})().catch(error=>{console.error(error);process.exitCode=1});
