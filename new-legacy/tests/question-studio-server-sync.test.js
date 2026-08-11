'use strict';

const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const vm=require('node:vm');

const ROOT=path.resolve(__dirname,'..');
const configSource=fs.readFileSync(path.join(ROOT,'question-studio/server-config.js'),'utf8');
const syncSource=fs.readFileSync(path.join(ROOT,'question-studio/question-studio-sync.js'),'utf8');
const studioSource=fs.readFileSync(path.join(ROOT,'question-studio/question-studio.js'),'utf8');
const studioHtml=fs.readFileSync(path.join(ROOT,'question-studio/index.html'),'utf8');

assert.match(studioHtml,/id="qsSaveDraftBtn">保存并同步<\/button>/);
assert.match(studioSource,/function saveAndSubmit\([^]*?await submitLibrary\(/);
assert.match(studioSource,/qsSaveDraftBtn'\)\.addEventListener\('click',saveAndSubmit\)/);

function response(status,payload){return {ok:status>=200&&status<300,status,async json(){return payload}}}

async function testAuthenticatedServerImport(){
  const calls=[];let localWrites=0;
  const window={
    KG_SERVER_CONFIG:{},location:{protocol:'https:'},
    localStorage:{getItem(){return null},setItem(){localWrites+=1}},
    fetch:async(url,options={})=>{
      calls.push({url,options,body:options.body?JSON.parse(options.body):null});
      if(url==='/api/v1/question-catalog/revision')return response(200,{revision:8});
      if(url==='/api/v1/content-prep/activities/import')return response(200,{contentRevision:9,summary:{created:1,updated:0,unchanged:0}});
      return response(404,{});
    },
  };
  const context=vm.createContext({window,location:window.location,fetch:window.fetch,console,JSON,Date});
  vm.runInContext(configSource,context);vm.runInContext(syncSource,context);
  const result=await window.QuestionStudioSync.submit([{id:'activity-1',title:'服务器活动',metadata:{}}]);
  assert.equal(result.provider,'server');assert.equal(localWrites,0);
  assert.deepEqual(calls.map(call=>call.url),['/api/v1/question-catalog/revision','/api/v1/content-prep/activities/import']);
  assert.equal(calls[1].options.credentials,'include');assert.equal(calls[1].body.contentRevision,8);
}

async function testFailureNeverFallsBackToFormalLocalWrite(){
  let localWrites=0;
  const window={
    KG_SERVER_CONFIG:{},location:{protocol:'https:'},
    localStorage:{getItem(){return null},setItem(){localWrites+=1}},
    fetch:async url=>url.includes('/revision')?response(200,{revision:2}):response(503,{detail:{message:'服务器暂时不可用'}}),
  };
  const context=vm.createContext({window,location:window.location,fetch:window.fetch,console,JSON,Date});
  vm.runInContext(configSource,context);vm.runInContext(syncSource,context);
  await assert.rejects(window.QuestionStudioSync.submit([{id:'activity-2'}]),/服务器暂时不可用/);
  assert.equal(localWrites,0);
}

Promise.resolve()
  .then(testAuthenticatedServerImport)
  .then(testFailureNeverFallsBackToFormalLocalWrite)
  .then(()=>console.log('question-studio-server-sync-ok'))
  .catch(error=>{console.error(error);process.exitCode=1});
