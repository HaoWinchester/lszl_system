'use strict';
const assert=require('node:assert/strict');
const test=require('node:test');
const {curveHandles,controlsFromHandles,moveRoute}=require('../src/graph/edge-geometry.js');

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
