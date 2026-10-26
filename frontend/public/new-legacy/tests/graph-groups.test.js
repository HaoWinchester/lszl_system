'use strict';
const test=require('node:test'),assert=require('node:assert/strict');
const fs=require('node:fs'),vm=require('node:vm'),path=require('node:path');
function groups(){const file=path.join(__dirname,'../src/graph/group-controller.js');assert.ok(fs.existsSync(file),'persistent card grouping module must exist');return require(file)}
test('group membership expands a drag selection and merging stays flat',()=>{
  const g=groups(),nodes=[{id:'a'},{id:'b'},{id:'c'}];
  assert.equal(g.combine(nodes,['a','b'],()=> 'g1'),true);
  assert.deepEqual(g.expand(nodes,['a']),['a','b']);
  assert.equal(g.combine(nodes,['b','c'],()=> 'g2'),true);
  assert.deepEqual(nodes.map(n=>n.groupId),['g2','g2','g2']);
  assert.equal(g.ungroup(nodes,['a']),true);assert.ok(nodes.every(n=>!n.groupId));
});
test('singletons and invalid members are cleaned and a locked group cannot be changed',()=>{
 const g=groups(),nodes=[{id:'a',groupId:'g'},{id:'b',groupId:'g',locked:true},{id:'c',groupId:'orphan'}];
 g.normalize(nodes);assert.equal(nodes[2].groupId,undefined);
 assert.equal(g.combine(nodes,['a','c'],()=> 'new'),false);assert.equal(g.ungroup(nodes,['a']),false);
 nodes.pop();nodes.splice(1,1);g.normalize(nodes);assert.equal(nodes[0].groupId,undefined);
});
test('copy remaps group identity independently on every paste and drops singleton copies',()=>{
 groups();const f=require('../src/graph/graph-fragment.js');
 const source=f.capture({nodes:[{id:'a',groupId:'old'},{id:'b',groupId:'old'}],links:[]},{nodeIds:['a','b']});
 let id=0;const pasted=f.remap(source,{idFactory:()=>`copy-${++id}`}).fragment.nodes;
 assert.ok(pasted[0].groupId);assert.notEqual(pasted[0].groupId,'old');assert.equal(pasted[0].groupId,pasted[1].groupId);
 const second=f.remap(source,{idFactory:()=>`copy-${++id}`}).fragment.nodes;assert.notEqual(second[0].groupId,pasted[0].groupId);
 const one=f.remap(f.capture({nodes:source.nodes,links:[]},{nodeIds:['a']}),{idFactory:()=>`copy-${++id}`}).fragment.nodes;
 assert.ok(!one[0].groupId);
});
test('large graph thresholds no longer change edge visibility or disable bundling',()=>{
 const src=fs.readFileSync(path.join(__dirname,'../src/10-graph-editor.js'),'utf8');
 const body=src.match(/function isLargeGraphMode\(\)\{([^}]+)\}/)[1];
 const scope={result:null,state:{nodes:Array(200),links:Array(1200)},isLargeGraphPreferenceEnabled:()=>true,isGraphOverLargeThreshold:()=>true};
 vm.runInNewContext(`result=(function(){${body}})()`,scope);assert.equal(scope.result,false);
 const prefs=fs.readFileSync(path.join(__dirname,'../src/18-graph-user-preferences.js'),'utf8');
 assert.ok(!prefs.includes('data-pref="largeGraphMode"'));
});
