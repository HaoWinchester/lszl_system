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
    {files:[{id:'first',name:'列表首项'},{id:'second',name:'第二项'}]},
    {fileId:'second'},
    {meta:{id:'second',name:'详情名称',revision:7},graphData:{meta:{title:'详情图谱'},nodes:[{id:'n1'}]},learningState:{flashcards:{f1:{}}}},
    {ok:true}
  ]});
  assert.strictEqual(existing.context.KGGraphFileApi.isRemote(),true,'direct bootstrap authentication must enable remote files');
  const first=await existing.context.KGGraphFileRemoteAdapter.initialize();
  assert.strictEqual(first.id,'second','must reopen the current active file selected by file manager');
  assert.strictEqual(first.name,'详情名称','must map response meta into current file');
  assert.strictEqual(first.graphData.nodes.length,1,'must retain backend graphData');
  assert.deepStrictEqual(JSON.parse(JSON.stringify(first.learningState)),{flashcards:{f1:{}}});
  assert.strictEqual(existing.calls.length,4,'existing file must read current state without creating a new file');

  const empty=load({responses:[{files:[]},{fileId:null},{file:{id:'created',name:'我的知识图谱'}},{meta:{id:'created',name:'我的知识图谱'},graphData:{meta:{title:'我的知识图谱'},nodes:[]},learningState:{}},{ok:true}]});
  const created=await empty.context.KGGraphFileRemoteAdapter.initialize();
  assert.strictEqual(created.id,'created');
  assert.strictEqual(empty.calls[2].url,'/api/v1/files');
  const body=JSON.parse(empty.calls[2].options.body);
  assert.strictEqual(body.graphData.meta.title,'我的知识图谱','empty remote account must use the explicit default graph');
  assert.strictEqual(body.graphData.nodes.length,11,'empty remote account must create the approved 11-node default graph');

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
  const pending=stale.context.KGGraphFileRemoteAdapter.initialize();
  await Promise.resolve();
  await stale.context.KGGraphFileRemoteAdapter.handleSessionChange({detail:{authenticated:false}});
  resolveList({ok:true,json:async()=>({files:[{id:'old'}]})});
  await pending;
  assert.strictEqual(stale.context.KGGraphFileRemoteAdapter.getCurrentFileMeta(),null,'old response must be discarded after logout');
  console.log('graph remote adapter contract passed');
})().catch(error=>{console.error(error);process.exitCode=1});
