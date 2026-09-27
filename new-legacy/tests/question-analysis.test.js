'use strict';
const {test}=require('node:test');const assert=require('node:assert/strict');
require('../src/95-recall-association-library.js');
const analysis=require('../src/119-question-analysis.js');
test('imported keywords without explain and library-only concepts remain available',()=>{
 const question={clues:[{id:'a',text:'预算',recallNodeId:'budget'},{id:'b',text:'项目经理'}],options:[{id:'A',text:'估算',trap:''}]};
 const result=analysis.sections(question,{nodes:[{id:'budget',title:'预算估算',hint:'先判断估算层级'}]});
 assert.equal(result.concepts[0].title,'预算估算');assert.equal(result.concepts[0].rule,'先判断估算层级');
 assert.deepEqual(result.clues.map(c=>c.text),['预算','项目经理']);assert.deepEqual(result.traps,[]);
 assert.equal(result.clueTitle,'关键词');assert.equal(question.concepts,undefined);
});
test('explicit concepts and core keyword selection retain authored content',()=>{
 const result=analysis.sections({concepts:[{title:'原有知识',rule:'原有讲解'}],clues:[{text:'普通'},{text:'重点',isCore:true,explain:'讲解'}],options:[{id:'B',trap:'原有选项提示'}]},{nodes:[]});
 assert.equal(result.concepts[0].rule,'原有讲解');assert.deepEqual(result.clues.map(c=>c.text),['重点']);assert.equal(result.clueTitle,'核心关键词');assert.equal(result.traps[0].trap,'原有选项提示');
});
test('library loads deduplicate concurrent requests and failures remain retryable',async()=>{
 let calls=0;const api=analysis.createLibraryLoader(async()=>{calls++;return {ok:calls>1,json:async()=>({payload:{nodes:[{id:'x',title:'X'}]}})}});
 await assert.rejects(api.load('PMP'));const [a,b]=await Promise.all([api.load('PMP'),api.load('PMP')]);assert.equal(calls,2);assert.equal(a,b);assert.equal(api.peek('PMP').nodes[0].id,'x');
});

test('imported entry titles, aliases and English names use the existing recall resolver',()=>{
 const library={nodes:[{id:'budget',title:'预算估算',titleEn:'Budget Estimate',aliases:['成本估算'],hint:'已有说明'}]};
 for(const recallNodeId of ['budget','预算估算','成本估算','Budget Estimate']){
  assert.equal(analysis.sections({clues:[{text:'估算',recallNodeId}]},library).concepts[0].title,'预算估算');
 }
});

test('option hints reuse the authored elimination step without parsing or inventing explanations',()=>{
 const content='A：原说明A。；B：原说明B。';
 const q={options:[{id:'A',trap:''}],reasoningSteps:[{title:'逐项排除',content}]};
 assert.equal(analysis.sections(q).traps[0].trap,content);
 q.options[0].trap='已有逐项提示';assert.equal(analysis.sections(q).traps[0].trap,'已有逐项提示');
 assert.equal(analysis.sections({reasoningSteps:[{title:'其他步骤',content}]}).traps.length,0);
});
