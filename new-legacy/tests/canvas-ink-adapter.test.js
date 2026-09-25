'use strict';
const {test}=require('node:test');const assert=require('node:assert/strict');
const Adapter=require('../src/99-deep-recall-server-adapter.js');
const strokes=[{id:'ink-1',tool:'highlighter',color:'#facc15',width:16,points:[[0,0],[25,30]]}];
function server(){
 let saved={nodes:[],edges:[],strokes,revision:1},fail=false;
 const fetchImpl=async(url,options)=>{
  if(url.includes('/session/'))return {ok:true,json:async()=>({progress:saved,progressRevision:saved.revision,currentQuestion:{revision:1},library:{contentHash:'a'.repeat(64)}})};
  if(fail)return {ok:false,status:503,json:async()=>({detail:'offline'})};
  saved={...JSON.parse(options.body),revision:saved.revision+1};return {ok:true,json:async()=>saved};
 };
 return {fetchImpl,setFail:value=>{fail=value},saved:()=>saved};
}
test('recall load, PUT and reload retain ink independently of graph nodes',async()=>{
 const db=server(),adapter=Adapter.create({questionId:'q1',fetchImpl:db.fetchImpl});await adapter.loadSession();
 assert.deepEqual(adapter.getState().graph.strokes,strokes);
 const updated=[{...strokes[0],color:'#ef4444'}];await adapter.saveGraph({...adapter.getState().graph,strokes:updated});
 assert.deepEqual(db.saved().strokes,updated);await adapter.loadSession();assert.deepEqual(adapter.getState().graph.strokes,updated);
});
test('failed save retains exact ink payload for retry',async()=>{
 const db=server(),adapter=Adapter.create({questionId:'q1',fetchImpl:db.fetchImpl});await adapter.loadSession();db.setFail(true);
 await assert.rejects(adapter.saveGraph({nodes:[],edges:[],strokes}));
 assert.equal(adapter.getState().saveState,'failed');assert.deepEqual(adapter.getState().lastUnsavedGraph.strokes,strokes);
 db.setFail(false);await adapter.retryLastSave();assert.deepEqual(db.saved().strokes,strokes);assert.equal(adapter.getState().saveState,'saved');
});
test('published recall reset keeps release in query and clears persisted strokes',async()=>{
 let called='';const adapter=Adapter.create({questionId:'q1',releaseId:'release-1',fetchImpl:async(url,options)=>{
  if(options.method==='POST'){called=url;return {ok:true,json:async()=>({nodes:[],edges:[],strokes:[],revision:2})}}
  return {ok:true,json:async()=>({progress:{nodes:[],edges:[],strokes},progressRevision:1,currentQuestion:{revision:1}})};
 }});await adapter.loadSession();await adapter.resetToCurrent();
 assert.equal(called,'/api/v1/recall/progress/q1/reset?releaseId=release-1');assert.deepEqual(adapter.getState().graph.strokes,[]);
});
