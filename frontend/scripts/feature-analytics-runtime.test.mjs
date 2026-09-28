import test from 'node:test';import assert from 'node:assert/strict';import vm from 'node:vm';import {readFileSync} from 'node:fs';
const read=p=>readFileSync(new URL(p,import.meta.url),'utf8');
async function setup(path='practice-mode.html'){
 let now=Date.UTC(2026,8,28),sid='A',focus=true,timer,mutation,fail=false,status=201,refreshes=0;const sent=[],listeners={};let id=0;
 const listen=(n,fn)=>(listeners[n]??=[]).push(fn);
 const w={Date:class extends Date{static now(){return now}},crypto:{randomUUID:()=>`id-${++id}`},location:{pathname:'/'+path},
 document:{readyState:'complete',visibilityState:'visible',hasFocus:()=>focus,body:{dataset:{practiceView:'active'}},getElementById:()=>null,addEventListener:listen},
 KGAuthSessionBootstrap:{load:async()=>({authenticated:!!sid,loginSessionId:sid}),refresh:async()=>{refreshes++;return {authenticated:!!sid,loginSessionId:sid}}},fetch:async(url,o)=>{sent.push({url,body:JSON.parse(o.body)});if(fail)throw Error('offline');return {ok:status===201,status}},
 addEventListener:listen,setInterval:fn=>{timer=fn},MutationObserver:class{constructor(fn){mutation=fn}observe(){}}};
 w.window=w;w.globalThis=w;vm.createContext(w);vm.runInContext(read('../../new-legacy/src/feature-usage-clock.js'),w);vm.runInContext(read('./new-legacy-assets/feature-analytics.js'),w);
 await new Promise(setImmediate);
 return {w,sent,step:n=>now+=n*1000,tick:async()=>{timer();await new Promise(setImmediate)},fire:async n=>{(listeners[n]||[]).forEach(fn=>fn());await new Promise(setImmediate)},focus:v=>focus=v,sid:v=>sid=v,fail:v=>fail=v,status:v=>status=v,refreshes:()=>refreshes,mutation:()=>mutation()};
}
test('practice and induction both report intervals, background focus pauses counters',async()=>{
 for(const page of ['practice-mode.html','question-workspace.html']){const x=await setup(page);x.step(15);await x.tick();assert.equal(x.sent[0].body.foregroundSeconds,15);x.focus(false);await x.fire('blur');x.step(60);await x.tick();assert.equal(x.sent.length,1);}
});
test('failed uploads retry the same id, no duplicate counting or business exception',async()=>{
 const x=await setup();x.fail(true);x.step(15);await x.tick();const id=x.sent[0].body.eventId;x.fail(false);await x.fire('online');assert.equal(x.sent[1].body.eventId,id);
});
test('logout discards old queue, next account has fresh visit and session binding',async()=>{
 const x=await setup();x.fail(true);x.step(15);await x.tick();const old=x.sent[0];x.sid('B');await x.fire('kg-auth-session-change');x.fail(false);x.step(15);await x.tick();const last=x.sent.at(-1);assert.equal(last.body.loginSessionId,'B');assert.notEqual(last.body.visitId,old.body.visitId);
});
test('same-page report change attributes time to analysis only after transition',async()=>{
 const x=await setup();x.step(12);x.w.document.body.dataset.practiceView='result';x.mutation();await new Promise(setImmediate);x.step(15);await x.tick();assert.deepEqual(x.sent.map(e=>[e.body.featureKey,e.body.foregroundSeconds]),[['practice',12],['analysis',15]]);
});

test('a cookie switch in another tab recovers after 409 with a fresh session',async()=>{
 const x=await setup();x.sid('B');x.status(409);x.step(15);await x.tick();
 assert.equal(x.refreshes(),1);x.status(201);x.step(15);await x.tick();
 assert.equal(x.sent.at(-1).body.loginSessionId,'B');
 assert.notEqual(x.sent.at(-1).body.visitId,x.sent[0].body.visitId);
});
