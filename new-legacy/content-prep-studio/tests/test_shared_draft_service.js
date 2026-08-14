const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const vm=require('node:vm');

const ROOT=path.resolve(__dirname,'..');
const SOURCE=path.join(ROOT,'src/js/36-server-draft-service.js');

function response(status,payload){return {ok:status>=200&&status<300,status,async json(){return payload}}}
function load(fetchImpl){
  const window={fetch:fetchImpl,PMPPrepServerCatalogService:{request:async(path,options)=>{
    const response=await fetchImpl(`/api/v1${path}`,options);return response.json();
  }}};
  const context=vm.createContext({window,JSON,Promise,console});
  vm.runInContext(fs.readFileSync(SOURCE,'utf8'),context,{filename:SOURCE});
  return window.PMPPrepSharedDrafts;
}

async function testSharedDraftLifecycleUsesDatabaseApi(){
  const calls=[];
  const service=load(async(url,options={})=>{
    calls.push({url,method:options.method||'GET',body:options.body?JSON.parse(options.body):null});
    if(url==='/api/v1/content-prep/drafts'){
      if((options.method||'GET')==='POST')return response(201,{draft:{id:'cpd-1',revision:1,title:'新草稿'}});
      return response(200,{drafts:[{id:'cpd-1',revision:1,title:'新草稿'}]});
    }
    if(url==='/api/v1/content-prep/drafts/cpd-1'){
      if(options.method==='PUT')return response(200,{draft:{id:'cpd-1',revision:2,title:'已保存'}});
      return response(200,{draft:{id:'cpd-1',revision:1,title:'新草稿',payload:{questionBank:{questions:[]}}}});
    }
    if(url==='/api/v1/content-prep/drafts/cpd-1/sync')return response(200,{result:{batchId:'batch-1',bankId:'bank-1'}});
    throw new Error(`unexpected ${options.method||'GET'} ${url}`);
  });
  assert.deepEqual(await service.list(),[{id:'cpd-1',revision:1,title:'新草稿'}]);
  assert.equal((await service.create({title:'新草稿',payload:{}})).id,'cpd-1');
  assert.equal((await service.get('cpd-1')).payload.questionBank.questions.length,0);
  assert.equal((await service.save('cpd-1',{title:'已保存',payload:{a:1},revision:1})).revision,2);
  assert.equal((await service.sync('cpd-1',{revision:2,creatorId:'creator_001'})).batchId,'batch-1');
  assert.deepEqual(calls.map(call=>[call.method,call.url]),[
    ['GET','/api/v1/content-prep/drafts'],
    ['POST','/api/v1/content-prep/drafts'],
    ['GET','/api/v1/content-prep/drafts/cpd-1'],
    ['PUT','/api/v1/content-prep/drafts/cpd-1'],
    ['POST','/api/v1/content-prep/drafts/cpd-1/sync'],
  ]);
  assert.equal(calls[3].body.revision,1);
  assert.equal(calls[4].body.creatorId,'creator_001');
}

testSharedDraftLifecycleUsesDatabaseApi().then(()=>console.log('shared draft service: passed')).catch(error=>{console.error(error);process.exitCode=1});
