'use strict';
const {test}=require('node:test');const assert=require('node:assert/strict');const fs=require('node:fs');const vm=require('node:vm');const path=require('node:path');
function setup(){
 let emit,mode='ok',saved=null;const deferred=[];
 const context={console:{error(){}},setTimeout,clearTimeout,CustomEvent:function(type,init){this.type=type;this.detail=init.detail},dispatchEvent(){},addEventListener(){},KGCanvasWorkspaceStore:{subscribe:fn=>{emit=fn},listWorkspaces:()=>[]},fetch:async(url,options)=>{
  if(options.method==='GET')return {ok:true,json:async()=>({workspaces:[]})};
  const body=JSON.parse(options.body);
  if(mode==='defer')return new Promise(resolve=>deferred.push({resolve,body}));
  if(mode==='fail')return {ok:false,status:503,json:async()=>({detail:'offline'})};
  saved=body;return {ok:true,json:async()=>({workspace:body})};
 }};context.window=context;
 vm.runInNewContext(fs.readFileSync(path.join(__dirname,'../../frontend/scripts/new-legacy-assets/canvas-workspace-adapter.js'),'utf8'),context);
 return {api:context.KGCanvasWorkspaceAdapter,write:ws=>emit({workspace:ws,reason:'canvas-ink'}),mode:v=>{mode=v},saved:()=>saved,deferred};
}
const first={id:'w1',title:'画布',strokes:[{id:'s1'}]},latest={...first,strokes:[{id:'s1'},{id:'s2'}]};
test('workspace failed writes stay visibly unsaved and explicit retry persists ink',async()=>{
 const s=setup();await s.api.ready;s.mode('fail');s.write(first);
 await assert.rejects(s.api.flush({throwOnError:true}));
 assert.equal(s.api.getState('w1').status,'failed');s.mode('ok');await s.api.flush({throwOnError:true});
 assert.equal(s.api.getState('w1').status,'saved');assert.deepEqual(s.saved().payload,first);
});
test('failed older request cannot replace a newer queued drawing',async()=>{
 const s=setup();await s.api.ready;s.mode('defer');s.write(first);const old=s.api.flush();await new Promise(r=>setImmediate(r));
 s.write(latest);s.mode('ok');s.deferred[0].resolve({ok:false,status:503,json:async()=>({detail:'offline'})});await old;
 await s.api.flush({throwOnError:true});assert.deepEqual(s.saved().payload,latest);
});
