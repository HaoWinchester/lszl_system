'use strict';
const assert=require('assert');
const fs=require('fs');
const path=require('path');
const vm=require('vm');
const root=path.resolve(__dirname,'..');
function load({authenticated=true,responses=[]}={}){
  const calls=[];
  const context={console,Promise,setTimeout,clearTimeout,Date,JSON,__KG_DIRECT_BOOTSTRAP__:{authenticated,authUser:authenticated?{username:'bootstrap-user'}:null,graphFilesApiCutoverEnabled:true},fetch:async(url,options={})=>{calls.push({url,options});const next=responses.shift();if(next&&next.promise)return next.promise;return {ok:true,json:async()=>next||{ok:true}}}};
  context.KGGraphDefaultFactory=()=>({meta:{title:'我的知识图谱'},nodes:Array.from({length:11},(_,index)=>({id:'default-'+index})),links:[]});
  context.window=context;context.globalThis=context;
  context.KGAuthCore={providerConfig:()=>({mode:'remote'}),currentUser:()=>null,currentUsername:()=>''};
  vm.createContext(context);
  for(const file of ['src/23-graph-file-api.js','src/23-graph-file-remote-adapter.js'])vm.runInContext(fs.readFileSync(path.join(root,file),'utf8'),context,{filename:file});
  return {context,calls};
}
(async()=>{
  const existing=load({responses:[
    {fileId:'second'},
    {meta:{id:'second',name:'详情名称',revision:7},graphData:{meta:{title:'详情图谱'},nodes:[{id:'n1'}]},learningState:{flashcards:{f1:{}}}}
  ]});
  assert.strictEqual(existing.context.KGGraphFileApi.isRemote(),true,'direct bootstrap authentication must enable remote files');
  const first=await existing.context.KGGraphFileRemoteAdapter.initializeCurrent();
  assert.strictEqual(first.id,'second','must reopen the current active file selected by file manager');
  assert.strictEqual(first.name,'详情名称','must map response meta into current file');
  assert.strictEqual(first.graphData.nodes.length,1,'must retain backend graphData');
  assert.deepStrictEqual(JSON.parse(JSON.stringify(first.learningState)),{flashcards:{f1:{}}});
  assert.strictEqual(existing.calls.length,2,'homepage initialization must request only current metadata and its graph body');
  assert.deepStrictEqual(existing.calls.map(call=>call.url),['/api/v1/files/current','/api/v1/files/second']);

  const empty=load({responses:[{fileId:null}]});
  const created=await empty.context.KGGraphFileRemoteAdapter.initializeCurrent();
  assert.strictEqual(created,null,'an account without a current graph must remain empty');
  assert.deepStrictEqual(empty.calls.map(call=>call.url),['/api/v1/files/current'],'homepage initialization must not list or create graph files');

  empty.context.KGGraphFileRemoteAdapter.adoptFile({id:'created',name:'我的知识图谱',revision:1,graphData:{meta:{title:'我的知识图谱'},nodes:[],links:[]},learningState:{}});

  let saveAttempts=0;
  empty.context.KGGraphFileApi.save=async()=>{saveAttempts+=1;if(saveAttempts===1)throw new Error('temporary failure');return{file:{id:'created',name:'我的知识图谱',revision:2}}};
  assert.strictEqual(empty.context.KGGraphFileRemoteAdapter.queueSave({meta:{title:'first'},nodes:[],links:[]}),true);
  await assert.rejects(empty.context.KGGraphFileRemoteAdapter.flush(),/temporary failure/);
  assert.strictEqual(empty.context.KGGraphFileRemoteAdapter.queueSave({meta:{title:'second'},nodes:[],links:[]}),true);
  await empty.context.KGGraphFileRemoteAdapter.flush();
  assert.strictEqual(saveAttempts,2,'a failed save must not poison the next queued save');

  empty.context.KGGraphFileRemoteAdapter.adoptFile({id:'switched',name:'切换后',revision:9,graphData:{meta:{title:'切换后'},nodes:[{id:'n2'}],links:[]},learningState:{qa:true}});
  assert.strictEqual(empty.context.KGGraphFileRemoteAdapter.getCurrentFileMeta().id,'switched','editor switch must replace the adapter current file');
  assert.strictEqual(empty.context.KGGraphFileRemoteAdapter.getLoadedGraph().nodes[0].id,'n2','editor switch must replace the loaded graph snapshot');

  let resolveList;
  const stale=load({responses:[{promise:new Promise(resolve=>{resolveList=resolve})}]});
  const pending=stale.context.KGGraphFileRemoteAdapter.initializeCurrent();
  await Promise.resolve();
  await stale.context.KGGraphFileRemoteAdapter.handleSessionChange({detail:{authenticated:false}});
  resolveList({ok:true,json:async()=>({fileId:'old'})});
  await pending;
  assert.strictEqual(stale.context.KGGraphFileRemoteAdapter.getCurrentFileMeta(),null,'old response must be discarded after logout');
  console.log('graph remote adapter contract passed');
})().catch(error=>{console.error(error);process.exitCode=1});
