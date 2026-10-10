'use strict';
const assert=require('assert');
const fs=require('fs');
const path=require('path');
const vm=require('vm');
const root=path.resolve(__dirname,'..');
function load(storage=new Map(), username='alice'){
  const calls=[],listeners={};let owner=username,allowed=true;
  const files=[{id:'a',name:'A',owner},{id:'b',name:'B',owner}];
  function element(){return {dataset:{},classList:{toggle(){},add(){},remove(){}},setAttribute(){},append(...nodes){this.children=nodes},appendChild(node){this.children.push(node)},children:[],addEventListener(){},querySelector(){return null}}}
  const host=element();host.replaceChildren=frag=>{host.children=frag.children};
  const context={console,Promise,Date,JSON,Event,state:{},lastSavedSnapshot:'',requestAnimationFrame:fn=>fn(),
    document:{getElementById:id=>id==='graphFileTabs'?host:null,documentElement:{dataset:{}},createElement:element,createDocumentFragment:element},
    sessionStorage:{getItem:key=>storage.get(key)||null,setItem:(key,value)=>storage.set(key,value)},
    location:{},CustomEvent:function(type,init){this.type=type;this.detail=init.detail},
    addEventListener:(type,fn)=>{(listeners[type] ||= []).push(fn)},dispatchEvent:event=>(listeners[event.type]||[]).forEach(fn=>fn(event)),
    KGAuthCore:{currentUsername:()=>owner},KGGraphFileApi:{isRemote:()=>true,listFiles:async status=>{calls.push('index:'+status);return {files}},get:async id=>{calls.push('body:'+id);return {meta:files.find(f=>f.id===id),graphData:{meta:{title:id},nodes:[],links:[]}}},setCurrent:async()=>{}},
    KGGraphFileAutosave:{saveBeforeSwitch:async()=>allowed,clearDirty(){}},render(){},sanitizeState:value=>value};
  context.window=context;vm.createContext(context);
  for(const file of ['23-graph-file-remote-store.js','23-graph-file-editor-store-bridge.js','25-graph-file-tabs.js'])vm.runInContext(fs.readFileSync(path.join(root,'src',file),'utf8'),context);
  const store=context.KGGraphFileRemoteStore;
  store.seedCurrent({...files[0],graphData:{nodes:[],links:[]}});
  return {context,store,calls,host,storage,setAllowed:value=>allowed=value,setOwner:value=>owner=value};
}
(async()=>{
  const item=load();
  await item.context.KGGraphFileTabs.init({currentOnly:true});
  for(let i=0;i<8;i++)await Promise.resolve();
  assert.deepStrictEqual(item.host.children.map(tab=>tab.dataset.fileId),['a','b'],'current-only boot must display both metadata tabs');
  assert.deepStrictEqual(item.calls,['index:active'],'tab restoration must fetch only the active metadata index, never graph bodies or full catalog');
  item.setAllowed(false);
  assert.strictEqual(await item.context.KGGraphFileTabs.openFile('b'),false);
  assert.strictEqual(item.store.getCurrentFileId(),'a');
  assert.strictEqual(item.calls.includes('body:b'),false,'failed save must cancel body fetch and transition');
  item.setAllowed(true);
  assert.strictEqual(await item.context.KGGraphFileTabs.openFile('b'),true);
  assert.strictEqual(item.store.getCurrentFileId(),'b');
  assert.strictEqual(await item.context.KGGraphFileTabs.closeFile('a'),true);
  assert.deepStrictEqual(item.host.children.map(tab=>tab.dataset.fileId),['b']);
  assert.strictEqual(item.store.listFiles().length,2,'closing a tab must preserve the server file index');
  const refreshed=load(item.storage);
  await refreshed.context.KGGraphFileTabs.init({currentOnly:true});await refreshed.store.ensureFileIndex();await Promise.resolve();
  // The current tab is always reopened, including returning from the file manager.
  assert.deepStrictEqual(refreshed.host.children.map(tab=>tab.dataset.fileId),['a','b']);
  await refreshed.context.KGGraphFileTabs.closeFile('b');
  const again=load(item.storage);await again.context.KGGraphFileTabs.init({currentOnly:true});await again.store.ensureFileIndex();await Promise.resolve();
  assert.deepStrictEqual(again.host.children.map(tab=>tab.dataset.fileId),['a'],'closed noncurrent tabs survive reload/navigation');
  const bob=load(item.storage,'bob');await bob.context.KGGraphFileTabs.init({currentOnly:true});await bob.store.ensureFileIndex();await Promise.resolve();
  assert.deepStrictEqual(bob.host.children.map(tab=>tab.dataset.fileId),['a','b'],'closed tabs are isolated by owner');
  const activeClose=load();await activeClose.context.KGGraphFileTabs.init({currentOnly:true});await activeClose.store.ensureFileIndex();await Promise.resolve();
  await activeClose.context.KGGraphFileTabs.openFile('b');
  assert.strictEqual(await activeClose.context.KGGraphFileTabs.closeFile('b'),true);
  assert.strictEqual(activeClose.store.getCurrentFileId(),'a','closing current must switch to another visible tab');
  assert.strictEqual(activeClose.store.listFiles().length,2);
  assert.strictEqual(await activeClose.context.KGGraphFileTabs.closeFile('a'),true);
  assert.strictEqual(activeClose.context.location.href,'file-manager.html','closing the last tab returns to file management');
  assert.strictEqual(activeClose.store.listFiles().length,2);
  const session=load();
  vm.runInContext(fs.readFileSync(path.join(root,'src/23-graph-file-remote-adapter.js'),'utf8'),session.context);
  await session.context.KGGraphFileTabs.init({currentOnly:true});await session.store.ensureFileIndex();await Promise.resolve();
  session.setOwner('bob');
  session.context.KGGraphFileApi.getCurrent=async()=>({fileId:'bob-current'});
  session.context.KGGraphFileApi.get=async id=>({meta:{id,owner:'bob',name:'Bob'},graphData:{nodes:[],links:[]}});
  session.context.KGGraphFileApi.listFiles=async()=>({files:[{id:'bob-current',owner:'bob',name:'Bob'},{id:'bob-other',owner:'bob',name:'Bob other'}]});
  await session.context.KGGraphFileRemoteAdapter.handleSessionChange({detail:{authenticated:true}});
  await session.context.KGGraphFileTabs.refresh({currentOnly:true});await session.store.ensureFileIndex();await Promise.resolve();
  assert.deepStrictEqual(session.host.children.map(tab=>tab.dataset.fileId),['bob-current','bob-other'],'actual adapter session change must discard old owner metadata before seeding the new current');
  assert.strictEqual(await session.store.getFile('a','alice'),null,'actual session change must discard old graph body cache');
  assert.strictEqual(session.store.getCurrentFileId(),'bob-current','session reset must happen before the new current is seeded');
  await session.context.KGGraphFileRemoteAdapter.handleSessionChange({detail:{authenticated:false}});
  assert.strictEqual(session.store.listFiles().length,0,'logout clears remote file metadata');
  assert.strictEqual(await session.store.getFile('bob-current','bob'),null,'logout clears remote graph bodies');
  const deferred=load();let resolveIndex;
  deferred.context.KGGraphFileApi.listFiles=()=>new Promise(resolve=>{resolveIndex=resolve});
  await deferred.context.KGGraphFileTabs.init({currentOnly:true});
  assert.deepStrictEqual(deferred.host.children.map(tab=>tab.dataset.fileId),['a'],'canvas initialization must finish before the index request');
  const oldRequest=deferred.store.ensureFileIndex();
  deferred.store.clearSession();deferred.setOwner('bob');
  deferred.context.KGGraphFileApi.listFiles=async()=>({files:[{id:'bob',owner:'bob',name:'Bob'}]});
  await deferred.store.ensureFileIndex();
  resolveIndex({files:[{id:'alice',owner:'alice',name:'Alice'}]});await oldRequest;
  assert.deepStrictEqual(Array.from(deferred.store.listFiles(),file=>file.id),['bob'],'old owner requests must never overwrite the new session index');
  const retry=load();let attempts=0;
  retry.context.KGGraphFileApi.listFiles=async()=>{attempts++;if(attempts===1)throw new Error('offline');return {files:[{id:'a',owner:'alice',name:'A'},{id:'b',owner:'alice',name:'B'}]}};
  assert.strictEqual(await retry.store.ensureFileIndex(),false,'failed metadata request must be recoverable');
  assert.strictEqual(await retry.store.ensureFileIndex(),true);
  assert.strictEqual(attempts,2,'a failed metadata request must not poison the loaded flag or pending promise');
  console.log('graph file tabs metadata index contract passed');
})().catch(error=>{console.error(error);process.exitCode=1});
