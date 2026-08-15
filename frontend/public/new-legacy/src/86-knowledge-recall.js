'use strict';

(function(){
  const $=id=>document.getElementById(id);
  const viewport=$('krViewport'),world=$('krWorld'),edges=$('krEdges'),questionCard=$('krQuestionCard'),nodeLayer=$('krNodeLayer'),guide=$('krGuide');
  const analysisLayer=$('krAnalysisLayer');
  const RecallStorage=window.KGRecallStorage||{};
  const GraphModel=window.KGRecallGraphModel||{};
  const DeepRecallFlow=window.KGDeepRecallFlowModel||{};
  const THEME_KEY='kg_deep_recall_theme_v1';
  const THEME_MIGRATION_KEY='kg_deep_recall_theme_platform_migrated_v1';
  const DATA=window.KNOWLEDGE_RECALL_MAP||{roots:{},nodes:{}};
  const Store=window.KGAppStorage||{};
  const fallbackQuestion={id:'unavailable',title:'暂无可用题目',stemParts:[{text:'当前没有可用于深度回忆的已发布试卷。'}],options:[],clues:[],concepts:[],tags:[],sourceCollectionId:'',sourceBankId:'',sourceQuestionId:'unavailable',sourcePaperId:'',sourceReleaseId:''};
  let question=cloneValue(fallbackQuestion);
  let rootMap=buildRootMap(question);
  let keywordMatchers=buildKeywordMatchers(rootMap);
  let state={nodes:[],edges:[],lastNewEdgeId:'',lastNewNodeId:'',activeNodeId:null,activeKeywords:[],transform:{x:0,y:0,scale:1},customNodes:{},choiceOffsets:{},metrics:{keywordClicks:0,choiceClicks:0,nodeOpens:0,sessionStartedAt:Date.now()}};
  let isDragging=false,dragStart=null,worldStart=null,panPointerId=null,panButton=0,rightPanStart=null,contextMenuSuppressUntil=0,contextMenu=null,customOpen=false,lastViewportSize=null;
  let canvasRuntime=null,recallViewportRestored=false;
  let progressSaveTimer=0,questionSessionToken=0,cardClickTimer=0,searchTimer=0,nodeSearchTimer=0;
  let associationRuntime={subject:'',library:null,nodeCache:new Map(),resolveCache:new Map()};
  let nodeDrag=null,suppressNodeClickUntil=0;
  let recallAdapter=null,recallSession=null,keywordsRevealed=false;
  const destroyingNodeIds=new Set();
  let questionBrowser={bankId:'',filter:'all'};
  let guideDragging=false,guideDragStart=null,guideStart=null;
  const THEMES=new Set(['platform','parchment','aurora','neon','sakura','ocean','latte']);
  const BUTTON_ZOOM_LEVELS=[.01,.02,.03,.05,.10,.15,.20,.33,.50,.75,1,1.25,1.50,2,2.50,3,4];
  const WHEEL_ZOOM_LEVELS=[.01,.02,.03,.04,.05,.07,.09,.11,.13,.17,.21,.26,.33,.41,.51,.64,.80,1,1.20,1.44,1.73,2.07,2.49,2.99,3.58,4];
  const MIN_ZOOM=.01,MAX_ZOOM=4;
  // P4.5.30：选项与解析对齐多题画布（77-multi-question-workspace.js）的行为常量。
  const KR_OPTION_SINGLE_CLICK_DELAY=230,KR_OPTION_CORRECT_FLASH=560,KR_OPTION_WRONG_FLASH=430;
  const KR_ANALYSIS_SECTION_KEY='kg_multi_question_analysis_sections_v1';
  const KR_ANALYSIS_SECTION_ORDER=['analysis','answer','path','concepts','clues','traps'];
  const KR_ANALYSIS_SECTION_LABELS={analysis:'题目解析',answer:'正确答案',path:'判断主线',concepts:'知识点',clues:'关键词',traps:'选项提示'};
  const KR_ANALYSIS_SECTION_DEFAULTS=['analysis','answer','path'];
  const KR_ANALYSIS_ICON='<svg aria-hidden="true" viewBox="0 0 24 24"><path d="M5 4.5h10a3 3 0 0 1 3 3V20H8a3 3 0 0 1-3-3V4.5z"/><path d="M8 7.5h7M8 11h6M8 14.5h4"/></svg>';
  let krOptionState={selected:'',persistent:''};
  let krOptionClickTimer=0,krOptionFlashTimer=0;
  let krAnalysisOpen=false,krAnalysisOffset={x:0,y:0};
  const HIGHLIGHT_PALETTES=[
    {'--kr-highlight-from':'rgba(251,191,36,.34)','--kr-highlight-to':'rgba(253,230,138,.90)','--kr-highlight-ring':'rgba(251,191,36,.26)','--kr-highlight-hover':'rgba(251,191,36,.18)','--kr-highlight-text':'#3a1f0a'},
    {'--kr-highlight-from':'rgba(52,211,153,.28)','--kr-highlight-to':'rgba(167,243,208,.86)','--kr-highlight-ring':'rgba(16,185,129,.24)','--kr-highlight-hover':'rgba(16,185,129,.16)','--kr-highlight-text':'#064e3b'},
    {'--kr-highlight-from':'rgba(96,165,250,.30)','--kr-highlight-to':'rgba(191,219,254,.88)','--kr-highlight-ring':'rgba(59,130,246,.24)','--kr-highlight-hover':'rgba(59,130,246,.16)','--kr-highlight-text':'#172554'},
    {'--kr-highlight-from':'rgba(244,114,182,.30)','--kr-highlight-to':'rgba(251,207,232,.88)','--kr-highlight-ring':'rgba(236,72,153,.23)','--kr-highlight-hover':'rgba(236,72,153,.15)','--kr-highlight-text':'#831843'},
    {'--kr-highlight-from':'rgba(167,139,250,.31)','--kr-highlight-to':'rgba(221,214,254,.88)','--kr-highlight-ring':'rgba(139,92,246,.24)','--kr-highlight-hover':'rgba(139,92,246,.16)','--kr-highlight-text':'#3b0764'},
    {'--kr-highlight-from':'rgba(45,212,191,.30)','--kr-highlight-to':'rgba(153,246,228,.86)','--kr-highlight-ring':'rgba(20,184,166,.24)','--kr-highlight-hover':'rgba(20,184,166,.15)','--kr-highlight-text':'#134e4a'}
  ];

  function recallQuestionBankId(){return String(question?.sourceCollectionId||question?.sourceReleaseId||question?.sourceBankId||question?.bankId||'')}
  function isRecallReadonly(){return document.body.classList.contains('kr-readonly')||recallSession?.permissions?.canWrite===false}
  function isTeacherDraftPreview(){return document.body?.dataset?.recallPreview==='teacher-draft'}
  function notifyRecallReadonly(){
    notifyRecallLimit(recallSession?.versionState==='mismatch'?'当前显示的是旧版本回忆图，只能查看；可重置后按新题继续。':'当前账号只能查看深度回忆。');
  }
  function setRecallReadonly(enabled){
    document.body.classList.toggle('kr-readonly',!!enabled);
    const app=$('krApp');if(app)app.dataset.readonly=enabled?'true':'false';
    const status=$('authStatus');
    if(enabled&&status){
      const label=status.querySelector?.('.auth-status-label');
      if(label)label.textContent='访客只读';else status.textContent='访客只读';
      status.setAttribute('aria-label','访客只读模式');
    }
    ['krResetBtn','krRevealKeywordsBtn'].forEach(id=>{const el=$(id);if(el){const allowVersionReset=id==='krResetBtn'&&recallSession?.versionState==='mismatch'&&recallSession?.permissions?.canReset;const disabled=!!enabled&&!allowVersionReset;el.classList.toggle('kr-readonly-control',disabled);el.setAttribute('aria-disabled',String(disabled));el.disabled=disabled}});
  }
  function installRecallReadonlyGuard(){
    if(document.body.dataset.krReadonlyGuardBound)return;
    document.body.dataset.krReadonlyGuardBound='1';
    document.addEventListener('click',event=>{
      if(!isRecallReadonly())return;
      const target=event.target.closest&&event.target.closest('.kr-keyword-token,[data-choice-index],#krMoreChoicesBtn,#krCustomSaveBtn,#krResetBtn,#krRevealKeywordsBtn');
      if(!target)return;
      const allowVersionReset=target.id==='krResetBtn'&&recallSession?.versionState==='mismatch'&&recallSession?.permissions?.canReset;
      if(allowVersionReset)return;
      event.preventDefault();event.stopPropagation();event.stopImmediatePropagation();notifyRecallReadonly();
    },true);
  }
  function enforceRecallPermission(){
    const api=window.KGRolePermissions;
    if(!api||typeof api.canUseDeepRecallQuestion!=='function')return true;
    api.applyTheme&&api.applyTheme();
    const status=$('authStatus');if(status&&api.renderStatus)api.renderStatus(status);
    const user=typeof api.currentUser==='function'?api.currentUser():null;
    if(!user){setRecallReadonly(true);installRecallReadonlyGuard();return true}
    if(recallSession?.permissions){setRecallReadonly(!recallSession.permissions.canWrite);installRecallReadonlyGuard();return !!recallSession.permissions.canRead}
    setRecallReadonly(false);
    if(api.canUseDeepRecallQuestion(question,recallQuestionBankId()))return true;
    api.renderPermissionDenied(document.querySelector('.kr-app')||document.body, api.questionDeniedMessage?.()||'当前角色无权进入这道题的深度回忆。');
    return false;
  }
  function escapeHTML(s){return String(s??'').replace(/[&<>'"]/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;',"'":'&#39;','"':'&quot;'}[c]))}
  function languageMode(){return window.KGFreeModeLanguage?.mode?.()||'zh'}
  function englishLine(display,className='kr-bilingual-en'){
    return languageMode()==='bilingual'&&display?.hasEnglish?`<span class="${escapeHTML(className)}">${escapeHTML(display.en)}</span>`:'';
  }
  function recallQuestionDisplay(){return window.KGFreeModeLanguage?.recallQuestionView?.(question,languageMode())||null}
  function recallNodeDisplay(id,data,node=null){
    const view=window.KGFreeModeLanguage?.recallNodeView?.(id,data,languageMode(),nextId=>nodeData(nextId)||fallbackNode(nextId))||null;
    if(view&&node?.custom&&!data?.titleEn&&!data?.en?.title)view.title={zh:view.title.zh,en:'',hasEnglish:false};
    return view;
  }
  function recallNodeTitleDisplay(id,data,node=null){
    const zh=String(data?.title||node?.title||id||'知识点').trim();
    const en=node?.custom?'':String(data?.titleEn||data?.en?.title||data?.translation?.en?.title||'').trim();
    return {zh,en,hasEnglish:Boolean(en)};
  }
  function notifyRecallLimit(message){
    const sub=window.KGSubscription;
    if(sub&&typeof sub.showSubscriptionMessage==='function'){sub.showSubscriptionMessage(message);return}
    let toast=$('krLimitToast');
    if(!toast){toast=document.createElement('div');toast.id='krLimitToast';toast.className='kr-limit-toast';document.body.appendChild(toast)}
    toast.textContent=String(message||'');toast.classList.add('show');
    clearTimeout(notifyRecallLimit.timer);notifyRecallLimit.timer=setTimeout(()=>toast.classList.remove('show'),3000);
  }
  function requireRecallNodeLimit(addCount=1){
    const limit=recallSession?.nodeLimit;
    if(limit==null)return true;
    if(state.nodes.length+Math.max(0,Number(addCount)||0)<=Number(limit))return true;
    notifyRecallLimit(`当前套餐每题最多保存 ${Number(limit)} 个回忆节点。`);return false;
  }
  function renderSaveState(adapterState=null){
    const status=$('krSaveStatus'),text=$('krSaveStatusText'),retry=$('krSaveRetryBtn');if(!status||!text)return;
    const value=adapterState||recallAdapter?.getState?.()||{saveState:'idle'};
    const labels={idle:'已载入',loading:'正在载入',saving:'正在保存',saved:'已保存',failed:'尚未保存',conflict:'保存冲突'};
    status.dataset.state=value.saveState||'idle';text.textContent=labels[value.saveState]||'已载入';
    if(retry)retry.hidden=!['failed'].includes(value.saveState);
  }
  function applyRandomHighlight(){
    const palette=HIGHLIGHT_PALETTES[Math.floor(Math.random()*HIGHLIGHT_PALETTES.length)]||HIGHLIGHT_PALETTES[0];
    Object.entries(palette).forEach(([name,value])=>document.documentElement.style.setProperty(name,value));
  }
  function savedTheme(){
    try{
      const raw=Store.readString?Store.readString(THEME_KEY,''):localStorage.getItem(THEME_KEY);
      const migrated=(Store.readString?Store.readString(THEME_MIGRATION_KEY,''):localStorage.getItem(THEME_MIGRATION_KEY))==='1';
      if(!migrated && (!raw || raw==='parchment')){
        if(Store.writeString){Store.writeString(THEME_MIGRATION_KEY,'1');Store.writeString(THEME_KEY,'platform')}
        else{localStorage.setItem(THEME_MIGRATION_KEY,'1');localStorage.setItem(THEME_KEY,'platform')}
        return 'platform';
      }
      return THEMES.has(raw)?raw:'platform';
    }catch(e){return 'platform'}
  }
  function syncThemeControls(theme){
    const select=$('krThemeSelect');if(select&&select.value!==theme)select.value=theme;
    document.querySelectorAll('.kr-scene-option[data-kr-theme]').forEach(button=>{
      const active=String(button.dataset.krTheme||'')===theme;
      button.classList.toggle('is-active',active);
      button.setAttribute('aria-checked',String(active));
    });
  }
  function applyTheme(theme){
    const next=THEMES.has(theme)?theme:'platform';
    const scene=$('krViewport'),app=$('krApp');
    if(scene)scene.dataset.theme=next;
    if(app)app.dataset.theme=next;
    document.body.dataset.krTheme=next;
    syncThemeControls(next);
    try{if(Store.writeString)Store.writeString(THEME_KEY,next);else localStorage.setItem(THEME_KEY,next)}catch(e){}
    window.dispatchEvent(new CustomEvent('kg:deep-recall-theme-change',{detail:{theme:next}}));
  }
  function bindThemeSelect(){
    const select=$('krThemeSelect'),menu=$('krSceneMenu');
    applyTheme(savedTheme());
    if(select)select.addEventListener('change',()=>applyTheme(select.value));
    document.querySelectorAll('.kr-scene-option[data-kr-theme]').forEach(button=>button.addEventListener('click',event=>{
      event.preventDefault();event.stopPropagation();
      applyTheme(button.dataset.krTheme);
      if(menu)menu.open=false;
      button.blur();
    }));
    if(!menu)return;
    let closeTimer=0;
    const cancelClose=()=>{if(closeTimer){clearTimeout(closeTimer);closeTimer=0}};
    const openMenu=()=>{cancelClose();menu.open=true};
    const closeMenuSoon=()=>{cancelClose();closeTimer=setTimeout(()=>{if(!menu.matches(':hover')&&!menu.contains(document.activeElement))menu.open=false},120)};
    if(window.matchMedia?.('(hover: hover)').matches){
      menu.addEventListener('pointerenter',openMenu);
      menu.addEventListener('pointerleave',closeMenuSoon);
    }
    menu.addEventListener('focusin',openMenu);
    menu.addEventListener('focusout',closeMenuSoon);
    document.addEventListener('keydown',event=>{if(event.key==='Escape'&&menu.open){menu.open=false;menu.querySelector('summary')?.focus()}});
  }
  function uid(prefix='kr'){return prefix+'-'+Math.random().toString(36).slice(2,9)+'-'+Date.now().toString(36)}
  function firstChar(text){const s=String(text||'?').trim();return Array.from(s)[0]||'?'}
  function cloneValue(value){try{return JSON.parse(JSON.stringify(value))}catch(error){return value}}
  function teacherDraftPreviewQuestion(params,input,route){
    if(String(params.get('preview')||'')!=='teacher-draft')return null;
    let payload=RecallStorage.readCurrent?.()||null;
    if(!payload){try{payload=window.opener?.KGRecallStorage?.readCurrent?.()||null}catch(error){}}
    if(!payload?.question||String(payload.previewMode||'')!=='teacher-draft')return null;
    const requestedToken=String(params.get('previewToken')||'');
    if(requestedToken&&String(payload.previewToken||'')!==requestedToken)return null;
    const payloadBank=String(payload.sourceBankId||payload.question?.sourceBankId||'');
    const payloadQuestion=String(payload.sourceQuestionId||payload.question?.sourceQuestionId||payload.question?.id||'');
    if(input.bankId&&payloadBank&&String(input.bankId)!==payloadBank)return null;
    if(input.questionId&&payloadQuestion&&String(input.questionId)!==payloadQuestion)return null;
    const q=cloneValue(payload.question);
    q.sourceBankId=payloadBank||q.sourceBankId||'';
    q.sourceQuestionId=payloadQuestion||String(q.id||'');
    q.sourceCollectionId=q.sourceCollectionId||q.sourceBankId||'';
    if(!Array.isArray(q.stemParts)&&q.stem)q.stemParts=[{text:q.stem}];
    const context=window.KGLearningRouteContext?.normalize?.({paperId:q.sourcePaperId,releaseId:q.sourceReleaseId,questionId:q.sourceQuestionId,bankId:q.sourceBankId,mode:'deep_recall',source:'teacher-draft-preview',returnUrl:route.returnUrl||'question-bank.html'})||{};
    window.KGLearningProgress?.activate?.(context,{mode:'deep_recall',clearTransient:false});
    document.body.dataset.recallPreview='teacher-draft';document.body.dataset.recallPreviewToken=String(payload.previewToken||requestedToken||'');
    return q;
  }
  function loadQuestion(){
    try{
      const route=window.KGLearningRouteContext?.parse?.({mode:'deep_recall',returnUrl:'index.html'})||{};
      const params=new URLSearchParams(location.search||'');
      const input={
        collectionId:params.get('collectionId')||'',
        paperId:route.paperId||'',
        releaseId:route.releaseId||'',
        bankId:route.bankId||'',
        questionId:route.questionId||''
      };
      const draftPreview=teacherDraftPreviewQuestion(params,input,route);
      if(draftPreview)return draftPreview;
      const source=window.KGRecallQuestionSource;
      let found=input.questionId&&source?.findPublished?.(input);
      if(!found){
        const payload=RecallStorage.readCurrent?.()||null;
        if(payload?.sourceQuestionId){
          found=source?.findPublished?.({
            collectionId:payload.sourceCollectionId||payload.question?.sourceCollectionId||'',
            paperId:payload.sourcePaperId||payload.question?.sourcePaperId||'',
            releaseId:payload.sourceReleaseId||payload.question?.sourceReleaseId||'',
            bankId:payload.sourceBankId||payload.question?.sourceBankId||'',
            questionId:payload.sourceQuestionId||payload.question?.id||''
          });
        }
      }
      if(!found){
        const first=source?.list?.()?.[0]?.questions?.[0];
        if(first)found=source.findPublished({releaseId:first.releaseId,paperId:first.paperId,bankId:first.bankId,questionId:first.id});
      }
      if(found?.question){
        const q=cloneValue(found.question);
        q.sourceCollectionId=found.collection?.id||found.bank?.id||q.sourceCollectionId||'';
        q.sourcePaperId=found.collection?.paperId||q.sourcePaperId||'';
        q.sourceReleaseId=found.collection?.releaseId||q.sourceReleaseId||'';
        q.sourceBankId=found.item?.bankId||q.sourceBankId||'';
        q.sourceQuestionId=String(q.id||q.sourceQuestionId||'');
        if(!Array.isArray(q.stemParts)&&q.stem)q.stemParts=[{text:q.stem}];
        const context=window.KGLearningRouteContext?.normalize?.({paperId:q.sourcePaperId,releaseId:q.sourceReleaseId,questionId:q.sourceQuestionId,bankId:q.sourceBankId,mode:'deep_recall',returnUrl:route.returnUrl||'index.html'})||{};
        window.KGLearningProgress?.activate?.(context,{mode:'deep_recall',clearTransient:false});
        window.KGLearningRouteContext?.replace?.(context,{target:'knowledge-recall.html'});
        return q;
      }
      return cloneValue(source?.emptyQuestion?.()||fallbackQuestion);
    }catch(e){return cloneValue(fallbackQuestion)}
  }
  function requestedQuestionId(){
    const route=window.KGLearningRouteContext?.parse?.({mode:'deep_recall',returnUrl:'index.html'})||{};
    const params=new URLSearchParams(location.search||'');
    return String(route.questionId||params.get('questionId')||'').trim();
  }
  function sessionQuestion(payload){
    const next=cloneValue(payload||fallbackQuestion);
    next.sourceQuestionId=String(next.id||next.sourceQuestionId||'');
    next.sourceBankId=String(next.bankId||next.sourceBankId||'');
    next.sourceCollectionId=String(next.sourceCollectionId||next.sourceBankId||'');
    if(!Array.isArray(next.stemParts)&&next.stem)next.stemParts=[{text:next.stem}];
    return next;
  }
  function applyServerSession(session,{history=false}={}){
    recallSession=cloneValue(session);
    if(history){
      recallSession.permissions={...(recallSession.permissions||{}),canWrite:false,canReveal:false,readOnly:true};
      question=sessionQuestion(session.historyQuestion);
    }else question=sessionQuestion(session.currentQuestion);
    const library=history?session.library:(session.currentLibrary||session.library);
    window.KGRecallAssociationLibrary?.setSessionLibrary?.(library?.payload||{},library?.contentHash||'');
    resetAssociationRuntime();
    rootMap=buildRootMap(question);keywordMatchers=buildKeywordMatchers(rootMap);keywordsRevealed=false;
    loadProgress(session.progress||{});
    // 切换题目后：关闭解析面板并复位选项瞬时状态（选中/常绿已由 loadProgress 恢复）。
    clearTimeout(krOptionClickTimer);clearTimeout(krOptionFlashTimer);
    krAnalysisOpen=false;krAnalysisOffset={x:0,y:0};setKrAnalysisButtonState(false);if(analysisLayer)analysisLayer.innerHTML='';
    RecallStorage.markExplored?.(question,recallQuestionBankId(),Boolean(state.nodes.length||state.activeKeywords.length));
    setRecallReadonly(!recallSession.permissions?.canWrite);
    const reveal=$('krRevealKeywordsBtn');if(reveal){reveal.disabled=!recallSession.permissions?.canReveal;reveal.textContent='揭示关键词'}
  }
  function chooseVersion(session){
    const modal=$('krVersionChoice'),historyButton=$('krViewHistoryBtn'),resetButton=$('krResetToCurrentBtn');
    if(!modal||!historyButton||!resetButton)return Promise.resolve('history');
    modal.hidden=false;
    return new Promise(resolve=>{
      historyButton.onclick=()=>{modal.hidden=true;resolve('history')};
      resetButton.onclick=async()=>{
        if(!confirm('确定清除旧图，并按当前题目版本重新开始吗？此操作不会修改正式联想库。'))return;
        resetButton.disabled=true;
        try{await recallAdapter.resetToCurrent();modal.hidden=true;resolve('current')}
        catch(error){notifyRecallLimit(error?.message||'重置失败，请稍后重试。');resetButton.disabled=false}
      };
    });
  }
  async function loadDatabaseSession(questionId=''){
    let id=String(questionId||requestedQuestionId()).trim();
    if(!id){
      try{await window.KGQuestionCatalogAdapter?.ready}catch(error){}
      const candidate=loadQuestion();id=String(candidate?.id||candidate?.sourceQuestionId||'').trim();
    }
    if(!id||id==='unavailable')throw new Error('当前没有可用于深度回忆的已发布题目。');
    recallAdapter=window.KGDeepRecallServerAdapter?.create?.({questionId:id});
    if(!recallAdapter)throw new Error('深度回忆服务器适配器加载失败。');
    recallAdapter.subscribe(renderSaveState);renderSaveState({saveState:'loading'});
    const session=await recallAdapter.loadSession();
    const choice=session.versionState==='mismatch'?await chooseVersion(session):'current';
    const latest=recallAdapter.getState().session||session;
    applyServerSession(latest,{history:choice==='history'});
    renderSaveState(recallAdapter.getState());
    return latest;
  }
  function progressPayload(){
    return {nodes:state.nodes,edges:state.edges,customNodes:state.customNodes,activeKeywords:state.activeKeywords,choiceOffsets:state.choiceOffsets,metrics:state.metrics,graphSchemaVersion:3,transform:{x:Number(state.transform.x)||0,y:Number(state.transform.y)||0,scale:Math.max(MIN_ZOOM,Math.min(MAX_ZOOM,Number(state.transform.scale)||1))},optionState:{selected:String(krOptionState.selected||''),persistent:String(krOptionState.persistent||'')}};
  }
  async function writeProgressNow(){
    if(isRecallReadonly()||isTeacherDraftPreview()||!recallAdapter)return false;
    if(progressSaveTimer){clearTimeout(progressSaveTimer);progressSaveTimer=0}
    try{
      const saved=Boolean(await recallAdapter.saveGraph(progressPayload()));
      if(saved){const track=(globalThis.KGFeatureAnalytics&&globalThis.KGFeatureAnalytics.track)||function(){};track('recall','key_action','recall_saved');track('recall','outcome','recall_saved');}
      return saved
    }
    catch(error){
      notifyRecallLimit(Number(error?.status)===409?'进度已在其他页面更新，请重新载入后继续。':'进度尚未保存，请检查网络后重试。');
      return false;
    }
  }
  function saveProgress(){
    if(isRecallReadonly()||isTeacherDraftPreview())return;
    if(progressSaveTimer)clearTimeout(progressSaveTimer);
    progressSaveTimer=setTimeout(()=>{progressSaveTimer=0;void writeProgressNow()},420);
  }
  function flushProgress(){return writeProgressNow()}
  function cancelProgressSave(){if(progressSaveTimer){clearTimeout(progressSaveTimer);progressSaveTimer=0}}
  function loadProgress(raw=null){
    recallViewportRestored=false;if(isTeacherDraftPreview())return false;
    try{
      raw=raw||recallAdapter?.getState?.().graph||null;
      if(raw&&Array.isArray(raw.nodes)&&Array.isArray(raw.edges)){
        state.nodes=raw.nodes;state.edges=raw.edges;state.customNodes=raw.customNodes&&typeof raw.customNodes==='object'?raw.customNodes:{};state.activeKeywords=Array.isArray(raw.activeKeywords)?raw.activeKeywords:[];state.choiceOffsets=raw.choiceOffsets&&typeof raw.choiceOffsets==='object'?raw.choiceOffsets:{};state.metrics=raw.metrics&&typeof raw.metrics==='object'?{keywordClicks:Number(raw.metrics.keywordClicks)||0,choiceClicks:Number(raw.metrics.choiceClicks)||0,nodeOpens:Number(raw.metrics.nodeOpens)||0,sessionStartedAt:Date.now()}:{keywordClicks:0,choiceClicks:0,nodeOpens:0,sessionStartedAt:Date.now()};
        if(raw.optionState&&typeof raw.optionState==='object')krOptionState={selected:String(raw.optionState.selected||''),persistent:String(raw.optionState.persistent||'')};
        // P4.5.32 进入页面不再恢复上次保存的画布平移/缩放：跨窗口尺寸或上次聚焦后视图会偏在一边，
        // 体验差；改为每次进入都以题目卡片(world 0,0)重新居中，会话内仍可自由拖动并保存。
        if(raw.transform&&Number.isFinite(Number(raw.transform.scale))){state.transform.scale=Math.max(MIN_ZOOM,Math.min(MAX_ZOOM,Number(raw.transform.scale)))}
        normalizeGraph();
        return true;
      }
    }catch(e){}
    return false;
  }
  async function resetProgress(){
    const versionReset=recallSession?.versionState==='mismatch'&&recallSession?.permissions?.canReset;
    if(isRecallReadonly()&&!versionReset){notifyRecallReadonly();return}
    if(!confirm('确定清除这道题已回忆的全部知识点吗？'))return;
    cancelProgressSave();if(!recallAdapter)return;
    try{
      await recallAdapter.resetToCurrent();
      applyServerSession(recallAdapter.getState().session||recallSession,{history:false});
      destroyingNodeIds.clear();state.activeNodeId=null;state.lastNewEdgeId='';state.lastNewNodeId='';hideGuide();renderAll();centerOn(0,0,true);
    }catch(error){notifyRecallLimit(error?.message||'重置失败，请稍后重试。')}
  }
  function isTextEditingTarget(target){
    return Boolean(target?.closest?.('input,textarea,select,[contenteditable="true"],[contenteditable=""]'));
  }
  function rootKeyForNode(node){
    if(node?.rootKey)return String(node.rootKey);
    const dataId=String(node?.dataId||'');
    const match=Object.entries(rootMap||{}).find(([key,root])=>String(root?.nodeId||key)===dataId);
    return match?String(match[0]):'';
  }
  function finalizeNodeDeletion(instanceId,token=questionSessionToken){
    if(token!==questionSessionToken)return false;
    const id=String(instanceId||'');
    destroyingNodeIds.delete(id);
    const result=GraphModel.removeNode?.({nodes:state.nodes,edges:state.edges},id);
    const node=result?.removedNode||null;
    if(!node)return false;
    const rootKey=rootKeyForNode(node);
    state.nodes=result.nodes;state.edges=result.edges;
    if(node.custom&&!state.nodes.some(item=>String(item.dataId)===String(node.dataId))){
      delete state.customNodes[node.dataId];
      delete state.choiceOffsets[node.dataId];
    }
    if(rootKey&&!state.nodes.some(item=>rootKeyForNode(item)===rootKey)){
      state.activeKeywords=state.activeKeywords.filter(key=>String(key)!==rootKey);
    }
    state.activeNodeId=null;state.lastNewEdgeId='';state.lastNewNodeId='';
    hideGuide();saveProgress();renderAll();
    return true;
  }
  function deleteNode(instanceId){
    if(isRecallReadonly()){notifyRecallReadonly();return false}
    const id=String(instanceId||'');
    if(!id||destroyingNodeIds.has(id)||!state.nodes.some(item=>String(item.instanceId)===id))return false;
    const token=questionSessionToken;
    destroyingNodeIds.add(id);hideGuide();syncActiveNodeClass();
    const wrap=nodeLayer.querySelector(`[data-instance-id="${cssAttr(id)}"]`);
    const reduced=window.matchMedia?.('(prefers-reduced-motion: reduce)')?.matches;
    if(!wrap||reduced)return finalizeNodeDeletion(id,token);
    wrap.classList.add('is-destroying');wrap.setAttribute('aria-hidden','true');
    setTimeout(()=>finalizeNodeDeletion(id,token),360);
    return true;
  }
  function rootConfig(key){return rootMap[key]||null}
  function keywordProfile(value){return window.KGQuestionKeywordRuntime?.profile?.(value)||{isCore:!!value?.isCore||String(value?.keywordLevel).toLowerCase()==='core',keywordLevel:(!!value?.isCore||String(value?.keywordLevel).toLowerCase()==='core')?'core':'normal',solutionRole:String(value?.solutionRole||'context'),coreReason:String(value?.coreReason||''),levelLabel:(!!value?.isCore||String(value?.keywordLevel).toLowerCase()==='core')?'核心关键词':'普通关键词',roleLabel:String(value?.solutionRole||'context'),priority:(!!value?.isCore||String(value?.keywordLevel).toLowerCase()==='core')?100:10};}
  function currentSubject(){return String(question?.subject||question?.metadata?.subjectId||question?.subjectId||'PMP')}
  function resetAssociationRuntime(){associationRuntime={subject:'',library:null,nodeCache:new Map(),resolveCache:new Map()}}
  function associationLibrary(){
    const api=window.KGRecallAssociationLibrary;if(!api)return null;
    const subject=currentSubject();
    if(associationRuntime.subject!==subject||!associationRuntime.library){
      associationRuntime={subject,library:api.read?.(subject)||null,nodeCache:new Map(),resolveCache:new Map()};
    }
    return associationRuntime.library;
  }
  function associationNode(id){
    const api=window.KGRecallAssociationLibrary,library=associationLibrary();if(!api||!library)return null;
    const offset=Number(state.choiceOffsets?.[id]||0),key=String(id)+'\u0000'+offset;
    if(associationRuntime.nodeCache.has(key))return associationRuntime.nodeCache.get(key);
    const result=api.choices?.(library,id,{limit:4,offset});
    if(!result?.node){associationRuntime.nodeCache.set(key,null);return null}
    const value={id:result.node.id,title:result.node.title,titleEn:result.node.titleEn||'',
      prompt:result.node.prompt||`看到“${result.node.title}”，你还能联想到哪些知识点？`,promptEn:result.node.promptEn||'',
      hint:result.node.hint||'',hintEn:result.node.hintEn||'',choices:result.choices||[],
      totalChoices:result.total||0,nextOffset:result.nextOffset||0,hasMore:!!result.hasMore};
    associationRuntime.nodeCache.set(key,value);return value;
  }
  function resolveAssociationNode(value){
    const api=window.KGRecallAssociationLibrary,library=associationLibrary();if(!api||!library)return null;
    const key=String(value||'').trim();if(!key)return null;
    if(associationRuntime.resolveCache.has(key))return associationRuntime.resolveCache.get(key);
    const result=api.resolve?.(library,key)||null;associationRuntime.resolveCache.set(key,result);return result;
  }
  function ancestorDataIdSet(node){
    return DeepRecallFlow.ancestorDataIds?.(state.nodes,node?.instanceId)||new Set([String(node?.dataId||'')]);
  }
  function guideChoicePage(node,data){
    const blocked=ancestorDataIdSet(node),seen=new Set();
    let allChoices=[];
    const api=window.KGRecallAssociationLibrary;
    if(api&&!node?.custom){
      const library=associationLibrary();
      const result=library?api.choices?.(library,node?.dataId,{limit:1000,offset:0}):null;
      if(result?.node&&Array.isArray(result.choices))allChoices=result.choices;
    }
    if(!allChoices.length)allChoices=Array.isArray(data?.choices)?data.choices:[];
    const filtered=allChoices.filter(choice=>{
      const next=String(choice?.next||'');
      if(!next||blocked.has(next)||seen.has(next))return false;
      seen.add(next);return true;
    });
    const total=filtered.length,take=Math.min(4,total);
    const rawOffset=Number(state.choiceOffsets?.[node?.dataId]||0);
    const offset=total?((rawOffset%total)+total)%total:0;
    const choices=[];
    for(let i=0;i<take;i++)choices.push(filtered[(offset+i)%total]);
    return {
      choices,total,offset,
      nextOffset:total?((offset+Math.max(1,take))%total):0,
      canRotate:total>take&&take>0
    };
  }
  function nodeData(id){return state.customNodes[id]||associationNode(id)||DATA.nodes?.[id]||null}
  function buildRootMap(q){
    const map={};
    (q.stemParts||[]).forEach(part=>{
      const key=String(part?.clue||'');
      const legacy=key&&DATA.roots?.[key];
      if(legacy)map[key]={...legacy,matchTexts:Array.isArray(legacy.matchTexts)?[...legacy.matchTexts]:[legacy.title].filter(Boolean)};
    });
    (q.clues||[]).forEach(clue=>{
      const first=(clue.conceptIds||[]).map(id=>(q.concepts||[]).find(c=>String(c.id)===String(id))).find(Boolean);
      const library=window.KGRecallAssociationLibrary;
      const resolved=library?.resolve?.(library.read(currentSubject()),clue.recallNodeId||clue.text);
      map[clue.id]={title:clue.text,nodeId:resolved?.id||clue.recallNodeId||first?.id||clue.id,matchTexts:[clue.text],keywordProfile:keywordProfile(clue)};
    });
    (q.concepts||[]).forEach(c=>{
      if(c.title&&!Object.values(map).some(r=>String(r.title)===String(c.title))){
        map[c.id]={title:c.title,nodeId:c.recallNodeId||c.id,matchTexts:[c.title,...String(c.keywords||'').split(/[,，、;；|]/).map(x=>x.trim()).filter(Boolean).slice(0,2)],keywordProfile:keywordProfile(c)};
      }
    });
    return map;
  }
  function fallbackNode(id){
    const concept=(question.concepts||[]).find(c=>String(c.id)===String(id));
    if(concept){
      const choices=(question.concepts||[]).filter(c=>String(c.id)!==String(id)).slice(0,4).map(c=>({text:c.title,next:c.id}));
      return {title:concept.title,prompt:`围绕“${concept.title}”，你还能回忆到哪个相关知识点？`,hint:concept.summary||concept.notes||'',choices};
    }
    const clue=(question.clues||[]).find(c=>String(c.id)===String(id));
    if(clue){
      const choices=(clue.conceptIds||[]).map(cid=>{
        const c=(question.concepts||[]).find(x=>String(x.id)===String(cid));return c?{text:c.title,next:c.id}:null;
      }).filter(Boolean);
      return {title:clue.text,prompt:`看到“${clue.text}”，你能回忆到哪个知识点？`,hint:clue.explain||'',choices};
    }
    return {title:String(id||'知识点'),prompt:'这个节点还没有预设分支，你可以添加自己的回忆节点。',choices:[]};
  }
  function getNodeData(id){return nodeData(id)||fallbackNode(id)}
  function normalizeGraph(){
    const normalized=GraphModel.normalizeGraph?.({nodes:state.nodes,edges:state.edges,activeNodeId:state.activeNodeId},{
      titleResolver:node=>node?.title||getNodeData(node?.dataId).title||''
    });
    if(!normalized)return;
    state.nodes=normalized.nodes;state.edges=normalized.edges;state.activeNodeId=normalized.activeNodeId;
  }
  function isKeywordActive(key){return (state.activeKeywords||[]).some(k=>String(k)===String(key))}
  function markKeywordActive(key){if(!isKeywordActive(key))state.activeKeywords.push(String(key))}
  function renderQuestion(){
    const view=recallQuestionDisplay();
    // P4.5.32：题目卡顶部显示本试卷内的题目序号（学习端按题库目录顺序；
    // 教师预览无目录上下文，回退 payload.questionOrder）。
    const context=questionContext(),order=question.questionOrder;
    const index=context.index>=0?context.index:Number.isFinite(Number(order?.index))?Math.max(0,Number(order.index)):-1;
    const total=context.total||Number(order?.total)||0;
    const questionIndex=total&&index>=0
      ?`<span class="kr-question-order-badge" title="本试卷第 ${index+1} 题，共 ${total} 题"><b>${index+1}</b><small>/${total}</small></span>`
      :'';
    const stem=(question.stemParts||[]).map((p,i)=>{
      const text=escapeHTML(p.text||'');
      if(p.clue&&rootConfig(p.clue))return `<button type="button" class="kr-keyword-token${keywordsRevealed?'':' undiscovered'}${isKeywordActive(p.clue)?' active':''}" data-keyword-id="${escapeHTML(p.clue)}" data-keyword-index="${i}">${text}</button>`;
      return wrapKnownKeywords(text);
    }).join('');
    // P4.5.30：选项结构与多题画布一致（qw-card-options + qw-card-option-key 字母按钮），
    // 样式单一来源 question-workspace.css；kr-option 类保留在 <li> 上作测试/兼容钩子。
    const optionRow=(option,index,content)=>{
      const key=String(option?.id||String.fromCharCode(65+index));
      const selected=String(krOptionState.selected||'')===key,persistent=String(krOptionState.persistent||'')===key;
      return `<li class="qw-card-option kr-option"><button type="button" class="qw-card-option-key${selected?' is-answer-selected':''}${persistent?' is-correct-active':''}" data-qw-option-key="${escapeHTML(key)}" title="选择 ${escapeHTML(key)}" aria-pressed="${selected?'true':'false'}">${escapeHTML(key)}</button><span class="qw-card-option-copy">${content}</span></li>`;
    };
    const viewOptions=view?.options||[];
    const rows=viewOptions.length
      ?viewOptions.map((o,i)=>optionRow(o,i,`${wrapKnownKeywords(escapeHTML(o.display?.zh||''),{inline:true})}${englishLine(o.display)}`))
      :(question.options||[]).map((o,i)=>optionRow(o,i,wrapKnownKeywords(escapeHTML(o.text||''),{inline:true})));
    const stemEn=view?.stem||{hasEnglish:false};
    questionCard.innerHTML=`${questionIndex}<div class="kr-stem">${stem}${englishLine(stemEn)}</div>${rows.length?`<ol class="qw-card-options">${rows.join('')}</ol>`:''}<p class="kr-option-feedback lp-visually-hidden" data-kr-option-feedback aria-live="polite"></p><div class="qw-card-actions qw-card-learning-actions"><button type="button" class="qw-card-action-square qw-card-icon-action${krAnalysisOpen?' is-active':''}" data-qw-action="analysis" title="显示或关闭本题解析" aria-label="显示或关闭本题解析" aria-pressed="${krAnalysisOpen?'true':'false'}">${KR_ANALYSIS_ICON}</button></div>`;
    if(krAnalysisOpen)requestAnimationFrame(positionKrAnalysisPanel);
  }
  // P4.5.32：题目卡入场动画——从左上滑入并缓停在画布中心（初始载入与切题时触发）。
  function playQuestionCardEntry(){
    questionCard.classList.remove('kr-card-enter');
    void questionCard.offsetWidth;
    questionCard.classList.add('kr-card-enter');
  }
  function recallOptionIsCorrect(optionId){
    const id=String(optionId||'');
    const option=(question.options||[]).find(item=>String(item?.id||'')===id);
    return !!option?.correct||id===String(question.correctAnswer||'');
  }
  function krOptionKeyButton(key){
    return [...questionCard.querySelectorAll('[data-qw-option-key]')].find(item=>String(item.dataset.qwOptionKey||'')===String(key))||null;
  }
  function flashKrOption(key,correct){
    const button=krOptionKeyButton(key);if(!button)return false;
    const className=correct?'is-correct-flash':'is-wrong-flash';
    clearTimeout(krOptionFlashTimer);
    questionCard.querySelectorAll('.is-correct-flash,.is-wrong-flash').forEach(item=>item.classList.remove('is-correct-flash','is-wrong-flash'));
    void button.offsetWidth;button.classList.add(className);
    krOptionFlashTimer=setTimeout(()=>button.classList.remove(className),correct?KR_OPTION_CORRECT_FLASH:KR_OPTION_WRONG_FLASH);
    return true;
  }
  function judgeKrOption(key){
    if(isRecallReadonly()){notifyRecallReadonly();return}
    krOptionState.selected=String(key||'');
    questionCard.querySelectorAll('[data-qw-option-key]').forEach(button=>{
      const on=String(button.dataset.qwOptionKey||'')===krOptionState.selected;
      button.classList.toggle('is-answer-selected',on);
      button.setAttribute('aria-pressed',String(on));
    });
    const correct=recallOptionIsCorrect(krOptionState.selected);
    flashKrOption(krOptionState.selected,correct);
    const feedback=questionCard.querySelector('[data-kr-option-feedback]');
    if(feedback)feedback.textContent=correct?'回答正确。':'回答错误。';
    saveProgress();
  }
  function toggleKrPersistentAnswer(key){
    if(isRecallReadonly()){notifyRecallReadonly();return}
    key=String(key||'');
    if(!recallOptionIsCorrect(key)){flashKrOption(key,false);notifyRecallLimit('双击仅用于把正确选项设为常绿标记。');return}
    const active=String(krOptionState.persistent||'')===key;
    krOptionState.persistent=active?'':key;
    questionCard.querySelectorAll('[data-qw-option-key]').forEach(button=>{
      button.classList.toggle('is-correct-active',!active&&String(button.dataset.qwOptionKey||'')===key);
    });
    saveProgress();
  }
  function buildKeywordMatchers(map){
    const unique=new Set(),matchers=[];
    Object.entries(map||{}).forEach(([key,root])=>{
      (root.matchTexts||[root.title]).forEach(value=>{
        const text=String(value||'').trim();
        if(text.length<2)return;
        const token=String(key)+'\u0000'+text;
        if(unique.has(token))return;
        unique.add(token);
        const escaped=escapeHTML(text);
        const safe=escaped.replace(/[.*+?^${}()|[\]\\]/g,'\\$&');
        if(safe)matchers.push({key:String(key),text,regex:new RegExp(safe,'g'),profile:root.keywordProfile||keywordProfile(root)});
      });
    });
    return matchers.sort((a,b)=>(Number(b.profile?.priority)||0)-(Number(a.profile?.priority)||0)||b.text.length-a.text.length);
  }
  function wrapKnownKeywords(escapedText,{inline=false}={}){
    let value=String(escapedText||'');
    // 未揭示时关键词同样可点击（学员自己“找”关键词），但以 undiscovered 样式
    // 与普通文字保持一致，点击命中才点亮；揭示后恢复黄色高亮。
    // inline 模式用于选项行：选项本身是 <button>，内部不能再嵌 <button>，
    // 否则浏览器会提前闭合外层按钮，把关键词挤出到选项之外、破坏整行结构。
    const stateCls=keywordsRevealed?'':' undiscovered';
    const tokenMarkup=inline
      ?(cls,id,match)=>`<span role="button" tabindex="0" class="kr-keyword-token${stateCls}${cls}" data-keyword-id="${id}">${match}</span>`
      :(cls,id,match)=>`<button type="button" class="kr-keyword-token${stateCls}${cls}" data-keyword-id="${id}">${match}</button>`;
    const replacements=[];
    for(const item of keywordMatchers){
      item.regex.lastIndex=0;
      value=value.replace(item.regex,match=>{
        const token=`__KR_MATCH_${replacements.length}__`;
        replacements.push(tokenMarkup(isKeywordActive(item.key)?' active':'',escapeHTML(item.key),match));
        return token;
      });
    }
    replacements.forEach((html,index)=>{value=value.replace(`__KR_MATCH_${index}__`,html)});
    return value;
  }
  function bindQuestionInteractions(){
    if(questionCard.dataset.interactionsBound)return;
    questionCard.dataset.interactionsBound='1';
    questionCard.addEventListener('click',event=>{
      // 关键词优先：选项行内也有可点击关键词，先判 token 再判选项。
      const keyword=event.target.closest('.kr-keyword-token');
      if(keyword&&questionCard.contains(keyword)){
        event.preventDefault();event.stopPropagation();activateKeyword(keyword);return;
      }
      // 选项判定与多题画布一致：点击字母按钮（键盘 Enter/Space 也走这里的 click），
      // 单击延迟 230ms 给双击常绿让路；选项文字行不判定，留给点击关键词。
      const optionKey=event.target.closest('[data-qw-option-key]');
      if(optionKey&&questionCard.contains(optionKey)){
        event.preventDefault();event.stopPropagation();
        clearTimeout(krOptionClickTimer);
        krOptionClickTimer=setTimeout(()=>judgeKrOption(optionKey.dataset.qwOptionKey),KR_OPTION_SINGLE_CLICK_DELAY);
        return;
      }
      const analysis=event.target.closest('[data-qw-action="analysis"]');
      if(analysis&&questionCard.contains(analysis)){
        event.preventDefault();event.stopPropagation();toggleKrAnalysisPanel();return;
      }
    });
    questionCard.addEventListener('dblclick',event=>{
      const optionKey=event.target.closest('[data-qw-option-key]');
      if(!optionKey||!questionCard.contains(optionKey))return;
      event.preventDefault();event.stopPropagation();
      clearTimeout(krOptionClickTimer);
      toggleKrPersistentAnswer(optionKey.dataset.qwOptionKey);
    });
    questionCard.addEventListener('keydown',event=>{
      if(event.key!=='Enter'&&event.key!==' ')return;
      const keyword=event.target.closest?.('.kr-keyword-token');
      if(!keyword||!questionCard.contains(keyword))return;
      event.preventDefault();activateKeyword(keyword);
    });
    window.addEventListener('resize',()=>{if(krAnalysisOpen)positionKrAnalysisPanel()});
    if(analysisLayer){
      analysisLayer.addEventListener('click',event=>{
        if(event.target.closest('[data-qw-analysis-close]')){event.preventDefault();toggleKrAnalysisPanel()}
      });
      analysisLayer.addEventListener('change',event=>{
        const checkbox=event.target.closest('[data-qw-analysis-section]');
        if(!(checkbox instanceof HTMLInputElement))return;
        const key=String(checkbox.dataset.qwAnalysisSection||'');
        if(!KR_ANALYSIS_SECTION_ORDER.includes(key))return;
        if(checkbox.checked)krAnalysisSections.add(key);else krAnalysisSections.delete(key);
        if(!krAnalysisSections.size){krAnalysisSections.add('answer');checkbox.checked=false}
        saveKrAnalysisSections();refreshKrAnalysisPanelContents();
      });
      // P4.5.33：勾选后下拉保持展开（refreshKrAnalysisPanelContents 不重建 details），
      // 点击"显示内容"以外区域才收起下拉，方便连续勾选。
      document.addEventListener('click',event=>{
        const details=analysisLayer.querySelector('.qw-analysis-config-wrap');
        if(!details?.open)return;
        if(event.target.closest('.qw-analysis-config-wrap'))return;
        details.open=false;
      });
    }
  }
  /* P4.5.30 解析面板：结构与样式复用多题画布 qw-analysis-panel，
     显示内容勾选偏好与 question-workspace 共用同一 localStorage key（按用户分域），两页互通。 */
  let krAnalysisSections=readKrAnalysisSections();
  function krScopedPreferenceKey(prefix){
    const userId=window.KGLearningSessionStore?.currentUserId?.()||'guest';
    return prefix+'__'+encodeURIComponent(String(userId||'guest'));
  }
  function readKrAnalysisSections(){
    try{
      const raw=JSON.parse(localStorage.getItem(krScopedPreferenceKey(KR_ANALYSIS_SECTION_KEY))||'null');
      const selected=Array.isArray(raw)?raw.map(String).filter(key=>KR_ANALYSIS_SECTION_ORDER.includes(key)):[];
      return new Set(selected.length?selected:KR_ANALYSIS_SECTION_DEFAULTS);
    }catch(error){return new Set(KR_ANALYSIS_SECTION_DEFAULTS)}
  }
  function saveKrAnalysisSections(){
    try{localStorage.setItem(krScopedPreferenceKey(KR_ANALYSIS_SECTION_KEY),JSON.stringify([...krAnalysisSections]))}catch(error){}
    return krAnalysisSections;
  }
  function krAnalysisSectionEnabled(key){return krAnalysisSections.has(String(key||''))}
  function krAnalysisSectionMarkup(key,title,body,className=''){
    return `<section class="qw-analysis-section ${escapeHTML(className)}" data-analysis-section="${escapeHTML(key)}"><h4>${escapeHTML(title)}</h4><div class="qw-analysis-section-body">${body}</div></section>`;
  }
  function krCorrectAnswerId(){
    const explicit=String(question.correctAnswer||'').trim();
    if(explicit)return explicit;
    const option=(Array.isArray(question.options)?question.options:[]).find(item=>item?.correct);
    return String(option?.id||'');
  }
  // P4.5.33：题目未录 concepts 时，按关键词 recallNodeId 从联想库解析本题对应知识点
  // （只取节点 title 与 hint 解释，不展开关系链条），去重后作为解析面板的知识点内容。
  function krLibraryConcepts(){
    const library=associationLibrary();
    if(!library?.nodes?.length)return [];
    const api=window.KGRecallAssociationLibrary;
    if(!api?.resolve)return [];
    const seen=new Set(),result=[];
    (Array.isArray(question.clues)?question.clues:[]).forEach(clue=>{
      const nodeId=String(clue?.recallNodeId||'').trim();
      if(!nodeId||seen.has(nodeId))return;
      const node=api.resolve(library,nodeId);
      if(!node)return;
      seen.add(nodeId);
      result.push({title:node.title,rule:String(node.hint||'').trim()});
    });
    return result.slice(0,6);
  }
  function krQuestionAnalysisMarkup(){
    const view=recallQuestionDisplay()||{};
    const options=Array.isArray(question.options)?question.options:[];
    const viewOptions=Array.isArray(view.options)?view.options:[];
    const answerId=krCorrectAnswerId();
    const correct=options.find(item=>String(item?.id||'')===answerId)||options.find(item=>item?.correct)||null;
    const displayCorrect=viewOptions.find(item=>String(item.id)===String(answerId))||null;
    const explicit=String(view.explanation?.zh||question.analysis||question.explanation||question.rationale||question.solution||'').trim();
    const pathText=String(view.path?.zh||question.keyPath?.ruleText||question.keyPath?.label||'').trim();
    // P4.5.33 知识点：题目 concepts 为空时，用关键词的 recallNodeId 从联想库解析
    // 对应知识点（title + hint 解释）——录入侧只需照常绑定关键词入口，无需额外录入。
    const rawConcepts=(Array.isArray(question.concepts)?question.concepts:[]).filter(item=>String(item?.title||'').trim()).slice(0,6);
    const concepts=rawConcepts.length?rawConcepts:krLibraryConcepts();
    // P4.5.33 关键词：优先显示核心关键词（isCore 标记，Prep Studio 录入时已标注），
    // 有讲解（explain）则附上；无核心标记时回退为带讲解的关键词。
    const allClues=Array.isArray(question.clues)?question.clues:[];
    const coreClues=allClues.filter(item=>item?.isCore).slice(0,6);
    const clues=coreClues.length?coreClues:allClues.filter(item=>String(item?.explain||'').trim()).slice(0,6);
    const traps=options.filter(item=>String(item?.trap||'').trim()).slice(0,8);
    const sections=[];
    if(krAnalysisSectionEnabled('analysis')&&explicit)sections.push(krAnalysisSectionMarkup('analysis','题目解析',`<p>${escapeHTML(explicit)}${englishLine(view.explanation)}</p>`));
    if(krAnalysisSectionEnabled('answer')&&(answerId||correct)){
      const zhText=displayCorrect?.display?.zh||correct?.text||'';
      const enText=displayCorrect?.display?.en||'';
      sections.push(krAnalysisSectionMarkup('answer','正确答案',`<p><strong>${escapeHTML(answerId||correct?.id||'')}</strong>${zhText?' · '+escapeHTML(zhText):''}${enText&&languageMode()==='bilingual'?`<span class="qw-bilingual-en">${escapeHTML(enText)}</span>`:''}</p>`,'qw-analysis-answer'));
    }
    if(krAnalysisSectionEnabled('path')&&pathText)sections.push(krAnalysisSectionMarkup('path','判断主线',`<p>${escapeHTML(pathText)}${englishLine(view.path)}</p>`));
    if(krAnalysisSectionEnabled('concepts')&&concepts.length)sections.push(krAnalysisSectionMarkup('concepts','知识点',`<ul>${concepts.map(item=>`<li><strong>${escapeHTML(item.title||'知识点')}</strong>${item.rule||item.summary?'：'+escapeHTML(item.rule||item.summary):''}</li>`).join('')}</ul>`));
    if(krAnalysisSectionEnabled('clues')&&clues.length)sections.push(krAnalysisSectionMarkup('clues',coreClues.length?'核心关键词':'关键词讲解',`<ul>${clues.map(item=>`<li><strong>${escapeHTML(item.text||'线索')}</strong>${String(item.explain||'').trim()?'：'+escapeHTML(item.explain):''}</li>`).join('')}</ul>`));
    if(krAnalysisSectionEnabled('traps')&&traps.length)sections.push(krAnalysisSectionMarkup('traps','选项提示',`<ul>${traps.map(item=>`<li><strong>${escapeHTML(item.id||'')}</strong>：${escapeHTML(item.trap||'')}</li>`).join('')}</ul>`));
    if(!sections.length)sections.push('<section class="qw-analysis-empty"><h4>暂无可展示内容</h4><p>可在“显示内容”中勾选其他项目；若仍为空，请先在题库中补充解析、知识点或选项提示。</p></section>');
    return sections.join('');
  }
  function krAnalysisConfigMarkup(){
    return `<details class="qw-analysis-config-wrap"><summary title="选择解析显示内容" aria-label="选择解析显示内容"><svg viewBox="0 0 24 24" aria-hidden="true"><path d="M4 7h10M18 7h2M4 17h2M10 17h10M14 4v6M6 14v6"/></svg></summary><fieldset class="qw-analysis-config"><legend>显示内容</legend>${KR_ANALYSIS_SECTION_ORDER.map(key=>`<label><input type="checkbox" data-qw-analysis-section="${escapeHTML(key)}" ${krAnalysisSectionEnabled(key)?'checked':''}><span>${escapeHTML(KR_ANALYSIS_SECTION_LABELS[key]||key)}</span></label>`).join('')}</fieldset></details>`;
  }
  function renderKrAnalysisPanel(){
    if(!analysisLayer)return false;
    if(!krAnalysisOpen){analysisLayer.innerHTML='';return false}
    const title=String(question.title||'本题解析');
    analysisLayer.innerHTML=`<aside class="qw-analysis-panel" data-analysis-node-id="kr-question" data-side="right" aria-label="本题解析 ${escapeHTML(title)}"><header data-qw-analysis-drag title="解析面板位置跟随题目卡"><div><small>QUESTION EXPLANATION</small><h3>${escapeHTML(title)}</h3></div><div class="qw-analysis-header-actions">${krAnalysisConfigMarkup()}<button type="button" data-qw-analysis-close="kr-question" title="关闭解析" aria-label="关闭解析"><svg viewBox="0 0 24 24" aria-hidden="true"><path d="M7 7l10 10M17 7 7 17"/></svg></button></div></header><div class="qw-analysis-content">${krQuestionAnalysisMarkup()}</div></aside>`;
    requestAnimationFrame(positionKrAnalysisPanel);
    return true;
  }
  // P4.5.33：勾选后只刷新内容区（镜像多题画布 refreshAnalysisPanelContents），
  // 不重建 details——避免"点一下复选框整个下拉菜单消失"。
  function refreshKrAnalysisPanelContents(){
    const panel=analysisLayer?.querySelector?.('.qw-analysis-panel');
    if(!panel||!krAnalysisOpen)return false;
    const content=panel.querySelector('.qw-analysis-content');
    if(content)content.innerHTML=krQuestionAnalysisMarkup();
    panel.querySelectorAll('[data-qw-analysis-section]').forEach(input=>{
      if(input instanceof HTMLInputElement)input.checked=krAnalysisSectionEnabled(input.dataset.qwAnalysisSection||'');
    });
    requestAnimationFrame(positionKrAnalysisPanel);
    return true;
  }
  function positionKrAnalysisPanel(){
    const panel=analysisLayer?.querySelector?.('.qw-analysis-panel');
    if(!panel||!krAnalysisOpen)return false;
    // 题目卡以世界原点为中心（translate(-50%,-50%)）。面板优先贴卡片右侧；
    // 右侧放不下（会溢出视口，导致"显示内容"等头部按钮点不到）时翻到左侧。
    const width=Number(questionCard.offsetWidth||0),height=Number(questionCard.offsetHeight||0);
    const panelWidth=Math.max(148,Number(panel.offsetWidth||460)),panelHeight=Math.max(148,Number(panel.offsetHeight||260));
    const scale=Math.max(.0001,Number(state.transform.scale)||1),t=state.transform,vp=viewport.getBoundingClientRect();
    const worldLeft=(-Number(t.x||0))/scale,worldRight=(vp.width-Number(t.x||0))/scale,worldTop=(-Number(t.y||0))/scale;
    const rightX=width/2+24+Number(krAnalysisOffset.x||0);
    let x=rightX;
    if(x+panelWidth>worldRight-12){
      const leftX=-width/2-24-Number(krAnalysisOffset.x||0)-panelWidth;
      x=leftX>worldLeft+12?leftX:Math.max(worldLeft+12,worldRight-12-panelWidth);
    }
    let y=Math.max(-height/2+Number(krAnalysisOffset.y||0),worldTop+12);
    const anchorY=0;
    panel.dataset.side=x<-width/2-12?'left':'right';
    panel.style.setProperty('--qw-analysis-pointer-y',Math.max(28,Math.min(panelHeight-28,anchorY-y))+'px');
    panel.style.removeProperty('--qw-analysis-pointer-x');
    panel.style.left=x+'px';
    panel.style.top=y+'px';
    return true;
  }
  function setKrAnalysisButtonState(active){
    questionCard.querySelectorAll('[data-qw-action="analysis"]').forEach(button=>{
      button.classList.toggle('is-active',!!active);
      button.setAttribute('aria-pressed',String(Boolean(active)));
    });
  }
  function toggleKrAnalysisPanel(){
    krAnalysisOpen=!krAnalysisOpen;
    setKrAnalysisButtonState(krAnalysisOpen);
    renderKrAnalysisPanel();
    return true;
  }
  function revealKeywords(){
    if(isRecallReadonly()){notifyRecallReadonly();return false}
    if(keywordsRevealed)return true;
    keywordsRevealed=true;renderQuestion();
    const button=$('krRevealKeywordsBtn');if(button){button.disabled=true;button.textContent='关键词已揭示'}
    return true;
  }
  function activateKeyword(el){
    if(isRecallReadonly()){notifyRecallReadonly();return}
    const key=el.dataset.keywordId;
    const root=rootConfig(key);
    if(!root)return;
    markKeywordActive(key);state.metrics.keywordClicks=(Number(state.metrics.keywordClicks)||0)+1;
    questionCard.querySelectorAll(`.kr-keyword-token[data-keyword-id="${cssAttr(key)}"]`).forEach(x=>x.classList.add('active'));
    el.classList.add('active');
    const rootDataId=root.nodeId||key;
    let node=state.nodes.find(n=>String(n.dataId)===String(rootDataId));
    if(!node){
      if(!requireRecallNodeLimit(1))return;
      const pos=keywordNodePosition(el,state.nodes.filter(n=>n.depth===0).length);
      const data=getNodeData(rootDataId);
      node={instanceId:uid('node'),dataId:rootDataId,rootKey:key,title:data.title||root.title,x:pos.x,y:pos.y,parentId:null,depth:0,createdAt:Date.now()};
      state.nodes.push(node);
      state.lastNewNodeId=node.instanceId;
      saveProgress();
      renderGraphDelta({node,nodeCreated:true});
      setTimeout(()=>focusNode(node.instanceId,false),40);
    }else{
      saveProgress();
      renderStats();focusNode(node.instanceId,false);
    }
  }
  function keywordNodePosition(el,index){
    const wr=screenToWorldRect(el.getBoundingClientRect());
    const q=questionBounds(92);
    const keywordSide=wr.x>=0?1:-1;
    const preferredSide=index%2===0?keywordSide:-keywordSide;
    const sideX=preferredSide>0?q.right+98:q.left-98;
    const verticalOffsets=[0,86,-86,172,-172,258,-258,344,-344];
    const candidates=[];
    verticalOffsets.forEach(offset=>candidates.push({x:sideX,y:clamp(wr.y+offset,q.top+42,q.bottom-42)}));
    const altSideX=preferredSide>0?q.left-98:q.right+98;
    verticalOffsets.forEach(offset=>candidates.push({x:altSideX,y:clamp(wr.y+offset,q.top+42,q.bottom-42)}));
    const horizontalOffsets=[-280,-140,0,140,280];
    horizontalOffsets.forEach(offset=>candidates.push({x:clamp(wr.x+offset,q.left+74,q.right-74),y:q.top-112}));
    horizontalOffsets.forEach(offset=>candidates.push({x:clamp(wr.x+offset,q.left+74,q.right-74),y:q.bottom+112}));
    candidates.push({x:wr.x+(preferredSide>0?360:-360),y:wr.y});
    return findOpenPosition(candidates,index);
  }
  function screenToWorldRect(rect){
    const vp=viewport.getBoundingClientRect();
    const t=state.transform;
    return {x:(rect.left+rect.width/2-vp.left-t.x)/t.scale,y:(rect.top+rect.height/2-vp.top-t.y)/t.scale};
  }
  function questionBounds(pad=72){
    const w=(questionCard&&questionCard.offsetWidth)||780;
    const h=(questionCard&&questionCard.offsetHeight)||430;
    return {left:-w/2-pad,right:w/2+pad,top:-h/2-pad,bottom:h/2+pad,width:w+pad*2,height:h+pad*2};
  }
  function clamp(value,min,max){return Math.max(min,Math.min(max,value))}
  function nodeRectAt(x,y,pad=14){
    const w=132+pad*2,h=154+pad*2;
    return {left:x-w/2,right:x+w/2,top:y-h/2,bottom:y+h/2};
  }
  function rectsOverlap(a,b){return a.left<b.right&&a.right>b.left&&a.top<b.bottom&&a.bottom>b.top}
  function pointBlocksQuestion(x,y){return rectsOverlap(nodeRectAt(x,y,8),questionBounds(18))}
  function positionIsOpen(x,y){
    if(pointBlocksQuestion(x,y))return false;
    const rect=nodeRectAt(x,y,16);
    return !state.nodes.some(n=>rectsOverlap(rect,nodeRectAt(Number(n.x)||0,Number(n.y)||0,16)));
  }
  function findOpenPosition(candidates,seed=0){
    for(const point of candidates||[])if(positionIsOpen(point.x,point.y))return {x:point.x,y:point.y};
    const q=questionBounds(110),rx=Math.max(q.width/2+150,520),ry=Math.max(q.height/2+140,390),start=(Number(seed)||0)*.77;
    for(let i=0;i<18;i++){
      const ring=1+Math.floor(i/9)*.38,angle=start+i*(Math.PI*2/9);
      const point={x:Math.cos(angle)*rx*ring,y:Math.sin(angle)*ry*ring};
      if(positionIsOpen(point.x,point.y))return point;
    }
    const fallback=(candidates&&candidates[0])||{x:q.right+110,y:q.bottom+110};
    return {x:Number(fallback.x)||q.right+110,y:Number(fallback.y)||q.bottom+110};
  }
  function nodeMarkup(n){
    const d=getNodeData(n.dataId),titleDisplay=recallNodeTitleDisplay(n.dataId,d,n);
    const title=titleDisplay.zh||n.title||d.title||'知识点';
    const cls=['kr-node',`depth-${Math.min(6,Number(n.depth||0))}`];
    if(state.activeNodeId===n.instanceId)cls.push('is-active');
    if(state.lastNewNodeId&&state.lastNewNodeId===n.instanceId)cls.push('is-new');
    return `<div class="${cls.join(' ')}" data-instance-id="${escapeHTML(n.instanceId)}" style="left:${Number(n.x)||0}px;top:${Number(n.y)||0}px"><button type="button" title="${escapeHTML(title)} · 拖动整理位置 · 双击删除" aria-label="打开 ${escapeHTML(title)} 的回忆引导；拖动整理位置；双击删除"><span>${escapeHTML(firstChar(title))}</span></button><div class="kr-node-label">${escapeHTML(title)}${englishLine(titleDisplay)}</div></div>`;
  }
  function renderNodes(){
    const newNodeId=state.lastNewNodeId;
    nodeLayer.innerHTML=state.nodes.map(nodeMarkup).join('');
    if(newNodeId)setTimeout(()=>{if(state.lastNewNodeId===newNodeId)state.lastNewNodeId=''},520);
  }
  function appendNodeElement(node){
    if(!node||nodeLayer.querySelector(`[data-instance-id="${cssAttr(node.instanceId)}"]`))return false;
    nodeLayer.insertAdjacentHTML('beforeend',nodeMarkup(node));
    const id=node.instanceId;setTimeout(()=>{if(state.lastNewNodeId===id)state.lastNewNodeId=''},520);return true;
  }
  function edgePathData(edge,nodeMap=null){
    const map=nodeMap||new Map(state.nodes.map(node=>[String(node.instanceId),node]));
    const a=map.get(String(edge?.from)),b=map.get(String(edge?.to));if(!a||!b)return '';
    const ax=Number(a.x)||0,ay=Number(a.y)||0,bx=Number(b.x)||0,by=Number(b.y)||0;
    const direction=bx>=ax?1:-1,span=Math.abs(bx-ax),dx=Math.max(70,span*.46);
    return `M ${ax} ${ay} C ${ax+direction*dx} ${ay}, ${bx-direction*dx*.34} ${by}, ${bx} ${by}`;
  }
  function edgeMarkup(edge,nodeMap=null){
    const d=edgePathData(edge,nodeMap);if(!d)return '';
    const cls=edge.id===state.lastNewEdgeId?'kr-edge new':'kr-edge';
    return `<path class="${cls}" data-edge-id="${escapeHTML(edge.id)}" d="${d}"></path>`;
  }
  function renderEdges(){
    const nodeMap=new Map(state.nodes.map(node=>[String(node.instanceId),node]));
    edges.innerHTML=state.edges.map(edge=>edgeMarkup(edge,nodeMap)).join('');
  }
  function appendEdgeElement(edge){
    if(!edge||edges.querySelector(`[data-edge-id="${cssAttr(edge.id)}"]`))return false;
    const markup=edgeMarkup(edge);if(!markup)return false;edges.insertAdjacentHTML('beforeend',markup);return true;
  }
  function updateConnectedEdges(instanceId,connectedEdges=null,nodeMap=null){
    const id=String(instanceId||''),map=nodeMap||new Map(state.nodes.map(node=>[String(node.instanceId),node]));
    const list=connectedEdges||state.edges.filter(edge=>String(edge.from)===id||String(edge.to)===id);
    list.forEach(edge=>{const path=edges.querySelector(`[data-edge-id="${cssAttr(edge.id)}"]`);if(path)path.setAttribute('d',edgePathData(edge,map))});
  }
  function renderGraphDelta({node=null,edge=null,nodeCreated=false,edgeCreated=false}={}){
    if(nodeCreated&&node)appendNodeElement(node);
    if(edgeCreated&&edge)appendEdgeElement(edge);
    renderStats();applyTransform(false);canvasRuntime?.refreshMinimap?.(true);
  }
  function bindNodeInteractions(){
    if(nodeLayer.dataset.interactionsBound)return;
    nodeLayer.dataset.interactionsBound='1';
    const clearCardClick=()=>{if(cardClickTimer){clearTimeout(cardClickTimer);cardClickTimer=0}};
    nodeLayer.addEventListener('pointerdown',event=>{
      const button=event.target.closest('.kr-node button');if(!button||event.button!==0)return;
      if(isRecallReadonly())return;
      const wrap=button.closest('.kr-node'),instanceId=wrap?.dataset.instanceId||'';
      const node=state.nodes.find(item=>String(item.instanceId)===String(instanceId));if(!node)return;
      clearCardClick();button.classList.add('is-pressed');
      nodeDrag={pointerId:event.pointerId,instanceId,startClientX:event.clientX,startClientY:event.clientY,
        startX:Number(node.x)||0,startY:Number(node.y)||0,moved:false,button,wrap,node,
        nodeMap:new Map(state.nodes.map(item=>[String(item.instanceId),item])),
        connectedEdges:state.edges.filter(edge=>String(edge.from)===String(instanceId)||String(edge.to)===String(instanceId))};
      try{button.setPointerCapture(event.pointerId)}catch(_){}
    });
    nodeLayer.addEventListener('pointermove',event=>{
      if(!nodeDrag||event.pointerId!==nodeDrag.pointerId)return;
      const scale=Math.max(MIN_ZOOM,Number(state.transform.scale)||1);
      const dx=(event.clientX-nodeDrag.startClientX)/scale,dy=(event.clientY-nodeDrag.startClientY)/scale;
      if(!nodeDrag.moved&&Math.hypot(dx,dy)<5)return;
      if(!nodeDrag.moved){nodeDrag.moved=true;closeGuide();nodeDrag.wrap?.classList.add('is-dragging')}
      nodeDrag.node.x=nodeDrag.startX+dx;nodeDrag.node.y=nodeDrag.startY+dy;
      if(nodeDrag.wrap){nodeDrag.wrap.style.left=nodeDrag.node.x+'px';nodeDrag.wrap.style.top=nodeDrag.node.y+'px'}
      updateConnectedEdges(nodeDrag.instanceId,nodeDrag.connectedEdges,nodeDrag.nodeMap);
      event.preventDefault();event.stopPropagation();
    });
    const finishNodeDrag=event=>{
      if(!nodeDrag||(event?.pointerId!=null&&event.pointerId!==nodeDrag.pointerId))return;
      const drag=nodeDrag;nodeDrag=null;drag.button?.classList.remove('is-pressed');drag.wrap?.classList.remove('is-dragging');
      try{drag.button?.releasePointerCapture?.(event.pointerId)}catch(_){}
      if(drag.moved){suppressNodeClickUntil=Date.now()+320;saveProgress();canvasRuntime?.refreshMinimap?.(true);event?.preventDefault?.();event?.stopPropagation?.()}
    };
    nodeLayer.addEventListener('pointerup',finishNodeDrag);
    nodeLayer.addEventListener('pointercancel',finishNodeDrag);
    nodeLayer.addEventListener('click',event=>{
      const button=event.target.closest('.kr-node button');if(!button)return;
      event.preventDefault();event.stopPropagation();if(Date.now()<suppressNodeClickUntil)return;
      const instanceId=button.closest('.kr-node')?.dataset.instanceId||'';
      if(!instanceId||destroyingNodeIds.has(instanceId))return;
      if(event.detail>1){clearCardClick();return}
      clearCardClick();cardClickTimer=setTimeout(()=>{
        cardClickTimer=0;if(Date.now()<suppressNodeClickUntil||destroyingNodeIds.has(instanceId))return;
        const liveButton=nodeLayer.querySelector(`[data-instance-id="${cssAttr(instanceId)}"] button`);if(liveButton)openNodeGuide(instanceId,liveButton);
      },240);
    });
    nodeLayer.addEventListener('dblclick',event=>{
      const button=event.target.closest('.kr-node button');if(!button||Date.now()<suppressNodeClickUntil)return;
      event.preventDefault();event.stopPropagation();clearCardClick();button.classList.remove('is-pressed');
      const wrap=button.closest('.kr-node');if(wrap)deleteNode(wrap.dataset.instanceId);
    });
  }
  function renderGraphOnly(){renderNodes();renderEdges();renderStats();applyTransform(false);canvasRuntime?.refreshMinimap?.(true)}
  function renderAll(){renderQuestion();renderGraphOnly();updateQuestionNavigator()}
  function syncActiveNodeClass(){nodeLayer.querySelectorAll('.kr-node').forEach(wrap=>wrap.classList.toggle('is-active',String(wrap.dataset.instanceId||'')===String(state.activeNodeId||'')))}
  function openNodeGuide(instanceId,anchor,{countOpen=true}={}){
    const node=state.nodes.find(n=>n.instanceId===instanceId);if(!node)return;
    const readOnly=isRecallReadonly();
    state.activeNodeId=instanceId;guide.dataset.dragged='';
    if(countOpen&&!readOnly){state.metrics.nodeOpens=(Number(state.metrics.nodeOpens)||0)+1;saveProgress()}
    syncActiveNodeClass();
    const liveAnchor=nodeLayer.querySelector(`[data-instance-id="${cssAttr(instanceId)}"] button`)||anchor;
    const d=getNodeData(node.dataId);
    const display=recallNodeDisplay(node.dataId,d,node);
    const choicePage=guideChoicePage(node,d);
    const choices=choicePage.choices;
    const displayChoices=choices.map(choice=>recallNodeTitleDisplay(choice.next,getNodeData(choice.next),null));
    guide.hidden=false;
    const choiceMarkup=choices.length
      ? `<div class="kr-choice-list">${choices.map((c,i)=>`<button type="button" data-choice-index="${i}"${readOnly?' disabled':''}>${escapeHTML(displayChoices[i]?.zh||c.text||'继续回忆')}${englishLine(displayChoices[i])}</button>`).join('')}</div>`
      : `<div class="kr-empty-choices">${readOnly?'旧版本回忆图为只读。':'没有更多推荐了，输入你想到的知识点继续。'}</div>`;
    const editingMarkup=readOnly?'':`<div class="kr-guide-actions"><button class="secondary" id="krMoreChoicesBtn" type="button"${choicePage.canRotate?'':' disabled aria-disabled="true"'}>换一组</button></div><div class="kr-custom-form" id="krCustomForm"><input id="krCustomInput" placeholder="输入你想到的知识点，例如：发起人" maxlength="30"/><button id="krCustomSaveBtn" type="button">生成</button></div>`;
    guide.innerHTML=`<div class="kr-guide-head"><div><h2>${escapeHTML(display?.title?.zh||d.title||node.title)}${englishLine(display?.title)}</h2><p>${escapeHTML(display?.prompt?.zh||d.prompt||'你还能从这里继续回忆到什么？')}${englishLine(display?.prompt)}</p>${d.hint?`<p><strong>轻提示：</strong>${escapeHTML(display?.hint?.zh||d.hint)}${englishLine(display?.hint)}</p>`:''}</div><button class="kr-guide-close" title="关闭" type="button">×</button></div>${choiceMarkup}${editingMarkup}`;
    guide.querySelector('.kr-guide-close').onclick=closeGuide;
    makeGuideDraggable();
    guide.querySelectorAll('[data-choice-index]').forEach(btn=>btn.onclick=()=>{
      const choice=choices[Number(btn.dataset.choiceIndex)];state.metrics.choiceClicks=(Number(state.metrics.choiceClicks)||0)+1;createChildFromChoice(node,choice,Number(btn.dataset.choiceIndex));
    });
    const customInput=$('krCustomInput'),customSave=$('krCustomSaveBtn'),moreBtn=$('krMoreChoicesBtn');
    if(moreBtn&&!moreBtn.disabled)moreBtn.onclick=()=>{
      state.choiceOffsets[node.dataId]=Number(choicePage.nextOffset)||0;
      saveProgress();
      openNodeGuide(instanceId,liveAnchor,{countOpen:false});
    };
    const submitCustomChild=()=>{
      const title=(customInput?.value||'').trim();
      if(!title){if(customInput){customInput.setCustomValidity('请输入要添加的知识点');customInput.reportValidity?.();customInput.focus()}return}
      customInput.setCustomValidity('');createCustomChild(node,title);
    };
    if(customSave)customSave.onclick=submitCustomChild;
    if(customInput){customInput.oninput=()=>customInput.setCustomValidity('');customInput.onkeydown=e=>{if(e.key==='Enter'){e.preventDefault();submitCustomChild()}}}
    requestAnimationFrame(()=>placeGuide(liveAnchor));
  }
  function hideGuide(){guide.hidden=true;guide.innerHTML='';guide.dataset.dragged='';guideDragging=false;state.activeNodeId=null}
  function closeGuide(){hideGuide();syncActiveNodeClass()}
  function placeGuide(anchor){
    if(!guide||guide.hidden||guide.dataset.dragged==='1')return;
    const vp=viewport.getBoundingClientRect();
    const r=anchor&&anchor.getBoundingClientRect?anchor.getBoundingClientRect():null;
    const margin=18,gap=18;
    const guideRect=guide.getBoundingClientRect();
    const gw=Math.min(guideRect.width||380,Math.max(280,vp.width-margin*2));
    const gh=Math.min(guideRect.height||260,Math.max(180,vp.height-margin*2));
    if(!r||(!r.width&&!r.height)){
      const pos=clampGuidePosition(Math.max(margin,(vp.width-gw)/2),Math.max(margin,(vp.height-gh)/2));
      guide.style.left=Math.round(pos.left)+'px';guide.style.top=Math.round(pos.top)+'px';return;
    }
    const anchorBox={left:r.left-vp.left,right:r.right-vp.left,top:r.top-vp.top,bottom:r.bottom-vp.top,width:r.width,height:r.height};
    const candidates=[
      {name:'right',left:anchorBox.right+gap,top:anchorBox.top+anchorBox.height/2-gh/2},
      {name:'left',left:anchorBox.left-gw-gap,top:anchorBox.top+anchorBox.height/2-gh/2},
      {name:'bottom',left:anchorBox.left+anchorBox.width/2-gw/2,top:anchorBox.bottom+gap},
      {name:'top',left:anchorBox.left+anchorBox.width/2-gw/2,top:anchorBox.top-gh-gap}
    ].map(c=>({...c,...clampGuidePosition(c.left,c.top)}));
    function visibleScore(c){
      const overflow=Math.max(0,margin-c.left)+Math.max(0,c.left+gw-(vp.width-margin))+Math.max(0,margin-c.top)+Math.max(0,c.top+gh-(vp.height-margin));
      const horizontalBonus=(c.name==='right'||c.name==='left')?80:0;
      const sideBonus=c.name==='right'?20:0;
      return horizontalBonus+sideBonus-overflow*40;
    }
    const best=candidates.sort((a,b)=>visibleScore(b)-visibleScore(a))[0];
    guide.dataset.placement=best.name;
    guide.style.left=Math.round(best.left)+'px';guide.style.top=Math.round(best.top)+'px';
  }
  function clampGuidePosition(left,top){
    const vp=viewport.getBoundingClientRect();
    const r=guide.getBoundingClientRect();
    const margin=18;
    const maxLeft=Math.max(margin,vp.width-r.width-margin);
    const maxTop=Math.max(margin,vp.height-r.height-margin);
    return {left:Math.max(margin,Math.min(maxLeft,left)),top:Math.max(margin,Math.min(maxTop,top))};
  }
  function makeGuideDraggable(){
    const head=guide.querySelector('.kr-guide-head');
    if(!head)return;
    head.addEventListener('pointerdown',e=>{
      if(e.target.closest('button,input,textarea,select,a'))return;
      e.preventDefault();e.stopPropagation();
      guideDragging=true;guide.dataset.dragged='1';
      guideDragStart={x:e.clientX,y:e.clientY};
      guideStart={left:parseFloat(guide.style.left)||0,top:parseFloat(guide.style.top)||0};
      head.setPointerCapture(e.pointerId);
      guide.classList.add('dragging');
    });
    head.addEventListener('pointermove',e=>{
      if(!guideDragging||!guideDragStart||!guideStart)return;
      e.preventDefault();e.stopPropagation();
      const pos=clampGuidePosition(guideStart.left+e.clientX-guideDragStart.x,guideStart.top+e.clientY-guideDragStart.y);
      guide.style.left=Math.round(pos.left)+'px';guide.style.top=Math.round(pos.top)+'px';
    });
    const endDrag=e=>{
      if(!guideDragging)return;
      guideDragging=false;guide.classList.remove('dragging');
      try{head.releasePointerCapture(e.pointerId)}catch(_){}
    };
    head.addEventListener('pointerup',endDrag);
    head.addEventListener('pointercancel',endDrag);
  }
  function shouldConnectNodes(from,to){
    return Boolean(GraphModel.canConnect?.(state.nodes,state.edges,from,to));
  }


  function createChildFromChoice(parent,choice,choiceIndex=0){
    if(isRecallReadonly()){notifyRecallReadonly();return}
    if(!choice||!choice.next)return;
    const data=getNodeData(choice.next);
    let child=GraphModel.findReusableNode?.(state.nodes,{dataId:choice.next,title:data.title||choice.text,custom:false})||null;
    let created=false,connected=false;
    if(!child){
      if(!requireRecallNodeLimit(1))return;
      const pos=childPosition(parent,choiceIndex);
      child={instanceId:uid('node'),dataId:choice.next,rootKey:parent.rootKey,title:data.title||choice.text,x:pos.x,y:pos.y,parentId:parent.instanceId,depth:Number(parent.depth||0)+1,createdAt:Date.now()};
      state.nodes.push(child);
      state.lastNewNodeId=child.instanceId;
      created=true;
    }
    if(shouldConnectNodes(parent.instanceId,child.instanceId)){
      const edge={id:uid('edge'),from:parent.instanceId,to:child.instanceId};
      state.edges.push(edge);state.lastNewEdgeId=edge.id;connected=true;
    }
    saveProgress();
    closeGuide();renderGraphDelta({node:child,edge:connected?state.edges[state.edges.length-1]:null,nodeCreated:created,edgeCreated:connected});
    setTimeout(()=>focusNode(child.instanceId,created||connected),60);
  }
  function createCustomChild(parent,title){
    if(isRecallReadonly()){notifyRecallReadonly();return}
    const normalized=String(title||'').trim();
    if(!normalized)return;
    const resolved=resolveAssociationNode(normalized);
    if(resolved&&String(resolved.id)!==String(parent?.dataId)){
      const choiceIndex=state.nodes.filter(n=>n.parentId===parent.instanceId).length;
      createChildFromChoice(parent,{text:resolved.title,next:resolved.id},choiceIndex);
      return;
    }
    let child=GraphModel.findReusableNode?.(state.nodes,{title:normalized,custom:true})||null;
    let created=false,connected=false;
    if(!child){
      if(!requireRecallNodeLimit(1))return;
      const id=DeepRecallFlow.personalNodeId?.(question?.id||question?.sourceQuestionId)||('personal:'+uid('idea'));
      state.customNodes[id]={title:normalized,prompt:`围绕“${normalized}”，你还能继续想到什么？`,hint:'这是你自己添加的回忆节点，可以继续添加下一层。',choices:[]};
      const pos=childPosition(parent,state.nodes.filter(n=>n.parentId===parent.instanceId).length);
      child={instanceId:uid('node'),dataId:id,rootKey:parent.rootKey,title:normalized,x:pos.x,y:pos.y,parentId:parent.instanceId,depth:Number(parent.depth||0)+1,createdAt:Date.now(),custom:true};
      state.nodes.push(child);state.lastNewNodeId=child.instanceId;created=true;
    }
    if(shouldConnectNodes(parent.instanceId,child.instanceId)){
      const edge={id:uid('edge'),from:parent.instanceId,to:child.instanceId};
      state.edges.push(edge);state.lastNewEdgeId=edge.id;connected=true;
    }
    saveProgress();closeGuide();renderGraphDelta({node:child,edge:connected?state.edges[state.edges.length-1]:null,nodeCreated:created,edgeCreated:connected});setTimeout(()=>focusNode(child.instanceId,created||connected),60);
  }
  function childPosition(parent,choiceIndex){
    const siblingCount=state.nodes.filter(n=>n.parentId===parent.instanceId).length;
    const depth=Number(parent.depth||0)+1;
    const px=Number(parent.x||0),py=Number(parent.y||0);
    const branchOffsets=[0,-150,150,-300,300,-450,450,-600,600];
    const branch=branchOffsets[(siblingCount+choiceIndex)%branchOffsets.length]||0;
    const step=270+Math.min(depth,5)*24;
    const candidates=[
      {x:px+step,y:py+branch+(depth%2?30:-24)},
      {x:px+step,y:py-branch-(depth%2?24:-30)},
      {x:px+step*.72,y:py+branch+170},
      {x:px+step*.72,y:py+branch-170},
      {x:px-step*.36,y:py+branch+150},
      {x:px-step*.36,y:py+branch-150}
    ];
    return findOpenPosition(candidates,siblingCount+choiceIndex+depth*3);
  }
  function focusNode(instanceId,openGuide){
    const node=state.nodes.find(n=>n.instanceId===instanceId);if(!node)return;
    centerOn(node.x,node.y,true);
    state.activeNodeId=instanceId;syncActiveNodeClass();
    const wrap=nodeLayer.querySelector(`[data-instance-id="${cssAttr(instanceId)}"]`);if(wrap){wrap.classList.add('kr-focus-ring');setTimeout(()=>wrap.classList.remove('kr-focus-ring'),1300)}
    if(openGuide&&wrap){const btn=wrap.querySelector('button');setTimeout(()=>openNodeGuide(instanceId,btn),430)}
  }
  function cssAttr(value){return (window.CSS&&CSS.escape)?CSS.escape(String(value)):String(value).replace(/"/g,'\\"')}
  function centerOn(x,y,smooth=false){
    const vp=viewport.getBoundingClientRect();
    state.transform.x=vp.width/2-x*state.transform.scale;
    state.transform.y=vp.height/2-y*state.transform.scale;
    applyTransform(smooth);
    saveProgress();
  }
  function updateZoomDock(){const value=Math.round(state.transform.scale*100),label=$('krZoomLabel'),slider=$('krZoomSlider');if(label)label.textContent=value+'%';if(slider&&document.activeElement!==slider)slider.value=String(Math.max(1,Math.min(400,value)))}
  function showZoomSlider(show=true){const dock=$('krCanvasZoomDock'),popover=$('krZoomSliderPopover');if(!dock||!popover)return;dock.classList.toggle('slider-open',!!show);popover.setAttribute('aria-hidden',show?'false':'true')}
  function applyTransform(smooth){
    world.classList.toggle('smooth',!!smooth);const t=state.transform;world.style.transform=`translate(${t.x}px,${t.y}px) scale(${t.scale})`;updateZoomDock();canvasRuntime?.notifyViewport?.({x:t.x,y:t.y,zoom:t.scale});
    if(smooth)setTimeout(()=>world.classList.remove('smooth'),460);
    if(!guide.hidden&&state.activeNodeId){const wrap=nodeLayer.querySelector(`[data-instance-id="${cssAttr(state.activeNodeId)}"] button`);if(wrap)placeGuide(wrap)}
  }
  function setZoomScale(value,cx,cy,smooth=false){const old=Math.max(MIN_ZOOM,Number(state.transform.scale)||1),next=Math.max(MIN_ZOOM,Math.min(MAX_ZOOM,Number(value)||old));if(Math.abs(next-old)<.0001){updateZoomDock();return}const vp=viewport.getBoundingClientRect(),wx=(cx-vp.left-state.transform.x)/old,wy=(cy-vp.top-state.transform.y)/old;state.transform.scale=next;state.transform.x=cx-vp.left-wx*next;state.transform.y=cy-vp.top-wy*next;applyTransform(smooth);saveProgress()}
  function nextZoomLevel(current,direction,levels){
    const sorted=[...levels].sort((a,b)=>a-b),value=Math.max(MIN_ZOOM,Math.min(MAX_ZOOM,Number(current)||1));
    if(direction>0)return sorted.find(level=>level>value+.0001)??MAX_ZOOM;
    for(let i=sorted.length-1;i>=0;i--)if(sorted[i]<value-.0001)return sorted[i];
    return MIN_ZOOM;
  }
  function zoomByLevel(direction,levels,cx,cy,smooth=false){setZoomScale(nextZoomLevel(state.transform.scale,direction,levels),cx,cy,smooth)}
  function resetZoom(){
    showZoomSlider(false);const r=viewport.getBoundingClientRect();
    setZoomScale(1,r.left+r.width/2,r.top+r.height/2,true);
  }
  function ensureCanvasContextMenu(){
    if(contextMenu)return contextMenu;
    const factory=window.KGGraphContextMenuController;
    if(!factory||typeof factory.create!=='function')return null;
    contextMenu=factory.create({
      stage:viewport,
      actions:['refresh'],
      onAction:detail=>{
        if(detail?.action!=='refresh')return;
        flushProgress();
        window.KGLearningProgress?.flush?.('deep_recall');
        window.location.reload();
      }
    });
    return contextMenu;
  }
  function showCanvasContextMenu(event){
    if(Date.now()<Number(contextMenuSuppressUntil||0)||rightPanStart?.moved)return false;
    const menu=ensureCanvasContextMenu();if(!menu)return false;
    menu.show({clientX:event.clientX,clientY:event.clientY,context:{type:'canvas',canPaste:false}});
    return true;
  }
  function startCanvasPan(event,rightPan=false){
    if(isDragging)return false;
    if(!rightPan&&event.button!==0)return false;
    if(rightPan&&event.button!==2)return false;
    if(!rightPan&&event.target.closest('.kr-node,.kr-question-card,.kr-guide,.kr-tools,.kr-topbar,.kr-canvas-overlay-left,.kr-canvas-overlay-right,.kr-question-library-trigger,.lp-canvas-zoom-dock,.qw-analysis-panel,summary,label,button,a,input,select,textarea'))return false;
    isDragging=true;panPointerId=event.pointerId;panButton=event.button;
    dragStart={x:event.clientX,y:event.clientY};worldStart={x:state.transform.x,y:state.transform.y};
    rightPanStart=rightPan?{x:event.clientX,y:event.clientY,moved:false}:null;
    viewport.classList.add('dragging');viewport.classList.toggle('right-panning',rightPan);
    contextMenu?.hide?.();
    try{viewport.setPointerCapture(event.pointerId)}catch(_){}
    if(!rightPan)closeGuide();
    event.preventDefault();
    if(rightPan){event.stopPropagation();event.stopImmediatePropagation?.()}
    return true;
  }
  function finishCanvasPan(event,cancelled=false){
    if(!isDragging||(event?.pointerId!=null&&event.pointerId!==panPointerId))return false;
    const moved=!!rightPanStart?.moved;
    if(moved)contextMenuSuppressUntil=Date.now()+360;
    isDragging=false;panPointerId=null;panButton=0;rightPanStart=null;
    viewport.classList.remove('dragging','right-panning');
    try{if(event?.pointerId!=null)viewport.releasePointerCapture(event.pointerId)}catch(_){}
    saveProgress();
    return true;
  }
  function bindCanvas(){
    viewport.addEventListener('pointerdown',event=>{
      if(event.button===2){startCanvasPan(event,true);return}
      startCanvasPan(event,false);
    },true);
    viewport.addEventListener('pointermove',event=>{
      if(!isDragging||event.pointerId!==panPointerId)return;
      const dx=event.clientX-dragStart.x,dy=event.clientY-dragStart.y;
      if(rightPanStart&&!rightPanStart.moved&&Math.hypot(dx,dy)>5){rightPanStart.moved=true;contextMenuSuppressUntil=Date.now()+360;contextMenu?.hide?.();closeGuide()}
      state.transform.x=worldStart.x+dx;state.transform.y=worldStart.y+dy;applyTransform(false);
      if(panButton===2){event.preventDefault();event.stopPropagation()}
    });
    viewport.addEventListener('pointerup',event=>finishCanvasPan(event,false));
    viewport.addEventListener('pointercancel',event=>finishCanvasPan(event,true));
    viewport.addEventListener('contextmenu',event=>{
      event.preventDefault();event.stopPropagation();
      showCanvasContextMenu(event);
    },true);
    viewport.addEventListener('wheel',e=>{if(e.target.closest('.kr-canvas-overlay-left,.kr-question-library-trigger,button,a,input,select,textarea'))return;e.preventDefault();zoomByLevel(e.deltaY<0?1:-1,WHEEL_ZOOM_LEVELS,e.clientX,e.clientY,false)},{passive:false});
    viewport.addEventListener('dblclick',e=>{if(e.target.closest('.kr-node,.kr-question-card,.kr-guide,.kr-canvas-overlay-left,.kr-question-library-trigger,button,a,input,select,textarea'))return;centerOn(0,0,true)});
    const rect=viewport.getBoundingClientRect();lastViewportSize={width:rect.width,height:rect.height};
    window.addEventListener('resize',()=>{
      contextMenu?.hide?.();
      const next=viewport.getBoundingClientRect();
      if(lastViewportSize){state.transform.x+=(next.width-lastViewportSize.width)/2;state.transform.y+=(next.height-lastViewportSize.height)/2}
      lastViewportSize={width:next.width,height:next.height};
      applyTransform(false);if(!state.nodes.length)centerOn(0,0,false);
      if(!guide.hidden&&guide.dataset.dragged==='1'){const pos=clampGuidePosition(parseFloat(guide.style.left)||0,parseFloat(guide.style.top)||0);guide.style.left=Math.round(pos.left)+'px';guide.style.top=Math.round(pos.top)+'px'}
    });
  }
  function renderStats(){
    const el=$('krSessionStats');if(!el)return;
    const uniqueNodes=new Set(state.nodes.map(node=>String(node.dataId))).size;
    const custom=Object.keys(state.customNodes||{}).length;
    const level=uniqueNodes>=50?'熟练回忆':uniqueNodes>=25||state.edges.length>=20?'深度探索':uniqueNodes>=12||state.edges.length>=8?'形成网络':uniqueNodes>=5?'开始串联':'初次接触';
    el.innerHTML=`<span title="已激活的不同关键词">关键词 <strong>${state.activeKeywords.length}</strong></span><span title="本题已选择的联想分支">选择 <strong>${Number(state.metrics.choiceClicks)||0}</strong></span><span title="已回忆的不同知识点">知识点 <strong>${uniqueNodes}</strong></span><span title="已建立关联">关联 <strong>${state.edges.length}</strong></span>${custom?`<span title="个人新增回忆">自建 <strong>${custom}</strong></span>`:''}<span class="kr-level-pill" title="仅用于个人练习反馈，不计入成绩">等级 <strong>${level}</strong></span>`;
  }
  function questionSearchText(item){
    const q=item?.question||{};return [item.id,item.title,item.topic,item.difficulty,q.teacherNumber,q.domain,...(Array.isArray(q.tags)?q.tags:[])].join(' ').toLowerCase();
  }
  function questionContext(){
    const source=window.KGRecallQuestionSource,banks=source?.list?.()||[];
    const bankId=String(question.sourceCollectionId||questionBrowser.bankId||banks[0]?.id||'');
    const bank=banks.find(item=>String(item.id)===bankId)||banks.find(item=>item.questions.some(entry=>String(entry.id)===String(question.id)))||banks[0]||null;
    const index=bank?bank.questions.findIndex(item=>String(item.id)===String(question.id)):-1;
    return {banks,bank,index,total:bank?.questions?.length||0};
  }
  function updateQuestionNavigator(){
    const context=questionContext(),position=context.total&&context.index>=0?context.index+1:0;
    const count=$('krQuestionCount'),positionEl=$('krQuestionPosition');
    if(count)count.textContent=context.total?`${position}/${context.total}`:'0/0';
    if(positionEl)positionEl.textContent=context.total?`题目 ${position} / ${context.total}`:'暂无题目';
    const prev=$('krPrevQuestionBtn'),next=$('krNextQuestionBtn');
    if(prev)prev.disabled=context.total<2;if(next)next.disabled=context.total<2;
  }
  function moveQuestion(delta){
    const context=questionContext();if(!context.bank||!context.total)return false;
    const current=context.index>=0?context.index:0,next=(current+Number(delta)+context.total)%context.total,item=context.bank.questions[next];
    if(!item)return false;
    return switchQuestion(context.bank.id,item.id);
  }
  function renderQuestionList(){
    const listEl=$('krQuestionList');if(!listEl)return;
    const source=window.KGRecallQuestionSource,banks=source?.list?.()||[],bankSelect=$('krBankSelect');
    if(!questionBrowser.bankId||!banks.some(bank=>bank.id===questionBrowser.bankId))questionBrowser.bankId=String(question.sourceCollectionId||banks[0]?.id||'');
    if(bankSelect){bankSelect.innerHTML=banks.map(bank=>{const configured=Number(bank.configuredCount||bank.questions.length||0),available=Number(bank.availableCount||bank.questions.length||0);return `<option value="${escapeHTML(bank.id)}">${escapeHTML(bank.name)}（可用 ${available}/${configured} 题）</option>`}).join('');bankSelect.value=questionBrowser.bankId;bankSelect.disabled=!banks.length}
    const bank=banks.find(item=>item.id===questionBrowser.bankId)||banks[0]||null;
    const term=String($('krQuestionSearch')?.value||'').trim().toLowerCase(),filter=questionBrowser.filter||'all';
    const exploredIds=RecallStorage.exploredSet?.(bank?.id||'')||new Set();
    const items=(bank?.questions||[]).filter(item=>{
      if(term&&!questionSearchText(item).includes(term))return false;
      const explored=exploredIds.has(String(item.id));
      if(filter==='explored'&&!explored)return false;
      if(filter==='unexplored'&&explored)return false;
      return true;
    });
    const meta=$('krQuestionDrawerMeta');if(meta)meta.textContent=bank?`${bank.name} · 显示 ${items.length}/${bank.questions.length} 题${bank.missingCount?` · ${bank.missingCount} 题快照缺失`:''}${bank.damagedCount?` · ${bank.damagedCount} 题快照损坏`:''}${bank.blockedCount?` · ${bank.blockedCount} 题无权限`:''}`:'暂无可用的已发布试卷。';
    listEl.innerHTML=items.length?items.map((item,index)=>{
      const explored=exploredIds.has(String(item.id)),active=String(question.sourceCollectionId||'')===String(bank.id)&&String(question.id)===String(item.id);
      return `<button type="button" class="kr-question-item ${active?'active':''}" data-bank-id="${escapeHTML(bank.id)}" data-question-id="${escapeHTML(item.id)}"><span class="kr-question-index">${index+1}</span><span class="kr-question-copy"><strong>${escapeHTML(item.title)}</strong><small>${escapeHTML(item.question?.teacherNumber||item.topic||item.id)}</small></span><em class="${explored?'explored':'unexplored'}">${explored?'已探索':'未探索'}</em></button>`;
    }).join(''):'<div class="kr-question-empty">没有符合当前试卷、搜索或状态筛选的题目。</div>';
  }
  function questionDrawerOpen(){return Boolean($('krQuestionDrawer')?.classList.contains('open'))}
  function openQuestionDrawer(){const drawer=$('krQuestionDrawer'),backdrop=$('krDrawerBackdrop');if(!drawer)return;renderQuestionList();drawer.classList.add('open');drawer.setAttribute('aria-hidden','false');if(backdrop){backdrop.hidden=false;requestAnimationFrame(()=>backdrop.classList.add('show'))}}
  function closeQuestionDrawer(){const drawer=$('krQuestionDrawer'),backdrop=$('krDrawerBackdrop');if(!drawer)return;drawer.classList.remove('open');drawer.setAttribute('aria-hidden','true');if(backdrop){backdrop.classList.remove('show');setTimeout(()=>backdrop.hidden=true,180)}}
  async function switchQuestion(bankId,questionId){
    await flushProgress();questionSessionToken+=1;cancelProgressSave();
    const result=window.KGRecallQuestionSource?.activate?.(bankId,questionId);if(!result?.valid){notifyRecallLimit((result?.errors||['题目切换失败。']).join('；'));return false}
    const selected=result.question;questionBrowser.bankId=String(result.collection?.id||result.bank?.id||bankId||selected.sourceCollectionId||'');
    const routeContext=window.KGLearningRouteContext?.normalize?.({paperId:selected.sourcePaperId,releaseId:selected.sourceReleaseId,bankId:selected.sourceBankId,questionId:selected.id,mode:'deep_recall',returnUrl:window.KGLearningRouteContext?.parse?.({mode:'deep_recall'})?.returnUrl||'index.html'})||{};
    window.KGLearningRouteContext?.replace?.(routeContext,{target:'knowledge-recall.html'});
    destroyingNodeIds.clear();
    state={nodes:[],edges:[],lastNewEdgeId:'',lastNewNodeId:'',activeNodeId:null,activeKeywords:[],transform:{x:0,y:0,scale:1},customNodes:{},choiceOffsets:{},metrics:{keywordClicks:0,choiceClicks:0,nodeOpens:0,sessionStartedAt:Date.now()}};
    try{await loadDatabaseSession(selected.id)}catch(error){notifyRecallLimit(error?.message||'题目载入失败。');return false}
    closeGuide();closeNodeSearch();closeQuestionDrawer();renderAll();setTimeout(()=>{centerOn(0,0,true);playQuestionCardEntry()},30);enforceRecallPermission();return true;
  }
  function bindQuestionDrawer(){
    $('krQuestionListBtn')?.addEventListener('click',openQuestionDrawer);
    $('krPrevQuestionBtn')?.addEventListener('click',()=>moveQuestion(-1));
    $('krNextQuestionBtn')?.addEventListener('click',()=>moveQuestion(1));
    $('krCloseQuestionDrawerBtn')?.addEventListener('click',()=>closeQuestionDrawer());
    $('krDrawerBackdrop')?.addEventListener('click',()=>closeQuestionDrawer());
    $('krQuestionSearch')?.addEventListener('input',()=>{clearTimeout(searchTimer);searchTimer=setTimeout(renderQuestionList,130)});
    $('krQuestionSearchBtn')?.addEventListener('click',()=>{clearTimeout(searchTimer);renderQuestionList()});
    $('krBankSelect')?.addEventListener('change',event=>{questionBrowser.bankId=String(event.target.value||'');renderQuestionList()});
    $('krQuestionList')?.addEventListener('click',event=>{
      const button=event.target.closest('[data-question-id]');if(!button)return;
      switchQuestion(button.dataset.bankId,button.dataset.questionId);
    });
    document.querySelectorAll('[data-kr-question-filter]').forEach(button=>button.addEventListener('click',()=>{questionBrowser.filter=button.dataset.krQuestionFilter||'all';document.querySelectorAll('[data-kr-question-filter]').forEach(item=>item.classList.toggle('active',item===button));renderQuestionList()}));
    document.addEventListener('keydown',event=>{if(questionDrawerOpen()&&event.key==='Escape')closeQuestionDrawer()});
  }

  function recallCanvasContentBounds(){
    const questionRect=questionBounds(0);
    let left=questionRect.left,top=questionRect.top,right=questionRect.right,bottom=questionRect.bottom;
    state.nodes.forEach(node=>{left=Math.min(left,(Number(node.x)||0)-66);right=Math.max(right,(Number(node.x)||0)+66);top=Math.min(top,(Number(node.y)||0)-77);bottom=Math.max(bottom,(Number(node.y)||0)+77)});
    return{left,top,right,bottom,width:Math.max(1,right-left),height:Math.max(1,bottom-top)};
  }
  function recallCanvasMinimapItems(){
    const q=questionBounds(0);
    return[{id:'question',kind:'current',x:q.left,y:q.top,width:q.width,height:q.height},...state.nodes.map(node=>({id:String(node.instanceId||''),kind:'node',x:(Number(node.x)||0)-66,y:(Number(node.y)||0)-77,width:132,height:154}))];
  }
  function setRecallViewport(next={},meta={}){
    state.transform.x=Number(next.x)||0;state.transform.y=Number(next.y)||0;state.transform.scale=Math.max(MIN_ZOOM,Math.min(MAX_ZOOM,Number(next.zoom??next.scale)||1));
    applyTransform(meta.smooth!==false);if(meta.persist)saveProgress();return true;
  }
  function focusRecallBounds(bounds,{zoom=null,maxZoom=1.25,source='fit',smooth=true}={}){
    const rect=viewport.getBoundingClientRect(),padding=120;
    const scale=zoom==null?Math.max(MIN_ZOOM,Math.min(maxZoom,(rect.width-padding)/Math.max(1,bounds.width),(rect.height-padding)/Math.max(1,bounds.height))):Math.max(MIN_ZOOM,Math.min(MAX_ZOOM,zoom));
    const next={x:(rect.width-(bounds.left+bounds.right)*scale)/2,y:(rect.height-(bounds.top+bounds.bottom)*scale)/2,zoom:scale};
    setRecallViewport(next,{smooth,persist:true,source});return true;
  }
  function initUnifiedCanvasRuntime(){
    if(canvasRuntime||!window.KGUnifiedCanvasRuntime)return canvasRuntime;
    const adapter=Object.freeze({
      id:'recall-canvas-adapter',getSurface:()=>viewport,getViewportElement:()=>viewport,getZoomDock:()=>$('krCanvasZoomDock'),getFullscreenElement:()=>$('krApp')||viewport,
      getViewport:()=>({x:state.transform.x,y:state.transform.y,zoom:state.transform.scale}),setViewport:setRecallViewport,getContentBounds:recallCanvasContentBounds,getMinimapItems:recallCanvasMinimapItems,
      centerAt100:()=>{const r=viewport.getBoundingClientRect();setZoomScale(1,r.left+r.width/2,r.top+r.height/2,true);return true},fit:()=>focusRecallBounds(recallCanvasContentBounds(),{maxZoom:1.25,source:'fit'}),persistViewport:()=>{saveProgress();return true},isMobile:()=>false
    });
    window.KGRecallCanvasAdapter=adapter;
    canvasRuntime=window.KGUnifiedCanvasRuntime.register({id:'recall-canvas',type:'deep-recall',surface:viewport,viewport,zoomDock:$('krCanvasZoomDock'),percentButton:$('krZoomLabel'),adapter,baseGrid:24});
    window.KGRecallCanvasRuntime=canvasRuntime;
    return canvasRuntime;
  }

  function nodeSearchRecord(node){
    const data=getNodeData(node?.dataId),libraryNode=node?.custom?null:resolveAssociationNode(node?.dataId);
    const title=String(data?.title||node?.title||'知识点');
    const titleEn=String(data?.titleEn||libraryNode?.titleEn||'');
    const aliases=Array.isArray(libraryNode?.aliases)?libraryNode.aliases:[];
    const haystack=[title,titleEn,...aliases].join('\u0000').toLowerCase();
    return {node,title,titleEn,aliases,haystack};
  }
  function renderNodeSearchResults(query=''){
    const results=$('krNodeSearchResults'),status=$('krNodeSearchStatus');if(!results||!status)return;
    const q=String(query||'').trim().toLowerCase();
    status.textContent=q?`当前画布 ${state.nodes.length} 个知识点 · 搜索“${String(query||'').trim()}”`:`当前画布 ${state.nodes.length} 个知识点`;
    if(!q){
      results.innerHTML='<div class="kr-node-search-empty">输入知识点名称或别名，定位后可继续回忆。</div>';
      return;
    }
    const rows=state.nodes.map(nodeSearchRecord).filter(row=>row.haystack.includes(q)).sort((a,b)=>{
      const at=a.title.toLowerCase(),bt=b.title.toLowerCase();
      const ae=at===q?0:at.startsWith(q)?1:2,be=bt===q?0:bt.startsWith(q)?1:2;
      return ae-be||Number(b.node?.createdAt||0)-Number(a.node?.createdAt||0)||at.localeCompare(bt,'zh-CN');
    }).slice(0,30);
    if(!rows.length){results.innerHTML='<div class="kr-node-search-empty">当前画布没有匹配的知识点。</div>';return}
    results.innerHTML=rows.map(row=>`<button class="kr-node-search-result" type="button" role="option" data-instance-id="${escapeHTML(row.node.instanceId)}"><strong>${escapeHTML(row.title)}</strong>${row.titleEn?`<small>${escapeHTML(row.titleEn)}</small>`:''}</button>`).join('');
    results.querySelectorAll('.kr-node-search-result').forEach(button=>button.onclick=()=>{
      const instanceId=button.dataset.instanceId||'';closeNodeSearch();
      if(instanceId)focusNode(instanceId,true);
    });
  }
  function openNodeSearch(){
    const panel=$('krNodeSearchPanel'),button=$('krNodeSearchBtn'),input=$('krNodeSearchInput');if(!panel)return;
    panel.hidden=false;button?.setAttribute('aria-expanded','true');renderNodeSearchResults(input?.value||'');
    requestAnimationFrame(()=>input?.focus());
  }
  function closeNodeSearch(){
    const panel=$('krNodeSearchPanel'),button=$('krNodeSearchBtn');if(panel)panel.hidden=true;
    if(nodeSearchTimer){clearTimeout(nodeSearchTimer);nodeSearchTimer=0}
    button?.setAttribute('aria-expanded','false');
  }
  function toggleNodeSearch(){
    const panel=$('krNodeSearchPanel');if(!panel)return;
    if(panel.hidden)openNodeSearch();else closeNodeSearch();
  }
  function bindNodeSearch(){
    const button=$('krNodeSearchBtn'),panel=$('krNodeSearchPanel'),input=$('krNodeSearchInput'),close=$('krNodeSearchCloseBtn');
    if(!button||!panel)return;
    button.onclick=event=>{event.preventDefault();event.stopPropagation();toggleNodeSearch()};
    close?.addEventListener('click',event=>{event.preventDefault();event.stopPropagation();closeNodeSearch()});
    input?.addEventListener('input',()=>{clearTimeout(nodeSearchTimer);nodeSearchTimer=setTimeout(()=>renderNodeSearchResults(input.value),420)});
    input?.addEventListener('keydown',event=>{
      if(event.key==='Escape'){event.preventDefault();closeNodeSearch();button.focus();return}
      if(event.key==='Enter'){
        clearTimeout(nodeSearchTimer);nodeSearchTimer=0;renderNodeSearchResults(input.value);
        const first=$('krNodeSearchResults')?.querySelector('.kr-node-search-result');
        if(first){event.preventDefault();first.click()}
      }
    });
    panel.addEventListener('pointerdown',event=>event.stopPropagation());
    document.addEventListener('pointerdown',event=>{
      if(panel.hidden||panel.contains(event.target)||button.contains(event.target))return;
      closeNodeSearch();
    },true);
  }

  function bindTools(){
    $('krCenterBtn').onclick=()=>centerOn(0,0,true);
    $('krResetBtn').onclick=resetProgress;
    $('krZoomInBtn').onclick=()=>{const r=viewport.getBoundingClientRect();zoomByLevel(1,BUTTON_ZOOM_LEVELS,r.left+r.width/2,r.top+r.height/2,true)};
    $('krZoomOutBtn').onclick=()=>{const r=viewport.getBoundingClientRect();zoomByLevel(-1,BUTTON_ZOOM_LEVELS,r.left+r.width/2,r.top+r.height/2,true)};
    $('krZoomLabel').onclick=()=>{showZoomSlider(false);if(!canvasRuntime?.centerAt100?.())resetZoom()};
    $('krZoomSlider')?.addEventListener('input',event=>{const r=viewport.getBoundingClientRect();showZoomSlider(true);setZoomScale(Number(event.target.value)/100,r.left+r.width/2,r.top+r.height/2,false)});
    $('krZoomSlider')?.addEventListener('pointerdown',event=>event.stopPropagation());
    document.addEventListener('pointerdown',event=>{const dock=$('krCanvasZoomDock');if(dock?.classList.contains('slider-open')&&!dock.contains(event.target))showZoomSlider(false)},true);
    document.addEventListener('keydown',event=>{
      if(event.key==='Escape'){showZoomSlider(false);return}
      if(event.ctrlKey||event.metaKey||event.altKey||isTextEditingTarget(event.target))return;
      if(event.key!=='Delete')return;
      const accountMenu=$('accountMenu');if(questionDrawerOpen()||(accountMenu&&!accountMenu.hidden))return;
      if(!state.activeNodeId)return;
      event.preventDefault();deleteNode(state.activeNodeId);
    });
  }
  function bindLanguageMode(){
    window.addEventListener('kg:question-language-mode',()=>{
      const active=state.activeNodeId;
      const guideWasOpen=!guide.hidden&&Boolean(active);
      renderAll();
      if(guideWasOpen&&active){
        const button=nodeLayer.querySelector(`[data-instance-id="${cssAttr(active)}"] button`);
        if(button)openNodeGuide(active,button,{countOpen:false});
      }
    });
  }
  let teacherPreviewCleanupDone=false;
  function cleanupTeacherDraftPreview(){
    if(teacherPreviewCleanupDone||!isTeacherDraftPreview())return false;teacherPreviewCleanupDone=true;cancelProgressSave();
    const previewToken=String(document.body?.dataset?.recallPreviewToken||new URLSearchParams(location.search||'').get('previewToken')||'');
    try{RecallStorage.clearCurrent?.({previewToken,previewMode:'teacher-draft'})}catch(error){}
    try{window.KGLearningRouteContext?.clear?.('deep_recall')}catch(error){}
    try{window.opener?.postMessage?.({type:'kg:teacher-recall-preview-exit',previewToken},'*')}catch(error){}
    return true;
  }
  async function init(){
    if(typeof GraphModel.normalizeGraph!=='function'||typeof GraphModel.removeNode!=='function'||typeof GraphModel.canConnect!=='function'){
      notifyRecallLimit('深度回忆图模型加载失败，请刷新页面后重试。');
      return;
    }
    try{
      const params=new URLSearchParams(location.search||'');
      const route=window.KGLearningRouteContext?.parse?.({mode:'deep_recall',returnUrl:'question-bank.html'})||{};
      const previewQuestion=teacherDraftPreviewQuestion(params,{bankId:route.bankId||params.get('bankId')||'',questionId:route.questionId||params.get('questionId')||''},route);
      if(previewQuestion){
        question=previewQuestion;recallSession=null;rootMap=buildRootMap(question);keywordMatchers=buildKeywordMatchers(rootMap);keywordsRevealed=false;
        setRecallReadonly(false);renderSaveState({saveState:'idle'});
        await hydratePreviewLibrary();
      }else await loadDatabaseSession();
    }
    catch(error){
      question=cloneValue({...fallbackQuestion,stemParts:[{text:error?.message||'深度回忆数据载入失败，请稍后重试。'}]});
      rootMap={};keywordMatchers=[];setRecallReadonly(true);renderSaveState({saveState:'failed'});notifyRecallLimit(error?.message||'深度回忆数据载入失败，请稍后重试。');
    }
    if(!enforceRecallPermission())return;
    if(isTeacherDraftPreview()){
      const back=$('krBackBtn');if(back){back.title='退出深度回忆预览';back.setAttribute('aria-label','退出深度回忆预览');back.addEventListener('click',event=>{event.preventDefault();cleanupTeacherDraftPreview();try{window.close()}catch(error){};if(!window.closed)location.href='training-config.html?section=recall'},{once:true})}
    }
    window.KGLearningProgress?.registerAdapter?.('deep_recall',{flush:flushProgress,clearTransient:()=>{cancelProgressSave();destroyingNodeIds.clear();state.nodes=[];state.edges=[];state.customNodes={};state.activeKeywords=[];state.choiceOffsets={};state.activeNodeId=null;state.lastNewEdgeId='';state.lastNewNodeId='';}});
    applyRandomHighlight();bindThemeSelect();bindCanvas();bindQuestionInteractions();bindNodeInteractions();bindQuestionDrawer();bindLanguageMode();bindNodeSearch();renderAll();initUnifiedCanvasRuntime();bindTools();
    $('krRevealKeywordsBtn')?.addEventListener('click',revealKeywords);
    $('krSaveRetryBtn')?.addEventListener('click',async()=>{
      try{await recallAdapter?.retryLastSave?.()}catch(error){notifyRecallLimit(error?.message||'重试保存失败。')}
    });
    // P4.5.32：初始始终聚焦题目卡（居中）并播放滑入动画——题目卡是本页的作业锚点，
    // 恢复的历史视图不再优先于它。
    setTimeout(()=>{centerOn(0,0,true);playQuestionCardEntry()},30);
  }
  /* P4.5.31 教师草稿预览不走服务器会话（无 sessionBinding），联想库只能读浏览器
     localStorage——本机未导入过联想库时，关键词卡牌会退化成显示 recallNodeId。
     此时从服务器拉取当前科目正式库兜底（需教师/管理员登录态；失败静默保持原状）。 */
  async function hydratePreviewLibrary(){
    if(!isTeacherDraftPreview())return;
    try{
      const subject=currentSubject();
      if((associationLibrary()?.nodes||[]).length)return;
      const serverLibrary=await window.KGRecallAssociationLibrary?.readServer?.(subject);
      if(serverLibrary&&(serverLibrary.nodes||[]).length){
        window.KGRecallAssociationLibrary?.write?.(subject,serverLibrary);
        resetAssociationRuntime();
        rootMap=buildRootMap(question);keywordMatchers=buildKeywordMatchers(rootMap);
      }
    }catch(error){}
  }
  window.addEventListener('storage',event=>{
    const prefix=window.KGStorageKeys?.PREFIXES?.RECALL_ASSOCIATION||'kg_recall_association_library_v1__';
    if(String(event?.key||'').startsWith(prefix))resetAssociationRuntime();
  });
  window.addEventListener('pagehide',()=>{if(isTeacherDraftPreview())cleanupTeacherDraftPreview();else flushProgress()});
  document.addEventListener('visibilitychange',()=>{if(document.visibilityState==='hidden'&&!isTeacherDraftPreview())flushProgress()});
  document.addEventListener('DOMContentLoaded',init);
})();
