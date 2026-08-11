const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const vm=require('node:vm');

const ROOT=path.resolve(__dirname,'..');
const SOURCE=path.join(ROOT,'src/js/35-server-catalog-service.js');

function response(status,payload){
  return {ok:status>=200&&status<300,status,async json(){return payload}};
}

function loadService(fetchImpl){
  const window={
    fetch:fetchImpl,
    crypto:{randomUUID:()=>`uuid-${Math.random().toString(16).slice(2)}`},
    PMPPrepServices:{},
  };
  const context=vm.createContext({window,fetch:fetchImpl,crypto:window.crypto,console,Date,JSON,Math,URLSearchParams});
  vm.runInContext(fs.readFileSync(SOURCE,'utf8'),context,{filename:SOURCE});
  return window.PMPPrepServices.ServerCatalogService;
}

async function testRelativeUrlsAndCredentials(){
  const calls=[];
  const service=loadService(async(url,options={})=>{
    calls.push({url,options});
    if(url.includes('/banks?'))return response(200,{banks:[{id:'bank-1'}]});
    if(url==='/api/v1/content-prep/banks')return response(200,{bank:{id:'bank-2'}});
    return response(200,{question:{id:'question-1'}});
  });
  assert.deepEqual(await service.listWritableBanks(),[{id:'bank-1'}]);
  assert.equal((await service.createBank({name:'新题库'})).id,'bank-2');
  assert.equal((await service.loadQuestion('question-1')).id,'question-1');
  assert.deepEqual(calls.map(call=>call.url),[
    '/api/v1/question-catalog/banks?mode=writable',
    '/api/v1/content-prep/banks',
    '/api/v1/question-catalog/questions/question-1',
  ]);
  assert.ok(calls.every(call=>call.options.credentials==='include'));
}

async function testStableErrorMapping(){
  const expected=new Map([
    [401,'AUTH_REQUIRED'],
    [403,'PERMISSION_DENIED'],
    [409,'CONFLICT'],
    [422,'VALIDATION_FAILED'],
  ]);
  for(const [status,code] of expected){
    const service=loadService(async()=>response(status,{detail:{code:'SERVER_CODE',message:`status-${status}`,issues:[{field:'title'}]}}));
    await assert.rejects(
      service.listWritableBanks(),
      error=>error.code===code&&error.serverCode==='SERVER_CODE'&&error.issues.length===1,
    );
  }
}

async function testWorkspaceMetadataMigrationIsStableAndContentSafe(){
  const service=loadService(async()=>response(500,{}));
  const original={
    prepStudioWorkspaceVersion:4,
    questionBank:{questions:[{id:'q-1',title:'原题',analysis:'内容不能变化'}]},
  };
  const migrated=service.migrateWorkspaceMetadata(original);
  const rerun=service.migrateWorkspaceMetadata(migrated);
  assert.ok(migrated.server.clientInstanceId);
  assert.equal(rerun.server.clientInstanceId,migrated.server.clientInstanceId);
  for(const field of ['serverBankId','serverBankRevision','clientInstanceId','lastIdempotencyKey','lastBatchId']){
    assert.ok(Object.hasOwn(migrated.server,field),`missing ${field}`);
  }
  const question={...migrated.questionBank.questions[0]};
  for(const field of ['serverRevision','serverContentHash','lastSyncedAt'])delete question[field];
  assert.deepEqual(question,original.questionBank.questions[0]);
  assert.deepEqual(original.questionBank.questions[0],{id:'q-1',title:'原题',analysis:'内容不能变化'});
}

async function testNetworkRetryReusesIdempotencyKeyAndCommitsMetadataLast(){
  const postBodies=[];
  let failNetwork=true;
  const service=loadService(async(url,options={})=>{
    if(url==='/api/v1/content-prep/batches'){
      postBodies.push(JSON.parse(options.body));
      if(failNetwork){failNetwork=false;throw new TypeError('offline')}
      return response(200,{
        batchId:'batch-1',bankId:'bank-1',bankRevision:7,
        questions:[{questionId:'q-1',status:'created',revision:3,contentHash:'a'.repeat(64)}],
      });
    }
    if(url==='/api/v1/content-prep/batches/batch-1'){
      return response(200,{batch:{id:'batch-1',status:'committed'}});
    }
    throw new Error(`unexpected request ${url}`);
  });
  const workspace={
    serverBankId:'bank-1',serverBankRevision:1,clientInstanceId:'client-1',
    lastIdempotencyKey:'',lastBatchId:'',
  };
  const question={id:'q-1',title:'题目',serverRevision:null,serverContentHash:'',lastSyncedAt:''};
  const bundle={
    questionBank:{questions:[question]},principles:{items:[]},
    synthesisPresets:{items:[]},tagConfig:{names:{}},
  };
  const options={workspace,creatorId:'creator_001',questions:[question],prepVersion:'0.4.0',workspaceVersion:'4'};

  await assert.rejects(service.uploadBundle(bundle,options),error=>error.code==='NETWORK_ERROR');
  const retryKey=workspace.lastIdempotencyKey;
  assert.ok(retryKey);
  assert.equal(question.serverRevision,null,'failed uploads must not update question metadata');

  const committed=await service.uploadBundle(bundle,options);
  assert.equal(committed.status,'committed');
  assert.equal(postBodies.length,2);
  assert.equal(postBodies[0].idempotencyKey,retryKey);
  assert.equal(postBodies[1].idempotencyKey,retryKey);
  assert.equal(workspace.serverBankRevision,7);
  assert.equal(workspace.lastBatchId,'batch-1');
  assert.equal(question.serverRevision,3);
  assert.equal(question.serverContentHash,'a'.repeat(64));
  assert.ok(question.lastSyncedAt);
}

async function testRejectedBatchNeverMutatesSyncMetadata(){
  const service=loadService(async(url)=>{
    assert.equal(url,'/api/v1/content-prep/batches');
    return response(409,{detail:{code:'BATCH_CONFLICT',message:'批次提交冲突'}});
  });
  const workspace={serverBankId:'bank-1',serverBankRevision:2,clientInstanceId:'client-1',lastIdempotencyKey:'',lastBatchId:''};
  const question={id:'q-1',title:'题目',serverRevision:2,serverContentHash:'old',lastSyncedAt:'old-time'};
  await assert.rejects(
    service.uploadBundle(
      {questionBank:{questions:[question]},principles:{},synthesisPresets:{},tagConfig:{}},
      {workspace,creatorId:'creator_001',questions:[question]},
    ),
    error=>error.code==='CONFLICT'&&error.serverCode==='BATCH_CONFLICT',
  );
  assert.equal(workspace.serverBankRevision,2);
  assert.equal(workspace.lastBatchId,'');
  assert.equal(question.serverRevision,2);
  assert.equal(question.serverContentHash,'old');
  assert.equal(question.lastSyncedAt,'old-time');
}

Promise.resolve()
  .then(testRelativeUrlsAndCredentials)
  .then(testStableErrorMapping)
  .then(testWorkspaceMetadataMigrationIsStableAndContentSafe)
  .then(testNetworkRetryReusesIdempotencyKeyAndCommitsMetadataLast)
  .then(testRejectedBatchNeverMutatesSyncMetadata)
  .then(()=>console.log('server catalog contracts: passed'))
  .catch(error=>{console.error(error);process.exitCode=1});
