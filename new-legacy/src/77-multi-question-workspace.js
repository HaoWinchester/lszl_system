'use strict';

/*
 * MultiQuestionWorkspace v8
 * 独立多题归纳画布。与单题 LearningSession 和五步深学画布完全分离。
 */
(function(global){
  const viewportLibrary=global.KGCanvasViewportController||{};
  const BUTTON_LEVELS=viewportLibrary.BUTTON_ZOOM_LEVELS||[.01,.02,.03,.05,.10,.15,.20,.33,.50,.75,1,1.25,1.50,2,2.50,3,4];
  const WHEEL_LEVELS=viewportLibrary.WHEEL_ZOOM_LEVELS||[.01,.02,.03,.04,.05,.07,.09,.11,.13,.17,.21,.26,.33,.41,.51,.64,.80,1,1.20,1.44,1.73,2.07,2.49,2.99,3.58,4];
  const MIN_ZOOM=viewportLibrary.MIN_ZOOM||.01;
  const MAX_ZOOM=viewportLibrary.MAX_ZOOM||4;
  const MIME='application/x-kg-question-reference';
  const HIGHLIGHT_COLORS=['#fde68a','#bbf7d0','#bfdbfe','#fbcfe8','#fed7aa','#ddd6fe'];
  const HIGHLIGHT_COLOR_KEY='kg_multi_question_highlight_color_v1';
  const PAPER_SELECTION_KEY='kg_multi_question_paper_selection_v1';
  const FONT_SCALE_KEY='kg_multi_question_font_scale_v1';
  const FONT_SCALE_LEVELS=['normal','large','xlarge'];
  const ANALYSIS_SECTION_KEY='kg_multi_question_analysis_sections_v1';
  const ANALYSIS_SECTION_ORDER=['analysis','answer','path','concepts','clues','traps'];
  const ANALYSIS_SECTION_LABELS=Object.freeze({analysis:'题目解析',answer:'正确答案',path:'判断主线',concepts:'知识点',clues:'关键词',traps:'选项提示'});
  const ANALYSIS_SECTION_DEFAULTS=['analysis','answer','path'];
  const MAX_ANALYSIS_PANELS=2;
  const CARD_COLORS=['#ede9fe','#dbeafe','#dcfce7','#fef3c7','#fee2e2','#fce7f3','#e0f2fe'];
  const FULL_CARD_MIN_HEIGHT=300;
  const FULL_CARD_MAX_HEIGHT=12000;
  const COMPACT_CARD_HEIGHT=240;
  const MULTI_CARD_MIN_WIDTH=380;
  const CARD_PLACEMENT_CLEARANCE=36;
  const POINTER_ARROW_ICON='<svg aria-hidden="true" viewBox="0 0 24 24"><path d="M5 3l13 8-6 1.2 3.7 6.2-2.8 1.6-3.6-6.1L5 18V3z"/></svg>';
  const POINTER_HAND_ICON='<svg aria-hidden="true" viewBox="0 0 24 24"><path d="M8 12V6.5a1.5 1.5 0 0 1 3 0V11"/><path d="M11 11V5.5a1.5 1.5 0 0 1 3 0V11"/><path d="M14 11V7.5a1.5 1.5 0 0 1 3 0V13"/><path d="M8 12l-1.1-1.1a1.6 1.6 0 0 0-2.3 2.2l4.2 5.1A5.5 5.5 0 0 0 13 20h1a5 5 0 0 0 5-5v-3.5a1.5 1.5 0 0 0-3 0V13"/></svg>';
  const CARD_ACTION_ICONS=Object.freeze({
    analysis:'<svg aria-hidden="true" viewBox="0 0 24 24"><path d="M5 4.5h10a3 3 0 0 1 3 3V20H8a3 3 0 0 1-3-3V4.5z"/><path d="M8 7.5h7M8 11h6M8 14.5h4"/></svg>',
    focus:'<svg aria-hidden="true" viewBox="0 0 24 24"><circle cx="12" cy="12" r="3.5"/><path d="M12 2v4M12 18v4M2 12h4M18 12h4"/></svg>',
    remove:'<svg aria-hidden="true" viewBox="0 0 24 24"><path d="M5 7h14M9 7V4h6v3M8 7l1 13h6l1-13M10 11v5M14 11v5"/></svg>',
    expand:'<svg aria-hidden="true" viewBox="0 0 24 24"><path d="M8 3H3v5M16 3h5v5M8 21H3v-5M16 21h5v-5"/><path d="M3 8l6-6M21 8l-6-6M3 16l6 6M21 16l-6 6"/></svg>',
    compact:'<svg aria-hidden="true" viewBox="0 0 24 24"><path d="M9 3v6H3M15 3v6h6M9 21v-6H3M15 21v-6h6"/><path d="M3 9l6-6M21 9l-6-6M3 15l6 6M21 15l-6 6"/></svg>',
    edit:'<svg aria-hidden="true" viewBox="0 0 24 24"><path d="M4 20h4l11-11-4-4L4 16v4zM13.5 6.5l4 4"/></svg>',
    settings:'<svg aria-hidden="true" viewBox="0 0 24 24"><circle cx="12" cy="12" r="3"/><path d="M19 13.5v-3l-2.1-.7-.6-1.4 1-2-2.1-2.1-2 1-1.4-.6L10.5 2h-3l-.7 2.1-1.4.6-2-1-2.1 2.1 1 2-.6 1.4L0 10.5v3l2.1.7.6 1.4-1 2 2.1 2.1 2-1 1.4.6.7 2.1h3l.7-2.1 1.4-.6 2 1 2.1-2.1-1-2 .6-1.4L19 13.5z" transform="translate(2 0) scale(.83)"/></svg>'
  });
  const SYNTHESIS_META=Object.freeze({
    principle:{label:'原则卡',icon:'则'},routine:{label:'套路卡',icon:'路'},trap:{label:'陷阱卡',icon:'陷'},note:{label:'笔记卡',icon:'记'}
  });
  const SYNTHESIS_STATUS=Object.freeze({draft:'待验证',verified:'已验证',mastered:'已掌握'});
  const EDGE_META=Object.freeze({same:'同类',contrast:'对比',cause:'因果',exception:'例外',confused:'易混淆',support:'支持',custom:'关联'});
  const WORLD_WIDTH=8000;
  const WORLD_HEIGHT=5000;

  const state={
    initialized:false,
    viewport:null,
    world:null,
    nodeLayer:null,
    groupLayer:null,
    edgeLayer:null,
    edgeRoot:null,
    kernel:null,
    policy:null,
    workspaceId:'',
    workspace:null,
    cards:new Map(),
    groupElements:new Map(),
    layoutIssues:{overlaps:[],outOfBounds:[],oversized:[],groupOverflow:[],total:0},
    diagnosisTimer:null,
    editingSynthesisNodeId:'',
    editingGroupId:'',
    editingEdgeId:'',
    pendingSynthesisPosition:null,
    activeGroupId:'',
    analysisNodeIds:[],
    analysisLayer:null,
    analysisPanelOffsets:new Map(),
    analysisPanelDrag:null,
    analysisSections:new Set(ANALYSIS_SECTION_DEFAULTS),
    answerSelections:new Map(),
    edgeElements:new Map(),
    edgeAdjacency:new Map(),
    activeEdgeId:'',
    edgeQuickMenu:null,
    edgeInlineEditor:null,
    edgeMenuAnchorWorld:null,
    selectionToolbarRaf:0,
    selectionToolbarSuppressed:false,
    viewportMotionTimer:null,
    minimapDirty:true,
    minimapModel:null,
    inlineEdit:null,
    questions:[],
    papers:[],
    paperCatalog:[],
    paperStats:null,
    paperId:'',
    questionLoadError:'',
    selection:null,
    selectedNodeIds:new Set(),
    highlightColor:'#fde68a',
    fontScale:'large',
    pointerMode:'edit',
    temporaryPanMode:false,
    temporaryPanReasons:new Set(),
    rightPanPointerId:null,
    filter:'all',
    query:'',
    panX:0,
    panY:0,
    zoom:1,
    gesture:null,
    saveTimer:null,
    dragPayload:null,
    dragDepth:0,
    dragLeaveTimer:null,
    mobile:false,
    readonly:false,
    suppressStoreEvent:false
  };

  const byId=id=>document.getElementById(id);
  function clamp(value,min,max){return Math.max(min,Math.min(max,value))}
  function clone(value){try{return JSON.parse(JSON.stringify(value))}catch(e){return value}}
  function escapeHTML(value){
    return String(value??'').replace(/[&<>"']/g,char=>({
      '&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'
    }[char]));
  }
  function notify(message){
    if(typeof showStatus==='function')showStatus(message);
    else console.info(message);
  }
  function isMobile(){
    return global.KGCanvasViewportController?.isCoarseSmallScreen?.(1100)??false;
  }
  function loggedIn(){
    try{
      if(typeof authIsLoggedIn==='function')return !!authIsLoggedIn();
      if(typeof global.KGAuthCore?.currentUser==='function')return !!global.KGAuthCore.currentUser();
      return !!global.KGAuthCore?.currentUsername?.();
    }catch(e){return false}
  }
  function resolvedPolicy(){
    const base=global.KGCanvasPolicy?.presets?.synthesis?.()||{};
    if(state.mobile)return global.KGCanvasPolicy?.presets?.mobileReadonly?.(base)||base;
    if(!loggedIn()){
      return global.KGCanvasPolicy?.merge?.(base,{
        readonly:true,
        editable:false,
        allowPanZoom:true
      })||base;
    }
    return base;
  }
  function createKernel(){
    state.policy=global.KGCanvasPolicy?.create?.(resolvedPolicy());
    state.kernel=global.KGCanvasKernel?.create?.({
      id:'multi-question-workspace-canvas',
      viewport:state.viewport,
      world:state.world,
      policy:state.policy,
      mobile:state.mobile,
      selectionBox:byId('qwSelectionBox'),
      historyLimit:80,
      minCardWidth:Math.max(MULTI_CARD_MIN_WIDTH,Number(store()?.LAYOUT_LIMITS?.minWidth||260)),
      maxCardWidth:store()?.LAYOUT_LIMITS?.maxWidth||1400,
      minCardHeight:store()?.LAYOUT_LIMITS?.minHeight||170,
      maxCardHeight:store()?.LAYOUT_LIMITS?.maxHeight||FULL_CARD_MAX_HEIGHT,
      canSelectCards:()=>!state.mobile&&!state.readonly,
      onSelectionChange(){
        syncCardSelectionUI();
        updateLayoutToolbar();
      },
      onSelectionPreview(){renderMinimap({nodes:false})},
      onHistoryChange(){updateHistoryUI()},
      initialViewport:{x:state.panX,y:state.panY,zoom:state.zoom},
      gridPrefix:'--qw-grid',
      gridLodAttribute:'gridLod',
      persistDelay:380,
      onViewportApply(next){
        state.panX=next.x;
        state.panY=next.y;
        state.zoom=next.zoom;
        updateZoomLabel();
        renderMinimap({nodes:false});
        if(!state.selectionToolbarSuppressed)scheduleSelectionToolbarPosition();
      },
      onViewportPersist(next){
        if(state.mobile||!state.workspaceId)return;
        state.suppressStoreEvent=true;
        try{
          store()?.updateViewport?.({
            x:next.x,
            y:next.y,
            zoom:next.zoom
          },workspaceOptions());
        }finally{
          state.suppressStoreEvent=false;
        }
      },
      onCardLayoutChange(record){
        if(!record?.node||state.readonly)return;
        let result=null;
        state.suppressStoreEvent=true;
        try{
          result=store()?.updateNodeLayout?.(record.node.id,{
            x:record.node.x,
            y:record.node.y,
            width:record.node.width,
            height:record.node.height
          },workspaceOptions());
        }finally{
          state.suppressStoreEvent=false;
        }
        if(result?.node)syncRecordNode(record,result.node);
        if(result?.workspace)state.workspace=result.workspace;
        updateEdgesForNodeIds([record.id]);
        state.minimapDirty=true;
        renderMinimap();
        scheduleSelectionToolbarPosition();
        positionAnalysisPanels();
      }
    });
    if(!state.kernel)throw new Error('Unified Canvas Kernel is unavailable');
    state.cards=state.kernel.cards.records;
    if(state.kernel.selection)state.selectedNodeIds=state.kernel.selection.selectedIds;
    return state.kernel;
  }

  function updateReadonly(){
    state.mobile=isMobile();
    state.readonly=state.mobile||!loggedIn();
    state.kernel?.replacePolicy?.(resolvedPolicy());
    state.kernel?.setMobile?.(state.mobile);
    document.body.dataset.qwMobile=state.mobile?'1':'0';
    document.body.dataset.qwReadonly=state.readonly?'1':'0';
    const badge=byId('qwReadOnlyBadge');
    if(badge){
      badge.hidden=!state.readonly;
      badge.textContent=state.mobile?'移动端只读':'访客只读';
    }
    if(state.mobile){
      state.gesture=null;
      state.kernel?.cards?.cancelDrag?.();
      state.kernel?.selection?.cancel?.();
      state.viewport?.classList.remove('is-panning');
    }
    updateLayoutToolbar();
    return state.readonly;
  }
  function canEdit(message='登录后的桌面端才能编辑多题画布。'){
    updateReadonly();
    if(!state.readonly)return true;
    if(!loggedIn()){
      try{if(typeof authOpen==='function')authOpen(message)}catch(e){}
    }else notify('移动端仅支持查看多题画布。');
    return false;
  }
  function store(){return global.KGCanvasWorkspaceStore||null}
  function workspaceOptions(id=state.workspaceId){
    return {workspaceId:String(id||store()?.getActiveWorkspaceId?.()||'')};
  }
  function queryParams(){
    try{return new URLSearchParams(global.location.search||'')}catch(e){return new URLSearchParams()}
  }
  function replaceUrl(workspaceId,nodeId=''){
    try{
      const url=store()?.workspaceUrl?.(workspaceId,nodeId)||'question-workspace.html';
      global.history?.replaceState?.({},'',url);
    }catch(e){}
  }

  function invalidateQuestionSources(){
    try{
      if(typeof qbInvalidateCaches==='function')qbInvalidateCaches();
      else if(typeof qBankState!=='undefined'){qBankState.banks=null;qBankState.papers=null}
    }catch(error){}
  }
  function loadBanks(){
    const candidates=[];
    try{
      if(typeof qbLoadBanks==='function'){
        const loaded=qbLoadBanks();
        if(Array.isArray(loaded))candidates.push(...loaded);
      }
    }catch(error){
      state.questionLoadError=String(error?.message||error||'题库读取失败');
      console.error('多题画布题库读取失败',error);
    }
    if(!candidates.length){
      try{
        if(typeof qBankState!=='undefined'&&Array.isArray(qBankState.banks))candidates.push(...qBankState.banks);
      }catch(error){}
    }
    return candidates.filter(bank=>bank&&Array.isArray(bank.questions));
  }
  function paperAllowedForRole(paper){
    const entry=state.paperCatalog.find(item=>String(item.paper?.id)===String(paper?.id||''));
    return entry?entry.availableCount>0:true;
  }
  function loadPublishedPapers(){
    let catalog=[];
    try{
      if(typeof qbPublishedPaperCatalog==='function')catalog=qbPublishedPaperCatalog({respectRole:true})||[];
      else{
        const papers=typeof qbPublishedPapers==='function'?qbPublishedPapers():(typeof qbLoadPapers==='function'?qbLoadPapers().filter(paper=>paper?.status==='published'):[]);
        const banks=loadBanks();
        const bankMap=new Map(banks.map(bank=>[String(bank.id||bank.bankId||''),bank]));
        const roleApi=global.KGRolePermissions;
        catalog=(papers||[]).map(paper=>{
          let missingCount=0,blockedCount=0;
          const items=(paper.questions||[]).map((ref,paperIndex)=>{
            const bank=bankMap.get(String(ref.bankId||''));
            const question=bank?.questions?.find(item=>String(item.id)===String(ref.questionId));
            if(!bank||!question){missingCount+=1;return null}
            if(roleApi&&typeof roleApi.canOperateQuestion==='function'&&!roleApi.canOperateQuestion(question,bank.id)){blockedCount+=1;return null}
            return {paper,paperIndex,index:paperIndex,bank,question,ref};
          }).filter(Boolean);
          return {paper,items,configuredCount:(paper.questions||[]).length,targetCount:Number(paper.totalCount||paper.questions?.length||0),availableCount:items.length,missingCount,blockedCount};
        });
      }
    }catch(error){
      state.questionLoadError=String(error?.message||error||'发布试卷读取失败');
      console.error('多题画布发布试卷读取失败',error);
    }
    state.paperCatalog=(Array.isArray(catalog)?catalog:[]).filter(entry=>entry?.paper?.status==='published');
    state.papers=state.paperCatalog.map(entry=>entry.paper);
    return state.papers;
  }
  function scopedPreferenceKey(prefix){
    const userId=global.KGLearningSessionStore?.currentUserId?.()||'guest';
    return prefix+'__'+encodeURIComponent(String(userId||'guest'));
  }
  function readAnalysisSections(){
    try{
      const raw=JSON.parse(localStorage.getItem(scopedPreferenceKey(ANALYSIS_SECTION_KEY))||'null');
      const selected=Array.isArray(raw)?raw.map(String).filter(key=>ANALYSIS_SECTION_ORDER.includes(key)):[];
      return new Set(selected.length?selected:ANALYSIS_SECTION_DEFAULTS);
    }catch(error){return new Set(ANALYSIS_SECTION_DEFAULTS)}
  }
  function saveAnalysisSections(){
    try{localStorage.setItem(scopedPreferenceKey(ANALYSIS_SECTION_KEY),JSON.stringify([...state.analysisSections]))}catch(error){}
    return state.analysisSections;
  }
  function analysisSectionEnabled(key){return state.analysisSections.has(String(key||''))}
  function readFontScale(){
    try{
      const stored=String(localStorage.getItem(scopedPreferenceKey(FONT_SCALE_KEY))||'large');
      return FONT_SCALE_LEVELS.includes(stored)?stored:'large';
    }catch(error){return 'large'}
  }
  function applyFontScale(value,persist=true,announce=false){
    const resolved=FONT_SCALE_LEVELS.includes(String(value||''))?String(value):'large';
    state.fontScale=resolved;
    document.body.dataset.qwFontScale=resolved;
    const button=byId('qwFontScaleBtn');
    if(button){
      const labels={normal:'标准字号',large:'舒适字号',xlarge:'超大字号'};
      button.dataset.fontScale=resolved;
      button.title='当前：'+labels[resolved]+'；点击切换文字大小';
      button.setAttribute('aria-label',button.title);
    }
    if(persist){
      try{localStorage.setItem(scopedPreferenceKey(FONT_SCALE_KEY),resolved)}catch(error){}
    }
    if(state.initialized&&state.cards.size){
      const schedule=global.requestAnimationFrame||((callback)=>global.setTimeout(callback,0));
      schedule(()=>syncFullCardHeights({persist:!state.readonly,reason:'font-scale-auto-height'}));
    }
    if(announce){
      const labels={normal:'标准',large:'舒适',xlarge:'超大'};
      notify('多题页面已切换为'+labels[resolved]+'字号。完整卡片高度已自动适配。');
    }
    return resolved;
  }
  function cycleFontScale(){
    const index=FONT_SCALE_LEVELS.indexOf(state.fontScale);
    return applyFontScale(FONT_SCALE_LEVELS[(index+1)%FONT_SCALE_LEVELS.length],true,true);
  }
  function readPaperSelection(){
    try{
      const shared=typeof qbCurrentPaper==='function'?qbCurrentPaper():null;
      if(shared?.id)return String(shared.id);
      return String(localStorage.getItem(scopedPreferenceKey(PAPER_SELECTION_KEY))||'');
    }catch(error){return ''}
  }
  function savePaperSelection(){
    try{
      if(state.paperId)localStorage.setItem(scopedPreferenceKey(PAPER_SELECTION_KEY),state.paperId);
      else localStorage.removeItem(scopedPreferenceKey(PAPER_SELECTION_KEY));
    }catch(error){}
    try{
      const current=typeof qbCurrentPaper==='function'?qbCurrentPaper():null;
      const index=String(current?.id||'')===String(state.paperId)?Number(qBankState?.currentPaperIndex||0):0;
      if(state.paperId&&typeof qbSelectPublishedPaper==='function')qbSelectPublishedPaper(state.paperId,index,{applyQuestion:false});
    }catch(error){}
  }
  function selectedPaper(){
    return state.papers.find(paper=>String(paper.id)===String(state.paperId||''))||null;
  }
  function selectedPaperEntry(){
    return state.paperCatalog.find(entry=>String(entry.paper?.id)===String(state.paperId||''))||null;
  }
  function publishedPaperForQuestion(questionId,bankId='',preferredPaperId=''){
    const matches=state.paperCatalog.filter(entry=>(entry.items||[]).some(item=>
      String(item.question?.id||item.question?.sourceQuestionId||'')===String(questionId||'')&&
      (!bankId||String(item.bank?.id||'')===String(bankId))
    ));
    return (matches.find(entry=>String(entry.paper?.id)===String(preferredPaperId||''))||matches[0]||null)?.paper||null;
  }
  function renderPaperSelector(){
    const select=byId('qwPaperSelect');
    if(!select)return;
    if(!state.papers.length){
      select.innerHTML='<option value="">暂无已发布试卷</option>';
      select.value='';
      select.disabled=true;
      return;
    }
    select.disabled=false;
    select.innerHTML=state.paperCatalog.map(entry=>'<option value="'+escapeHTML(entry.paper.id)+'">'+escapeHTML(entry.paper.name)+'（已组 '+Number(entry.configuredCount||0)+'/'+Number(entry.targetCount||0)+' 题）</option>').join('');
    select.value=state.paperId;
  }
  function buildQuestionList(){
    state.questionLoadError='';
    const papers=loadPublishedPapers();
    const preferred=String(state.paperId||readPaperSelection()||'');
    const preferredEntry=state.paperCatalog.find(entry=>String(entry.paper?.id)===preferred)||null;
    const selectedEntry=(preferredEntry?.availableCount>0?preferredEntry:null)||state.paperCatalog.find(entry=>entry.availableCount>0)||preferredEntry||state.paperCatalog[0]||null;
    state.paperId=String(selectedEntry?.paper?.id||'');
    savePaperSelection();
    const paper=selectedPaper();
    const entry=selectedPaperEntry();
    state.paperStats=entry;
    const items=[];
    const seen=new Set();
    (entry?.items||[]).forEach(source=>{
      const bank=source.bank;
      const question=source.question;
      const paperIndex=Number(source.paperIndex||0);
      const questionId=String(question.id||question.sourceQuestionId||'');
      const identity=String(bank.id||'')+'::'+questionId;
      if(!questionId||seen.has(identity))return;
      seen.add(identity);
      items.push({
        paper,
        paperIndex,
        bank:{...bank,id:String(bank.id||bank.bankId||''),name:String(bank.name||bank.bankName||'未命名题库')},
        question:{...question,id:questionId,sourceBankId:String(bank.id||''),sourceQuestionId:questionId,sourcePaperId:String(paper.id||'')},
        index:(bank.questions||[]).indexOf(question)
      });
    });
    state.questions=items;
    const count=byId('qwQuestionCount');
    if(count)count.textContent=String(items.length);
    renderPaperSelector();
    return items;
  }
  function sessionStatus(question){
    const questionId=String(question?.id||question?.sourceQuestionId||'');
    const userId=global.KGLearningSessionStore?.currentUserId?.()||'guest';
    const session=global.KGLearningSessionStore?.get?.(questionId,userId)||null;
    if(!session)return {key:'not-started',label:'未开始'};
    if(session.status==='completed')return {key:'completed',label:'已完成'};
    return {key:'in-progress',label:'第 '+Math.max(1,Math.min(5,Number(session.currentStep||1)))+' 步'};
  }
  function questionIdentity(question,bank){
    return String(bank?.id||question?.sourceBankId||'')+'::'+String(question?.id||question?.sourceQuestionId||'');
  }
  function nodeIdentity(node){
    return String(node?.bankId||'')+'::'+String(node?.questionId||'');
  }
  function currentNodeByQuestion(question,bank){
    const identity=questionIdentity(question,bank);
    return [...state.cards.values()].map(record=>record.node).find(node=>nodeIdentity(node)===identity)||null;
  }
  function findQuestion(questionId,bankId=''){
    for(const entry of state.paperCatalog){
      const item=(entry.items||[]).find(source=>
        String(source.question?.id||source.question?.sourceQuestionId||'')===String(questionId||'')&&
        (!bankId||String(source.bank?.id||'')===String(bankId))
      );
      if(item)return {bank:item.bank,question:item.question,index:item.bankQuestionIndex??item.index,paper:entry.paper,paperIndex:item.paperIndex};
    }
    return null;
  }

  function nextLevel(current,direction,levels){
    return global.KGCanvasViewportController?.nextZoomLevel?.(
      current,direction,levels,MIN_ZOOM,MAX_ZOOM
    )??current;
  }
  function updateGrid(){
    return state.kernel?.viewport?.updateGrid?.()||false;
  }
  function applyViewport(){
    return state.kernel?.viewport?.sync?.({
      x:state.panX,
      y:state.panY,
      zoom:state.zoom,
      mobile:state.mobile
    })||false;
  }
  function updateZoomLabel(){
    const label=byId('qwZoomLabel');
    if(label)label.textContent=Math.round(state.zoom*100)+'%';
  }
  function viewportTarget(scale,clientX,clientY){
    return state.kernel?.viewport?.targetForScale?.(scale,clientX,clientY)||{
      x:state.panX,y:state.panY,zoom:state.zoom
    };
  }
  function setViewport(next={},options={}){
    return state.kernel?.viewport?.set?.(next,options)||false;
  }
  function zoomAt(scale,clientX,clientY,options={}){
    return state.kernel?.viewport?.zoomAt?.(scale,clientX,clientY,{
      duration:options.duration||180,
      persist:options.persist,
      source:options.source||'workspace-zoom'
    })||false;
  }
  function scheduleViewportSave(){
    return state.kernel?.viewport?.schedulePersist?.()||false;
  }
  function saveViewport(){
    if(state.mobile||!state.workspaceId)return false;
    state.kernel?.viewport?.cancelPersist?.();
    state.suppressStoreEvent=true;
    try{
      store()?.updateViewport?.({
        x:state.panX,
        y:state.panY,
        zoom:state.zoom
      },workspaceOptions());
    }finally{
      state.suppressStoreEvent=false;
    }
    return true;
  }
  function clientToWorld(clientX,clientY){
    return state.kernel?.viewport?.clientToWorld?.(clientX,clientY)||{x:0,y:0};
  }
  function cardBounds(){
    const rects=[];
    state.cards.forEach(record=>{
      if(record.element?.classList.contains('is-group-collapsed'))return;
      rects.push({left:Number(record.node.x),top:Number(record.node.y),right:Number(record.node.x)+Number(record.node.width),bottom:Number(record.node.y)+Number(record.node.height)});
    });
    (state.workspace?.groups||[]).filter(group=>group.collapsed).forEach(group=>rects.push({left:Number(group.x),top:Number(group.y),right:Number(group.x)+Number(group.width),bottom:Number(group.y)+76}));
    if(!rects.length)return null;
    const left=Math.min(...rects.map(rect=>rect.left)),top=Math.min(...rects.map(rect=>rect.top)),right=Math.max(...rects.map(rect=>rect.right)),bottom=Math.max(...rects.map(rect=>rect.bottom));
    return {left,top,right,bottom,width:right-left,height:bottom-top};
  }
  function fitAll(){
    if(state.mobile)return false;
    const bounds=cardBounds();
    if(!bounds)return setViewport({x:80,y:70,zoom:1});
    return state.kernel.viewport.fitBounds(bounds,{
      padding:120,
      maxZoom:1.25,
      duration:240,
      persist:true,
      source:'workspace-fit'
    });
  }
  function focusNode(nodeId,options={}){
    const record=state.cards.get(String(nodeId||''));
    if(!record)return false;
    if(state.mobile){
      record.element.scrollIntoView?.({behavior:'smooth',block:'center'});
      return true;
    }
    const focused=state.kernel.viewport.focusBounds({
      left:record.node.x,
      top:record.node.y,
      width:record.node.width,
      height:record.node.height
    },{
      zoom:options.zoom,
      minZoom:.6,
      maxZoom:1.15,
      duration:220,
      persist:false,
      source:'workspace-focus'
    });
    record.element.animate?.([
      {boxShadow:'0 18px 50px rgba(31,41,65,.13)'},
      {boxShadow:'0 0 0 5px rgba(217,119,6,.18),0 28px 80px rgba(31,41,65,.2)'},
      {boxShadow:''}
    ],{duration:520,easing:'ease-out'});
    replaceUrl(state.workspaceId,nodeId);
    return focused;
  }

  function questionStem(question={},fallback=''){
    if(String(question.stem||'').trim())return String(question.stem).trim();
    if(Array.isArray(question.stemParts))return question.stemParts.map(part=>String(part?.text||'')).join('').trim();
    return String(fallback||'').trim();
  }
  function highlightedMarkup(text,node,region){
    text=String(text||'');
    const records=(Array.isArray(node.highlights)?node.highlights:[])
      .filter(item=>String(item.region||'')===String(region)&&Number(item.end)>Number(item.start))
      .map(item=>({...item,start:Math.max(0,Math.min(text.length,Number(item.start||0))),end:Math.max(0,Math.min(text.length,Number(item.end||0))) }))
      .filter(item=>item.end>item.start)
      .sort((a,b)=>a.start-b.start||a.end-b.end);
    let cursor=0;
    let html='';
    records.forEach(item=>{
      if(item.start<cursor)return;
      html+=escapeHTML(text.slice(cursor,item.start));
      html+='<mark class="qw-text-highlight" data-highlight-id="'+escapeHTML(item.id)+'" data-highlight-color="'+escapeHTML(item.color||'#fde68a')+'" style="--qw-highlight-color:'+escapeHTML(item.color||'#fde68a')+'">'+escapeHTML(text.slice(item.start,item.end))+'</mark>';
      cursor=item.end;
    });
    html+=escapeHTML(text.slice(cursor));
    return html||'&nbsp;';
  }
  function resolvedQuestionForNode(node){
    return findQuestion(node.questionId,node.bankId)?.question||null;
  }
  function linkedSynthesisCount(nodeId){
    const workspace=state.workspace||store()?.read?.(workspaceOptions())||{};
    const nodes=workspace.nodes||{};
    return (workspace.edges||[]).filter(edge=>{
      if(String(edge.source)!==String(nodeId)&&String(edge.target)!==String(nodeId))return false;
      const otherId=String(edge.source)===String(nodeId)?String(edge.target):String(edge.source);
      return nodes[otherId]?.nodeType==='synthesis-card';
    }).length;
  }
  function correctAnswerId(question={}){
    const explicit=String(question.correctAnswer||'').trim();
    if(explicit)return explicit;
    const option=(Array.isArray(question.options)?question.options:[]).find(item=>item?.correct);
    return String(option?.id||'');
  }
  function analysisSectionMarkup(key,title,body,className=''){
    return '<section class="qw-analysis-section '+escapeHTML(className)+'" data-analysis-section="'+escapeHTML(key)+'">'
      +'<h4>'+escapeHTML(title)+'</h4><div class="qw-analysis-section-body">'+body+'</div></section>';
  }
  function questionAnalysisMarkup(question={},node={}){
    const options=Array.isArray(question.options)?question.options:[];
    const answerId=correctAnswerId(question)||String(node.correctAnswer||'');
    const correct=options.find(item=>String(item?.id||'')===answerId)||options.find(item=>item?.correct)||null;
    const explicit=String(question.analysis||question.explanation||question.rationale||question.solution||'').trim();
    const pathText=String(question.keyPath?.ruleText||question.keyPath?.label||'').trim();
    const concepts=(Array.isArray(question.concepts)?question.concepts:[]).slice(0,6);
    const clues=(Array.isArray(question.clues)?question.clues:[]).filter(item=>String(item?.explain||'').trim()).slice(0,6);
    const traps=options.filter(item=>String(item?.trap||'').trim()).slice(0,8);
    const sections=[];
    if(analysisSectionEnabled('analysis')&&explicit)sections.push(analysisSectionMarkup('analysis','题目解析','<p>'+escapeHTML(explicit)+'</p>'));
    if(analysisSectionEnabled('answer')&&(answerId||correct))sections.push(analysisSectionMarkup('answer','正确答案','<p><strong>'+escapeHTML(answerId||correct?.id||'')+'</strong>'+(correct?.text?' · '+escapeHTML(correct.text):'')+'</p>','qw-analysis-answer'));
    if(analysisSectionEnabled('path')&&pathText)sections.push(analysisSectionMarkup('path','判断主线','<p>'+escapeHTML(pathText)+'</p>'));
    if(analysisSectionEnabled('concepts')&&concepts.length)sections.push(analysisSectionMarkup('concepts','知识点','<ul>'+concepts.map(item=>'<li><strong>'+escapeHTML(item.title||'知识点')+'</strong>'+(item.rule||item.summary?'：'+escapeHTML(item.rule||item.summary):'')+'</li>').join('')+'</ul>'));
    if(analysisSectionEnabled('clues')&&clues.length)sections.push(analysisSectionMarkup('clues','关键词讲解','<ul>'+clues.map(item=>'<li><strong>'+escapeHTML(item.text||'线索')+'</strong>：'+escapeHTML(item.explain||'')+'</li>').join('')+'</ul>'));
    if(analysisSectionEnabled('traps')&&traps.length)sections.push(analysisSectionMarkup('traps','选项提示','<ul>'+traps.map(item=>'<li><strong>'+escapeHTML(item.id||'')+'</strong>：'+escapeHTML(item.trap||'')+'</li>').join('')+'</ul>'));
    if(!sections.length)sections.push('<section class="qw-analysis-empty"><h4>暂无可展示内容</h4><p>可在“显示内容”中勾选其他项目；若仍为空，请先在题库中补充解析、知识点或选项提示。</p></section>');
    return sections.join('');
  }
  function analysisConfigMarkup(){
    return '<details class="qw-analysis-config-wrap"><summary title="选择解析显示内容" aria-label="选择解析显示内容"><svg viewBox="0 0 24 24" aria-hidden="true"><path d="M4 7h10M18 7h2M4 17h2M10 17h10M14 4v6M6 14v6"/></svg></summary>'
      +'<fieldset class="qw-analysis-config"><legend>显示内容</legend>'
      +ANALYSIS_SECTION_ORDER.map(key=>'<label><input type="checkbox" data-qw-analysis-section="'+escapeHTML(key)+'" '+(analysisSectionEnabled(key)?'checked':'')+'><span>'+escapeHTML(ANALYSIS_SECTION_LABELS[key]||key)+'</span></label>').join('')
      +'</fieldset></details>';
  }
  function analysisPanelOpen(nodeId){return state.analysisNodeIds.includes(String(nodeId||''))}
  function cardIconButtonMarkup(action,title,icon,options={}){
    const classes=['qw-card-action-square','qw-card-icon-action'];
    if(options.className)classes.push(options.className);
    if(options.active)classes.push('is-active');
    const pressed=options.pressed===undefined?'':' aria-pressed="'+(options.pressed?'true':'false')+'"';
    return '<button type="button" class="'+classes.join(' ')+'" data-qw-action="'+escapeHTML(action)+'" title="'+escapeHTML(title)+'" aria-label="'+escapeHTML(title)+'"'+pressed+'>'+icon+'</button>';
  }
  function cardModeToggleMarkup(displayMode){
    const compact=displayMode==='compact';
    const title=compact?'切换为完整显示':'切换为紧凑显示';
    return '<button type="button" class="qw-card-mode-toggle qw-card-icon-action" data-qw-action="toggle-mode" title="'+title+'" aria-label="'+title+'">'+(compact?CARD_ACTION_ICONS.expand:CARD_ACTION_ICONS.compact)+'</button>';
  }
  function cardWidthResizeMarkup(){
    return '<span class="qw-card-width-resize" data-qw-card-resize role="separator" aria-orientation="vertical" title="拖动调整卡片宽度；完整模式高度会自动适配" aria-label="拖动调整卡片宽度"></span>';
  }
  function questionNodeMarkup(node){
    const question=resolvedQuestionForNode(node)||{};
    const stem=questionStem(question,node.stemSummary||'打开题目查看完整题干。');
    const options=Array.isArray(question.options)?question.options:[];
    const displayMode=node.displayMode==='compact'?'compact':'full';
    const activeAnswer=String(state.answerSelections.get(String(node.id))||'');
    const correctId=correctAnswerId(question)||String(node.correctAnswer||'');
    const optionsMarkup=displayMode==='compact'?'':(options.length?'<ol class="qw-card-options">'+options.map((option,index)=>{
      const key=String(option?.id||String.fromCharCode(65+index));
      const region='option:'+key;
      const active=activeAnswer===key&&key===correctId;
      return '<li class="qw-card-option"><button type="button" class="qw-card-option-key'+(active?' is-correct-active':'')+'" data-qw-option-key="'+escapeHTML(key)+'" title="选择 '+escapeHTML(key)+'" aria-pressed="'+(active?'true':'false')+'">'+escapeHTML(key)+'</button>'
        +'<span class="qw-highlight-region" data-highlight-region="'+escapeHTML(region)+'">'+highlightedMarkup(option?.text||'',node,region)+'</span></li>';
    }).join('')+'</ol>':'<p class="qw-card-question-stem">当前题目没有可用选项。</p>');
    const analysisOpen=analysisPanelOpen(node.id);
    return '<header class="qw-card-header" data-card-drag-handle>'
      +'<div class="qw-card-heading"><span class="qw-card-icon">题</span><div>'
      +'<small>QUESTION REFERENCE</small><h3>'+escapeHTML(node.title)+'</h3></div></div>'
      +'<div class="qw-card-header-actions">'
      +cardModeToggleMarkup(displayMode)+'</div>'
      +'</header>'
      +'<div class="qw-card-body">'
      +'<div class="qw-card-meta"><span>'+escapeHTML(node.topic||'未分类')+'</span>'
      +(node.difficulty?'<span>'+escapeHTML(node.difficulty)+'</span>':'')+'</div>'
      +'<div class="qw-card-content">'
      +'<p class="qw-card-question-stem"><span class="qw-highlight-region" data-highlight-region="stem">'+highlightedMarkup(stem,node,'stem')+'</span></p>'
      +optionsMarkup+'</div>'
      +'<div class="qw-card-actions qw-card-learning-actions">'
      +cardIconButtonMarkup('analysis','显示或关闭本题解析',CARD_ACTION_ICONS.analysis,{active:analysisOpen,pressed:analysisOpen})
      +cardIconButtonMarkup('remove','从画布移除',CARD_ACTION_ICONS.remove,{className:'danger'})
      +'</div></div>'+cardWidthResizeMarkup();
  }
  function synthesisNodeMarkup(node){
    const meta=SYNTHESIS_META[node.synthesisType]||SYNTHESIS_META.principle;
    const status=SYNTHESIS_STATUS[node.status]||SYNTHESIS_STATUS.draft;
    const tags=(Array.isArray(node.tags)?node.tags:[]).map(tag=>'<span>'+escapeHTML(tag)+'</span>').join('');
    const sourceCount=Array.isArray(node.sourceNodeIds)?node.sourceNodeIds.length:0;
    return '<header class="qw-card-header" data-card-drag-handle>'
      +'<div class="qw-card-heading"><span class="qw-card-icon">'+escapeHTML(meta.icon)+'</span><div>'
      +'<small>SYNTHESIS · '+escapeHTML(meta.label.toUpperCase())+'</small><h3 data-qw-inline-field="title" title="双击编辑标题">'+escapeHTML(node.title)+'</h3></div></div>'
      +'<div class="qw-card-header-actions">'
      +cardIconButtonMarkup('edit-title','编辑归纳卡标题',CARD_ACTION_ICONS.edit)
      +cardIconButtonMarkup('edit-node','打开完整编辑',CARD_ACTION_ICONS.settings)
      +'</div>'
      +'</header><div class="qw-card-body">'
      +'<div class="qw-card-meta"><span>'+escapeHTML(meta.label)+'</span><span class="qw-synthesis-status" data-status="'+escapeHTML(node.status||'draft')+'">'+escapeHTML(status)+'</span>'+(sourceCount?'<span>来源 '+sourceCount+' 题</span>':'')+'</div>'
      +'<p class="qw-synthesis-content'+(String(node.content||'').trim()?'':' qw-synthesis-placeholder')+'" data-qw-inline-field="content" title="双击编辑内容">'+escapeHTML(String(node.content||'').trim()||'双击这里补充归纳内容。')+'</p>'
      +(tags?'<div class="qw-synthesis-tags">'+tags+'</div>':'')
      +'<div class="qw-card-actions">'+cardIconButtonMarkup('remove','移除归纳卡',CARD_ACTION_ICONS.remove,{className:'danger'})+'</div>'
      +'</div>'+cardWidthResizeMarkup();
  }
  function nodeMarkup(node){
    return node.nodeType==='synthesis-card'?synthesisNodeMarkup(node):questionNodeMarkup(node);
  }
  function setAnalysisButtonState(nodeId,active){
    const button=state.cards.get(String(nodeId))?.element?.querySelector?.('[data-qw-action="analysis"]');
    if(button){button.classList.toggle('is-active',!!active);button.setAttribute('aria-pressed',active?'true':'false')}
  }
  function closeAnalysisPanel(nodeId='',options={}){
    const ids=nodeId?[String(nodeId)]:state.analysisNodeIds.slice();
    if(!ids.length)return false;
    const remove=new Set(ids);
    state.analysisNodeIds=state.analysisNodeIds.filter(id=>!remove.has(String(id)));
    ids.forEach(id=>{setAnalysisButtonState(id,false);state.analysisPanelOffsets.delete(String(id))});
    renderAnalysisPanels();
    if(options.announce)notify(ids.length>1?'已关闭全部解析。':'已关闭本题解析。');
    return true;
  }
  function analysisPanelElement(nodeId){
    return [...(state.analysisLayer?.querySelectorAll?.('.qw-analysis-panel')||[])].find(panel=>String(panel.dataset.analysisNodeId||'')===String(nodeId||''))||null;
  }
  function positionAnalysisPanels(){
    if(!state.analysisNodeIds.length||!state.analysisLayer)return false;
    state.analysisNodeIds.slice().forEach((nodeId,index)=>{
      const record=state.cards.get(String(nodeId));
      const panel=analysisPanelElement(nodeId);
      if(!record||!panel)return;
      const node=record.node||{};
      const offset=state.analysisPanelOffsets.get(String(nodeId))||{x:0,y:0};
      const x=Number(node.x||0)+Number(node.width||0)+24+Number(offset.x||0);
      const y=Number(node.y||0)+Number(offset.y||0);
      const panelHeight=Math.max(148,Number(panel.offsetHeight||260));
      const anchorY=Number(node.y||0)+Number(node.height||0)/2;
      panel.dataset.side='right';
      panel.style.setProperty('--qw-analysis-pointer-y',clamp(anchorY-y,28,Math.max(28,panelHeight-28))+'px');
      panel.style.removeProperty('--qw-analysis-pointer-x');
      panel.style.left=x+'px';
      panel.style.top=y+'px';
      panel.style.zIndex=String(20+index);
    });
    return true;
  }
  function beginAnalysisPanelDrag(event){
    if(event.button!==0)return false;
    const handle=event.target.closest?.('[data-qw-analysis-drag]');
    const panel=handle?.closest?.('.qw-analysis-panel');
    const nodeId=String(panel?.dataset.analysisNodeId||'');
    const record=state.cards.get(nodeId);
    if(!handle||!panel||!record||event.target.closest?.('button,input,label,summary'))return false;
    const offset=state.analysisPanelOffsets.get(nodeId)||{x:0,y:0};
    state.analysisPanelDrag={pointerId:event.pointerId,nodeId,panel,startX:event.clientX,startY:event.clientY,startOffset:{...offset}};
    panel.classList.add('is-dragging');
    try{panel.setPointerCapture?.(event.pointerId)}catch(error){}
    event.preventDefault();
    return true;
  }
  function moveAnalysisPanelDrag(event){
    const drag=state.analysisPanelDrag;if(!drag||drag.pointerId!==event.pointerId)return false;
    const scale=Math.max(.0001,Number(state.zoom||1));
    state.analysisPanelOffsets.set(drag.nodeId,{x:drag.startOffset.x+(event.clientX-drag.startX)/scale,y:drag.startOffset.y+(event.clientY-drag.startY)/scale});
    positionAnalysisPanels();event.preventDefault();return true;
  }
  function endAnalysisPanelDrag(event){
    const drag=state.analysisPanelDrag;if(!drag||drag.pointerId!==event.pointerId)return false;
    drag.panel?.classList.remove('is-dragging');
    try{drag.panel?.releasePointerCapture?.(event.pointerId)}catch(error){}
    state.analysisPanelDrag=null;event.preventDefault();return true;
  }
  function analysisPanelMarkup(record,index){
    const question=resolvedQuestionForNode(record.node)||{};
    return '<aside class="qw-analysis-panel" data-analysis-node-id="'+escapeHTML(record.node.id)+'" data-side="right" aria-label="本题解析 '+escapeHTML(record.node.title||'')+'">'
      +'<header data-qw-analysis-drag title="拖动调整解析面板位置"><div><small>QUESTION EXPLANATION · '+(index+1)+'</small><h3>'+escapeHTML(record.node.title||'本题解析')+'</h3></div><div class="qw-analysis-header-actions">'
      +analysisConfigMarkup()
      +'<button type="button" data-qw-analysis-close="'+escapeHTML(record.node.id)+'" title="关闭解析" aria-label="关闭解析"><svg viewBox="0 0 24 24" aria-hidden="true"><path d="M7 7l10 10M17 7 7 17"/></svg></button></div></header>'
      +'<div class="qw-analysis-content">'+questionAnalysisMarkup(question,record.node)+'</div>'
      +'</aside>';
  }
  function renderAnalysisPanels(){
    if(!state.analysisLayer)return false;
    state.analysisNodeIds=state.analysisNodeIds.filter(id=>{
      const record=state.cards.get(String(id));
      return !!record&&record.node?.nodeType==='question-reference';
    }).slice(-MAX_ANALYSIS_PANELS);
    if(!state.analysisNodeIds.length){state.analysisLayer.innerHTML='';return false}
    state.analysisLayer.innerHTML=state.analysisNodeIds.map((id,index)=>analysisPanelMarkup(state.cards.get(String(id)),index)).join('');
    positionAnalysisPanels();
    return true;
  }
  function refreshAnalysisPanelContents(){
    if(!state.analysisLayer)return false;
    state.analysisLayer.querySelectorAll('.qw-analysis-panel').forEach(panel=>{
      const nodeId=String(panel.dataset.analysisNodeId||'');
      const record=state.cards.get(nodeId);
      const content=panel.querySelector('.qw-analysis-content');
      if(record&&content)content.innerHTML=questionAnalysisMarkup(resolvedQuestionForNode(record.node)||{},record.node);
      panel.querySelectorAll('[data-qw-analysis-section]').forEach(input=>{
        if(input instanceof HTMLInputElement)input.checked=analysisSectionEnabled(input.dataset.qwAnalysisSection||'');
      });
    });
    requestAnimationFrame(positionAnalysisPanels);
    return true;
  }
  function toggleAnalysisPanel(nodeId){
    nodeId=String(nodeId||'');
    if(!nodeId)return false;
    if(analysisPanelOpen(nodeId))return closeAnalysisPanel(nodeId,{announce:true});
    while(state.analysisNodeIds.length>=MAX_ANALYSIS_PANELS){
      const removed=state.analysisNodeIds.shift();
      setAnalysisButtonState(removed,false);
    }
    state.analysisNodeIds.push(nodeId);
    setAnalysisButtonState(nodeId,true);
    renderAnalysisPanels();
    notify(state.analysisNodeIds.length===2?'已打开第二个解析面板，可并排对比。':'已在题目卡旁打开本题解析。');
    return true;
  }
  function handleOptionChoice(record,key,button){
    if(!record||record.node?.nodeType!=='question-reference')return false;
    const question=resolvedQuestionForNode(record.node)||{};
    const correct=correctAnswerId(question)||String(record.node.correctAnswer||'');
    key=String(key||'');
    if(!correct){notify('当前题目尚未配置正确答案。');return false}
    if(key===correct){
      const active=String(state.answerSelections.get(String(record.id))||'')===key;
      if(active)state.answerSelections.delete(String(record.id));
      else state.answerSelections.set(String(record.id),key);
      record.element?.querySelectorAll?.('[data-qw-option-key]').forEach(item=>{
        const on=!active&&String(item.dataset.qwOptionKey||'')===key;
        item.classList.toggle('is-correct-active',on);
        item.setAttribute('aria-pressed',on?'true':'false');
      });
      notify(active?'已取消本题快速作答标记。':'回答正确。绿色仅标记选项字母，可再次点击取消。');
      return true;
    }
    button?.classList.remove('is-wrong-flash');
    void button?.offsetWidth;
    button?.classList.add('is-wrong-flash');
    global.setTimeout(()=>button?.classList.remove('is-wrong-flash'),430);
    notify('该选项不正确，请继续判断。');
    return false;
  }
  function applyCard(record){
    return state.kernel?.cards?.apply?.(record)||false;
  }
  function syncRecordNode(record,nextNode={}){
    if(!record||!nextNode)return null;
    const target=record.node||record.layout||{};
    Object.keys(target).forEach(key=>{if(!Object.prototype.hasOwnProperty.call(nextNode,key))delete target[key]});
    Object.assign(target,nextNode);
    record.node=target;
    record.layout=target;
    return target;
  }
  function cardLayoutSnapshot(records=[]){
    return state.kernel?.selection?.captureLayouts?.(records)||Object.fromEntries((records||[]).map(record=>[
      String(record.id),
      {x:Number(record.node?.x||0),y:Number(record.node?.y||0),width:Number(record.node?.width||0),height:Number(record.node?.height||0)}
    ]));
  }
  function measureFullCardHeight(record){
    if(!record?.element)return Number(record?.node?.height||COMPACT_CARD_HEIGHT);
    const element=record.element;
    const compact=record.node?.nodeType==='question-reference'&&element.dataset.displayMode==='compact';
    const minimum=compact?COMPACT_CARD_HEIGHT:FULL_CARD_MIN_HEIGHT;
    const previousHeight=element.style.height;
    const previousOverflow=element.style.overflow;
    element.classList.add('is-measuring-full-height');
    element.style.height='auto';
    element.style.overflow='visible';
    const header=element.querySelector('.qw-card-header');
    const body=element.querySelector('.qw-card-body');
    const structuralHeight=Math.ceil(Number(header?.scrollHeight||header?.offsetHeight||0)+Number(body?.scrollHeight||body?.offsetHeight||0)+2);
    const measured=clamp(
      Math.ceil(Math.max(minimum,Number(element.scrollHeight||0),Number(element.offsetHeight||0),structuralHeight)),
      minimum,
      FULL_CARD_MAX_HEIGHT
    );
    element.style.height=previousHeight;
    element.style.overflow=previousOverflow;
    element.classList.remove('is-measuring-full-height');
    return measured;
  }
  function syncFullCardHeights(options={}){
    const records=(options.records||[...state.cards.values()]).filter(record=>record?.element);
    if(!records.length)return {changed:false,before:{},after:{},records:[]};
    const before=cardLayoutSnapshot(records);
    const measured=new Map(records.map(record=>[String(record.id),measureFullCardHeight(record)]));
    const equalHeight=options.equalize?Math.max(...measured.values()):0;
    let changed=false;
    records.forEach(record=>{
      const nextHeight=equalHeight||measured.get(String(record.id))||Number(record.node?.height||FULL_CARD_MIN_HEIGHT);
      if(Math.abs(Number(record.node?.height||0)-nextHeight)>.5){record.node.height=nextHeight;changed=true}
      applyCard(record);
    });
    let after=cardLayoutSnapshot(records);
    if(changed&&options.persist!==false)after=persistLayoutSnapshot(after,options.reason||'full-card-auto-height');
    else if(changed)renderMinimap();
    if(changed){renderStructure();scheduleLayoutDiagnosis()}
    return {changed,before,after,records};
  }
  function updateNodeCountLabel(total=state.cards.size){
    const count=byId('qwNodeCount');
    if(!count)return;
    const selected=state.selectedNodeIds.size;
    const workspace=state.workspace||{};
    const nodes=Object.values(workspace.nodes||{});
    const questions=nodes.filter(node=>node.nodeType==='question-reference').length;
    const synthesis=nodes.filter(node=>node.nodeType==='synthesis-card').length;
    count.textContent=Number(total||0)+' 卡 · '+questions+' 题'+(synthesis?' · '+synthesis+' 归纳':'')+(selected?' · 已选 '+selected:'');
    count.classList.toggle('has-selection',selected>0);
  }
  function syncCardSelectionUI(){
    const selected=state.kernel?.selection?.selectedIds||state.selectedNodeIds;
    [...selected].forEach(id=>{if(!state.cards.has(String(id)))selected.delete(String(id))});
    state.selectedNodeIds=selected;
    state.cards.forEach(record=>{
      const active=selected.has(String(record.id));
      record.element?.classList.toggle('is-selected',active);
      record.element?.setAttribute('aria-selected',active?'true':'false');
    });
    state.viewport?.classList.toggle('has-card-selection',selected.size>0);
    updateNodeCountLabel();
    scheduleSelectionToolbarPosition();
    return selected.size;
  }
  function setCardSelection(ids=[],options={}){
    const controller=state.kernel?.selection;
    const count=controller?controller.set(ids,{reason:options.reason||'workspace-set'}):0;
    if(options.announce){
      if(count)notify('已选择 '+count+' 张卡片；拖动任一已选卡可整体移动。');
      else notify('已取消卡片选择。');
    }
    return count;
  }
  function clearCardSelection(options={}){
    if(!state.selectedNodeIds.size)return 0;
    const count=state.kernel?.selection?.clear({reason:options.reason||'workspace-clear'})||0;
    if(options.announce)notify('已取消卡片选择。');
    return count;
  }
  function toggleCardSelection(nodeId){
    const count=state.kernel?.selection?.toggle(String(nodeId||''),{reason:'workspace-toggle'})||0;
    notify(count?'已选择 '+count+' 张卡片；Ctrl/Command 点击可继续增减选择。':'已取消卡片选择。');
    return count;
  }
  function selectedRecords(){
    return [...state.selectedNodeIds].map(id=>state.cards.get(String(id))).filter(record=>record?.element&&!record.element.classList.contains('is-group-collapsed'));
  }
  function beginViewportMotion(kind='zoom'){
    hideEdgeQuickMenu();hideEdgeInlineEditor();
    document.body?.classList.add('qw-viewport-motion');
    if(kind==='zoom'){
      state.selectionToolbarSuppressed=true;
      const toolbar=byId('qwSelectionToolbar');if(toolbar)toolbar.hidden=true;
    }
    clearTimeout(state.viewportMotionTimer);
    state.viewportMotionTimer=global.setTimeout(()=>{
      state.viewportMotionTimer=null;
      state.selectionToolbarSuppressed=false;
      document.body?.classList.remove('qw-viewport-motion');
      scheduleSelectionToolbarPosition();
    },190);
  }
  function scheduleSelectionToolbarPosition(){
    if(state.selectionToolbarRaf)global.cancelAnimationFrame?.(state.selectionToolbarRaf);
    const schedule=global.requestAnimationFrame||((callback)=>global.setTimeout(callback,0));
    state.selectionToolbarRaf=schedule(()=>{state.selectionToolbarRaf=0;updateSelectionToolbar()});
  }
  function updateSelectionToolbar(){
    const toolbar=byId('qwSelectionToolbar');
    if(!toolbar)return false;
    const records=selectedRecords();
    const visible=!state.selectionToolbarSuppressed&&!state.readonly&&!state.mobile&&records.length>=1&&state.pointerMode!=='pan';
    toolbar.hidden=!visible;
    if(!visible){
      const palette=byId('qwSelectionColorPalette');
      if(palette)palette.hidden=true;
      return false;
    }
    const rects=records.map(record=>record.element.getBoundingClientRect()).filter(rect=>rect.width&&rect.height);
    if(!rects.length){toolbar.hidden=true;return false}
    const shellRect=byId('qwCanvasShell')?.getBoundingClientRect?.()||state.viewport.getBoundingClientRect();
    const left=Math.min(...rects.map(rect=>rect.left));
    const right=Math.max(...rects.map(rect=>rect.right));
    const top=Math.min(...rects.map(rect=>rect.top));
    const bottom=Math.max(...rects.map(rect=>rect.bottom));
    const width=Number(toolbar.offsetWidth||156),height=Number(toolbar.offsetHeight||48);
    let x=(left+right)/2-shellRect.left-width/2;
    let y=top-shellRect.top-height-12;
    const minX=12,maxX=Math.max(minX,shellRect.width-width-12);
    x=clamp(x,minX,maxX);
    toolbar.classList.toggle('is-below',y<72);
    if(y<72)y=bottom-shellRect.top+12;
    toolbar.style.left=x+'px';
    toolbar.style.top=y+'px';
    toolbar.dataset.selectionCount=String(records.length);
    toolbar.querySelectorAll('[data-qw-selection-action="group"],[data-qw-selection-action="synthesize"]').forEach(button=>button.disabled=records.length<2);
    return true;
  }
  function selectionWorldBounds(records=selectedRecords()){
    if(!records.length)return {x:100,y:100,width:520,height:320,right:620,bottom:420};
    const x=Math.min(...records.map(record=>Number(record.node.x||0)));
    const y=Math.min(...records.map(record=>Number(record.node.y||0)));
    const right=Math.max(...records.map(record=>Number(record.node.x||0)+Number(record.node.width||0)));
    const bottom=Math.max(...records.map(record=>Number(record.node.y||0)+Number(record.node.height||0)));
    return {x,y,width:right-x,height:bottom-y,right,bottom};
  }
  function uniqueDefaultGroupTitle(){
    const groups=state.workspace?.groups||[];
    if(!groups.some(group=>String(group.title)==='新分组'))return '新分组';
    let index=2;
    while(groups.some(group=>String(group.title)===('新分组 '+index)))index+=1;
    return '新分组 '+index;
  }
  function quickCreateGroup(){
    if(!canEdit())return false;
    const ids=[...state.selectedNodeIds].filter(id=>state.cards.has(String(id)));
    if(ids.length<2){notify('请先框选至少 2 张卡片。');return false}
    const before=workspaceSnapshot();
    const bounds=groupBoundsFromNodeIds(ids);
    state.suppressStoreEvent=true;
    let result=null;
    try{
      result=store()?.createGroup?.({title:uniqueDefaultGroupTitle(),color:'#ede9fe',...bounds},ids,workspaceOptions());
    }finally{state.suppressStoreEvent=false}
    if(!result?.created){notify('未能建立分组，请重新框选后再试。');return false}
    const after=workspaceSnapshot();
    pushWorkspaceHistory('快速成组',before,after);
    state.workspace=after;
    renderCards();
    setCardSelection(ids,{reason:'quick-group-retain'});
    scheduleSelectionToolbarPosition();
    global.setTimeout(()=>beginGroupTitleEdit(result.group.id),30);
    setActiveGroup(result.group.id,{force:true});
    notify('已建立并激活分组。双击名称可直接编辑；激活后可从容器空白区域或成员卡标题整体拖动。');
    return true;
  }
  function mostFrequent(values=[]){
    const counts=new Map();
    values.map(value=>String(value||'').trim()).filter(Boolean).forEach(value=>counts.set(value,(counts.get(value)||0)+1));
    return [...counts.entries()].sort((a,b)=>b[1]-a[1]||a[0].localeCompare(b[0],'zh-CN'))[0]?.[0]||'';
  }
  function synthesisDraftFromSelection(records=selectedRecords()){
    const questions=records.filter(record=>record.node?.nodeType==='question-reference');
    const topics=questions.map(record=>record.node.topic);
    const commonTopic=mostFrequent(topics)||'多题共性';
    const titles=questions.map(record=>String(record.node.title||'未命名题目')).slice(0,8);
    const answers=questions.map(record=>{
      const question=resolvedQuestionForNode(record.node)||{};
      return correctAnswerId(question)||String(record.node.correctAnswer||'');
    }).filter(Boolean);
    const answerCounts=new Map();
    answers.forEach(answer=>answerCounts.set(answer,(answerCounts.get(answer)||0)+1));
    const answerText=[...answerCounts.entries()].sort().map(([answer,count])=>answer+'×'+count).join('、')||'待补充';
    const concepts=[];
    questions.forEach(record=>{
      const question=resolvedQuestionForNode(record.node)||{};
      (Array.isArray(question.concepts)?question.concepts:[]).forEach(item=>{const title=String(item?.title||'').trim();if(title&&!concepts.includes(title))concepts.push(title)});
    });
    const content=[
      '共同主题：'+commonTopic,
      '来源题目：'+(titles.length?titles.join('；'):'所选卡片'),
      '答案分布：'+answerText,
      '相关知识点：'+(concepts.slice(0,8).join('、')||'待补充'),
      '',
      '待提炼：请双击这里，补充这些题目的共同判断依据、解题步骤与易错点。'
    ].join('\n');
    return {
      synthesisType:'principle',
      title:'归纳：'+commonTopic+'（'+questions.length+'题）',
      content,
      tags:[commonTopic,...concepts.slice(0,5)],
      color:'#ede9fe',
      status:'draft',
      sourceNodeIds:questions.map(record=>String(record.id)),
      autoGenerated:true
    };
  }
  function layoutRectIntersects(first,second,clearance=CARD_PLACEMENT_CLEARANCE){
    return Number(first.x)<Number(second.x)+Number(second.width)+clearance
      &&Number(first.x)+Number(first.width)+clearance>Number(second.x)
      &&Number(first.y)<Number(second.y)+Number(second.height)+clearance
      &&Number(first.y)+Number(first.height)+clearance>Number(second.y);
  }
  function findOpenCardPosition(preferred={},options={}){
    const width=Math.max(MULTI_CARD_MIN_WIDTH,Number(options.width||preferred.width||460));
    const height=Math.max(FULL_CARD_MIN_HEIGHT,Number(options.height||preferred.height||360));
    const minX=60,maxX=Math.max(minX,WORLD_WIDTH-width-60);
    const minY=60,maxY=Math.max(minY,WORLD_HEIGHT-height-60);
    const startX=clamp(Number(preferred.x||minX),minX,maxX);
    const startY=clamp(Number(preferred.y||minY),minY,maxY);
    const excluded=new Set((options.excludeIds||[]).map(String));
    const occupied=[...state.cards.values()]
      .filter(record=>!excluded.has(String(record.id))&&!record.element?.classList.contains('is-group-collapsed'))
      .map(record=>liveCardLayout(record));
    const xStep=Math.max(96,Math.min(180,Math.round(width/3)));
    const xCandidates=[startX];
    for(let delta=xStep;delta<=WORLD_WIDTH;delta+=xStep){
      const right=startX+delta,left=startX-delta;
      if(right<=maxX)xCandidates.push(right);
      if(left>=minX)xCandidates.push(left);
      if(right>maxX&&left<minX)break;
    }
    const rowStep=Math.max(96,Math.min(height+CARD_PLACEMENT_CLEARANCE,520));
    const yCandidates=[];
    for(let y=startY;y<=maxY;y+=rowStep)yCandidates.push(y);
    for(let y=startY-rowStep;y>=minY;y-=rowStep)yCandidates.push(y);
    for(const y of yCandidates){
      for(const x of xCandidates){
        const candidate={x:clamp(x,minX,maxX),y:clamp(y,minY,maxY),width,height};
        if(!occupied.some(rect=>layoutRectIntersects(candidate,rect)))return candidate;
      }
    }
    return {x:startX,y:startY,width,height};
  }
  function quickCreateSynthesis(){
    if(!canEdit())return false;
    const records=selectedRecords();
    const questions=records.filter(record=>record.node?.nodeType==='question-reference');
    if(questions.length<2){notify('请先框选至少 2 张题目卡再生成归纳。');return false}
    const payload=synthesisDraftFromSelection(records);
    const bounds=selectionWorldBounds(records);
    const cardWidth=460,cardHeight=360,gap=72;
    const preferredBelow=bounds.bottom+gap;
    const fallbackAbove=bounds.y-cardHeight-gap;
    const preferred={
      x:clamp(bounds.x+(bounds.width-cardWidth)/2,60,WORLD_WIDTH-cardWidth-60),
      y:preferredBelow+cardHeight<=WORLD_HEIGHT-60?preferredBelow:clamp(fallbackAbove,60,WORLD_HEIGHT-cardHeight-60),
      width:cardWidth,
      height:cardHeight
    };
    const position=findOpenCardPosition(preferred,{width:cardWidth,height:cardHeight});
    const before=workspaceSnapshot();
    state.suppressStoreEvent=true;
    let result=null;
    try{
      result=store()?.addSynthesisCard?.(payload,position,workspaceOptions());
      if(result?.created){
        questions.forEach(record=>store()?.addEdge?.({source:String(record.id),target:String(result.node.id),type:'support',label:'',lineStyle:'solid',pathStyle:'curve'},workspaceOptions()));
      }
    }finally{state.suppressStoreEvent=false}
    if(!result?.created){notify('归纳卡生成失败，请重试。');return false}
    const after=workspaceSnapshot();
    pushWorkspaceHistory('根据所选题目生成归纳卡并建立无文字来源关系',before,after);
    state.workspace=after;
    renderCards();
    setCardSelection([result.node.id],{reason:'quick-synthesis-select'});
    focusNode(result.node.id,{zoom:Math.max(state.zoom,.72)});
    global.setTimeout(()=>{
      const element=state.cards.get(String(result.node.id))?.element?.querySelector?.('[data-qw-inline-field="title"]');
      if(element)beginInlineNodeEdit(element,result.node.id,'title');
    },80);
    notify('已生成归纳卡，并自动连接所选题目。标题和正文均可双击直接编辑。');
    return true;
  }
  function selectedCommonGroup(ids=[...state.selectedNodeIds]){
    const normalized=ids.map(String);
    if(!normalized.length)return null;
    return (state.workspace?.groups||[]).find(group=>normalized.every(id=>(group.nodeIds||[]).map(String).includes(id)))||null;
  }
  function applySelectionColor(color){
    if(!canEdit())return false;
    color=String(color||'');
    if(!CARD_COLORS.includes(color))return false;
    const ids=[...state.selectedNodeIds].filter(id=>state.cards.has(String(id)));
    if(!ids.length)return false;
    const before=workspaceSnapshot();
    const draft=clone(before);
    const group=ids.length>1?selectedCommonGroup(ids):null;
    let label='设置卡片颜色';
    if(group){
      const target=(draft.groups||[]).find(item=>String(item.id)===String(group.id));
      if(target){target.color=color;target.updatedAt=Date.now();label='设置分组颜色'}
    }else{
      ids.forEach(id=>{
        const node=draft.nodes?.[String(id)];
        if(node){node.color=color;node.updatedAt=Date.now()}
      });
    }
    state.suppressStoreEvent=true;
    try{state.workspace=store()?.write?.(draft,{reason:'selection-color-updated'})||draft}finally{state.suppressStoreEvent=false}
    const after=workspaceSnapshot();
    pushWorkspaceHistory(label,before,after);
    renderCards();
    setCardSelection(ids,{reason:'color-retain'});
    notify((group?'分组':'所选卡片')+'颜色已更新。可按 Ctrl/Command+Z 撤销。');
    return true;
  }
  function placeCaretAtEnd(element){
    try{
      const range=document.createRange(),selection=global.getSelection();
      range.selectNodeContents(element);range.collapse(false);selection.removeAllRanges();selection.addRange(range);
    }catch(e){}
  }
  function beginInlineNodeEdit(element,nodeId,field){
    if(!canEdit()||!element||!['title','content'].includes(String(field)))return false;
    const record=state.cards.get(String(nodeId));
    if(!record?.node||record.node.nodeType!=='synthesis-card')return false;
    if(element.isContentEditable)return true;
    const original=String(record.node[field]||'');
    element.textContent=original;
    element.contentEditable='true';
    element.classList.add('is-inline-editing');
    element.dataset.inlineOriginal=original;
    element.focus();
    placeCaretAtEnd(element);
    let settled=false,keydownHandler=null,blurHandler=null;
    const cleanup=()=>{
      if(keydownHandler)element.removeEventListener('keydown',keydownHandler);
      if(blurHandler)element.removeEventListener('blur',blurHandler);
    };
    const finish=(commit)=>{
      if(settled)return;settled=true;cleanup();
      const next=String(element.innerText||element.textContent||'').trim();
      element.removeAttribute('contenteditable');
      element.classList.remove('is-inline-editing');
      if(!commit){element.textContent=original|| (field==='content'?'双击这里补充归纳内容。':'未命名归纳卡');return}
      const value=field==='title'?(next||'未命名归纳卡'):next;
      if(value===original){refreshSingleCardMarkup(record);applyCard(record);return}
      const before=workspaceSnapshot();
      let result=null;
      state.suppressStoreEvent=true;
      try{result=store()?.updateNode?.(nodeId,{[field]:value},workspaceOptions())}finally{state.suppressStoreEvent=false}
      if(!result?.node){refreshSingleCardMarkup(record);applyCard(record);notify('归纳卡更新失败，请重试。');return}
      const after=workspaceSnapshot();
      pushWorkspaceHistory(field==='title'?'编辑归纳标题':'编辑归纳内容',before,after);
      state.workspace=result.workspace||after;
      syncRecordNode(record,result.node);
      refreshSingleCardMarkup(record);
      applyCard(record);
      renderStructure();updateEdgesGeometry();renderMinimap();scheduleLayoutDiagnosis();
      setCardSelection([nodeId],{reason:'inline-edit-retain'});
      notify('归纳卡已更新。');
    };
    keydownHandler=event=>{
      if(event.key==='Escape'){event.preventDefault();finish(false)}
      else if(field==='title'&&event.key==='Enter'){event.preventDefault();finish(true)}
      else if(field==='content'&&(event.ctrlKey||event.metaKey)&&event.key==='Enter'){event.preventDefault();finish(true)}
    };
    blurHandler=()=>finish(true);
    element.addEventListener('keydown',keydownHandler);
    element.addEventListener('blur',blurHandler,{once:true});
    return true;
  }
  function beginGroupTitleEdit(groupId){
    if(!canEdit())return false;
    const group=(state.workspace?.groups||[]).find(item=>String(item.id)===String(groupId));
    const element=state.groupElements.get(String(groupId))?.querySelector?.('[data-qw-group-title]');
    if(!group||!element)return false;
    if(element.isContentEditable)return true;
    const original=String(group.title||'新分组');
    element.textContent=original;
    element.contentEditable='true';
    element.classList.add('is-inline-editing');
    element.focus();placeCaretAtEnd(element);
    let settled=false,keydownHandler=null,blurHandler=null;
    const cleanup=()=>{
      if(keydownHandler)element.removeEventListener('keydown',keydownHandler);
      if(blurHandler)element.removeEventListener('blur',blurHandler);
    };
    const finish=(commit)=>{
      if(settled)return;settled=true;cleanup();
      const value=String(element.innerText||element.textContent||'').trim()||'新分组';
      element.removeAttribute('contenteditable');element.classList.remove('is-inline-editing');
      if(!commit){element.textContent=original;return}
      if(value===original)return;
      const before=workspaceSnapshot();
      state.suppressStoreEvent=true;
      try{store()?.updateGroup?.(groupId,{title:value},workspaceOptions())}finally{state.suppressStoreEvent=false}
      const after=workspaceSnapshot();pushWorkspaceHistory('编辑分组名称',before,after);
      state.workspace=after;renderCards();notify('分组名称已更新。');
    };
    keydownHandler=event=>{
      if(event.key==='Escape'){event.preventDefault();finish(false)}
      else if(event.key==='Enter'){event.preventDefault();finish(true)}
    };
    blurHandler=()=>finish(true);
    element.addEventListener('keydown',keydownHandler);
    element.addEventListener('blur',blurHandler,{once:true});
    return true;
  }
  const ARRANGE_LABELS=Object.freeze({
    'align-left':'左对齐','align-center':'水平居中','align-right':'右对齐',
    'align-top':'顶部对齐','align-middle':'垂直居中','align-bottom':'底部对齐',
    'distribute-x':'横向等距分布','distribute-y':'纵向等距分布',
    'same-width':'统一宽度','same-height':'统一高度','same-size':'统一宽高'
  });
  function layoutsEqual(first={},second={}){
    const ids=[...new Set([...Object.keys(first||{}),...Object.keys(second||{})])];
    return ids.every(id=>['x','y','width','height'].every(key=>Math.abs(Number(first?.[id]?.[key]||0)-Number(second?.[id]?.[key]||0))<.001));
  }
  function authoritativeLayoutSnapshot(snapshot={},workspace=null){
    const nodes=workspace?.nodes||{};
    return Object.fromEntries(Object.entries(snapshot||{}).map(([nodeId,layout])=>{
      const saved=nodes[String(nodeId)]||layout;
      return [String(nodeId),{
        x:Number(saved.x),y:Number(saved.y),width:Number(saved.width),height:Number(saved.height)
      }];
    }));
  }
  function persistLayoutSnapshot(snapshot={},reason='layout-batch'){
    const controller=state.kernel?.selection;
    controller?.restoreLayouts?.(snapshot,{reason});
    let result=null;
    state.suppressStoreEvent=true;
    try{
      if(typeof store()?.updateNodeLayouts==='function')result=store().updateNodeLayouts(snapshot,workspaceOptions());
      else{
        Object.entries(snapshot||{}).forEach(([nodeId,layout])=>store()?.updateNodeLayout?.(nodeId,layout,workspaceOptions()));
        result={workspace:store()?.read?.(workspaceOptions())||null};
      }
    }finally{state.suppressStoreEvent=false}
    const authoritative=authoritativeLayoutSnapshot(snapshot,result?.workspace||null);
    if(!layoutsEqual(snapshot,authoritative))controller?.restoreLayouts?.(authoritative,{reason:reason+'-normalized'});
    renderMinimap();
    return authoritative;
  }
  function pushLayoutHistory(label,before,after){
    if(!before||!after||layoutsEqual(before,after))return false;
    return state.kernel?.history?.push?.({
      label:String(label||'布局操作'),
      undo:()=>persistLayoutSnapshot(before,'history-undo'),
      redo:()=>persistLayoutSnapshot(after,'history-redo')
    })||false;
  }
  function updateHistoryUI(){
    const history=state.kernel?.history?.getState?.()||{};
    const undo=byId('qwUndoBtn'),redo=byId('qwRedoBtn');
    if(undo){undo.disabled=state.readonly||!history.canUndo;undo.title=history.canUndo?'撤销：'+history.undoLabel+'（Ctrl/Command+Z）':'暂无可撤销的布局操作'}
    if(redo){redo.disabled=state.readonly||!history.canRedo;redo.title=history.canRedo?'重做：'+history.redoLabel+'（Ctrl/Command+Shift+Z）':'暂无可重做的布局操作'}
    return history;
  }
  function updateLayoutToolbar(){
    const count=state.selectedNodeIds.size;
    const select=byId('qwArrangeSelect');
    const countLabel=byId('qwArrangeSelectionCount');
    if(countLabel)countLabel.textContent=count>=2?'已选 '+count+' 张':(count===1?'再选择 1 张':'选择至少 2 张卡片');
    if(select){
      select.disabled=state.readonly||count<2;
      [...select.options].forEach(option=>{
        if(option.value==='distribute-x'||option.value==='distribute-y')option.disabled=count<3;
      });
      if(select.options?.[0])select.options[0].textContent=count>=2?'已选 '+count+' 张 · 选择排列方式':'选择排列方式（选择后立即执行）';
      if(select.selectedOptions?.[0]?.disabled)select.value='';
    }
    const toolbar=byId('qwLayoutToolbar');
    toolbar?.classList.toggle('has-selection',count>=2);
    const groupBtn=byId('qwCreateGroupBtn'),connectBtn=byId('qwConnectBtn'),newCardBtn=byId('qwNewSynthesisBtn'),smart=byId('qwSmartArrangeSelect');
    if(groupBtn)groupBtn.disabled=state.readonly||count<2;
    if(connectBtn)connectBtn.disabled=state.readonly||count!==2;
    if(newCardBtn)newCardBtn.disabled=state.readonly;
    if(smart)smart.disabled=state.readonly||state.cards.size<1;
    updateHistoryUI();
    return count;
  }
  function applySelectedArrangement(type=String(byId('qwArrangeSelect')?.value||'')){
    if(!canEdit())return false;
    const controller=state.kernel?.selection;
    const count=controller?.refresh?.('arrange-refresh')||0;
    if(count<2){notify('请先框选至少 2 张卡片。');return false}
    type=String(type||'');
    if(!ARRANGE_LABELS[type]){notify('请选择有效的排列方式。');return false}
    if((type==='distribute-x'||type==='distribute-y')&&count<3){notify('等距分布至少需要选择 3 张卡片。');return false}
    const result=controller?.arrange?.(type);
    if(!result){notify('未能执行排列，请重新框选题目卡后再试。');return false}
    if(type==='same-width')syncFullCardHeights({records:result.records,persist:false});
    if(type==='same-height'||type==='same-size'){
      syncFullCardHeights({records:result.records,persist:false});
      const targetHeight=Math.max(...result.records.map(record=>Number(record.node?.height||FULL_CARD_MIN_HEIGHT)));
      result.records.forEach(record=>{record.node.height=targetHeight;applyCard(record)});
    }
    const proposed=cardLayoutSnapshot(result.records);
    if(layoutsEqual(result.before,proposed)){
      notify('所选卡片已经处于“'+ARRANGE_LABELS[type]+'”状态。');
      return true;
    }
    const persisted=persistLayoutSnapshot(proposed,'arrange-'+type);
    pushLayoutHistory(ARRANGE_LABELS[type],result.before,persisted);
    renderStructure();scheduleLayoutDiagnosis();
    setCardSelection(result.records.map(record=>record.id),{reason:'arrange-retain'});
    notify('已完成'+ARRANGE_LABELS[type]+'。可按 Ctrl/Command+Z 撤销。');
    return true;
  }
  function handleArrangeSelection(event){
    const select=event?.currentTarget||byId('qwArrangeSelect');
    const type=String(select?.value||'');
    if(type)applySelectedArrangement(type);
    if(select)select.value='';
    updateLayoutToolbar();
  }
  function undoLayout(){
    if(state.readonly)return false;
    const command=state.kernel?.history?.undo?.();
    if(command)notify('已撤销：'+command.label+'。');
    return !!command;
  }
  function redoLayout(){
    if(state.readonly)return false;
    const command=state.kernel?.history?.redo?.();
    if(command)notify('已重做：'+command.label+'。');
    return !!command;
  }
  function nodeTitle(nodeId){
    return String(state.cards.get(String(nodeId||''))?.node?.title||state.workspace?.nodes?.[String(nodeId||'')]?.title||'未命名卡片');
  }
  function workspaceSnapshot(){return clone(store()?.ensure?.(workspaceOptions())||state.workspace||{})}
  function restoreWorkspaceSnapshot(snapshot,reason='workspace-history'){
    if(!snapshot?.id)return false;
    state.suppressStoreEvent=true;
    try{state.workspace=store()?.write?.(clone(snapshot),{reason})||clone(snapshot)}finally{state.suppressStoreEvent=false}
    renderCards();
    return true;
  }
  function pushWorkspaceHistory(label,before,after){
    if(!before||!after||JSON.stringify(before)===JSON.stringify(after))return false;
    return state.kernel?.history?.push?.({
      label:String(label||'画布结构操作'),
      undo:()=>restoreWorkspaceSnapshot(before,'structure-history-undo'),
      redo:()=>restoreWorkspaceSnapshot(after,'structure-history-redo')
    })||false;
  }
  function commitWorkspaceMutation(label,mutator,message=''){
    if(!canEdit())return null;
    const before=workspaceSnapshot();
    const draft=clone(before);
    const next=typeof mutator==='function'?(mutator(draft)||draft):draft;
    state.suppressStoreEvent=true;
    try{state.workspace=store()?.write?.(next,{reason:'structure-'+String(label||'updated')})||next}finally{state.suppressStoreEvent=false}
    const after=workspaceSnapshot();
    pushWorkspaceHistory(label,before,after);
    renderCards();
    if(message)notify(message+' 可按 Ctrl/Command+Z 撤销。');
    return after;
  }
  function modalElements(){return ['qwSynthesisModal','qwGroupModal','qwEdgeModal'].map(byId).filter(Boolean)}
  function closeStructureModals(){
    modalElements().forEach(element=>element.hidden=true);
    const backdrop=byId('qwStructureBackdrop');
    if(backdrop)backdrop.hidden=true;
    state.editingSynthesisNodeId='';
    state.editingGroupId='';
    state.editingEdgeId='';
    state.pendingSynthesisPosition=null;
  }
  function showStructureModal(id){
    modalElements().forEach(element=>element.hidden=element.id!==id);
    const backdrop=byId('qwStructureBackdrop');
    if(backdrop)backdrop.hidden=false;
    const modal=byId(id);
    if(modal){modal.hidden=false;setTimeout(()=>modal.querySelector('input,textarea,select')?.focus?.(),0)}
  }
  function viewportCenterWorld(){
    const rect=state.viewport.getBoundingClientRect();
    const point=clientToWorld(rect.left+rect.width/2,rect.top+rect.height/2);
    return {x:point.x-210,y:point.y-140,width:420,height:280};
  }
  function openSynthesisModal(nodeId='',position=null){
    if(!canEdit())return false;
    const node=nodeId?state.workspace?.nodes?.[String(nodeId)]:null;
    if(nodeId&&!node)return false;
    state.editingSynthesisNodeId=String(nodeId||'');
    state.pendingSynthesisPosition=position||viewportCenterWorld();
    byId('qwSynthesisModalTitle').textContent=node?'编辑归纳卡':'新增归纳卡';
    byId('qwSynthesisType').value=String(node?.synthesisType||'principle');
    byId('qwSynthesisTitle').value=String(node?.title||'');
    byId('qwSynthesisContent').value=String(node?.content||'');
    byId('qwSynthesisTags').value=(Array.isArray(node?.tags)?node.tags:[]).join('，');
    byId('qwSynthesisColor').value=String(node?.color||'#ede9fe');
    byId('qwSynthesisStatus').value=String(node?.status||'draft');
    showStructureModal('qwSynthesisModal');
    return true;
  }
  function parseTags(value){return [...new Set(String(value||'').split(/[，,、;；\n]/).map(item=>item.trim()).filter(Boolean))].slice(0,24)}
  function saveSynthesisCard(){
    if(!canEdit())return false;
    const payload={
      synthesisType:String(byId('qwSynthesisType')?.value||'principle'),
      title:String(byId('qwSynthesisTitle')?.value||'').trim(),
      content:String(byId('qwSynthesisContent')?.value||'').trim(),
      tags:parseTags(byId('qwSynthesisTags')?.value||''),
      color:String(byId('qwSynthesisColor')?.value||'#ede9fe'),
      status:String(byId('qwSynthesisStatus')?.value||'draft')
    };
    const meta=SYNTHESIS_META[payload.synthesisType]||SYNTHESIS_META.principle;
    if(!payload.title)payload.title='未命名'+meta.label;
    const editingId=state.editingSynthesisNodeId;
    const position=state.pendingSynthesisPosition||viewportCenterWorld();
    const before=workspaceSnapshot();
    state.suppressStoreEvent=true;
    let result=null;
    try{
      result=editingId
        ?store()?.updateNode?.(editingId,payload,workspaceOptions())
        :store()?.addSynthesisCard?.(payload,position,workspaceOptions());
    }finally{state.suppressStoreEvent=false}
    if(!result){notify('归纳卡保存失败，请重试。');return false}
    const nodeId=String(result.node?.id||editingId||'');
    const after=workspaceSnapshot();
    pushWorkspaceHistory(editingId?'编辑归纳卡':'新增归纳卡',before,after);
    closeStructureModals();
    state.workspace=after;
    renderCards();
    if(nodeId){setCardSelection([nodeId]);focusNode(nodeId,{zoom:Math.max(state.zoom,.75)})}
    notify((editingId?'已更新':'已新增')+meta.label+'。可与题目卡建立关系。');
    return true;
  }
  function groupBoundsFromNodeIds(nodeIds,padding=42){
    const records=(nodeIds||[]).map(id=>state.cards.get(String(id))).filter(Boolean);
    if(!records.length)return {x:100,y:100,width:520,height:360};
    const left=Math.min(...records.map(record=>Number(record.node.x||0)));
    const top=Math.min(...records.map(record=>Number(record.node.y||0)));
    const right=Math.max(...records.map(record=>Number(record.node.x||0)+Number(record.node.width||0)));
    const bottom=Math.max(...records.map(record=>Number(record.node.y||0)+Number(record.node.height||0)));
    return {x:left-padding,y:top-padding-16,width:right-left+padding*2,height:bottom-top+padding*2+16};
  }
  function openGroupModal(groupId=''){
    if(!canEdit())return false;
    const group=groupId?(state.workspace?.groups||[]).find(item=>String(item.id)===String(groupId)):null;
    if(!group&&state.selectedNodeIds.size<2){notify('请先选择至少 2 张卡片再建立分组。');return false}
    state.editingGroupId=String(groupId||'');
    byId('qwGroupModalTitle').textContent=group?'编辑分组':'建立分组';
    byId('qwGroupTitle').value=String(group?.title||'');
    byId('qwGroupColor').value=String(group?.color||'#ede9fe');
    const count=group?.nodeIds?.length||state.selectedNodeIds.size;
    byId('qwGroupSelectionSummary').textContent=(group?'当前分组包含 ':'将把当前选择的 ')+count+' 张卡片放入同一主题容器。卡片可拖入或拖出分组。';
    showStructureModal('qwGroupModal');
    return true;
  }
  function saveGroup(){
    if(!canEdit())return false;
    const title=String(byId('qwGroupTitle')?.value||'').trim()||'未命名分组';
    const color=String(byId('qwGroupColor')?.value||'#ede9fe');
    const editingId=state.editingGroupId;
    const ids=editingId
      ?((state.workspace?.groups||[]).find(item=>String(item.id)===editingId)?.nodeIds||[])
      :[...state.selectedNodeIds];
    const bounds=groupBoundsFromNodeIds(ids);
    const before=workspaceSnapshot();
    state.suppressStoreEvent=true;
    let result=null;
    try{
      result=editingId
        ?store()?.updateGroup?.(editingId,{title,color},workspaceOptions())
        :store()?.createGroup?.({title,color,...bounds},ids,workspaceOptions());
    }finally{state.suppressStoreEvent=false}
    if(!result){notify('分组保存失败，请重试。');return false}
    const after=workspaceSnapshot();
    pushWorkspaceHistory(editingId?'编辑分组':'建立分组',before,after);
    closeStructureModals();
    state.workspace=after;
    renderCards();
    notify(editingId?'已更新分组。':'已建立分组；可拖动分组标题整体移动。');
    return true;
  }
  function removeGroup(groupId){
    if(!canEdit())return false;
    const group=(state.workspace?.groups||[]).find(item=>String(item.id)===String(groupId));
    if(!group)return false;
    if(global.confirm?.('解散“'+group.title+'”？卡片和关系不会被删除。')===false)return false;
    const before=workspaceSnapshot();
    state.suppressStoreEvent=true;
    try{store()?.removeGroup?.(groupId,workspaceOptions())}finally{state.suppressStoreEvent=false}
    const after=workspaceSnapshot();
    pushWorkspaceHistory('解散分组',before,after);
    state.workspace=after;renderCards();notify('已解散分组。');return true;
  }
  function toggleGroup(groupId){
    const group=(state.workspace?.groups||[]).find(item=>String(item.id)===String(groupId));
    if(!group||!canEdit())return false;
    const before=workspaceSnapshot();
    const patch={collapsed:!group.collapsed};
    if(!group.collapsed)Object.assign(patch,{x:Number(group.x),y:Number(group.y),width:Number(group.width),height:Number(group.height)});
    state.suppressStoreEvent=true;
    try{store()?.updateGroup?.(groupId,patch,workspaceOptions())}finally{state.suppressStoreEvent=false}
    const after=workspaceSnapshot();
    pushWorkspaceHistory(patch.collapsed?'折叠分组':'展开分组',before,after);
    state.workspace=after;clearCardSelection();renderCards();return true;
  }
  function selectedPair(){
    const ids=[...state.selectedNodeIds].filter(id=>state.cards.has(String(id)));
    return ids.length===2?ids:null;
  }
  function edgePreviewMarkup(source,target){return '<strong>'+escapeHTML(nodeTitle(source))+'</strong><span> → </span><strong>'+escapeHTML(nodeTitle(target))+'</strong>'}
  function openEdgeModal(edgeId=''){
    if(!canEdit())return false;
    const edge=edgeId?(state.workspace?.edges||[]).find(item=>String(item.id)===String(edgeId)):null;
    const pair=edge?[edge.source,edge.target]:selectedPair();
    if(!pair){notify('请恰好选择 2 张卡片再建立关系。');return false}
    state.editingEdgeId=String(edgeId||'');
    byId('qwEdgeModalTitle').textContent=edge?'编辑卡片关系':'建立卡片关系';
    byId('qwEdgePreview').innerHTML=edgePreviewMarkup(pair[0],pair[1]);
    byId('qwEdgeType').value=String(edge?.type||'same');
    byId('qwEdgeLabel').value=edge?String(edge.label||''):'';
    byId('qwDeleteEdgeBtn').hidden=!edge;
    const modal=byId('qwEdgeModal');
    modal.dataset.source=String(pair[0]);modal.dataset.target=String(pair[1]);
    showStructureModal('qwEdgeModal');
    return true;
  }
  function saveEdge(){
    if(!canEdit())return false;
    const modal=byId('qwEdgeModal');
    const source=String(modal?.dataset.source||''),target=String(modal?.dataset.target||'');
    const type=String(byId('qwEdgeType')?.value||'same');
    const label=String(byId('qwEdgeLabel')?.value||'').trim();
    if(!source||!target)return false;
    const before=workspaceSnapshot();
    state.suppressStoreEvent=true;
    let result=null;
    try{
      result=state.editingEdgeId
        ?store()?.updateEdge?.(state.editingEdgeId,{source,target,type,label},workspaceOptions())
        :store()?.addEdge?.({source,target,type,label},workspaceOptions());
    }finally{state.suppressStoreEvent=false}
    if(!result){notify('关系保存失败，请检查两张卡片是否仍然存在。');return false}
    if(result.created===false&&result.reason==='already-exists'){notify('这两张卡片已经存在相同类型的关系。');return false}
    const after=workspaceSnapshot();
    pushWorkspaceHistory(state.editingEdgeId?'编辑关系':'建立关系',before,after);
    closeStructureModals();state.workspace=after;renderCards();notify('已保存“'+label+'”关系。');return true;
  }
  function deleteEditingEdge(){
    const edgeId=state.editingEdgeId;
    if(!edgeId||!canEdit())return false;
    const before=workspaceSnapshot();
    state.suppressStoreEvent=true;
    try{store()?.removeEdge?.(edgeId,workspaceOptions())}finally{state.suppressStoreEvent=false}
    const after=workspaceSnapshot();
    pushWorkspaceHistory('删除关系',before,after);
    closeStructureModals();state.workspace=after;renderCards();notify('已删除关系。');return true;
  }
  function setActiveGroup(groupId='',options={}){
    const next=String(groupId||'');
    if(state.activeGroupId===next&&!options.force)return next;
    state.activeGroupId=next;
    state.groupElements.forEach((element,id)=>{
      const active=String(id)===next;
      element.classList.toggle('is-active',active);
      element.setAttribute('aria-selected',active?'true':'false');
    });
    const group=(state.workspace?.groups||[]).find(item=>String(item.id)===next)||null;
    const memberIds=new Set((group?.nodeIds||[]).map(String));
    state.cards.forEach((record,id)=>record.element?.classList?.toggle('is-active-group-member',!!next&&memberIds.has(String(id))));
    return next;
  }
  function activeGroup(){
    return (state.workspace?.groups||[]).find(item=>String(item.id)===String(state.activeGroupId||''))||null;
  }
  function activeGroupContainsNode(nodeId){
    const group=activeGroup();
    return !!group&&(group.nodeIds||[]).map(String).includes(String(nodeId||''));
  }
  function renderGroups(){
    if(!state.groupLayer)return 0;
    state.groupElements.clear();
    state.groupLayer.innerHTML='';
    state.cards.forEach(record=>record.element?.classList.remove('is-group-collapsed'));
    const groups=state.workspace?.groups||[];
    groups.forEach((group,index)=>{
      const members=(group.nodeIds||[]).map(id=>state.cards.get(String(id))).filter(Boolean);
      if(!members.length)return;
      if(group.collapsed)members.forEach(record=>record.element?.classList.add('is-group-collapsed'));
      const element=document.createElement('section');
      const active=String(state.activeGroupId||'')===String(group.id);
      element.className='qw-group-container'+(group.collapsed?' is-collapsed':'')+(active?' is-active':'');
      element.dataset.groupId=String(group.id);
      element.setAttribute('aria-selected',active?'true':'false');
      element.style.setProperty('--qw-group-color',String(group.color||'#ede9fe'));
      element.style.left=Number(group.x||0)+'px';
      element.style.top=Number(group.y||0)+'px';
      element.style.width=Math.max(280,Number(group.width||420))+'px';
      element.style.height=(group.collapsed?76:Math.max(120,Number(group.height||260)))+'px';
      element.style.zIndex=String(index+1);
      const toggleIcon=group.collapsed?'<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M7 10l5 5 5-5"/></svg>':'<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M7 14l5-5 5 5"/></svg>';
      element.innerHTML='<header class="qw-group-header"><div class="qw-group-title"><strong data-qw-group-title title="双击编辑分组名称">'+escapeHTML(group.title)+'</strong><span>'+members.length+' 卡</span></div><div class="qw-group-actions">'
        +'<button type="button" data-qw-group-action="toggle" title="'+(group.collapsed?'展开分组':'折叠分组')+'" aria-label="'+(group.collapsed?'展开分组':'折叠分组')+'">'+toggleIcon+'</button>'
        +'<button type="button" data-qw-group-action="fit" title="适配成员范围" aria-label="适配成员范围"><svg viewBox="0 0 24 24" aria-hidden="true"><path d="M8 3H3v5M16 3h5v5M8 21H3v-5M16 21h5v-5"/></svg></button>'
        +'<button type="button" data-qw-group-action="edit" title="完整编辑分组" aria-label="完整编辑分组"><svg viewBox="0 0 24 24" aria-hidden="true"><path d="M4 20h4l11-11-4-4L4 16v4zM13.5 6.5l4 4"/></svg></button>'
        +'<button type="button" data-qw-group-action="remove" title="解散分组" aria-label="解散分组"><svg viewBox="0 0 24 24" aria-hidden="true"><path d="M9 8H6a4 4 0 0 0 0 8h3M15 8h3a4 4 0 0 1 0 8h-3M8 12h8M5 5l14 14"/></svg></button></div></header>';
      state.groupLayer.appendChild(element);
      state.groupElements.set(String(group.id),element);
    });
    setActiveGroup(state.activeGroupId,{force:true});
    return state.groupElements.size;
  }
  function edgeGeometry(source,target,edge={}){
    const sc={x:Number(source.x)+Number(source.width)/2,y:Number(source.y)+Number(source.height)/2};
    const tc={x:Number(target.x)+Number(target.width)/2,y:Number(target.y)+Number(target.height)/2};
    const horizontal=Math.abs(tc.x-sc.x)>=Math.abs(tc.y-sc.y);
    let sx=sc.x,sy=sc.y,tx=tc.x,ty=tc.y;
    if(horizontal){sx=tc.x>=sc.x?Number(source.x)+Number(source.width):Number(source.x);tx=tc.x>=sc.x?Number(target.x):Number(target.x)+Number(target.width)}
    else{sy=tc.y>=sc.y?Number(source.y)+Number(source.height):Number(source.y);ty=tc.y>=sc.y?Number(target.y):Number(target.y)+Number(target.height)}
    const pathStyle=['straight','elbow','curve'].includes(String(edge.pathStyle||''))?String(edge.pathStyle):'curve';
    let path='';
    let mid={x:(sx+tx)/2,y:(sy+ty)/2};
    if(pathStyle==='straight')path='M '+sx+' '+sy+' L '+tx+' '+ty;
    else if(pathStyle==='elbow'){
      if(horizontal){const mx=(sx+tx)/2;path='M '+sx+' '+sy+' L '+mx+' '+sy+' L '+mx+' '+ty+' L '+tx+' '+ty;mid={x:mx,y:(sy+ty)/2}}
      else{const my=(sy+ty)/2;path='M '+sx+' '+sy+' L '+sx+' '+my+' L '+tx+' '+my+' L '+tx+' '+ty;mid={x:(sx+tx)/2,y:my}}
    }else{
      const bend=Math.max(70,Math.min(260,(Math.abs(tx-sx)+Math.abs(ty-sy))*.38));
      const c1=horizontal?{x:sx+(tx>=sx?bend:-bend),y:sy}:{x:sx,y:sy+(ty>=sy?bend:-bend)};
      const c2=horizontal?{x:tx-(tx>=sx?bend:-bend),y:ty}:{x:tx,y:ty-(ty>=sy?bend:-bend)};
      path='M '+sx+' '+sy+' C '+c1.x+' '+c1.y+' '+c2.x+' '+c2.y+' '+tx+' '+ty;
      mid={x:(sx+3*c1.x+3*c2.x+tx)/8,y:(sy+3*c1.y+3*c2.y+ty)/8};
    }
    return {path,mid};
  }
  function edgeColor(edge={}){
    if(/^#[0-9a-f]{6}$/i.test(String(edge.color||'')))return String(edge.color);
    return ({contrast:'#db2777',cause:'#2563eb',exception:'#dc2626',confused:'#d97706',support:'#059669'}[String(edge.type||'')]||'#7c8799');
  }
  function edgeById(edgeId){return (state.workspace?.edges||[]).find(edge=>String(edge.id)===String(edgeId||''))||null}
  function liveCardLayout(record){
    const node=record?.node||record?.layout||{};
    const element=record?.element||null;
    const style=element?.style||{};
    const read=(value,fallback)=>Number.isFinite(Number.parseFloat(value))?Number.parseFloat(value):Number(fallback||0);
    const actualWidth=Number(element?.offsetWidth||0),actualHeight=Number(element?.offsetHeight||0);
    return {
      ...node,
      x:read(style.left,node.x),
      y:read(style.top,node.y),
      width:actualWidth||read(style.width,node.width),
      height:actualHeight||read(style.height,node.height)
    };
  }
  function edgeRecordGeometry(edge){
    const source=state.cards.get(String(edge.source)),target=state.cards.get(String(edge.target));
    if(!source||!target||source.element?.classList.contains('is-group-collapsed')||target.element?.classList.contains('is-group-collapsed'))return null;
    return edgeGeometry(liveCardLayout(source),liveCardLayout(target),edge);
  }
  function updateEdgeDom(edge,dom){
    const geometry=edgeRecordGeometry(edge);
    if(!geometry||!dom)return false;
    dom.group.hidden=false;
    dom.visible.setAttribute('d',geometry.path);
    dom.hit.setAttribute('d',geometry.path);
    dom.group.style.setProperty('--qw-edge-color',edgeColor(edge));
    dom.group.dataset.lineStyle=String(edge.lineStyle||'solid');
    dom.group.dataset.pathStyle=String(edge.pathStyle||'curve');
    dom.group.classList.toggle('is-active',String(state.activeEdgeId||'')===String(edge.id));
    const label=String(edge.label??'').trim();
    if(dom.labelGroup){
      dom.labelGroup.hidden=!label;
      if(label){
        const width=Math.max(44,Math.min(200,label.length*14+22));
        dom.labelGroup.setAttribute('transform','translate('+geometry.mid.x+' '+geometry.mid.y+')');
        dom.labelBg.setAttribute('x',String(-width/2));
        dom.labelBg.setAttribute('width',String(width));
        dom.label.textContent=label;
      }
    }
    dom.mid=geometry.mid;
    return true;
  }
  function rebuildEdgeAdjacency(){
    state.edgeAdjacency.clear();
    (state.workspace?.edges||[]).forEach(edge=>{
      [String(edge.source),String(edge.target)].forEach(nodeId=>{
        if(!state.edgeAdjacency.has(nodeId))state.edgeAdjacency.set(nodeId,new Set());
        state.edgeAdjacency.get(nodeId).add(String(edge.id));
      });
    });
    return state.edgeAdjacency;
  }
  function updateEdgesForNodeIds(nodeIds=[]){
    const edgeIds=new Set();
    (nodeIds||[]).forEach(nodeId=>state.edgeAdjacency.get(String(nodeId))?.forEach(edgeId=>edgeIds.add(edgeId)));
    let count=0;
    edgeIds.forEach(edgeId=>{const edge=edgeById(edgeId),dom=state.edgeElements.get(edgeId);if(edge&&dom&&updateEdgeDom(edge,dom))count++});
    return count;
  }
  function updateEdgesGeometry(){
    let count=0;
    (state.workspace?.edges||[]).forEach(edge=>{const dom=state.edgeElements.get(String(edge.id));if(dom&&updateEdgeDom(edge,dom))count++});
    updateEdgeQuickMenuPosition();
    updateEdgeInlineEditorPosition();
    return count;
  }
  function renderEdges(){
    if(!state.edgeRoot)return 0;
    rebuildEdgeAdjacency();
    state.edgeRoot.innerHTML='';
    state.edgeElements.clear();
    (state.workspace?.edges||[]).forEach(edge=>{
      const geometry=edgeRecordGeometry(edge);if(!geometry)return;
      const group=document.createElementNS('http://www.w3.org/2000/svg','g');
      group.setAttribute('class','qw-edge-group');group.dataset.edgeId=String(edge.id);
      const visible=document.createElementNS('http://www.w3.org/2000/svg','path');visible.setAttribute('class','qw-edge-path');visible.dataset.edgeType=String(edge.type||'same');
      const hit=document.createElementNS('http://www.w3.org/2000/svg','path');hit.setAttribute('class','qw-edge-hit');hit.dataset.edgeId=String(edge.id);
      const labelGroup=document.createElementNS('http://www.w3.org/2000/svg','g');labelGroup.setAttribute('class','qw-edge-label-group');labelGroup.setAttribute('aria-hidden','true');
      const labelBg=document.createElementNS('http://www.w3.org/2000/svg','rect');labelBg.setAttribute('class','qw-edge-label-bg');labelBg.setAttribute('y','-13');labelBg.setAttribute('height','26');labelBg.setAttribute('rx','10');
      const label=document.createElementNS('http://www.w3.org/2000/svg','text');label.setAttribute('class','qw-edge-label');label.setAttribute('x','0');label.setAttribute('y','0');label.setAttribute('dy','.35em');
      labelGroup.append(labelBg,label);group.append(visible,hit,labelGroup);state.edgeRoot.appendChild(group);
      const dom={group,visible,hit,labelGroup,labelBg,label,mid:geometry.mid};state.edgeElements.set(String(edge.id),dom);updateEdgeDom(edge,dom);
    });
    if(state.activeEdgeId&&!edgeById(state.activeEdgeId))hideEdgeQuickMenu();
    return state.edgeElements.size;
  }
  function edgeScreenPoint(edgeId,anchorWorld=null){
    const dom=state.edgeElements.get(String(edgeId||''));
    const point=anchorWorld||dom?.mid;if(!point)return null;
    return {x:Number(point.x)*state.zoom+state.panX,y:Number(point.y)*state.zoom+state.panY};
  }
  function ensureEdgeQuickMenu(){
    if(state.edgeQuickMenu?.isConnected)return state.edgeQuickMenu;
    const menu=document.createElement('div');
    menu.className='qw-edge-quick-menu';menu.hidden=true;menu.setAttribute('role','toolbar');menu.setAttribute('aria-label','关系线快捷操作');
    menu.innerHTML='<button type="button" data-qw-edge-line="dashed" title="长虚线" aria-label="长虚线"><svg viewBox="0 0 24 24"><path d="M3 12h7m4 0h7"/></svg></button><button type="button" data-qw-edge-line="solid" title="实线" aria-label="实线"><svg viewBox="0 0 24 24"><path d="M3 12h18"/></svg></button><button type="button" data-qw-edge-line="dotted" title="短虚线" aria-label="短虚线"><svg viewBox="0 0 24 24"><path d="M4 12h1m4 0h1m4 0h1m4 0h1"/></svg></button><button type="button" data-qw-edge-action="label" title="编辑文字" aria-label="编辑文字"><strong>T</strong></button><label title="颜色" aria-label="颜色"><input type="color" data-qw-edge-color><span></span></label><button type="button" data-qw-edge-path="straight" title="直线" aria-label="直线"><svg viewBox="0 0 24 24"><path d="m4 18 16-12"/></svg></button><button type="button" data-qw-edge-path="elbow" title="折线" aria-label="折线"><svg viewBox="0 0 24 24"><path d="M4 7h8v10h8"/></svg></button><button type="button" data-qw-edge-path="curve" title="曲线" aria-label="曲线"><svg viewBox="0 0 24 24"><path d="M4 17C8 5 16 19 20 7"/></svg></button><button type="button" class="danger" data-qw-edge-action="delete" title="删除关系" aria-label="删除关系"><svg viewBox="0 0 24 24"><path d="M5 7h14M9 7V4h6v3m-8 0 1 13h8l1-13"/></svg></button>';
    menu.addEventListener('pointerdown',event=>event.stopPropagation());
    menu.addEventListener('click',event=>{
      if(event.target.closest?.('[data-qw-edge-color]')){event.stopPropagation();return}
      event.preventDefault();event.stopPropagation();
      const edge=edgeById(state.activeEdgeId);if(!edge)return;
      const line=event.target.closest?.('[data-qw-edge-line]')?.dataset.qwEdgeLine;
      const path=event.target.closest?.('[data-qw-edge-path]')?.dataset.qwEdgePath;
      const action=event.target.closest?.('[data-qw-edge-action]')?.dataset.qwEdgeAction;
      if(line)return updateEdgeStyle(edge.id,{lineStyle:line},'修改关系线型');
      if(path)return updateEdgeStyle(edge.id,{pathStyle:path},'修改关系路径');
      if(action==='label'){openEdgeInlineEditor(edge.id);hideEdgeQuickMenu(false);return}
      if(action==='delete'){deleteEdgeById(edge.id);return}
    });
    const color=menu.querySelector('[data-qw-edge-color]');
    color?.addEventListener('input',event=>{
      event.stopPropagation();
      const edgeId=String(event.target.dataset.edgeId||state.activeEdgeId||'');
      const edge=edgeById(edgeId),dom=state.edgeElements.get(edgeId);
      if(edge&&dom){dom.group.style.setProperty('--qw-edge-color',String(event.target.value||edgeColor(edge)));menu.style.setProperty('--qw-edge-color',String(event.target.value||edgeColor(edge)))}
    });
    color?.addEventListener('change',event=>{event.stopPropagation();const edgeId=String(event.target.dataset.edgeId||state.activeEdgeId||'');if(edgeId)updateEdgeStyle(edgeId,{color:String(event.target.value||'')},'修改关系颜色')});
    byId('qwCanvasShell')?.appendChild(menu);state.edgeQuickMenu=menu;return menu;
  }
  function updateEdgeQuickMenuPosition(){
    const menu=state.edgeQuickMenu;if(!menu||menu.hidden||!state.activeEdgeId)return false;
    const point=edgeScreenPoint(state.activeEdgeId,state.edgeMenuAnchorWorld);if(!point){hideEdgeQuickMenu();return false}
    const shell=byId('qwCanvasShell');const width=Number(menu.offsetWidth||390),height=Number(menu.offsetHeight||46);
    menu.style.left=clamp(point.x-width/2,10,Math.max(10,Number(shell?.clientWidth||state.viewport?.clientWidth||1200)-width-10))+'px';
    menu.style.top=clamp(point.y-height-16,10,Math.max(10,Number(shell?.clientHeight||state.viewport?.clientHeight||800)-height-10))+'px';
    return true;
  }
  function showEdgeQuickMenu(edgeId,event=null){
    if(!canEdit())return false;
    const edge=edgeById(edgeId);if(!edge)return false;
    const previousEdgeId=String(state.activeEdgeId||'');
    state.activeEdgeId=String(edge.id);
    const worldRect=state.viewport?.getBoundingClientRect?.();
    if(event&&worldRect)state.edgeMenuAnchorWorld={x:(event.clientX-worldRect.left-state.panX)/state.zoom,y:(event.clientY-worldRect.top-state.panY)/state.zoom};
    else if(previousEdgeId!==String(edge.id))state.edgeMenuAnchorWorld=null;
    state.edgeElements.forEach((dom,id)=>dom.group.classList.toggle('is-active',id===state.activeEdgeId));
    const menu=ensureEdgeQuickMenu();menu.hidden=false;
    menu.querySelectorAll('[data-qw-edge-line]').forEach(button=>button.classList.toggle('active',button.dataset.qwEdgeLine===String(edge.lineStyle||'solid')));
    menu.querySelectorAll('[data-qw-edge-path]').forEach(button=>button.classList.toggle('active',button.dataset.qwEdgePath===String(edge.pathStyle||'curve')));
    const color=menu.querySelector('[data-qw-edge-color]');if(color){color.value=edgeColor(edge);color.dataset.edgeId=String(edge.id)}menu.style.setProperty('--qw-edge-color',edgeColor(edge));
    updateEdgeQuickMenuPosition();return true;
  }
  function hideEdgeQuickMenu(clear=true){
    if(state.edgeQuickMenu)state.edgeQuickMenu.hidden=true;
    if(clear){state.activeEdgeId='';state.edgeMenuAnchorWorld=null;state.edgeElements.forEach(dom=>dom.group.classList.remove('is-active'))}
  }
  function ensureEdgeInlineEditor(){
    if(state.edgeInlineEditor?.isConnected)return state.edgeInlineEditor;
    const editor=document.createElement('div');editor.className='qw-edge-inline-editor';editor.hidden=true;editor.innerHTML='<input type="text" maxlength="60" placeholder="输入关系文字；留空则不显示" autocomplete="off">';
    editor.addEventListener('pointerdown',event=>event.stopPropagation());
    const input=editor.querySelector('input');
    input.addEventListener('keydown',event=>{if(event.key==='Enter'){event.preventDefault();commitEdgeInlineEditor()}else if(event.key==='Escape'){event.preventDefault();hideEdgeInlineEditor()}});
    input.addEventListener('blur',()=>{if(!editor.hidden)commitEdgeInlineEditor()});
    byId('qwCanvasShell')?.appendChild(editor);state.edgeInlineEditor=editor;return editor;
  }
  function updateEdgeInlineEditorPosition(){
    const editor=state.edgeInlineEditor;if(!editor||editor.hidden||!state.activeEdgeId)return false;
    const point=edgeScreenPoint(state.activeEdgeId,state.edgeMenuAnchorWorld);if(!point)return false;
    const shell=byId('qwCanvasShell');const width=Number(editor.offsetWidth||240),height=Number(editor.offsetHeight||44);
    editor.style.left=clamp(point.x+14,10,Math.max(10,Number(shell?.clientWidth||1200)-width-10))+'px';
    editor.style.top=clamp(point.y-height-12,10,Math.max(10,Number(shell?.clientHeight||800)-height-10))+'px';return true;
  }
  function openEdgeInlineEditor(edgeId){
    const edge=edgeById(edgeId);if(!edge)return false;
    state.activeEdgeId=String(edge.id);const editor=ensureEdgeInlineEditor(),input=editor.querySelector('input');input.value=String(edge.label||'');editor.hidden=false;updateEdgeInlineEditorPosition();setTimeout(()=>{input.focus();input.select()},20);return true;
  }
  function hideEdgeInlineEditor(){if(state.edgeInlineEditor)state.edgeInlineEditor.hidden=true}
  function commitEdgeInlineEditor(){
    const editor=state.edgeInlineEditor,edge=edgeById(state.activeEdgeId);if(!editor||!edge)return false;
    const label=String(editor.querySelector('input')?.value||'').trim();hideEdgeInlineEditor();return updateEdgeStyle(edge.id,{label},label?'添加关系文字':'清除关系文字');
  }
  function updateEdgeStyle(edgeId,patch,label){
    if(!canEdit())return false;
    const before=workspaceSnapshot();state.suppressStoreEvent=true;let result=null;
    try{result=store()?.updateEdge?.(edgeId,patch,workspaceOptions())}finally{state.suppressStoreEvent=false}
    if(!result?.edge)return false;state.workspace=result.workspace||store()?.ensure?.(workspaceOptions())||state.workspace;
    const after=workspaceSnapshot();pushWorkspaceHistory(label||'修改关系',before,after);renderEdges();showEdgeQuickMenu(edgeId);notify((label||'关系已更新')+'。');return true;
  }
  function deleteEdgeById(edgeId){
    if(!canEdit())return false;
    let approved=true;try{approved=global.confirm?.('删除这条关系线？')!==false}catch(e){}if(!approved)return false;
    const before=workspaceSnapshot();state.suppressStoreEvent=true;try{store()?.removeEdge?.(edgeId,workspaceOptions())}finally{state.suppressStoreEvent=false}
    state.workspace=store()?.ensure?.(workspaceOptions())||state.workspace;const after=workspaceSnapshot();pushWorkspaceHistory('删除关系',before,after);hideEdgeQuickMenu();hideEdgeInlineEditor();renderEdges();notify('已删除关系。');return true;
  }
  function renderStructure(){renderGroups();renderEdges()}
  function recordRect(record){return {x:Number(record.node.x||0),y:Number(record.node.y||0),width:Number(record.node.width||0),height:Number(record.node.height||0)}}
  function runLayoutDiagnosis(options={}){
    if(state.diagnosisTimer){clearTimeout(state.diagnosisTimer);state.diagnosisTimer=null}
    const visible=[...state.cards.values()].filter(record=>!record.element?.classList.contains('is-group-collapsed'));
    visible.forEach(record=>record.element?.classList.remove('has-overlap','has-layout-warning'));
    const overlaps=[];
    const buckets=new Map(),cell=620,pairs=new Set();
    visible.forEach(record=>{
      const rect=recordRect(record);
      const x0=Math.floor(rect.x/cell),x1=Math.floor((rect.x+rect.width)/cell),y0=Math.floor(rect.y/cell),y1=Math.floor((rect.y+rect.height)/cell);
      for(let x=x0;x<=x1;x++)for(let y=y0;y<=y1;y++){
        const key=x+':'+y;if(!buckets.has(key))buckets.set(key,[]);buckets.get(key).push(record);
      }
    });
    buckets.forEach(records=>{
      for(let i=0;i<records.length;i++)for(let j=i+1;j<records.length;j++){
        const a=records[i],b=records[j],key=[String(a.id),String(b.id)].sort().join('|');
        if(pairs.has(key))continue;pairs.add(key);
        const ar=recordRect(a),br=recordRect(b);
        const width=Math.min(ar.x+ar.width,br.x+br.width)-Math.max(ar.x,br.x);
        const height=Math.min(ar.y+ar.height,br.y+br.height)-Math.max(ar.y,br.y);
        if(width>8&&height>8){overlaps.push({a:String(a.id),b:String(b.id),width,height});a.element?.classList.add('has-overlap');b.element?.classList.add('has-overlap')}
      }
    });
    const outOfBounds=[],oversized=[];
    visible.forEach(record=>{
      const rect=recordRect(record);
      if(rect.x<0||rect.y<0||rect.x+rect.width>WORLD_WIDTH||rect.y+rect.height>WORLD_HEIGHT){outOfBounds.push({nodeId:String(record.id),rect});record.element?.classList.add('has-layout-warning')}
      if(rect.width>1200||rect.height>4200){oversized.push({nodeId:String(record.id),rect});record.element?.classList.add('has-layout-warning')}
    });
    const groupOverflow=[];
    (state.workspace?.groups||[]).filter(group=>!group.collapsed).forEach(group=>{
      const bounds={x:Number(group.x),y:Number(group.y),width:Number(group.width),height:Number(group.height)};
      (group.nodeIds||[]).forEach(nodeId=>{
        const record=state.cards.get(String(nodeId));if(!record)return;const rect=recordRect(record);
        if(rect.x<bounds.x+8||rect.y<bounds.y+8||rect.x+rect.width>bounds.x+bounds.width-8||rect.y+rect.height>bounds.y+bounds.height-8)groupOverflow.push({groupId:String(group.id),nodeId:String(nodeId)});
      });
    });
    state.layoutIssues={overlaps,outOfBounds,oversized,groupOverflow,total:overlaps.length+outOfBounds.length+oversized.length+groupOverflow.length};
    const badge=byId('qwIssueBadge');
    if(badge){badge.hidden=!state.layoutIssues.total;badge.textContent=String(state.layoutIssues.total)}
    if(!byId('qwDiagnosticsPanel')?.hidden||options.open)renderDiagnosticsPanel();
    renderMinimap();
    return state.layoutIssues;
  }
  function scheduleLayoutDiagnosis(delay=120){
    if(state.diagnosisTimer)clearTimeout(state.diagnosisTimer);
    state.diagnosisTimer=setTimeout(()=>runLayoutDiagnosis(),Math.max(0,delay));
  }
  function diagnosticItem(title,detail,nodeId=''){
    return '<div class="qw-diagnostic-item"><div><strong>'+escapeHTML(title)+'</strong><span>'+escapeHTML(detail)+'</span></div>'+(nodeId?'<button type="button" data-qw-diagnostic-focus="'+escapeHTML(nodeId)+'">定位</button>':'')+'</div>';
  }
  function renderDiagnosticsPanel(){
    const issues=state.layoutIssues||runLayoutDiagnosis();
    const summary=byId('qwDiagnosticsSummary'),list=byId('qwDiagnosticsList');
    if(summary)summary.textContent=issues.total?'发现 '+issues.total+' 项布局问题：'+issues.overlaps.length+' 处重叠、'+issues.outOfBounds.length+' 张越界、'+issues.oversized.length+' 张异常大卡、'+issues.groupOverflow.length+' 项分组溢出。':'当前未发现重叠、越界或异常尺寸。';
    if(!list)return;
    const items=[];
    issues.overlaps.forEach(item=>items.push(diagnosticItem('卡片重叠',nodeTitle(item.a)+' 与 '+nodeTitle(item.b),item.a)));
    issues.outOfBounds.forEach(item=>items.push(diagnosticItem('卡片超出画布',nodeTitle(item.nodeId),item.nodeId)));
    issues.oversized.forEach(item=>items.push(diagnosticItem('卡片尺寸异常',nodeTitle(item.nodeId)+' · '+Math.round(item.rect.width)+'×'+Math.round(item.rect.height),item.nodeId)));
    issues.groupOverflow.forEach(item=>{
      const group=(state.workspace?.groups||[]).find(group=>String(group.id)===item.groupId);
      items.push(diagnosticItem('卡片超出分组',nodeTitle(item.nodeId)+' 超出“'+String(group?.title||'分组')+'”',item.nodeId));
    });
    list.innerHTML=items.join('')||'<div class="qw-diagnostics-empty">布局状态良好</div>';
    const overlapBtn=byId('qwResolveOverlapBtn'),boundsBtn=byId('qwRepairBoundsBtn'),groupsBtn=byId('qwRepairGroupsBtn');
    if(overlapBtn)overlapBtn.disabled=!issues.overlaps.length;
    if(boundsBtn)boundsBtn.disabled=!issues.outOfBounds.length;
    if(groupsBtn)groupsBtn.disabled=!issues.groupOverflow.length;
  }
  function openDiagnosticsPanel(){
    const panel=byId('qwDiagnosticsPanel');if(!panel)return;
    panel.hidden=false;runLayoutDiagnosis({open:true});
  }
  function closeDiagnosticsPanel(){const panel=byId('qwDiagnosticsPanel');if(panel)panel.hidden=true}
  function workspaceUnits(workspace){
    const nodes=workspace.nodes||{},claimed=new Set(),units=[];
    (workspace.groups||[]).forEach(group=>{
      const ids=(group.nodeIds||[]).filter(id=>nodes[id]);if(!ids.length)return;ids.forEach(id=>claimed.add(String(id)));
      units.push({id:'group:'+group.id,group,nodeIds:ids,x:Number(group.x),y:Number(group.y),width:Number(group.width),height:group.collapsed?76:Number(group.height)});
    });
    Object.values(nodes).forEach(node=>{if(!claimed.has(String(node.id)))units.push({id:'node:'+node.id,nodeIds:[node.id],x:Number(node.x),y:Number(node.y),width:Number(node.width),height:Number(node.height)})});
    return units;
  }
  function moveWorkspaceUnit(workspace,unit,x,y){
    const dx=Number(x)-Number(unit.x),dy=Number(y)-Number(unit.y);
    unit.nodeIds.forEach(id=>{if(workspace.nodes[id]){workspace.nodes[id].x=Number(workspace.nodes[id].x)+dx;workspace.nodes[id].y=Number(workspace.nodes[id].y)+dy;workspace.nodes[id].updatedAt=Date.now()}});
    if(unit.group){unit.group.x=Number(unit.group.x)+dx;unit.group.y=Number(unit.group.y)+dy;unit.group.updatedAt=Date.now()}
    unit.x=Number(x);unit.y=Number(y);
  }
  function repairGroupBounds(){
    if(!canEdit())return false;
    const before=workspaceSnapshot(),workspace=clone(before);
    (workspace.groups||[]).forEach(group=>{
      const nodes=(group.nodeIds||[]).map(id=>workspace.nodes?.[String(id)]).filter(Boolean);
      if(!nodes.length)return;
      const left=Math.min(...nodes.map(node=>Number(node.x))),top=Math.min(...nodes.map(node=>Number(node.y)));
      const right=Math.max(...nodes.map(node=>Number(node.x)+Number(node.width))),bottom=Math.max(...nodes.map(node=>Number(node.y)+Number(node.height)));
      group.x=left-42;group.y=top-58;group.width=right-left+84;group.height=bottom-top+100;group.updatedAt=Date.now();
    });
    state.suppressStoreEvent=true;try{state.workspace=store()?.write?.(workspace,{reason:'group-bounds-repaired'})||workspace}finally{state.suppressStoreEvent=false}
    const after=workspaceSnapshot();pushWorkspaceHistory('适配分组边界',before,after);renderCards();notify('已让分组边界适配成员卡片。');return true;
  }
  function resolveOverlaps(){
    if(!canEdit())return false;
    const before=workspaceSnapshot(),workspace=clone(before);
    const rectOf=node=>({x:Number(node.x),y:Number(node.y),width:Number(node.width),height:Number(node.height)});
    const intersects=(a,b,gap=24)=>a.x+a.width+gap>b.x&&b.x+b.width+gap>a.x&&a.y+a.height+gap>b.y&&b.y+b.height+gap>a.y;
    (workspace.groups||[]).filter(group=>!group.collapsed).forEach(group=>{
      const nodes=(group.nodeIds||[]).map(id=>workspace.nodes?.[String(id)]).filter(Boolean).sort((a,b)=>Number(a.y)-Number(b.y)||Number(a.x)-Number(b.x));
      let hasInternal=false;
      for(let i=0;i<nodes.length;i++)for(let j=i+1;j<nodes.length;j++)if(intersects(rectOf(nodes[i]),rectOf(nodes[j]),0))hasInternal=true;
      if(!hasInternal)return;
      const contentWidth=Math.max(520,Number(group.width)-84),columns=contentWidth>1100?2:1;
      const columnWidth=Math.max(...nodes.map(node=>Number(node.width)),420)+42;
      const columnY=Array(columns).fill(Number(group.y)+58);
      nodes.forEach((node,index)=>{
        const column=columns===1?0:index%columns;
        node.x=Number(group.x)+42+column*columnWidth;
        node.y=columnY[column];
        columnY[column]+=Number(node.height)+38;
        node.updatedAt=Date.now();
      });
      const right=Math.max(...nodes.map(node=>Number(node.x)+Number(node.width))),bottom=Math.max(...nodes.map(node=>Number(node.y)+Number(node.height)));
      group.width=Math.max(Number(group.width),right-Number(group.x)+42);
      group.height=Math.max(Number(group.height),bottom-Number(group.y)+42);
      group.updatedAt=Date.now();
    });
    const units=workspaceUnits(workspace).sort((a,b)=>a.y-b.y||a.x-b.x),placed=[];
    units.forEach(unit=>{
      let nextX=Math.max(60,unit.x),nextY=Math.max(60,unit.y),tries=0;
      while(tries++<100){
        const conflict=placed.filter(other=>nextX<other.x+other.width+32&&nextX+unit.width+32>other.x&&nextY<other.y+other.height+32&&nextY+unit.height+32>other.y);
        if(!conflict.length)break;
        nextY=Math.max(...conflict.map(other=>other.y+other.height+42));
        if(nextY+unit.height>WORLD_HEIGHT-80){nextX=Math.min(WORLD_WIDTH-unit.width-80,nextX+620);nextY=80}
      }
      moveWorkspaceUnit(workspace,unit,nextX,nextY);placed.push({...unit,x:nextX,y:nextY});
    });
    if(JSON.stringify(before)===JSON.stringify(workspace)){notify('当前没有需要整理的重叠卡片。');return true}
    state.suppressStoreEvent=true;try{state.workspace=store()?.write?.(workspace,{reason:'overlap-resolved'})||workspace}finally{state.suppressStoreEvent=false}
    const after=workspaceSnapshot();pushWorkspaceHistory('一键解决重叠',before,after);renderCards();notify('已解决可识别的卡片重叠。可按 Ctrl/Command+Z 撤销。');return true;
  }
  function repairOutOfBounds(){
    if(!canEdit())return false;
    const before=workspaceSnapshot(),workspace=clone(before),units=workspaceUnits(workspace);
    units.forEach(unit=>{
      const x=clamp(unit.x,60,Math.max(60,WORLD_WIDTH-unit.width-60));
      const y=clamp(unit.y,60,Math.max(60,WORLD_HEIGHT-unit.height-60));
      moveWorkspaceUnit(workspace,unit,x,y);
    });
    state.suppressStoreEvent=true;try{state.workspace=store()?.write?.(workspace,{reason:'bounds-repaired'})||workspace}finally{state.suppressStoreEvent=false}
    const after=workspaceSnapshot();pushWorkspaceHistory('修复画布越界',before,after);renderCards();notify('已将越界卡片移回画布范围。');return true;
  }
  function unitCategory(unit,workspace,mode){
    const nodes=unit.nodeIds.map(id=>workspace.nodes[id]).filter(Boolean),node=nodes[0]||{};
    if(mode==='type')return unit.group?'分组':(node.nodeType==='synthesis-card'?(SYNTHESIS_META[node.synthesisType]?.label||'归纳卡'):'题目卡');
    if(mode==='status')return node.nodeType==='synthesis-card'?(SYNTHESIS_STATUS[node.status]||'待验证'):(node.status==='completed'?'已完成':node.status==='in-progress'?'学习中':'未开始');
    if(mode==='topic')return String(node.topic||node.tags?.[0]||'未分类');
    return '全部';
  }
  function smartArrange(mode){
    if(!canEdit())return false;
    mode=String(mode||'grid');
    const before=workspaceSnapshot(),workspace=clone(before),units=workspaceUnits(workspace);
    if(!units.length){notify('当前画布没有可整理的卡片。');return false}
    const startX=100,startY=80,gapX=64,gapY=70,maxRight=WORLD_WIDTH-100;
    if(mode==='grid'){
      let cursorX=startX,cursorY=startY,rowHeight=0;
      units.sort((a,b)=>a.y-b.y||a.x-b.x).forEach(unit=>{
        if(cursorX>startX&&cursorX+unit.width>maxRight){cursorX=startX;cursorY+=rowHeight+gapY;rowHeight=0}
        moveWorkspaceUnit(workspace,unit,cursorX,cursorY);
        cursorX+=unit.width+gapX;
        rowHeight=Math.max(rowHeight,unit.height);
      });
    }else{
      const buckets=new Map();
      units.forEach(unit=>{const key=unitCategory(unit,workspace,mode);if(!buckets.has(key))buckets.set(key,[]);buckets.get(key).push(unit)});
      let laneX=startX,bandY=startY,bandHeight=0;
      [...buckets.entries()].sort((a,b)=>a[0].localeCompare(b[0],'zh-CN')).forEach(([,items])=>{
        items.sort((a,b)=>a.y-b.y||a.x-b.x);
        const laneWidth=Math.max(...items.map(item=>item.width),MULTI_CARD_MIN_WIDTH);
        const laneHeight=items.reduce((sum,item,index)=>sum+item.height+(index?48:0),0);
        if(laneX>startX&&laneX+laneWidth>maxRight){laneX=startX;bandY+=bandHeight+110;bandHeight=0}
        let itemY=bandY;
        items.forEach(item=>{moveWorkspaceUnit(workspace,item,laneX,itemY);itemY+=item.height+48});
        laneX+=laneWidth+82;
        bandHeight=Math.max(bandHeight,laneHeight);
      });
    }
    state.suppressStoreEvent=true;try{state.workspace=store()?.write?.(workspace,{reason:'smart-arrange-'+mode})||workspace}finally{state.suppressStoreEvent=false}
    const after=workspaceSnapshot();pushWorkspaceHistory('智能整理',before,after);renderCards();fitAll();
    const issues=runLayoutDiagnosis();
    notify(issues.overlaps.length?'智能整理已完成，但仍有 '+issues.overlaps.length+' 处历史异常重叠，请打开布局检查。':'已完成智能整理。可按 Ctrl/Command+Z 撤销。');
    return true;
  }
  function syncDraggedMembership(nodeIds=[]){
    if(!nodeIds.length||state.readonly)return false;
    const before=workspaceSnapshot(),workspace=clone(before),groups=workspace.groups||[];
    let changed=false;
    nodeIds.map(String).forEach(nodeId=>{
      const node=workspace.nodes?.[nodeId];if(!node)return;
      const center={x:Number(node.x)+Number(node.width)/2,y:Number(node.y)+Number(node.height)/2};
      const target=groups.find(group=>!group.collapsed&&center.x>=Number(group.x)&&center.x<=Number(group.x)+Number(group.width)&&center.y>=Number(group.y)&&center.y<=Number(group.y)+Number(group.height));
      groups.forEach(group=>{
        const has=(group.nodeIds||[]).includes(nodeId),should=target&&String(group.id)===String(target.id);
        if(has&&!should){group.nodeIds=group.nodeIds.filter(id=>String(id)!==nodeId);changed=true}
        if(!has&&should){group.nodeIds.push(nodeId);changed=true}
      });
    });
    workspace.groups=groups.filter(group=>(group.nodeIds||[]).length);
    if(!changed)return false;
    state.suppressStoreEvent=true;try{state.workspace=store()?.write?.(workspace,{reason:'group-membership-updated'})||workspace}finally{state.suppressStoreEvent=false}
    const after=workspaceSnapshot();pushWorkspaceHistory('调整分组成员',before,after);renderCards();notify('已根据卡片落点更新分组成员。');return true;
  }
  function renderCards(){
    state.workspace=store()?.ensure?.(workspaceOptions())||state.workspace||{nodes:{},edges:[],groups:[]};
    const nodes=Object.values(state.workspace.nodes||{}).sort((a,b)=>Number(a.createdAt)-Number(b.createdAt));
    state.kernel.cards.clear();
    state.nodeLayer.innerHTML='';
    nodes.forEach((node,index)=>{
      const element=document.createElement('article');
      const synthesis=node.nodeType==='synthesis-card';
      element.className='qw-question-card'+(synthesis?' qw-synthesis-card qw-synthesis-'+String(node.synthesisType||'principle'):'');
      element.dataset.nodeId=node.id;
      element.dataset.nodeType=node.nodeType||'question-reference';
      element.dataset.displayMode=node.displayMode==='compact'?'compact':'full';
      element.tabIndex=0;
      if(node.color)element.style.setProperty('--qw-card-color',String(node.color));
      if(synthesis||node.color)element.classList.add('has-custom-color');
      element.innerHTML=nodeMarkup(node);
      element.style.zIndex=String(index+2);
      state.nodeLayer.appendChild(element);
      state.kernel.registerCard({
        id:node.id,
        kind:synthesis?'synthesis-card':'question-reference',
        cardType:synthesis?({principle:'knowledge.principle',routine:'knowledge.pattern',trap:'knowledge.mistake',note:'knowledge.note'}[String(node.synthesisType||'principle')]||'knowledge.note'):'question.reference',
        node:{...node},
        element
      });
    });
    syncFullCardHeights({persist:!state.readonly,reason:'full-card-auto-height'});
    state.workspace=store()?.ensure?.(workspaceOptions())||state.workspace;
    renderStructure();
    renderAnalysisPanels();
    syncCardSelectionUI();
    updateNodeCountLabel(nodes.length);
    const empty=byId('qwEmptyState');
    if(empty)empty.hidden=nodes.length>0;
    renderQuestionDock();
    renderMinimap();
    scheduleLayoutDiagnosis(40);
    return nodes.length;
  }
  function refreshProgress(){
    const nodes=store()?.listNodes?.(workspaceOptions())||[];
    nodes.filter(node=>node.nodeType==='question-reference').forEach(node=>store()?.refreshQuestionProgress?.(node.questionId,workspaceOptions()));
    renderCards();
  }
  function removeNode(nodeId){
    if(!canEdit())return false;
    if(analysisPanelOpen(nodeId))closeAnalysisPanel(nodeId);
    state.answerSelections.delete(String(nodeId));
    const node=state.workspace?.nodes?.[String(nodeId)]||state.cards.get(String(nodeId))?.node;
    const synthesis=node?.nodeType==='synthesis-card';
    let approved=true;
    const message=synthesis?'移除这张归纳卡？与它相连的关系也会删除。':'从当前多题画布移除这张题目卡？原题和学习记录不会被删除。';
    try{approved=global.confirm?.(message)!==false}catch(e){}
    if(!approved)return false;
    const before=workspaceSnapshot();
    state.suppressStoreEvent=true;
    try{store()?.removeNode?.(nodeId,workspaceOptions())}finally{state.suppressStoreEvent=false}
    const after=workspaceSnapshot();
    pushWorkspaceHistory(synthesis?'移除归纳卡':'移除题目卡',before,after);
    state.workspace=after;
    renderCards();
    notify(synthesis?'归纳卡已移除。':'题目卡已移除。');
    return true;
  }

  function renderWorkspaceSelector(){
    const workspaces=store()?.listWorkspaces?.()||[];
    const select=byId('qwWorkspaceSelect');
    if(select){
      select.innerHTML=workspaces.map(item=>
        '<option value="'+escapeHTML(item.id)+'">'+escapeHTML(item.title)+' · '+Number(item.nodeCount||0)+'题</option>'
      ).join('');
      select.value=state.workspaceId;
    }
    return workspaces;
  }
  function loadWorkspace(workspaceId,options={}){
    workspaceId=String(workspaceId||'');
    closeAnalysisPanel();
    state.answerSelections.clear();
    clearCardSelection();
    state.kernel?.history?.clear?.();
    if(state.workspace&&state.workspaceId&&state.workspaceId!==workspaceId){
      saveViewport();
    }else{
      state.kernel?.viewport?.cancelPersist?.();
    }
    const workspace=store()?.setActiveWorkspace?.(workspaceId)||store()?.ensure?.({workspaceId});
    if(!workspace)return false;
    state.workspaceId=workspace.id;
    state.workspace=workspace;
    state.panX=Number(workspace.viewport?.x||0);
    state.panY=Number(workspace.viewport?.y||0);
    state.zoom=clamp(Number(workspace.viewport?.zoom||1),MIN_ZOOM,MAX_ZOOM);
    state.kernel.viewport.cancelPersist();
    state.kernel.viewport.sync({
      x:state.panX,
      y:state.panY,
      zoom:state.zoom,
      mobile:state.mobile
    });
    const title=byId('qwPageTitle');
    if(title)title.textContent=workspace.title;
    const chip=byId('qwWorkspaceChip');
    if(chip)chip.textContent=workspace.title;
    const dropName=byId('qwDropWorkspaceName');
    if(dropName)dropName.textContent=workspace.title;
    renderWorkspaceSelector();
    renderCards();
    applyViewport();
    replaceUrl(workspace.id,options.focusNodeId||'');
    if(options.focusNodeId)setTimeout(()=>focusNode(options.focusNodeId),0);
    return true;
  }
  function createWorkspace(){
    if(!canEdit())return null;
    let title='新建解题画布';
    try{
      const entered=global.prompt?.('请输入画布名称',title);
      if(entered===null)return null;
      title=String(entered||title).trim()||title;
    }catch(e){}
    const workspace=store()?.createWorkspace?.(title,{activate:true});
    if(workspace)loadWorkspace(workspace.id);
    return workspace;
  }
  function renameWorkspace(){
    if(!canEdit())return null;
    let title=state.workspace?.title||'';
    try{
      const entered=global.prompt?.('请输入新的画布名称',title);
      if(entered===null)return null;
      title=String(entered||'').trim();
    }catch(e){}
    if(!title)return null;
    const workspace=store()?.renameWorkspace?.(state.workspaceId,title);
    if(workspace)loadWorkspace(workspace.id);
    return workspace;
  }
  function deleteWorkspace(){
    if(!canEdit())return null;
    let approved=true;
    try{approved=global.confirm?.('删除当前多题画布？其中的题目引用和布局会被删除，原题和学习记录不受影响。')!==false}catch(e){}
    if(!approved)return null;
    const result=store()?.deleteWorkspace?.(state.workspaceId);
    if(result?.activeWorkspace)loadWorkspace(result.activeWorkspace.id);
    return result;
  }

  function questionMatches(item){
    const status=sessionStatus(item.question);
    if(state.filter==='completed'&&status.key!=='completed')return false;
    if(state.filter==='unfinished'&&status.key==='completed')return false;
    const query=state.query.trim().toLowerCase();
    if(!query)return true;
    return [
      item.question.title,
      item.question.topic,
      item.question.domain,
      item.question.difficulty,
      ...(Array.isArray(item.question.tags)?item.question.tags:[]),
      item.bank.name
    ].join(' ').toLowerCase().includes(query);
  }
  function renderQuestionDock(){
    const list=byId('qwQuestionList');
    if(!list)return;
    if(!state.questions.length)buildQuestionList();
    const filtered=state.questions.filter(questionMatches);
    const meta=byId('qwQuestionDrawerMeta');
    const paper=selectedPaper();
    const stats=selectedPaperEntry()||state.paperStats;
    if(meta)meta.textContent=paper
      ?'已发布试卷“'+String(paper.name||'')+'” · 已组 '+Number(stats?.configuredCount||0)+'/'+Number(stats?.targetCount||0)+' 题 · 前端可用 '+state.questions.length+' 题 · 当前画布已有 '+state.cards.size+' 题'
      :'暂无已发布试卷，后台草稿题库不会在前端显示。';
    if(!state.questions.length){
      const reason=state.questionLoadError
        ?'读取发布试卷时发生错误：'+state.questionLoadError
        :(state.papers.length
          ?'当前发布试卷没有前端可用题目。'+(Number(stats?.missingCount||0)?'失效引用 '+Number(stats.missingCount)+' 题。':'')+(Number(stats?.blockedCount||0)?'当前角色不可见 '+Number(stats.blockedCount)+' 题。':'')
          :'暂无已发布试卷。请先在题库管理页完成组卷并发布；未发布时前端保持空白。');
      list.innerHTML='<div class="qw-question-load-error"><strong>'+(state.papers.length?'试卷题目不可用':'暂无已发布试卷')+'</strong><span>'+escapeHTML(reason)+'</span><button type="button" data-qw-retry-questions>重新读取发布试卷</button></div>';
      return;
    }
    list.innerHTML=filtered.length?filtered.map((item,visibleIndex)=>{
      const question=item.question||{};
      const status=sessionStatus(question);
      const existing=currentNodeByQuestion(question,item.bank);
      const stableQuestionId=String(question.id||question.sourceQuestionId||'');
      const stableBankId=String(item.bank?.id||question.sourceBankId||'');
      const stablePaperId=String(item.paper?.id||question.sourcePaperId||state.paperId||'');
      return '<div class="qw-question-item '+(existing?'in-workspace':'')+'" data-question-index="'+state.questions.indexOf(item)+'" data-question-id="'+escapeHTML(stableQuestionId)+'" data-bank-id="'+escapeHTML(stableBankId)+'" data-paper-id="'+escapeHTML(stablePaperId)+'" draggable="'+(!state.readonly)+'">'
        +'<span class="qw-question-drag" data-drag-handle draggable="'+(!state.readonly)+'">⋮⋮</span>'
        +'<div class="qw-question-copy"><span>'+String(visibleIndex+1)+'</span><div><strong>'+escapeHTML(question.title||'未命名题目')+'</strong>'
        +'<small>'+escapeHTML([question.topic||question.domain||'未分类',question.difficulty||''].filter(Boolean).join(' · '))+'</small></div>'
        +'<em class="'+status.key+'">'+escapeHTML(status.label)+'</em></div>'
        +'<button type="button" class="qw-question-add '+(existing?'added':'')+'" data-add-index="'+state.questions.indexOf(item)+'" data-question-id="'+escapeHTML(stableQuestionId)+'" data-bank-id="'+escapeHTML(stableBankId)+'" data-paper-id="'+escapeHTML(stablePaperId)+'"'
        +' title="'+(existing?'定位已有题目卡':'加入当前画布')+'">'+(existing?'◎':'+')+'</button>'
        +'</div>';
    }).join(''):'<div class="qt-question-list-empty">没有符合当前搜索或筛选条件的题目。</div>';
  }
  function resolveQuestionItem(source){
    const element=source?.closest?.('[data-question-index],[data-question-id]')||source;
    const index=Number(element?.dataset?.questionIndex??element?.dataset?.addIndex);
    const questionId=String(element?.dataset?.questionId||'');
    const bankId=String(element?.dataset?.bankId||'');
    const paperId=String(element?.dataset?.paperId||'');
    const indexed=Number.isInteger(index)?state.questions[index]:null;
    const matches=item=>{
      if(!item?.question)return false;
      const qid=String(item.question.id||item.question.sourceQuestionId||'');
      const bid=String(item.bank?.id||item.question.sourceBankId||'');
      const pid=String(item.paper?.id||item.question.sourcePaperId||'');
      return (!questionId||qid===questionId)&&(!bankId||bid===bankId)&&(!paperId||pid===paperId);
    };
    return indexed&&matches(indexed)?indexed:state.questions.find(matches)||null;
  }
  function defaultNodePosition(){
    const rect=state.viewport.getBoundingClientRect();
    const center=clientToWorld(rect.left+rect.width/2,rect.top+rect.height/2);
    const count=state.cards.size;
    return {
      x:center.x-215+(count%4)*38,
      y:center.y-210+Math.floor(count/4)*38,
      width:430,
      height:420
    };
  }
  function addQuestionItem(item,position){
    if(!canEdit())return null;
    if(!item?.question)return null;
    const existing=currentNodeByQuestion(item.question,item.bank);
    if(existing){
      focusNode(existing.id);
      closeQuestionDrawer();
      notify('这道题已在当前画布中。');
      return {created:false,node:existing,reason:'already-exists'};
    }
    state.suppressStoreEvent=true;
    let result=null;
    try{
      result=store()?.addQuestionReference?.(
        {...item.question,sourcePaperId:String(item.paper?.id||item.question.sourcePaperId||state.paperId||'')},
        String(item.bank?.id||item.question.sourceBankId||''),
        position||defaultNodePosition(),
        workspaceOptions()
      );
    }finally{
      state.suppressStoreEvent=false;
    }
    renderCards();
    if(result?.node)focusNode(result.node.id);
    notify('题目已加入“'+String(state.workspace?.title||'')+'”。');
    return result;
  }

  function openQuestionDrawer(){
    buildQuestionList();
    renderQuestionDock();
    byId('qwQuestionDrawer')?.classList.add('open');
    byId('qwQuestionDrawer')?.setAttribute('aria-hidden','false');
    const backdrop=byId('qwQuestionDrawerBackdrop');
    if(backdrop)backdrop.hidden=false;
    setTimeout(()=>byId('qwQuestionSearch')?.focus(),60);
  }
  function closeQuestionDrawer(){
    byId('qwQuestionDrawer')?.classList.remove('open');
    byId('qwQuestionDrawer')?.setAttribute('aria-hidden','true');
    const backdrop=byId('qwQuestionDrawerBackdrop');
    if(backdrop)backdrop.hidden=true;
  }

  function readHighlightColor(){
    try{
      const value=String(localStorage.getItem(scopedPreferenceKey(HIGHLIGHT_COLOR_KEY))||'');
      return HIGHLIGHT_COLORS.includes(value)?value:'#fde68a';
    }catch(error){return '#fde68a'}
  }
  function setPrimaryHighlightColor(color,title='高亮所选文字'){
    const resolved=HIGHLIGHT_COLORS.includes(String(color||''))?String(color):'#fde68a';
    const primary=byId('qwHighlightPrimaryBtn');
    if(primary){
      primary.dataset.highlightColor=resolved;
      primary.style.setProperty('--qw-highlight-default',resolved);
      primary.title=title;
      primary.setAttribute('aria-label',title);
    }
    return resolved;
  }
  function setDefaultHighlightColor(color,persist=true){
    const resolved=HIGHLIGHT_COLORS.includes(String(color||''))?String(color):'#fde68a';
    state.highlightColor=resolved;
    setPrimaryHighlightColor(resolved);
    if(persist){
      try{localStorage.setItem(scopedPreferenceKey(HIGHLIGHT_COLOR_KEY),resolved)}catch(error){}
    }
    return resolved;
  }
  function textForHighlightRegion(node,region){
    const question=resolvedQuestionForNode(node)||{};
    if(region==='stem')return questionStem(question,node.stemSummary||'打开题目查看完整题干。');
    if(String(region).startsWith('option:')){
      const key=String(region).slice(7);
      const option=(Array.isArray(question.options)?question.options:[]).find(item=>String(item?.id||'')===key);
      return String(option?.text||'');
    }
    return '';
  }
  function refreshHighlightRegion(nodeId,region,nextNode=null){
    const record=state.cards.get(String(nodeId||''));
    if(!record)return false;
    const node=nextNode||store()?.listNodes?.(workspaceOptions())?.find(item=>String(item.id)===String(nodeId));
    if(!node)return false;
    syncRecordNode(record,node);
    const target=[...record.element.querySelectorAll('[data-highlight-region]')].find(element=>String(element.dataset.highlightRegion||'')===String(region||''));
    if(!target)return false;
    const scroller=record.element.querySelector('.qw-card-content');
    const scrollTop=scroller?.scrollTop||0;
    const scrollLeft=scroller?.scrollLeft||0;
    target.innerHTML=highlightedMarkup(textForHighlightRegion(node,region),node,region);
    if(scroller){scroller.scrollTop=scrollTop;scroller.scrollLeft=scrollLeft}
    return true;
  }
  function hideHighlightMenu(clearSelection=true){
    const menu=byId('qwHighlightMenu');
    if(menu)menu.hidden=true;
    const palette=byId('qwHighlightPalette');
    if(palette)palette.hidden=true;
    const more=byId('qwHighlightMoreBtn');
    if(more)more.setAttribute('aria-expanded','false');
    state.selection=null;
    setPrimaryHighlightColor(state.highlightColor);
    if(clearSelection){
      try{global.getSelection?.()?.removeAllRanges?.()}catch(e){}
    }
  }
  function placeHighlightMenu(rect){
    const menu=byId('qwHighlightMenu');
    if(!menu||!rect)return;
    menu.hidden=false;
    const margin=8;
    const width=menu.offsetWidth||210;
    const height=menu.offsetHeight||36;
    let left=rect.left+rect.width/2-width/2;
    let top=rect.top-height-8;
    if(top<margin)top=rect.bottom+8;
    left=Math.max(margin,Math.min(global.innerWidth-width-margin,left));
    top=Math.max(margin,Math.min(global.innerHeight-height-margin,top));
    menu.style.left=Math.round(left)+'px';
    menu.style.top=Math.round(top)+'px';
  }
  function textOffset(root,node,offset){
    try{
      const range=document.createRange();
      range.selectNodeContents(root);
      range.setEnd(node,offset);
      return range.toString().length;
    }catch(error){return 0}
  }
  function selectionPayload(){
    if(state.readonly||state.mobile)return null;
    const selection=global.getSelection?.();
    if(!selection||selection.rangeCount!==1||selection.isCollapsed)return null;
    const range=selection.getRangeAt(0);
    const startElement=range.startContainer.nodeType===1?range.startContainer:range.startContainer.parentElement;
    const endElement=range.endContainer.nodeType===1?range.endContainer:range.endContainer.parentElement;
    const startRegion=startElement?.closest?.('[data-highlight-region]');
    const endRegion=endElement?.closest?.('[data-highlight-region]');
    if(!startRegion||startRegion!==endRegion)return null;
    const card=startRegion.closest?.('[data-node-id]');
    if(!card||!state.nodeLayer.contains(card))return null;
    const start=textOffset(startRegion,range.startContainer,range.startOffset);
    const end=textOffset(startRegion,range.endContainer,range.endOffset);
    const from=Math.min(start,end);
    const to=Math.max(start,end);
    const text=startRegion.textContent?.slice(from,to)||'';
    if(!text.trim()||to<=from)return null;
    return {
      nodeId:String(card.dataset.nodeId||''),
      region:String(startRegion.dataset.highlightRegion||'stem'),
      start:from,
      end:to,
      text,
      rect:range.getBoundingClientRect()
    };
  }
  function showSelectionHighlightMenu(){
    updateReadonly();
    const payload=selectionPayload();
    if(!payload)return false;
    state.selection=payload;
    setPrimaryHighlightColor(state.highlightColor,'使用当前颜色高亮所选文字');
    placeHighlightMenu(payload.rect);
    return true;
  }
  function showExistingHighlightMenu(mark){
    updateReadonly();
    if(state.readonly||state.mobile||!mark)return false;
    const card=mark.closest?.('[data-node-id]');
    if(!card)return false;
    const region=mark.closest?.('[data-highlight-region]')?.dataset?.highlightRegion||'';
    const record=state.cards.get(String(card.dataset.nodeId||''));
    const highlightId=String(mark.dataset.highlightId||'');
    const highlight=(record?.node?.highlights||[]).find(item=>String(item.id)===highlightId)||null;
    const color=HIGHLIGHT_COLORS.includes(String(highlight?.color||mark.dataset.highlightColor||''))?String(highlight?.color||mark.dataset.highlightColor):'#fde68a';
    state.selection={nodeId:String(card.dataset.nodeId||''),highlightId,region:String(region),color,rect:mark.getBoundingClientRect()};
    setPrimaryHighlightColor(color,'再次点击同色高亮可清除');
    placeHighlightMenu(state.selection.rect);
    return true;
  }
  function applyHighlightColor(color){
    if(!state.selection||!canEdit())return false;
    const resolvedColor=HIGHLIGHT_COLORS.includes(String(color||''))?String(color):'#fde68a';
    const selection={...state.selection};
    if(selection.highlightId&&String(selection.color||'')===resolvedColor){
      return removeExistingHighlight();
    }
    setDefaultHighlightColor(resolvedColor);
    let result=null;
    state.suppressStoreEvent=true;
    try{
      if(selection.highlightId){
        result=store()?.updateNodeHighlight?.(selection.nodeId,selection.highlightId,{color:resolvedColor},workspaceOptions());
      }else{
        result=store()?.addNodeHighlight?.(selection.nodeId,{
          id:'highlight-'+Date.now().toString(36)+'-'+Math.random().toString(36).slice(2,7),
          region:selection.region,
          start:selection.start,
          end:selection.end,
          text:selection.text,
          color:resolvedColor
        },workspaceOptions());
      }
    }finally{state.suppressStoreEvent=false}
    hideHighlightMenu();
    if(!refreshHighlightRegion(selection.nodeId,selection.region,result?.node||null))renderCards();
    notify(selection.highlightId?'高亮颜色已更新；再次点击同色可清除。':'已添加文字高亮；再次点击同色可清除。');
    return true;
  }
  function removeExistingHighlight(){
    if(!state.selection?.highlightId||!canEdit())return false;
    const selection={...state.selection};
    let result=null;
    state.suppressStoreEvent=true;
    try{result=store()?.removeNodeHighlight?.(selection.nodeId,selection.highlightId,workspaceOptions())}
    finally{state.suppressStoreEvent=false}
    hideHighlightMenu();
    if(!refreshHighlightRegion(selection.nodeId,selection.region,result?.node||null))renderCards();
    notify('文字高亮已清除。');
    return true;
  }
  function refreshSingleCardMarkup(record){
    if(!record?.element)return false;
    const element=record.element;
    element.dataset.displayMode=record.node.displayMode==='compact'?'compact':'full';
    element.innerHTML=nodeMarkup(record.node);
    element.classList.toggle('has-custom-color',!!record.node.color||record.node.nodeType==='synthesis-card');
    if(record.node.color)element.style.setProperty('--qw-card-color',String(record.node.color));else element.style.removeProperty('--qw-card-color');
    const selected=state.selectedNodeIds.has(String(record.id));element.classList.toggle('is-selected',selected);element.setAttribute('aria-selected',selected?'true':'false');
    return true;
  }
  function toggleNodeDisplayMode(nodeId){
    if(!canEdit())return false;
    const record=state.cards.get(String(nodeId||''));
    if(!record)return false;
    const next=record.node.displayMode==='compact'?'full':'compact';
    const targetHeight=next==='compact'?COMPACT_CARD_HEIGHT:Math.max(FULL_CARD_MIN_HEIGHT,Number(record.node.height||FULL_CARD_MIN_HEIGHT));
    state.suppressStoreEvent=true;
    let result=null;
    try{result=store()?.updateNode?.(record.node.id,{displayMode:next,height:targetHeight},workspaceOptions())}finally{state.suppressStoreEvent=false}
    if(!result?.node)return false;
    state.workspace=result.workspace||state.workspace;
    syncRecordNode(record,result.node);
    refreshSingleCardMarkup(record);
    applyCard(record);
    syncFullCardHeights({records:[record],persist:true,reason:'single-card-mode-height'});
    (global.requestAnimationFrame||global.setTimeout)(()=>{
      const current=state.cards.get(String(nodeId));
      if(current)syncFullCardHeights({records:[current],persist:true,reason:'single-card-mode-height-settled'});
    });
    notify(next==='compact'?'已切换为紧凑显示。':'已切换为完整显示。');
    return true;
  }

  function isTextEditingTarget(target){
    const element=target?.closest?.('input,textarea,select,[contenteditable]');
    return !!(element&&element.getAttribute?.('contenteditable')!=='false');
  }
  function isCanvasPanMode(){return state.pointerMode==='pan'||state.temporaryPanMode}
  function updatePointerModeUI(){
    const pan=state.pointerMode==='pan';
    state.viewport?.classList.toggle('pointer-edit-mode',!isCanvasPanMode());
    state.viewport?.classList.toggle('pointer-pan-mode',pan);
    state.viewport?.classList.toggle('pointer-temp-pan-mode',state.temporaryPanMode);
    const button=byId('qwPointerModeBtn');
    if(button){
      button.classList.toggle('active',pan);
      button.innerHTML=pan?POINTER_HAND_ICON:POINTER_ARROW_ICON;
      const label=pan?'手型浏览模式（V）':'箭头编辑模式（V）';
      button.title=label;
      button.setAttribute('aria-label',label);
    }
    scheduleSelectionToolbarPosition();
  }
  function setTemporaryPanMode(active,reason=''){
    const key=String(reason||'manual');
    if(active)state.temporaryPanReasons.add(key);
    else if(reason)state.temporaryPanReasons.delete(key);
    else state.temporaryPanReasons.clear();
    state.temporaryPanMode=state.temporaryPanReasons.size>0;
    updatePointerModeUI();
  }
  function setPointerMode(mode,announce=false){
    state.pointerMode=mode==='pan'?'pan':'edit';
    state.temporaryPanReasons.clear();
    state.temporaryPanMode=false;
    updatePointerModeUI();
    if(announce)notify(state.pointerMode==='pan'?'已切换为手型浏览：拖动任意画布区域可平移。':'已切换为箭头编辑：可拖动题目卡；平移请按住空格或鼠标右键。');
  }
  function togglePointerMode(){setPointerMode(state.pointerMode==='pan'?'edit':'pan',true)}
  function safeSetData(transfer,type,value){
    try{transfer.setData(type,value);return true}catch(e){return false}
  }
  function questionDragStart(event){
    if(state.readonly){
      event.preventDefault();
      return;
    }
    const element=event.target?.closest?.('[data-question-index],[data-question-id]');
    const index=Number(element?.dataset?.questionIndex);
    const item=resolveQuestionItem(element);
    if(!element||!item?.question||!event.dataTransfer){
      event.preventDefault();
      return;
    }
    state.dragPayload={
      index,
      questionId:String(item.question.id||item.question.sourceQuestionId||''),
      bankId:String(item.bank?.id||item.question.sourceBankId||''),
      paperId:String(item.paper?.id||item.question.sourcePaperId||state.paperId||'')
    };
    const raw=JSON.stringify(state.dragPayload);
    event.dataTransfer.effectAllowed='copy';
    safeSetData(event.dataTransfer,MIME,raw);
    safeSetData(event.dataTransfer,'text/x-kg-question-reference',raw);
    safeSetData(event.dataTransfer,'text/plain',raw);
    element.classList.add('is-dragging');
  }
  function questionDragEnd(event){
    event.target?.closest?.('[data-question-index]')?.classList.remove('is-dragging');
    setTimeout(()=>{
      state.dragPayload=null;
      state.dragDepth=0;
      showDrop(false);
    },100);
  }
  function transferPayload(event){
    const transfer=event.dataTransfer;
    if(transfer){
      for(const type of [MIME,'text/x-kg-question-reference','text/plain']){
        try{
          const raw=transfer.getData(type);
          if(!raw)continue;
          const parsed=JSON.parse(raw);
          if(parsed?.questionId)return parsed;
        }catch(e){}
      }
    }
    return state.dragPayload;
  }
  function acceptsDrop(event){
    if(state.readonly)return false;
    if(state.dragPayload)return true;
    const types=[...(event.dataTransfer?.types||[])].map(type=>String(type).toLowerCase());
    return types.includes(MIME)||types.includes('text/x-kg-question-reference');
  }
  function showDrop(show){
    const indicator=byId('qwDropIndicator');
    if(indicator)indicator.hidden=!show;
  }
  function dragEnter(event){
    if(!acceptsDrop(event))return;
    event.preventDefault();
    clearTimeout(state.dragLeaveTimer);
    state.dragDepth+=1;
    showDrop(true);
  }
  function dragOver(event){
    if(!acceptsDrop(event))return;
    event.preventDefault();
    clearTimeout(state.dragLeaveTimer);
    if(event.dataTransfer)event.dataTransfer.dropEffect='copy';
    showDrop(true);
  }
  function dragLeave(event){
    if(!acceptsDrop(event))return;
    state.dragDepth=Math.max(0,state.dragDepth-1);
    const related=event.relatedTarget;
    if(related&&state.viewport.contains(related))return;
    clearTimeout(state.dragLeaveTimer);
    state.dragLeaveTimer=setTimeout(()=>{if(state.dragDepth===0)showDrop(false)},50);
  }
  function dropQuestion(event){
    if(!acceptsDrop(event))return;
    if(event.target.closest?.('.qw-question-drawer,.qw-overlay'))return;
    event.preventDefault();
    event.stopPropagation();
    clearTimeout(state.dragLeaveTimer);
    state.dragDepth=0;
    showDrop(false);
    const payload=transferPayload(event);
    state.dragPayload=null;
    if(!payload){
      notify('未能读取拖拽题目，请使用题目右侧的“＋”按钮。');
      return;
    }
    const indexed=state.questions[payload.index];
    const item=indexed&&String(indexed.question?.id||indexed.question?.sourceQuestionId||'')===String(payload.questionId||'')
      &&String(indexed.bank?.id||'')===String(payload.bankId||'')
      ?indexed
      :state.questions.find(candidate=>
        String(candidate.question?.id||candidate.question?.sourceQuestionId||'')===String(payload.questionId||'')
        &&String(candidate.bank?.id||'')===String(payload.bankId||'')
      );
    if(!item){
      notify('这道题不在当前已发布试卷中，请重新打开题目库。');
      return;
    }
    const point=clientToWorld(event.clientX,event.clientY);
    addQuestionItem(item,{x:point.x-215,y:point.y-120,width:430,height:420});
  }

  function beginCardWidthResize(event){
    if(state.readonly||state.mobile||event.button!==0||isCanvasPanMode())return false;
    const handle=event.target.closest?.('[data-qw-card-resize]');
    const card=handle?.closest?.('[data-node-id]');
    if(!handle||!card)return false;
    const record=state.cards.get(String(card.dataset.nodeId||''));
    if(!record)return false;
    if(!state.selectedNodeIds.has(String(record.id)))setCardSelection([record.id]);
    state.gesture={
      type:'resize-card-width',
      pointerId:event.pointerId,
      record,
      startX:event.clientX,
      originWidth:Number(record.element.offsetWidth||record.node.width||430),
      before:state.kernel?.selection?.captureLayouts?.([record])||{},
      moved:false
    };
    record.element.classList.add('is-resizing');
    state.viewport.setPointerCapture?.(event.pointerId);
    event.preventDefault();event.stopPropagation();
    return true;
  }
  function moveCardWidthResize(event,gesture){
    const limits=store()?.LAYOUT_LIMITS||{};
    const dx=(event.clientX-gesture.startX)/Math.max(.0001,state.zoom);
    const minWidth=Math.max(MULTI_CARD_MIN_WIDTH,Number(limits.minWidth||260));
    const worldMax=Math.max(minWidth,WORLD_WIDTH-60-Number(gesture.record.node.x||0));
    const maxWidth=Math.min(Number(limits.maxWidth||1400),worldMax);
    const nextWidth=clamp(gesture.originWidth+dx,minWidth,maxWidth);
    if(Math.abs(nextWidth-gesture.originWidth)>1.5)gesture.moved=true;
    gesture.record.node.width=nextWidth;
    applyCard(gesture.record);
    if(gesture.record.element.dataset.displayMode!=='compact'){
      gesture.record.node.height=measureFullCardHeight(gesture.record);
      applyCard(gesture.record);
    }
    updateEdgesForNodeIds([gesture.record.id]);state.minimapDirty=true;renderMinimap({nodes:false});positionAnalysisPanels();scheduleSelectionToolbarPosition();
    return true;
  }
  function endCardWidthResize(event,gesture,cancelled=false){
    gesture.record?.element?.classList.remove('is-resizing');
    try{state.viewport.releasePointerCapture?.(event.pointerId)}catch(e){}
    if(cancelled){persistLayoutSnapshot(gesture.before,'card-width-resize-cancel');return false}
    if(!gesture.moved)return false;
    if(gesture.record.element.dataset.displayMode!=='compact'){
      gesture.record.node.height=measureFullCardHeight(gesture.record);
      applyCard(gesture.record);
    }
    const after=state.kernel?.selection?.captureLayouts?.([gesture.record])||{};
    const persisted=persistLayoutSnapshot(after,'card-width-resized');
    pushLayoutHistory('调整卡片宽度',gesture.before,persisted);
    renderStructure();updateEdgesGeometry();renderMinimap();positionAnalysisPanels();scheduleLayoutDiagnosis();scheduleSelectionToolbarPosition();
    notify('卡片宽度已调整；完整模式高度已自动适配。可按 Ctrl/Command+Z 撤销。');
    return true;
  }

  function beginGroupContainerDrag(event){
    if(state.readonly||state.mobile||event.button!==0||isCanvasPanMode()||event.target.closest?.('button,a,mark,[contenteditable="true"],[data-qw-inline-field],[data-qw-group-title],input,textarea,select'))return false;
    let element=event.target.closest?.('[data-group-id]');
    let groupId=String(element?.dataset.groupId||'');
    if(!element){
      const card=event.target.closest?.('[data-node-id]');
      const nodeId=String(card?.dataset.nodeId||'');
      if(!card||!event.target.closest?.('[data-card-drag-handle]')||!activeGroupContainsNode(nodeId))return false;
      groupId=String(state.activeGroupId||'');
      element=state.groupElements.get(groupId)||null;
    }
    if(!element||!groupId||String(state.activeGroupId||'')!==groupId)return false;
    const group=(state.workspace?.groups||[]).find(item=>String(item.id)===groupId);
    if(!group)return false;
    const records=(group.nodeIds||[]).map(id=>state.cards.get(String(id))).filter(Boolean);
    const origins=Object.fromEntries(records.map(record=>[String(record.id),{x:Number(record.node.x),y:Number(record.node.y)}]));
    state.gesture={
      type:'container-group',pointerId:event.pointerId,groupId:String(group.id),element,records,origins,
      groupOrigin:{x:Number(group.x),y:Number(group.y)},startX:event.clientX,startY:event.clientY,moved:false,beforeWorkspace:workspaceSnapshot()
    };
    element.classList.add('is-dragging');
    state.viewport.setPointerCapture?.(event.pointerId);
    event.preventDefault();
    return true;
  }
  function moveGroupContainerDrag(event,gesture){
    const dx=(event.clientX-gesture.startX)/Math.max(.0001,state.zoom),dy=(event.clientY-gesture.startY)/Math.max(.0001,state.zoom);
    if(Math.abs(dx)+Math.abs(dy)>1.5)gesture.moved=true;
    gesture.records.forEach(record=>{
      const origin=gesture.origins[String(record.id)];if(!origin)return;
      record.node.x=origin.x+dx;record.node.y=origin.y+dy;applyCard(record);
    });
    gesture.element.style.left=(gesture.groupOrigin.x+dx)+'px';
    gesture.element.style.top=(gesture.groupOrigin.y+dy)+'px';
    updateEdgesForNodeIds(gesture.records.map(record=>record.id));state.minimapDirty=true;renderMinimap({nodes:false});positionAnalysisPanels();scheduleSelectionToolbarPosition();
    return true;
  }
  function endGroupContainerDrag(event,gesture,cancelled=false){
    gesture.element?.classList.remove('is-dragging');
    try{state.viewport.releasePointerCapture?.(event.pointerId)}catch(e){}
    if(cancelled||!gesture.moved){
      if(cancelled)restoreWorkspaceSnapshot(gesture.beforeWorkspace,'group-drag-cancel');
      else{positionAnalysisPanels();scheduleSelectionToolbarPosition()}
      return false;
    }
    const dx=(event.clientX-gesture.startX)/Math.max(.0001,state.zoom),dy=(event.clientY-gesture.startY)/Math.max(.0001,state.zoom);
    const draft=clone(gesture.beforeWorkspace),group=(draft.groups||[]).find(item=>String(item.id)===gesture.groupId);
    gesture.records.forEach(record=>{
      const origin=gesture.origins[String(record.id)],node=draft.nodes?.[String(record.id)];
      if(origin&&node){node.x=origin.x+dx;node.y=origin.y+dy;node.updatedAt=Date.now()}
    });
    if(group){group.x=gesture.groupOrigin.x+dx;group.y=gesture.groupOrigin.y+dy;group.updatedAt=Date.now()}
    state.suppressStoreEvent=true;
    try{state.workspace=store()?.write?.(draft,{reason:'group-container-moved'})||draft}finally{state.suppressStoreEvent=false}
    const after=workspaceSnapshot();
    pushWorkspaceHistory('整体移动分组',gesture.beforeWorkspace,after);
    renderCards();notify('已整体移动分组。可按 Ctrl/Command+Z 撤销。');
    return true;
  }
  function beginGroupCardDrag(event,records){
    const started=state.kernel?.selection?.beginGroupDrag?.(event,records,{activeClass:'is-group-dragging'});
    if(started)state.gesture={type:'group-card',pointerId:event.pointerId};
    return !!started;
  }
  function beginCardDrag(event){
    if(state.readonly||state.mobile||event.button!==0||isCanvasPanMode())return false;
    if(event.target.closest?.('[data-qw-inline-field],[data-qw-card-resize]'))return false;
    const card=event.target.closest?.('[data-node-id]');
    if(!card||event.target.closest('button,a,input,textarea,select,[contenteditable="true"],[data-qw-inline-field],[data-highlight-region],.qw-card-content'))return false;
    const record=state.cards.get(String(card.dataset.nodeId||''));
    if(!record)return false;
    if(event.ctrlKey||event.metaKey){
      toggleCardSelection(record.id);
      event.preventDefault();
      return true;
    }
    if(!state.selectedNodeIds.has(String(record.id)))setCardSelection([record.id]);
    const selectedRecords=state.kernel?.selection?.selectedRecords?.()||[];
    if(selectedRecords.length>1)return beginGroupCardDrag(event,selectedRecords);
    const before=state.kernel?.selection?.captureLayouts?.([record])||{};
    const started=state.kernel.cards.beginDrag(event,record,{
      activeClass:'is-dragging',
      shouldStart:currentEvent=>!currentEvent.target.closest?.('button,a,input,textarea,select,[contenteditable="true"]')
    });
    if(started)state.gesture={type:'card',pointerId:event.pointerId,record,before};
    return started;
  }
  function beginBoxSelection(event){
    if(state.readonly||state.mobile||event.button!==0||isCanvasPanMode())return false;
    const started=state.kernel?.selection?.beginBox?.(event,{
      shouldStart:currentEvent=>!currentEvent.target.closest?.('.qw-question-card,.qw-group-container,.qw-question-drawer,.qw-overlay,.qw-highlight-menu,.qw-diagnostics-panel,.qw-analysis-panel,[data-edge-id],.qw-edge-quick-menu,.qw-edge-inline-editor,button,a,input,textarea,select')
    });
    if(started)state.gesture={type:'box',pointerId:event.pointerId};
    return !!started;
  }
  function moveBoxSelection(event){
    return state.kernel?.selection?.moveBox?.(event)||false;
  }
  function finishBoxSelection(event,cancelled=false){
    const result=state.kernel?.selection?.endBox?.(event,{cancelled});
    if(!result)return false;
    const count=result.ids?.length||0;
    if(!cancelled&&result.moved)notify(count?'已框选 '+count+' 张卡片；可整体移动、对齐或统一尺寸。':'框选区域内没有题目卡。');
    return true;
  }
  function beginPan(event){
    if(state.mobile||state.kernel.cards.hasDrag()||state.gesture?.type==='box'||state.gesture?.type==='group-card'||state.gesture?.type==='container-group')return;
    const rightPan=event.button===2;
    if(!rightPan&&!isCanvasPanMode())return;
    const started=state.kernel.viewport.beginPan(event,{
      activeClass:'is-panning',
      allowedButtons:[0,2],
      shouldStart:currentEvent=>!currentEvent.target.closest?.('.qw-question-drawer,.qw-overlay,.qw-highlight-menu,.qw-analysis-panel,[data-edge-id],.qw-edge-quick-menu,.qw-edge-inline-editor,button,a,input,textarea,select')
    });
    if(started){
      beginViewportMotion('pan');
      if(rightPan){state.rightPanPointerId=event.pointerId;setTemporaryPanMode(true,'right')}
      state.gesture={type:'pan',pointerId:event.pointerId};
    }
  }
  function moveGroupCardDrag(event){
    return state.kernel?.selection?.moveGroupDrag?.(event)||false;
  }
  function endGroupCardDrag(event,cancelled=false){
    const result=state.kernel?.selection?.endGroupDrag?.(event,{cancelled});
    if(!result||!result.moved)return result;
    const persisted=persistLayoutSnapshot(result.after,'group-drag');
    pushLayoutHistory('整体移动 '+result.records.length+' 张卡片',result.before,persisted);
    notify('已整体移动 '+result.records.length+' 张卡片。可按 Ctrl/Command+Z 撤销。');
    return result;
  }
  function pointerMove(event){
    const gesture=state.gesture;
    if(!gesture||gesture.pointerId!==event.pointerId)return;
    if(gesture.type==='box'){moveBoxSelection(event);return}
    if(gesture.type==='resize-card-width'){moveCardWidthResize(event,gesture);return}
    if(gesture.type==='container-group'){moveGroupContainerDrag(event,gesture);return}
    if(gesture.type==='pan'){
      state.kernel.viewport.movePan(event);
      return;
    }
    if(gesture.type==='group-card'){
      const result=moveGroupCardDrag(event);if(result)updateEdgesForNodeIds([...state.selectedNodeIds]);scheduleSelectionToolbarPosition();
      return;
    }
    if(gesture.type==='card'){
      state.kernel.cards.moveDrag(event);
      updateEdgesForNodeIds([gesture.record.id]);scheduleSelectionToolbarPosition();
    }
  }
  function pointerUp(event){
    const gesture=state.gesture;
    if(!gesture||gesture.pointerId!==event.pointerId)return;
    state.gesture=null;
    const cancelled=event.type==='pointercancel';
    if(gesture.type==='box'){
      finishBoxSelection(event,cancelled);
      return;
    }
    if(gesture.type==='resize-card-width'){
      endCardWidthResize(event,gesture,cancelled);
      return;
    }
    if(gesture.type==='container-group'){
      endGroupContainerDrag(event,gesture,cancelled);
      return;
    }
    if(gesture.type==='pan'){
      state.kernel.viewport.endPan(event,{activeClass:'is-panning',persist:true});
      if(event.pointerId===state.rightPanPointerId){state.rightPanPointerId=null;setTemporaryPanMode(false,'right')}
      return;
    }
    if(gesture.type==='group-card'){
      const result=endGroupCardDrag(event,cancelled);
      if(!cancelled&&result?.moved&&!syncDraggedMembership(result.records.map(record=>record.id))){renderStructure();scheduleLayoutDiagnosis()}
      return;
    }
    if(gesture.type==='card'){
      const result=state.kernel.cards.endDrag(event,{
        activeClass:'is-dragging',
        persist:!cancelled,
        reason:'drag'
      });
      if(cancelled){
        persistLayoutSnapshot(gesture.before,'single-drag-cancel');
      }else if(result?.moved){
        const after=state.kernel?.selection?.captureLayouts?.([gesture.record])||{};
        pushLayoutHistory('移动题目卡',gesture.before,after);
        if(!syncDraggedMembership([gesture.record.id])){renderStructure();scheduleLayoutDiagnosis()}
      }
      updateEdgesForNodeIds([gesture.record.id]);state.minimapDirty=true;renderMinimap();positionAnalysisPanels();scheduleSelectionToolbarPosition();
    }
  }

  function wheel(event){
    if(state.mobile)return;
    if(event.target.closest?.('.qw-question-drawer'))return;
    event.preventDefault();
    beginViewportMotion('zoom');
    const direction=event.deltaY<0?1:-1;
    state.kernel.viewport.zoomByLevel(
      direction,
      WHEEL_LEVELS,
      event.clientX,
      event.clientY,
      {duration:150,persist:true,source:'workspace-wheel'}
    );
  }

  function renderMinimap(options={}){
    const worldEl=byId('qwMinimapWorld');
    const viewEl=byId('qwMinimapView');
    const minimap=byId('qwMinimap');
    if(!worldEl||!viewEl||!minimap||state.mobile)return;
    const rebuild=options.nodes!==false||state.minimapDirty||!state.minimapModel;
    if(rebuild){
      const bounds=cardBounds()||{left:0,top:0,width:8000,height:5000,right:8000,bottom:5000};
      const pad=100,left=bounds.left-pad,top=bounds.top-pad,width=Math.max(1000,bounds.width+pad*2),height=Math.max(700,bounds.height+pad*2);
      const innerW=Math.max(1,minimap.clientWidth-16),innerH=Math.max(1,minimap.clientHeight-16),scale=Math.min(innerW/width,innerH/height);
      state.minimapModel={left,top,width,height,scale};
      worldEl.innerHTML='';
      state.cards.forEach(record=>{
        if(record.element?.classList.contains('is-group-collapsed'))return;
        const dot=document.createElement('span');dot.className='qw-minimap-node';
        dot.style.left=((record.node.x-left)*scale)+'px';dot.style.top=((record.node.y-top)*scale)+'px';
        dot.style.width=Math.max(4,record.node.width*scale)+'px';dot.style.height=Math.max(3,record.node.height*scale)+'px';worldEl.appendChild(dot);
      });
      state.minimapDirty=false;
    }
    const model=state.minimapModel;if(!model)return;
    const rect=state.viewport.getBoundingClientRect();
    viewEl.style.left=(8+(-state.panX/state.zoom-model.left)*model.scale)+'px';
    viewEl.style.top=(8+(-state.panY/state.zoom-model.top)*model.scale)+'px';
    viewEl.style.width=Math.max(8,rect.width/state.zoom*model.scale)+'px';
    viewEl.style.height=Math.max(6,rect.height/state.zoom*model.scale)+'px';
  }

  function bind(){
    byId('qwWorkspaceSelect')?.addEventListener('change',event=>loadWorkspace(event.target.value));
    byId('qwCreateWorkspaceBtn')?.addEventListener('click',createWorkspace);
    byId('qwRenameWorkspaceBtn')?.addEventListener('click',renameWorkspace);
    byId('qwDeleteWorkspaceBtn')?.addEventListener('click',deleteWorkspace);
    byId('qwQuestionDockBtn')?.addEventListener('click',openQuestionDrawer);
    byId('qwEmptyAddBtn')?.addEventListener('click',openQuestionDrawer);
    byId('qwQuestionDrawerClose')?.addEventListener('click',closeQuestionDrawer);
    byId('qwQuestionDrawerBackdrop')?.addEventListener('click',closeQuestionDrawer);
    byId('qwNewSynthesisBtn')?.addEventListener('click',()=>openSynthesisModal());
    byId('qwCreateGroupBtn')?.addEventListener('click',quickCreateGroup);
    byId('qwConnectBtn')?.addEventListener('click',()=>openEdgeModal());
    byId('qwSelectionToolbar')?.addEventListener('click',event=>{
      const action=event.target.closest?.('[data-qw-selection-action]')?.dataset.qwSelectionAction;
      if(!action)return;
      event.stopPropagation();
      if(action==='group')quickCreateGroup();
      if(action==='synthesize')quickCreateSynthesis();
      if(action==='color'){
        const palette=byId('qwSelectionColorPalette');
        if(palette)palette.hidden=!palette.hidden;
      }
    });
    byId('qwSelectionColorPalette')?.addEventListener('click',event=>{
      const color=event.target.closest?.('[data-qw-selection-color]')?.dataset.qwSelectionColor;
      if(!color)return;
      event.stopPropagation();
      applySelectionColor(color);
      event.currentTarget.hidden=true;
    });
    byId('qwSmartArrangeSelect')?.addEventListener('change',event=>{const mode=String(event.target.value||'');if(mode)smartArrange(mode);event.target.value=''});
    byId('qwDiagnoseBtn')?.addEventListener('click',openDiagnosticsPanel);
    byId('qwDiagnosticsClose')?.addEventListener('click',closeDiagnosticsPanel);
    byId('qwRunDiagnosisBtn')?.addEventListener('click',()=>runLayoutDiagnosis({open:true}));
    byId('qwResolveOverlapBtn')?.addEventListener('click',resolveOverlaps);
    byId('qwRepairBoundsBtn')?.addEventListener('click',repairOutOfBounds);
    byId('qwRepairGroupsBtn')?.addEventListener('click',repairGroupBounds);
    byId('qwDiagnosticsList')?.addEventListener('click',event=>{const button=event.target.closest?.('[data-qw-diagnostic-focus]');if(button)focusNode(button.dataset.qwDiagnosticFocus)});
    byId('qwStructureBackdrop')?.addEventListener('click',closeStructureModals);
    document.querySelectorAll('[data-qw-modal-close]').forEach(button=>button.addEventListener('click',closeStructureModals));
    byId('qwSaveSynthesisBtn')?.addEventListener('click',saveSynthesisCard);
    byId('qwSaveGroupBtn')?.addEventListener('click',saveGroup);
    byId('qwSaveEdgeBtn')?.addEventListener('click',saveEdge);
    byId('qwDeleteEdgeBtn')?.addEventListener('click',deleteEditingEdge);
    byId('qwEdgeType')?.addEventListener('change',()=>{});
    state.groupLayer?.addEventListener('click',event=>{
      const container=event.target.closest?.('[data-group-id]');
      const groupId=container?.dataset.groupId;
      if(!groupId)return;
      const action=event.target.closest?.('[data-qw-group-action]')?.dataset.qwGroupAction;
      event.stopPropagation();
      setActiveGroup(groupId,{force:true});
      if(action==='toggle')toggleGroup(groupId);
      if(action==='fit')repairGroupBounds();
      if(action==='edit')openGroupModal(groupId);
      if(action==='remove'){setActiveGroup('');removeGroup(groupId)}
    });
    state.groupLayer?.addEventListener('dblclick',event=>{
      const title=event.target.closest?.('[data-qw-group-title]');
      const groupId=event.target.closest?.('[data-group-id]')?.dataset.groupId;
      if(title&&groupId){
        event.preventDefault();event.stopPropagation();
        beginGroupTitleEdit(groupId);
      }
    });
    state.edgeLayer?.addEventListener('pointerdown',event=>{if(event.target.closest?.('[data-edge-id]'))event.stopPropagation()});
    state.edgeLayer?.addEventListener('click',event=>{const edgeId=event.target.closest?.('[data-edge-id]')?.dataset.edgeId;if(edgeId){event.preventDefault();event.stopPropagation();showEdgeQuickMenu(edgeId,event)}});
    state.analysisLayer?.addEventListener('pointerdown',event=>{event.stopPropagation();beginAnalysisPanelDrag(event)});
    state.analysisLayer?.addEventListener('pointermove',event=>moveAnalysisPanelDrag(event));
    state.analysisLayer?.addEventListener('pointerup',event=>endAnalysisPanelDrag(event));
    state.analysisLayer?.addEventListener('pointercancel',event=>endAnalysisPanelDrag(event));
    state.analysisLayer?.addEventListener('click',event=>{
      const close=event.target.closest?.('[data-qw-analysis-close]');if(close){event.preventDefault();closeAnalysisPanel(close.dataset.qwAnalysisClose,{announce:true});return}
    });
    state.analysisLayer?.addEventListener('change',event=>{
      const checkbox=event.target.closest?.('[data-qw-analysis-section]');
      if(!checkbox)return;
      const key=String(checkbox.dataset.qwAnalysisSection||'');
      if(!ANALYSIS_SECTION_ORDER.includes(key))return;
      if(checkbox.checked)state.analysisSections.add(key);else state.analysisSections.delete(key);
      if(!state.analysisSections.size){state.analysisSections.add('answer');checkbox.checked=false}
      saveAnalysisSections();
      refreshAnalysisPanelContents();
    });
    state.analysisLayer?.addEventListener('toggle',()=>requestAnimationFrame(positionAnalysisPanels),true);
    byId('qwHelpBtn')?.addEventListener('click',()=>{
      const popover=byId('qwHelpPopover');
      if(popover)popover.hidden=!popover.hidden;
    });
    byId('qwPaperSelect')?.addEventListener('change',event=>{
      state.paperId=String(event.target.value||'');
      savePaperSelection();
      buildQuestionList();
      renderQuestionDock();
    });
    byId('qwQuestionSearch')?.addEventListener('input',event=>{
      state.query=String(event.target.value||'');
      renderQuestionDock();
    });
    document.querySelectorAll('[data-qw-filter]').forEach(button=>{
      button.addEventListener('click',()=>{
        state.filter=String(button.dataset.qwFilter||'all');
        document.querySelectorAll('[data-qw-filter]').forEach(item=>item.classList.toggle('active',item===button));
        renderQuestionDock();
      });
    });
    byId('qwQuestionList')?.addEventListener('click',event=>{
      if(event.target.closest?.('[data-qw-retry-questions]')){
        buildQuestionList();
        renderQuestionDock();
        return;
      }
      const add=event.target.closest?.('[data-add-index]');
      if(!add)return;
      const item=resolveQuestionItem(add);
      const existing=item?currentNodeByQuestion(item.question,item.bank):null;
      if(existing)focusNode(existing.id);
      else addQuestionItem(item);
    });
    byId('qwQuestionList')?.addEventListener('dragstart',questionDragStart);
    byId('qwQuestionList')?.addEventListener('dragend',questionDragEnd);
    state.nodeLayer.addEventListener('click',event=>{
      const mark=event.target.closest?.('[data-highlight-id]');
      if(mark){
        event.stopPropagation();
        showExistingHighlightMenu(mark);
        return;
      }
      const card=event.target.closest?.('[data-node-id]');
      if(!card)return;
      const record=state.cards.get(String(card.dataset.nodeId||''));
      if(!record)return;
      const optionButton=event.target.closest?.('[data-qw-option-key]');
      if(optionButton){
        event.preventDefault();event.stopPropagation();
        handleOptionChoice(record,optionButton.dataset.qwOptionKey,optionButton);
        return;
      }
      const action=event.target.closest?.('[data-qw-action]')?.dataset.qwAction;
      if(action){event.preventDefault();event.stopPropagation()}
      if(action==='analysis')toggleAnalysisPanel(record.node.id);
      if(action==='focus')focusNode(record.node.id);
      if(action==='remove')removeNode(record.node.id);
      if(action==='toggle-mode')toggleNodeDisplayMode(record.node.id);
      if(action==='edit-title'){
        const title=record.element.querySelector?.('[data-qw-inline-field="title"]');
        if(title)beginInlineNodeEdit(title,record.node.id,'title');
      }
      if(action==='edit-node')openSynthesisModal(record.node.id);
      if(!action&&!optionButton){
        if(event.ctrlKey||event.metaKey)toggleCardSelection(record.id);
        else if(!state.selectedNodeIds.has(String(record.id))||state.selectedNodeIds.size!==1)setCardSelection([record.id]);
      }
    });
    state.nodeLayer.addEventListener('mouseup',event=>{
      if(event.button!==0||isCanvasPanMode()||event.target.closest?.('button'))return;
      setTimeout(showSelectionHighlightMenu,0);
    });
    state.nodeLayer.addEventListener('dblclick',event=>{
      const inline=event.target.closest?.('[data-qw-inline-field]');
      const card=event.target.closest?.('[data-node-id]');
      const record=state.cards.get(String(card?.dataset.nodeId||''));
      if(inline&&record?.node?.nodeType==='synthesis-card'){
        event.preventDefault();event.stopPropagation();
        beginInlineNodeEdit(inline,record.node.id,inline.dataset.qwInlineField);
        return;
      }
    });
    state.viewport.addEventListener('pointerdown',event=>{
      if(!event.target.closest?.('.qw-highlight-menu'))hideHighlightMenu(false);
      const pointerCard=event.target.closest?.('[data-node-id]');
      const pointerInsideActiveGroup=!!event.target.closest?.('[data-group-id]')||activeGroupContainsNode(pointerCard?.dataset.nodeId||'');
      if(!pointerInsideActiveGroup&&!event.target.closest?.('#qwSelectionToolbar'))setActiveGroup('');
      if(!event.target.closest?.('[data-edge-id],.qw-edge-quick-menu,.qw-edge-inline-editor')){hideEdgeQuickMenu();hideEdgeInlineEditor()}
      beginCardWidthResize(event);
      if(!state.gesture)beginGroupContainerDrag(event);
      if(!state.gesture)beginCardDrag(event);
      if(!state.gesture)beginBoxSelection(event);
      if(!state.gesture)beginPan(event);
    });
    state.viewport.addEventListener('pointermove',pointerMove);
    state.viewport.addEventListener('pointerup',pointerUp);
    state.viewport.addEventListener('pointercancel',pointerUp);
    state.viewport.addEventListener('wheel',wheel,{passive:false});
    state.viewport.addEventListener('dragenter',dragEnter,true);
    state.viewport.addEventListener('dragover',dragOver,true);
    state.viewport.addEventListener('dragleave',dragLeave,true);
    state.viewport.addEventListener('drop',dropQuestion,true);
    document.querySelectorAll('[data-highlight-color]').forEach(button=>{
      button.addEventListener('click',event=>{
        event.stopPropagation();
        applyHighlightColor(String(button.dataset.highlightColor||'#fde68a'));
      });
    });
    byId('qwHighlightMoreBtn')?.addEventListener('click',event=>{
      event.stopPropagation();
      const palette=byId('qwHighlightPalette');
      if(!palette)return;
      palette.hidden=!palette.hidden;
      event.currentTarget.setAttribute('aria-expanded',palette.hidden?'false':'true');
    });
    document.addEventListener('pointerdown',event=>{
      const menu=byId('qwHighlightMenu');
      if(menu&&!menu.hidden&&!event.target.closest?.('#qwHighlightMenu')&&!event.target.closest?.('[data-highlight-id]'))hideHighlightMenu(false);
      const palette=byId('qwSelectionColorPalette');
      if(palette&&!palette.hidden&&!event.target.closest?.('#qwSelectionToolbar'))palette.hidden=true;
    },true);
    byId('qwZoomOutBtn')?.addEventListener('click',()=>{
      beginViewportMotion('zoom');
      const rect=state.viewport.getBoundingClientRect();
      state.kernel.viewport.zoomByLevel(
        -1,BUTTON_LEVELS,rect.left+rect.width/2,rect.top+rect.height/2,
        {duration:230,persist:true,source:'workspace-button'}
      );
    });
    byId('qwZoomInBtn')?.addEventListener('click',()=>{
      beginViewportMotion('zoom');
      const rect=state.viewport.getBoundingClientRect();
      state.kernel.viewport.zoomByLevel(
        1,BUTTON_LEVELS,rect.left+rect.width/2,rect.top+rect.height/2,
        {duration:230,persist:true,source:'workspace-button'}
      );
    });
    byId('qwZoomLabel')?.addEventListener('click',()=>{
      beginViewportMotion('zoom');
      const rect=state.viewport.getBoundingClientRect();
      state.kernel.viewport.zoomAt(
        1,rect.left+rect.width/2,rect.top+rect.height/2,
        {duration:230,persist:true,source:'workspace-reset'}
      );
    });
    byId('qwPointerModeBtn')?.addEventListener('click',togglePointerMode);
    byId('qwFontScaleBtn')?.addEventListener('click',cycleFontScale);
    byId('qwUndoBtn')?.addEventListener('click',undoLayout);
    byId('qwRedoBtn')?.addEventListener('click',redoLayout);
    byId('qwArrangeSelect')?.addEventListener('change',handleArrangeSelection);
    byId('qwFitBtn')?.addEventListener('click',fitAll);
    byId('qwResetViewBtn')?.addEventListener('click',()=>setViewport({x:80,y:70,zoom:1}));
    state.viewport.addEventListener('contextmenu',event=>{
      if(!event.target.closest?.('.qw-question-drawer,.qw-overlay,.qw-highlight-menu'))event.preventDefault();
    });
    document.addEventListener('keydown',event=>{
      const editing=isTextEditingTarget(event.target);
      const key=String(event.key||'').toLowerCase();
      if((event.ctrlKey||event.metaKey)&&!event.altKey&&!editing&&key==='z'){
        event.preventDefault();
        if(event.shiftKey)redoLayout();else undoLayout();
        return;
      }
      if((event.ctrlKey||event.metaKey)&&!event.altKey&&!editing&&key==='y'){
        event.preventDefault();
        redoLayout();
        return;
      }
      if((event.code==='Space'||event.key===' ')&&!event.repeat&&!editing){
        setTemporaryPanMode(true,'space');
        event.preventDefault();
        return;
      }
      if(key==='v'&&!event.repeat&&!event.ctrlKey&&!event.metaKey&&!event.altKey&&!editing){
        togglePointerMode();
        event.preventDefault();
        return;
      }
      if(event.key==='Escape'){
        hideHighlightMenu();
        state.kernel?.selection?.cancel?.();
        if(state.gesture?.type==='box'||state.gesture?.type==='group-card'||state.gesture?.type==='container-group')state.gesture=null;
        clearCardSelection();
        setActiveGroup('');
        closeQuestionDrawer();
        closeStructureModals();
        closeDiagnosticsPanel();
        hideEdgeQuickMenu();
        hideEdgeInlineEditor();
        const popover=byId('qwHelpPopover');
        if(popover)popover.hidden=true;
      }
    });
    document.addEventListener('keyup',event=>{
      if(event.code==='Space'||event.key===' '){setTemporaryPanMode(false,'space');event.preventDefault()}
    });
    global.addEventListener('resize',()=>{
      const wasMobile=state.mobile;
      updateReadonly();
      if(wasMobile!==state.mobile){
        renderCards();
        applyViewport();
      }
    });
    global.addEventListener('blur',()=>{
      state.rightPanPointerId=null;
      setTemporaryPanMode(false);
    });
    global.addEventListener('kg-auth-session-change',()=>{
      updateReadonly();
      invalidateQuestionSources();
      setDefaultHighlightColor(readHighlightColor(),false);
      state.analysisSections=readAnalysisSections();
      applyFontScale(readFontScale(),false);
      state.kernel?.viewport?.cancelPersist?.();
      state.workspace=null;
      state.workspaceId='';
      state.kernel?.history?.clear?.();
      clearCardSelection();
      const workspace=store()?.ensure?.({activate:true});
      if(workspace)loadWorkspace(workspace.id);
      buildQuestionList();
      if(byId('qwQuestionDrawer')?.classList.contains('open'))renderQuestionDock();
    });
    global.addEventListener('focus',()=>{
      updateReadonly();
      invalidateQuestionSources();
      buildQuestionList();
      if(byId('qwQuestionDrawer')?.classList.contains('open'))renderQuestionDock();
    });
    global.addEventListener('storage',event=>{
      const key=String(event.key||'');
      if(!key.includes('question')&&!key.includes('exam_papers'))return;
      invalidateQuestionSources();
      buildQuestionList();
      if(byId('qwQuestionDrawer')?.classList.contains('open'))renderQuestionDock();
    });
    global.addEventListener('kg:workspace-changed',event=>{
      if(state.suppressStoreEvent)return;
      const workspaceId=String(event.detail?.workspaceId||'');
      const reason=String(event.detail?.reason||'');
      renderWorkspaceSelector();
      if(workspaceId===state.workspaceId&&['question-node-added','synthesis-node-added','node-removed','node-updated','nodes-layout-updated','workspace-renamed','question-progress-refreshed','edge-added','edge-updated','edge-removed','group-created','group-updated','group-removed'].includes(reason)){
        state.workspace=store()?.ensure?.(workspaceOptions())||state.workspace;
        renderCards();
      }
    });
  }

  function init(){
    if(state.initialized||!document.body.classList.contains('question-workspace-page'))return;
    state.viewport=byId('qwCanvasViewport');
    state.world=byId('qwCanvasWorld');
    state.nodeLayer=byId('qwNodeLayer');
    state.groupLayer=byId('qwGroupLayer');
    state.edgeLayer=byId('qwEdgeLayer');
    state.edgeRoot=byId('qwEdges');
    state.analysisLayer=byId('qwAnalysisLayer');
    if(!state.viewport||!state.world||!state.nodeLayer)return;
    state.mobile=isMobile();
    state.readonly=state.mobile||!loggedIn();
    createKernel();
    state.initialized=true;
    document.body.classList.add('qw-light-canvas');
    state.minimapDirty=true;
    updateReadonly();
    setDefaultHighlightColor(readHighlightColor(),false);
    state.analysisSections=readAnalysisSections();
    applyFontScale(readFontScale(),false);
    updatePointerModeUI();
    updateLayoutToolbar();
    buildQuestionList();
    const params=queryParams();
    const requested=String(params.get('workspace')||store()?.getActiveWorkspaceId?.()||'');
    const focusNodeId=String(params.get('focus')||'');
    const workspace=store()?.ensure?.({workspaceId:requested,activate:true});
    state.workspaceId=workspace?.id||requested;
    bind();
    loadWorkspace(state.workspaceId,{focusNodeId});
  }

  global.KGMultiQuestionWorkspace=Object.freeze({
    init,
    loadWorkspace,
    renderCards,
    renderQuestionDock,
    addQuestionItem,
    focusNode,
    fitAll,
    setViewport,
    openQuestionDrawer,
    closeQuestionDrawer,
    selectNodes:ids=>setCardSelection(ids),
    arrangeSelected:applySelectedArrangement,
    createSynthesisCard:openSynthesisModal,
    createGroup:quickCreateGroup,
    quickCreateSynthesis,
    connectSelected:openEdgeModal,
    toggleAnalysis:toggleAnalysisPanel,
    applySelectionColor,
    diagnoseLayout:runLayoutDiagnosis,
    smartArrange,
    undoLayout,
    redoLayout,
    getState:()=>({
      workspaceId:state.workspaceId,
      nodeCount:state.cards.size,
      panX:state.panX,
      panY:state.panY,
      zoom:state.zoom,
      mobile:state.mobile,
      readonly:state.readonly,
      paperId:state.paperId,
      pointerMode:state.pointerMode,
      highlightColor:state.highlightColor,
      fontScale:state.fontScale,
      analysisNodeId:state.analysisNodeIds.at(-1)||'',
      analysisNodeIds:state.analysisNodeIds.slice(),
      analysisSections:[...state.analysisSections],
      activeGroupId:state.activeGroupId,
      quickAnswerNodeIds:[...state.answerSelections.keys()],
      selectedNodeIds:[...state.selectedNodeIds],
      groupCount:(state.workspace?.groups||[]).length,
      edgeCount:(state.workspace?.edges||[]).length,
      layoutIssues:clone(state.layoutIssues),
      kernel:state.kernel?.getState?.()||null
    })
  });

  document.addEventListener('DOMContentLoaded',init);
  global.addEventListener('load',()=>setTimeout(()=>{
    init();
    if(!state.initialized)return;
    buildQuestionList();
    if(byId('qwQuestionDrawer')?.classList.contains('open'))renderQuestionDock();
  },0));
})(window);
