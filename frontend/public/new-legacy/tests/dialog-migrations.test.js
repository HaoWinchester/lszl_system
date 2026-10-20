'use strict';
const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const vm=require('node:vm');
const read=name=>fs.readFileSync(path.join(__dirname,'..',name),'utf8');

test('graph batch deletion awaits a decision, preserves cancellation and ignores a replaced graph',async()=>{
  const source=read('src/10-graph-editor.js');
  const fn=source.slice(source.indexOf('async function deleteGraphBatchSelection(){'),source.indexOf('function deleteSelectedNodesBatch()'));
  for(const [approved,replaced] of [[false,false],[true,false],[true,true]]){
    let decide,histories=0;
    const node={id:'a',title:'A'},state={nodes:[node],links:[],selectedNodeId:'a'};
    const context={state,selectedNodeIds:new Set(['a']),selectedLinkIds:new Set(),
      graphModeAllows:()=>true,nodeById:id=>state.nodes.find(n=>n.id===id),linkById:()=>null,
      lockedNodeIdsFrom:()=>[],authRequire:()=>true,
      window:{KGDialogs:{confirm:()=>new Promise(resolve=>{decide=resolve})}},
      pushGraphUndoSnapshot:()=>histories++,relatedGatherLayout:null,relatedScopeAnchorNodeId:null,
      hideSelectedEdgeQuickStylePanel(){},hideEdgeInlineLabelEditor(){},render(){},showStatus(){}};
    vm.createContext(context);vm.runInContext(fn+'\nglobalThis.remove=deleteGraphBatchSelection;',context);
    const deleting=context.remove();
    assert.equal(state.nodes.length,1);assert.equal(histories,0,'pending dialog cannot mutate');
    if(replaced)state.nodes=[{id:'a',title:'different file'}];
    decide(approved);await deleting;
    assert.equal(state.nodes.length,approved&&!replaced?0:1);
    assert.equal(histories,approved&&!replaced?1:0);
  }
});

test('Prep principle conflict closure cancels the entire merge; incoming replacement is explicit',async()=>{
  const source=read('content-prep-studio/src/js/40-events-bootstrap.js');
  const fn=source.slice(source.indexOf('async function importPrincipleBundleSafe(payload){'),source.indexOf("document.getElementById('fileTagConfig')"));
  for(const choice of [null,'采用导入','unexpected']){
    let applied=0;
    const context={window:{KGDialogs:{prompt:async()=>choice}},canonicalPrincipleDomain:()=>({}),
      planPrincipleMerge:()=>({conflicts:[{type:'preset-rebind',presetId:'p',existingPrincipleId:'old',incomingPrincipleId:'new'}],added:[],unchanged:[]}),
      applyPrincipleMergePlan:plan=>{applied++;assert.equal(plan.conflicts[0].resolution,'take-incoming');return {}},
      state:{principles:{},synthesisPresets:{}}};
    vm.createContext(context);vm.runInContext(fn+'\nglobalThis.merge=importPrincipleBundleSafe;',context);
    const result=await context.merge({});
    assert.equal(result.cancelled,choice!=='采用导入');
    assert.equal(applied,choice==='采用导入'?1:0);
  }
});

test('permission denial keeps its synchronous false return while using a shared notification',()=>{
  const source=read('src/34-role-permissions.js');
  const fn=source.slice(source.indexOf('function requirePermission('),source.indexOf('function renderPermissionDenied('));
  let messages=0;
  const context={can:()=>false,PERMISSION_LABELS:{},currentUser:()=>null,window:{KGDialogs:{alert:async()=>{messages++}}}};
  vm.createContext(context);vm.runInContext(fn+'\nglobalThis.check=requirePermission;',context);
  assert.equal(context.check('delete'),false);assert.equal(messages,1);
});

test('a previous owner cannot continue the Prep conflict recovery chain after a dialog await',async()=>{
  const source=read('content-prep-studio/src/js/38-shared-draft-autosave.js');
  let owner='A',resolveChoice,actions=0;
  const context={prepRuntime:{draftId:'A-draft',dirty:true},window:{
    KGAuthCore:{currentUser:()=>({username:owner})},KGDialogs:{prompt:()=>new Promise(resolve=>{resolveChoice=resolve})},
    PMPPrepDraftUi:{save:async()=>{throw Object.assign(new Error('conflict'),{status:409})},openDraft:async()=>actions++},
    addEventListener(){}},setTimeout,clearTimeout,localStorage:{getItem:()=>null},
    markWorkspaceDirty(){},updateWorkspaceSaveStatus(){},toast(){}};
  vm.createContext(context);vm.runInContext(source,context);
  const recovering=context.window.PMPPrepAutosave.runNow();
  await new Promise(resolve=>setImmediate(resolve));
  owner='B';context.prepRuntime.draftId='B-draft';context.prepRuntime.dirty=false;
  resolveChoice('重新载入');await recovering;
  assert.equal(actions,0);assert.equal(context.prepRuntime.draftId,'B-draft');assert.equal(context.prepRuntime.dirty,false);
});
