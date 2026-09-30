'use strict';
const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const vm=require('node:vm');
function setup(options={}){
  const events={};const context={URL,location:{href:'https://example.test/edit',pathname:'/edit',search:'',assign:url=>events.destination=url},document:{addEventListener:(type,fn)=>events[type]=fn,removeEventListener(){}},addEventListener:(type,fn)=>events[type]=fn,removeEventListener(){}};
  vm.runInNewContext(fs.readFileSync(require('node:path').join(__dirname,'../src/shared/unsaved-guard.js'),'utf8'),context);
  let value='original';const guard=context.KGUnsavedGuard.create({read:()=>value,...options});
  return {guard,events,set:valueNext=>value=valueNext};
}
test('raw whitespace and invalid form values are dirty; stay preserves the draft',async()=>{
  const {guard,set}=setup({choose:async()=> 'stay'});set(' original ');assert.equal(guard.isDirty(),true);
  assert.equal(await guard.confirmLeave(),false);assert.equal(guard.isDirty(),true);
});
test('save must succeed and leave the draft clean before navigation',async()=>{
  let result=false;const {guard,set}=setup({choose:async()=> 'save',save:async()=>result});set('draft');
  assert.equal(await guard.confirmLeave(),false);assert.equal(guard.isDirty(),true);
  result=true;assert.equal(await guard.confirmLeave(),false,'a save that leaves new input dirty must not navigate');
  guard.markClean();assert.equal(await guard.confirmLeave(),true);
});
test('save errors preserve data, discard explicitly resets, and requests do not multiply',async()=>{
  let choice='save',reset=0;const {guard,set}=setup({choose:async()=>choice,save:async()=>{throw Error('offline')},discard:()=>{reset++;set('original')}});set('draft');
  assert.equal(await guard.confirmLeave(),false);assert.equal(reset,0);choice='discard';
  assert.equal(await guard.confirmLeave(),true);assert.equal(reset,1);assert.equal(guard.isDirty(),false);
});
test('refresh protection warns only while dirty and never triggers save',()=>{
  let saves=0;const {guard,set,events}=setup({save:()=>saves++});let prevented=0;
  const event={preventDefault(){prevented++}};events.beforeunload(event);assert.equal(prevented,0);
  set('draft');events.beforeunload(event);assert.equal(prevented,1);assert.equal(event.returnValue,'');assert.equal(saves,0);
  guard.markClean();events.beforeunload(event);assert.equal(prevented,1);
});

test('duplicate leave requests are blocked while one decision is pending',async()=>{
 let resolveChoice,calls=0;const {guard,set}=setup({choose:()=>{calls++;return new Promise(resolve=>resolveChoice=resolve)}});set('draft');const first=guard.confirmLeave();
 assert.equal(await guard.confirmLeave(),false);assert.equal(calls,1);resolveChoice('stay');assert.equal(await first,false);
});
test('navigation stays on failed save and navigates only after explicit discard',async()=>{
 let choice='save';const {set,events}=setup({choose:async()=>choice,save:async()=>false});set('draft');
 const event={button:0,target:{closest:()=>({href:'https://example.test/next'})},preventDefault(){},stopImmediatePropagation(){}};
 await events.click(event);assert.equal(events.destination,undefined);choice='discard';await events.click(event);assert.equal(events.destination,'https://example.test/next');
});
