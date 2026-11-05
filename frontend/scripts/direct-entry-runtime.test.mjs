import assert from 'node:assert/strict';
import test from 'node:test';
import vm from 'node:vm';
import {readFileSync} from 'node:fs';

function harness(overrides={}){
  let resolveUser,snapshot;const memberButton={hidden:false};const session=new Promise(resolve=>resolveUser=resolve);const events={};const opened=[];const published=[];
  const location=new URL('http://localhost/practice-mode.html?auth=login&paperId=p1&sessionId=s1#lobby');
  const window={location,history:{state:null,replaceState(_s,_t,url){location.href=new URL(url,location).href}},
    KGAuthSessionBootstrap:{load:()=>session,refresh:()=>Promise.resolve(snapshot)},authOpen:msg=>opened.push(msg),
    __KG_DIRECT_BOOTSTRAP__:{authenticated:true,username:"teacher",authUser:{username:"teacher",role:"teacher"}},
    addEventListener(name,fn){(events[name]??=[]).push(fn)},dispatchEvent(event){published.push(event)},setTimeout:fn=>fn(),
    KGLearningEntryChooser:{init:()=>({shown:false})},...overrides};
  const context={window,document:{readyState:'loading',getElementById:id=>id==='upgradeMemberBtn'?memberButton:null},URL,URLSearchParams,
    CustomEvent:class{constructor(type,options){this.type=type;this.detail=options?.detail}}};
  vm.runInNewContext(readFileSync('scripts/new-legacy-assets/direct-entry.js','utf8'),context);
  const emit=async(name,detail)=>{for(const fn of events[name]||[])fn({detail});await new Promise(resolve=>setImmediate(resolve))};
  return {window,resolveUser(value){snapshot=value;resolveUser(value)},setUser(value){snapshot=value},memberButton,opened,published,emit};
}
test('restoring an authenticated session does not flash a login prompt and preserves learning URL',async()=>{
  const h=harness();await h.emit('DOMContentLoaded');assert.equal(h.opened.length,0);
  h.resolveUser({user:{username:'student',role:'student'}});await h.window.KGDirectEntry.waitForInitialLearningEntry();
  await h.emit('load');assert.equal(h.opened.length,0);assert.equal(h.window.location.search,'?paperId=p1&sessionId=s1');assert.equal(h.window.location.hash,'#lobby');
});
test('anonymous entry waits for session resolution and opens login once',async()=>{
  const h=harness();await h.emit('DOMContentLoaded');assert.equal(h.opened.length,0);
  h.resolveUser({user:null});await h.window.KGDirectEntry.waitForInitialLearningEntry();await h.emit('load');
  assert.equal(h.opened.length,1);assert.equal(h.window.location.search.includes('auth=login'),true);
});

for(const role of ['guest','student','teacher','admin','viewer']){
 test(`membership entry has an explicit visible state for ${role}`,async()=>{
  const h=harness();await h.emit('DOMContentLoaded');h.resolveUser({user:role==='guest'?null:{username:role,role}});
  await h.window.KGDirectEntry.waitForInitialLearningEntry();
  assert.equal(h.memberButton.hidden,!['guest','student'].includes(role));
 });
}
test('membership entry refreshes its visible state through login and logout',async()=>{
 const h=harness();await h.emit('DOMContentLoaded');h.resolveUser({user:{username:'admin',role:'admin'}});
 await h.window.KGDirectEntry.waitForInitialLearningEntry();assert.equal(h.memberButton.hidden,true);
 h.setUser({user:null});await h.emit('kg:auth-session-changed',{authenticated:false});assert.equal(h.memberButton.hidden,false);
 h.setUser({user:{username:'student',role:'student'}});await h.emit('kg:auth-session-changed',{authenticated:true});assert.equal(h.memberButton.hidden,false);
 h.setUser({user:{username:'teacher',role:'teacher'}});await h.emit('kg:auth-session-changed',{authenticated:true});assert.equal(h.memberButton.hidden,true);
});

test('paid student visibility remains owned by the shared subscription decorator',async()=>{
 const h=harness();let calls=0;h.window.KGSubscription={decorateSubscriptionElements(){calls++;h.memberButton.hidden=true}};
 await h.emit('DOMContentLoaded');h.resolveUser({user:{username:'paid',role:'student'}});
 await h.window.KGDirectEntry.waitForInitialLearningEntry();assert.equal(h.memberButton.hidden,true);assert.ok(calls>0);
 await h.emit('kg:auth-session-changed',{authenticated:true});assert.equal(h.memberButton.hidden,true);
});


test('uncertain initial session preserves cached account and does not open a false login prompt',async()=>{
 const h=harness({KGAuthCore:{currentUser:()=>({username:'teacher',role:'teacher'})}});
 await h.emit('DOMContentLoaded');
 h.resolveUser({authenticated:null,user:null,loginSessionId:'',uncertain:true});
 await h.window.KGDirectEntry.waitForInitialLearningEntry();
 assert.equal(h.window.__KG_DIRECT_BOOTSTRAP__.username,'teacher');
 assert.equal(h.published.length,0);
 assert.equal(h.opened.length,0);
 assert.equal(h.memberButton.hidden,true);
});

test('uncertain entry without an account does not announce guest or open login',async()=>{
 const h=harness({__KG_DIRECT_BOOTSTRAP__:{}});
 await h.emit('DOMContentLoaded');
 h.resolveUser({authenticated:null,user:null,loginSessionId:'',uncertain:true});
 await h.window.KGDirectEntry.waitForInitialLearningEntry();
 assert.equal(h.published.length,0);
 assert.equal(h.opened.length,0);
 assert.equal(h.window.__KG_DIRECT_BOOTSTRAP__.authenticated,undefined);
});

test('genuine 401 during classroom recovery preserves bootstrap identity and role',async()=>{
 const h=harness({KGAuthCore:{currentUser:()=>({username:'teacher',role:'teacher'})},KGAuthRecovery:{isPaused:()=>true}});
 await h.emit('DOMContentLoaded');
 h.resolveUser({authenticated:false,user:null,loginSessionId:''});
 await h.window.KGDirectEntry.waitForInitialLearningEntry();
 assert.equal(h.window.__KG_DIRECT_BOOTSTRAP__.username,'teacher');
 assert.equal(h.published.length,0);
 assert.equal(h.opened.length,0);
 assert.equal(h.memberButton.hidden,true);
});

for(const oldUser of [null,{username:'old',role:'student'}]){
 test(`earlier ${oldUser?'authenticated':'anonymous'} promise cannot overwrite newer login publication`,async()=>{
  const h=harness();
  await h.emit('DOMContentLoaded');
  h.setUser({authenticated:true,user:{username:'new',role:'teacher'}});
  await h.emit('kg:auth-session-changed',{authenticated:true});
  assert.equal(h.window.__KG_DIRECT_BOOTSTRAP__.username,'new');
  h.resolveUser({authenticated:!!oldUser,user:oldUser});
  await h.window.KGDirectEntry.waitForInitialLearningEntry();
  assert.equal(h.window.__KG_DIRECT_BOOTSTRAP__.username,'new');
  assert.equal(h.memberButton.hidden,true);
  assert.equal(h.published.some(event=>event.detail?.username==='old'||event.detail?.authenticated===false),false);
 });
}


test('classroom recovery refreshes direct bootstrap without opening another learning chooser',async()=>{
 let chooserCalls=0;
 const h=harness({KGLearningEntryChooser:{init:()=>{chooserCalls++;return {shown:false}}}});
 await h.emit('DOMContentLoaded');h.resolveUser({user:{username:'teacher',role:'teacher'}});
 await h.window.KGDirectEntry.waitForInitialLearningEntry();
 const initialCalls=chooserCalls;
 h.setUser({user:{username:'teacher',role:'admin'}});
 await h.emit('kg:auth-recovered',{username:'teacher',saved:true});
 assert.equal(h.window.__KG_DIRECT_BOOTSTRAP__.authUser.role,'admin');
 assert.equal(chooserCalls,initialCalls);
});
