'use strict';
const fs=require('fs'),path=require('path'),vm=require('vm'),assert=require('assert');
const root=path.resolve(__dirname,'..');
const data=new Map();
const localStorage={getItem:k=>data.has(k)?data.get(k):null,setItem:(k,v)=>data.set(k,String(v)),removeItem:k=>data.delete(k)};
const context={
  window:null,globalThis:null,console,localStorage,
  CustomEvent:function(type,init){this.type=type;this.detail=init?.detail},
  addEventListener:()=>{},dispatchEvent:()=>true,
  KGLearningSessionStore:{currentUserId:()=> 'tabs-test'}
};
context.window=context;context.globalThis=context;
vm.createContext(context);
vm.runInContext(fs.readFileSync(path.join(root,'src/65-canvas-workspace-store.js'),'utf8'),context);
const store=context.KGCanvasWorkspaceStore;
const a=store.ensure({activate:true});
const b=store.createWorkspace('第二画布',{activate:false});
const c=store.createWorkspace('第三画布',{activate:false});
let ids=store.listWorkspaces().map(x=>x.id);
assert.deepStrictEqual(Array.from(ids),[a.id,b.id,c.id]);
store.reorderWorkspaces([c.id,a.id,b.id]);
ids=store.listWorkspaces().map(x=>x.id);
assert.deepStrictEqual(Array.from(ids),[c.id,a.id,b.id]);
assert.strictEqual(store.getActiveWorkspaceId(),a.id);
console.log('v862-p2212-workspace-store-order-ok');
