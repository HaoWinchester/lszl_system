'use strict';

/*
 * QuestionNavigator
 * 单题页面题目坞、搜索、快速切题，以及加入指定多题画布。
 * 不拥有题目或学习状态，只通过现有题库 API、QuestionRepository 和 FlowOrchestrator 协调。
 */
(function(global){
  const byId=id=>document.getElementById(id);
  const state={open:false,query:'',filter:'all',items:[],currentIndex:0,bound:false,workspaceNodes:[],selectedWorkspaceId:'',paperCatalog:[],incomingTargetApplied:false,questionTransitionTimer:null,questionTransitionHideTimer:null,questionTransitionToken:0};

  function escapeHTML(value){
    return String(value??'').replace(/[&<>"']/g,char=>({
      '&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'
    }[char]));
  }
  function isTrainingPage(){
    return document.body?.classList.contains('question-training-page');
  }
  function isReadOnlyMobile(){
    const width=global.innerWidth||document.documentElement.clientWidth||1024;
    const query=global.matchMedia?.('(pointer: coarse)');
    const coarse=query?!!query.matches:Number(global.navigator?.maxTouchPoints||0)>0;
    return coarse&&width<=1100;
  }
  function currentUserId(){
    return global.KGLearningSessionStore?.currentUserId?.()||'guest';
  }
  function currentQuestionId(){
    return String(global.KGQuestionRepository?.currentId?.()||'');
  }
  function currentPaper(){
    try{return typeof qbCurrentPaper==='function'?qbCurrentPaper():null}catch(e){return null}
  }
  function currentBank(){
    try{return typeof qbCurrentBank==='function'?qbCurrentBank():null}catch(e){return null}
  }
  function publishedCatalog(){
    try{
      if(typeof qbPublishedPaperCatalog==='function')return qbPublishedPaperCatalog({respectRole:true,mode:'single_deep_study'})||[];
    }catch(e){console.warn('读取已发布试卷失败',e)}
    let papers=[];
    try{papers=typeof qbPublishedPapers==='function'?qbPublishedPapers():[]}catch(e){papers=[]}
    return (papers||[]).map(paper=>{
      const items=(paper.questions||[]).map((ref,paperIndex)=>{
        let result={bank:null,question:null};
        try{if(typeof qbPaperQuestionByRef==='function')result=qbPaperQuestionByRef(ref)||result}catch(e){}
        return result.question?{paper,paperIndex,index:paperIndex,bank:result.bank,question:result.question,source:'paper',ref}:null;
      }).filter(Boolean);
      return {paper,items,configuredCount:(paper.questions||[]).length,targetCount:Number(paper.totalCount||paper.questions?.length||0),availableCount:items.length,missingCount:Math.max(0,(paper.questions||[]).length-items.length),blockedCount:0};
    });
  }
  function ensureSelectedPaper(catalog){
    catalog=Array.isArray(catalog)?catalog:publishedCatalog();
    state.paperCatalog=catalog;
    let paper=currentPaper();
    const currentEntry=catalog.find(entry=>String(entry.paper?.id)===String(paper?.id||''))||null;
    const preferredEntry=(currentEntry?.availableCount>0?currentEntry:null)||catalog.find(entry=>entry.availableCount>0)||currentEntry||catalog[0]||null;
    if(!paper||!currentEntry||preferredEntry!==currentEntry){
      const first=preferredEntry?.paper||null;
      if(first&&typeof qbSelectPublishedPaper==='function')paper=qbSelectPublishedPaper(first.id,preferredEntry.items[0]?.paperIndex||0,{applyQuestion:true})||first;
      else if(first){
        paper=first;
        if(typeof qBankState!=='undefined'){
          qBankState.currentPaperId=first.id;
          qBankState.currentPaperIndex=preferredEntry.items[0]?.paperIndex||0;
          if(typeof qbSaveCurrentPaper==='function')qbSaveCurrentPaper();
          if(typeof qbApplyPaperContext==='function')qbApplyPaperContext();
          if(typeof qbApplyCurrentQuestion==='function')qbApplyCurrentQuestion(true);
        }
      }else paper=null;
    }
    return paper;
  }
  function selectedCatalogEntry(){
    const catalog=publishedCatalog();
    const paper=ensureSelectedPaper(catalog);
    return catalog.find(entry=>String(entry.paper?.id)===String(paper?.id||''))||null;
  }
  function listContext(){
    const entry=selectedCatalogEntry();
    const paper=entry?.paper||null;
    const items=(entry?.items||[]).map(item=>({...item,source:'paper'}));
    const selectedPaperIndex=Number(typeof qBankState!=='undefined'?qBankState.currentPaperIndex:0)||0;
    const matchedIndex=items.findIndex(item=>Number(item.paperIndex)===selectedPaperIndex);
    return {
      type:'paper',
      paper,
      title:String(paper?.name||'暂无已发布试卷'),
      items,
      configuredCount:Number(entry?.configuredCount||0),
      targetCount:Number(entry?.targetCount||0),
      availableCount:Number(entry?.availableCount||items.length),
      missingCount:Number(entry?.missingCount||0),
      blockedCount:Number(entry?.blockedCount||0),
      currentIndex:items.length?Math.max(0,matchedIndex>=0?matchedIndex:0):0
    };
  }
  function sessionFor(question){
    const id=String(question?.id||question?.sourceQuestionId||'');
    if(!id)return null;
    return global.KGLearningSessionStore?.get?.(id,currentUserId())||null;
  }
  function itemStatus(question){
    const session=sessionFor(question);
    if(!session)return {key:'not-started',label:'未开始'};
    if(session.status==='completed')return {key:'completed',label:'已完成'};
    const step=Math.max(1,Math.min(5,Number(session.currentStep||1)));
    return {key:'in-progress',label:'第 '+step+' 步'};
  }
  function bankIdForItem(item){
    return String(item?.bank?.id||item?.question?.sourceBankId||'');
  }
  function paperOptionLabel(entry){
    const paper=entry?.paper||{};
    const configured=Number(entry?.configuredCount||0);
    const target=Number(entry?.targetCount||paper.totalCount||configured||0);
    return String(paper.name||'未命名试卷')+' · v'+Number(paper.version||0)+'（可用 '+Number(entry?.availableCount||0)+'/'+configured+' 题）';
  }
  function renderPaperSelector(context){
    const select=byId('qtPublishedPaperSelect');
    const status=byId('qtPublishedPaperStatus');
    if(!select)return;
    const catalog=state.paperCatalog.length?state.paperCatalog:publishedCatalog();
    if(!catalog.length){
      select.innerHTML='<option value="">暂无已发布试卷</option>';
      select.value='';
      select.disabled=true;
      if(status)status.textContent='后台没有已发布试卷，前端不显示题目。';
      return;
    }
    select.disabled=false;
    select.innerHTML=catalog.map(entry=>'<option value="'+escapeHTML(entry.paper.id)+'">'+escapeHTML(paperOptionLabel(entry))+'</option>').join('');
    select.value=String(context?.paper?.id||currentPaper()?.id||catalog[0].paper.id);
    const entry=catalog.find(item=>String(item.paper.id)===String(select.value))||catalog[0];
    if(status){
      const notes=[];
      if(entry.missingCount)notes.push('失效引用 '+entry.missingCount+' 题');
      if(entry.blockedCount)notes.push('当前角色不可见 '+entry.blockedCount+' 题');
      status.textContent='前端可用 '+entry.availableCount+' 题'+(notes.length?' · '+notes.join(' · '):'');
    }
  }
  function selectPublishedPaper(paperId){
    const catalog=publishedCatalog();
    const entry=catalog.find(item=>String(item.paper?.id)===String(paperId||''));
    if(!entry||!canSwitch())return false;
    beginQuestionTransition('正在切换试卷');
    global.KGGuidedLearningCanvas?.flushPendingConclusion?.();
    captureCurrent();
    if(typeof qbSelectPublishedPaper==='function')qbSelectPublishedPaper(entry.paper.id,entry.items[0]?.paperIndex||0,{applyQuestion:true});
    else if(typeof qBankState!=='undefined'){
      qBankState.currentPaperId=entry.paper.id;
      qBankState.currentPaperIndex=entry.items[0]?.paperIndex||0;
      if(typeof qbSaveCurrentPaper==='function')qbSaveCurrentPaper();
      if(typeof qbApplyPaperContext==='function')qbApplyPaperContext();
      if(typeof qbApplyCurrentQuestion==='function')qbApplyCurrentQuestion(true);
    }
    state.query='';
    const search=byId('qtQuestionSearch');
    if(search)search.value='';
    if(typeof renderQuestionTrainer==='function')renderQuestionTrainer();
    global.KGQuestionRepository?.notify?.('published-paper-switch');
    setTimeout(()=>{
      global.KGFlowOrchestrator?.switchQuestion?.({restartCompleted:false});
      render();
      close();
      finishQuestionTransition();
    },0);
    return true;
  }
  function selectedWorkspaceId(){
    const store=global.KGCanvasWorkspaceStore;
    const select=byId('qtTargetWorkspaceSelect');
    const id=String(select?.value||state.selectedWorkspaceId||store?.getActiveWorkspaceId?.()||'');
    return id;
  }
  function selectedWorkspace(){
    const store=global.KGCanvasWorkspaceStore;
    const id=selectedWorkspaceId();
    return store?.ensure?.({workspaceId:id})||null;
  }
  function workspaceNodeFor(item){
    const questionId=String(item?.question?.id||item?.question?.sourceQuestionId||'');
    const bankId=bankIdForItem(item);
    if(!questionId)return null;
    return state.workspaceNodes.find(node=>
      String(node.questionId)===questionId&&
      (!bankId||!node.bankId||String(node.bankId)===bankId)
    )||null;
  }
  function workspacePosition(){
    const count=state.workspaceNodes.length;
    return {
      x:120+(count%4)*420,
      y:120+Math.floor(count/4)*300,
      width:360,
      height:240
    };
  }
  function updateWorkspaceLinks(workspaceId,nodeId=''){
    const store=global.KGCanvasWorkspaceStore;
    const href=store?.workspaceUrl?.(workspaceId,nodeId)||'question-workspace.html';
    ['qtOpenWorkspaceBtn','qtMultiCanvasBtn'].forEach(id=>{
      const link=byId(id);
      if(link)link.href=href;
    });
    return href;
  }
  function renderWorkspaceSelector(){
    const store=global.KGCanvasWorkspaceStore;
    const select=byId('qtTargetWorkspaceSelect');
    if(!store||!select)return null;
    const workspaces=store.listWorkspaces?.()||[];
    let active=String(state.selectedWorkspaceId||store.getActiveWorkspaceId?.()||workspaces[0]?.id||'');
    if(!workspaces.some(item=>item.id===active))active=String(workspaces[0]?.id||'');
    state.selectedWorkspaceId=active;
    select.innerHTML=workspaces.map(item=>
      '<option value="'+escapeHTML(item.id)+'">'+escapeHTML(item.title)+' · '+Number(item.nodeCount||0)+'题</option>'
    ).join('');
    select.value=active;
    if(String(store.getActiveWorkspaceId?.()||'')!==active){
      store.setActiveWorkspace?.(active);
    }
    state.workspaceNodes=store.listNodes?.({workspaceId:active})||[];
    updateWorkspaceLinks(active);
    return workspaces.find(item=>item.id===active)||null;
  }
  function createWorkspaceFromDrawer(){
    const store=global.KGCanvasWorkspaceStore;
    if(!store)return null;
    if(isReadOnlyMobile()){
      if(typeof showStatus==='function')showStatus('移动端仅支持查看题目和完成作答。');
      return null;
    }
    let title='新建解题画布';
    try{
      const entered=global.prompt?.('请输入多题画布名称',title);
      if(entered===null)return null;
      title=String(entered||title).trim()||title;
    }catch(e){}
    const workspace=store.createWorkspace?.(title,{activate:true});
    if(!workspace)return null;
    state.selectedWorkspaceId=workspace.id;
    render();
    if(typeof showStatus==='function')showStatus('已创建多题画布：'+workspace.title);
    return workspace;
  }
  function openWorkspace(workspaceId,nodeId=''){
    const href=global.KGCanvasWorkspaceStore?.workspaceUrl?.(workspaceId,nodeId)||'question-workspace.html';
    global.location.href=href;
    return href;
  }
  function addItemToWorkspace(item){
    const store=global.KGCanvasWorkspaceStore;
    if(!store||!item?.question)return null;
    try{
      const loggedIn=typeof authIsLoggedIn==='function'?authIsLoggedIn():!!global.KGAuthCore?.currentUsername?.();
      if(!loggedIn){
        if(typeof authOpen==='function')authOpen('登录后的桌面端才能把题目加入多题归纳画布。');
        return null;
      }
    }catch(e){}
    if(isReadOnlyMobile()){
      if(typeof showStatus==='function')showStatus('移动端只读，不支持加入或编辑多题画布。');
      return null;
    }
    const workspaceId=selectedWorkspaceId();
    const existing=workspaceNodeFor(item);
    if(existing){
      openWorkspace(workspaceId,existing.id);
      return {created:false,node:existing,reason:'already-exists'};
    }
    const result=store.addQuestionReference?.(
      {...item.question,sourcePaperId:String(item.paper?.id||item.question.sourcePaperId||''),sourceReleaseId:String(item.paper?.releaseId||item.question.sourceReleaseId||'')},
      bankIdForItem(item),
      workspacePosition(),
      {workspaceId}
    );
    state.workspaceNodes=store.listNodes?.({workspaceId})||[];
    render();
    if(result?.node)updateWorkspaceLinks(workspaceId,result.node.id);
    if(typeof showStatus==='function'&&result?.created){
      const workspace=store.ensure?.({workspaceId});
      showStatus('已加入多题画布：'+String(workspace?.title||''));
    }
    return result;
  }

  function getItem(index){
    const context=listContext();
    return context.items[Math.max(0,Math.min(Number(index)||0,Math.max(0,context.items.length-1)))]||null;
  }
  function findQuestion(questionId,bankId='',paperId='',releaseId=''){
    questionId=String(questionId||'');
    bankId=String(bankId||'');
    paperId=String(paperId||'');
    releaseId=String(releaseId||'');
    const context=listContext();
    const contextPaperId=String(context.paper?.id||'');
    const contextReleaseId=String(context.paper?.releaseId||'');
    const currentPosition=context.items.findIndex(item=>{
      const id=String(item.question?.id||item.question?.sourceQuestionId||'');
      const itemBankId=bankIdForItem(item);
      return id===questionId
        &&(!bankId||!itemBankId||itemBankId===bankId)
        &&(!paperId||!contextPaperId||contextPaperId===paperId)
        &&(!releaseId||!contextReleaseId||contextReleaseId===releaseId);
    });
    if(currentPosition>=0)return {...context.items[currentPosition],position:currentPosition,inCurrentContext:true,contextType:context.type};
    for(const entry of publishedCatalog()){
      if(paperId&&String(entry.paper?.id||'')!==paperId)continue;
      if(releaseId&&String(entry.paper?.releaseId||'')!==releaseId)continue;
      const match=(entry.items||[]).find(item=>{
        const id=String(item.question?.id||item.question?.sourceQuestionId||'');
        const itemBankId=bankIdForItem(item);
        return id===questionId&&(!bankId||!itemBankId||itemBankId===bankId);
      });
      if(match){
        return {...match,paper:entry.paper,inCurrentContext:false,contextType:'paper'};
      }
    }
    return null;
  }

  function matches(item){
    const question=item.question||{};
    const status=itemStatus(question);
    if(state.filter==='completed'&&status.key!=='completed')return false;
    if(state.filter==='unfinished'&&status.key==='completed')return false;
    const query=state.query.trim().toLowerCase();
    if(!query)return true;
    const haystack=[
      question.title,
      question.topic,
      question.domain,
      question.difficulty,
      ...(Array.isArray(question.tags)?question.tags:[])
    ].join(' ').toLowerCase();
    return haystack.includes(query);
  }
  function render(){
    if(!isTrainingPage())return;
    const context=listContext();
    state.items=context.items;
    state.currentIndex=context.currentIndex;
    const total=context.items.length;
    const position=Math.min(total,context.currentIndex+1);

    const positionEl=byId('qtQuestionPosition');
    if(positionEl)positionEl.textContent=total?'题目 '+position+' / '+total:'暂无题目';
    const roundLabel=byId('qtRoundLabel');
    if(roundLabel)roundLabel.textContent=total?'第 '+position+' 题':'本轮学习';
    const workspaceSummary=renderWorkspaceSelector();
    const workspaceCount=state.workspaceNodes.length;
    renderPaperSelector(context);
    const meta=byId('qtQuestionDrawerMeta');
    if(meta)meta.textContent=context.paper
      ?context.title+' · 已发布 · 已组 '+context.configuredCount+'/'+context.targetCount+' 题 · 前端可用 '+total+' 题 · 目标画布“'+String(workspaceSummary?.title||'')+'”已有 '+workspaceCount+' 题'
      :'暂无已发布试卷。后台题库和草稿试卷不会在前端显示。';
    const progress=byId('qtDrawerProgress');
    if(progress)progress.textContent=total?position+' / '+total:'0 / 0';
    const canvasCount=byId('qtCanvasQuestionCount');
    if(canvasCount)canvasCount.textContent=String(total);

    const list=byId('qtQuestionList');
    if(!list)return;
    const currentId=currentQuestionId();
    const filtered=context.items.map((item,position)=>({item,position})).filter(row=>matches(row.item));
    if(!filtered.length){
      const message=!context.paper
        ?'暂无已发布试卷。请先在教师工作台的试卷管理中完成组卷并发布。'
        :(!context.items.length?'这套试卷没有前端可用题目，请检查失效引用或角色权限。':'没有符合当前搜索或筛选条件的题目。');
      list.innerHTML='<div class="qt-question-list-empty">'+escapeHTML(message)+'</div>';
      return;
    }
    list.innerHTML=filtered.map(({item,position})=>{
      const q=item.question||{};
      const status=itemStatus(q);
      const id=String(q.id||q.sourceQuestionId||'');
      const current=id===currentId||position===context.currentIndex;
      const subtitle=[q.topic||q.domain||'未分类',q.difficulty||''].filter(Boolean).join(' · ');
      return '<div role="listitem" class="qt-question-list-item '+(current?'current':'')+'" aria-current="'+(current?'true':'false')+'">'
        +'<button type="button" class="qt-question-open" data-question-index="'+position+'">'
          +'<span class="qt-question-number">'+(position+1)+'</span>'
          +'<span class="qt-question-item-copy"><strong>'+escapeHTML(q.title||'未命名题目')+'</strong><small>'+escapeHTML(subtitle)+'</small></span>'
          +'<span class="qt-question-status '+status.key+'">'+escapeHTML(status.label)+'</span>'
        +'</button>'
      +'</div>';
    }).join('');
    list.querySelectorAll('.qt-question-open[data-question-index]').forEach(button=>{button.addEventListener('click',()=>switchTo(Number(button.dataset.questionIndex)));});
    requestAnimationFrame(()=>{
      list.querySelector('.qt-question-list-item.current')?.scrollIntoView({block:'center'});
    });
  }

  function captureCurrent(){
    try{global.KGFlowOrchestrator?.captureLegacyState?.({force:true})}catch(e){}
  }
  function cancelQuestionTransitionTimers(){
    if(state.questionTransitionTimer){global.clearTimeout?.(state.questionTransitionTimer);state.questionTransitionTimer=null}
    if(state.questionTransitionHideTimer){global.clearTimeout?.(state.questionTransitionHideTimer);state.questionTransitionHideTimer=null}
  }
  function beginQuestionTransition(message='正在载入题目'){
    if(!isTrainingPage())return false;
    cancelQuestionTransitionTimers();
    state.questionTransitionToken+=1;
    const loader=byId('qtQuestionSwitchLoader'),text=byId('qtQuestionSwitchLoaderText');
    if(text)text.textContent=String(message||'正在载入题目');
    if(loader)loader.hidden=false;
    document.documentElement?.classList?.remove?.('qt-incoming-question-pending');
    document.body.classList.remove('qt-question-switch-entering');
    document.body.classList.add('qt-question-switching');
    return true;
  }
  function finishQuestionTransition(){
    if(!isTrainingPage())return false;
    cancelQuestionTransitionTimers();
    const token=state.questionTransitionToken;
    state.questionTransitionTimer=global.setTimeout?.(()=>{
      state.questionTransitionTimer=null;
      if(token!==state.questionTransitionToken)return;
      document.documentElement?.classList?.remove?.('qt-incoming-question-pending');
      document.body.classList.remove('qt-question-switching');
      document.body.classList.add('qt-question-switch-entering');
      state.questionTransitionHideTimer=global.setTimeout?.(()=>{
        state.questionTransitionHideTimer=null;
        if(token!==state.questionTransitionToken)return;
        const loader=byId('qtQuestionSwitchLoader');if(loader)loader.hidden=true;
        document.body.classList.remove('qt-question-switch-entering');
      },260);
    },80);
    return true;
  }

  function canSwitch(){
    try{
      const loggedIn=typeof authIsLoggedIn==='function'?authIsLoggedIn():!!global.KGAuthCore?.currentUsername?.();
      if(!loggedIn){
        if(typeof authOpen==='function')authOpen('登录后才能切换题目并保存每道题的学习进度。');
        return false;
      }
      if(typeof qCanOperateCurrentQuestion==='function'&&!qCanOperateCurrentQuestion('当前角色不能切换训练题目。'))return false;
    }catch(e){}
    return true;
  }
  function switchPaperQuestion(index,context){
    if(typeof qBankState==='undefined')return false;
    const item=context.items[Math.max(0,Math.min(index,context.items.length-1))];
    if(!item)return false;
    const paperIndex=Number(item.paperIndex??item.index??index);
    if(typeof qbSelectPublishedPaper==='function')qbSelectPublishedPaper(context.paper?.id||item.paper?.id,paperIndex,{applyQuestion:true});
    else{
      qBankState.currentPaperId=String(context.paper?.id||item.paper?.id||qBankState.currentPaperId||'');
      qBankState.currentPaperIndex=paperIndex;
      if(typeof qbSaveCurrentPaper==='function')qbSaveCurrentPaper();
      if(typeof qbApplyPaperContext==='function')qbApplyPaperContext();
      if(typeof qbApplyCurrentQuestion==='function')qbApplyCurrentQuestion(true);
    }
    if(typeof renderQuestionTrainer==='function')renderQuestionTrainer();
    if(typeof renderQuestionBankManager==='function')renderQuestionBankManager();
    if(typeof renderPaperControls==='function')renderPaperControls();
    return true;
  }
  function switchTo(index){
    const context=listContext();
    index=Math.max(0,Math.min(Number(index)||0,Math.max(0,context.items.length-1)));
    if(!context.items.length){finishQuestionTransition();return false}
    if(index===context.currentIndex){
      finishQuestionTransition();
      close();
      return true;
    }
    if(!canSwitch()){finishQuestionTransition();return false}
    beginQuestionTransition('正在切换到第 '+(index+1)+' 题');
    global.KGGuidedLearningCanvas?.flushPendingConclusion?.();
    captureCurrent();
    const success=switchPaperQuestion(index,context);
    if(!success){finishQuestionTransition();return false}
    global.KGQuestionRepository?.notify?.('navigator-switch');
    setTimeout(()=>{
      global.KGFlowOrchestrator?.switchQuestion?.({restartCompleted:false});
      render();
      close();
      finishQuestionTransition();
      if(typeof showStatus==='function')showStatus('已切换到第 '+(index+1)+' 题。');
    },0);
    return true;
  }
  function switchToQuestion(questionId,bankId='',paperId='',releaseId=''){
    const item=findQuestion(questionId,bankId,paperId,releaseId);
    if(!item){finishQuestionTransition();return false}
    if(item.inCurrentContext!==false)return switchTo(item.position);
    if(!canSwitch()){finishQuestionTransition();return false}
    beginQuestionTransition('正在载入选中的题目');
    global.KGGuidedLearningCanvas?.flushPendingConclusion?.();
    captureCurrent();
    if(typeof qbSelectPublishedPaper==='function')qbSelectPublishedPaper(item.paper?.id,item.paperIndex,{applyQuestion:true});
    else{
      if(typeof qBankState==='undefined'||!item.paper){finishQuestionTransition();return false}
      qBankState.currentPaperId=item.paper.id;
      qBankState.currentPaperIndex=Number(item.paperIndex||0);
      if(typeof qbSaveCurrentPaper==='function')qbSaveCurrentPaper();
      if(typeof qbApplyPaperContext==='function')qbApplyPaperContext();
      if(typeof qbApplyCurrentQuestion==='function')qbApplyCurrentQuestion(true);
    }
    if(typeof renderQuestionTrainer==='function')renderQuestionTrainer();
    global.KGQuestionRepository?.notify?.('workspace-question-switch');
    setTimeout(()=>{
      global.KGFlowOrchestrator?.switchQuestion?.({restartCompleted:false});
      render();
      close();
      finishQuestionTransition();
    },0);
    return true;
  }
  function applyIncomingQuestionTarget(){
    if(state.incomingTargetApplied||!isTrainingPage())return false;
    let params;
    try{params=new URLSearchParams(global.location?.search||'')}catch(e){return false}
    const questionId=String(params.get('questionId')||'');
    if(!questionId)return false;
    const bankId=String(params.get('bankId')||'');
    const paperId=String(params.get('paperId')||'');
    const releaseId=String(params.get('releaseId')||'');
    const success=switchToQuestion(questionId,bankId,paperId,releaseId);
    if(!success){finishQuestionTransition();return false}
    state.incomingTargetApplied=true;
    try{
      params.delete('questionId');params.delete('bankId');params.delete('paperId');params.delete('releaseId');
      const query=params.toString();
      const next=(global.location?.pathname?.split('/').pop()||'question-training.html')+(query?'?'+query:'')+(global.location?.hash||'');
      global.history?.replaceState?.(null,'',next);
    }catch(e){}
    return true;
  }

  function move(delta){
    const context=listContext();
    if(!context.items.length)return;
    const next=(context.currentIndex+Number(delta)+context.items.length)%context.items.length;
    switchTo(next);
  }
  function open(){
    if(!isTrainingPage())return;
    state.open=true;
    render();
    const drawer=byId('qtQuestionDrawer'),backdrop=byId('qtQuestionDrawerBackdrop');
    drawer?.classList.add('open');
    drawer?.setAttribute('aria-hidden','false');
    if(backdrop)backdrop.hidden=false;
    document.body.classList.add('qt-question-dock-open');

  }
  function close(){
    state.open=false;
    const drawer=byId('qtQuestionDrawer'),backdrop=byId('qtQuestionDrawerBackdrop');
    drawer?.classList.remove('open');
    drawer?.setAttribute('aria-hidden','true');
    if(backdrop)backdrop.hidden=true;
    document.body.classList.remove('qt-question-dock-open');

  }
  function wrapLegacyRender(){
    if(typeof renderQuestionTrainer!=='function'||renderQuestionTrainer.__qtNavigatorWrapped)return;
    const original=renderQuestionTrainer;
    const wrapped=function(){
      const result=original.apply(this,arguments);
      setTimeout(render,0);
      return result;
    };
    wrapped.__qtNavigatorWrapped=true;
    renderQuestionTrainer=wrapped;
  }
  function bind(){
    if(state.bound||!isTrainingPage())return;
    state.bound=true;
    wrapLegacyRender();
    byId('qtQuestionListBtn')?.addEventListener('click',open);
    byId('qtQuestionDrawerClose')?.addEventListener('click',close);
    byId('qtQuestionDrawerBackdrop')?.addEventListener('click',close);
    byId('qtPrevQuestionBtn')?.addEventListener('click',()=>move(-1));
    byId('qtNextQuestionBtn')?.addEventListener('click',()=>move(1));
    byId('qtDrawerPrevQuestion')?.addEventListener('click',()=>move(-1));
    byId('qtDrawerNextQuestion')?.addEventListener('click',()=>move(1));
    byId('qtPublishedPaperSelect')?.addEventListener('change',event=>selectPublishedPaper(String(event.target.value||'')));
    byId('qtTargetWorkspaceSelect')?.addEventListener('change',event=>{
      const workspaceId=String(event.target.value||'');
      state.selectedWorkspaceId=workspaceId;
      global.KGCanvasWorkspaceStore?.setActiveWorkspace?.(workspaceId);
      render();
    });
    byId('qtCreateWorkspaceBtn')?.addEventListener('click',createWorkspaceFromDrawer);
    byId('qtQuestionSearch')?.addEventListener('input',event=>{state.query=String(event.target.value||'');render()});
    byId('qtQuestionSearchBtn')?.addEventListener('click',()=>{state.query=String(byId('qtQuestionSearch')?.value||'');render()});
    document.querySelectorAll('[data-question-filter]').forEach(button=>{
      button.addEventListener('click',()=>{
        state.filter=String(button.dataset.questionFilter||'all');
        document.querySelectorAll('[data-question-filter]').forEach(item=>item.classList.toggle('active',item===button));
        render();
      });
    });
    document.addEventListener('keydown',event=>{
      if(event.key==='Escape'&&state.open)close();
    });
    global.addEventListener('kg:learning-session-updated',render);
    global.addEventListener('kg:learning-session-changed',render);
    global.addEventListener('kg:question-changed',render);
    global.addEventListener('kg:workspace-changed',render);
    global.addEventListener('kg:published-paper-selection-changed',()=>{
      state.paperCatalog=[];
      render();
    });
    global.addEventListener('kg-auth-session-change',()=>{
      state.paperCatalog=[];
      render();
    });
    global.addEventListener('focus',()=>{
      try{if(typeof qbInvalidateCaches==='function')qbInvalidateCaches()}catch(e){}
      state.paperCatalog=[];
      render();
    });
    global.addEventListener('storage',event=>{
      const key=String(event.key||'');
      if(!key.includes('question')&&!key.includes('exam_papers'))return;
      try{if(typeof qbInvalidateCaches==='function')qbInvalidateCaches()}catch(e){}
      state.paperCatalog=[];
      render();
    });
    global.addEventListener('resize',()=>{if(state.open)render()});
    render();
    setTimeout(applyIncomingQuestionTarget,0);
  }

  global.KGQuestionNavigator=Object.freeze({
    open,
    close,
    render,
    move,
    switchTo,
    switchToQuestion,
    beginQuestionTransition,
    finishQuestionTransition,
    applyIncomingQuestionTarget,
    getContext:listContext,
    getItem,
    findQuestion,
    addItemToWorkspace,
    openWorkspace,
    selectedWorkspaceId,
    isReadOnlyMobile
  });
  document.addEventListener('DOMContentLoaded',bind);
  global.addEventListener('load',()=>setTimeout(bind,0));
})(window);
