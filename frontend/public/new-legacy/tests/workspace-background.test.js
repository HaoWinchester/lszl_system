'use strict';
const {test}=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm');
function setup(){
 const data=new Map(),ctx={console,localStorage:{getItem:k=>data.get(k)||null,setItem:(k,v)=>data.set(k,v),removeItem:k=>data.delete(k)},CustomEvent:function(){},dispatchEvent(){},addEventListener(){}};ctx.window=ctx;
 vm.runInNewContext(fs.readFileSync(require('node:path').join(__dirname,'../src/65-canvas-workspace-store.js'),'utf8'),ctx);
 return ctx.KGCanvasWorkspaceStore;
}
test('legacy workspace leaves background unset for first effective surface capture',()=>{
 const store=setup();assert.equal(store.ensure().background,null);
});
test('workspace background keeps gradient and independent grid preferences through write/read',()=>{
 const store=setup(),ws=store.ensure();
 const background={appearance:{theme:'light',pattern:'grid',backgroundColor:'#fff8dc',lightColor:'#fff8dc',darkColor:'#20242b',minimapExpanded:true},layer:{color:'rgb(255, 248, 220)',image:'linear-gradient(135deg, rgb(255, 255, 255), rgb(240, 240, 240))',repeat:'no-repeat'}};
 store.write({...ws,background});assert.deepEqual(JSON.parse(JSON.stringify(store.read().background)),background);
 const next=store.createWorkspace('second',{activate:false});assert.equal(next.background,null);
});
test('invalid background cannot replace a valid CSS capture with a primitive',()=>{
 const store=setup(),ws=store.ensure();assert.equal(store.write({...ws,background:'neon'}).background,null);
});
