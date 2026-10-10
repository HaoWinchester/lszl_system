'use strict';
const assert=require('assert');
const fs=require('fs');
const path=require('path');
const vm=require('vm');
const source=name=>fs.readFileSync(path.resolve(__dirname,'../src',name),'utf8');
const plain=value=>JSON.parse(JSON.stringify(value));
const tick=async()=>{for(let i=0;i<12;i++)await Promise.resolve()};
function setup(){
  let owner='alice',rows=['a','b','c'].map((id,i)=>({id,name:id,ownerId:'alice',order:(i+1)*1000}));
  const calls=[],statuses=[],storage=new Map();
  function element(){return {dataset:{},children:[],listeners:{},classList:{add(){},remove(){},toggle(){}},setAttribute(){},append(...nodes){this.children=nodes},appendChild(node){this.children.push(node)},replaceChildren(frag){this.children=frag.children},addEventListener(type,fn){this.listeners[type]=fn},querySelector(){return null},querySelectorAll(){return this.children},contains(tab){return this.children.includes(tab)},getBoundingClientRect(){return {left:0,width:100}},closest(selector){return selector==='.graph-file-tab'?this:null}}}
  const host=element();
  const ctx={console,Promise,Date,JSON,URLSearchParams,Event,requestAnimationFrame:fn=>fn(),state:{},lastSavedSnapshot:'',
    document:{getElementById:id=>id==='graphFileTabs'?host:null,documentElement:{dataset:{}},createElement:element,createDocumentFragment:element},
    sessionStorage:{getItem:key=>storage.get(key)||null,setItem:(key,value)=>storage.set(key,value)},
    addEventListener(){},dispatchEvent(){},showStatus:text=>statuses.push(text),
    KGAuthCore:{currentUsername:()=>owner,providerConfig:()=>({mode:'remote'}),currentUser:()=>({username:owner})},
    __KG_DIRECT_BOOTSTRAP__:{graphFilesApiCutoverEnabled:true},
    fetch:async(url,options)=>{calls.push([url,options]);if(options.method==='PUT'){const ids=JSON.parse(options.body).fileIds;rows=[...ids.map(id=>rows.find(row=>row.id===id)),...rows.filter(row=>!ids.includes(row.id))].map((row,i)=>({...row,order:(i+1)*1000}));return {ok:true,json:async()=>({fileIds:rows.map(row=>row.id)})}}return {ok:true,json:async()=>({files:rows})}},
    KGGraphFileStore:{reorderFiles(){throw Error('must not touch local store')}},
  };
  ctx.window=ctx;vm.createContext(ctx);
  for(const name of ['23-graph-file-api.js','23-graph-file-remote-store.js','23-graph-file-editor-store-bridge.js','25-graph-file-tabs.js'])vm.runInContext(source(name),ctx);
  const store=ctx.KGGraphFileRemoteStore;
  store.seedCurrent({...rows[0],graphData:{nodes:[],links:[]}});
  function drag(id,target){const from=host.children.find(row=>row.dataset.fileId===id),to=host.children.find(row=>row.dataset.fileId===target);host.listeners.dragstart({target:from,preventDefault(){},dataTransfer:{setData(){}}});host.listeners.drop({target:to,clientX:99,preventDefault(){}})}
  return {ctx,store,host,calls,statuses,drag,setOwner:value=>owner=value};
}
(async()=>{
  const s=setup();await s.ctx.KGGraphFileTabs.init({currentOnly:true});await tick();
  await s.ctx.KGGraphFileTabs.closeFile('b');
  s.drag('a','c');await tick();
  assert.deepStrictEqual(s.host.children.map(tab=>tab.dataset.fileId),['c','a'],'remote drag must persist and redraw the actual remote store');
  assert.strictEqual(s.store.getCurrentFileId(),'a');
  assert.deepStrictEqual(plain(s.store.listFiles()).map(row=>row.id),['c','a','b'],'closed tabs stay in the metadata index');
  assert(s.calls.some(([url,opt])=>url==='/api/v1/files/order'&&opt.method==='PUT'));
  assert(s.calls.filter(([,opt])=>opt.method==='GET').every(([url])=>url.includes('sort=order')),'metadata reloads must request saved order');
  s.store.clearSession();s.store.seedCurrent({id:'a',ownerId:'alice',graphData:{nodes:[],links:[]}});await s.store.ensureFileIndex();s.ctx.KGGraphFileTabs.renderTabs();
  assert.deepStrictEqual(s.host.children.map(tab=>tab.dataset.fileId),['c','a'],'reload must preserve saved order and closed tabs');
  s.store.seedCurrent({...s.store.getFileMeta('a'),order:999,graphData:{nodes:[],links:[]}});s.ctx.KGGraphFileTabs.renderTabs();
  assert.deepStrictEqual(s.host.children.map(tab=>tab.dataset.fileId),['c','a'],'opening or saving the current graph must not move its tab to the front');
  const before=plain(s.store.listFiles());
  s.ctx.KGGraphFileApi.reorderFiles=async()=>{throw Error('offline')};s.drag('c','a');await tick();
  assert.deepStrictEqual(plain(s.store.listFiles()),before,'failed order save must preserve the prior metadata and order');
  assert.deepStrictEqual(s.host.children.map(tab=>tab.dataset.fileId),['c','a']);
  assert(s.statuses.at(-1).includes('offline'),'save failure must be visible');
  let finish;s.ctx.KGGraphFileApi.reorderFiles=()=>new Promise(resolve=>{finish=resolve});
  const pending=s.store.reorderFiles(['a','c']);
  assert.strictEqual(await s.store.reorderFiles(['c','a']),false,'overlapping drag writes must not race');
  s.store.clearSession();s.setOwner('bob');s.store.seedCurrent({id:'bob',ownerId:'bob',graphData:{nodes:[],links:[]}});
  finish({fileIds:['a','c','b']});assert.strictEqual(await pending,false);
  assert.deepStrictEqual(plain(s.store.listFiles()).map(row=>row.id),['bob'],'old-owner response cannot replace the new session');
  assert.strictEqual(s.store.getCurrentFileId(),'bob');
  let reject;s.ctx.KGGraphFileApi.reorderFiles=()=>new Promise((resolve,fail)=>{reject=fail});
  const failing=s.store.reorderFiles(['bob']);s.store.clearSession();s.setOwner('alice');s.store.seedCurrent({id:'a',ownerId:'alice',graphData:{nodes:[],links:[]}});
  reject(Error('old owner failure'));assert.strictEqual(await failing,false);assert.strictEqual(s.store.getLastError(),'','old-owner failures cannot poison new-session status');
  assert(s.calls.every(([url])=>!/^\/api\/v1\/files\/[abc](?:$|\?)/.test(url)),'sorting never fetches graph bodies');
  for(const orderFails of [false,true])for(const orderStartsFirst of [false,true])for(const orderFinishesFirst of [true,false]){
    const concurrent=setup();await concurrent.store.ensureFileIndex();
    const api=concurrent.ctx.KGGraphFileApi;
    let finishIndex,finishOrder;
    api.listFiles=async status=>status==='active'?await new Promise(resolve=>{finishIndex=resolve}):{files:[]};
    api.listFolders=async()=>({folders:[]});api.listTags=async()=>({tags:[]});api.getCurrent=async()=>({fileId:'a'});
    api.patchFile=async(id,patch)=>({file:{id,ownerId:'alice',...patch}});
    api.reorderFiles=()=>new Promise((resolve,reject)=>{finishOrder=payload=>orderFails?reject(Error('order offline')):resolve(payload)});
    let rename,reorder;
    if(orderStartsFirst){reorder=concurrent.store.reorderFiles(['c','a','b']);rename=concurrent.store.renameFile('a','Renamed');await tick()}
    else{rename=concurrent.store.renameFile('a','Renamed');await tick();reorder=concurrent.store.reorderFiles(['c','a','b'])}
    const payload={files:[{id:'a',ownerId:'alice',name:'Renamed',order:1000},{id:'c',ownerId:'alice',name:'c',order:3000},{id:'new',ownerId:'alice',name:'New file',order:4000}]};
    if(orderFinishesFirst){finishOrder({fileIds:['c','a','b']});await reorder;finishIndex(payload)}
    else{finishIndex(payload);await rename;finishOrder({fileIds:['c','a','b']})}
    await Promise.all([rename,reorder]);
    assert.strictEqual(concurrent.store.getFileMeta('a').name,'Renamed','concurrent order save must not discard successful rename refresh');
    assert.deepStrictEqual(plain(concurrent.store.listFiles()).map(file=>file.id),orderFails?['a','c','new']:['c','a','new'],'merge fresh additions/deletions while keeping the latest saved tab order');
    assert.strictEqual(concurrent.store.getCurrentFileId(),'a');
  }
  const lazy=setup();let finishLazy;
  lazy.ctx.KGGraphFileApi.listFiles=()=>new Promise(resolve=>{finishLazy=resolve});
  lazy.ctx.KGGraphFileApi.reorderFiles=async()=>({fileIds:['c','a','b']});
  const index=lazy.store.ensureFileIndex();await lazy.store.reorderFiles(['c','a','b']);
  finishLazy({files:['a','b','c'].map((id,i)=>({id,ownerId:'alice',order:(i+1)*1000}))});await index;
  assert.deepStrictEqual(plain(lazy.store.listFiles()).map(file=>file.id),['c','a','b'],'late first index must apply saved positions even for previously uncached files');
  console.log('graph file tab order persistence contract passed');
})().catch(error=>{console.error(error);process.exitCode=1});
