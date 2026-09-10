'use strict';
const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const vm=require('node:vm');
const path=require('node:path');
const context={window:{},console};vm.createContext(context);
for(const name of ['117-question-answer-set','114-practice-draft-state'])vm.runInContext(fs.readFileSync(path.join(__dirname,'../src',name+'.js'),'utf8'),context);
const A=context.window.KGQuestionAnswerSet,D=context.window.KGPracticeDraftState;
const question={type:'matching',matching:{left:[{id:'l1',text:'一'},{id:'l2',text:'二'}],right:[{id:'r1',text:'甲'},{id:'r2',text:'乙'}],correctPairs:{l1:'r2',l2:'r1'}}};
const plain=x=>JSON.parse(JSON.stringify(x));
const create=(answers={})=>D.create({questions:[{questionId:'q',question}],answers});
test('matching incomplete duplicate and foreign mappings cannot be submitted',()=>{
 for(const value of [{l1:'r2'},{l1:'r1',l2:'r1'},{l1:'r2',l3:'r1'},{l1:'r9',l2:'r1'}])assert.equal(create().select('q',value).accepted,false);
});
test('matching complete answer freezes a structured map without client correctness',()=>{
 const d=create();assert.equal(d.select('q',{l2:'r1',l1:'r2'}).answer.correct,true);
 assert.deepEqual(plain(d.submission()),{q:{selectedPairs:{l1:'r2',l2:'r1'},selectionIndex:1}});
 assert.equal(d.select('q',{l1:'r1',l2:'r2'}).accepted,false);
 const restored=create({...d.submission(),q:{...d.submission().q,correct:false}});
 assert.equal(restored.answer('q').correct,true);
});
test('matching wrong answer remains wrong and timeout is zero',()=>{
 assert.equal(create().select('q',{l1:'r1',l2:'r2'}).answer.correct,false);
 const d=create();assert.equal(d.select('q',{}, {timedOut:true}).answer.correct,false);
 assert.equal(create(d.submission()).answer('q').correct,false);
});
test('matching reassignment is immutable and releases an existing candidate',()=>{
 const prior={l1:'r1',l2:'r2'};
 assert.deepEqual(plain(A.assignPair(question,prior,'l1','r2')),{l1:'r2'});
 assert.deepEqual(prior,{l1:'r1',l2:'r2'});
 assert.deepEqual(plain(A.assignPair(question,prior,'l2','')),{l1:'r1'});
});
test('unknown types cannot submit as single choice',()=>{
 const d=D.create({questions:[{questionId:'u',question:{type:'unknown',options:[{id:'A'}],correctAnswer:'A'}}]});
 assert.equal(d.select('u','A').accepted,false);
});
