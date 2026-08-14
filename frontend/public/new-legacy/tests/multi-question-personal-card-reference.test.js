'use strict';

const assert=require('assert/strict');
const fs=require('fs');
const path=require('path');
const vm=require('vm');

const root=path.resolve(__dirname,'..');
const bucket=new Map();
const context={
  window:null,globalThis:null,console,
  localStorage:{
    getItem:key=>bucket.has(key)?bucket.get(key):null,
    setItem:(key,value)=>bucket.set(key,String(value)),
    removeItem:key=>bucket.delete(key)
  },
  CustomEvent:function(type,init){this.type=type;this.detail=init?.detail},
  addEventListener:()=>{},dispatchEvent:()=>true,
  KGAuthCore:{currentUsername:()=> 'personal-card-owner'}
};
context.window=context;context.globalThis=context;
vm.createContext(context);
vm.runInContext(fs.readFileSync(path.join(root,'src/65-canvas-workspace-store.js'),'utf8'),context);
const store=context.KGCanvasWorkspaceStore;

const workspace=store.createWorkspace('全局卡引用测试',{activate:true});
const first=store.addSynthesisCard({
  cardType:'user',synthesisType:'principle',personalCardId:'psc_1',personalCardRevision:2,archived:false,
  title:'旧标题',content:'旧正文',tags:['旧'],status:'draft',color:'#dbeafe'
},{x:321,y:654,width:480,height:330},{workspaceId:workspace.id});
const second=store.addSynthesisCard({cardType:'user',synthesisType:'note',title:'另一张卡'},
  {x:900,y:650,width:420,height:280},{workspaceId:workspace.id});
store.addEdge({source:first.node.id,target:second.node.id,type:'support'},{workspaceId:workspace.id});
store.createGroup({title:'保留布局'},[first.node.id,second.node.id],{workspaceId:workspace.id});

const reloaded=store.ensure({workspaceId:workspace.id}).nodes[first.node.id];
assert.equal(reloaded.personalCardId,'psc_1');
assert.equal(reloaded.personalCardRevision,2);
assert.equal(reloaded.archived,false);

const before=store.ensure({workspaceId:workspace.id});
const hydrated=store.hydratePersonalCards([{
  id:'psc_1',revision:4,title:'全局原则',content:'最新正文',tags:['风险','应对'],
  status:'verified',synthesisType:'routine',archivedAt:null
}],{workspaceId:workspace.id});
assert.equal(hydrated.changed,1);
const node=hydrated.workspace.nodes[first.node.id];
assert.deepEqual(
  JSON.parse(JSON.stringify({x:node.x,y:node.y,width:node.width,height:node.height,color:node.color})),
  JSON.parse(JSON.stringify({x:321,y:654,width:480,height:330,color:'#dbeafe'}))
);
assert.equal(node.title,'全局原则');
assert.equal(node.content,'最新正文');
assert.equal(node.synthesisType,'routine');
assert.equal(node.status,'verified');
assert.equal(node.personalCardRevision,4);
assert.equal(node.archived,false);
assert.deepEqual(Array.from(node.tags),['风险','应对']);
assert.deepEqual(JSON.parse(JSON.stringify(hydrated.workspace.edges)),JSON.parse(JSON.stringify(before.edges)));
assert.deepEqual(JSON.parse(JSON.stringify(hydrated.workspace.groups)),JSON.parse(JSON.stringify(before.groups)));

const archived=store.hydratePersonalCards([{
  id:'psc_1',revision:5,title:'已归档原则',content:'归档前正文',tags:['归档'],
  status:'mastered',synthesisType:'routine',archivedAt:'2026-08-13T10:00:00Z'
}],{workspaceId:workspace.id});
assert.equal(archived.workspace.nodes[first.node.id].archived,true);
assert.equal(archived.workspace.nodes[first.node.id].title,'已归档原则');
assert.equal(archived.workspace.nodes[first.node.id].content,'归档前正文');

const controller=fs.readFileSync(path.join(root,'src/77-multi-question-workspace.js'),'utf8');
assert.match(controller,/async function insertPersonalCard\(card/);
assert.match(controller,/function hydratePersonalCards\(cards/);
assert.match(controller,/async function saveSynthesisCard\(\)/);
assert.match(controller,/PersonalCards\.create/);
assert.match(controller,/PersonalCards\.update/);
assert.match(controller,/personalCardRevision/);

console.log('multi-question-personal-card-reference-ok');
