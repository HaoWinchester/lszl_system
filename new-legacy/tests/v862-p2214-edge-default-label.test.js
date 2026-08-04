'use strict';
const fs=require('fs'),path=require('path'),vm=require('vm'),assert=require('assert');
const root=path.resolve(__dirname,'..');
const data=new Map();
const context={window:null,globalThis:null,console,
  localStorage:{getItem:k=>data.has(k)?data.get(k):null,setItem:(k,v)=>data.set(k,String(v)),removeItem:k=>data.delete(k)},
  CustomEvent:function(type,init){this.type=type;this.detail=init?.detail},
  addEventListener:()=>{},dispatchEvent:()=>true,
  KGLearningSessionStore:{currentUserId:()=> 'edge-test'}
};
context.window=context;context.globalThis=context;vm.createContext(context);
vm.runInContext(fs.readFileSync(path.join(root,'src/65-canvas-workspace-store.js'),'utf8'),context);
const store=context.KGCanvasWorkspaceStore;
let ws=store.ensure({activate:true});
const a=store.addSynthesisCard({title:'A'},{x:100,y:100,width:400,height:300}).node;
const b=store.addSynthesisCard({title:'B'},{x:700,y:100,width:400,height:300}).node;
const edge=store.addEdge({source:a.id,target:b.id,type:'same'});
assert(edge.created);
assert.strictEqual(edge.edge.label,'');
const c=store.addSynthesisCard({title:'C'},{x:1300,y:100,width:400,height:300}).node;
const labeled=store.addEdge({source:b.id,target:c.id,type:'contrast',label:'对比关系'});
assert.strictEqual(labeled.edge.label,'对比关系');
console.log('v862-p2214-edge-default-label-ok');
