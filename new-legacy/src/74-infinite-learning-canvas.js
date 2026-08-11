'use strict';

/*
 * InfiniteLearningCanvas v1.6
 * 单题深学画布引擎：只负责五张核心学习卡、稳定缩放、同步点阵和移动只读作答。
 */
(function(global){
  const CARD_DEFAULTS={
    'step-1':{x:80,y:120,width:760,height:650},
    'step-2':{x:930,y:180,width:700,height:610},
    'step-3':{x:1720,y:80,width:1040,height:760},
    'step-4':{x:2850,y:150,width:920,height:720},
    'step-5':{x:3860,y:230,width:720,height:560}
  };
  const viewportLibrary=global.KGCanvasViewportController||{};
  const ZOOM_MIN=viewportLibrary.MIN_ZOOM||.01;
  const ZOOM_MAX=viewportLibrary.MAX_ZOOM||4;
  const BUTTON_ZOOM_LEVELS=viewportLibrary.BUTTON_ZOOM_LEVELS||[.01,.02,.03,.05,.10,.15,.20,.33,.50,.75,1,1.25,1.50,2,2.50,3,4];
  const WHEEL_ZOOM_LEVELS=viewportLibrary.WHEEL_ZOOM_LEVELS||[.01,.02,.03,.04,.05,.07,.09,.11,.13,.17,.21,.26,.33,.41,.51,.64,.80,1,1.20,1.44,1.73,2.07,2.49,2.99,3.58,4];
  const POINTER_ARROW_ICON='<svg aria-hidden="true" viewBox="0 0 24 24"><path d="M5 3l13 8-6 1.2 3.7 6.2-2.8 1.6-3.6-6.1L5 18V3z"/></svg>';
  const POINTER_HAND_ICON='<svg aria-hidden="true" viewBox="0 0 24 24"><path d="M8 12V6.5a1.5 1.5 0 0 1 3 0V11"/><path d="M11 11V5.5a1.5 1.5 0 0 1 3 0V11"/><path d="M14 11V7.5a1.5 1.5 0 0 1 3 0V13"/><path d="M8 12l-1.1-1.1a1.6 1.6 0 0 0-2.3 2.2l4.2 5.1A5.5 5.5 0 0 0 13 20h1a5 5 0 0 0 5-5v-3.5a1.5 1.5 0 0 0-3 0V13"/></svg>';

  const state={
    initialized:false,
    viewport:null,
    world:null,
    kernel:null,
    runtime:null,
    policy:null,
    cards:new Map(),
    edgeLayer:null,
    selectedCardId:'',
    panX:0,
    panY:0,
    zoom:1,
    mode:'guided',
    step:1,
    maxVisited:1,
    completed:false,
    mobile:null,
    gesture:null,
    saveTimer:null,
    zoomFrame:0,
    zoomToken:0,
    zoomTarget:null,
    lastFocusedStep:0,
    suppressSessionApply:false,
    pointerMode:'edit',
    temporaryPanMode:false,
    temporaryPanReasons:new Set(),
    rightPanPointerId:null,
    minimapMetrics:null,
    minimapDrag:null,
    entryFocusTimer:null,
    entryFocusToken:0,
    entryFocusPending:false
  };

  const byId=id=>document.getElementById(id);
  const clamp=(value,min,max)=>Math.max(min,Math.min(max,value));
  const round=value=>Math.round(Number(value)||0);

  function flow(){return global.KGFlowOrchestrator||null}
  function session(){return flow()?.current?.()||null}
  function cardIdForStep(step){return 'step-'+Math.max(1,Math.min(5,Number(step)||1))}
  function cardForStep(step){return state.cards.get(cardIdForStep(step))?.element||null}
  function isMobile(){
    return global.KGCanvasViewportController?.isCoarseSmallScreen?.(1100)??false;
  }

  function nextZoomLevel(current,direction,levels){
    return global.KGCanvasViewportController?.nextZoomLevel?.(
      current,direction,levels,ZOOM_MIN,ZOOM_MAX
    )??current;
  }
  function cancelSmoothZoom(){
    return state.kernel?.viewport?.cancelAnimation?.()||false;
  }
  function viewportForScaleAtClientPoint(scale,clientX,clientY){
    return state.kernel?.viewport?.targetForScale?.(scale,clientX,clientY)||{
      x:state.panX,y:state.panY,zoom:state.zoom
    };
  }
  function animateViewport(target={},options={}){
    return state.kernel?.viewport?.animateTo?.(target,options)||false;
  }
  function smoothZoomAt(scale,clientX,clientY,options={}){
    return state.kernel?.viewport?.zoomAt?.(scale,clientX,clientY,options)||false;
  }
  function smoothZoomByLevel(direction,levels,clientX,clientY,options={}){
    return state.kernel?.viewport?.zoomByLevel?.(
      direction,levels,clientX,clientY,options
    )||false;
  }
  function updateCanvasGrid(){
    return state.kernel?.viewport?.updateGrid?.()||false;
  }

  function readDefault(element){
    const id=String(element.dataset.canvasCard||'');
    const fallback=CARD_DEFAULTS[id]||{x:0,y:0,width:720,height:620};
    return {
      x:Number(element.dataset.defaultX||fallback.x),
      y:Number(element.dataset.defaultY||fallback.y),
      width:Number(element.dataset.defaultWidth||fallback.width),
      height:Number(element.dataset.defaultHeight||fallback.height)
    };
  }
  function normalizeLayout(layout,element){
    const base=readDefault(element);
    return global.KGCanvasCardController?.normalizeLayout?.(
      {...base,...(layout||{})},
      {
        minWidth:Math.max(260,Number(element?.dataset?.minWidth||420)),
        minHeight:Math.max(170,Number(element?.dataset?.minHeight||360)),
        maxWidth:Math.max(420,Number(element?.dataset?.maxWidth||1200)),
        maxHeight:Math.max(360,Number(element?.dataset?.maxHeight||900))
      }
    )||{...base,...(layout||{})};
  }
  function cardTypeForStep(step){
    return {
      1:'learning.answer',
      2:'learning.keyword',
      3:'learning.knowledge-network',
      4:'learning.reasoning',
      5:'learning.recap'
    }[Number(step)]||'learning.card';
  }
  function createKernel(){
    const basePolicy=global.KGCanvasPolicy?.presets?.deepLearning?.()||{};
    const resolvedPolicy=state.mobile
      ?global.KGCanvasPolicy?.presets?.mobileReadonly?.(basePolicy)
      :basePolicy;
    state.policy=global.KGCanvasPolicy?.create?.(resolvedPolicy);
    state.kernel=global.KGCanvasKernel?.create?.({
      id:'deep-learning-canvas',
      viewport:state.viewport,
      world:state.world,
      policy:state.policy,
      mobile:state.mobile,
      initialViewport:{x:state.panX,y:state.panY,zoom:state.zoom},
      gridPrefix:'--qt-grid',
      gridLodAttribute:'gridLod',
      persistDelay:450,
      onViewportApply(next){
        state.panX=next.x;
        state.panY=next.y;
        state.zoom=next.zoom;
        updateZoomLabel();
        if(state.runtime)state.runtime.notifyViewport(next);
        else renderMinimap();
      },
      onViewportPersist(next){
        if(state.mobile)return;
        flow()?.dispatchCommand?.({
          type:'CANVAS_VIEWPORT_UPDATED',
          payload:{viewport:{x:next.x,y:next.y,zoom:next.zoom}},
          sourceCardId:'canvas'
        });
      },
      onCardLayoutChange(record){
        saveCardLayout(record);
        renderEdges();
        renderMinimap();
      },
      applyCardLayout(record,{layout}){
        record.element.style.setProperty('--card-x',round(layout.x)+'px');
        record.element.style.setProperty('--card-y',round(layout.y)+'px');
        record.element.style.width=round(layout.width)+'px';
        record.element.style.height=round(layout.height)+'px';
      }
    });
    if(!state.kernel)throw new Error('Unified Canvas Kernel is unavailable');
    state.cards=state.kernel.cards.records;
    return state.kernel;
  }
  function registerCards(){
    state.kernel.cards.clear();
    document.querySelectorAll('[data-canvas-card]').forEach((element,index)=>{
      const id=String(element.dataset.canvasCard||'');
      if(!id)return;
      const step=Number(element.dataset.step||index+1);
      const layout=normalizeLayout(null,element);
      state.kernel.registerCard({
        id,
        step,
        kind:'learning-step',
        cardType:cardTypeForStep(step),
        nodeId:'',
        element,
        layout,
        defaultLayout:{...layout}
      });
      element.style.zIndex=String(index+2);
    });
  }
  function registerExternalCard(element,options={}){
    if(!element)return null;
    const id=String(options.id||element.dataset.canvasCard||'');
    if(!id)return null;
    const existing=state.cards.get(id);
    const layout=normalizeLayout(options.layout||existing?.layout||null,element);
    const record=state.kernel.registerCard({
      id,
      step:Number(options.step||element.dataset.step||0),
      kind:String(options.kind||element.dataset.cardKind||'external'),
      cardType:String(options.cardType||options.kind||element.dataset.cardKind||'external'),
      nodeId:String(options.nodeId||element.dataset.workspaceNode||''),
      element,
      layout,
      defaultLayout:existing?.defaultLayout||{...layout}
    });
    if(!record)return null;
    element.style.zIndex=String(8+state.cards.size);
    renderEdges();
    renderMinimap();
    return record;
  }
  function unregisterExternalCard(cardId){
    cardId=String(cardId||'');
    const record=state.cards.get(cardId);
    if(!record||record.kind==='learning-step')return false;
    if(state.selectedCardId===cardId)clearPathSelection();
    state.kernel.unregisterCard(cardId);
    renderEdges();
    renderMinimap();
    return true;
  }
  function updateExternalCard(cardId,layout={}){
    const record=state.cards.get(String(cardId||''));
    if(!record||record.kind==='learning-step')return null;
    const updated=state.kernel.cards.update(cardId,normalizeLayout({...record.layout,...layout},record.element));
    renderEdges();
    renderMinimap();
    return updated;
  }

  function initEdgeLayer(){
    const svg=byId('qtCanvasEdgeLayer');
    const group=byId('qtCanvasEdges');
    const defs=byId('qtCanvasEdgeDefs');
    if(!svg||!group||!global.KGLearningPathEdges?.create)return null;
    state.edgeLayer=global.KGLearningPathEdges.create({
      svg,
      group,
      defs,
      edges:global.KGLearningPathEdges.DEFAULT_EDGES,
      getCard:cardId=>state.cards.get(String(cardId||''))||null
    });
    renderEdges();
    return state.edgeLayer;
  }
  function renderEdges(){
    return state.edgeLayer?.render?.({
      mode:state.mode,
      currentStep:state.step,
      maxVisited:state.maxVisited,
      completed:state.completed
    })||0;
  }
  function applyPathSelectionClasses(){
    const selected=String(state.selectedCardId||'');
    const connectedList=selected?(state.edgeLayer?.connectedCardIds?.(selected)||[]):[];
    const connected=new Set(connectedList);
    state.viewport?.classList.toggle('has-path-selection',!!selected&&state.mode==='explore');
    const label=byId('qtPathSelectionLabel');
    if(label){
      const record=state.cards.get(selected);
      label.hidden=!(selected&&state.mode==='explore');
      label.textContent=record
        ?(record.kind==='learning-step'?'第 '+record.step+' 卡':'题目卡')+' · 连接 '+connectedList.length+' 张'
        :'';
    }
    state.cards.forEach(record=>{
      record.element.classList.toggle('path-selected',record.id===selected&&state.mode==='explore');
      record.element.classList.toggle('path-neighbor',connected.has(record.id)&&state.mode==='explore');
      record.element.classList.toggle(
        'path-dimmed',
        !!selected&&state.mode==='explore'&&record.id!==selected&&!connected.has(record.id)
      );
    });
  }
  function selectPathCard(cardId,options={}){
    if(state.mode!=='explore')return '';
    cardId=String(cardId||'');
    if(!state.cards.has(cardId))return '';
    state.selectedCardId=cardId;
    state.edgeLayer?.setSelectedCard?.(cardId);
    applyPathSelectionClasses();
    if(options.focus){
      const step=state.cards.get(cardId)?.step;
      if(step)focusStep(step,{persist:false});
    }
    try{
      global.dispatchEvent(new CustomEvent('kg:canvas-path-selected',{
        detail:{
          cardId,
          connectedCardIds:state.edgeLayer?.connectedCardIds?.(cardId)||[],
          incoming:state.edgeLayer?.incoming?.(cardId)||[],
          outgoing:state.edgeLayer?.outgoing?.(cardId)||[]
        }
      }));
    }catch(e){}
    return cardId;
  }
  function clearPathSelection(){
    state.selectedCardId='';
    state.edgeLayer?.clearSelection?.();
    applyPathSelectionClasses();
  }

  function applyCardLayout(record){
    return state.kernel?.cards?.apply?.(record)||false;
  }
  function applyAllCardLayouts(){
    state.kernel?.cards?.applyAll?.();
    renderEdges();
    renderMinimap();
  }
  function restoreFromSession(currentSession=session(),options={}){
    if(!currentSession)return;
    clearTimeout(state.saveTimer);
    state.saveTimer=null;
    state.kernel?.viewport?.cancelPersist?.();
    cancelSmoothZoom();
    state.mode=currentSession.mode==='explore'?'explore':'guided';
    state.step=clamp(Number(currentSession.currentStep||1),1,5);
    state.maxVisited=clamp(Number(currentSession.maxVisited||state.step),1,5);
    state.completed=currentSession.status==='completed';

    const viewport=currentSession.canvas?.viewport||{};
    if(options.restoreViewport!==false&&!state.mobile){
      state.panX=Number.isFinite(Number(viewport.x))?Number(viewport.x):state.panX;
      state.panY=Number.isFinite(Number(viewport.y))?Number(viewport.y):state.panY;
      state.zoom=clamp(Number(viewport.zoom||state.zoom),ZOOM_MIN,ZOOM_MAX);
    }
    const savedCards=currentSession.canvas?.cards||{};
    state.cards.forEach(record=>{
      if(record.kind!=='learning-step')return;
      Object.assign(record.layout,normalizeLayout(savedCards[record.id],record.element));
    });
    applyAllCardLayouts();
    if(options.restoreViewport!==false)applyViewportTransform();
    syncModeUI();
    syncFlowState({step:state.step,maxVisited:state.maxVisited,mode:state.mode,completed:state.completed},{focus:false});
  }
  function applyViewportTransform(){
    return state.kernel?.viewport?.sync?.({
      x:state.panX,
      y:state.panY,
      zoom:state.zoom,
      mobile:state.mobile
    })||false;
  }
  function updateZoomLabel(){
    const value=Math.round(state.zoom*100),label=byId('qtCanvasZoomLabel'),slider=byId('qtCanvasZoomSlider');
    if(label)label.textContent=value+'%';
    if(slider&&document.activeElement!==slider)slider.value=String(Math.max(1,Math.min(400,value)));
  }
  function showCanvasZoomSlider(show=true){
    const dock=byId('qtCanvasZoomDock'),popover=byId('qtCanvasZoomSliderPopover');if(!dock||!popover)return;
    dock.classList.toggle('slider-open',!!show);popover.setAttribute('aria-hidden',show?'false':'true');
  }
  function scheduleViewportSave(){
    return state.kernel?.viewport?.schedulePersist?.()||false;
  }
  function saveCardLayout(record){
    if(!record)return;
    if(record.kind==='question-reference'&&record.nodeId){
      global.KGCanvasWorkspaceStore?.updateNodeLayout?.(record.nodeId,{...record.layout});
      return;
    }
    flow()?.dispatchCommand?.({
      type:'CARD_POSITION_UPDATED',
      payload:{cardId:record.id,layout:{...record.layout}},
      sourceCardId:'canvas'
    });
  }
  function setViewport(next={},options={}){
    return state.kernel?.viewport?.set?.(next,options)||false;
  }
  function zoomAt(nextZoom,clientX,clientY,options={}){
    if(state.mobile||!state.viewport)return false;
    return smoothZoomAt(nextZoom,clientX,clientY,{
      duration:options.duration||180,
      persist:options.persist,
      source:options.source||'direct'
    });
  }
  function cardBounds(record){
    const l=record.layout;
    return {left:l.x,top:l.y,right:l.x+l.width,bottom:l.y+l.height,width:l.width,height:l.height};
  }
  function allBounds(){
    return state.kernel?.cards?.bounds?.()||{left:0,top:0,right:1000,bottom:700,width:1000,height:700};
  }

  function singleCanvasMinimapItems(){
    return [...state.cards.values()].map(record=>{
      const layout=record.layout||{};
      return{id:String(record.id||''),kind:record.step===state.step?'current':(record.kind==='learning-step'?'node':'note'),x:Number(layout.x)||0,y:Number(layout.y)||0,width:Math.max(10,Number(layout.width)||420),height:Math.max(10,Number(layout.height)||360)};
    });
  }
  function centerSingleCanvasAt100(){
    const bounds=allBounds();
    return state.kernel.viewport.focusBounds(bounds,{zoom:1,minZoom:1,maxZoom:1,duration:420,instant:false,persist:true,source:'percent-reset'});
  }
  function initUnifiedCanvasRuntime(){
    if(state.runtime||!global.KGUnifiedCanvasRuntime)return state.runtime;
    const adapter=Object.freeze({
      id:'single-question-canvas-adapter',
      getSurface:()=>state.viewport,getViewportElement:()=>state.viewport,getZoomDock:()=>byId('qtCanvasZoomDock'),getFullscreenElement:()=>byId('qtCanvasShell')||state.viewport,
      getViewport:()=>({x:state.panX,y:state.panY,zoom:state.zoom}),
      setViewport:(next,meta={})=>setViewport(next,{...meta,persist:meta.persist}),
      getContentBounds:allBounds,getMinimapItems:singleCanvasMinimapItems,centerAt100:centerSingleCanvasAt100,fit:()=>fitAll({persist:true}),persistViewport:scheduleViewportSave,isMobile:()=>state.mobile
    });
    global.KGSingleQuestionCanvasAdapter=adapter;
    state.runtime=global.KGUnifiedCanvasRuntime.register({
      id:'single-question-canvas',type:'single-question',surface:state.viewport,viewport:state.viewport,zoomDock:byId('qtCanvasZoomDock'),percentButton:byId('qtCanvasZoomLabel'),adapter,baseGrid:24,
      minimap:{dock:byId('qtMinimapDock'),root:byId('qtCanvasMinimap'),world:byId('qtCanvasMinimapWorld'),view:byId('qtCanvasMinimapView'),toggle:byId('qtMinimapToggleBtn')}
    });
    return state.runtime;
  }

  function focusRecord(record,options={}){
    if(!record)return false;
    if(record.step)state.lastFocusedStep=record.step;
    if(state.mobile){
      record.element.scrollIntoView?.({behavior:options.instant?'auto':'smooth',block:'start'});
      return true;
    }
    const focused=state.kernel.viewport.focusBounds(cardBounds(record),{
      zoom:options.zoom,
      minZoom:.5,
      maxZoom:1,
      instant:!!options.instant,
      duration:options.duration||230,
      persist:options.persist,
      source:'focus'
    });
    if(options.highlight!==false){
      record.element.animate?.([
        {boxShadow:'0 18px 50px rgba(31,41,65,.13)'},
        {boxShadow:'0 0 0 6px rgba(109,93,252,.18),0 28px 80px rgba(31,41,65,.18)'},
        {boxShadow:''}
      ],{duration:520,easing:'ease-out'});
    }
    return focused;
  }

  function focusCard(cardId,options={}){
    return focusRecord(state.cards.get(String(cardId||'')),options);
  }
  function focusStep(step,options={}){
    step=clamp(Number(step||state.step),1,5);
    return focusCard(cardIdForStep(step),options);
  }
  function cancelEntryFocus(){
    state.entryFocusToken+=1;
    state.entryFocusPending=false;
    if(state.entryFocusTimer){
      clearTimeout(state.entryFocusTimer);
      state.entryFocusTimer=null;
    }
    document.body?.classList.remove('qt-canvas-entry-focusing');
  }
  function scheduleFirstCardEntryFocus(reason='entry',options={}){
    const token=++state.entryFocusToken;
    state.entryFocusPending=true;
    if(state.entryFocusTimer)clearTimeout(state.entryFocusTimer);
    cancelSmoothZoom();
    state.kernel?.viewport?.cancelPersist?.();
    document.body?.classList.add('qt-canvas-entry-focusing');
    const delay=Math.max(0,Number(options.delay??24));
    state.entryFocusTimer=setTimeout(()=>{
      state.entryFocusTimer=null;
      requestAnimationFrame(()=>requestAnimationFrame(()=>{
        if(token!==state.entryFocusToken||!state.initialized)return;
        applyAllCardLayouts();
        clearPathSelection();
        focusStep(1,{instant:true,persist:false,highlight:false,zoom:options.zoom});
        renderEdges();
        renderMinimap();
        state.entryFocusPending=false;
        document.documentElement?.classList?.remove?.('qt-canvas-initial-pending');
        document.body?.classList.remove('qt-canvas-entry-focusing');
        document.body?.classList.add('qt-canvas-entry-settled');
        setTimeout(()=>document.body?.classList.remove('qt-canvas-entry-settled'),220);
        try{
          global.dispatchEvent(new CustomEvent('kg:single-question-entry-focused',{
            detail:{reason,step:1,cardId:cardIdForStep(1)}
          }));
        }catch(e){}
      }));
    },delay);
    return true;
  }
  function clientToWorld(clientX,clientY){
    return state.kernel?.viewport?.clientToWorld?.(clientX,clientY)||{x:0,y:0};
  }
  function defaultWorkspacePosition(){
    const rect=state.viewport?.getBoundingClientRect?.()||{left:0,top:0,width:1000,height:650};
    const center=clientToWorld(rect.left+rect.width/2,rect.top+rect.height/2);
    const count=[...state.cards.values()].filter(record=>record.kind!=='learning-step').length;
    return {
      x:center.x-180+(count%4)*34,
      y:center.y-120+Math.floor(count/4)*34
    };
  }
  function fitAll(options={}){
    if(state.mobile)return false;
    return state.kernel.viewport.fitBounds(allBounds(),{
      padding:140,
      maxZoom:1,
      instant:!!options.instant,
      duration:options.duration||260,
      persist:options.persist,
      source:'fit'
    });
  }

  function resetLayout(){
    state.cards.forEach(record=>{
      if(record.kind==='learning-step')record.layout={...record.defaultLayout};
    });
    applyAllCardLayouts();
    flow()?.dispatchCommand?.({
      type:'CANVAS_LAYOUT_RESET',
      payload:{
        cards:Object.fromEntries(
          [...state.cards]
            .filter(([,record])=>record.kind==='learning-step')
            .map(([id,record])=>[id,{...record.layout}])
        )
      },
      sourceCardId:'canvas'
    });
    setTimeout(()=>focusStep(state.step,{persist:true}),0);
  }
  function statusForStep(step){
    if(state.completed)return 'done';
    if(step===state.step)return 'current';
    if(step<state.step)return 'done';
    if(state.mode==='explore')return 'available';
    if(step<=state.maxVisited)return 'available';
    return 'locked';
  }
  function syncFlowState(next={},options={}){
    if(Number.isFinite(Number(next.step)))state.step=clamp(Number(next.step),1,5);
    if(Number.isFinite(Number(next.maxVisited)))state.maxVisited=clamp(Number(next.maxVisited),1,5);
    if(next.mode)state.mode=state.mobile?'guided':(next.mode==='explore'?'explore':'guided');
    if(state.mobile)state.mode='guided';
    if(next.completed!==undefined)state.completed=!!next.completed;
    if(state.mode!=='explore'&&state.selectedCardId){
      state.selectedCardId='';
      state.edgeLayer?.clearSelection?.();
    }

    state.cards.forEach(record=>{
      if(record.kind!=='learning-step'){
        record.element.classList.remove('current','done','locked');
        record.element.classList.add('available');
        record.element.setAttribute('aria-disabled','false');
        return;
      }
      const status=statusForStep(record.step);
      record.element.classList.toggle('current',status==='current');
      record.element.classList.toggle('done',status==='done');
      record.element.classList.toggle('available',status==='available');
      record.element.classList.toggle('locked',status==='locked');
      record.element.setAttribute('aria-disabled',status==='locked'?'true':'false');
      const badge=record.element.querySelector('[data-card-status]');
      if(badge){
        badge.textContent=status==='current'?'当前步骤':status==='done'?'已完成':status==='available'?'可查看':'等待解锁';
      }
    });
    if(state.viewport)state.viewport.dataset.mode=state.mode;
    document.body.dataset.learningMode=state.mode;
    syncModeUI();
    renderEdges();
    applyPathSelectionClasses();
    renderMinimap();
    if(options.focus&&state.mode==='guided')focusStep(state.step,{persist:false});
  }
  function syncModeUI(){
    const guided=byId('qtGuidedModeBtn');
    const explore=byId('qtExploreModeBtn');
    const hint=byId('qtCanvasHint');
    const mobileBadge=byId('qtMobileReadOnlyBadge');
    const isGuided=state.mode==='guided';
    guided?.classList.toggle('active',isGuided);
    explore?.classList.toggle('active',!isGuided);
    guided?.setAttribute('aria-pressed',isGuided?'true':'false');
    explore?.setAttribute('aria-pressed',isGuided?'false':'true');
    if(explore){
      explore.disabled=!!state.mobile;
      explore.setAttribute('aria-disabled',state.mobile?'true':'false');
      explore.title=state.mobile?'移动端仅支持引导式只读作答':'自由查看画布卡片与连接关系';
    }
    if(mobileBadge)mobileBadge.hidden=!state.mobile;
    if(hint)hint.textContent=state.mobile
      ?'移动端为只读作答模式：可切题和完成五步学习，不支持自由探索、拖拽和布局编辑。'
      :(isGuided
        ?'系统会自动聚焦当前学习卡；后续卡片完成上一步后解锁。'
        :'五张学习卡已全部开放；可自由拖拽、查看和调整布局。');
  }
  function setMode(mode,options={}){
    mode=mode==='explore'?'explore':'guided';
    if(mode==='explore'&&state.policy?.can?.('freeExplore')===false){
      state.mode='guided';
      syncFlowState({mode:'guided'},{focus:false});
      if(typeof showStatus==='function')showStatus(
        state.mobile?'移动端仅支持引导式只读作答。':'当前画布策略不允许自由探索。'
      );
      return false;
    }
    state.mode=mode;
    if(mode!=='explore')clearPathSelection();
    syncFlowState({mode},{focus:false});
    global.KGCardRuntime?.setMode?.(mode);
    if(options.persist!==false){
      flow()?.dispatchCommand?.({type:'LEARNING_MODE_CHANGED',payload:{mode},sourceCardId:'canvas'});
    }
    if(mode==='explore'&&!state.mobile)fitAll({persist:false});
    if(mode==='guided')focusStep(state.step,{persist:false});
  }
  function renderKeywordCard(){
    const stem=byId('qtKeywordStem');
    if(!stem)return;
    const question=global.KGQuestionRepository?.current?.()||{};
    const selected=new Set(
      (flow()?.current?.()?.activation?.selectedKeywordIds||[]).map(String)
    );
    const fallback=(()=>{
      try{
        if(typeof qMvpState!=='undefined'&&qMvpState?.found instanceof Set)return qMvpState.found;
      }catch(e){}
      return selected;
    })();
    stem.innerHTML=(question.stemParts||[]).map(part=>{
      if(!part.clue)return escapeHTML(part.text);
      const clueId=String(part.clue);
      return '<button type="button" class="q-clue '+(fallback.has(clueId)?'found':'')+'" data-keyword-id="'+escapeHTML(clueId)+'">'
        +escapeHTML(part.text)+'</button>';
    }).join('');
    const title=byId('qtKeywordQuestionTitle');
    if(title)title.textContent='题目：'+String(question.title||'从题干中找出决定答案的线索');
  }
  function escapeHTML(value){
    return String(value??'').replace(/[&<>"']/g,char=>({
      '&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'
    }[char]));
  }
  function handleKeywordClick(event){
    const button=event.target.closest?.('[data-keyword-id]');
    if(!button||!state.viewport?.contains(button))return;
    if(state.mode==='guided'&&state.step!==2)return;
    const result=global.KGCardRuntime?.dispatch?.({
      type:'KEYWORD_TOGGLED',
      payload:{keywordId:button.dataset.keywordId},
      sourceCardId:'keyword-card-shell'
    })||flow()?.dispatchCommand?.({
      type:'KEYWORD_TOGGLED',
      payload:{keywordId:button.dataset.keywordId},
      sourceCardId:'keyword-card-shell'
    });
    if(result?.ok!==false){
      renderKeywordCard();
      try{
        if(typeof renderQClues==='function')renderQClues();
        if(typeof renderQScore==='function')renderQScore();
        if(typeof renderQGraph==='function')renderQGraph();
      }catch(error){console.warn('关键词卡辅助渲染失败',error)}
    }
  }
  function handleCanvasClick(event){
    handleKeywordClick(event);
    if(state.mode!=='explore')return;
    if(event.target.closest?.('.qt-canvas-toolbar,.qt-canvas-minimap,.qt-question-drawer'))return;
    const card=event.target.closest?.('[data-canvas-card]');
    if(card&&state.viewport?.contains(card)){
      selectPathCard(String(card.dataset.canvasCard||''),{focus:false});
      return;
    }
    clearPathSelection();
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
    const button=byId('qtCanvasPointerModeBtn');
    if(button){
      button.classList.toggle('active',pan);
      button.innerHTML=pan?POINTER_HAND_ICON:POINTER_ARROW_ICON;
      const label=pan?'手型浏览模式（V）':'箭头编辑模式（V）';
      button.title=label;
      button.setAttribute('aria-label',label);
    }
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
    if(announce&&typeof showStatus==='function')showStatus(state.pointerMode==='pan'?'已切换为手型浏览：拖动任意画布区域可平移。':'已切换为箭头编辑：可操作学习卡；平移请按住空格或鼠标右键。');
  }
  function togglePointerMode(){setPointerMode(state.pointerMode==='pan'?'edit':'pan',true)}
  function beginPan(event){
    if(state.mobile||state.kernel.cards.hasDrag?.())return;
    const rightPan=event.button===2;
    if(!rightPan&&!isCanvasPanMode())return;
    const started=state.kernel.viewport.beginPan(event,{
      activeClass:'is-panning',
      allowedButtons:[0,2],
      shouldStart:currentEvent=>!currentEvent.target.closest?.('.qt-guided-dock,.qt-question-drawer,.qt-canvas-overlay,button,a,input,textarea,select')
    });
    if(started){
      if(rightPan){state.rightPanPointerId=event.pointerId;setTemporaryPanMode(true,'right')}
      state.gesture={type:'pan',pointerId:event.pointerId};
    }
  }
  function beginCardDrag(event){
    if(state.mobile||event.button!==0||isCanvasPanMode())return;
    const handle=event.target.closest?.('[data-card-drag-handle]');
    const element=handle?.closest?.('[data-canvas-card]');
    if(!handle||!element)return;
    const record=state.cards.get(String(element.dataset.canvasCard||''));
    if(!record)return;
    const started=state.kernel.cards.beginDrag(event,record,{
      activeClass:'is-dragging',
      shouldStart:currentEvent=>!currentEvent.target.closest?.('button,a,input,textarea,select')
    });
    if(started){
      state.kernel.viewport.cancelAnimation();
      state.gesture={type:'card',pointerId:event.pointerId,record};
      event.stopPropagation();
    }
  }
  function moveGesture(event){
    const gesture=state.gesture;
    if(!gesture||gesture.pointerId!==event.pointerId)return;
    if(gesture.type==='pan'){
      state.kernel.viewport.movePan(event);
      return;
    }
    if(gesture.type==='card'){
      state.kernel.cards.moveDrag(event);
      renderEdges();
      renderMinimap();
    }
  }
  function endGesture(event){
    const gesture=state.gesture;
    if(!gesture||gesture.pointerId!==event.pointerId)return;
    state.gesture=null;
    if(gesture.type==='pan'){
      state.kernel.viewport.endPan(event,{activeClass:'is-panning',persist:true});
      if(event.pointerId===state.rightPanPointerId){state.rightPanPointerId=null;setTemporaryPanMode(false,'right')}
      return;
    }
    if(gesture.type==='card'){
      const result=state.kernel.cards.endDrag(event,{
        activeClass:'is-dragging',
        persist:true,
        reason:'drag'
      });
      if(result&&!result.moved)activateRecord(result.record);
    }
  }

  function activateRecord(record){
    if(!record)return;
    if(state.mobile&&record.kind!=='learning-step')return;
    if(record.kind==='learning-step'){
      activateCard(record.step);
      return;
    }
    if(state.mode!=='explore')setMode('explore');
    selectPathCard(record.id,{focus:false});
    focusRecord(record,{persist:false});
    try{
      global.dispatchEvent(new CustomEvent('kg:workspace-card-activated',{
        detail:{cardId:record.id,nodeId:record.nodeId,kind:record.kind}
      }));
    }catch(e){}
  }

  function activateCard(step){
    const cardId=cardIdForStep(step);
    const status=statusForStep(step);
    if(status==='locked'){
      if(typeof showStatus==='function')showStatus('请先完成当前步骤，再进入这张学习卡。');
      focusStep(state.step,{persist:false});
      return;
    }
    if(state.mode==='explore')selectPathCard(cardId,{focus:false});
    try{
      global.dispatchEvent(new CustomEvent('kg:canvas-card-activated',{
        detail:{
          step,
          cardId,
          mode:state.mode,
          connectedCardIds:state.edgeLayer?.connectedCardIds?.(cardId)||[]
        }
      }));
    }catch(e){}
    focusStep(step,{persist:false});
  }
  function handleWheel(event){
    if(state.mobile)return;
    const scrollSurface=event.target.closest?.('.qt-canvas-card-body,.qt-question-drawer');
    if(scrollSurface&&!event.ctrlKey&&!event.metaKey)return;
    event.preventDefault();
    const direction=event.deltaY<0?1:-1;
    smoothZoomByLevel(direction,WHEEL_ZOOM_LEVELS,event.clientX,event.clientY,{
      duration:150,
      persist:true,
      source:'wheel'
    });
  }
  function renderMinimap(){
    if(state.runtime?.minimap)return state.runtime.refreshMinimap(true);
    const root=byId('qtCanvasMinimap');
    const world=byId('qtCanvasMinimapWorld');
    const view=byId('qtCanvasMinimapView');
    if(!root||!world||!view||state.mobile)return;
    const bounds=allBounds();
    const rootWidth=root.clientWidth||190;
    const rootHeight=root.clientHeight||78;
    const padding=6;
    const scale=Math.min(
      (rootWidth-padding*2)/Math.max(1,bounds.width),
      (rootHeight-padding*2)/Math.max(1,bounds.height)
    );
    const offsetX=padding-bounds.left*scale;
    const offsetY=padding-bounds.top*scale;
    state.minimapMetrics={bounds,scale,offsetX,offsetY,rootWidth,rootHeight};
    world.innerHTML=[...state.cards.values()].map(record=>{
      const l=record.layout;
      return '<span class="qt-canvas-minimap-card '+(record.step===state.step?'current':'')+'" style="left:'+(offsetX+l.x*scale)+'px;top:'+(offsetY+l.y*scale)+'px;width:'+Math.max(3,l.width*scale)+'px;height:'+Math.max(3,l.height*scale)+'px"></span>';
    }).join('');
    const viewportRect=state.viewport?.getBoundingClientRect();
    if(!viewportRect)return;
    const worldLeft=(-state.panX)/state.zoom;
    const worldTop=(-state.panY)/state.zoom;
    const worldWidth=viewportRect.width/state.zoom;
    const worldHeight=viewportRect.height/state.zoom;
    view.style.left=(offsetX+worldLeft*scale)+'px';
    view.style.top=(offsetY+worldTop*scale)+'px';
    view.style.width=Math.max(5,worldWidth*scale)+'px';
    view.style.height=Math.max(5,worldHeight*scale)+'px';
  }

  function bindMinimap(){
    if(state.runtime?.minimap)return;
    const dock=byId('qtMinimapDock'),root=byId('qtCanvasMinimap'),view=byId('qtCanvasMinimapView'),toggle=byId('qtMinimapToggleBtn');
    if(!dock||!root||!view||!toggle)return;
    toggle.addEventListener('click',()=>{
      const open=dock.classList.contains('collapsed');
      dock.classList.toggle('collapsed',!open);
      toggle.setAttribute('aria-expanded',open?'true':'false');
      toggle.setAttribute('aria-label',open?'收起缩略图':'打开缩略图');
      toggle.title=open?'收起缩略图':'打开缩略图';
      root.setAttribute('aria-hidden',open?'false':'true');
      if(open)requestAnimationFrame(renderMinimap);
    });
    view.addEventListener('pointerdown',event=>{
      if(event.button!==0||state.mobile)return;
      const metrics=state.minimapMetrics;if(!metrics)return;
      const viewRect=view.getBoundingClientRect();
      state.minimapDrag={pointerId:event.pointerId,offsetX:event.clientX-viewRect.left,offsetY:event.clientY-viewRect.top};
      view.classList.add('dragging');view.setPointerCapture?.(event.pointerId);
      event.preventDefault();event.stopPropagation();
    });
    view.addEventListener('pointermove',event=>{
      const drag=state.minimapDrag,metrics=state.minimapMetrics;
      if(!drag||drag.pointerId!==event.pointerId||!metrics||state.mobile)return;
      const rootRect=root.getBoundingClientRect(),viewRect=view.getBoundingClientRect();
      const maxLeft=Math.max(0,rootRect.width-viewRect.width),maxTop=Math.max(0,rootRect.height-viewRect.height);
      const left=clamp(event.clientX-rootRect.left-drag.offsetX,0,maxLeft),top=clamp(event.clientY-rootRect.top-drag.offsetY,0,maxTop);
      const worldLeft=(left-metrics.offsetX)/metrics.scale,worldTop=(top-metrics.offsetY)/metrics.scale;
      setViewport({x:-worldLeft*state.zoom,y:-worldTop*state.zoom,zoom:state.zoom},{persist:false,source:'minimap-drag'});
      event.preventDefault();event.stopPropagation();
    });
    const finish=event=>{
      const drag=state.minimapDrag;if(!drag||drag.pointerId!==event.pointerId)return;
      state.minimapDrag=null;view.classList.remove('dragging');
      try{view.releasePointerCapture?.(event.pointerId)}catch(_){}
      scheduleViewportSave();event.preventDefault();event.stopPropagation();
    };
    view.addEventListener('pointerup',finish);view.addEventListener('pointercancel',finish);
  }

  function bindToolbar(){
    byId('qtCanvasPointerModeBtn')?.addEventListener('click',togglePointerMode);
    byId('qtGuidedModeBtn')?.addEventListener('click',()=>setMode('guided'));
    byId('qtExploreModeBtn')?.addEventListener('click',()=>{
      if(state.mobile){
        if(typeof showStatus==='function')showStatus('移动端仅支持引导式只读作答。');
        return;
      }
      setMode('explore');
    });
    byId('qtCanvasZoomOutBtn')?.addEventListener('click',()=>{
      const rect=state.viewport.getBoundingClientRect();
      smoothZoomByLevel(-1,BUTTON_ZOOM_LEVELS,rect.left+rect.width/2,rect.top+rect.height/2,{
        duration:230,
        persist:true,
        source:'button'
      });
    });
    byId('qtCanvasZoomInBtn')?.addEventListener('click',()=>{
      const rect=state.viewport.getBoundingClientRect();
      smoothZoomByLevel(1,BUTTON_ZOOM_LEVELS,rect.left+rect.width/2,rect.top+rect.height/2,{
        duration:230,
        persist:true,
        source:'button'
      });
    });
    byId('qtCanvasZoomLabel')?.addEventListener('click',()=>{showCanvasZoomSlider(false);if(!state.runtime?.centerAt100?.())centerSingleCanvasAt100()});
    byId('qtCanvasZoomSlider')?.addEventListener('input',event=>{const rect=state.viewport.getBoundingClientRect(),scale=Number(event.target.value)/100;showCanvasZoomSlider(true);smoothZoomAt(scale,rect.left+rect.width/2,rect.top+rect.height/2,{duration:0,persist:true,source:'slider'});});
    byId('qtCanvasZoomSlider')?.addEventListener('pointerdown',event=>event.stopPropagation());
    document.addEventListener('pointerdown',event=>{const dock=byId('qtCanvasZoomDock');if(dock?.classList.contains('slider-open')&&!dock.contains(event.target))showCanvasZoomSlider(false)},true);
    document.addEventListener('keydown',event=>{if(event.key==='Escape')showCanvasZoomSlider(false)});
    byId('qtCanvasFitBtn')?.addEventListener('click',()=>fitAll());
    byId('qtCanvasFocusBtn')?.addEventListener('click',()=>focusStep(state.step));
    byId('qtQuestionResetBtn')?.addEventListener('click',()=>{
      if(typeof resetQuestionTrainer==='function')resetQuestionTrainer();
    });
    byId('qtCanvasResetBtn')?.addEventListener('click',resetLayout);
  }
  function applyResponsiveMode(force=false,options={}){
    const nextMobile=isMobile();
    if(!force&&nextMobile===state.mobile&&state.initialized)return;
    state.gesture=null;
    state.kernel?.cards?.cancelDrag?.();
    state.viewport?.classList.remove('is-panning');
    state.cards.forEach(record=>record.element.classList.remove('is-dragging'));
    state.mobile=nextMobile;
    const basePolicy=global.KGCanvasPolicy?.presets?.deepLearning?.()||{};
    const nextPolicy=nextMobile
      ?global.KGCanvasPolicy?.presets?.mobileReadonly?.(basePolicy)
      :basePolicy;
    state.kernel?.replacePolicy?.(nextPolicy);
    state.kernel?.setMobile?.(nextMobile);
    document.body.dataset.canvasMobile=nextMobile?'1':'0';
    document.body.dataset.canvasReadonly=nextMobile?'1':'0';
    if(nextMobile)setPointerMode('edit');
    else updatePointerModeUI();
    if(nextMobile){
      state.mode='guided';
      clearPathSelection();
      global.KGCardRuntime?.setMode?.('guided');
    }
    syncFlowState({mode:state.mode},{focus:false});
    if(options.focus!==false)setTimeout(()=>focusStep(state.step,{instant:true,persist:false}),0);
  }
  function bindEvents(){
    state.viewport.addEventListener('pointerdown',beginPan);
    state.viewport.addEventListener('pointerdown',beginCardDrag,true);
    state.viewport.addEventListener('pointermove',moveGesture);
    state.viewport.addEventListener('pointerup',endGesture);
    state.viewport.addEventListener('pointercancel',endGesture);
    state.viewport.addEventListener('wheel',handleWheel,{passive:false});
    state.viewport.addEventListener('click',handleCanvasClick);
    state.viewport.addEventListener('dblclick',event=>{
      const card=event.target.closest?.('[data-canvas-card]');
      if(card&&!isCanvasPanMode())focusCard(String(card.dataset.canvasCard||''),{persist:false});
    });
    state.viewport.addEventListener('contextmenu',event=>{
      if(!event.target.closest?.('.qt-guided-dock,.qt-question-drawer,.qt-canvas-overlay'))event.preventDefault();
    });
    document.addEventListener('keydown',event=>{
      if((event.code==='Space'||event.key===' ')&&!event.repeat&&!isTextEditingTarget(event.target)){
        setTemporaryPanMode(true,'space');event.preventDefault();return;
      }
      if(String(event.key||'').toLowerCase()==='v'&&!event.repeat&&!event.ctrlKey&&!event.metaKey&&!event.altKey&&!isTextEditingTarget(event.target)){
        togglePointerMode();event.preventDefault();
      }
    });
    document.addEventListener('keyup',event=>{
      if(event.code==='Space'||event.key===' '){setTemporaryPanMode(false,'space');event.preventDefault()}
    });
    global.addEventListener('blur',()=>{
      state.rightPanPointerId=null;
      setTemporaryPanMode(false);
    });
    global.addEventListener('resize',()=>{
      applyResponsiveMode();
      renderEdges();
      renderMinimap();
    });
    global.addEventListener('kg:learning-session-updated',event=>{
      if(state.suppressSessionApply)return;
      const current=event.detail?.session;
      if(!current)return;
      const eventType=String(event.detail?.eventType||'');
      const viewport=current.canvas?.viewport;
      const cards=current.canvas?.cards;
      if(eventType==='CANVAS_VIEWPORT_UPDATED'&&viewport&&!state.gesture&&!state.mobile&&!state.entryFocusPending&&!document.body.classList.contains('qt-question-switching')){
        state.panX=Number.isFinite(Number(viewport.x))?Number(viewport.x):state.panX;
        state.panY=Number.isFinite(Number(viewport.y))?Number(viewport.y):state.panY;
        state.zoom=clamp(Number(viewport.zoom||state.zoom),ZOOM_MIN,ZOOM_MAX);
      }
      if((eventType==='CARD_POSITION_UPDATED'||eventType==='CANVAS_LAYOUT_RESET')&&cards&&!state.gesture){
        state.cards.forEach(record=>{
          if(cards[record.id])record.layout=normalizeLayout(cards[record.id],record.element);
        });
        applyAllCardLayouts();
      }
      syncFlowState({
        step:current.currentStep,
        maxVisited:current.maxVisited,
        mode:current.mode,
        completed:current.status==='completed'
      },{focus:false});
      renderKeywordCard();
      if(eventType==='CANVAS_VIEWPORT_UPDATED'&&!state.entryFocusPending&&!document.body.classList.contains('qt-question-switching'))applyViewportTransform();
    });
    global.addEventListener('kg:learning-session-changed',event=>{
      restoreFromSession(event.detail?.session,{restoreViewport:false});
      renderKeywordCard();
      scheduleFirstCardEntryFocus('learning-session-changed');
    });
    global.addEventListener('kg:learning-session-reset',event=>{
      restoreFromSession(event.detail?.session,{restoreViewport:false});
      renderKeywordCard();
      scheduleFirstCardEntryFocus('learning-session-reset');
    });
    global.addEventListener('kg:question-changed',()=>{
      renderKeywordCard();
      scheduleFirstCardEntryFocus('question-changed');
    });
  }
  function init(){
    if(state.initialized||!document.body.classList.contains('question-training-page'))return;
    state.viewport=byId('qtCanvasViewport');
    state.world=byId('qtCanvasWorld');
    if(!state.viewport||!state.world)return;
    state.mobile=isMobile();
    createKernel();
    state.initialized=true;
    registerCards();
    initEdgeLayer();
    initUnifiedCanvasRuntime();
    applyResponsiveMode(true,{focus:false});
    updatePointerModeUI();
    restoreFromSession(undefined,{restoreViewport:false});
    renderKeywordCard();
    bindToolbar();
    bindMinimap();
    bindEvents();
    requestAnimationFrame(()=>{
      applyAllCardLayouts();
      scheduleFirstCardEntryFocus('initial-entry',{delay:0});
      renderMinimap();
      try{
        global.dispatchEvent(new CustomEvent('kg:canvas-ready',{
          detail:{cardCount:state.cards.size,mode:state.mode}
        }));
      }catch(e){}
    });
  }

  const api=Object.freeze({
    init,
    focusStep,
    scheduleFirstCardEntryFocus,
    cancelEntryFocus,
    fitAll,
    resetLayout,
    setMode,
    setViewport,
    syncFlowState,
    renderKeywordCard,
    renderEdges,
    registerExternalCard,
    unregisterExternalCard,
    updateExternalCard,
    focusCard,
    clientToWorld,
    defaultWorkspacePosition,
    nextZoomLevel,
    smoothZoomAt,
    cancelSmoothZoom,
    selectPathCard,
    clearPathSelection,
    getEdges:()=>state.edgeLayer?.getEdges?.()||[],
    getConnectedCardIds:cardId=>state.edgeLayer?.connectedCardIds?.(String(cardId||''))||[],
    getReachableCardIds:cardId=>state.edgeLayer?.reachableFrom?.(String(cardId||''))||[],
    getState:()=>({
      panX:state.panX,panY:state.panY,zoom:state.zoom,mode:state.mode,
      step:state.step,maxVisited:state.maxVisited,mobile:state.mobile,
      selectedCardId:state.selectedCardId,
      kernel:state.kernel?.getState?.()||null,
      edges:state.edgeLayer?.getEdges?.()||[],
      cards:Object.fromEntries([...state.cards].map(([id,record])=>[id,{...record.layout}]))
    })
  });
  global.KGInfiniteLearningCanvas=api;
  document.addEventListener('DOMContentLoaded',init);
})(window);
