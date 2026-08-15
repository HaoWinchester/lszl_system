/* Server catalog UI wiring. Runs after the original local event bootstrap. */
(function(){
  const Catalog=PMPPrepServices.ServerCatalogService;
  const actor=prepRuntime.serverActor;
  const actorName=document.getElementById('serverActorName');
  const creatorName=document.getElementById('serverCreatorName');
  const status=document.getElementById('serverCatalogStatus');
  const sourceBankSelect=document.getElementById('serverSourceBankSelect');
  const bankSelect=document.getElementById('serverBankSelect');
  const createButton=document.getElementById('btnCreateServerBank');
  const syncButton=document.getElementById('btnSyncToCatalog');
  const issuesBox=document.getElementById('serverCatalogIssues');
  const reconfirmButton=document.getElementById('btnReconfirmQuestionLock');
  const copyConflictButton=document.getElementById('btnCopyConflictQuestion');
  let lockController=null,lockCreatorId='';

  function onLeaseState(lease){
    prepRuntime.editLeaseState=lease;renderQuestionLockState();refreshButtons();
  }
  async function ensureLockController(){
    const creatorId=prepRuntime.creatorProfile?.creatorId||'';
    if(lockController&&lockCreatorId===creatorId)return lockController;
    if(lockController)await lockController.close();
    lockCreatorId=creatorId;
    lockController=Catalog.createEditLeaseController({
      clientInstanceId:prepRuntime.clientInstanceId,creatorId,onState:onLeaseState
    });
    return lockController;
  }
  const QuestionLocks={
    async switchTo(question){
      if(!actor&&question?.serverRevision){
        return onLeaseState({questionId:question.id,mode:'server-readonly',connection:'online',canSave:false,readOnly:true,lockToken:'',message:'请先登录后再编辑服务器题目'});
      }
      const controller=await ensureLockController();return controller.open(question);
    },
    async close(options={}){if(!lockController)return;return lockController.close(options)},
    async reconfirm(){if(!lockController)return;return lockController.reconfirm()},
    handleSaveError(error){return lockController?.handleSaveError(error)},
    snapshot(){return lockController?.snapshot()||prepRuntime.editLeaseState}
  };
  window.PMPPrepQuestionLocks=QuestionLocks;

  function setStatus(message,kind=''){
    status.textContent=message;status.className=`server-status ${kind}`;
  }
  function setIssues(error){
    const issues=Array.isArray(error?.issues)?error.issues:[];
    issuesBox.innerHTML=issues.map(issue=>`<div>${esc(issue.field||issue.questionId||'题目')}：${esc(issue.message||issue.code||'校验失败')}</div>`).join('');
  }
  function serverEnabled(){return !!(actor&&prepRuntime.creatorProfile&&prepRuntime.serverBankId&&prepRuntime.draftId)}
  function refreshButtons(){
    const authenticated=!!actor;
    const question=currentQuestion(),lease=prepRuntime.editLeaseState||{};
    const canSyncQuestion=!question?.serverRevision||lease.questionId===question.id&&lease.canSave;
    createButton.disabled=!authenticated||!prepRuntime.creatorProfile;
    sourceBankSelect.disabled=!authenticated||!prepRuntime.creatorProfile;
    bankSelect.disabled=!authenticated||!prepRuntime.creatorProfile;
    syncButton.disabled=!serverEnabled()||!canSyncQuestion;
  }
  function renderActor(){
    actorName.textContent=actor?(actor.display_name||actor.displayName||actor.username):'未登录';
    creatorName.textContent=prepRuntime.creatorProfile?.name||'请先选择';
    if(!actor)setStatus('未登录 · 请登录后选择共享草稿','warn');
  }
  function renderBanks(banks){
    const options=banks.map(bank=>`<option value="${esc(bank.id)}">${esc(bank.name)} · ${esc(bank.accessMode||'可编辑')}</option>`).join('');
    sourceBankSelect.innerHTML='<option value="">请选择题库</option>'+options;
    bankSelect.innerHTML='<option value="">请选择题库</option>'+options;
    if(prepRuntime.serverBankId&&banks.some(bank=>bank.id===prepRuntime.serverBankId)){
      sourceBankSelect.value=prepRuntime.serverBankId;
      bankSelect.value=prepRuntime.serverBankId;
    }
    refreshButtons();
  }
  async function refreshBanks({throwOnError=false}={}){
    if(!actor){renderBanks([]);return}
    setStatus('正在连接服务器…');setIssues(null);
    try{
      const banks=await Catalog.listWritableBanks(state.questionBank.subject||'PMP');prepRuntime.serverBanks=banks;renderBanks(banks);
      setStatus(`服务器已连接 · ${banks.length} 个可编辑题库`,'good');
      return banks;
    }catch(error){
      setStatus(error.message,'bad');setIssues(error);
      if(throwOnError)throw error;
      prepRuntime.serverBanks=[];renderBanks([]);return [];
    }
  }
  function normalizeSharedContent(payload){
    const tree=payload?.knowledgeTree;
    return {
      knowledgeTree:tree?(typeof normalizeTree==='function'?normalizeTree(tree):tree.taxonomy||tree):null,
      recallLibrary:typeof normalizeRecall==='function'?normalizeRecall(payload?.recallLibrary||{}):(payload?.recallLibrary||{schemaVersion:1,nodes:[],edges:[]}),
      principles:typeof normalizePrinciples==='function'?normalizePrinciples(payload?.principles||{}):(payload?.principles||{schemaVersion:1,items:[]}),
      synthesisPresets:typeof normalizePresets==='function'?normalizePresets(payload?.synthesisPresets||{}):(payload?.synthesisPresets||{schemaVersion:1,items:[]}),
      tagConfig:typeof normalizeTagConfig==='function'?normalizeTagConfig(payload?.tagConfig||{}):(payload?.tagConfig||{schemaVersion:2,names:{}}),
      contentRevision:Number(payload?.contentRevision||0)
    };
  }
  function applySharedContent(payload,{refresh=true}={}){
    const shared=normalizeSharedContent(payload);
    if(shared.knowledgeTree)state.knowledgeTree=shared.knowledgeTree;
    state.recallLibrary=shared.recallLibrary;
    state.principles=shared.principles;
    state.synthesisPresets=shared.synthesisPresets;
    state.tagConfig=shared.tagConfig;
    prepRuntime.serverContentRevision=Math.max(Number(prepRuntime.serverContentRevision||0),shared.contentRevision);
    state.currentPrincipleId=state.principles.items.some(item=>item.id===state.currentPrincipleId)
      ?state.currentPrincipleId:(state.principles.items[0]?.id||'');
    if(refresh)refreshAll();
    return shared;
  }
  async function refreshSharedContent(){
    if(!actor)return null;
    const subjectId=state.knowledgeTree?.subjectId||state.questionBank.subject||'PMP';
    const payload=await Catalog.loadSharedContent(subjectId);
    if(!prepRuntime.draftId&&!prepRuntime.dirty)applySharedContent(payload);
    return payload;
  }
  const ServerPrinciples=Object.freeze({
    async save(principle,preset){
      throw new Error('原则请先保存到共享草稿，并在第七步统一同步。');
    },
    async remove(principleId){
      throw new Error('原则请先在共享草稿内删除，并在第七步统一同步。');
    }
  });
  window.PMPPrepServerPrinciples=ServerPrinciples;

  /* P4.5.29 差异 24：手动保存统一提交到数据库共享草稿（服务器），不落浏览器存储；
     保存成功后正式内容仍需第七步 syncWorkspaceToServer 显式同步。 */
  const quickSaveButton=document.getElementById('btnQuickSaveWorkspace');
  const localSaveButton=document.getElementById('btnSaveWorkspaceLocal');
  const saveDraftToServer=async()=>{
    try{
      await window.PMPPrepDraftUi.save();
      window.PMPPrepAutosave?.rememberDraftId?.();
    }catch(_error){
      /* 37 已在保存状态条展示失败原因并保留 dirty，可手动重试 */
    }
  };
  if(quickSaveButton)quickSaveButton.onclick=()=>saveDraftToServer();
  if(localSaveButton)localSaveButton.onclick=()=>saveDraftToServer();

  async function syncWorkspaceToServer(){
    syncButton.disabled=true;setStatus('正在同步共享草稿到主程序…');setIssues(null);
    try{const result=await window.PMPPrepDraftUi.sync();setStatus(`已同步到主程序 · 批次 ${result.batchId}`,'good');return result}
    catch(error){setStatus(error.message||'同步失败，草稿已保留','bad');setIssues(error);throw error}
    finally{refreshButtons()}
  }
  window.PMPPrepSyncWorkspace=syncWorkspaceToServer;
  function readServerProjection(key,normalizer){
    try{
      const raw=window.localStorage?.getItem?.(key);if(!raw)return null;
      const parsed=JSON.parse(raw);return normalizer(parsed);
    }catch(_error){return null}
  }
  function remoteContentSnapshot(){
    const catalog=prepRuntime.serverCatalogSnapshot||null;
    if(!catalog)return null;
    return {
      catalog,
      principles:readServerProjection('kg_principle_repository_v1',normalizePrinciples)||prepRuntime.serverPrinciples||null,
      presets:readServerProjection('kg_synthesis_preset_repository_v1',normalizePresets)||prepRuntime.serverSynthesisPresets||null
    };
  }
  function selectedRemoteBank(snapshot){
    const banks=Array.isArray(snapshot?.banks)?snapshot.banks:[];
    return banks.find(bank=>String(bank.id)===String(prepRuntime.serverBankId||''))
      ||banks.find(bank=>String(bank.subject||'')===String(state.questionBank.subject||''))||banks[0]||null;
  }
  function remoteQuestionsForBank(snapshot,bank){
    return (Array.isArray(snapshot?.questions)?snapshot.questions:[])
      .filter(question=>!bank||String(question.bankId)===String(bank.id))
      .map((question,index)=>QuestionService.normalize({...question,serverRevision:Number(question.revision||question.serverRevision||0)||null},index,question.subject||bank?.subject||state.questionBank.subject));
  }
  function renderRemoteReadOnlyViews(){
    const remote=remoteContentSnapshot();if(!remote)return;
    const bank=selectedRemoteBank(remote.catalog),questions=remoteQuestionsForBank(remote.catalog,bank);
    const principles=remote.principles?.items||[],presets=remote.presets?.items||[];
    const questionList=document.getElementById('questionList');
    if(questionList)questionList.innerHTML=questions.map((question,index)=>`<div class="list-item server-newer"><div class="list-title">${index+1}. ${esc(question.title||question.id)}</div><div class="list-meta">${esc(question.id)} · 服务器新版本</div></div>`).join('')||'<div class="no-data">服务器题库暂无题目</div>';
    const principleList=document.getElementById('principleList');
    if(principleList)principleList.innerHTML=principles.map(principle=>`<div class="manager-row server-newer"><b>${esc(principle.name||principle.id)}</b><div class="muted tiny">${esc(principle.id)} · 服务器新版本</div></div>`).join('')||'<div class="no-data">服务器暂无原则</div>';
    if(document.getElementById('hdrQuestions'))document.getElementById('hdrQuestions').textContent=`题目 ${questions.length}`;
    if(document.getElementById('baseQuestionCount'))document.getElementById('baseQuestionCount').textContent=questions.length;
    if(document.getElementById('qCount'))document.getElementById('qCount').textContent=`${questions.length} 题 · 服务器新版本`;
    if(document.getElementById('basePrincipleCount'))document.getElementById('basePrincipleCount').textContent=principles.length;
    if(document.getElementById('basePresetInfo'))document.getElementById('basePresetInfo').textContent=`归纳卡 ${presets.length} · 服务器新版本`;
    prepRuntime.serverContentMetrics={questions:questions.length,principles:principles.length,presets:presets.length};
  }
  function capturePrinciplePresetEditorDraft(){
    const principle=(state.principles?.items||[]).find(item=>item.id===state.currentPrincipleId);if(!principle)return null;
    const preset=(state.synthesisPresets?.items||[]).find(item=>item.principleId===principle.id)||null;
    const name=document.getElementById('pmPrincipleName')?.value,statusValue=document.getElementById('pmPrincipleStatus')?.value;
    if(name==null||statusValue==null)return null;
    const split=value=>String(value||'').split(/[,，、;；|]+/).map(item=>item.trim()).filter(Boolean);
    const draft={
      principleId:principle.id,name:String(name),status:String(statusValue),
      confusablePrincipleIds:split(document.getElementById('pmConfusable')?.value),
      presetId:preset?.id||'',presetTitle:String(document.getElementById('pmPresetTitle')?.value||''),
      presetContent:String(document.getElementById('pmPresetContent')?.value||''),presetStatus:String(document.getElementById('pmPresetStatus')?.value||'draft'),
      presetVersion:Math.max(1,Number(document.getElementById('pmPresetVersion')?.value||1))
    };
    const unchanged=draft.name===String(principle.name||'')&&draft.status===String(principle.status||'active')
      &&JSON.stringify(draft.confusablePrincipleIds)===JSON.stringify(principle.confusablePrincipleIds||[])
      &&draft.presetTitle===String(preset?.title||principle.name)&&draft.presetContent===String(preset?.content||'')
      &&draft.presetStatus===String(preset?.status||'draft')&&draft.presetVersion===Number(preset?.version||1);
    return unchanged?null:draft;
  }
  function applyPrinciplePresetEditorDraft(draft){
    if(!draft)return;
    const principle=(state.principles?.items||[]).find(item=>item.id===draft.principleId);if(!principle)return;
    Object.assign(principle,{name:draft.name.trim()||'未命名原则',status:draft.status,confusablePrincipleIds:[...new Set(draft.confusablePrincipleIds)],updatedAt:Date.now()});
    let preset=(state.synthesisPresets?.items||[]).find(item=>item.id===draft.presetId)||(state.synthesisPresets?.items||[]).find(item=>item.principleId===draft.principleId);
    if(!preset){preset={id:draft.presetId||`preset-${Date.now().toString(36)}`,principleId:draft.principleId,createdAt:Date.now()};state.synthesisPresets.items.push(preset)}
    Object.assign(preset,{principleId:draft.principleId,title:draft.presetTitle,content:draft.presetContent,status:draft.presetStatus,version:draft.presetVersion,updatedAt:Date.now()});
  }
  async function applyRemoteContent(options={}){
    const remote=remoteContentSnapshot();if(!remote)return false;
    const mode=String(options.mode||'reload'),bank=selectedRemoteBank(remote.catalog);
    const remoteQuestions=remoteQuestionsForBank(remote.catalog,bank);
    const remotePrinciples=remote.principles||state.principles,remotePresets=remote.presets||state.synthesisPresets;
    if(mode==='merge'){
      prepRuntime.pendingPrinciplePresetEditorDraft=capturePrinciplePresetEditorDraft()||prepRuntime.pendingPrinciplePresetEditorDraft||null;
      const mergeById=(remoteItems,localItems)=>{const rows=new Map((remoteItems||[]).map(item=>[String(item.id),item]));(localItems||[]).forEach(item=>rows.set(String(item.id),item));return [...rows.values()]};
      state.questionBank.questions=mergeById(remoteQuestions,state.questionBank.questions);
      state.principles={...remotePrinciples,items:mergeById(remotePrinciples.items,state.principles.items)};
      state.synthesisPresets={...remotePresets,items:mergeById(remotePresets.items,state.synthesisPresets.items)};
      applyPrinciplePresetEditorDraft(prepRuntime.pendingPrinciplePresetEditorDraft);
      prepRuntime.pendingPrinciplePresetEditorDraft=null;
      prepRuntime.dirty=true;markWorkspaceDirty();
    }else{
      state.questionBank={...state.questionBank,...(bank||{}),questions:remoteQuestions};
      state.principles=remotePrinciples;state.synthesisPresets=remotePresets;
      state.currentQuestionId=remoteQuestions.some(question=>question.id===state.currentQuestionId)?state.currentQuestionId:(remoteQuestions[0]?.id||'');
      state.currentPrincipleId=state.principles.items.some(principle=>principle.id===state.currentPrincipleId)?state.currentPrincipleId:(state.principles.items[0]?.id||'');
      prepRuntime.pendingPrinciplePresetEditorDraft=null;
      prepRuntime.dirty=false;
    }
    refreshAll();
    status.onclick=null;status.removeAttribute?.('role');status.removeAttribute?.('tabindex');
    setStatus(mode==='merge'?'已合并服务器新版本，当前工作区仍有待保存改动':'已重新载入服务器版本','good');
    try{window.dispatchEvent(new CustomEvent('prep:server-content-applied',{detail:{mode,revision:prepRuntime.serverContentRevision}}))}catch(_error){}
    return true;
  }
  function requestExplicitRemoteApply(){
    const choice=String(prompt('服务器有新版本。输入“重新载入”以放弃当前表单，或输入“合并”保留本地内容。','合并')||'').trim();
    if(choice==='重新载入'||choice.toLowerCase()==='reload')return applyRemoteContent({mode:'reload'});
    if(choice==='合并'||choice.toLowerCase()==='merge')return applyRemoteContent({mode:'merge'});
    return false;
  }
  window.PMPPrepServerContentRefresh=Object.freeze({apply:applyRemoteContent,snapshot:remoteContentSnapshot});
  function handleServerStateReload(){
    if(prepRuntime.draftId)return;
    prepRuntime.serverPrinciples=readServerProjection('kg_principle_repository_v1',normalizePrinciples)||prepRuntime.serverPrinciples||null;
    prepRuntime.serverSynthesisPresets=readServerProjection('kg_synthesis_preset_repository_v1',normalizePresets)||prepRuntime.serverSynthesisPresets||null;
    if(!prepRuntime.serverCatalogSnapshot)return;
    if(prepRuntime.dirty)renderRemoteReadOnlyViews();
    else applyRemoteContent({mode:'reload'});
  }
  window.addEventListener('kg:server-state-reloaded',handleServerStateReload);
  const teachingSync=window.KGTeachingContentSync;
  let remoteRefreshTarget=0,remoteRefreshPromise=null,remoteRetryTimer=0,remoteRetryDelay=250,remoteRetryStopped=false;
  function scheduleRemoteRetry(){
    if(remoteRetryStopped||remoteRetryTimer)return;
    const delay=remoteRetryDelay;remoteRetryDelay=Math.min(remoteRetryDelay*2,10000);
    remoteRetryTimer=setTimeout(()=>{remoteRetryTimer=0;refreshRemoteRevision({revision:remoteRefreshTarget,source:'retry'})},delay);
  }
  function refreshRemoteRevision(detail){
    if(prepRuntime.draftId)return;
    if(remoteRetryStopped)return;
    const revision=Number(detail?.revision);
    if(!Number.isSafeInteger(revision)||revision<=Number(prepRuntime.serverContentRevision||0))return;
    clearTimeout(remoteRetryTimer);remoteRetryTimer=0;
    remoteRefreshTarget=Math.max(remoteRefreshTarget,revision);
    if(!remoteRefreshPromise){
      remoteRefreshPromise=(async()=>{
        let failures=0;
        while(!remoteRetryStopped&&remoteRefreshTarget>Number(prepRuntime.serverContentRevision||0)){
          const applyingRevision=remoteRefreshTarget,editorWasDirty=!!prepRuntime.dirty;
          try{
            const [,catalogSnapshot]=await Promise.all([refreshBanks({throwOnError:true}),Catalog.loadCatalog()]);
            if(remoteRetryStopped)return;
            const fetchedRevision=Number(catalogSnapshot?.contentRevision);
            if(!Number.isSafeInteger(fetchedRevision)||fetchedRevision<applyingRevision)throw new Error('服务器目录快照仍在同步，请稍后重试。');
            prepRuntime.serverCatalogSnapshot=catalogSnapshot;
            prepRuntime.serverPrinciples=readServerProjection('kg_principle_repository_v1',normalizePrinciples)||prepRuntime.serverPrinciples||null;
            prepRuntime.serverSynthesisPresets=readServerProjection('kg_synthesis_preset_repository_v1',normalizePresets)||prepRuntime.serverSynthesisPresets||null;
            failures=0;
          }catch(error){
            failures+=1;if(failures>2)throw error;
            await new Promise(resolve=>setTimeout(resolve,failures*80));continue;
          }
          if(remoteRetryStopped)return;
          prepRuntime.serverContentRevision=applyingRevision;
          if(editorWasDirty){
            prepRuntime.pendingPrinciplePresetEditorDraft=capturePrinciplePresetEditorDraft()||prepRuntime.pendingPrinciplePresetEditorDraft||null;
            renderRemoteReadOnlyViews();
            setStatus('服务器有新版本 · 当前表单未覆盖，请显式重新载入或合并（点击此处选择）','warn');
            status.tabIndex=0;status.setAttribute?.('role','button');status.onclick=requestExplicitRemoteApply;
          }else{
            await applyRemoteContent({mode:'reload'});
          }
          try{window.dispatchEvent(new CustomEvent('prep:server-content-advanced',{detail:{revision:applyingRevision,editorDirty:editorWasDirty,requiresExplicitReload:true}}))}catch(_error){}
        }
        if(remoteRefreshTarget<=Number(prepRuntime.serverContentRevision||0))remoteRetryDelay=250;
      })().catch(()=>{scheduleRemoteRetry()}).finally(()=>{remoteRefreshPromise=null});
    }
    return remoteRefreshPromise;
  }
  const unsubscribeTeachingSync=teachingSync?.subscribe?.(refreshRemoteRevision);
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
      await refreshBanks();bankSelect.value=bank.id;markWorkspaceDirty();
      setStatus('题库已创建，请先保存共享草稿，再确认同步内容','good');
    }catch(error){setStatus(error.message,'bad');setIssues(error)}finally{refreshButtons()}
  });
  async function loadSelectedBankIntoWorkspace(){
    const bankId=sourceBankSelect.value;if(!bankId)return;
    const previousBankId=prepRuntime.serverBankId||'';
    if(!prepRuntime.draftId){
      sourceBankSelect.value=previousBankId;setStatus('请先新建或打开共享草稿。','warn');return;
    }
    const hasWorkspaceContent=state.questionBank.questions.length>0;
    if(prepRuntime.dirty&&hasWorkspaceContent&&!confirm('载入题库会替换当前工作区的题目。未保存内容可能丢失，是否继续？')){
      sourceBankSelect.value=previousBankId;setStatus('已取消载入，当前工作区未改变。','warn');return;
    }
    sourceBankSelect.disabled=true;setStatus('正在载入题库题目…');setIssues(null);
    try{
      const remoteQuestions=await Catalog.listBankQuestions(bankId);
      if(!remoteQuestions.length){
        sourceBankSelect.value=previousBankId;setStatus('该题库暂无题目，当前工作区未改变。','warn');return;
      }
      const bank=prepRuntime.serverBanks.find(item=>String(item.id)===String(bankId));
      const questions=remoteQuestions.map((remote,index)=>QuestionService.normalize({
        ...remote,serverRevision:remote.revision,serverContentHash:remote.contentHash,lastSyncedAt:nowIso()
      },index,remote.subject||bank?.subject||state.questionBank.subject));
      await QuestionLocks.switchTo(questions[0]);
      state.questionBank={...state.questionBank,...(bank||{}),questions};
      prepRuntime.serverBankId=bankId;
      prepRuntime.serverBankRevision=Number(bank?.revision||0)||null;
      sourceBankSelect.value=bankId;
      bankSelect.value=bankId;
      state.currentQuestionId=questions[0].id;refreshAll();
      questions.forEach(question=>question.serverExportSnapshot=Catalog.captureServerSnapshot(question));
      await window.PMPPrepDraftUi.save();
      setStatus(`已载入 ${questions.length} 道题目，请保存后继续编辑。`,'good');
    }catch(error){sourceBankSelect.value=previousBankId;setStatus(error.message,'bad');setIssues(error)}finally{refreshButtons()}
  }
  sourceBankSelect.addEventListener('change',()=>{loadSelectedBankIntoWorkspace().catch(()=>{})});
  syncButton.addEventListener('click',()=>syncWorkspaceToServer({source:'sync'}).catch(()=>{}));

  document.querySelectorAll('[data-creator-key]').forEach(button=>button.addEventListener('click',()=>{
    QuestionLocks.close().finally(()=>{
      lockController=null;lockCreatorId='';
      setTimeout(async()=>{
        renderActor();refreshButtons();
        if(currentQuestion()?.serverRevision)await QuestionLocks.switchTo(currentQuestion());
      },0);
    });
  }));
  const newWorkspaceButton=document.getElementById('btnNewWorkspace'),clearWorkspace=newWorkspaceButton.onclick;
  newWorkspaceButton.onclick=async event=>{
    const lockedQuestionId=QuestionLocks.snapshot().questionId;
    clearWorkspace.call(newWorkspaceButton,event);
    if(lockedQuestionId&&!state.questionBank.questions.some(question=>question.id===lockedQuestionId))await QuestionLocks.close();
  };
  reconfirmButton.addEventListener('click',async()=>{
    reconfirmButton.disabled=true;
    try{await QuestionLocks.reconfirm()}finally{reconfirmButton.disabled=false;renderQuestionLockState()}
  });
  copyConflictButton.addEventListener('click',async()=>{
    await duplicateQuestion();markWorkspaceDirty();
    setStatus('冲突内容已复制为草稿新题，可在第七步同步','good');
  });
  window.addEventListener('beforeunload',()=>{
    const lease=QuestionLocks.snapshot();
    if(lease.questionId&&lease.lockToken){
      Catalog.releaseLock(lease.questionId,{
        clientInstanceId:prepRuntime.clientInstanceId,lockToken:lease.lockToken,keepalive:true
      }).catch(()=>{});
    }
  });
  window.addEventListener('pagehide',()=>{remoteRetryStopped=true;clearTimeout(remoteRetryTimer);unsubscribeTeachingSync?.();window.removeEventListener?.('kg:server-state-reloaded',handleServerStateReload)});
  renderActor();refreshButtons();refreshBanks();
  refreshSharedContent().catch(error=>{setStatus(error.message||'共享内容读取失败','bad');setIssues(error)});
  window.PMPPrepAuthoringContract?.renderVersionHeader?.();
  if(actor&&window.PMPPrepP45Server){
    window.PMPPrepP45Server.loadSubjectFacetSchemas().catch(error=>{if(error.code!=='AUTH_REQUIRED')console.warn('[p45] facet schema load failed:',error.message)});
    window.PMPPrepP45Server.loadBuildMetadata().catch(error=>{if(error.code!=='AUTH_REQUIRED')console.warn('[p45] build metadata load failed:',error.message)});
  }
  /* P4.5.29 差异 23：刷新/重新登录后自动恢复上次打开的数据库共享草稿 */
  if(actor&&window.PMPPrepAutosave)window.PMPPrepAutosave.restoreLastDraft().catch(()=>{});
  const initial=currentQuestion();if(initial?.serverRevision)QuestionLocks.switchTo(initial).then(()=>renderQuestionLockState());
})();
