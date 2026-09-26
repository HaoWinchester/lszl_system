'use strict';
const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs'),path=require('node:path'),vm=require('node:vm');
const root=path.resolve(__dirname,'..');
const tick=()=>new Promise(resolve=>setImmediate(resolve));
function context(extra={}){const c={console,Promise,setTimeout,clearTimeout,...extra};c.window=c;c.globalThis=c;vm.createContext(c);const guard=path.join(root,'src/00-import-guard.js');if(fs.existsSync(guard))vm.runInContext(fs.readFileSync(guard,'utf8'),c);return c}
function load(c,file){vm.runInContext(fs.readFileSync(path.join(root,file),'utf8'),c)}
test('principle file selections share one request and unlock after failure',async()=>{
  const handlers={},nodes={},docHandlers={};
  for(const id of ['tqImportPrincipleCardBundleBtn','tqImportPrincipleCardBundleFile'])nodes[id]={disabled:false,value:'selected',files:[],addEventListener:(type,fn)=>handlers[id+':'+type]=fn,click(){},setAttribute(){},removeAttribute(){}};
  nodes.qbToast={textContent:'',classList:{add(){},remove(){}}};
  let calls=0,finish;
  const c=context({URLSearchParams,location:{search:''},addEventListener(){},document:{getElementById:id=>nodes[id]||null,addEventListener:(type,fn)=>docHandlers[type]=fn},KGTeachingContentApi:{ready:async()=>{},importPrinciples:()=>{calls++;return new Promise((resolve,reject)=>finish=reject)}},FileReader:class{readAsText(file){this.result=file.text;queueMicrotask(()=>this.onload())}}});
  load(c,'src/teacher/training-config/principle-preset-controller.js');docHandlers.DOMContentLoaded();await tick();
  const input=nodes.tqImportPrincipleCardBundleFile;
  input.files=[{text:JSON.stringify({format:'kg-principle-card-bundle-v1',principles:{items:[]},synthesisPresets:{items:[]}})}];
  const change=()=>handlers['tqImportPrincipleCardBundleFile:change']({currentTarget:input});
  for(let i=0;i<10;i++)change();await tick();
  assert.equal(calls,1);assert.equal(input.disabled,true);assert.equal(nodes.tqImportPrincipleCardBundleBtn.disabled,true);
  finish(Object.assign(new Error('已有导入正在处理中，请等待完成后再试。'),{status:409,code:'IMPORT_IN_PROGRESS'}));await tick();assert.equal(input.disabled,false);assert.match(nodes.qbToast.textContent,/等待完成/);
  change();await tick();assert.equal(calls,2);finish(new Error('network failed'));await tick();
});
test('cancel and replacement file cannot unlock an in-flight bank import',async()=>{
  const c=context();load(c,'src/teacher/question-bank-import-controller.js');
  let calls=0,finish;const bank=c.KGTeacherDomains.QuestionBankImportController.create({api:{importBanks:()=>{calls++;return new Promise(resolve=>finish=resolve)}}});
  await bank.load('a.json',JSON.stringify({id:'a',name:'a',questions:[]}));
  const first=bank.confirm();bank.cancel();await bank.load('b.json',JSON.stringify({id:'b',name:'b',questions:[]}));const second=bank.confirm();
  assert.equal(calls,1);assert.equal(bank.snapshot().busy,true);assert.equal(bank.snapshot().banks[0].id,'a');finish({});await Promise.all([first,second]);assert.equal(bank.snapshot().busy,false);
});
test('paper preflight rejects replacement while busy and shares repeated checks',async()=>{
  const c=context();load(c,'src/teacher/paper-management/paper-import-controller.js');
  let calls=0,finish;const controller=c.KGTeacherDomains.PaperManagement.PaperImportController.create({api:{importPreflight:()=>{calls++;return new Promise(resolve=>finish=resolve)}}});
  const first=controller.load('a.json','{}');const checks=[controller.preflight(),controller.preflight()];controller.cancel();const replace=controller.load('b.json','{}');
  assert.equal(calls,1);assert.equal(controller.snapshot().fileName,'a.json');finish({valid:true,payloadHash:'hash',allowedActions:{create:true}});await Promise.all([first,replace,...checks]);
});
test('paper retry after ambiguous failure reuses the server idempotency key',async()=>{
  const c=context();load(c,'src/teacher/paper-management/paper-import-controller.js');
  const keys=[];let sequence=0;const controller=c.KGTeacherDomains.PaperManagement.PaperImportController.create({idempotencyKey:()=>`attempt-${++sequence}`,api:{importPreflight:async()=>({valid:true,payloadHash:'hash',allowedActions:{copy:true}}),importPaper:async body=>{keys.push(body.idempotencyKey);if(keys.length===1)throw new Error('timeout');return {paper:{id:'one-copy'}}}}});
  await controller.load('a.json','{}');await controller.confirm();await controller.retry();assert.equal(keys.length,2);assert.equal(keys[0],keys[1]);
});
test('shared guard locks before reading, preserves disabled state and releases on error',async()=>{
  const a={disabled:false},b={disabled:true};const c=context({document:{getElementById:id=>id==='a'?a:b}});
  let reads=0,fail;
  const task=()=>{reads++;return new Promise((resolve,reject)=>fail=reject)};
  const first=c.KGImportGuard.run('file',task,['a','b']);
  const duplicate=c.KGImportGuard.run('file',task,['a','b']);
  assert.equal(first,duplicate);assert.equal(reads,1);assert.equal(a.disabled,true);
  fail(new Error('read failed'));await assert.rejects(first,/read failed/);
  assert.equal(a.disabled,false);assert.equal(b.disabled,true);
  assert.equal(await c.KGImportGuard.run('file',()=>42,['a']),42);
});
test('definite revision rejection permits a fresh preflight and corrected retry',async()=>{
  const c=context();load(c,'src/teacher/paper-management/paper-import-controller.js');
  const bodies=[];let checks=0;const controller=c.KGTeacherDomains.PaperManagement.PaperImportController.create({api:{
    importPreflight:async()=>({valid:true,payloadHash:'hash',allowedActions:{replaceDraft:true},paperConflict:{revision:++checks}}),
    importPaper:async body=>{bodies.push(body);if(bodies.length===1)throw Object.assign(new Error('changed'),{code:'REVISION_CONFLICT',status:409});return {paper:{id:'existing'}}},
  }});
  await controller.load('a.json','{}');await controller.confirm();await controller.retry();await controller.confirm();
  assert.equal(bodies.length,2);assert.equal(bodies[0].expectedRevision,1);assert.equal(bodies[1].expectedRevision,2);assert.notEqual(bodies[0].idempotencyKey,bodies[1].idempotencyKey);
});
test('Prep Studio different file inputs cannot mutate the workspace concurrently',async()=>{
  const inputs=[{disabled:false},{disabled:false}];const c=context({document:{querySelectorAll:()=>inputs}});
  let calls=0,finish;const handler=c.KGImportGuard.fileHandler(()=>{calls++;return new Promise(resolve=>finish=resolve)});
  const first=handler({target:inputs[0]});const second=handler({target:inputs[1]});assert.equal(calls,1);assert(inputs.every(n=>n.disabled));
  finish();await Promise.all([first,second]);assert(inputs.every(n=>!n.disabled));
});
