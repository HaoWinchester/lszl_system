'use strict';
const fs=require('fs');
const path=require('path');
const vm=require('vm');
const assert=require('assert');
const ROOT=path.resolve(__dirname,'..');
const read=p=>fs.readFileSync(path.join(ROOT,p),'utf8');
const memory=new Map();
const localStorage={getItem:k=>memory.has(k)?memory.get(k):null,setItem:(k,v)=>memory.set(k,String(v)),removeItem:k=>memory.delete(k),key:i=>[...memory.keys()][i]||null,get length(){return memory.size}};
const window={localStorage,crypto:{randomUUID:()=>Math.random().toString(36).slice(2)},KGAuthCore:{currentUser:()=>({username:'admin-1',displayName:'测试管理员',role:'admin'})}};window.window=window;
const catalog={};const clone=value=>JSON.parse(JSON.stringify(value));window.KGTeachingContentApi={readResource:(name,fallback)=>clone(catalog[name]??fallback),saveCatalogResource:async(name,rows)=>(catalog[name]=clone(rows))};
window.KGAppStorage={readJSON:(k,f)=>{try{return memory.has(k)?JSON.parse(memory.get(k)):JSON.parse(JSON.stringify(f))}catch(e){return f}},writeJSON:(k,v)=>{memory.set(k,JSON.stringify(v));return true},remove:k=>memory.delete(k),exists:k=>memory.has(k)};
const context={window,console,Date,Math,JSON,Set,Map,Object,Array,String,Number,Boolean,Error,TypeError};vm.createContext(context);
const load=p=>vm.runInContext(read(p),context,{filename:p});
['src/admin/00-admin-core.js','src/admin/10-content-repository.js','src/admin/11-local-content-repository.js','src/admin/20-admin-permission-service.js','src/admin/21-admin-audit-service.js','src/admin/22-admin-transaction-service.js','src/admin/30-reference-index-service.js','src/admin/31-subject-service.js'].forEach(load);
const W=context.window;
let subjects=[
 {id:'subject-used',code:'USED',name:{zh:'已有内容科目',en:''},description:{zh:'不可删除'},defaultTaxonomyId:'tax-used',status:'active',sortOrder:10},
 {id:'subject-empty',code:'EMPTY',name:{zh:'空科目',en:''},description:{zh:''},defaultTaxonomyId:'',status:'active',sortOrder:20}
];
const taxonomies=[{id:'tax-used',subjectId:'subject-used',name:{zh:'已有知识树'},status:'published',nodes:[]}];
const activities={'activity-used':{id:'activity-used',type:'single_choice',metadata:{subjectId:'subject-used',knowledge:{taxonomyId:'tax-used',primaryNodeId:''}}}};
const legacy={
 getSubjects:()=>JSON.parse(JSON.stringify(subjects)),subjectById:id=>JSON.parse(JSON.stringify(subjects.find(item=>item.id===id||item.code===id)||null)),saveSubjects:rows=>{subjects=JSON.parse(JSON.stringify(rows));return JSON.parse(JSON.stringify(subjects))},
 getTaxonomies:id=>JSON.parse(JSON.stringify(id?taxonomies.filter(item=>item.subjectId===id):taxonomies)),getActivityLibrary:()=>JSON.parse(JSON.stringify(activities)),activityTitle:item=>item.id,getCourseDrafts:()=>[],getCourseReleases:()=>[]
};
const organization={getPapers:()=>[{id:'paper-used',title:'已有试卷',subjectId:'subject-used',status:'draft',sections:[]}],getLearningTasks:()=>[],getCollections:()=>[]};
const repo=new W.KGLocalContentRepository();
const permissions=new W.KGAdminPermissionService({auth:W.KGAuthCore});const audit=new W.KGAdminAuditService(repo);const tx=new W.KGAdminTransactionService(repo,audit,permissions);const references=new W.KGReferenceIndexService({content:legacy,organization});const service=new W.KGSubjectService({legacy,transactions:tx,permissions,references});

(async()=>{
await repo.write('subjects',subjects);
const created=await service.create({code:'NEW',nameZh:'新科目',nameEn:'New Subject',descriptionZh:'用于测试'});
assert(created.valid,'new subject should be created');
assert.equal(created.subject.code,'NEW');assert.equal(created.subject.description.zh,'用于测试');assert.equal(created.subject.defaultTaxonomyId,'');
assert(!(await service.create({code:'NEW',nameZh:'重复科目'})).valid,'duplicate code must be rejected');
const updated=await service.update(created.subject.id,{nameZh:'新科目（已编辑）',nameEn:'Edited',descriptionZh:'已更新说明'});
assert(updated.valid);assert.equal(updated.subject.name.zh,'新科目（已编辑）');assert.equal(updated.subject.description.zh,'已更新说明');assert.equal(updated.subject.code,'NEW','editing must keep stable code');
const moved=await service.move(created.subject.id,'up');assert(moved.valid,'subject should move up');assert(service.list().findIndex(item=>item.id===created.subject.id)<service.list().findIndex(item=>item.id==='subject-empty'));
const stopped=await service.setStatus(created.subject.id,'inactive');assert(stopped.valid);assert(service.isInactive(stopped.subject));
const restored=await service.setStatus(created.subject.id,'active');assert(restored.valid);assert(!service.isInactive(restored.subject));
const protectedDelete=await service.delete('subject-used');assert(!protectedDelete.valid,'used subject must not be deleted');assert(protectedDelete.usage.counts.taxonomy===1);assert(protectedDelete.usage.counts.activity===1);assert(protectedDelete.usage.counts.paper===1);
const emptyDelete=await service.delete('subject-empty');assert(emptyDelete.valid,'empty subject should be deleted');assert(!service.get('subject-empty'));
const actions=audit.list().map(item=>item.action);['subject.create','subject.update','subject.reorder','subject.deactivate','subject.restore','subject.delete'].forEach(action=>assert(actions.includes(action),`missing audit action ${action}`));
assert(tx.snapshots().length>=6,'every subject write should create a recovery snapshot');
assert(/^v9\.0-(?:p3\.3\.(?:3(?:\.\d+)?|4|5)|p3\.4|p3\.5(?:\.[12345678])?|p4\.0(?:\.[123])?|p4\.1(?:\.\d+)?)$/.test(read('VERSION').trim()));
const html=read('admin-subjects.html');['adminAddSubjectBtn','adminEditSubjectBtn','adminToggleSubjectBtn','adminDeleteSubjectBtn','adminMoveSubjectUp','adminMoveSubjectDown','adminSubjectDialog','adminUsageQuestionCount'].forEach(id=>assert(html.includes(`id="${id}"`),`missing ${id}`));
assert(read('src/91-learning-content-core.js').includes("description:{zh:clean(typeof item.description==='string'?item.description:item.description?.zh||'')"));
console.log('v90-p32-subject-management-ok');
})().catch(error=>{console.error(error);process.exitCode=1});
