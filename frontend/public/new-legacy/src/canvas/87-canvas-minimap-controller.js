'use strict';

/* Lightweight shared minimap renderer and navigator. */
(function(global){
  const clamp=(value,min,max)=>Math.max(min,Math.min(max,value));
  const finite=(value,fallback=0)=>Number.isFinite(Number(value))?Number(value):fallback;
  function boundsFor(items){
    if(!items.length)return{left:-400,top:-280,right:400,bottom:280,width:800,height:560};
    let left=Infinity,top=Infinity,right=-Infinity,bottom=-Infinity;
    items.forEach(item=>{
      const x=finite(item.x),y=finite(item.y),width=Math.max(1,finite(item.width,80)),height=Math.max(1,finite(item.height,50));
      left=Math.min(left,x);top=Math.min(top,y);right=Math.max(right,x+width);bottom=Math.max(bottom,y+height);
    });
    return{left,top,right,bottom,width:Math.max(1,right-left),height:Math.max(1,bottom-top)};
  }
  function create(options={}){
    const root=options.root,world=options.world,view=options.view,toggle=options.toggle;
    if(!root||!world||!view)throw new Error('CanvasMinimapController requires root, world and view');
    const dock=options.dock||root.parentElement;
    const appearance=global.KGCanvasAppearanceController;
    let model=null,drag=null,frame=0,destroyed=false;
    root.classList.add('uc-minimap');world.classList.add('uc-minimap-world');view.classList.add('uc-minimap-view');
    dock?.classList.add('uc-minimap-dock');toggle?.classList.add('uc-minimap-toggle');
    function expanded(){return !dock?.classList.contains('collapsed')&&!root.hidden}
    function setExpanded(value,{persist=true}={}){
      const open=value!==false;
      dock?.classList.toggle('collapsed',!open);
      root.hidden=false;
      root.setAttribute('aria-hidden',open?'false':'true');
      if(toggle){
        toggle.setAttribute('aria-expanded',open?'true':'false');
        toggle.setAttribute('aria-label',open?'收起缩略图':'打开缩略图');
        toggle.title=open?'收起缩略图':'打开缩略图';
      }
      if(persist)appearance?.setMinimapExpanded?.(open,{source:options.id||'minimap'});
      if(open)schedule({rebuild:true});
      return open;
    }
    function build(){
      const items=(options.getItems?.()||[]).filter(Boolean);
      const raw=options.getContentBounds?.()||boundsFor(items);
      const padding=Math.max(20,finite(options.padding,100));
      const bounds={left:finite(raw.left,raw.minX)-padding,top:finite(raw.top,raw.minY)-padding};
      const right=finite(raw.right,finite(raw.maxX,bounds.left+finite(raw.width,800)))+padding;
      const bottom=finite(raw.bottom,finite(raw.maxY,bounds.top+finite(raw.height,560)))+padding;
      bounds.width=Math.max(200,right-bounds.left);bounds.height=Math.max(150,bottom-bounds.top);bounds.right=right;bounds.bottom=bottom;
      const innerW=Math.max(1,(root.clientWidth||200)-16),innerH=Math.max(1,(root.clientHeight||108)-16);
      const scale=Math.min(innerW/bounds.width,innerH/bounds.height);
      const offsetX=8+(innerW-bounds.width*scale)/2-bounds.left*scale;
      const offsetY=8+(innerH-bounds.height*scale)/2-bounds.top*scale;
      model={bounds,scale,offsetX,offsetY};
      const fragment=document.createDocumentFragment();
      items.forEach(item=>{
        const node=document.createElement('span');
        node.className='uc-minimap-item '+(item.kind?'is-'+String(item.kind):'');
        node.style.left=(offsetX+finite(item.x)*scale)+'px';
        node.style.top=(offsetY+finite(item.y)*scale)+'px';
        node.style.width=Math.max(3,finite(item.width,80)*scale)+'px';
        node.style.height=Math.max(3,finite(item.height,50)*scale)+'px';
        fragment.appendChild(node);
      });
      world.replaceChildren(fragment);
    }
    function updateView(){
      if(!model)return;
      const viewport=options.getViewport?.()||{};
      const rect=options.getViewportRect?.()||options.viewport?.getBoundingClientRect?.();
      if(!rect)return;
      const zoom=Math.max(.01,finite(viewport.zoom??viewport.scale,1));
      const x=finite(viewport.x??viewport.panX),y=finite(viewport.y??viewport.panY);
      const worldLeft=-x/zoom,worldTop=-y/zoom,worldWidth=rect.width/zoom,worldHeight=rect.height/zoom;
      view.style.left=(model.offsetX+worldLeft*model.scale)+'px';
      view.style.top=(model.offsetY+worldTop*model.scale)+'px';
      view.style.width=Math.max(8,worldWidth*model.scale)+'px';
      view.style.height=Math.max(6,worldHeight*model.scale)+'px';
    }
    function render({rebuild=false}={}){
      if(destroyed||!expanded()||options.isDisabled?.())return false;
      if(rebuild||!model)build();
      updateView();return true;
    }
    function schedule(optionsValue={}){
      if(frame)cancelAnimationFrame(frame);
      frame=requestAnimationFrame(()=>{frame=0;render(optionsValue)});
      return true;
    }
    function centerFromPoint(clientX,clientY){
      if(!model)return false;
      const rect=root.getBoundingClientRect();
      const worldX=(clientX-rect.left-model.offsetX)/model.scale;
      const worldY=(clientY-rect.top-model.offsetY)/model.scale;
      const viewport=options.getViewport?.()||{};
      const viewportRect=options.getViewportRect?.()||options.viewport?.getBoundingClientRect?.();
      if(!viewportRect)return false;
      const zoom=Math.max(.01,finite(viewport.zoom??viewport.scale,1));
      options.setViewport?.({x:viewportRect.width/2-worldX*zoom,y:viewportRect.height/2-worldY*zoom,zoom},{persist:true,source:'minimap-click'});
      schedule();return true;
    }
    function onRootPointerDown(event){
      if(event.button!==0||event.target===view||view.contains(event.target))return;
      centerFromPoint(event.clientX,event.clientY);event.preventDefault();event.stopPropagation();
    }
    function onViewPointerDown(event){
      if(event.button!==0||!model)return;
      const rect=view.getBoundingClientRect();
      drag={pointerId:event.pointerId,offsetX:event.clientX-rect.left,offsetY:event.clientY-rect.top};
      view.classList.add('dragging');view.setPointerCapture?.(event.pointerId);
      event.preventDefault();event.stopPropagation();
    }
    function onViewPointerMove(event){
      if(!drag||drag.pointerId!==event.pointerId||!model)return;
      const rootRect=root.getBoundingClientRect(),viewRect=view.getBoundingClientRect();
      const left=clamp(event.clientX-rootRect.left-drag.offsetX,0,Math.max(0,rootRect.width-viewRect.width));
      const top=clamp(event.clientY-rootRect.top-drag.offsetY,0,Math.max(0,rootRect.height-viewRect.height));
      const worldLeft=(left-model.offsetX)/model.scale,worldTop=(top-model.offsetY)/model.scale;
      const viewport=options.getViewport?.()||{};
      const zoom=Math.max(.01,finite(viewport.zoom??viewport.scale,1));
      options.setViewport?.({x:-worldLeft*zoom,y:-worldTop*zoom,zoom},{persist:false,source:'minimap-drag'});
      event.preventDefault();event.stopPropagation();
    }
    function finish(event){
      if(!drag||drag.pointerId!==event.pointerId)return;
      drag=null;view.classList.remove('dragging');
      try{view.releasePointerCapture?.(event.pointerId)}catch(_){}
      options.persistViewport?.();event.preventDefault();event.stopPropagation();
    }
    root.addEventListener('pointerdown',onRootPointerDown);
    view.addEventListener('pointerdown',onViewPointerDown);
    view.addEventListener('pointermove',onViewPointerMove);
    view.addEventListener('pointerup',finish);view.addEventListener('pointercancel',finish);
    function onTogglePointerDown(event){event.stopPropagation()}
    function onToggleClick(event){
      event.preventDefault();event.stopPropagation();event.stopImmediatePropagation?.();
      setExpanded(!expanded());
    }
    toggle?.addEventListener('pointerdown',onTogglePointerDown,{capture:true});
    toggle?.addEventListener('click',onToggleClick,{capture:true});
    setExpanded(appearance?.read?.().minimapExpanded!==false,{persist:false});
    return Object.freeze({
      render,schedule,setExpanded,isExpanded:expanded,getModel:()=>model,
      destroy(){
        if(destroyed)return false;destroyed=true;if(frame)cancelAnimationFrame(frame);
        root.removeEventListener('pointerdown',onRootPointerDown);
        view.removeEventListener('pointerdown',onViewPointerDown);
        view.removeEventListener('pointermove',onViewPointerMove);
        view.removeEventListener('pointerup',finish);view.removeEventListener('pointercancel',finish);
        toggle?.removeEventListener('pointerdown',onTogglePointerDown,{capture:true});
        toggle?.removeEventListener('click',onToggleClick,{capture:true});
        return true;
      }
    });
  }
  global.KGCanvasMinimapController=Object.freeze({boundsFor,create});
})(window);
