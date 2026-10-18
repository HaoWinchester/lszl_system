'use strict';
const assert=require('node:assert/strict');
const test=require('node:test');
const {curveHandles,controlsFromHandles,constrainWaypointDrag,moveRoute}=require('../src/graph/edge-geometry.js');

const near=(a,b)=>assert.ok(Math.abs(a-b)<1e-6,`${a} differs from ${b}`);
const nearPoint=(a,b)=>{near(a.x,b.x);near(a.y,b.y)};

test('on-curve handles at one and two thirds recover arbitrary cubic controls',()=>{
  for(const [start,end,controls] of [
    [{x:0,y:0},{x:300,y:120},[{x:80,y:-90},{x:270,y:220}]],
    [{x:-120,y:390},{x:24,y:-65},[{x:-400,y:800},{x:200,y:-750}]],
    [{x:15,y:15},{x:15,y:15},[{x:45,y:90},{x:-20,y:-80}]]
  ]){
    const handles=curveHandles(start,controls,end);
    const recovered=controlsFromHandles(start,handles,end);
    recovered.forEach((point,index)=>nearPoint(point,controls[index]));
  }
  const handles=curveHandles({x:0,y:0},[{x:30,y:0},{x:60,y:0}],{x:90,y:0});
  nearPoint(handles[0],{x:30,y:0});nearPoint(handles[1],{x:60,y:0});
});

test('moving either handle preserves the other actual point on the curve',()=>{
  const start={x:0,y:0},end={x:300,y:100},controls=[{x:60,y:-100},{x:240,y:180}];
  const original=curveHandles(start,controls,end);
  for(const index of [0,1]){
    const moved=original.map(point=>({...point}));moved[index]={x:moved[index].x+35,y:moved[index].y-45};
    const result=curveHandles(start,controlsFromHandles(start,moved,end),end);
    result.forEach((point,i)=>nearPoint(point,moved[i]));
  }
});

test('route translation moves endpoints and every manual point exactly once while preserving binding',()=>{
  const route={from:'a',to:'b',start:{x:0,y:0},end:{x:200,y:0},pathStyle:'curve',curveControls:[{x:40,y:100},{x:170,y:-30}],waypoints:[{x:85,y:20},{x:130,y:70}]};
  const result=moveRoute(route,{x:43,y:-27},{x:43,y:-27});
  assert.equal(result.from,'a');assert.equal(result.to,'b');
  assert.deepEqual(result.start,{x:43,y:-27});assert.deepEqual(result.end,{x:243,y:-27});
  assert.deepEqual(result.curveControls,[{x:83,y:73},{x:213,y:-57}]);
  assert.deepEqual(result.waypoints,[{x:128,y:-7},{x:173,y:43}]);
  assert.deepEqual(route.curveControls,[{x:40,y:100},{x:170,y:-30}]);
});

test('one moved endpoint weights each manual point by its original axial position',()=>{
  const route={from:'a',to:'b',start:{x:0,y:0},end:{x:200,y:0},curveControls:[{x:50,y:80},{x:150,y:80}],waypoints:[{x:100,y:40}]};
  const result=moveRoute(route,{x:0,y:0},{x:40,y:40});
  assert.deepEqual(result.curveControls,[{x:60,y:90},{x:180,y:110}]);
  assert.deepEqual(result.waypoints,[{x:120,y:60}]);
});

test('elbow waypoint drags are constrained to a single axis (boardmix-style)',()=>{
  // 垂直中间段（首末路径点 x 相同）：只允许水平拖动（锁 y）。
  const verticalTrunk=[{x:100,y:0},{x:100,y:80}];
  assert.deepEqual(constrainWaypointDrag({x:0,y:0},{x:200,y:80},verticalTrunk,0,{x:150,y:40}),{x:150,y:0});
  // 水平中间段：只允许纵向拖动（锁 x）。
  const horizontalTrunk=[{x:40,y:50},{x:160,y:50}];
  assert.deepEqual(constrainWaypointDrag({x:0,y:0},{x:200,y:100},horizontalTrunk,1,{x:180,y:90}),{x:160,y:90});
  // 单路径点：按整体 a→b 主导轴的垂直方向锁定（水平连线 → 折点只纵向滑动）。
  assert.deepEqual(constrainWaypointDrag({x:0,y:0},{x:300,y:20},[{x:150,y:-40}],0,{x:220,y:120}),{x:150,y:120});
  // 越界 index / 空路径点：原样返回。
  assert.deepEqual(constrainWaypointDrag({x:0,y:0},{x:1,y:1},[],0,{x:9,y:9}),{x:9,y:9});
  assert.deepEqual(constrainWaypointDrag({x:0,y:0},{x:1,y:1},verticalTrunk,5,{x:9,y:9}),{x:9,y:9});
});

test('a nearby curve midpoint drag preserves bound endpoints and moves the actual midpoint exactly',()=>{
  const geometry=require('../src/graph/edge-geometry.js');
  const route={from:'parent',to:'child',start:{x:120,y:80},end:{x:260,y:140},curveControls:[{x:150,y:80},{x:230,y:140}]};
  const old=geometry.curveMidpoint(route.start,route.curveControls,route.end);
  const result=geometry.bendCurveMidpoint(route,{x:6,y:-4});
  nearPoint(geometry.curveMidpoint(result.start,result.curveControls,result.end),{x:old.x+6,y:old.y-4});
  assert.equal(result.from,'parent');assert.equal(result.to,'child');assert.deepEqual(result.start,route.start);assert.deepEqual(result.end,route.end);
  const restored=geometry.bendCurveMidpoint(result,{x:-6,y:4});restored.curveControls.forEach((p,i)=>nearPoint(p,route.curveControls[i]));
});

test('elbow segment midpoint moves both adjacent bends on its perpendicular axis and preserves overlaps',()=>{
 const geometry=require('../src/graph/edge-geometry.js'),a={x:0,y:0},b={x:200,y:100},points=[{x:100,y:0},{x:100,y:100}];
 assert.deepEqual(geometry.segmentHandles(a,points,b).map(({x,y})=>({x,y})),[{x:50,y:0},{x:100,y:50},{x:150,y:100}]);
 assert.deepEqual(geometry.moveElbowSegment(a,b,points,1,{x:7,y:30}),[{x:107,y:0},{x:107,y:100}]);
 const moved=geometry.moveElbowSegment(a,b,points,0,{x:30,y:12});
 assert.deepEqual(moved,[{x:0,y:12},{x:100,y:12},{x:100,y:100}]);
 for(const [index,p] of [a,...moved,b].entries()){if(!index)continue;const prev=[a,...moved,b][index-1];assert(prev.x===p.x||prev.y===p.y)}
 assert.deepEqual(geometry.moveElbowSegment(a,b,points,1,{x:0,y:0}),points,'returning to the original pointer restores the route');
 assert.deepEqual(geometry.moveElbowSegment(a,b,points,1,{x:-100,y:0}),[{x:0,y:0},{x:0,y:100}],'overlapping segments stay valid');
});

test('polyline hit distance includes a short segment and overlapping routes',()=>{
 const {distanceToPolyline}=require('../src/graph/edge-geometry.js');
 near(distanceToPolyline({x:4,y:3},[{x:0,y:0},{x:10,y:0}]),3);
 near(distanceToPolyline({x:12,y:0},[{x:0,y:0},{x:10,y:0}]),2);
 near(distanceToPolyline({x:10,y:5},[{x:0,y:0},{x:10,y:0},{x:10,y:8}]),0);
});
