'use strict';

(function(){
  const $=id=>document.getElementById(id);
  const viewport=$('krViewport'),world=$('krWorld'),edges=$('krEdges'),questionCard=$('krQuestionCard'),nodeLayer=$('krNodeLayer'),guide=$('krGuide');
  const RecallStorage=window.KGRecallStorage||{};
  const GraphModel=window.KGRecallGraphModel||{};
  const LEGACY_CURRENT_KEY='kg_deep_recall_current_question_v1';
  const THEME_KEY='kg_deep_recall_theme_v1';
  const THEME_MIGRATION_KEY='kg_deep_recall_theme_platform_migrated_v1';
  const DATA=window.KNOWLEDGE_RECALL_MAP||{roots:{},nodes:{}};
  const Store=window.KGAppStorage||{};
  const fallbackQuestion={id:'unavailable',title:'暂无可用题目',stemParts:[{text:'当前没有可用于深度回忆的已发布试卷。'}],options:[],clues:[],concepts:[],tags:[],sourceCollectionId:'',sourceBankId:'',sourceQuestionId:'unavailable',sourcePaperId:'',sourceReleaseId:''};
  let question=loadQuestion();
  let rootMap=buildRootMap(question);
  let keywordMatchers=buildKeywordMatchers(rootMap);
  let state={nodes:[],edges:[],lastNewEdgeId:'',lastNewNodeId:'',activeNodeId:null,activeKeywords:[],transform:{x:0,y:0,scale:1},customNodes:{},choiceOffsets:{},metrics:{keywordClicks:0,choiceClicks:0,nodeOpens:0,sessionStartedAt:Date.now()}};
  let isDragging=false,dragStart=null,worldStart=null,customOpen=false,lastViewportSize=null;
  let progressSaveTimer=0,questionSessionToken=0,cardClickTimer=0,searchTimer=0;
  const destroyingNodeIds=new Set();
  let questionBrowser={bankId:'',filter:'all'};
  let guideDragging=false,guideDragStart=null,guideStart=null;
  const THEMES=new Set(['platform','parchment','aurora','neon','sakura','ocean','latte']);
  const BUTTON_ZOOM_LEVELS=[.01,.02,.03,.05,.10,.15,.20,.33,.50,.75,1,1.25,1.50,2,2.50,3,4];
  const WHEEL_ZOOM_LEVELS=[.01,.02,.03,.04,.05,.07,.09,.11,.13,.17,.21,.26,.33,.41,.51,.64,.80,1,1.20,1.44,1.73,2.07,2.49,2.99,3.58,4];
  const MIN_ZOOM=.01,MAX_ZOOM=4;
  const HIGHLIGHT_PALETTES=[
    {'--kr-highlight-from':'rgba(251,191,36,.34)','--kr-highlight-to':'rgba(253,230,138,.90)','--kr-highlight-ring':'rgba(251,191,36,.26)','--kr-highlight-hover':'rgba(251,191,36,.18)','--kr-highlight-text':'#3a1f0a'},
    {'--kr-highlight-from':'rgba(52,211,153,.28)','--kr-highlight-to':'rgba(167,243,208,.86)','--kr-highlight-ring':'rgba(16,185,129,.24)','--kr-highlight-hover':'rgba(16,185,129,.16)','--kr-highlight-text':'#064e3b'},
    {'--kr-highlight-from':'rgba(96,165,250,.30)','--kr-highlight-to':'rgba(191,219,254,.88)','--kr-highlight-ring':'rgba(59,130,246,.24)','--kr-highlight-hover':'rgba(59,130,246,.16)','--kr-highlight-text':'#172554'},
    {'--kr-highlight-from':'rgba(244,114,182,.30)','--kr-highlight-to':'rgba(251,207,232,.88)','--kr-highlight-ring':'rgba(236,72,153,.23)','--kr-highlight-hover':'rgba(236,72,153,.15)','--kr-highlight-text':'#831843'},
    {'--kr-highlight-from':'rgba(167,139,250,.31)','--kr-highlight-to':'rgba(221,214,254,.88)','--kr-highlight-ring':'rgba(139,92,246,.24)','--kr-highlight-hover':'rgba(139,92,246,.16)','--kr-highlight-text':'#3b0764'},
    {'--kr-highlight-from':'rgba(45,212,191,.30)','--kr-highlight-to':'rgba(153,246,228,.86)','--kr-highlight-ring':'rgba(20,184,166,.24)','--kr-highlight-hover':'rgba(20,184,166,.15)','--kr-highlight-text':'#134e4a'}
  ];

  function recallQuestionBankId(){return String(question?.sourceCollectionId||question?.sourceReleaseId||question?.sourceBankId||question?.bankId||'')}
  function isRecallReadonly(){return document.body.classList.contains('kr-readonly')}
  function notifyRecallReadonly(){
    notifyRecallLimit('当前为访客只读模式，登录后才能操作深度回忆。');
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
    ['krResetBtn'].forEach(id=>{const el=$(id);if(el){el.classList.toggle('kr-readonly-control',!!enabled);el.setAttribute('aria-disabled',String(!!enabled))}});
  }
  function installRecallReadonlyGuard(){
    if(document.body.dataset.krReadonlyGuardBound)return;
    document.body.dataset.krReadonlyGuardBound='1';
    document.addEventListener('click',event=>{
      if(!isRecallReadonly())return;
      const target=event.target.closest&&event.target.closest('.kr-keyword,.kr-node button,.kr-guide button,#krResetBtn');
      if(!target)return;
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
  function notifyRecallLimit(message){
    const sub=window.KGSubscription;
    if(sub&&typeof sub.showSubscriptionMessage==='function'){sub.showSubscriptionMessage(message);return}
    let toast=$('krLimitToast');
    if(!toast){toast=document.createElement('div');toast.id='krLimitToast';toast.className='kr-limit-toast';document.body.appendChild(toast)}
    toast.textContent=String(message||'');toast.classList.add('show');
    clearTimeout(notifyRecallLimit.timer);notifyRecallLimit.timer=setTimeout(()=>toast.classList.remove('show'),3000);
  }
  function requireRecallNodeLimit(addCount=1){
    const sub=window.KGSubscription;
    if(!sub||typeof sub.requireUsageLimit!=='function')return true;
    return sub.requireUsageLimit('recallNodes',state.nodes.length,addCount,{label:'深度回忆知识点'});
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
  function loadQuestion(){
    try{
      const params=new URLSearchParams(location.search||'');
      const input={
        collectionId:params.get('collectionId')||'',
        paperId:params.get('paperId')||'',
        releaseId:params.get('releaseId')||'',
        bankId:params.get('bankId')||'',
        questionId:params.get('questionId')||''
      };
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
        return q;
      }
      return cloneValue(source?.emptyQuestion?.()||fallbackQuestion);
    }catch(e){return cloneValue(fallbackQuestion)}
  }
  function progressPayload(){
    return {nodes:state.nodes,edges:state.edges,customNodes:state.customNodes,activeKeywords:state.activeKeywords,choiceOffsets:state.choiceOffsets,metrics:state.metrics};
  }
  function writeProgressNow(){
    if(isRecallReadonly())return false;
    if(progressSaveTimer){clearTimeout(progressSaveTimer);progressSaveTimer=0}
    try{
      if(RecallStorage.writeProgress)return RecallStorage.writeProgress(question,recallQuestionBankId(),progressPayload());
      return Store.writeJSON?Store.writeJSON(RecallStorage.progressKey?.(question,recallQuestionBankId())||'',progressPayload()):false;
    }catch(e){return false}
  }
  function saveProgress(){
    if(isRecallReadonly())return;
    if(progressSaveTimer)clearTimeout(progressSaveTimer);
    progressSaveTimer=setTimeout(()=>{progressSaveTimer=0;writeProgressNow()},180);
  }
  function flushProgress(){return writeProgressNow()}
  function cancelProgressSave(){if(progressSaveTimer){clearTimeout(progressSaveTimer);progressSaveTimer=0}}
  function loadProgress(){
    try{
      const raw=RecallStorage.readProgress?.(question,recallQuestionBankId())||null;
      if(raw&&Array.isArray(raw.nodes)&&Array.isArray(raw.edges)){
        state.nodes=raw.nodes;state.edges=raw.edges;state.customNodes=raw.customNodes&&typeof raw.customNodes==='object'?raw.customNodes:{};state.activeKeywords=Array.isArray(raw.activeKeywords)?raw.activeKeywords:[];state.choiceOffsets=raw.choiceOffsets&&typeof raw.choiceOffsets==='object'?raw.choiceOffsets:{};state.metrics=raw.metrics&&typeof raw.metrics==='object'?{keywordClicks:Number(raw.metrics.keywordClicks)||0,choiceClicks:Number(raw.metrics.choiceClicks)||0,nodeOpens:Number(raw.metrics.nodeOpens)||0,sessionStartedAt:Date.now()}:{keywordClicks:0,choiceClicks:0,nodeOpens:0,sessionStartedAt:Date.now()};
        normalizeGraph();
        return true;
      }
    }catch(e){}
    return false;
  }
  function resetProgress(){
    if(isRecallReadonly()){notifyRecallReadonly();return}
    if(!confirm('确定清除这道题已回忆的全部知识点吗？'))return;
    cancelProgressSave();
    try{RecallStorage.removeProgress?.(question,recallQuestionBankId())}catch(e){}
    destroyingNodeIds.clear();
    state.nodes=[];state.edges=[];state.customNodes={};state.activeKeywords=[];state.choiceOffsets={};state.metrics={keywordClicks:0,choiceClicks:0,nodeOpens:0,sessionStartedAt:Date.now()};state.activeNodeId=null;state.lastNewEdgeId='';state.lastNewNodeId='';hideGuide();renderAll();centerOn(0,0,true);
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
  function currentSubject(){return String(question?.subject||question?.metadata?.subjectId||question?.subjectId||'PMP')}
  function associationNode(id){
    const api=window.KGRecallAssociationLibrary;if(!api)return null;
    const offset=Number(state.choiceOffsets?.[id]||0);
    return api.asRecallNode(currentSubject(),id,{limit:4,offset});
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
      map[clue.id]={title:clue.text,nodeId:resolved?.id||clue.recallNodeId||first?.id||clue.id,matchTexts:[clue.text]};
    });
    (q.concepts||[]).forEach(c=>{
      if(c.title&&!Object.values(map).some(r=>String(r.title)===String(c.title))){
        map[c.id]={title:c.title,nodeId:c.id,matchTexts:[c.title,...String(c.keywords||'').split(/[,，、;；|]/).map(x=>x.trim()).filter(Boolean).slice(0,2)]};
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
    const stem=(question.stemParts||[]).map((p,i)=>{
      const text=escapeHTML(p.text||'');
      if(p.clue&&rootConfig(p.clue))return `<span class="kr-keyword ${isKeywordActive(p.clue)?'active':''}" data-keyword-id="${escapeHTML(p.clue)}" data-keyword-index="${i}">${text}</span>`;
      return wrapKnownKeywords(text);
    }).join('');
    const options=(view?.options||[]).length?(view.options||[]).map(o=>`<div class="kr-option"><strong>${escapeHTML(o.id)}</strong><span>${wrapKnownKeywords(escapeHTML(o.display?.zh||''))}${englishLine(o.display)}</span></div>`).join(''):(question.options||[]).map(o=>`<div class="kr-option"><strong>${escapeHTML(o.id)}</strong>${wrapKnownKeywords(escapeHTML(o.text||''))}</div>`).join('');
    const titleZh=view?.title?.zh||question.title||'深度知识回忆';
    const stemEn=view?.stem||{hasEnglish:false};
    questionCard.innerHTML=`<h2 class="kr-question-title">${escapeHTML(titleZh)}${englishLine(view?.title)}</h2><div class="kr-stem">${stem}${englishLine(stemEn)}</div><div class="kr-options">${options}</div>`;
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
        if(safe)matchers.push({key:String(key),text,regex:new RegExp(safe,'g')});
      });
    });
    return matchers.sort((a,b)=>b.text.length-a.text.length);
  }
  function wrapKnownKeywords(escapedText){
    let value=String(escapedText||'');
    const replacements=[];
    for(const item of keywordMatchers){
      item.regex.lastIndex=0;
      value=value.replace(item.regex,match=>{
        const token=`__KR_MATCH_${replacements.length}__`;
        replacements.push(`<span class="kr-keyword ${isKeywordActive(item.key)?'active':''}" data-keyword-id="${escapeHTML(item.key)}">${match}</span>`);
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
      const keyword=event.target.closest('.kr-keyword');
      if(!keyword||!questionCard.contains(keyword))return;
      event.preventDefault();event.stopPropagation();activateKeyword(keyword);
    });
  }
  function activateKeyword(el){
    if(isRecallReadonly()){notifyRecallReadonly();return}
    const key=el.dataset.keywordId;
    const root=rootConfig(key);
    if(!root)return;
    markKeywordActive(key);state.metrics.keywordClicks=(Number(state.metrics.keywordClicks)||0)+1;
    questionCard.querySelectorAll(`.kr-keyword[data-keyword-id="${cssAttr(key)}"]`).forEach(x=>x.classList.add('active'));
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
      renderAll();
      setTimeout(()=>focusNode(node.instanceId,false),40);
    }else{
      saveProgress();
      renderAll();
      focusNode(node.instanceId,false);
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
  function pointCrowdingScore(x,y){
    const rect=nodeRectAt(x,y,18);
    let score=pointBlocksQuestion(x,y)?100000:0;
    state.nodes.forEach(n=>{
      if(rectsOverlap(rect,nodeRectAt(Number(n.x)||0,Number(n.y)||0,16)))score+=12000;
      const dx=(Number(n.x)||0)-x,dy=(Number(n.y)||0)-y;
      const d=Math.max(1,Math.hypot(dx/1.05,dy/1.2));
      score+=Math.max(0,220-d);
    });
    return score;
  }
  function findOpenPosition(candidates,seed=0){
    let best=null,bestScore=Infinity;
    const q=questionBounds(90);
    const expanded=[...candidates];
    for(let ring=1;ring<=6;ring++){
      const radius=ring*120;
      const start=(seed%8)*Math.PI/4;
      for(let i=0;i<12;i++){
        const angle=start+i*Math.PI/6;
        expanded.push({x:Math.cos(angle)*(Math.max(q.width/2+90,radius+380)),y:Math.sin(angle)*(Math.max(q.height/2+70,radius+260))});
      }
    }
    expanded.forEach((p,i)=>{
      const score=pointCrowdingScore(p.x,p.y)+i*.015;
      if(score<bestScore){bestScore=score;best=p}
    });
    if(!best)return {x:0,y:0};
    let x=best.x,y=best.y;
    for(let i=0;i<18&&(pointBlocksQuestion(x,y)||state.nodes.some(n=>rectsOverlap(nodeRectAt(x,y,16),nodeRectAt(Number(n.x)||0,Number(n.y)||0,16))));i++){
      const angle=(seed*.83+i*.72);
      x+=Math.cos(angle)*92;
      y+=Math.sin(angle)*104;
      if(pointBlocksQuestion(x,y)){
        const q2=questionBounds(110);
        if(Math.abs(x)<q2.right)x=x>=0?q2.right+76:q2.left-76;
        if(y>q2.top&&y<q2.bottom)y+=y>=0?96:-96;
      }
    }
    return {x,y};
  }
  function renderNodes(){
    const newNodeId=state.lastNewNodeId;
    nodeLayer.innerHTML=state.nodes.map(n=>{
      const d=getNodeData(n.dataId);
      const display=recallNodeDisplay(n.dataId,d,n);
      const title=display?.title?.zh||n.title||d.title||'知识点';
      const cls=['kr-node',`depth-${Math.min(6,Number(n.depth||0))}`];
      if(state.activeNodeId===n.instanceId)cls.push('is-active');
      if(newNodeId&&newNodeId===n.instanceId)cls.push('is-new');
      return `<div class="${cls.join(' ')}" data-instance-id="${escapeHTML(n.instanceId)}" style="left:${Number(n.x)||0}px;top:${Number(n.y)||0}px"><button type="button" title="${escapeHTML(title)} · 双击删除" aria-label="打开 ${escapeHTML(title)} 的回忆引导；双击删除"><span>${escapeHTML(firstChar(title))}</span></button><div class="kr-node-label">${escapeHTML(title)}${englishLine(display?.title)}</div></div>`;
    }).join('');
    if(newNodeId)setTimeout(()=>{if(state.lastNewNodeId===newNodeId)state.lastNewNodeId=''},520);
  }
  function bindNodeInteractions(){
    if(nodeLayer.dataset.interactionsBound)return;
    nodeLayer.dataset.interactionsBound='1';
    const clearCardClick=()=>{if(cardClickTimer){clearTimeout(cardClickTimer);cardClickTimer=0}};
    nodeLayer.addEventListener('pointerdown',event=>{
      const button=event.target.closest('.kr-node button');if(!button)return;
      button.classList.add('is-pressed');
    });
    const releasePressed=event=>{
      const button=event.target.closest?.('.kr-node button');if(!button)return;
      setTimeout(()=>button.classList.remove('is-pressed'),90);
    };
    nodeLayer.addEventListener('pointerup',releasePressed);
    nodeLayer.addEventListener('pointercancel',releasePressed);
    nodeLayer.addEventListener('click',event=>{
      const button=event.target.closest('.kr-node button');if(!button)return;
      event.preventDefault();event.stopPropagation();
      const instanceId=button.closest('.kr-node')?.dataset.instanceId||'';
      if(!instanceId||destroyingNodeIds.has(instanceId))return;
      if(event.detail>1){clearCardClick();return}
      clearCardClick();
      cardClickTimer=setTimeout(()=>{
        cardClickTimer=0;
        if(destroyingNodeIds.has(instanceId))return;
        const liveButton=nodeLayer.querySelector(`[data-instance-id="${cssAttr(instanceId)}"] button`);
        if(liveButton)openNodeGuide(instanceId,liveButton);
      },280);
    });
    nodeLayer.addEventListener('dblclick',event=>{
      const button=event.target.closest('.kr-node button');if(!button)return;
      event.preventDefault();event.stopPropagation();clearCardClick();button.classList.remove('is-pressed');
      const wrap=button.closest('.kr-node');if(wrap)deleteNode(wrap.dataset.instanceId);
    });
  }
  function renderEdges(){
    const nodeById=new Map(state.nodes.map(node=>[String(node.instanceId),node]));
    const paths=state.edges.map(edge=>{
      const a=nodeById.get(String(edge.from)),b=nodeById.get(String(edge.to));
      if(!a||!b)return '';
      const dx=Math.max(80,Math.abs(b.x-a.x)*.52),c1x=a.x+dx,c2x=b.x-dx*.35;
      const d=`M ${a.x} ${a.y} C ${c1x} ${a.y}, ${c2x} ${b.y}, ${b.x} ${b.y}`;
      const cls=edge.id===state.lastNewEdgeId?'kr-edge new':'kr-edge';
      return `<path class="kr-edge-glow" d="${d}"></path><path class="${cls}" d="${d}"></path>`;
    }).join('');
    edges.innerHTML=paths;
  }
  function renderAll(){renderQuestion();renderNodes();renderEdges();renderStats();updateQuestionNavigator();applyTransform(false)}
  function syncActiveNodeClass(){nodeLayer.querySelectorAll('.kr-node').forEach(wrap=>wrap.classList.toggle('is-active',String(wrap.dataset.instanceId||'')===String(state.activeNodeId||'')))}
  function openNodeGuide(instanceId,anchor,{countOpen=true}={}){
    if(isRecallReadonly()){notifyRecallReadonly();return}
    const node=state.nodes.find(n=>n.instanceId===instanceId);if(!node)return;
    state.activeNodeId=instanceId;customOpen=false;guide.dataset.dragged='';
    if(countOpen){state.metrics.nodeOpens=(Number(state.metrics.nodeOpens)||0)+1;saveProgress()}
    syncActiveNodeClass();
    const liveAnchor=nodeLayer.querySelector(`[data-instance-id="${cssAttr(instanceId)}"] button`)||anchor;
    const d=getNodeData(node.dataId);
    const display=recallNodeDisplay(node.dataId,d,node);
    const allChoices=Array.isArray(d.choices)?d.choices:[];
    const choices=allChoices.slice(0,4);
    const displayChoices=Array.isArray(display?.choices)?display.choices.slice(0,4):[];
    guide.hidden=false;
    guide.innerHTML=`<div class="kr-guide-head"><div><h2>${escapeHTML(display?.title?.zh||d.title||node.title)}${englishLine(display?.title)}</h2><p>${escapeHTML(display?.prompt?.zh||d.prompt||'你还能从这里继续回忆到什么？')}${englishLine(display?.prompt)}</p>${d.hint?`<p><strong>轻提示：</strong>${escapeHTML(display?.hint?.zh||d.hint)}${englishLine(display?.hint)}</p>`:''}</div><button class="kr-guide-close" title="关闭" type="button">×</button></div>${choices.length?`<div class="kr-choice-list">${choices.map((c,i)=>`<button type="button" data-choice-index="${i}">${escapeHTML(displayChoices[i]?.display?.zh||c.text||'继续回忆')}${englishLine(displayChoices[i]?.display)}</button>`).join('')}</div>`:'<div class="kr-empty-choices">这个节点暂时没有预设分支。可以添加自己的回忆节点，让知识地图继续延展。</div>'}<div class="kr-guide-actions">${d.hasMore?'<button class="secondary" id="krMoreChoicesBtn" type="button">换一组</button>':''}<button class="secondary" id="krCustomBtn" type="button">添加我的回忆</button><button class="secondary" id="krCenterNodeBtn" type="button">居中此节点</button></div><div class="kr-custom-form" id="krCustomForm" hidden><input id="krCustomInput" placeholder="输入你想到的知识点，例如：信息发射源" maxlength="30"/><button id="krCustomSaveBtn" type="button">生成</button></div>`;
    guide.querySelector('.kr-guide-close').onclick=closeGuide;
    makeGuideDraggable();
    guide.querySelectorAll('[data-choice-index]').forEach(btn=>btn.onclick=()=>{
      const choice=choices[Number(btn.dataset.choiceIndex)];state.metrics.choiceClicks=(Number(state.metrics.choiceClicks)||0)+1;createChildFromChoice(node,choice,Number(btn.dataset.choiceIndex));
    });
    const customBtn=$('krCustomBtn'),customForm=$('krCustomForm'),customInput=$('krCustomInput'),customSave=$('krCustomSaveBtn'),centerBtn=$('krCenterNodeBtn'),moreBtn=$('krMoreChoicesBtn');
    if(moreBtn)moreBtn.onclick=()=>{state.choiceOffsets[node.dataId]=Number(d.nextOffset)||0;saveProgress();openNodeGuide(instanceId,liveAnchor,{countOpen:false})};
    if(customBtn)customBtn.onclick=()=>{customOpen=!customOpen;customForm.hidden=!customOpen;if(customOpen)setTimeout(()=>customInput&&customInput.focus(),20)};
    const submitCustom=()=>{
      const title=(customInput?.value||'').trim();
      if(!title){
        customInput?.setCustomValidity('请输入要添加的知识点');
        customInput?.reportValidity();
        customInput?.focus();
        return;
      }
      customInput?.setCustomValidity('');
      createCustomChild(node,title);
    };
    if(customSave)customSave.onclick=submitCustom;
    if(customInput){
      customInput.oninput=()=>customInput.setCustomValidity('');
      customInput.onkeydown=e=>{if(e.key==='Enter'){e.preventDefault();submitCustom()}};
    }
    if(centerBtn)centerBtn.onclick=()=>centerOn(node.x,node.y,true);
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
    closeGuide();renderAll();setTimeout(()=>focusNode(child.instanceId,created||connected),60);
  }
  function createCustomChild(parent,title){
    if(isRecallReadonly()){notifyRecallReadonly();return}
    const normalized=String(title||'').trim();
    if(!normalized)return;
    let child=GraphModel.findReusableNode?.(state.nodes,{title:normalized,custom:true})||null;
    let created=false,connected=false;
    if(!child){
      if(!requireRecallNodeLimit(1))return;
      const id='custom-'+uid('idea');
      state.customNodes[id]={title:normalized,prompt:`围绕“${normalized}”，你还能继续想到什么？`,hint:'这是你自己添加的回忆节点，可以继续添加下一层。',choices:[]};
      const pos=childPosition(parent,state.nodes.filter(n=>n.parentId===parent.instanceId).length);
      child={instanceId:uid('node'),dataId:id,rootKey:parent.rootKey,title:normalized,x:pos.x,y:pos.y,parentId:parent.instanceId,depth:Number(parent.depth||0)+1,createdAt:Date.now(),custom:true};
      state.nodes.push(child);state.lastNewNodeId=child.instanceId;created=true;
    }
    if(shouldConnectNodes(parent.instanceId,child.instanceId)){
      const edge={id:uid('edge'),from:parent.instanceId,to:child.instanceId};
      state.edges.push(edge);state.lastNewEdgeId=edge.id;connected=true;
    }
    saveProgress();closeGuide();renderAll();setTimeout(()=>focusNode(child.instanceId,created||connected),60);
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
  }
  function updateZoomDock(){const value=Math.round(state.transform.scale*100),label=$('krZoomLabel'),slider=$('krZoomSlider');if(label)label.textContent=value+'%';if(slider&&document.activeElement!==slider)slider.value=String(Math.max(1,Math.min(400,value)))}
  function showZoomSlider(show=true){const dock=$('krCanvasZoomDock'),popover=$('krZoomSliderPopover');if(!dock||!popover)return;dock.classList.toggle('slider-open',!!show);popover.setAttribute('aria-hidden',show?'false':'true')}
  function applyTransform(smooth){
    world.classList.toggle('smooth',!!smooth);const t=state.transform;world.style.transform=`translate(${t.x}px,${t.y}px) scale(${t.scale})`;updateZoomDock();
    if(smooth)setTimeout(()=>world.classList.remove('smooth'),460);
    if(!guide.hidden&&state.activeNodeId){const wrap=nodeLayer.querySelector(`[data-instance-id="${cssAttr(state.activeNodeId)}"] button`);if(wrap)placeGuide(wrap)}
  }
  function setZoomScale(value,cx,cy,smooth=false){const old=Math.max(MIN_ZOOM,Number(state.transform.scale)||1),next=Math.max(MIN_ZOOM,Math.min(MAX_ZOOM,Number(value)||old));if(Math.abs(next-old)<.0001){updateZoomDock();return}const vp=viewport.getBoundingClientRect(),wx=(cx-vp.left-state.transform.x)/old,wy=(cy-vp.top-state.transform.y)/old;state.transform.scale=next;state.transform.x=cx-vp.left-wx*next;state.transform.y=cy-vp.top-wy*next;applyTransform(smooth)}
  function nextZoomLevel(current,direction,levels){
    const sorted=[...levels].sort((a,b)=>a-b),value=Math.max(MIN_ZOOM,Math.min(MAX_ZOOM,Number(current)||1));
    if(direction>0)return sorted.find(level=>level>value+.0001)??MAX_ZOOM;
    for(let i=sorted.length-1;i>=0;i--)if(sorted[i]<value-.0001)return sorted[i];
    return MIN_ZOOM;
  }
  function zoomByLevel(direction,levels,cx,cy,smooth=false){setZoomScale(nextZoomLevel(state.transform.scale,direction,levels),cx,cy,smooth)}
  function resetZoom(){showZoomSlider(false);state.transform.scale=1;centerOn(0,0,true)}
  function bindCanvas(){
    viewport.addEventListener('pointerdown',e=>{
      if(e.target.closest('.kr-node,.kr-question-card,.kr-guide,.kr-tools,.kr-topbar,.kr-canvas-overlay-left,.kr-question-library-trigger,button,a,input,select,textarea'))return;
      isDragging=true;dragStart={x:e.clientX,y:e.clientY};worldStart={x:state.transform.x,y:state.transform.y};viewport.classList.add('dragging');viewport.setPointerCapture(e.pointerId);closeGuide();
    });
    viewport.addEventListener('pointermove',e=>{if(!isDragging)return;state.transform.x=worldStart.x+e.clientX-dragStart.x;state.transform.y=worldStart.y+e.clientY-dragStart.y;applyTransform(false)});
    viewport.addEventListener('pointerup',e=>{isDragging=false;viewport.classList.remove('dragging');try{viewport.releasePointerCapture(e.pointerId)}catch(_){}});
    viewport.addEventListener('pointercancel',()=>{isDragging=false;viewport.classList.remove('dragging')});
    viewport.addEventListener('wheel',e=>{if(e.target.closest('.kr-canvas-overlay-left,.kr-question-library-trigger,button,a,input,select,textarea'))return;e.preventDefault();zoomByLevel(e.deltaY<0?1:-1,WHEEL_ZOOM_LEVELS,e.clientX,e.clientY,false)},{passive:false});
    viewport.addEventListener('dblclick',e=>{if(e.target.closest('.kr-node,.kr-question-card,.kr-guide,.kr-canvas-overlay-left,.kr-question-library-trigger,button,a,input,select,textarea'))return;centerOn(0,0,true)});
    const rect=viewport.getBoundingClientRect();lastViewportSize={width:rect.width,height:rect.height};
    window.addEventListener('resize',()=>{
      const next=viewport.getBoundingClientRect();
      if(lastViewportSize){
        state.transform.x+=(next.width-lastViewportSize.width)/2;
        state.transform.y+=(next.height-lastViewportSize.height)/2;
      }
      lastViewportSize={width:next.width,height:next.height};
      applyTransform(false);
      if(!state.nodes.length)centerOn(0,0,false);
      if(!guide.hidden&&guide.dataset.dragged==='1'){
        const pos=clampGuidePosition(parseFloat(guide.style.left)||0,parseFloat(guide.style.top)||0);
        guide.style.left=Math.round(pos.left)+'px';guide.style.top=Math.round(pos.top)+'px';
      }
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
    const meta=$('krQuestionDrawerMeta');if(meta)meta.textContent=bank?`${bank.name} · 显示 ${items.length}/${bank.questions.length} 题${bank.missingCount?` · ${bank.missingCount} 题快照不可用`:''}`:'暂无可用的已发布试卷。';
    listEl.innerHTML=items.length?items.map((item,index)=>{
      const explored=exploredIds.has(String(item.id)),active=String(question.sourceCollectionId||'')===String(bank.id)&&String(question.id)===String(item.id);
      return `<button type="button" class="kr-question-item ${active?'active':''}" data-bank-id="${escapeHTML(bank.id)}" data-question-id="${escapeHTML(item.id)}"><span class="kr-question-index">${index+1}</span><span class="kr-question-copy"><strong>${escapeHTML(item.title)}</strong><small>${escapeHTML(item.question?.teacherNumber||item.topic||item.id)}</small></span><em class="${explored?'explored':'unexplored'}">${explored?'已探索':'未探索'}</em></button>`;
    }).join(''):'<div class="kr-question-empty">没有符合当前试卷、搜索或状态筛选的题目。</div>';
  }
  function questionDrawerOpen(){return Boolean($('krQuestionDrawer')?.classList.contains('open'))}
  function openQuestionDrawer(){const drawer=$('krQuestionDrawer'),backdrop=$('krDrawerBackdrop');if(!drawer)return;renderQuestionList();drawer.classList.add('open');drawer.setAttribute('aria-hidden','false');if(backdrop){backdrop.hidden=false;requestAnimationFrame(()=>backdrop.classList.add('show'))}}
  function closeQuestionDrawer(){const drawer=$('krQuestionDrawer'),backdrop=$('krDrawerBackdrop');if(!drawer)return;drawer.classList.remove('open');drawer.setAttribute('aria-hidden','true');if(backdrop){backdrop.classList.remove('show');setTimeout(()=>backdrop.hidden=true,180)}}
  function switchQuestion(bankId,questionId){
    flushProgress();questionSessionToken+=1;cancelProgressSave();
    const result=window.KGRecallQuestionSource?.activate?.(bankId,questionId);if(!result?.valid){notifyRecallLimit((result?.errors||['题目切换失败。']).join('；'));return false}
    question=result.question;questionBrowser.bankId=String(result.collection?.id||result.bank?.id||bankId||question.sourceCollectionId||'');
    try{const url=new URL(location.href);url.searchParams.set('paperId',String(question.sourcePaperId||''));url.searchParams.set('releaseId',String(question.sourceReleaseId||''));url.searchParams.set('bankId',String(question.sourceBankId||''));url.searchParams.set('questionId',String(question.id||''));url.searchParams.delete('collectionId');history.replaceState(null,'',url.pathname+url.search+url.hash)}catch(e){}
    rootMap=buildRootMap(question);keywordMatchers=buildKeywordMatchers(rootMap);
    destroyingNodeIds.clear();
    state={nodes:[],edges:[],lastNewEdgeId:'',lastNewNodeId:'',activeNodeId:null,activeKeywords:[],transform:{x:0,y:0,scale:1},customNodes:{},choiceOffsets:{},metrics:{keywordClicks:0,choiceClicks:0,nodeOpens:0,sessionStartedAt:Date.now()}};
    loadProgress();closeGuide();closeQuestionDrawer();renderAll();setTimeout(()=>centerOn(0,0,true),30);enforceRecallPermission();return true;
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
  function bindTools(){
    $('krCenterBtn').onclick=()=>centerOn(0,0,true);
    $('krResetBtn').onclick=resetProgress;
    $('krZoomInBtn').onclick=()=>{const r=viewport.getBoundingClientRect();zoomByLevel(1,BUTTON_ZOOM_LEVELS,r.left+r.width/2,r.top+r.height/2,true)};
    $('krZoomOutBtn').onclick=()=>{const r=viewport.getBoundingClientRect();zoomByLevel(-1,BUTTON_ZOOM_LEVELS,r.left+r.width/2,r.top+r.height/2,true)};
    $('krZoomLabel').onclick=resetZoom;
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
  function init(){
    if(typeof GraphModel.normalizeGraph!=='function'||typeof GraphModel.removeNode!=='function'||typeof GraphModel.canConnect!=='function'){
      notifyRecallLimit('深度回忆图模型加载失败，请刷新页面后重试。');
      return;
    }
    if(!enforceRecallPermission())return;
    applyRandomHighlight();bindThemeSelect();bindCanvas();bindQuestionInteractions();bindNodeInteractions();bindTools();bindQuestionDrawer();bindLanguageMode();loadProgress();renderAll();
    setTimeout(()=>centerOn(0,0,false),30);
  }
  window.addEventListener('pagehide',flushProgress);
  document.addEventListener('visibilitychange',()=>{if(document.visibilityState==='hidden')flushProgress()});
  document.addEventListener('DOMContentLoaded',init);
})();
