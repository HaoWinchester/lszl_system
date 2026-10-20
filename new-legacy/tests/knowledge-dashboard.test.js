'use strict';
const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const source=path.join(__dirname,'../src/practice/knowledge-dashboard.js');
test('knowledge dashboard module exists',()=>assert.ok(fs.existsSync(source),'missing dashboard implementation'));
function api(){return require(source)}
test('dashboard fetch failure clears private nodes and retry recovers; guest never fetches',async()=>{
  let owner='A',fail=true,calls=0,data,states=[];
  const loader=api().createLoader({getUser:()=>owner,load:async()=>{calls++;if(fail)throw Error('offline');return {nodes:[{title:'risk'}],topicCount:1}},onData:d=>data=d,onState:s=>states.push(s)});
  assert.equal(await loader.refresh(),false);assert.equal(data,null);assert.equal(states.at(-1),'error');
  fail=false;assert.equal(await loader.refresh(),true);assert.equal(data.nodes[0].title,'risk');
  owner='';await loader.refresh();assert.equal(data,null);assert.equal(states.at(-1),'guest');assert.equal(calls,2);
});
test('late successful and failed requests cannot overwrite a switched account or closed dialog',async()=>{
  let owner='A',resolve,reject,data,states=[];
  const loader=api().createLoader({getUser:()=>owner,load:()=>new Promise((r,j)=>{resolve=r;reject=j}),onData:d=>data=d,onState:s=>states.push(s)});
  const old=loader.refresh();owner='B';loader.invalidate();resolve({nodes:[{title:'A private'}]});await old;assert.equal(data,null);
  const newer=loader.refresh();loader.invalidate();reject(Error('stale failure'));await newer;assert.equal(data,null);assert.notEqual(states.at(-1),'error');
});
test('one refresh loads the entire catalog without pagination arguments',async()=>{
  let seen,data;
  const nodes=Array.from({length:320},(_,id)=>({id,practiced:id===319}));
  const loader=api().createLoader({getUser:()=> 'A',load:async(...args)=>{seen=args;return {nodes,topicCount:320}},onData:value=>data=value,onState:()=>{}});
  await loader.refresh();assert.deepEqual(seen,[]);assert.equal(data.nodes.length,320);assert.equal(data.nodes[319].practiced,true);
});
test('unauthorized and malformed responses never retain private topic data',async()=>{
  for(const result of ['unauthorized','malformed']){
    let data={nodes:[{title:'private'}]},state;
    const loader=api().createLoader({getUser:()=> 'A',load:async()=>{if(result==='unauthorized')throw Object.assign(Error('expired'),{status:401});return {nodes:null}},onData:value=>data=value,onState:value=>state=value});
    assert.equal(await loader.refresh(),false);assert.equal(data,null);assert.equal(state,result==='unauthorized'?'guest':'error');
  }
});
test('newer refresh survives delayed success and errors from older requests of the same owner',async()=>{
  for(const fail of [false,true]){
    let resolve,reject,data,state,calls=0;
    const loader=api().createLoader({getUser:()=> 'A',load:()=>++calls===1?new Promise((r,j)=>{resolve=r;reject=j}):Promise.resolve({nodes:[{title:'page two'}]}),onData:value=>data=value,onState:value=>state=value});
    const old=loader.refresh(1);await loader.refresh(2);
    if(fail)reject(Error('old failure'));else resolve({nodes:[{title:'page one'}]});await old;
    assert.equal(data.nodes[0].title,'page two');assert.equal(state,'ready');
  }
});
