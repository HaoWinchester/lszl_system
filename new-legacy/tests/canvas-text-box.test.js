const test=require('node:test'),assert=require('node:assert/strict');
const G=require('../src/canvas/text-box-geometry.js');
const S=require('../src/canvas/text-edit-session.js');
test('snapshot area resize scales font, clamps four edges and preserves start',()=>{
 const start={x:10,y:20,width:200,height:100,fontSize:20};
 assert.ok(Math.abs(G.resize(start,'e',{x:200,y:0}).fontSize-28.284271247)<1e-8);
 assert.equal(G.resize(start,'se',{x:200,y:100}).fontSize,40);
 for(const h of ['n','s','e','w']){const r=G.resize(start,h,{x:40,y:30});assert.notEqual(r.fontSize,20);assert.ok(r.width>=40&&r.height>=24)}
 assert.equal(G.resize(start,'se',{x:1e5,y:1e5}).fontSize,288);
 assert.deepEqual(start,{x:10,y:20,width:200,height:100,fontSize:20});
});
test('failed commit retains editable draft and retries; cancel restores original',async()=>{
 let fail=true;const s=S.create({original:'old',persist:async()=>!fail});s.update('new');assert.equal(await s.commit(),false);assert.equal(s.state().status,'failed');assert.equal(s.state().draft,'new');fail=false;assert.equal(await s.commit(),true);assert.equal(s.state().status,'committed');assert.equal(s.cancel(),'old');
});
test('pending save never closes newer draft or commits during composition',async()=>{
 let resolve;const s=S.create({original:'a',persist:()=>new Promise(r=>resolve=r)});s.update('b');const pending=s.commit();await Promise.resolve();s.update('c');resolve(true);assert.equal(await pending,false);assert.equal(s.state().draft,'c');assert.equal(s.state().status,'draft');s.setComposing(true);assert.equal(await s.commit(),false);assert.equal(s.state().status,'draft');
});

test('synchronous persistence rejection remains retryable',async()=>{let fail=true;const s=S.create({original:'a',persist:()=>{if(fail)throw Error('offline');return true}});s.update('b');assert.equal(await s.commit(),false);fail=false;assert.equal(await s.commit(),true)});
