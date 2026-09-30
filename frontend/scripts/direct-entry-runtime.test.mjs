import assert from 'node:assert/strict';
import test from 'node:test';
import vm from 'node:vm';
import {readFileSync} from 'node:fs';

function harness(){
  let resolveUser;const session=new Promise(resolve=>resolveUser=resolve);const events={};const opened=[];
  const location=new URL('http://localhost/practice-mode.html?auth=login&paperId=p1&sessionId=s1#lobby');
  const window={location,history:{state:null,replaceState(_s,_t,url){location.href=new URL(url,location).href}},
    KGAuthSessionBootstrap:{load:()=>session,refresh:()=>session},authOpen:msg=>opened.push(msg),
    addEventListener(name,fn){(events[name]??=[]).push(fn)},dispatchEvent(){},setTimeout:fn=>fn(),
    KGLearningEntryChooser:{init:()=>({shown:false})}};
  const context={window,document:{readyState:'loading',getElementById:()=>null},URL,URLSearchParams,
    CustomEvent:class{constructor(type,options){this.type=type;this.detail=options?.detail}}};
  vm.runInNewContext(readFileSync('scripts/new-legacy-assets/direct-entry.js','utf8'),context);
  const emit=async(name,detail)=>{for(const fn of events[name]||[])fn({detail});await new Promise(resolve=>setImmediate(resolve))};
  return {window,resolveUser,opened,emit};
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
