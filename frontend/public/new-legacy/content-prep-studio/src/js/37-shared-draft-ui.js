/* Shared-draft landing and explicit save/sync workflow. */
(function(global){
  const Drafts=global.PMPPrepSharedDrafts;
  function root(){return document.getElementById('sharedDraftGate')}
  function listBox(){return document.getElementById('sharedDraftList')}
  function status(){return document.getElementById('sharedDraftGateStatus')}
  function setGateStatus(message,kind=''){const box=status();if(box){box.textContent=message;box.className=`shared-draft-status ${kind}`}}
  function setWorkspaceStatus(message,kind=''){
    const header=document.getElementById('hdrSaveStatus'),local=document.getElementById('localSaveStatus');
    if(header)header.textContent=message;
    if(local){local.textContent=message;local.className=`save-status ${kind}`}
  }
  function show(){root()?.classList.remove('hidden')}
  function hide(){root()?.classList.add('hidden')}
  function active(){return !!prepRuntime.draftId}
  function resetWorkspace(){
    state.knowledgeTree=null;
    state.recallLibrary={schemaVersion:1,nodes:[],edges:[],updatedAt:''};
    state.questionBank={id:generateSystemId('bank'),name:'PMP 内容准备题库',subject:'PMP',description:'',version:'1.0',visibility:'private',createdAt:Date.now(),updatedAt:Date.now(),questions:[]};
    state.principles={schemaVersion:1,items:[],updatedAt:Date.now()};
    state.synthesisPresets={schemaVersion:1,items:[],updatedAt:Date.now()};
    state.tagConfig={names:{},groupNames:{},categoryNames:{},aliases:{},slotAliases:{},looseAliases:{}};
    state.currentQuestionId='';state.currentRecallId='';state.currentPrincipleId='';state.demoQuestionId='';state.demoLang='zh';state.recallPreviewCandidateId='';
    prepRuntime.serverBankId='';prepRuntime.serverBankRevision=null;prepRuntime.lastIdempotencyKey='';prepRuntime.lastBatchId='';prepRuntime.lastUploadFingerprint='';
    refreshAll();setTab('base');
  }
  function activate(draft,{dirty=false}={}){
    prepRuntime.draftId=String(draft.id||'');prepRuntime.draftRevision=Number(draft.revision||0);prepRuntime.draftTitle=String(draft.title||'未命名草稿');
    prepRuntime.dirty=dirty;setWorkspaceStatus(dirty?`共享草稿“${prepRuntime.draftTitle}”有未保存修改`:`正在编辑共享草稿：${prepRuntime.draftTitle}`,dirty?'warn':'good');
    hide();
  }
  function renderList(drafts){
    const box=listBox();if(!box)return;
    if(!drafts.length){box.innerHTML='<div class="shared-draft-empty">暂无共享草稿。点击“新建共享草稿”开始录入。</div>';return}
    box.innerHTML=drafts.map(draft=>`<article class="shared-draft-row"><div><strong>${esc(draft.title)}</strong><small>更新人：${esc(draft.updatedBy||'—')} · ${draft.updatedAt?esc(new Date(draft.updatedAt).toLocaleString()):'刚刚'}</small></div><div class="toolbar"><button class="btn primary" data-open-draft="${esc(draft.id)}">打开</button><button class="btn danger" data-delete-draft="${esc(draft.id)}">删除</button></div></article>`).join('');
    box.querySelectorAll('[data-open-draft]').forEach(button=>button.onclick=()=>openDraft(button.dataset.openDraft));
    box.querySelectorAll('[data-delete-draft]').forEach(button=>button.onclick=()=>remove(button.dataset.deleteDraft));
  }
  async function reload(){
    const actor=prepRuntime.serverActor;if(!actor){setGateStatus('请先登录具有题库编辑权限的管理员或教师账号。','bad');renderList([]);return []}
    setGateStatus('正在读取共享草稿…');
    try{const drafts=await Drafts.list();renderList(drafts);setGateStatus(`共有 ${drafts.length} 个共享草稿，管理员和教师均可打开。`,'good');return drafts}
    catch(error){setGateStatus(error.message||'读取共享草稿失败。','bad');renderList([]);return []}
  }
  async function openDraft(id){
    setGateStatus('正在打开共享草稿…');
    try{const draft=await Drafts.get(id);applyWorkspacePayload(draft.payload);activate(draft);toast(`已打开共享草稿：${draft.title}`)}
    catch(error){setGateStatus(error.message||'打开共享草稿失败。','bad')}
  }
  async function create(){
    if(!prepRuntime.serverActor){setGateStatus('请先登录后再创建共享草稿。','bad');return}
    const title=String(prompt('请输入共享草稿名称','PMP 内容准备草稿')||'').trim();if(!title)return;
    resetWorkspace();setGateStatus('正在创建共享草稿…');
    try{const draft=await Drafts.create({title,payload:workspacePayload()});activate(draft);toast('共享草稿已创建')}
    catch(error){setGateStatus(error.message||'创建共享草稿失败。','bad')}
  }
  async function save(){
    if(!active())throw new Error('请先从共享草稿列表新建或打开一个草稿。');
    const saveButton=document.getElementById('btnSaveWorkspaceLocal');const headerButton=document.getElementById('btnQuickSaveWorkspace');
    if(prepRuntime.saveInFlight)return;prepRuntime.saveInFlight=true;saveButton&&(saveButton.disabled=true);headerButton&&(headerButton.disabled=true);
    setWorkspaceStatus('正在保存共享草稿…');
    try{
      const draft=await Drafts.save(prepRuntime.draftId,{title:prepRuntime.draftTitle,payload:workspacePayload(),revision:prepRuntime.draftRevision});
      activate(draft);prepRuntime.dirty=false;setWorkspaceStatus(`共享草稿已保存：${prepRuntime.draftTitle}`,'good');toast('共享草稿已保存');return draft;
    }catch(error){setWorkspaceStatus(error.message||'共享草稿保存失败','bad');throw error}
    finally{prepRuntime.saveInFlight=false;saveButton&&(saveButton.disabled=false);headerButton&&(headerButton.disabled=false)}
  }
  async function sync(){
    if(!active())throw new Error('请先保存或打开一个共享草稿。');
    if(prepRuntime.dirty)throw new Error('当前草稿有未保存修改，请先点击“保存共享草稿”。');
    if(!prepRuntime.serverActor)throw new Error('请先登录后再同步。');
    if(!prepRuntime.creatorProfile?.creatorId)throw new Error('请先选择制作人。');
    if(!prepRuntime.serverBankId)throw new Error('请先选择目标题库，或在第七步新建题库。');
    const button=document.getElementById('btnSyncToCatalog');button&&(button.disabled=true);setWorkspaceStatus('正在同步到主程序…');
    try{
      const result=await Drafts.sync(prepRuntime.draftId,{revision:prepRuntime.draftRevision,creatorId:prepRuntime.creatorProfile.creatorId});
      prepRuntime.draftId='';prepRuntime.draftRevision=0;prepRuntime.draftTitle='';prepRuntime.dirty=false;
      setWorkspaceStatus(`已同步到主程序 · 批次 ${result.batchId}`,'good');toast('同步成功，草稿已删除');show();await reload();return result;
    }catch(error){setWorkspaceStatus(error.message||'同步失败，草稿已保留','bad');throw error}
    finally{button&&(button.disabled=false)}
  }
  async function remove(id){
    if(!confirm('删除这个共享草稿？未同步的内容将无法恢复。'))return;
    try{await Drafts.remove(id);toast('共享草稿已删除');await reload()}catch(error){setGateStatus(error.message||'删除共享草稿失败。','bad')}
  }
  function openLanding(){show();return reload()}
  global.PMPPrepDraftUi=Object.freeze({open:openLanding,reload,create,openDraft,save,sync,remove,resetWorkspace,active});
})(window);
