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
test('unauthorized and malformed responses never retain private topic data',async()=>{
  for(const result of ['unauthorized','malformed']){
    let data={nodes:[{title:'private'}]},state;
    const loader=api().createLoader({getUser:()=> 'A',load:async()=>{if(result==='unauthorized')throw Object.assign(Error('expired'),{status:401});return {nodes:null}},onData:value=>data=value,onState:value=>state=value});
    assert.equal(await loader.refresh(),false);assert.equal(data,null);assert.equal(state,result==='unauthorized'?'guest':'error');
  }
});
test('newer catalog data survives delayed success and errors for the same owner',async()=>{
  for(const fail of [false,true]){
    let resolve,reject,data,state,calls=0;
    const loader=api().createLoader({getUser:()=> 'A',load:()=>++calls===1?new Promise((r,j)=>{resolve=r;reject=j}):Promise.resolve({nodes:[{title:'new catalog'}]}),onData:value=>data=value,onState:value=>state=value});
    const old=loader.refresh(1);await loader.refresh(2);
    if(fail)reject(Error('old failure'));else resolve({nodes:[{title:'old catalog'}]});await old;
    assert.equal(data.nodes[0].title,'new catalog');assert.equal(state,'ready');
  }
});
test('full catalog overlay retains unpracticed nodes beyond sixty and leaves input unchanged',()=>{
  const nodes=Array.from({length:81},(_,i)=>({id:String(i),parentId:null,subject:'A',taxonomyId:'t',attemptCount:0,brightness:1}));
  const before=JSON.stringify(nodes),result=api().derivePracticeOverlay(nodes);
  assert.equal(result.length,81);assert.equal(result[80].brightness,.12);assert.equal(JSON.stringify(nodes),before);assert.notEqual(result[0],nodes[0]);
});
test('volume brightness rises for 0 1 5 20 and saturates independently of recency',()=>{
  const result=api().derivePracticeOverlay([0,1,5,20,99].map((attemptCount,id)=>({id,parentId:null,attemptCount})));
  assert.deepEqual(result.map(n=>n.relatedAttemptCount),[0,1,5,20,99]);
  for(let i=1;i<4;i++)assert.ok(result[i].brightness>result[i-1].brightness);
  assert.deepEqual(result.map(n=>n.brightness),[0,1,5,20,99].map(n=>.12+.88*Math.min(Math.log1p(n)/Math.log(21),1)));
  assert.equal(result[3].brightness,1);assert.equal(result[4].brightness,1);
});
test('ancestor overlay scopes ids to subject and taxonomy and terminates invalid parent cycles',()=>{
  const nodes=[{id:'r',subject:'A',taxonomyId:1,attemptCount:1},{id:'c',parentId:'r',subject:'A',taxonomyId:1,attemptCount:5},{id:'r',subject:'B',taxonomyId:1,attemptCount:2},{id:'c',parentId:'r',subject:'A',taxonomyId:2,attemptCount:9},{id:'x',parentId:'y',attemptCount:3},{id:'y',parentId:'x',attemptCount:4},{id:'bad',parentId:'missing',attemptCount:-1},{id:'nan',attemptCount:Infinity}];
  const result=api().derivePracticeOverlay(nodes);
  assert.deepEqual(result.map(n=>n.relatedAttemptCount),[6,5,2,9,7,7,0,0]);
  assert.equal(result[6].attemptCount,-1);assert.equal(result[7].attemptCount,Infinity);
});
