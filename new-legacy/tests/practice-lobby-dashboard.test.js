'use strict';
const {test}=require('node:test');
const assert=require('node:assert/strict');
const {historyRows,createLoader}=require('../src/practice/lobby-dashboard.js');

test('history preview uses actual attempts and reports answered-question accuracy',()=>{
  const rows=historyRows([{sessionId:'old',paperName:'<script>',createdAt:'2026-10-01',answered:0,correct:0,total:10},
    {sessionId:'new',paperName:'新卷',createdAt:'2026-10-14',answered:4,correct:3,total:20,durationMs:60000,reportAvailable:true,status:'completed'}]);
  assert.equal(rows[0].id,'new');assert.equal(rows[0].accuracy,'75%');assert.equal(rows[0].duration,'1 分钟');
  assert.equal(rows[1].accuracy,'—');assert.equal(rows[1].name,'<script>');assert.equal(rows[1].action,'none');
  assert.equal(rows[0].action,'report');assert.deepEqual(historyRows([]),[]);
});
test('preview failure clears rows and can be retried; guest does not fetch',async()=>{
  let owner='student',fail=true,calls=0,rows,states=[];
  const loader=createLoader({getUser:()=>owner,load:async()=>{calls++;if(fail)throw Error('offline');return ['fresh']},onRows:r=>rows=r,onState:s=>states.push(s)});
  assert.equal(await loader.refresh(),false);assert.deepEqual(rows,[]);assert.equal(states.at(-1),'error');
  fail=false;assert.equal(await loader.refresh(),true);assert.deepEqual(rows,['fresh']);
  owner='';await loader.refresh();assert.deepEqual(rows,[]);assert.equal(calls,2);assert.equal(states.at(-1),'guest');
});
test('late account or tab requests never repaint another account',async()=>{
  let owner='A',resolve,rows=[];
  const loader=createLoader({getUser:()=>owner,load:()=>new Promise(r=>resolve=r),onRows:r=>rows=r,onState:()=>{}});
  const pending=loader.refresh();owner='B';loader.invalidate();resolve(['A private']);await pending;assert.deepEqual(rows,[]);
  const next=loader.refresh();loader.invalidate();resolve(['stale tab']);await next;assert.deepEqual(rows,[]);
});
