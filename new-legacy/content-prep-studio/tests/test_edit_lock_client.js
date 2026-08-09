const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const vm=require('node:vm');

const ROOT=path.resolve(__dirname,'..');
const SERVICE_SOURCE=fs.readFileSync(path.join(ROOT,'src/js/35-server-catalog-service.js'),'utf8');
const EVENT_SOURCE=fs.readFileSync(path.join(ROOT,'src/js/45-server-events.js'),'utf8');
const RUNTIME_SOURCE=fs.readFileSync(path.join(ROOT,'src/js/20-page-runtime.js'),'utf8');
const DOMAIN_SOURCE=fs.readFileSync(path.join(ROOT,'src/js/10-state-domain.js'),'utf8');
const SERVICES_SOURCE=fs.readFileSync(path.join(ROOT,'src/js/30-service-layer.js'),'utf8');

function response(status,payload){return {ok:status>=200&&status<300,status,async json(){return payload}}}
function harness(fetchImpl){
  const timers=new Map();let timerId=0;const events=[];
  const window={
    fetch:fetchImpl,crypto:{randomUUID:()=>`uuid-${++timerId}`},PMPPrepServices:{},
    setInterval(callback,delay){const id=++timerId;timers.set(id,{callback,delay});return id},
    clearInterval(id){timers.delete(id)},
    dispatchEvent(event){events.push(event)},
  };
  class CustomEvent{constructor(type,options={}){this.type=type;this.detail=options.detail}}
  const context=vm.createContext({window,fetch:fetchImpl,crypto:window.crypto,console,Date,JSON,Math,URLSearchParams,CustomEvent});
  vm.runInContext(SERVICE_SOURCE,context);
  return {service:window.PMPPrepServices.ServerCatalogService,timers,events};
}
function grant(questionId='q-server'){
  return {
    questionId,lockToken:'lock-token',lockedBy:'teacher-a',creatorId:'creator_001',creatorName:'波塞冬',
    clientInstanceId:'client-a',acquiredAt:'2026-08-09T00:00:00Z',expiresAt:'2026-08-09T00:05:00Z',
    heartbeatIntervalSeconds:30,leaseSeconds:300,
  };
}

async function testLockLifecycleUsesServerLeaseAndReleasesOnClose(){
  const calls=[];
  const {service,timers,events}=harness(async(url,options={})=>{
    calls.push({url,options});
    if(options.method==='POST')return response(200,grant());
    if(options.method==='PUT')return response(200,{...grant(),expiresAt:'2026-08-09T00:05:30Z'});
    return response(200,{ok:true});
  });
  const controller=service.createEditLeaseController({clientInstanceId:'client-a',creatorId:'creator_001'});

  const opened=await controller.open({id:'q-server',serverRevision:2});
  assert.equal(opened.mode,'server-editable');
  assert.equal(opened.leaseSeconds,300);
  assert.equal(opened.heartbeatIntervalSeconds,30);
  assert.equal(timers.size,1);
  assert.equal([...timers.values()][0].delay,30000);
  await [...timers.values()][0].callback();
  assert.ok(calls.some(call=>call.options.method==='PUT'&&call.url.endsWith('/heartbeat')));
  await controller.close();
  assert.ok(calls.some(call=>call.options.method==='DELETE'));
  assert.equal(timers.size,0);
  assert.ok(events.some(event=>event.type==='prep:lock-acquired'));
}

async function testLocalQuestionsNeverAcquireLocksAndRemoteConflictsAreReadonly(){
  let calls=0;
  const local=harness(async()=>{calls+=1;return response(500,{})}).service.createEditLeaseController({clientInstanceId:'client-a',creatorId:'creator_001'});
  assert.equal((await local.open({id:'q-local',serverRevision:null})).mode,'local-new');
  assert.equal(calls,0);

  const remote=harness(async()=>response(409,{detail:{code:'LOCKED_BY_OTHER',message:'其他人正在编辑'}})).service
    .createEditLeaseController({clientInstanceId:'client-a',creatorId:'creator_001'});
  const state=await remote.open({id:'q-server',serverRevision:1});
  assert.equal(state.mode,'server-readonly');
  assert.equal(state.canSave,false);
  assert.match(state.message,/其他人正在编辑/);
}

async function testHeartbeatFailureDegradesThenRequiresReconfirmation(){
  let phase='acquire';
  const {service,timers}=harness(async(_url,options={})=>{
    if(options.method==='POST'){phase='heartbeat';return response(200,grant())}
    if(options.method==='PUT'&&phase==='heartbeat')throw new TypeError('offline');
    return response(200,grant());
  });
  const controller=service.createEditLeaseController({clientInstanceId:'client-a',creatorId:'creator_001'});
  await controller.open({id:'q-server',serverRevision:1});
  const tick=[...timers.values()][0].callback;
  await tick();
  assert.equal(controller.snapshot().mode,'server-editable');
  assert.equal(controller.snapshot().connection,'unstable');
  await tick();
  assert.equal(controller.snapshot().mode,'offline-unsynced');
  assert.equal(controller.snapshot().canSave,false);

  phase='recover';
  const recovered=await controller.reconfirm();
  assert.equal(recovered.mode,'server-editable');
  assert.equal(recovered.connection,'online');
}

async function testSaveConflictStopsOldPageAndSupportsConflictCopyContract(){
  const {service}=harness(async()=>response(200,grant()));
  const controller=service.createEditLeaseController({clientInstanceId:'client-a',creatorId:'creator_001'});
  await controller.open({id:'q-server',serverRevision:1});
  controller.handleSaveError({status:409,code:'CONFLICT',message:'版本冲突'});
  assert.equal(controller.snapshot().mode,'conflict-copy-required');
  assert.equal(controller.snapshot().canSave,false);

  for(const marker of ['keepalive:true','releaseLock','saveWorkspaceLocal','conflict-copy-required','btnCopyConflictQuestion']){
    assert.ok(EVENT_SOURCE.includes(marker)||RUNTIME_SOURCE.includes(marker),`missing UI lock marker: ${marker}`);
  }
  for(const marker of ['delete copy.serverRevision','delete copy.serverContentHash','delete copy.lockToken','parentQuestionId']){
    assert.ok((DOMAIN_SOURCE+SERVICES_SOURCE).includes(marker),`duplicate recovery must include ${marker}`);
  }
}

Promise.resolve()
  .then(testLockLifecycleUsesServerLeaseAndReleasesOnClose)
  .then(testLocalQuestionsNeverAcquireLocksAndRemoteConflictsAreReadonly)
  .then(testHeartbeatFailureDegradesThenRequiresReconfirmation)
  .then(testSaveConflictStopsOldPageAndSupportsConflictCopyContract)
  .then(()=>console.log('edit lock client contracts: passed'))
  .catch(error=>{console.error(error);process.exitCode=1});
