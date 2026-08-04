'use strict';
const fs=require('fs'),path=require('path'),vm=require('vm'),assert=require('assert');
const root=path.resolve(__dirname,'..');
const bucket=new Map();
const localStorage={
  getItem:k=>bucket.has(k)?bucket.get(k):null,
  setItem:(k,v)=>bucket.set(k,String(v)),
  removeItem:k=>bucket.delete(k)
};
const context={
  window:null,globalThis:null,console,localStorage,
  CustomEvent:function(type,init){this.type=type;this.detail=init?.detail},
  addEventListener:()=>{},dispatchEvent:()=>true,
  KGAuthCore:{currentUsername:()=> 'teacher-real'},
  KGLearningSessionStore:{currentUserId:()=> 'guest'}
};
context.window=context;context.globalThis=context;
vm.createContext(context);
vm.runInContext(fs.readFileSync(path.join(root,'src/65-canvas-workspace-store.js'),'utf8'),context);
const store=context.KGCanvasWorkspaceStore;

assert.strictEqual(store.currentUserId(),'teacher-real','Canvas workspace identity must prefer KGAuthCore over guest learning-session fallback');
const created=store.createWorkspace('实际多题文件',{activate:true});
assert(created&&created.userId==='teacher-real');
const listed=store.listWorkspaces();
assert(listed.some(item=>item.id===created.id&&item.title==='实际多题文件'));
assert([...bucket.keys()].some(key=>key.includes('teacher-real')),'workspace storage/catalog must be keyed by authenticated user');
assert(![...bucket.keys()].some(key=>key.includes('__guest__')||key.endsWith('__guest')),'authenticated workspace must not be written under guest');
console.log('v862-p2217-workspace-identity-ok');
