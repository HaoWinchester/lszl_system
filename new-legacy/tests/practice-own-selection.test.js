'use strict';
const {test}=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm'),path=require('node:path');
function load(){const context={window:{}};vm.createContext(context);for(const file of ['115-practice-mode-policy','111-practice-session-core','112-practice-answer-sheet'])vm.runInContext(fs.readFileSync(path.join(__dirname,'../src',file+'.js'),'utf8'),context);return context.window}
test('own selection summary reads only chosen single/multi/pair values and never correct fields',()=>{
  const api=load().KGPracticeAnswerSheet;
  assert.equal(typeof api.selectionSummary,'function','shared own-selection formatter missing');
  assert.equal(api.selectionSummary({type:'single_choice'},{selectedAnswer:'B',correctAnswer:'SECRET',correct:false}),'B');
  assert.equal(api.selectionSummary({type:'multiple_choice'},{selectedAnswerIds:['A','C'],correctOptionIds:['SECRET']}),'A、C');
  const matching={type:'matching',matching:{left:[{id:'l1',text:'左一'},{id:'l2',text:'左二'}],right:[{id:'r1',text:'右一'},{id:'r2',text:'右二'}],correctPairs:{l1:'r1',l2:'r2'}}};
  assert.equal(api.selectionSummary(matching,{selectedPairs:{l1:'r2',l2:'r1'}}),'左一 → 右二；左二 → 右一');
  assert.equal(api.selectionSummary(matching,{selectedPairs:{l1:'r2',l2:'r1'}},{compact:true}),'1→2；2→1');
  assert.equal(api.selectionSummary({},null),'');assert.equal(api.selectionSummary({},{timedOut:true,selectedAnswer:'__timeout__'}),'未选择（超时）');
});
test('answer sheet shows escaped own choices with neutral statuses and distinct current/marked context',()=>{
  const w=load(),root={innerHTML:'',addEventListener(){}};const sheet=w.KGPracticeAnswerSheet.mount(root);
  sheet.render({mode:'practice',runtimeState:{instantFeedback:false},questions:[{questionId:'q1'},{questionId:'q2'},{questionId:'q3'}],answers:{q1:{selectedAnswer:'<B>',correct:false,correctAnswer:'SECRET'},q2:{selectedAnswerIds:['A','C'],correct:true,correctOptionIds:['SECRET']}}},'q2','all',new Set(['q1']));
  assert.match(root.innerHTML,/我的选择：&lt;B&gt;/);assert.match(root.innerHTML,/我的选择：A、C/);
  assert.match(root.innerHTML,/practice-answer-choice/);assert.match(root.innerHTML,/is-current/);assert.match(root.innerHTML,/is-marked/);
  assert.ok(!/SECRET|正确|错误|错题|is-correct|is-wrong/.test(root.innerHTML));
  assert.match(root.innerHTML,/未答/);assert.match(root.innerHTML,/当前题/);
});
