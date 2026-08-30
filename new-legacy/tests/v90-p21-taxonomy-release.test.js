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
const context={window,console,Date,Math,JSON,Set,Map,Object,Array,String,Number,Boolean,Error,TypeError};vm.createContext(context);
const load=p=>vm.runInContext(read(p),context,{filename:p});
[
  'src/91-learning-content-core.js',
  'src/admin/00-admin-core.js','src/admin/10-content-repository.js','src/admin/11-local-content-repository.js','src/admin/20-admin-permission-service.js','src/admin/21-admin-audit-service.js','src/admin/22-admin-transaction-service.js','src/admin/30-reference-index-service.js','src/admin/31-subject-service.js','src/admin/32-taxonomy-service.js'
].forEach(load);
const W=context.window;
assert.equal(W.KGLearningContent.MAX_DEPTH,9,'knowledge-tree max depth should be 9');
const repo=new W.KGLocalContentRepository({keys:W.KGLearningContent.storageKeys});
const permissions=new W.KGAdminPermissionService({auth:W.KGAuthCore});
const audit=new W.KGAdminAuditService(repo);
const transactions=new W.KGAdminTransactionService(repo,audit,permissions);
const references={invalidate(){this.count=(this.count||0)+1}};
const service=new W.KGTaxonomyService({legacy:W.KGLearningContent,repository:repo,transactions,permissions,audit,references});

(async()=>{
const nodes=[];
for(let level=1;level<=9;level++)nodes.push({id:`node-${level}`,parentId:level===1?null:`node-${level-1}`,level,title:{zh:`第${level}层`},status:'active'});
const imported=await service.importVersion({id:'taxonomy-pmp-nine',subjectId:'subject-pmp',name:{zh:'九层测试树'},nodes},{fileName:'nine-level.json'});
assert(imported.valid,JSON.stringify(imported));
assert.equal(imported.taxonomy.versionLabel,'v2.0');
assert.equal(imported.taxonomy.maxDepth,9);
assert.equal(imported.taxonomy.status,'draft');
assert.equal(imported.taxonomy.nodes.at(-1).level,9);

const tooDeep=await service.importVersion({id:'taxonomy-too-deep',subjectId:'subject-cspm',name:{zh:'十层错误树'},nodes:[...nodes,{id:'node-10',parentId:'node-9',level:10,title:{zh:'第10层'}}]},{fileName:'ten-level.json'});
assert(!tooDeep.valid,'level 10 must be rejected');

const denied=await service.publish(imported.taxonomy.id,{notes:'teacher cannot publish'});
assert(!denied.valid,'teacher must not publish taxonomies');
assert((denied.errors||[]).some(message=>message.includes('权限')));

role='admin';
const published=await service.publish(imported.taxonomy.id,{notes:'管理员确认发布'});
assert(published.valid,JSON.stringify(published));
assert.equal(published.taxonomy.status,'published');
assert.equal(service.currentForSubject('subject-pmp').id,imported.taxonomy.id);
assert.equal(W.KGLearningContent.subjectById('subject-pmp').defaultTaxonomyId,imported.taxonomy.id);
assert.equal(service.releaseRecords('subject-pmp')[0].action,'publish');
assert.equal(service.list('subject-pmp').filter(item=>item.isDefault).length,1,'one subject must have exactly one current taxonomy');

const currentSave=await service.saveNode(imported.taxonomy.id,{...imported.taxonomy.nodes[0],title:{zh:'当前版本可日常维护'}});
assert(currentSave.valid,'current published taxonomy should support daily maintenance');

const copied=await service.createDraftFrom(imported.taxonomy.id);
assert(copied.valid,JSON.stringify(copied));
assert.equal(copied.taxonomy.versionLabel,'v3.0');
assert.equal(copied.taxonomy.status,'draft');
assert.equal(copied.taxonomy.nodes.length,9);
const draftSave=await service.saveNode(copied.taxonomy.id,{...copied.taxonomy.nodes[0],title:{zh:'草稿可编辑'}});
assert(draftSave.valid,JSON.stringify(draftSave));

const old=service.list('subject-pmp').find(item=>item.version===1);
const activated=await service.publish(old.id,{notes:'回切历史版本'});
assert(activated.valid,JSON.stringify(activated));
assert.equal(service.currentForSubject('subject-pmp').id,old.id);
assert.equal(service.releaseRecords('subject-pmp')[0].action,'activate');
assert.equal(service.list('subject-pmp').filter(item=>item.isDefault).length,1);
const historicalSave=await service.saveNode(imported.taxonomy.id,{...service.get(imported.taxonomy.id).nodes[0],title:{zh:'历史版本不可修改'}});
assert(!historicalSave.valid,'historical published taxonomy must remain read-only');

assert(/^v9\.0-(?:p3\.3\.(?:3(?:\.\d+)?|4|5)|p3\.4|p3\.5(?:\.[12345678])?|p4\.0(?:\.[123])?|p4\.1(?:\.\d+)?)$/.test(read('VERSION').trim()));
assert.equal(JSON.parse(read('schemas/knowledge-taxonomy-schema-v1.json')).properties.nodes.items.properties.level.maximum,9);
console.log('v90-p21-taxonomy-release-ok');
})().catch(error=>{console.error(error);process.exitCode=1});
