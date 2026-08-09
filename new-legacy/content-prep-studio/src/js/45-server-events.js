/* Server catalog UI wiring. Runs after the original local event bootstrap. */
(function(){
  const Catalog=PMPPrepServices.ServerCatalogService;
  const actor=prepRuntime.serverActor;
  const actorName=document.getElementById('serverActorName');
  const creatorName=document.getElementById('serverCreatorName');
  const status=document.getElementById('serverCatalogStatus');
  const bankSelect=document.getElementById('serverBankSelect');
  const createButton=document.getElementById('btnCreateServerBank');
  const loadButton=document.getElementById('btnLoadServerQuestion');
  const syncButton=document.getElementById('btnSyncToCatalog');
  const questionInput=document.getElementById('serverQuestionIdInput');
  const issuesBox=document.getElementById('serverCatalogIssues');

  function setStatus(message,kind=''){
    status.textContent=message;status.className=`server-status ${kind}`;
  }
  function setIssues(error){
    const issues=Array.isArray(error?.issues)?error.issues:[];
    issuesBox.innerHTML=issues.map(issue=>`<div>${esc(issue.field||issue.questionId||'题目')}：${esc(issue.message||issue.code||'校验失败')}</div>`).join('');
  }
  function serverEnabled(){return !!(actor&&prepRuntime.creatorProfile&&prepRuntime.serverBankId)}
  function refreshButtons(){
    const authenticated=!!actor;
    createButton.disabled=!authenticated||!prepRuntime.creatorProfile;
    loadButton.disabled=!authenticated||!questionInput.value.trim();
    syncButton.disabled=!serverEnabled()||!state.questionBank.questions.length;
  }
  function renderActor(){
    actorName.textContent=actor?(actor.display_name||actor.displayName||actor.username):'未登录';
    creatorName.textContent=prepRuntime.creatorProfile?.name||'请先选择';
    if(!actor)setStatus('未登录 · 本地草稿仍可编辑','warn');
  }
  function renderBanks(banks){
    bankSelect.innerHTML='<option value="">请选择题库</option>'+banks.map(bank=>`<option value="${esc(bank.id)}">${esc(bank.name)} · ${esc(bank.accessMode||'可编辑')}</option>`).join('');
    if(prepRuntime.serverBankId&&banks.some(bank=>bank.id===prepRuntime.serverBankId))bankSelect.value=prepRuntime.serverBankId;
    refreshButtons();
  }
  async function refreshBanks(){
    if(!actor){renderBanks([]);return}
    setStatus('正在连接服务器…');setIssues(null);
    try{
      const banks=await Catalog.listWritableBanks(state.questionBank.subject||'PMP');prepRuntime.serverBanks=banks;renderBanks(banks);
      setStatus(`服务器已连接 · ${banks.length} 个可编辑题库`,'good');
      return banks;
    }catch(error){prepRuntime.serverBanks=[];renderBanks([]);setStatus(error.message,'bad');setIssues(error);return []}
  }
  bankSelect.addEventListener('change',()=>{
    prepRuntime.serverBankId=bankSelect.value;
    const bank=prepRuntime.serverBanks?.find(item=>item.id===bankSelect.value);
    prepRuntime.serverBankRevision=Number(bank?.revision||0)||null;
    markWorkspaceDirty();refreshButtons();
  });
  createButton.addEventListener('click',async()=>{
    const name=prompt('请输入新题库名称',state.questionBank.name||'PMP 内容准备题库');if(!name?.trim())return;
    createButton.disabled=true;setStatus('正在新建题库…');setIssues(null);
    try{
      const bank=await Catalog.createBank({
        name:name.trim(),subject:state.questionBank.subject||'PMP',description:state.questionBank.description||'',
        visibility:state.questionBank.visibility==='published'?'published':'private',creatorId:prepRuntime.creatorProfile.creatorId
      });
      prepRuntime.serverBankId=bank.id;prepRuntime.serverBankRevision=Number(bank.revision||1);
      await refreshBanks();bankSelect.value=bank.id;markWorkspaceDirty();await saveWorkspaceLocal({silent:true});
      setStatus('题库已创建，可开始同步','good');
    }catch(error){setStatus(error.message,'bad');setIssues(error)}finally{refreshButtons()}
  });
  questionInput.addEventListener('input',refreshButtons);
  loadButton.addEventListener('click',async()=>{
    const id=questionInput.value.trim();if(!id)return;
    loadButton.disabled=true;setStatus('正在从服务器载入题目…');setIssues(null);
    try{
      const remote=await Catalog.loadQuestion(id),question=QuestionService.normalize({
        ...remote,serverRevision:remote.revision,serverContentHash:remote.contentHash,lastSyncedAt:nowIso()
      },state.questionBank.questions.length,remote.subject||state.questionBank.subject);
      const index=state.questionBank.questions.findIndex(item=>item.id===question.id);
      if(index>=0)state.questionBank.questions[index]=question;else state.questionBank.questions.push(question);
      prepRuntime.serverBankId=remote.bankId||prepRuntime.serverBankId;
      state.currentQuestionId=question.id;refreshAll();markWorkspaceDirty();await saveWorkspaceLocal({silent:true});
      setStatus('题目已从服务器载入','good');
    }catch(error){setStatus(error.message,'bad');setIssues(error)}finally{refreshButtons()}
  });
  syncButton.addEventListener('click',async()=>{
    syncButton.disabled=true;setStatus('正在同步到题库…');setIssues(null);
    try{
      const result=await Catalog.uploadBundle(ExportService.completeBundle(),{
        workspace:prepRuntime,creatorId:prepRuntime.creatorProfile.creatorId,
        questions:state.questionBank.questions,prepVersion:VERSION,workspaceVersion:'4'
      });
      prepRuntime.lastBatchId=result.batchId;markWorkspaceDirty();await saveWorkspaceLocal({silent:true});
      setStatus(`已进入题库 · 批次 ${result.batchId}`,'good');toast('上传成功，已进入题库');
    }catch(error){
      setStatus(error.message||'同步失败，本地草稿已保留','bad');setIssues(error);
      await saveWorkspaceLocal({silent:true});
    }finally{refreshButtons()}
  });

  document.querySelectorAll('[data-creator-key]').forEach(button=>button.addEventListener('click',()=>{
    setTimeout(()=>{renderActor();refreshButtons()},0);
  }));
  renderActor();refreshButtons();refreshBanks();
})();
