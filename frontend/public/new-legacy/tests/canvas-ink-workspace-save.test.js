'use strict';
const {test}=require('node:test');const assert=require('node:assert/strict');const fs=require('node:fs');const vm=require('node:vm');const path=require('node:path');
function setup(){
 let emit,mode='ok',saved=null;const deferred=[];
 const context={console:{error(){}},setTimeout,clearTimeout,CustomEvent:function(type,init){this.type=type;this.detail=init.detail},dispatchEvent(){},addEventListener(){},KGRolePermissions:{currentRole:()=>"teacher"},KGCanvasWorkspaceStore:{currentUserId:()=>"ink-test",subscribe:fn=>{emit=fn},listWorkspaces:()=>[]},fetch:async(url,options)=>{
  if(options.method==='GET')return {ok:true,json:async()=>({workspaces:[]})};
  const body=JSON.parse(options.body);
  if(mode==='defer')return new Promise(resolve=>deferred.push({resolve,body}));
  if(mode==='fail')return {ok:false,status:503,json:async()=>({detail:'offline'})};
  saved=body;return {ok:true,json:async()=>({workspace:body})};
 }};context.window=context;
 vm.runInNewContext(fs.readFileSync(path.join(__dirname,'../../frontend/scripts/new-legacy-assets/canvas-workspace-adapter.js'),'utf8'),context);
 return {api:context.KGCanvasWorkspaceAdapter,write:ws=>emit({workspace:ws,reason:'canvas-ink'}),mode:v=>{mode=v},saved:()=>saved,deferred};
}
const first={userId:'ink-test',id:'w1',title:'画布',strokes:[{id:'s1',tool:'pen',color:'#2563eb',width:3,opacity:.45,points:[[0,0],[10,20]]}]},latest={...first,strokes:[...first.strokes,{...first.strokes[0],id:'s2',opacity:0}]};
test('workspace failed writes stay visibly unsaved and explicit retry persists ink',async()=>{
 const s=setup();await s.api.ready;s.mode('fail');s.write(first);
 await assert.rejects(s.api.flush({throwOnError:true}));
 assert.equal(s.api.getState('w1').status,'failed');s.mode('ok');await s.api.flush({throwOnError:true});
 assert.equal(s.api.getState('w1').status,'saved');assert.deepEqual(s.saved().payload,first);
});
test('failed older request cannot replace a newer queued drawing',async()=>{
 const s=setup();await s.api.ready;s.mode('defer');s.write(first);const old=s.api.flush();await new Promise(r=>setImmediate(r));
 s.write(latest);s.mode('ok');s.deferred[0].resolve({ok:false,status:503,json:async()=>({detail:'offline'})});await old;
 await s.api.flush({throwOnError:true});assert.deepEqual(s.saved().payload,latest);
});

function navigationAdapter({readonly=false,draft=false,commit=true,saveState='saved',answers=0,answerFlushing=false,flush=async()=>{}}={}){
 const writes=[],calls=[],state={readonly,optionClickTimers:new Map(),answerQueue:Array(answers).fill({}),answerFlushing,workspace:{id:'navigation-canvas'},ink:{hasTextDraft:()=>draft,commitText:async()=>{calls.push('commit');return commit}}};
 const source=fs.readFileSync(path.join(__dirname,'../src/77-multi-question-workspace.js'),'utf8');
 const registration=source.match(/global\.KGLearningProgress\?\.registerAdapter\?\.\('multi_question_canvas',\{([\s\S]*?)\n    \}\);/);
 assert.ok(registration,'workspace learning adapter registration must exist');
 const adapter=vm.runInNewContext('({'+registration[1]+'})',{state,store:()=>({write:(workspace,options)=>writes.push({workspace,options})}),global:{KGCanvasWorkspaceAdapter:{getState:()=>({status:saveState}),flush:async options=>{calls.push('flush');assert.equal(options.throwOnError,true);return flush()}}},flushPendingOptionChoices:async()=>calls.push('choices'),flushAnswerQueue:async options=>{assert.equal(options.throwOnError,true);calls.push('answers')},clearPaperTransientState(){}});
 return {adapter,writes,calls};
}
test('workspace navigation awaits text draft and server persistence before leaving',async()=>{
 let finish;const pending=new Promise(resolve=>{finish=resolve});const s=navigationAdapter({draft:true,flush:()=>pending});
 assert.equal(typeof s.adapter.prepareLeave,'function');
 let left=false;const leave=s.adapter.prepareLeave().then(value=>{left=value});await new Promise(resolve=>setImmediate(resolve));
 assert.deepEqual(s.calls,['commit','choices','flush','answers']);assert.equal(s.writes[0].options.reason,'learning-navigation');assert.equal(left,false);
 finish();await leave;assert.equal(left,true);
});
test('workspace navigation keeps a failed text draft on the current page',async()=>{
 const s=navigationAdapter({draft:true,commit:false});assert.equal(typeof s.adapter.prepareLeave,'function');
 assert.equal(await s.adapter.prepareLeave(),false);assert.deepEqual(s.calls,['commit']);assert.equal(s.writes.length,0);
});
test('workspace navigation propagates server save failure so the caller can block leaving',async()=>{
 const s=navigationAdapter({flush:async()=>{throw new Error('offline')}});assert.equal(typeof s.adapter.prepareLeave,'function');
 await assert.rejects(s.adapter.prepareLeave(),/offline/);
});
test('readonly workspace navigation leaves without creating drafts or server writes',async()=>{
 const s=navigationAdapter({readonly:true,draft:true});assert.equal(typeof s.adapter.prepareLeave,'function');
 assert.equal(await s.adapter.prepareLeave(),true);assert.deepEqual(s.calls,[]);assert.equal(s.writes.length,0);
});

function answerQueueHarness(answer){
 const source=fs.readFileSync(path.join(__dirname,'../src/77-multi-question-workspace.js'),'utf8');
 const start=source.indexOf('  function enqueueAnswer('),end=source.indexOf('  function refreshSingleCardMarkupById(',start);
 const state={answerQueue:[],answerSync:new Map(),cards:new Map()};
 const context={state,global:{setTimeout(){},clearTimeout(){}},ANSWER_FLUSH_DELAY:2500,PracticeLearning:{answer,refresh:async()=>{}},notify(){},refreshSingleCardMarkup(){},refreshSingleCardMarkupById(){}};
 vm.runInNewContext(source.slice(start,end),context);return {...context,state};
}
test('workspace navigation rejects failed answer persistence and keeps the attempt available for retry',async()=>{
 let offline=true;const sent=[],s=answerQueueHarness(async payload=>{sent.push(payload);if(offline)throw new Error('answer offline')});
 const payload={requestId:'immutable-attempt',questionId:'q1',selectedAnswer:'B'};s.enqueueAnswer(payload,'n1');
 await assert.rejects(s.flushAnswerQueue({throwOnError:true}),/作答尚未保存/);
 assert.equal(s.state.answerQueue.length,1);offline=false;await s.flushAnswerQueue({throwOnError:true});
 assert.equal(s.state.answerQueue.length,0);assert.deepEqual(sent,[payload,payload]);
});
test('workspace navigation waits for an answer already in flight before leaving',async()=>{
 let finish;const response=new Promise(resolve=>{finish=resolve}),s=answerQueueHarness(()=>response);s.enqueueAnswer({requestId:'in-flight'},'n1');
 const autosave=s.flushAnswerQueue();let left=false;const leave=s.flushAnswerQueue({throwOnError:true}).then(()=>{left=true});
 await new Promise(resolve=>setImmediate(resolve));assert.equal(left,false);finish();await Promise.all([autosave,leave]);assert.equal(left,true);
});

test('workspace refresh protection tracks live drafts answer queues and remote save state',()=>{
 assert.equal(typeof navigationAdapter().adapter.hasUnsavedChanges,'function');
 assert.equal(navigationAdapter().adapter.hasUnsavedChanges(),false);
 for(const options of [{draft:true},{answers:1},{answerFlushing:true},{saveState:'pending'},{saveState:'saving'},{saveState:'failed'}]){
  assert.equal(navigationAdapter(options).adapter.hasUnsavedChanges(),true,JSON.stringify(options));
  assert.equal(navigationAdapter({...options,readonly:true}).adapter.hasUnsavedChanges(),false);
 }
});

test('pending single option click can be committed before navigation without a later duplicate',async()=>{
 const source=fs.readFileSync(path.join(__dirname,'../src/77-multi-question-workspace.js'),'utf8'),timers=new Map(),sent=[];
 const state={optionClickTimers:new Map()},context={state,OPTION_SINGLE_CLICK_DELAY:230,global:{setTimeout:fn=>{const id=timers.size+1;timers.set(id,fn);return id},clearTimeout:id=>timers.delete(id)},handleOptionSingleChoice:(record,key)=>sent.push([record.id,key])};
 const between=(start,end)=>source.slice(source.indexOf(start),source.indexOf(end,source.indexOf(start)));
 vm.runInNewContext(between('  function optionTimerKey(','  function clearOptionTransientState(')+between('  function scheduleOptionChoice(','  function handleOptionDoubleChoice('),context);
 context.scheduleOptionChoice({id:'n1'},'B');assert.equal(sent.length,0);
 assert.equal(typeof context.flushPendingOptionChoices,'function');await context.flushPendingOptionChoices();
 assert.deepEqual(sent,[['n1','B']]);assert.equal(state.optionClickTimers.size,0);assert.equal(timers.size,0);
});
