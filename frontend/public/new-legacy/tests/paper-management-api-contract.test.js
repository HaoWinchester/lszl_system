'use strict';
const assert=require('assert/strict');
const fs=require('fs');
const path=require('path');
const vm=require('vm');
const ROOT=path.resolve(__dirname,'..');
const read=file=>fs.readFileSync(path.join(ROOT,file),'utf8');
const importController=read('src/teacher/paper-management/paper-import-controller.js');
const compositionController=read('src/teacher/paper-management/paper-composition-controller.js');

function context(){
  const target={console,setTimeout,clearTimeout,crypto:{randomUUID:()=>`uuid-${Date.now()}`}};
  target.window=target;target.globalThis=target;
  vm.createContext(target);
  return target;
}

async function testImportController(){
  const calls=[],changes=[];
  let importResolve;
  const api={
    importPreflight:async body=>{calls.push(['preflight',body]);return {valid:true,payloadHash:'a'.repeat(64),summary:{paperId:'paper-1',name:'包内名称',questionCount:60},errors:[],warnings:[{code:'FILE_NAME_MISMATCH',message:'文件名与包内名称不一致'}],paperConflict:null,allowedActions:{create:true,copy:true,replaceDraft:false}}},
    importPaper:body=>{calls.push(['import',body]);return new Promise(resolve=>{importResolve=resolve})},
  };
  const target=context();vm.runInContext(importController,target);
  const create=target.KGTeacherDomains.PaperManagement.PaperImportController.create;
  let reloads=0;
  const controller=create({api,onChange:value=>changes.push(value),onReload:async()=>{reloads+=1},idempotencyKey:()=> 'import-key'});
  const invalid=await controller.load('bad.json','{bad');
  assert.equal(invalid.ok,false);assert.equal(calls.length,0);assert.match(controller.snapshot().error,/JSON/);
  const loaded=await controller.load('PMP 模拟卷 05.json',JSON.stringify({schema:'kg-paper-package-v1',schemaVersion:1,paper:{id:'paper-1'}}));
  assert.equal(loaded.ok,true);assert.equal(controller.snapshot().preflight.summary.questionCount,60);
  controller.setConflictAction('copy');
  const first=controller.confirm(),second=controller.confirm();
  await new Promise(resolve=>setImmediate(resolve));
  assert.equal(calls.filter(item=>item[0]==='import').length,1,'double click must submit once');
  const body=calls.find(item=>item[0]==='import')[1];
  assert.equal(body.fileName,'PMP 模拟卷 05.json');assert.equal(body.preflightHash,'a'.repeat(64));assert.equal(body.conflictAction,'copy');assert.equal(body.idempotencyKey,'import-key');
  importResolve({paper:{id:'paper-copy'},warnings:[]});
  assert.equal((await first).ok,true);assert.equal((await second).ok,true);assert.equal(reloads,1);
  assert.ok(changes.length>2);

  const blocked=create({api:{importPreflight:async()=>({valid:false,payloadHash:'b'.repeat(64),errors:[{message:'缺少题目'}],warnings:[],allowedActions:{create:false,copy:false,replaceDraft:false}})}});
  await blocked.load('missing.json','{}');
  assert.equal((await blocked.confirm()).ok,false);
  assert.match(blocked.snapshot().error,/缺少题目|不能导入/);
  blocked.cancel();assert.equal(blocked.snapshot().packageData,null);
}

async function testCompositionController(){
  const preflightCalls=[],batchCalls=[];
  let batchResolve;
  const full={normalizedRequest:{subject:'PMP',bankIds:['bank-1'],filters:{},variants:[{code:'A',name:'A卷',totalCount:60},{code:'B',name:'B卷',totalCount:50},{code:'C',name:'C卷',totalCount:40}],hardQuota:{dimensionId:'exam-domain',weights:{people:42,process:50,'business-environment':8}},randomSeed:'seed-1'},candidateCount:220,unclassifiedCount:0,variants:[{code:'A',feasible:true,hardTargets:{people:25,process:30,'business-environment':5},hardActual:{people:25,process:30,'business-environment':5},softTargets:{},softActual:{}},{code:'B',feasible:true,hardTargets:{people:21,process:25,'business-environment':4},hardActual:{people:21,process:25,'business-environment':4},softTargets:{},softActual:{}},{code:'C',feasible:false,hardTargets:{people:17,process:20,'business-environment':3},hardActual:{people:16,process:20,'business-environment':3},hardShortages:{people:1},softTargets:{},softActual:{}}],feasible:false,feasibleVariantCodes:['A','B'],duplicateQuestionIds:[],planHash:'c'.repeat(64)};
  const api={
    compositionPreflight:async body=>{preflightCalls.push(body);return preflightCalls.length===1?full:{...full,normalizedRequest:{...full.normalizedRequest,variants:full.normalizedRequest.variants.slice(0,2)},variants:full.variants.slice(0,2),feasible:true,feasibleVariantCodes:['A','B'],planHash:'d'.repeat(64)}},
    createCompositionBatch:body=>{batchCalls.push(body);return new Promise(resolve=>{batchResolve=resolve})},
  };
  const target=context();vm.runInContext(compositionController,target);
  const create=target.KGTeacherDomains.PaperManagement.PaperCompositionController.create;
  let reloads=0;
  const controller=create({api,onReload:async()=>{reloads+=1},idempotencyKey:()=> 'batch-key'});
  controller.setBankIds(['bank-1']);controller.setVariant('B',{name:'B卷',totalCount:50});controller.setVariant('C',{name:'C卷',totalCount:40});
  const checked=await controller.preflight();assert.equal(checked.ok,true);assert.equal(controller.snapshot().preflight.feasible,false);
  assert.deepEqual(Array.from(preflightCalls[0].variants,item=>item.totalCount),[60,50,40]);
  assert.deepEqual(JSON.parse(JSON.stringify(preflightCalls[0].hardQuota.weights)),{people:42,process:50,'business-environment':8});
  assert.deepEqual(JSON.parse(JSON.stringify(preflightCalls[0].softQuota)),{dimensionId:'performance-domain',weights:{governance:1,scope:1,schedule:1,finance:1,stakeholder:1,resource:1,risk:1}});
  await controller.repreflightFeasible();assert.deepEqual(Array.from(preflightCalls[1].variants,item=>item.code),['A','B']);
  const first=controller.confirm(),second=controller.confirm();await new Promise(resolve=>setImmediate(resolve));
  assert.equal(batchCalls.length,1,'double click must create one batch');assert.equal(batchCalls[0].planHash,'d'.repeat(64));assert.equal(batchCalls[0].idempotencyKey,'batch-key');
  batchResolve({batchId:'batch-1',papers:[{id:'paper-a'},{id:'paper-b'}]});
  assert.equal((await first).ok,true);assert.equal((await second).ok,true);assert.equal(reloads,1);

  const failed=create({api:{compositionPreflight:async()=>({...full,feasible:true,variants:full.variants.slice(0,1),feasibleVariantCodes:['A']}),createCompositionBatch:async()=>{throw Object.assign(new Error('数据库故障'),{status:500})}}});
  failed.setBankIds(['bank-1']);failed.setVariant('B',{enabled:false});failed.setVariant('C',{enabled:false});await failed.preflight();
  const result=await failed.confirm();assert.equal(result.ok,false);assert.match(failed.snapshot().error,/全部回滚/);assert.equal(failed.snapshot().busy,false);
  failed.cancel();assert.equal(failed.snapshot().preflight,null);
}

Promise.resolve().then(testImportController).then(testCompositionController).then(()=>console.log('paper-management-api-contract-ok')).catch(error=>{console.error(error);process.exitCode=1});
