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
test('pagination requests are independent and carry explicit bounded page size',async()=>{
  let seen;
  const loader=api().createLoader({getUser:()=> 'A',load:async page=>{seen=page;return {nodes:[],topicCount:5}},onData:()=>{},onState:()=>{}});
  await loader.refresh(3);assert.equal(seen,3);
});
test('one real topic is centered and dense SVG layouts stay bounded and escape labels',()=>{
  const one={title:'<script>alert(1)</script>',subject:'PMP',taxonomyId:'tax',brightness:1,attemptCount:1};
  assert.equal(api().starPositions([one])[0].x,400);
  const markup=api().networkMarkup(Array.from({length:60},(_,i)=>({...one,title:one.title+i})));
  assert.equal((markup.match(/class="kg-knowledge-star"/g)||[]).length,60);
  assert.ok(!markup.includes('<script>'));
  for(const point of api().starPositions(Array.from({length:60},(_,i)=>({...one,subject:'S'+i})))){
    assert.ok(point.x>0&&point.x<800&&point.y>0&&point.y<420);
  }
});
