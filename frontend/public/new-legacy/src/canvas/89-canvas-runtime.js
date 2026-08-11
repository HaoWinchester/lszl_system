'use strict';

/*
 * Unified Canvas Runtime v2
 * Shared appearance, zoom-dock semantics, minimap and settings shell.
 * Business models remain in page adapters.
 */
(function(global){
  const instances=new Map();
  let sharedSettings=null;
  const ICON_SETTINGS='<svg aria-hidden="true" viewBox="0 0 24 24"><circle cx="12" cy="12" r="3"></circle><path d="M19.4 15a1.7 1.7 0 0 0 .3 1.9l.1.1-2.8 2.8-.1-.1a1.7 1.7 0 0 0-1.9-.3 1.7 1.7 0 0 0-1 1.6v.2h-4v-.2a1.7 1.7 0 0 0-1-1.6 1.7 1.7 0 0 0-1.9.3l-.1.1L4.2 17l.1-.1a1.7 1.7 0 0 0 .3-1.9A1.7 1.7 0 0 0 3 14H2.8v-4H3a1.7 1.7 0 0 0 1.6-1 1.7 1.7 0 0 0-.3-1.9L4.2 7 7 4.2l.1.1a1.7 1.7 0 0 0 1.9.3A1.7 1.7 0 0 0 10 3v-.2h4V3a1.7 1.7 0 0 0 1 1.6 1.7 1.7 0 0 0 1.9-.3l.1-.1L19.8 7l-.1.1a1.7 1.7 0 0 0-.3 1.9 1.7 1.7 0 0 0 1.6 1h.2v4H21a1.7 1.7 0 0 0-1.6 1Z"></path></svg>';
  const ICON_FULLSCREEN='<svg aria-hidden="true" viewBox="0 0 24 24"><path d="M8 3H3v5M16 3h5v5M8 21H3v-5M16 21h5v-5"></path></svg>';
  const ICON_MINIMAP='<svg aria-hidden="true" viewBox="0 0 24 24"><path d="M3 6.5 8 4l8 3 5-2.5v13L16 20l-8-3-5 2.5z"></path><path d="M8 4v13M16 7v13"></path></svg>';
  function ensureSettings(){return sharedSettings||(sharedSettings=global.KGCanvasSettingsController?.create?.()||null)}
  function finiteViewportScale(viewport={}){const value=Number(viewport.zoom??viewport.scale);return Number.isFinite(value)&&value>0?value:1}

  /*
   * V9.0-P4.3.7 shared floating-toolbar framework.
   * Node and edge toolbars use the same drag, collision avoidance, docking and
   * secondary-popover lifecycle without animating layout dimensions.
   */
  const floatingToolbarInstances=new Set();
  function createFloatingToolbar(options={}){
    const host=options.host;
    if(!host)return null;
    let manual=false,drag=null,lastAnchor=null,destroyed=false;
    const rootOf=()=>typeof options.getRoot==='function'?options.getRoot():options.root;
    const mainOf=()=>{const root=rootOf();return root?.querySelector?.(options.mainSelector||'.uc-toolbar-main')||root};
    const pad=Math.max(0,Number(options.pad)||8),gap=Math.max(0,Number(options.gap)||14);
    const overlaps=(a,b,margin=6)=>a.left<b.right+margin&&a.right>b.left-margin&&a.top<b.bottom+margin&&a.bottom>b.top-margin;
    function hostRect(){return host.getBoundingClientRect?.()||{left:0,top:0,width:host.clientWidth||1200,height:host.clientHeight||800,right:host.clientWidth||1200,bottom:host.clientHeight||800}}
    function obstacleBoxes(root,rect){
      const selector=String(options.avoidSelector||'.canvas-toolbar-left,.canvas-toolbar-right,#topToolbar');
      return [...(host.querySelectorAll?.(selector)||[])].filter(element=>element!==root&&element.isConnected&&!element.hidden).map(element=>{
        const style=global.getComputedStyle?.(element);if(style&&(style.display==='none'||style.visibility==='hidden'||style.pointerEvents==='none'))return null;
        const box=element.getBoundingClientRect();return{left:box.left-rect.left,top:box.top-rect.top,right:box.right-rect.left,bottom:box.bottom-rect.top};
      }).filter(Boolean);
    }
    function clampPosition(left,top,width,height,rect,root){
      const maxLeft=Math.max(pad,rect.width-width-pad),maxTop=Math.max(pad,rect.height-height-pad);
      left=Math.max(pad,Math.min(Number(left)||pad,maxLeft));top=Math.max(pad,Math.min(Number(top)||pad,maxTop));
      for(const box of obstacleBoxes(root,rect)){
        if(!overlaps({left,top,right:left+width,bottom:top+height},box,6))continue;
        const below=box.bottom+8,above=box.top-height-8,right=box.right+8,leftSide=box.left-width-8;
        if(below<=maxTop)top=below;else if(above>=pad)top=above;else if(right<=maxLeft)left=right;else if(leftSide>=pad)left=leftSide;
      }
      return{left:Math.max(pad,Math.min(left,maxLeft)),top:Math.max(pad,Math.min(top,maxTop))};
    }
    function setPosition(left,top){
      const root=rootOf();if(!root||destroyed)return false;
      const rect=hostRect(),width=root.offsetWidth||Number(options.fallbackWidth)||390,height=mainOf()?.offsetHeight||root.offsetHeight||Number(options.fallbackHeight)||44;
      const next=clampPosition(left,top,width,height,rect,root);
      root.style.left=Math.round(next.left)+'px';root.style.top=Math.round(next.top)+'px';
      options.onPosition?.(next,root);return true;
    }
    function choosePosition(anchor,settings={}){
      const root=rootOf();if(!root||destroyed)return false;
      if(manual)return setPosition(parseFloat(root.style.left)||pad,parseFloat(root.style.top)||pad);
      const rect=hostRect(),width=root.offsetWidth||Number(options.fallbackWidth)||390,height=mainOf()?.offsetHeight||root.offsetHeight||Number(options.fallbackHeight)||44;
      const local={left:Number(anchor.left)||0,top:Number(anchor.top)||0,right:Number(anchor.right??anchor.left)||0,bottom:Number(anchor.bottom??anchor.top)||0};
      const anchorGap=Math.max(0,Number(settings.gap??gap)||gap),centeredLeft=local.left+((local.right-local.left)-width)/2,centeredTop=local.top+((local.bottom-local.top)-height)/2;
      const candidates=[
        {left:centeredLeft,top:local.top-height-anchorGap},
        {left:centeredLeft,top:local.bottom+anchorGap},
        {left:local.right+anchorGap,top:centeredTop},
        {left:local.left-width-anchorGap,top:centeredTop}
      ];
      const obstacles=obstacleBoxes(root,rect);
      const fits=candidate=>{
        const box={left:candidate.left,top:candidate.top,right:candidate.left+width,bottom:candidate.top+height};
        if(box.left<pad||box.top<pad||box.right>rect.width-pad||box.bottom>rect.height-pad)return false;
        if(overlaps(box,local,Math.max(2,anchorGap-2)))return false;
        return !obstacles.some(obstacle=>overlaps(box,obstacle,6));
      };
      const chosen=candidates.find(fits)||candidates[0];return setPosition(chosen.left,chosen.top);
    }
    function positionRect(clientRect,settings={}){
      if(!clientRect)return false;const rect=hostRect();
      const local={left:clientRect.left-rect.left,top:clientRect.top-rect.top,right:clientRect.right-rect.left,bottom:clientRect.bottom-rect.top};
      lastAnchor={kind:'rect',value:{...clientRect},settings:{...settings}};return choosePosition(local,settings);
    }
    function positionPoint(point,settings={}){
      if(!point)return false;const local={left:Number(point.x)||0,top:Number(point.y)||0,right:Number(point.x)||0,bottom:Number(point.y)||0};
      lastAnchor={kind:'point',value:{x:local.left,y:local.top},settings:{...settings}};return choosePosition(local,settings);
    }
    function position(){
      if(manual)return setPosition(parseFloat(rootOf()?.style.left)||pad,parseFloat(rootOf()?.style.top)||pad);
      const suppliedRect=options.getAnchorRect?.();if(suppliedRect)return positionRect(suppliedRect);
      const suppliedPoint=options.getAnchorPoint?.();if(suppliedPoint)return positionPoint(suppliedPoint);
      if(lastAnchor?.kind==='rect')return positionRect(lastAnchor.value,lastAnchor.settings);
      if(lastAnchor?.kind==='point')return positionPoint(lastAnchor.value,lastAnchor.settings);
      return false;
    }
    function resetPosition(){manual=false;rootOf()?.classList.remove('manual-position');return position()}
    function bindDrag(grip){
      if(!grip||grip.dataset.ucToolbarDragBound==='1')return false;grip.dataset.ucToolbarDragBound='1';
      grip.addEventListener('pointerdown',event=>{
        if(event.button!==0)return;const root=rootOf();if(!root)return;
        const rr=root.getBoundingClientRect(),hr=hostRect();drag={pointerId:event.pointerId,startX:event.clientX,startY:event.clientY,left:rr.left-hr.left,top:rr.top-hr.top};
        manual=true;root.classList.add('dragging','manual-position');options.onDragStart?.(event,root);
        try{grip.setPointerCapture(event.pointerId)}catch(error){}event.preventDefault();event.stopPropagation();
      });
      grip.addEventListener('pointermove',event=>{if(!drag||drag.pointerId!==event.pointerId)return;setPosition(drag.left+event.clientX-drag.startX,drag.top+event.clientY-drag.startY);event.preventDefault();event.stopPropagation()});
      const finish=event=>{if(!drag||drag.pointerId!==event.pointerId)return;try{grip.releasePointerCapture(event.pointerId)}catch(error){}drag=null;rootOf()?.classList.remove('dragging');options.onDragEnd?.(event,rootOf());event.preventDefault();event.stopPropagation()};
      grip.addEventListener('pointerup',finish);grip.addEventListener('pointercancel',finish);
      grip.addEventListener('dblclick',event=>{event.preventDefault();event.stopPropagation();resetPosition()});return true;
    }
    function destroy(){destroyed=true;drag=null;floatingToolbarInstances.delete(api);return true}
    const api=Object.freeze({setPosition,positionRect,positionPoint,position,resetPosition,bindDrag,isManual:()=>manual,destroy});floatingToolbarInstances.add(api);return api;
  }
  function createFloatingToolbarPopover(options={}){
    const root=options.root;if(!root)return null;
    let activeName='',activeTrigger=null,openTimer=0,closeTimer=0,bound=false;
    const panelSelector=options.panelSelector||'[data-uc-toolbar-popover]',triggerSelector=options.triggerSelector||'[data-uc-toolbar-panel]';
    const panelAttr=options.panelAttribute||'data-uc-toolbar-popover',triggerAttr=options.triggerAttribute||'data-uc-toolbar-panel';
    const hoverQuery='(hover:hover) and (pointer:fine)',canHover=()=>!global.matchMedia||global.matchMedia(hoverQuery).matches;
    const panels=()=>[...root.querySelectorAll(panelSelector)],triggers=()=>[...root.querySelectorAll(triggerSelector)];
    const panelFor=name=>panels().find(panel=>panel.getAttribute(panelAttr)===String(name))||null;
    const triggerFor=name=>triggers().find(trigger=>trigger.getAttribute(triggerAttr)===String(name))||null;
    const clearTimers=()=>{clearTimeout(openTimer);clearTimeout(closeTimer);openTimer=0;closeTimer=0};
    function finishHide(panel){clearTimeout(panel.__ucToolbarHideTimer);panel.__ucToolbarHideTimer=0;panel.hidden=true;panel.classList.remove('show','is-closing','is-above');panel.style.removeProperty('left');panel.style.removeProperty('top')}
    function hidePanel(panel,immediate=false){
      if(!panel)return;clearTimeout(panel.__ucToolbarHideTimer);panel.classList.remove('show');
      if(immediate){finishHide(panel);return}
      panel.classList.add('is-closing');panel.__ucToolbarHideTimer=setTimeout(()=>finishHide(panel),Math.max(80,Number(options.closeDuration)||140));
    }
    function positionPanel(panel,trigger){
      const host=options.host||root.parentElement,main=root.querySelector(options.mainSelector||'.uc-toolbar-main');if(!host||!main||!panel||!trigger)return false;
      const hostBox=host.getBoundingClientRect(),offsetParent=panel.offsetParent||root,offsetBox=offsetParent.getBoundingClientRect(),triggerBox=trigger.getBoundingClientRect();
      const panelWidth=panel.offsetWidth||180,panelHeight=panel.offsetHeight||80,pad=Math.max(0,Number(options.pad)||8),panelGap=Math.max(0,Number(options.gap)||8);
      let left=triggerBox.left-offsetBox.left+triggerBox.width/2-panelWidth/2;
      if(options.alignLastTrigger&&trigger===triggers().at(-1))left=triggerBox.right-offsetBox.left-panelWidth;
      let globalLeft=offsetBox.left+left;if(globalLeft<hostBox.left+pad)left+=hostBox.left+pad-globalLeft;
      globalLeft=offsetBox.left+left;if(globalLeft+panelWidth>hostBox.right-pad)left-=globalLeft+panelWidth-(hostBox.right-pad);
      const belowTop=triggerBox.bottom+panelGap,aboveTop=triggerBox.top-panelHeight-panelGap,fitBelow=belowTop+panelHeight<=hostBox.bottom-pad,fitAbove=aboveTop>=hostBox.top+pad,above=!fitBelow&&fitAbove;
      root.dataset.panelPlacement=above?'above':'below';panel.classList.toggle('is-above',above);panel.style.left=Math.round(left)+'px';panel.style.top=Math.round((above?aboveTop:belowTop)-offsetBox.top)+'px';return true;
    }
    function reposition(){const panel=panelFor(activeName),trigger=activeTrigger||triggerFor(activeName);return panel&&!panel.hidden?positionPanel(panel,trigger):false}
    function close(settings={}){
      clearTimers();const immediate=!!settings.immediate;activeName='';activeTrigger=null;panels().forEach(panel=>hidePanel(panel,immediate));triggers().forEach(button=>{button.classList.remove('active');button.setAttribute('aria-expanded','false')});
      options.onClose?.();return true;
    }
    function open(name,trigger,settings={}){
      clearTimers();const panel=panelFor(name);trigger=trigger||triggerFor(name);if(!panel||!trigger||trigger.disabled||trigger.hidden)return false;
      if(settings.toggle&&activeName===String(name)&&!panel.hidden){close();return false}
      panels().forEach(item=>{if(item!==panel)hidePanel(item,true)});triggers().forEach(button=>{button.classList.remove('active');button.setAttribute('aria-expanded','false')});
      options.beforeOpen?.(name,panel,trigger);activeName=String(name);activeTrigger=trigger;clearTimeout(panel.__ucToolbarHideTimer);panel.hidden=false;panel.classList.remove('is-closing');positionPanel(panel,trigger);
      trigger.classList.add('active');trigger.setAttribute('aria-expanded','true');global.requestAnimationFrame?.(()=>{if(activeName===String(name)&&!panel.hidden)panel.classList.add('show')})||panel.classList.add('show');
      options.onOpen?.(name,panel,trigger);return true;
    }
    const toggle=(name,trigger)=>open(name,trigger,{toggle:true});
    function scheduleOpen(name,trigger){clearTimeout(closeTimer);closeTimer=0;clearTimeout(openTimer);openTimer=setTimeout(()=>open(name,trigger),Math.max(0,Number(options.hoverOpenDelay)||140))}
    function scheduleClose(){clearTimeout(openTimer);openTimer=0;clearTimeout(closeTimer);closeTimer=setTimeout(()=>close(),Math.max(80,Number(options.hoverCloseDelay)||240))}
    const relatedInside=(target,element)=>!!(target&&element&&element.contains&&element.contains(target));
    function bind(){
      if(bound)return;bound=true;
      root.addEventListener('pointerover',event=>{if(!canHover())return;const trigger=event.target.closest?.(triggerSelector);if(trigger&&root.contains(trigger)&&!relatedInside(event.relatedTarget,trigger)){scheduleOpen(trigger.getAttribute(triggerAttr),trigger);return}const panel=event.target.closest?.(panelSelector);if(panel&&root.contains(panel)){clearTimeout(closeTimer);closeTimer=0}});
      root.addEventListener('pointerout',event=>{if(!canHover())return;const trigger=event.target.closest?.(triggerSelector);if(trigger&&root.contains(trigger)&&!relatedInside(event.relatedTarget,trigger)){const panel=panelFor(trigger.getAttribute(triggerAttr));if(!relatedInside(event.relatedTarget,panel))scheduleClose();return}const panel=event.target.closest?.(panelSelector);if(panel&&root.contains(panel)&&!relatedInside(event.relatedTarget,panel)&&!relatedInside(event.relatedTarget,activeTrigger))scheduleClose()});
      root.addEventListener('keydown',event=>{if(event.key==='Escape'&&activeName){event.preventDefault();event.stopPropagation();const trigger=activeTrigger;close();trigger?.focus?.()}});
    }
    bind();return Object.freeze({open,toggle,close,reposition,isOpen:name=>activeName===String(name)&&!!panelFor(name)&&!panelFor(name).hidden,getActive:()=>activeName});
  }
  global.KGCanvasFloatingToolbarController=Object.freeze({
    create:createFloatingToolbar,createPopover:createFloatingToolbarPopover,
    repositionAll:()=>{let count=0;floatingToolbarInstances.forEach(instance=>{if(instance.position?.())count++});return count}
  });
  function createButton(className,title,html){const button=document.createElement('button');button.type='button';button.className=className;button.title=title;button.setAttribute('aria-label',title);button.innerHTML=html;return button}
  function ensureDockButton(dock,selector,className,title,html){
    if(!dock)return null;let button=dock.querySelector(selector);if(button)return button;
    button=createButton(className,title,html);dock.appendChild(button);return button;
  }
  function ensureMinimapDom(options={}){
    if(options.minimap?.root)return options.minimap;
    const host=options.minimapHost||options.surface;
    if(!host)return null;
    const dock=document.createElement('div');dock.className='uc-minimap-dock';dock.id=options.id+'MinimapDock';
    const root=document.createElement('div');root.className='uc-minimap';root.id=options.id+'Minimap';root.setAttribute('aria-hidden','false');
    const world=document.createElement('div');world.className='uc-minimap-world';
    const view=document.createElement('div');view.className='uc-minimap-view';view.title='拖动此框移动画布视野';
    root.append(world,view);
    const toggle=createButton('uc-minimap-toggle','收起缩略图',ICON_MINIMAP);toggle.setAttribute('aria-expanded','true');
    dock.append(root,toggle);host.appendChild(dock);
    return{dock,root,world,view,toggle};
  }
  function register(options={}){
    const id=String(options.id||'canvas-'+Date.now().toString(36));
    if(instances.has(id))return instances.get(id);
    const adapter=options.adapter||{};
    const surface=options.surface||adapter.getSurface?.();
    if(!surface)throw new Error('Unified Canvas Runtime requires a canvas surface');
    surface.dataset.canvasRuntimeId=id;
    const appearance=global.KGCanvasAppearanceController?.create?.({
      id,surface,getViewport:()=>adapter.getViewport?.()||{},baseGrid:options.baseGrid||24,
      onApply:preferences=>adapter.onAppearanceChange?.(preferences)
    });
    const dock=options.zoomDock||adapter.getZoomDock?.();
    const percent=options.percentButton||dock?.querySelector?.('.canvas-zoom-percent,.lp-canvas-zoom-percent');
    const fullscreen=options.fullscreenButton||ensureDockButton(dock,'[data-uc-fullscreen]','canvas-zoom-btn lp-canvas-zoom-btn uc-fullscreen-button','全屏显示画布',ICON_FULLSCREEN);
    if(fullscreen)fullscreen.dataset.ucFullscreen='true';
    const settingsButton=options.settingsButton||ensureDockButton(dock,'[data-uc-canvas-settings]','canvas-zoom-btn lp-canvas-zoom-btn uc-canvas-settings-button','视图设置 · 画布设置',ICON_SETTINGS);
    if(settingsButton)settingsButton.dataset.ucCanvasSettings='true';
    const zoom=global.KGCanvasZoomDockController?.create?.({adapter,dock,percent,fullscreen})||null;
    settingsButton?.addEventListener('click',event=>{event.preventDefault();event.stopPropagation();ensureSettings()?.open?.()});
    fullscreen?.addEventListener('click',event=>{event.preventDefault();event.stopPropagation();zoom?.toggleFullscreen?.()});
    let minimap=null,minimapDom=null;
    if(options.minimap!==false){
      minimapDom=ensureMinimapDom({...options,surface});
      if(minimapDom)minimap=global.KGCanvasMinimapController?.create?.({
        id,
        ...minimapDom,
        viewport:options.viewport||adapter.getViewportElement?.(),
        getItems:()=>adapter.getMinimapItems?.()||[],
        getContentBounds:()=>adapter.getContentBounds?.(),
        getViewport:()=>adapter.getViewport?.()||{},
        getViewportRect:()=>adapter.getViewportElement?.()?.getBoundingClientRect?.(),
        setViewport:(next,meta)=>adapter.setViewport?.(next,meta),
        persistViewport:()=>adapter.persistViewport?.(),
        isDisabled:()=>adapter.isMobile?.()===true
      });
    }
    const selectionFilter=global.KGCanvasSelectionFilterController?.create?.({
      surface,
      host:options.overlayHost||adapter.getOverlayHost?.()||surface.parentElement||surface,
      labels:adapter.getSelectionFilterLabels?.()||options.selectionFilterLabels||{},
      order:adapter.getSelectionFilterOrder?.()||options.selectionFilterOrder||[],
      applySelection:(type,ids,meta)=>adapter.applyFilteredSelection?.(type,ids,meta),
      getAnchorRect:()=>adapter.getSelectionAnchorRect?.()||null,
      onChange:payload=>adapter.onSelectionFilterChange?.(payload)
    })||null;
    const alignment=global.KGCanvasAlignmentController?.create?.({
      surface,
      host:options.guideHost||adapter.getGuideHost?.()||surface,
      getZoom:()=>finiteViewportScale(adapter.getViewport?.()),
      getRecords:()=>adapter.getAlignmentRecords?.()||[],
      getCanvasBounds:()=>adapter.getCanvasBounds?.()||adapter.getContentBounds?.()||null,
      worldToScreen:point=>adapter.worldToScreen?.(point)||point,
      screenThreshold:options.snapThreshold||7
    })||null;
    let destroyed=false;
    const api=Object.freeze({
      id,adapter,appearance,zoom,minimap,selectionFilter,alignment,
      centerAt100(){return zoom?.centerAt100?.()??false},
      fit(){return zoom?.fit?.()??adapter.fit?.()},
      notifyViewport(viewport=adapter.getViewport?.()||{}){
        appearance?.notifyViewport?.(viewport);zoom?.update?.(viewport);minimap?.schedule?.();selectionFilter?.refreshPosition?.();alignment?.clearGuides?.();global.KGCanvasFloatingToolbarController?.repositionAll?.();
        return viewport;
      },
      refreshMinimap(rebuild=true){return minimap?.schedule?.({rebuild})||false},
      openSettings(){return ensureSettings()?.open?.()||false},
      destroy(){if(destroyed)return false;destroyed=true;appearance?.destroy?.();zoom?.destroy?.();minimap?.destroy?.();selectionFilter?.destroy?.();alignment?.destroy?.();instances.delete(id);return true}
    });
    instances.set(id,api);
    api.notifyViewport();
    try{global.dispatchEvent(new CustomEvent('kg:canvas-runtime-created',{detail:{id,type:options.type||id}}))}catch(_){}
    return api;
  }
  global.KGUnifiedCanvasRuntime=Object.freeze({
    register,get:id=>instances.get(String(id||''))||null,list:()=>[...instances.values()],destroy:id=>instances.get(String(id||''))?.destroy?.()||false,
    openSettings:()=>ensureSettings()?.open?.()||false
  });
})(window);
