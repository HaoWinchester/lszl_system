'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const vm=require('node:vm');

const source=fs.readFileSync(path.join(__dirname,'../src/86-knowledge-recall.js'),'utf8');
function harness({readonly=false,preview=false}={}){
  let identity={user:{username:'teacher',role:readonly?'viewer':'teacher'},loginSessionId:'old'};
  const fields={krPersonalTitle:{value:'原卡牌',focus(){this.focused=true}},krPersonalContent:{value:'原内容'}};
  const writes=[],notices=[];
  const c={console,setTimeout,clearTimeout,AbortController,
    CustomEvent:class{constructor(type,options={}){this.type=type;this.detail=options.detail}},
    addEventListener(){},dispatchEvent(){},
    KGAuthCore:{getCurrentSession:()=>identity,currentUser:()=>identity.user},
    $:id=>fields[id]||null,cssAttr:String,
    state:{activeNodeId:'instance',nodes:[{instanceId:'instance',dataId:'custom',custom:true,title:'原卡牌'}],customNodes:{custom:{title:'原卡牌',hint:'原内容'}}},
    recallSession:{permissions:{canWrite:!readonly}},recallTransitionBusy:false,
    progressChangeVersion:0,progressSavedVersion:0,progressSaveTimer:0,inkController:null,
    nodeLayer:{querySelector:()=>null},guide:{hidden:false,innerHTML:'editor',dataset:{}},guideDragging:false,
    document:{body:{classList:{contains:()=>readonly},append(){}},
      createElement:()=>({dataset:{},style:{},setAttribute(){},addEventListener(){},append(){},querySelector:()=>({})})},
    isTeacherDraftPreview:()=>preview,
    isRecallSessionReadonly:()=>c.KGAuthRecovery.isPaused()||readonly,
    isRecallReadonly:()=>c.isRecallSessionReadonly()||c.recallTransitionBusy,
    getNodeData:id=>c.state.customNodes[id],notifyRecallLimit:value=>notices.push(value),
    syncActiveNodeClass(){},renderSaveState(){},
    progressPayload:()=>JSON.parse(JSON.stringify({nodes:c.state.nodes,customNodes:c.state.customNodes})),
    recallAdapter:{getState:()=>({saveState:'saved'}),saveGraph:async graph=>{writes.push(graph)}},
  };
  c.window=c;c.globalThis=c;
  vm.createContext(c);
  // Recovery's DOM banner is unrelated to retaining the classroom draft.
  const doc=c.document;delete c.document;
  vm.runInContext(fs.readFileSync(path.join(__dirname,'../src/shared/auth-recovery.js'),'utf8'),c);
  c.document=doc;
  vm.runInContext(source.slice(source.indexOf('  function commitPersonalDraft(){'),source.indexOf('  function loadProgress(')),c);
  vm.runInContext(source.slice(source.indexOf('  function hideGuide(){'),source.indexOf('  function placeGuide(')),c);
  c.KGAuthRecovery.register('recall',{hasUnsavedChanges:c.hasRecallDraft,onRecovered:c.prepareRecallLeave});
  return {c,fields,writes,notices,expire(){
    const doc=c.document;delete c.document;c.KGAuthRecovery.observe({status:401},c.KGAuthRecovery.capture());c.document=doc;
  },async recover(){identity={...identity,loginSessionId:'new'};return c.KGAuthRecovery.acceptSession({username:'teacher',loginSessionId:'new'})}};
}

test('401 then closing custom-card guide retains exact title and content until same-owner recovery saves',async()=>{
  const h=harness(),{c,fields,writes}=h;
  fields.krPersonalTitle.value='保留标题';fields.krPersonalContent.value='保留第一行\n第二行';
  h.expire();assert.equal(c.closeGuide(),true);
  assert.equal(c.state.customNodes.custom.title,'保留标题');
  assert.equal(c.state.customNodes.custom.hint,'保留第一行\n第二行');
  assert.equal(c.state.nodes[0].title,'保留标题');
  assert.equal(c.KGAuthRecovery.hasUnsavedChanges(),true);
  assert.equal(writes.length,0,'expiry must only stage in page memory');
  await h.recover();
  assert.equal(writes.length,1);assert.equal(writes[0].customNodes.custom.hint,'保留第一行\n第二行');
  assert.equal(writes[0].nodes[0].title,'保留标题');
});

test('401 then pen-mode guide close keeps an empty-title draft visible instead of discarding its content',()=>{
  const h=harness(),{c,fields,writes}=h;
  fields.krPersonalTitle.value='';fields.krPersonalContent.value='尚未完成的输入';h.expire();
  assert.equal(c.closeGuide(),false);
  assert.equal(c.guide.hidden,false);assert.equal(c.guide.innerHTML,'editor');
  assert.equal(c.state.activeNodeId,'instance');assert.equal(fields.krPersonalContent.value,'尚未完成的输入');
  assert.equal(writes.length,0);assert.equal(c.state.customNodes.custom.title,'原卡牌');
});

for(const options of [{readonly:true},{preview:true}])test('recovery never stages forged editable inputs for '+JSON.stringify(options),()=>{
  const h=harness(options),{c,fields,writes}=h;
  fields.krPersonalTitle.value='禁止写入';fields.krPersonalContent.value='禁止写入';h.expire();c.closeGuide();
  assert.equal(c.state.customNodes.custom.title,'原卡牌');assert.equal(c.progressChangeVersion,0);assert.equal(writes.length,0);
});

test('server readonly permission blocks staging even if the page class is stale',()=>{
  const h=harness(),{c,fields}=h;c.recallSession.permissions.canWrite=false;
  fields.krPersonalTitle.value='不应写入';h.expire();c.closeGuide();
  assert.equal(c.state.customNodes.custom.title,'原卡牌');assert.equal(c.progressChangeVersion,0);
});

test('failed recovery save retains staged custom-card content and dirty revision for retry',async()=>{
  const h=harness(),{c,fields}=h;
  fields.krPersonalTitle.value='待重试';fields.krPersonalContent.value='网络失败仍保留';h.expire();c.closeGuide();
  c.recallAdapter.saveGraph=async()=>{throw new Error('503')};
  await h.recover();assert.equal(c.KGAuthRecovery.hasUnsavedChanges(),true);
  assert.equal(c.state.customNodes.custom.hint,'网络失败仍保留');
  let saved;c.recallAdapter.saveGraph=async graph=>{saved=graph};
  assert.equal(await c.prepareRecallLeave(),true);assert.equal(saved.customNodes.custom.hint,'网络失败仍保留');
  assert.equal(c.KGAuthRecovery.hasUnsavedChanges(),false);
});

test('unsubmitted new-child text remains dirty when 401 pauses the guide',()=>{
  const h=harness(),{c,fields}=h;
  fields.krCustomInput={value:'还没生成的知识点'};
  assert.equal(c.hasRecallDraft(),true);
  h.expire();assert.equal(c.hasRecallDraft(),true);
  assert.equal(c.KGAuthRecovery.hasUnsavedChanges(),true);
});

test('pen-mode close during expiry keeps unsubmitted new-child input without generating a node',()=>{
  const h=harness(),{c,fields,writes}=h;fields.krCustomInput={value:'待生成的知识点'};h.expire();
  assert.equal(c.closeGuide(),false);
  assert.equal(c.guide.hidden,false);assert.equal(c.guide.innerHTML,'editor');
  assert.equal(fields.krCustomInput.value,'待生成的知识点');assert.equal(c.state.activeNodeId,'instance');
  assert.equal(c.state.nodes.length,1);assert.equal(c.progressChangeVersion,0);assert.equal(writes.length,0);
});

test('blank new-child input allows guide closing during expiry',()=>{
  const h=harness(),{c,fields}=h;fields.krCustomInput={value:'  '};h.expire();
  assert.equal(c.hasRecallDraft(),false);assert.equal(c.closeGuide(),true);assert.equal(c.guide.hidden,true);
});

test('readonly viewer new-child input never creates a writable draft during expiry',()=>{
  const h=harness({readonly:true}),{c,fields}=h;fields.krCustomInput={value:'禁止生成'};h.expire();
  assert.equal(c.hasRecallDraft(),false);assert.equal(c.closeGuide(),true);assert.equal(c.progressChangeVersion,0);
});
