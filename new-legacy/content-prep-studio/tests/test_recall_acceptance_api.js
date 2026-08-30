const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const vm=require('node:vm');

const SOURCE=path.resolve(__dirname,'../src/js/16-recall-acceptance.js');

function response(status,payload){return {ok:status>=200&&status<300,status,async json(){return payload}}}

function record(id){
  return {
    id,at:'2026-08-30T09:00:00.000Z',type:'input',source:'input',query:id,
    matchMode:'未命中',nodeId:'',nodeTitle:'',autoStatus:'未命中',candidateCount:0,
    firstChoices:[],path:[],manualVerdict:'',note:''
  };
}

function load(fetchImpl){
  const storageCalls=[];
  const status={className:'',innerHTML:'',textContent:''};
  const document={
    getElementById(id){return id==='raStatus'?status:null},
    querySelectorAll(){return []},
  };
  const localStorage={
    getItem(key){storageCalls.push(['getItem',key]);return null},
    setItem(key,value){storageCalls.push(['setItem',key,value])},
    removeItem(key){storageCalls.push(['removeItem',key])},
  };
  const window={fetch:fetchImpl};
  const context=vm.createContext({
    window,fetch:fetchImpl,document,localStorage,console,Date,JSON,Math,Map,Set,
    Blob:function(){},URL:{createObjectURL(){return ''},revokeObjectURL(){}},
    state:{recallLibrary:{nodes:[],edges:[]}},confirm:()=>true,setTimeout,
  });
  vm.runInContext(fs.readFileSync(SOURCE,'utf8'),context,{filename:SOURCE});
  return {context,window,status,storageCalls};
}

async function testRecordsLoadSaveAndClearThroughTypedApi(){
  const calls=[];
  const initial=record('server-record');
  const env=load(async(url,options={})=>{
    const method=options.method||'GET';
    calls.push({url,method,body:options.body?JSON.parse(options.body):null,credentials:options.credentials});
    if(method==='GET')return response(200,{revision:3,records:[initial],updatedAt:'2026-08-30T09:00:00Z'});
    if(method==='PUT')return response(200,{revision:4,records:JSON.parse(options.body).records,updatedAt:'2026-08-30T09:01:00Z'});
    if(method==='DELETE')return response(200,{revision:5,records:[],updatedAt:'2026-08-30T09:02:00Z'});
    throw new Error(`unexpected ${method} ${url}`);
  });

  await env.window.PMPRecallAcceptanceReady;
  assert.equal(vm.runInContext('RA.revision',env.context),3);
  assert.equal(vm.runInContext('RA.records[0].id',env.context),'server-record');

  vm.runInContext(`raAddRecord(${JSON.stringify({type:'input',source:'input',query:'new-record',matchMode:'未命中',nodeId:'',nodeTitle:'',autoStatus:'未命中',candidateCount:0,firstChoices:[],path:[]})})`,env.context);
  await vm.runInContext('RA.persistChain',env.context);
  assert.equal(vm.runInContext('RA.revision',env.context),4);
  assert.equal(calls[1].body.revision,3);
  assert.equal(calls[1].body.records.length,2);

  await vm.runInContext('raClearRecords()',env.context);
  assert.equal(vm.runInContext('RA.revision',env.context),5);
  assert.equal(vm.runInContext('RA.records.length',env.context),0);
  assert.deepEqual(calls.map(call=>[call.method,call.url]),[
    ['GET','/api/v1/content-prep/recall-acceptance-records'],
    ['PUT','/api/v1/content-prep/recall-acceptance-records'],
    ['DELETE','/api/v1/content-prep/recall-acceptance-records'],
  ]);
  assert.ok(calls.every(call=>call.credentials==='include'));
  assert.deepEqual(env.storageCalls,[],'business acceptance records must never use browser storage');
}

async function testLoadAndSaveFailuresRemainVisible(){
  const loadFailure=load(async()=>response(503,{detail:{message:'暂时不可用'}}));
  await loadFailure.window.PMPRecallAcceptanceReady;
  assert.match(loadFailure.status.innerHTML,/验收记录加载失败/);

  let method='GET';
  const saveFailure=load(async(_url,options={})=>{
    method=options.method||'GET';
    return method==='GET'
      ? response(200,{revision:0,records:[],updatedAt:null})
      : response(500,{detail:{message:'保存暂时不可用'}});
  });
  await saveFailure.window.PMPRecallAcceptanceReady;
  vm.runInContext(`raAddRecord(${JSON.stringify({type:'input',source:'input',query:'offline',matchMode:'未命中',nodeId:'',nodeTitle:'',autoStatus:'未命中',candidateCount:0,firstChoices:[],path:[]})})`,saveFailure.context);
  await vm.runInContext('RA.persistChain',saveFailure.context);
  assert.equal(method,'PUT');
  assert.match(saveFailure.status.innerHTML,/验收记录保存失败/);
  assert.equal(vm.runInContext('RA.records.length',saveFailure.context),1,'failed save must keep the unsaved record visible');
  assert.deepEqual(saveFailure.storageCalls,[]);
}

async function testSlowInitialLoadRejectsMutationsInsteadOfOverwritingThem(){
  let finishLoad;
  const calls=[];
  const env=load((url,options={})=>{
    calls.push({url,method:options.method||'GET'});
    return new Promise(resolve=>{finishLoad=resolve});
  });

  const added=vm.runInContext(`raAddRecord(${JSON.stringify({type:'input',source:'input',query:'too-early',matchMode:'未命中',nodeId:'',nodeTitle:'',autoStatus:'未命中',candidateCount:0,firstChoices:[],path:[]})})`,env.context);
  assert.equal(added,null);
  assert.match(env.status.innerHTML,/正在从服务器加载验收记录/);
  finishLoad(response(200,{revision:7,records:[record('server-after-slow-load')],updatedAt:null}));
  await env.window.PMPRecallAcceptanceReady;
  assert.equal(vm.runInContext('RA.records.length',env.context),1);
  assert.equal(vm.runInContext('RA.records[0].id',env.context),'server-after-slow-load');
  assert.deepEqual(calls,[{url:'/api/v1/content-prep/recall-acceptance-records',method:'GET'}]);
}

async function testFailedClearRejectsConcurrentWritesAndRestoresServerSnapshot(){
  let finishClear;
  const env=load(async(_url,options={})=>{
    const method=options.method||'GET';
    if(method==='GET')return response(200,{revision:2,records:[record('before-clear')],updatedAt:null});
    if(method==='DELETE')return new Promise(resolve=>{finishClear=resolve});
    throw new Error(`unexpected ${method}`);
  });
  await env.window.PMPRecallAcceptanceReady;
  const clearing=vm.runInContext('raClearRecords()',env.context);
  const concurrent=vm.runInContext(`raAddRecord(${JSON.stringify({type:'input',source:'input',query:'during-clear',matchMode:'未命中',nodeId:'',nodeTitle:'',autoStatus:'未命中',candidateCount:0,firstChoices:[],path:[]})})`,env.context);
  assert.equal(concurrent,null);
  await Promise.resolve();
  finishClear(response(503,{detail:{message:'clear unavailable'}}));
  await clearing;
  assert.equal(vm.runInContext('RA.records.length',env.context),1);
  assert.equal(vm.runInContext('RA.records[0].id',env.context),'before-clear');
  assert.match(env.status.innerHTML,/验收记录清空失败/);
}

Promise.resolve()
  .then(testRecordsLoadSaveAndClearThroughTypedApi)
  .then(testLoadAndSaveFailuresRemainVisible)
  .then(testSlowInitialLoadRejectsMutationsInsteadOfOverwritingThem)
  .then(testFailedClearRejectsConcurrentWritesAndRestoresServerSnapshot)
  .then(()=>console.log('recall acceptance API: passed'))
  .catch(error=>{console.error(error);process.exitCode=1});
