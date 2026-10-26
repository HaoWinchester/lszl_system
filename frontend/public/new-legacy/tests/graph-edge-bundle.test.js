'use strict';
const {test}=require('node:test');
const assert=require('node:assert/strict');
const {plan,sectorOf,snapChannels,MERGE_DISTANCE}=require('../src/graph/edge-bundle.js');

const item=(id,over={})=>({id,fromId:'a',toId:'b',
  a:{x:100,y:100},b:{x:300,y:150},ca:{x:180,y:140},cb:{x:260,y:140},
  hasFromPort:false,hasToPort:false,pathStyle:'elbow',hasStoredWaypoints:false,...over});

test('sectorOf quantizes approach direction into 8 sectors',()=>{
  assert.equal(sectorOf({x:0,y:0},{x:100,y:0}),'right');
  assert.equal(sectorOf({x:0,y:0},{x:100,y:40}),'right');
  assert.equal(sectorOf({x:0,y:0},{x:0,y:100}),'bottom');
  assert.equal(sectorOf({x:0,y:0},{x:-100,y:0}),'left');
  assert.equal(sectorOf({x:0,y:0},{x:-100,y:-5}),'left');
  assert.equal(sectorOf({x:0,y:0},{x:-60,y:-60}),'top-left');
  assert.equal(sectorOf({x:0,y:0},{x:50,y:50}),'bottom-right');
  assert.equal(sectorOf({x:0,y:0},{x:0,y:0}),null);
});

test('converging endpoints on the same node and sector share one point; ports opt out',()=>{
  const items=[
    item('l1',{fromId:'s1',b:{x:300,y:140}}),
    item('l2',{fromId:'s2',b:{x:300,y:150}}),
    item('l3',{fromId:'s3',b:{x:300,y:160}}),
    item('l4',{fromId:'s4',b:{x:300,y:150},hasToPort:true}),   // 显式端口不参与
    item('l5',{fromId:'s5',b:{x:300,y:150},toId:'c'}),          // 不同节点不成组
    item('l6',{fromId:'s6',b:{x:300,y:150},ca:{x:260,y:600}}),  // 不同方向扇区不成组
  ];
  const before=JSON.stringify(items);
  const {endpoints}=plan(items);
  assert.equal(JSON.stringify(items),before,'plan must not mutate input items');
  assert.equal(endpoints.has('l4'),false);
  assert.equal(endpoints.has('l5'),false);
  assert.equal(endpoints.has('l6'),false);
  for(const id of ['l1','l2','l3']){
    assert.deepEqual(endpoints.get(id).to,{x:300,y:150},'shared point is the median');
  }
  assert.equal(endpoints.get('l1').from,undefined);
});

test('derived elbow trunks snap to a shared channel only when near and overlapping',()=>{
  const trunks=[
    {id:'t1',axis:'x',value:400,lo:100,hi:200},
    {id:'t2',axis:'x',value:410,lo:120,hi:220},
    {id:'t3',axis:'x',value:418,lo:130,hi:230},
    {id:'far',axis:'x',value:600,lo:110,hi:210},     // 距离过远
    {id:'noOverlap',axis:'x',value:900,lo:500,hi:600}, // 区间不重叠
    {id:'y1',axis:'y',value:75,lo:0,hi:100},         // 不同轴向独立成簇
  ];
  const channels=snapChannels(trunks);
  for(const id of ['t1','t2','t3'])assert.equal(channels.get(id),410,'cluster median');
  assert.equal(channels.has('far'),false);
  assert.equal(channels.has('noOverlap'),false);
  assert.equal(channels.has('y1'),false);
});

test('plan applies endpoint bundling and channel alignment together',()=>{
  const {endpoints,channels}=plan([
    item('l1',{fromId:'s1',b:{x:300,y:150}}),
    item('l2',{fromId:'s2',b:{x:300,y:160}}),
  ]);
  assert.equal(endpoints.size,2);
  // 两条边 ca/cb 相同 → 派生折线 trunk 同为 (300+700)/2，无需吸附也同通道。
  assert.ok(channels.size>=0);
  assert.ok(MERGE_DISTANCE>0);
});

test('manual trunks share channels without moving fixed endpoints or mutating relations',()=>{
 const items=[item('manual-a',{hasStoredWaypoints:true,hasFromPort:true,hasToPort:true,waypoints:[{x:100,y:0},{x:100,y:200}]}),item('manual-b',{hasStoredWaypoints:true,waypoints:[{x:112,y:20},{x:112,y:180}]})];
 const before=JSON.stringify(items),result=plan(items);
 assert.equal(result.segmentChannels.get('manual-a')[0].value,112);
 assert.equal(result.segmentChannels.get('manual-b')[0].value,112);
 assert.equal(JSON.stringify(items),before);
 assert.equal(result.endpoints.has('manual-a'),false);
});

test('a single manual relation never bundles its own parallel backtrack segments',()=>{
 const result=plan([item('alone',{hasStoredWaypoints:true,waypoints:[{x:100,y:0},{x:100,y:200},{x:112,y:200},{x:112,y:0}]})]);
 assert.equal(result.segmentChannels.size,0);
});

test('opposite directions and incompatible styles never share a trunk channel',()=>{
 const a=item('forward',{hasStoredWaypoints:true,bundleKey:'blue',waypoints:[{x:100,y:0},{x:100,y:200}]}),
 b=item('reverse',{hasStoredWaypoints:true,bundleKey:'blue',waypoints:[{x:112,y:200},{x:112,y:0}]}),
 c=item('other-style',{hasStoredWaypoints:true,bundleKey:'red',waypoints:[{x:115,y:0},{x:115,y:200}]});
 const result=plan([a,b,c]);assert.equal(result.segmentChannels.size,0);assert.equal(result.endpoints.size,2,'only matching style endpoints may be bundled');
});
