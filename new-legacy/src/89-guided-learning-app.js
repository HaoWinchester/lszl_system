'use strict';

/*
 * GuidedLearningPathApp v12
 * 纵向 S 曲线阶段路径、辅助练习锚点吸附、当前部分联动标题与立体按压节点。
 */
(function(global){
  const byId=id=>document.getElementById(id);
  const data=()=>global.KGGuidedLearningData;
  const store=()=>global.KGGuidedLearningStore;
  const icons=()=>global.KGGuidedLearningIconRegistry;
  const pathLayoutEngine=()=>global.KGGuidedLearningPathLayout;
  const state={
    course:null,
    progress:null,
    selectedStageId:'',
    currentStageId:'',
    activePartId:'',
    pickerOpen:false,
    subjectMenuOpen:false,
    requestedPartId:'',
    practiceReturn:false,
    placementPartId:'',
    placementNormalHref:'',
    drag:null,
    scrollSaveTimer:0,
    bound:false
  };

  const SCROLL_KEY_PREFIX='kg_guided_path_scroll_v3__';
  const PART_THEMES=Object.freeze([
    Object.freeze({key:'magenta',main:'#cf2080',dark:'#a71665',base:'#7d104b',soft:'#fbe4f1',foreground:'#ffffff',currentForeground:'#ffffff'}),
    Object.freeze({key:'red',main:'#ef5054',dark:'#c9383d',base:'#9f252a',soft:'#fde7e8',foreground:'#ffffff',currentForeground:'#ffffff'}),
    Object.freeze({key:'orange',main:'#f7a24a',dark:'#d97918',base:'#a95008',soft:'#fff0df',foreground:'#ffffff',currentForeground:'#ffffff'}),
    Object.freeze({key:'yellow',main:'#f7e768',dark:'#d4a800',base:'#987600',soft:'#fff8ca',foreground:'#453a00',currentForeground:'#ffffff'}),
    Object.freeze({key:'green',main:'#4faa61',dark:'#328844',base:'#216d33',soft:'#e4f4e7',foreground:'#ffffff',currentForeground:'#ffffff'}),
    Object.freeze({key:'cyan',main:'#74beee',dark:'#328fcb',base:'#1e6f9f',soft:'#e3f4ff',foreground:'#173d55',currentForeground:'#ffffff'}),
    Object.freeze({key:'blue',main:'#4f8dec',dark:'#2d67c7',base:'#214e9b',soft:'#e4edff',foreground:'#ffffff',currentForeground:'#ffffff'}),
    Object.freeze({key:'purple',main:'#a46de0',dark:'#7d43bd',base:'#5f2d97',soft:'#f0e7fb',foreground:'#ffffff',currentForeground:'#ffffff'})
  ]);

  function escapeHTML(value){return String(value??'').replace(/[&<>"']/g,char=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[char]))}
  function cssEscape(value){return global.CSS?.escape?global.CSS.escape(String(value)):String(value).replace(/(["\\])/g,'\\$1')}
  function toast(message){const element=byId('status');if(!element)return;clearTimeout(toast.timer);element.textContent=String(message||'');element.classList.add('show');toast.timer=setTimeout(()=>element.classList.remove('show'),2400)}
  function setText(id,value){const element=byId(id);if(element)element.textContent=String(value??'')}
  function partForNode(node){return state.course.parts.find(part=>part.id===node?.partId)||null}
  function stageForNode(node){const part=partForNode(node);return state.course.stages.find(stage=>stage.id===part?.stageId)||null}
  function currentNode(){
    const explicitId=String(state.progress?.currentNodeId||'');
    const explicit=state.course.nodes.find(node=>String(node.id)===explicitId);
    if(explicit&&state.progress.nodes[explicit.id]?.status==='available')return explicit;
    const available=state.course.nodes.filter(node=>state.progress.nodes[node.id]?.status==='available');
    return available.at(-1)||state.course.nodes.at(-1)||null;
  }
  function isAdminUser(){
    try{
      const user=global.KGAuthCore?.currentUser?.();
      if(user?.role)return String(user.role)==='admin';
      return String(global.KGRolePermissions?.currentRole?.()||'')==='admin';
    }catch(error){return false}
  }
  function selectedStage(){return state.course.stages.find(item=>item.id===state.selectedStageId)||state.course.stages[0]}
  function selectedStageParts(){
    const stage=selectedStage();
    return state.course.parts.filter(part=>part.stageId===stage?.id).sort((a,b)=>a.order-b.order);
  }
  function stageNodes(stageId){
    const partIds=new Set(state.course.parts.filter(part=>part.stageId===stageId).map(part=>part.id));
    return state.course.nodes.filter(node=>partIds.has(node.partId));
  }
  function stageStatus(stageId){
    const nodes=stageNodes(stageId);
    if(nodes.length&&nodes.every(node=>['completed','recompleted'].includes(state.progress.nodes[node.id]?.status)))return 'completed';
    if(isAdminUser())return 'available';
    if(nodes.some(node=>['available','completed','recompleted'].includes(state.progress.nodes[node.id]?.status)))return 'available';
    return 'locked';
  }
  function themeForPart(part){
    const explicit=String(part?.colorKey||'').trim().toLowerCase();
    const configured=PART_THEMES.find(theme=>theme.key===explicit);
    if(configured)return configured;
    const globalIndex=Math.max(0,state.course?.parts?.findIndex(item=>item.id===part?.id)??0);
    const configuredIndex=Number(part?.colorIndex);
    const index=Number.isInteger(configuredIndex)?configuredIndex:globalIndex;
    return PART_THEMES[((index%PART_THEMES.length)+PART_THEMES.length)%PART_THEMES.length];
  }
  function themeStyle(theme){
    return '--gl-part-main:'+theme.main+';--gl-part-dark:'+theme.dark+';--gl-part-base:'+theme.base+';--gl-part-soft:'+theme.soft+';--gl-part-foreground:'+theme.foreground+';--gl-part-current-foreground:'+theme.currentForeground;
  }
  function applyTheme(element,theme){
    if(!element||!theme)return;
    element.dataset.partTheme=theme.key;
    element.style.setProperty('--gl-part-main',theme.main);
    element.style.setProperty('--gl-part-dark',theme.dark);
    element.style.setProperty('--gl-part-base',theme.base);
    element.style.setProperty('--gl-part-soft',theme.soft);
    element.style.setProperty('--gl-part-foreground',theme.foreground);
    element.style.setProperty('--gl-part-current-foreground',theme.currentForeground);
  }
  function defaultActivePart(){
    const parts=selectedStageParts();
    const current=partForNode(currentNode());
    if(current&&current.stageId===selectedStage()?.id)return current;
    return parts[0]||null;
  }
  function activePart(){
    const parts=selectedStageParts();
    return parts.find(part=>part.id===state.activePartId)||defaultActivePart()||parts[0]||null;
  }
  function ensureActivePart(){
    const parts=selectedStageParts();
    if(!parts.some(part=>part.id===state.activePartId))state.activePartId=defaultActivePart()?.id||parts[0]?.id||'';
  }
  function resolveStages(){
    const node=currentNode();
    state.currentStageId=stageForNode(node)?.id||state.course.stages[0]?.id||'';
    const params=new URLSearchParams(global.location.search);
    const requested=params.get('stage');
    state.selectedStageId=state.course.stages.some(stage=>stage.id===requested)?requested:(state.selectedStageId||state.currentStageId);
    const requestedPart=params.get('part');
    state.requestedPartId=state.course.parts.some(part=>part.id===requestedPart&&part.stageId===state.selectedStageId)?requestedPart:'';
    state.practiceReturn=params.get('practiceReturn')==='1';
    state.activePartId=state.requestedPartId||state.activePartId;
    ensureActivePart();
  }
  function loadProgress(){state.progress=store().read(state.course);resolveStages()}
  function nodeHref(nodeId){return 'guided-learning-node.html?node='+encodeURIComponent(nodeId)}
  function placementTestHref(partId){return 'guided-learning-placement-test.html?part='+encodeURIComponent(partId)}
  function placementTestForPart(partId){return data()?.placementTestForPart?.(partId)||null}
  function placementOfferAvailable(node,entry){
    if(isAdminUser()||Number(node?.order)!==1||entry?.status==='locked')return false;
    const config=placementTestForPart(node.partId);
    if(!config)return false;
    return !store().partSummary(state.course,node.partId,state.progress).done;
  }
  function currentUsername(){return global.KGAuthCore?.currentUsername?.()||'guest'}
  function scrollStorageKey(stageId){return SCROLL_KEY_PREFIX+encodeURIComponent(currentUsername())+'__'+encodeURIComponent(state.course.id)+'__'+encodeURIComponent(stageId)}
  function readSavedScroll(stageId){
    try{
      const raw=global.localStorage?.getItem(scrollStorageKey(stageId));
      if(raw===null||raw==='')return null;
      const value=Number(raw);
      return Number.isFinite(value)&&value>=0?value:null;
    }catch(error){return null}
  }
  function writeSavedScroll(stageId,value){
    try{global.localStorage?.setItem(scrollStorageKey(stageId),String(Math.max(0,Math.round(Number(value)||0))))}catch(error){}
  }
  function clearSavedScroll(){
    try{state.course.stages.forEach(stage=>global.localStorage?.removeItem(scrollStorageKey(stage.id)))}catch(error){}
  }

  function renderStageSwitch(){
    const stage=selectedStage();
    const part=activePart();
    const parts=selectedStageParts();
    const theme=themeForPart(part||parts[0]);
    const indexText=part?'第 '+stage.order+' 阶段 · 第 '+part.order+' 部分':'第 '+stage.order+' 阶段 · '+parts.length+' 个部分';
    byId('glStageIndex').textContent=indexText;
    byId('glStageTitle').textContent=part?.title||stage.title;
    byId('glStageDescription').textContent=part?.objective||stage.goal||stage.description||'';
    const switchButton=byId('glStageSwitch');
    applyTheme(switchButton,theme);
    switchButton?.setAttribute('aria-label','选择学习阶段。当前为'+indexText+'，'+(part?.title||stage.title));
    const toggle=byId('glDefaultMode');if(toggle)toggle.checked=store().defaultMode()==='learning';
    const menuToggle=byId('glDefaultModeMenu');if(menuToggle)menuToggle.checked=store().defaultMode()==='learning';
  }

  function renderStageList(){
    const container=byId('glStageList');if(!container)return;
    container.innerHTML=state.course.stages.map(stage=>{
      const status=stageStatus(stage.id),selected=stage.id===state.selectedStageId;
      const summary=store().stageSummary(state.course,stage.id,state.progress);
      const stageParts=state.course.parts.filter(part=>part.stageId===stage.id).sort((a,b)=>a.order-b.order);
      const statusText=selected?'当前查看':status==='completed'?'已完成':isAdminUser()?'管理员可测试':status==='available'?(summary.completed+' / '+summary.total):'未解锁';
      const theme=themeForPart(selected?activePart():stageParts[0]);
      return '<button type="button" class="gl-stage-option is-'+status+(selected?' is-selected':'')+'" style="'+themeStyle(theme)+'" data-gl-stage="'+escapeHTML(stage.id)+'" aria-pressed="'+(selected?'true':'false')+'">'
        +'<span class="gl-stage-option-index">'+stage.order+'</span>'
        +'<span class="gl-stage-option-copy"><strong>'+escapeHTML(stage.title)+'</strong><small>'+stageParts.length+' 个部分 · '+escapeHTML(stage.goal||stage.description||'基础学习阶段')+'</small></span>'
        +'<span class="gl-stage-option-status">'+escapeHTML(statusText)+'</span></button>';
    }).join('');
  }

  function nodeIconMarkup(node){
    const key=node.iconKey||(node.isChallenge?'challenge':node.nodeType)||'fallback';
    const rendered=icons()?.render?.(key,{className:'gl-node-svg'});
    if(rendered)return rendered;
    return '<svg class="gl-node-svg" data-icon-key="fallback" viewBox="0 0 24 24" aria-hidden="true" focusable="false"><circle cx="12" cy="12" r="7" fill="currentColor"/></svg>';
  }
  function pathLayout(nodes,entries){
    return pathLayoutEngine()?.createPartLayout?.(nodes,entries,{top:122,gap:154,bottom:132,amplitudePercent:20,searchRadius:1})||{
      height:Math.max(420,122+Math.max(0,nodes.length-1)*154+132),
      viewBox:'0 0 1000 2000',curvePath:'',
      nodePositions:nodes.map((node,index)=>({node,index,order:Number(node.order)||index+1,leftPercent:50,top:122+index*154})),
      entryPositions:[]
    };
  }

  function nodeMarkup(node,index,total,layout){
    const entry=state.progress.nodes[node.id]||{status:'locked'};
    const rawStatus=String(entry.status||'locked');
    const status=['available','completed','recompleted'].includes(rawStatus)?rawStatus:'locked';
    const adminOpen=isAdminUser()&&status==='locked';
    const statusClass=adminOpen?'admin-open':status;
    const available=status==='available';
    const isCurrent=available&&String(state.progress.currentNodeId||currentNode()?.id||'')===String(node.id);
    const completed=status==='completed'||status==='recompleted';
    const accessible=adminOpen||status!=='locked';
    const placementOffer=placementOfferAvailable(node,entry);
    const label=status==='recompleted'?'再次完成':completed?'已完成':adminOpen?'管理员测试':available?'开始学习':'未解锁';
    const position=layout?.nodePositions?.[index]||{leftPercent:50,top:122+index*154};
    const inlineStyle='--gl-path-top:'+Math.round(position.top)+'px;--gl-path-left:'+Number(position.leftPercent||50).toFixed(3)+'%';
    const nodeTitle=String(node.title||'未命名节点');
    return '<div class="gl-path-node is-'+statusClass+(isCurrent?' is-current':'')+'" style="'+inlineStyle+'" data-node-wrap="'+escapeHTML(node.id)+'">'
      +'<a class="gl-node-button" '+(accessible?'href="'+nodeHref(node.id)+'"':'aria-disabled="true" tabindex="-1"')+(placementOffer?' data-gl-placement-part="'+escapeHTML(node.partId)+'"':'')+' data-gl-node="'+escapeHTML(node.id)+'" title="'+escapeHTML(nodeTitle)+'" aria-label="'+escapeHTML(nodeTitle+'，'+label)+'">'
      +'<span class="gl-node-base" aria-hidden="true"></span><span class="gl-node-face"><span class="gl-node-icon">'+nodeIconMarkup(node)+'</span></span>'
      +(placementOffer?'<span class="gl-placement-badge" aria-hidden="true">跳级</span>':'')+'</a>'
      +'<span class="gl-node-copy"><strong>'+escapeHTML(nodeTitle)+'</strong></span>'
      +'</div>';
  }

  function practiceEntryHref(entry,part){
    const navigation=global.KGPracticeNavigation;
    const context={stageId:part.stageId,partId:part.id,entryId:entry.id};
    return navigation?.buildPracticeHref?.(entry.target,context)||String(entry.target||'#');
  }
  function practiceEntryMarkup(entry,part,nodes,layout,index){
    const position=layout?.entryPositions?.[index]||{top:122,side:'right',anchorOrder:1,targetOrder:1};
    const side=position.side==='left'?'left':'right';
    const style='--gl-practice-top:'+Math.round(position.top)+'px';
    return '<a class="gl-practice-entry is-'+escapeHTML(entry.type||'practice')+' is-'+side+'-lane" style="'+style+'" href="'+escapeHTML(practiceEntryHref(entry,part))+'" data-gl-practice-entry="'+escapeHTML(entry.id)+'" data-gl-practice-part="'+escapeHTML(part.id)+'" data-gl-practice-anchor="'+escapeHTML(position.anchorOrder)+'" aria-label="'+escapeHTML(entry.title+'，自由练习，不计成绩')+'" title="'+escapeHTML(entry.title||'自由练习')+'">'
      +'<img class="gl-practice-image" src="'+escapeHTML(entry.image||'')+'" data-still-src="'+escapeHTML(entry.stillImage||entry.image||'')+'" alt="" />'
      +'</a>';
  }

  function partMarkup(part){
    const nodes=state.course.nodes.filter(node=>node.partId===part.id).sort((a,b)=>a.order-b.order);
    const dividerTitle='第 '+part.order+' 部分 · '+part.title+(part.objective?'：'+part.objective:'');
    const theme=themeForPart(part);
    const layout=pathLayout(nodes,part.practiceEntries||[]);
    const pathStyle='--gl-part-path-height:'+Math.round(layout.height)+'px';
    const curve=layout.curvePath?'<svg class="gl-part-path-curve" viewBox="'+escapeHTML(layout.viewBox)+'" preserveAspectRatio="none" aria-hidden="true" focusable="false"><path d="'+escapeHTML(layout.curvePath)+'"></path></svg>':'';
    return '<section class="gl-part'+(part.id===state.activePartId?' is-active':'')+'" style="'+themeStyle(theme)+';'+pathStyle+'" data-part="'+escapeHTML(part.id)+'" data-part-order="'+part.order+'">'
      +'<aside class="gl-part-divider" title="'+escapeHTML(dividerTitle)+'" aria-label="'+escapeHTML(dividerTitle)+'">'
      +'<span class="gl-part-divider-copy"><strong>第 '+part.order+' 部分</strong><span>'+escapeHTML(part.title)+'</span></span></aside>'
      +'<div class="gl-part-path"><div class="gl-part-path-track">'+curve+nodes.map((node,index)=>nodeMarkup(node,index,nodes.length,layout)).join('')+(part.practiceEntries||[]).map((entry,index)=>practiceEntryMarkup(entry,part,nodes,layout,index)).join('')+'</div></div>'
      +'</section>';
  }

  function renderSubjectButton(){
    const button=byId('glSubjectBtn');
    if(button){
      button.textContent=String(state.course?.subject||'P').slice(0,1);
      button.title=(state.course?.subject||'科目')+'：'+(state.course?.title||'学习路径');
    }
  }

  function renderPath(){
    const stage=selectedStage();
    const parts=selectedStageParts();
    const container=byId('glPathParts');if(!container)return;
    container.innerHTML='<section class="gl-stage-path-shell">'
      +'<div class="gl-stage-path-tools"><div><button type="button" data-gl-scroll="-1" aria-label="向上浏览" title="向上浏览">↑</button><button type="button" data-gl-scroll="1" aria-label="向下浏览" title="向下浏览">↓</button></div></div>'
      +'<div class="gl-stage-path-scroll" id="glStagePathScroll" tabindex="0" aria-label="'+escapeHTML(stage.title)+'纵向 S 曲线学习路径">'
      +'<div class="gl-stage-path-track">'+parts.map(partMarkup).join('')+'</div></div>'
      +'</section>';
    container.querySelectorAll('[data-gl-scroll]').forEach(button=>button.addEventListener('click',()=>scrollStage(Number(button.dataset.glScroll||0))));
    bindStageScroller();
    requestAnimationFrame(restoreStagePosition);
  }

  function stageScroller(){return byId('glStagePathScroll')}
  function scrollCurrentNodeIntoView(behavior='auto'){
    if(state.selectedStageId!==state.currentStageId)return;
    const node=currentNode();
    const wrap=document.querySelector('[data-node-wrap="'+cssEscape(node?.id||'')+'"]');
    const scroller=stageScroller();
    if(!wrap||!scroller)return;
    const wrapRect=wrap.getBoundingClientRect(),scrollRect=scroller.getBoundingClientRect();
    const relativeTop=scroller.scrollTop+(wrapRect.top-scrollRect.top);
    const target=Math.max(0,Math.min(scroller.scrollHeight-scroller.clientHeight,relativeTop-scroller.clientHeight*.46+wrap.clientHeight/2));
    if(behavior==='auto'){
      const previousBehavior=scroller.style.scrollBehavior;
      scroller.style.scrollBehavior='auto';
      scroller.scrollTop=target;
      global.requestAnimationFrame(()=>{scroller.style.scrollBehavior=previousBehavior});
    }else if(scroller.scrollTo){
      scroller.scrollTo({top:target,behavior});
    }else{
      scroller.scrollTop=target;
    }
  }
  function setActivePart(partId,{force=false}={}){
    const part=selectedStageParts().find(item=>item.id===String(partId||''));
    if(!part)return;
    if(!force&&state.activePartId===part.id)return;
    state.activePartId=part.id;
    document.querySelectorAll('.gl-part').forEach(element=>element.classList.toggle('is-active',element.dataset.part===part.id));
    renderStageSwitch();
    renderStageList();
  }
  function syncActivePartFromScroll(force=false){
    const scroller=stageScroller();if(!scroller)return;
    const parts=[...scroller.querySelectorAll('.gl-part')];if(!parts.length)return;
    const activationPoint=scroller.scrollTop+88;
    let candidate=parts[0];
    for(const element of parts){
      const divider=element.querySelector('.gl-part-divider');
      const threshold=(divider?.offsetTop||0)+element.offsetTop;
      if(threshold<=activationPoint)candidate=element;
      else break;
    }
    setActivePart(candidate.dataset.part,{force});
  }
  function restoreStagePosition(){
    const scroller=stageScroller();if(!scroller)return;
    const saved=readSavedScroll(state.selectedStageId);
    const previousBehavior=scroller.style.scrollBehavior;
    scroller.style.scrollBehavior='auto';
    if(state.practiceReturn&&saved!==null){
      scroller.scrollTop=Math.min(saved,Math.max(0,scroller.scrollHeight-scroller.clientHeight));
    }else if(state.requestedPartId){
      const requested=scroller.querySelector('[data-part=+cssEscape(state.requestedPartId)+]');
      scroller.scrollTop=Math.max(0,(requested?.offsetTop||0)-26);
    }else if(saved!==null){
      scroller.scrollTop=Math.min(saved,Math.max(0,scroller.scrollHeight-scroller.clientHeight));
    }else if(state.selectedStageId===state.currentStageId){
      scroller.scrollTop=0;
      global.requestAnimationFrame(()=>scrollCurrentNodeIntoView('auto'));
    }else{
      scroller.scrollTop=0;
    }
    global.requestAnimationFrame(()=>{scroller.style.scrollBehavior=previousBehavior});
    syncActivePartFromScroll(true);
    updateCurrentLocator();
    updateScrollControls();
  }
  function flushStagePosition(){
    const pending=flushStagePosition.pending;
    if(!pending)return;
    clearTimeout(state.scrollSaveTimer);
    state.scrollSaveTimer=0;
    writeSavedScroll(pending.stageId,pending.value);
    flushStagePosition.pending=null;
  }
  function saveStagePosition(){
    const scroller=stageScroller();if(!scroller)return;
    const pending={stageId:state.selectedStageId,value:scroller.scrollTop};
    flushStagePosition.pending=pending;
    clearTimeout(state.scrollSaveTimer);
    state.scrollSaveTimer=setTimeout(()=>{
      writeSavedScroll(pending.stageId,pending.value);
      if(flushStagePosition.pending===pending)flushStagePosition.pending=null;
    },80);
  }
  function scrollStage(direction){
    const scroller=stageScroller();if(!scroller)return;
    const delta=direction*Math.max(420,scroller.clientHeight*.78);
    const target=Math.max(0,Math.min(scroller.scrollHeight-scroller.clientHeight,scroller.scrollTop+delta));
    scroller.scrollTop=target;
  }
  function updateScrollControls(){
    const scroller=stageScroller();if(!scroller)return;
    const max=Math.max(0,scroller.scrollHeight-scroller.clientHeight);
    document.querySelectorAll('[data-gl-scroll]').forEach(button=>{
      const direction=Number(button.dataset.glScroll||0);
      button.disabled=direction<0?scroller.scrollTop<=2:scroller.scrollTop>=max-2;
    });
  }
  function bindStageScroller(){
    const scroller=stageScroller();if(!scroller)return;
    scroller.addEventListener('scroll',()=>{saveStagePosition();scheduleViewportUpdate()},{passive:true});
    scroller.addEventListener('pointerdown',event=>{
      if(event.pointerType!=='mouse'||event.button!==0)return;
      if(event.target.closest?.('a,button'))return;
      state.drag={pointerId:event.pointerId,startY:event.clientY,startTop:scroller.scrollTop,moved:false};
      scroller.setPointerCapture?.(event.pointerId);
      scroller.classList.add('is-dragging');
    });
    scroller.addEventListener('pointermove',event=>{
      if(!state.drag||state.drag.pointerId!==event.pointerId)return;
      const delta=event.clientY-state.drag.startY;
      if(Math.abs(delta)>4)state.drag.moved=true;
      scroller.scrollTop=state.drag.startTop-delta;
    });
    const endDrag=event=>{
      if(!state.drag||state.drag.pointerId!==event.pointerId)return;
      state.drag=null;scroller.classList.remove('is-dragging');
      try{scroller.releasePointerCapture?.(event.pointerId)}catch(error){}
    };
    scroller.addEventListener('pointerup',endDrag);
    scroller.addEventListener('pointercancel',endDrag);
  }

  function updateCurrentLocator(){
    const button=byId('glCurrentNodeBtn');
    const icon=button?.querySelector('span');
    if(!button||!icon)return;
    if(state.selectedStageId!==state.currentStageId){icon.textContent='↩';return}
    const node=currentNode();
    const wrap=document.querySelector('[data-node-wrap="'+cssEscape(node?.id||'')+'"]');
    const scroller=stageScroller();
    if(!wrap||!scroller){icon.textContent='↩';return}
    const rect=wrap.getBoundingClientRect(),viewport=scroller.getBoundingClientRect();
    if(rect.bottom<viewport.top+24)icon.textContent='↑';
    else if(rect.top>viewport.bottom-24)icon.textContent='↓';
    else icon.textContent='◎';
  }
  function scheduleViewportUpdate(){
    if(scheduleViewportUpdate.frame)return;
    scheduleViewportUpdate.frame=global.requestAnimationFrame(()=>{
      scheduleViewportUpdate.frame=0;
      updateCurrentLocator();
      updateScrollControls();
      syncActivePartFromScroll();
    });
  }

  function openStagePicker(){
    state.pickerOpen=true;
    const picker=byId('glStagePicker');
    picker?.classList.add('is-open');picker?.setAttribute('aria-hidden','false');
    byId('glStageSwitch')?.setAttribute('aria-expanded','true');
    renderStageList();
    requestAnimationFrame(()=>picker?.querySelector('.gl-stage-option.is-selected')?.focus());
  }
  function closeStagePicker(){
    state.pickerOpen=false;
    const picker=byId('glStagePicker');
    picker?.classList.remove('is-open');picker?.setAttribute('aria-hidden','true');
    byId('glStageSwitch')?.setAttribute('aria-expanded','false');
  }
  function openPlacementChoice(partId,normalHref){
    const part=state.course.parts.find(item=>item.id===String(partId||''));
    const config=placementTestForPart(part?.id);
    if(!part||!config)return;
    state.placementPartId=part.id;
    state.placementNormalHref=String(normalHref||nodeHref(state.course.nodes.find(node=>node.partId===part.id&&node.order===1)?.id||''));
    setText('glPlacementPartTitle',part.title);
    setText('glPlacementPartDescription',config.description||'通过代表性测试后可直接开放本部分。');
    setText('glPlacementRequirements','共 '+config.expectedActivityCount+' 项 · 答对至少 '+config.requiredCorrect+' 项 · 预计 '+config.estimatedMinutes+' 分钟');
    const record=store().placementTestRecord?.(state.course,part.id);
    const history=byId('glPlacementHistory');
    if(history){
      history.hidden=!record;
      history.textContent=record?(record.passed?'此前已通过测试。':'此前最好成绩 '+record.bestCorrect+' / '+config.expectedActivityCount+'，可以再次尝试。'):'';
    }
    const modal=byId('glPlacementChoice');
    modal?.classList.add('is-open');
    modal?.setAttribute('aria-hidden','false');
    requestAnimationFrame(()=>byId('glPlacementNormalBtn')?.focus());
  }
  function closePlacementChoice(){
    const modal=byId('glPlacementChoice');
    modal?.classList.remove('is-open');
    modal?.setAttribute('aria-hidden','true');
    state.placementPartId='';
    state.placementNormalHref='';
  }
  function setSelectedStage(stageId,options={}){
    if(!state.course.stages.some(stage=>stage.id===stageId))return;
    flushStagePosition();
    state.selectedStageId=stageId;
    state.activePartId=String(options.partId||'');
    state.requestedPartId=state.activePartId;
    ensureActivePart();
    const url=new URL(global.location.href);url.searchParams.set('stage',stageId);
    const resolvedPart=state.activePartId||'';
    if(resolvedPart)url.searchParams.set('part',resolvedPart);else url.searchParams.delete('part');
    global.history.replaceState({},'',url);
    closeStagePicker();renderAll();
  }
  function bind(){
    if(state.bound)return;
    state.bound=true;
    byId('glStageSwitch')?.addEventListener('click',()=>state.pickerOpen?closeStagePicker():openStagePicker());
    byId('glStagePickerClose')?.addEventListener('click',closeStagePicker);
    byId('glStagePicker')?.addEventListener('click',event=>{if(event.target===event.currentTarget)closeStagePicker()});
    byId('glStageList')?.addEventListener('click',event=>{
      const button=event.target.closest?.('[data-gl-stage]');if(button)setSelectedStage(button.dataset.glStage);
    });
    byId('glPathParts')?.addEventListener('click',event=>{
      const practice=event.target.closest?.('[data-gl-practice-entry]');
      if(practice){
        event.preventDefault();
        const scroller=stageScroller();
        if(scroller)writeSavedScroll(state.selectedStageId,scroller.scrollTop);
        const part=state.course.parts.find(item=>item.id===practice.dataset.glPracticePart)||activePart();
        global.KGPracticeNavigation?.saveContext?.({source:'guided-learning',stageId:part?.stageId||state.selectedStageId,partId:part?.id||state.activePartId,entryId:practice.dataset.glPracticeEntry,returnUrl:'learning-path.html?stage='+encodeURIComponent(part?.stageId||state.selectedStageId)+'&part='+encodeURIComponent(part?.id||state.activePartId)+'&practiceReturn=1',scrollTop:scroller?.scrollTop||0});
        global.location.href=practice.getAttribute('href');
        return;
      }
      const placement=event.target.closest?.('[data-gl-placement-part]');
      if(placement&&!isAdminUser()){
        event.preventDefault();
        openPlacementChoice(placement.dataset.glPlacementPart,placement.getAttribute('href'));
      }
    });
    byId('glPlacementClose')?.addEventListener('click',closePlacementChoice);
    byId('glPlacementChoice')?.addEventListener('click',event=>{if(event.target===event.currentTarget)closePlacementChoice()});
    byId('glPlacementNormalBtn')?.addEventListener('click',()=>{if(state.placementNormalHref)global.location.href=state.placementNormalHref});
    byId('glPlacementTestBtn')?.addEventListener('click',()=>{if(state.placementPartId)global.location.href=placementTestHref(state.placementPartId)});
    document.addEventListener('keydown',event=>{
      if(event.key!=='Escape')return;
      if(state.placementPartId)closePlacementChoice();
      else if(state.pickerOpen)closeStagePicker();
    });
    byId('glCurrentNodeBtn')?.addEventListener('click',()=>{
      if(state.selectedStageId!==state.currentStageId){
        const node=currentNode();
        const part=partForNode(node);
        setSelectedStage(state.currentStageId,{partId:part?.id||''});
        global.requestAnimationFrame(()=>scrollCurrentNodeIntoView('smooth'));
        return;
      }
      scrollCurrentNodeIntoView('smooth');
    });
    byId('glResetBtn')?.addEventListener('click',()=>{
      if(global.confirm?.('确定重置这门示范课程的全部节点完成记录？')===false)return;
      clearSavedScroll();
      state.progress=store().resetCourse(state.course);resolveStages();renderAll();toast('学习路径已重置。');
    });
    byId('glDefaultMode')?.addEventListener('change',event=>{
      store().setDefaultMode(event.target.checked?'learning':'free');
      toast(event.target.checked?'以后默认进入学习模式。':'以后默认进入自由模式。');
    });
    byId('glDefaultModeMenu')?.addEventListener('change',event=>{
      store().setDefaultMode(event.target.checked?'learning':'free');
      renderStageSwitch();
      toast(event.target.checked?'以后默认进入学习模式。':'以后默认进入自由模式。');
    });
    byId('glDefaultModeRow')?.addEventListener('click',event=>{
      if(event.target.closest?.('.account-menu-toggle'))return;
      const input=byId('glDefaultModeMenu');
      if(!input)return;
      input.checked=!input.checked;
      input.dispatchEvent(new Event('change',{bubbles:true}));
    });
    byId('glDefaultModeRow')?.addEventListener('keydown',event=>{
      if(event.key!=='Enter'&&event.key!==' ')return;
      event.preventDefault();
      const input=byId('glDefaultModeMenu');
      if(!input)return;
      input.checked=!input.checked;
      input.dispatchEvent(new Event('change',{bubbles:true}));
    });

    const subjectButton=byId('glSubjectBtn');
    const subjectMenu=byId('glSubjectMenu');
    subjectButton?.addEventListener('click',()=>{
      const open=subjectMenu?.hidden!==false;
      if(subjectMenu)subjectMenu.hidden=!open?true:false;
      state.subjectMenuOpen=open;
      subjectButton.setAttribute('aria-expanded',open?'true':'false');
    });
    document.addEventListener('click',event=>{
      if(!event.target.closest?.('#glSubjectShell')){
        if(subjectMenu)subjectMenu.hidden=true;
        subjectButton?.setAttribute('aria-expanded','false');
      }
    });
    subjectMenu?.addEventListener('click',event=>{
      const item=event.target.closest?.('[data-gl-subject]');
      if(!item)return;
      subjectMenu.hidden=true;
      subjectButton?.setAttribute('aria-expanded','false');
      toast('当前版本仅提供 PMP 项目管理科目。');
    });
    global.addEventListener('resize',scheduleViewportUpdate);
    global.addEventListener('pagehide',flushStagePosition);
    global.addEventListener('kg-auth-session-change',()=>{flushStagePosition();closePlacementChoice();loadProgress();renderAll()});
    global.addEventListener('kg:guided-learning-progress',()=>{loadProgress();renderAll()});
  }
  function renderAll(){ensureActivePart();renderSubjectButton();renderStageSwitch();renderStageList();renderPath()}
  function init(){
    state.course=data()?.getCourse?.();if(!state.course)return;
    loadProgress();bind();renderAll();
    if(global.matchMedia?.('(prefers-reduced-motion: reduce)').matches){
      document.querySelectorAll('.gl-practice-entry img[data-still-src]').forEach(image=>{if(image.dataset.stillSrc)image.src=image.dataset.stillSrc});
    }
  }

  global.KGGuidedLearningPathThemes=Object.freeze({palette:PART_THEMES,themeForPart});
  global.KGGuidedLearningApp=Object.freeze({init,renderAll,setSelectedStage,openStagePicker,closeStagePicker,openPlacementChoice,closePlacementChoice,scrollCurrentNodeIntoView,setActivePart});
  document.addEventListener('DOMContentLoaded',init);
})(window);
