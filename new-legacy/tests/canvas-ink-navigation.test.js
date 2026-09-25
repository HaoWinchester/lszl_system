'use strict';
const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const vm=require('node:vm');
const read=name=>fs.readFileSync(path.join(__dirname,'../src',name),'utf8');
function section(source,start,end){return source.slice(source.indexOf('  '+start),source.indexOf('  '+end))}
function deferred(){let resolve,reject;const promise=new Promise((yes,no)=>{resolve=yes;reject=no});return {promise,resolve,reject}}
function recall(){
  const pending=deferred(),notices=[];let activations=0;
  const context={recallTransitionBusy:false,recallAdapter:{},inkController:{cancel(){},reset(){}},questionSessionToken:0,
    isRecallReadonly:()=>context.recallTransitionBusy,
    setRecallTransitionBusy:value=>{context.recallTransitionBusy=value},
    flushProgress:()=>pending.promise,writeProgressNow:()=>pending.promise,cancelProgressSave(){},
    notifyRecallLimit:message=>notices.push(message),
    window:{KGRecallQuestionSource:{activate:async()=>{activations++;return {valid:false,errors:['not found']}}}}
  };
  vm.createContext(context);
  vm.runInContext(section(read('86-knowledge-recall.js'),'async function switchQuestion(bankId,questionId){','function bindQuestionDrawer(){'),context);
  return {context,pending,notices,activations:()=>activations};
}
test('recall freezes editing before delayed save and rejects overlapping navigation',async()=>{
  const s=recall(),first=s.context.switchQuestion('bank','next');
  assert.equal(s.context.isRecallReadonly(),true);
  assert.equal(await s.context.switchQuestion('bank','other'),false);
  s.pending.resolve(true);assert.equal(await first,false);
  assert.equal(s.activations(),1);assert.equal(s.context.isRecallReadonly(),false);
});
test('recall failed save keeps original session and restores editing',async()=>{
  const s=recall(),first=s.context.switchQuestion('bank','next');
  s.pending.resolve(false);assert.equal(await first,false);
  assert.equal(s.activations(),0);assert.equal(s.context.isRecallReadonly(),false);
  assert.match(s.notices[0],/尚未保存/);
});
test('recall transition flush bypasses only temporary lock, never session permission',async()=>{
  let sessionReadonly=false,writes=0;
  const context={recallTransitionBusy:true,progressSaveTimer:0,
    isRecallSessionReadonly:()=>sessionReadonly,isTeacherDraftPreview:()=>false,
    recallAdapter:{saveGraph:async()=>{writes++}},progressPayload:()=>({strokes:[]}),notifyRecallLimit(){}
  };
  vm.createContext(context);
  vm.runInContext(section(read('86-knowledge-recall.js'),'async function writeProgressNow(','function saveProgress(){'),context);
  assert.equal(await context.writeProgressNow(),false);assert.equal(writes,0);
  assert.equal(await context.writeProgressNow({allowTransition:true}),true);assert.equal(writes,1);
  sessionReadonly=true;
  assert.equal(await context.writeProgressNow({allowTransition:true}),false);assert.equal(writes,1);
});
test('recall reset freezes edits while pending and restores access on failure',async()=>{
  const pending=deferred(),notices=[];
  const context={recallTransitionBusy:false,recallSession:{versionState:'current'},
    isRecallReadonly:()=>context.recallTransitionBusy,confirm:()=>true,cancelProgressSave(){},
    setRecallTransitionBusy:value=>{context.recallTransitionBusy=value},
    recallAdapter:{resetToCurrent:()=>pending.promise},notifyRecallLimit:message=>notices.push(message)
  };
  vm.createContext(context);
  vm.runInContext(section(read('86-knowledge-recall.js'),'async function resetProgress(){','function isTextEditingTarget('),context);
  const result=context.resetProgress();assert.equal(context.isRecallReadonly(),true);
  assert.equal(await context.resetProgress(),false);
  pending.reject(new Error('offline'));await result;
  assert.equal(context.isRecallReadonly(),false);assert.equal(notices[0],'offline');
});
function workspace(){
  const pending=deferred(),notices=[],activated=[];
  const noop=()=>{};
  const state={workspaceId:'a',workspace:{id:'a'},workspaceTransition:false,readonly:false,
    ink:{cancel:noop,setTool:noop},sessionHighlights:new Map(),answerSelections:new Map(),persistentCorrectAnswers:new Map(),answerSync:new Map(),
    kernel:{history:{clear:noop},viewport:{cancelPersist:noop,sync:noop},cards:{cancelDrag:noop},selection:{cancel:noop}}};
  const context={state,global:{KGCanvasWorkspaceAdapter:{flush:()=>pending.promise}},
    store:()=>({setActiveWorkspace:id=>{activated.push(id);return {id,viewport:{}}}}),
    updateReadonly:()=>{state.readonly=state.workspaceTransition},notify:message=>notices.push(message),
    closeAnalysisPanel:noop,clearOptionTransientState:noop,clearCardSelection:noop,saveViewport:noop,
    renderWorkspaceSelector:noop,renderCards:noop,applyViewport:noop,refreshPersonalCardReferences:noop,replaceUrl:noop,
    recoverOffscreenWorkspaceViewport:noop,rebuildQuestionSources:noop,byId:()=>null,questionSourcesLoading:true,
    clamp:(n,min,max)=>Math.max(min,Math.min(max,n)),MIN_ZOOM:.01,MAX_ZOOM:4
  };
  vm.createContext(context);
  vm.runInContext(section(read('77-multi-question-workspace.js'),'function loadWorkspace(workspaceId,options={}){','function createWorkspace(){'),context);
  return {context,state,pending,notices,activated};
}
test('workspace activation waits for persistence and rejects concurrent switches',async()=>{
  const s=workspace(),first=s.context.loadWorkspace('b');
  assert.equal(s.state.workspaceId,'a');assert.equal(s.state.readonly,true);
  assert.equal(await s.context.loadWorkspace('c'),false);
  s.pending.resolve();assert.equal(await first,true);
  assert.equal(s.state.workspaceId,'b');assert.deepEqual(s.activated,['b']);assert.equal(s.state.readonly,false);
});
test('workspace save failure preserves active workspace and history for retry',async()=>{
  const s=workspace();let cleared=0;s.state.kernel.history.clear=()=>cleared++;
  const first=s.context.loadWorkspace('b');s.pending.reject(new Error('offline'));
  assert.equal(await first,false);assert.equal(s.state.workspaceId,'a');assert.equal(cleared,0);
  assert.equal(s.state.readonly,false);assert.match(s.notices[0],/offline/);
});
test('workspace initialization remains synchronous and an auth change cancels stale navigation',async()=>{
  const initial=workspace();initial.state.workspace=null;
  assert.equal(initial.context.loadWorkspace('first'),true);
  const s=workspace(),first=s.context.loadWorkspace('b');
  s.state.workspaceSession=1;s.state.workspaceId='other-user';
  s.pending.resolve();assert.equal(await first,false);
  assert.equal(s.state.workspaceId,'other-user');assert.deepEqual(s.activated,[]);
});
