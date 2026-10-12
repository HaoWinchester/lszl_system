'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const library=require('../src/95-recall-association-library.js');
const flow=require('../src/recall/deep-recall-flow-model.js');
const fixture={nodes:[{id:'baseline',title:'进度基准',aliases:['Baseline']},{id:'one',title:'同名'},{id:'two',title:'同名'}],edges:[]};
test('automatic exact resolution rejects substrings and ambiguous titles, while search stays fuzzy',()=>{
  assert.equal(library.resolveExact(fixture,'进度'),null);
  assert.equal(library.resolveExact(fixture,'同名'),null);
  assert.equal(library.resolveExact(fixture,' ＢＡＳＥＬＩＮＥ ').id,'baseline');
  assert.equal(library.resolve(fixture,'进度').id,'baseline');
  assert.equal(library.resolveExact({nodes:[{id:'a',title:'甲',aliases:['别名']},{id:'b',title:'别名'}]},'别名'),null);
});
test('explicit binding precedes text and invalid binding never falls through',()=>{
  assert.equal(flow.resolveKeywordRoot({text:'进度',recallNodeId:'baseline'},[],fixture,library).nodeId,'baseline');
  assert.equal(flow.resolveKeywordRoot({text:'进度基准',recallNodeId:'deleted'},[],fixture,library).custom,true);
  assert.equal(flow.resolveKeywordRoot({text:'同名',recallNodeId:'baseline',conceptIds:['other']},[{id:'other',title:'其他'}],fixture,library).matchSource,'explicit');
});
test('unique legal concept association survives and multiple concepts remain custom',()=>{
  const concepts=[{id:'concept',title:'合法概念',summary:'保留内容'},{id:'other',title:'另一概念'}];
  assert.equal(flow.resolveKeywordRoot({text:'进度',conceptIds:['concept']},concepts,fixture,library).nodeId,'concept');
  assert.equal(flow.resolveKeywordRoot({text:'进度',conceptIds:['concept','other']},concepts,fixture,library).custom,true);
  assert.equal(flow.resolveKeywordRoot({text:'进度'},concepts,fixture,library).custom,true);
  assert.equal(flow.resolveKeywordRoot({text:'进度基准',conceptIds:['gone']},concepts,fixture,library).custom,true);
  assert.equal(flow.resolveKeywordRoot({text:'进度',conceptIds:['concept']},[{id:'concept',recallNodeId:'baseline'}],fixture,library).nodeId,'baseline');
});
