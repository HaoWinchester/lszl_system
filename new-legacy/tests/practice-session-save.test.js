'use strict';
const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const vm=require('node:vm');
function coordinator(api){
  const context={window:{},TextEncoder};
  const file=path.join(__dirname,'../src/116-practice-session-save.js');
  assert(fs.existsSync(file),'shared practice save coordinator is required');
  vm.runInNewContext(fs.readFileSync(file,'utf8'),context);
  return context.window.KGPracticeSessionSave.create({api});
}
const body=()=>({revision:1,answers:{q1:{selectedAnswer:'A',selectionIndex:1}},runtimeState:{durationMs:100}});

test('duplicate explicit saves share one immutable in-flight request',async()=>{
  const calls=[];let release;
  const saves=coordinator({pauseSession:(id,input,options)=>{
    calls.push({id,input,options});return new Promise(resolve=>{release=resolve});
  }});
  const input=body(),first=saves.save('pause','s1',input);
  assert.equal(saves.save('pause','s1',input),first);
  input.answers.q1.selectedAnswer='B';
  assert.equal(calls[0].input.answers.q1.selectedAnswer,'A');
  await assert.rejects(saves.save('abandon','s1',body()),/保存/);
  assert.equal(calls.length,1);
  release({id:'s1',status:'paused',revision:2});
  assert.equal((await first).revision,2);
  assert.equal(saves.pending(),false);
});

test('a failed explicit save remains retryable without starting background retries',async()=>{
  let calls=0;
  const saves=coordinator({pauseSession:async()=>{if(++calls===1)throw new Error('offline');return {revision:2};}});
  await assert.rejects(saves.save('pause','s1',body()),/offline/);
  assert.equal(saves.pending(),false);
  assert.equal(calls,1);
  assert.equal((await saves.save('pause','s1',body())).revision,2);
});

test('pagehide repeats only the existing completion intent once using keepalive',async()=>{
  const calls=[];let release;
  const saves=coordinator({completeSession:(id,input,options)=>{
    calls.push({id,input,options});
    return options.keepalive?Promise.resolve({}):new Promise(resolve=>{release=resolve});
  },pauseSession:()=>assert.fail('completion must never degrade to pause')});
  const pending=saves.save('complete','s1',body());
  assert.equal(saves.flushForPageHide({sessionId:'s1',input:{revision:999},active:false,dirty:true}),true);
  assert.equal(saves.flushForPageHide({sessionId:'s1',input:body(),active:true,dirty:true}),false);
  assert.equal(calls.length,2);
  assert.equal(calls[1].options.keepalive,true);
  assert.equal(calls[1].input.revision,1);
  release({});await pending;
});

test('pagehide saves dirty active sessions but not clean, anonymous or completed sessions',async()=>{
  const calls=[];
  const saves=coordinator({pauseSession:async(id,input,options)=>{calls.push({id,input,options});return {};}});
  for(const snapshot of [{sessionId:'',active:true,dirty:true},{sessionId:'s1',active:false,dirty:true},{sessionId:'s1',active:true,dirty:false}]){
    assert.equal(saves.flushForPageHide({...snapshot,input:body()}),false);
  }
  assert.equal(calls.length,0);
  assert.equal(saves.flushForPageHide({sessionId:'s1',active:true,dirty:true,input:body()}),true);
  assert.equal(calls[0].options.keepalive,true);
  await Promise.resolve();
  saves.reset();
  assert.equal(saves.flushForPageHide({sessionId:'s1',active:true,dirty:true,input:body()}),true);
});

test('180-answer payload fits the close budget, oversized payload is not misreported as sent',()=>{
  const calls=[];
  const saves=coordinator({pauseSession:async(id,input,options)=>{calls.push({id,input,options});return {};}});
  const input=body();
  input.answers=Object.fromEntries(Array.from({length:180},(_,i)=>['q_'+String(i).padStart(60,'a'),{selectedAnswer:'A',selectionIndex:i+1}]));
  assert(new TextEncoder().encode(JSON.stringify(input)).byteLength<48*1024);
  assert.equal(saves.flushForPageHide({sessionId:'s1',active:true,dirty:true,input}),true);
  saves.reset();input.runtimeState.note='汉'.repeat(30000);
  assert.equal(saves.flushForPageHide({sessionId:'s1',active:true,dirty:true,input}),false);
  assert.equal(calls.length,1);
});
