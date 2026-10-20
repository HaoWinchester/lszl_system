'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const file=path.join(__dirname,'../src/practice/knowledge-space-scene.js');
const exists=fs.existsSync(file);
test('standalone scene module is available',()=>assert.ok(exists,'knowledge-space-scene.js must exist'));
if(exists){
 const api=require(file);
 const nodes=Object.freeze(Array.from({length:60},(_,i)=>Object.freeze({...(i%2?{id:`topic-${i}`} :{}),title:`考点 ${i}`,subject:i<30?'数学':'英语',taxonomyId:i%3,brightness:i/60})));
 test('deterministic 3D layout preserves caller data and stable missing-id keys',()=>{
  const before=JSON.stringify(nodes),a=api.createModel(nodes),b=api.createModel(nodes);
  assert.deepEqual(a,b);assert.equal(a.points.length,60);assert.ok(new Set(a.points.map(p=>p.z)).size>1);
  assert.ok(new Set(a.points.map(p=>`${p.x},${p.y},${p.z}`)).size>1);assert.equal(new Set(a.points.map(p=>p.key)).size,60);
  assert.equal(JSON.stringify(nodes),before);assert.equal(a.points[0].node,nodes[0]);
  assert.equal(a.points[0].group,'["数学",""]');
 });
 test('organization edges only join matching subject and classification',()=>{
  const m=api.createModel(nodes);assert.equal(m.groups.length,6);assert.ok(m.edges.length>0);
  for(const edge of m.edges){const a=m.points[edge.source],b=m.points[edge.target];assert.equal(a.group,b.group);assert.equal(edge.group,a.group)}
 });
 test('bounded gravity converges without nonfinite or collapsed coordinates',()=>{
  const m=api.createModel(nodes),initial=m.points.map(p=>[p.x,p.y,p.z]);let moving=true,steps=0;
  while(moving&&steps<1000){moving=api.stepModel(m);steps++}
  assert.equal(moving,false);assert.ok(steps<1000);assert.ok(steps>1);assert.notDeepEqual(m.points.map(p=>[p.x,p.y,p.z]),initial);
  assert.ok(m.points.every(p=>[p.x,p.y,p.z,p.vx,p.vy,p.vz].every(Number.isFinite)));
  for(let i=0;i<m.points.length;i++)for(let j=0;j<i;j++)assert.ok(Math.hypot(m.points[i].x-m.points[j].x,m.points[i].y-m.points[j].y,m.points[i].z-m.points[j].z)>1);
  const settled=JSON.stringify(m);assert.equal(api.stepModel(m),false);assert.equal(JSON.stringify(m),settled);
 });
 test('empty, single node and oversized input are safe and bounded to one page',()=>{
  const empty=api.createModel([]);assert.deepEqual(empty.points,[]);assert.equal(api.stepModel(empty),false);
  const single=api.createModel([{title:'唯一考点'}]);let moving=true;for(let i=0;i<1000&&moving;i++)moving=api.stepModel(single);
  assert.equal(moving,false);assert.ok(single.points.every(p=>[p.x,p.y,p.z].every(Number.isFinite)));
  assert.equal(api.createModel(Array.from({length:1000},()=>({}))).points.length,60);
  assert.equal(api.mount({host:null,nodes:[]}),null);
 });
 test('perspective has depth and camera rotation/zoom affect projection',()=>{
  const camera={yaw:0,pitch:0,zoom:1},p={x:100,y:50,z:50},before=JSON.stringify(p);
  const a=api.projectPoint(p,camera,800,500),b=api.projectPoint(p,{...camera,yaw:.5,pitch:.2},800,500),c=api.projectPoint(p,{...camera,zoom:2},800,500);
  assert.notEqual(a.x,b.x);assert.notEqual(a.y,b.y);assert.ok(c.scale>a.scale);assert.ok(c.x-400>a.x-400);
  assert.ok(api.projectPoint({...p,z:-100},camera,800,500).scale>a.scale);assert.equal(JSON.stringify(p),before);
 });
}
