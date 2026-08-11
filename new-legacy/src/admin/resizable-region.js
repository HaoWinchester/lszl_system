'use strict';
/*
 * V9.0-P4.2.0 maintenance — declarative height resizing for long admin regions.
 * Business data is never touched; only a per-region UI height preference is stored.
 */
(function(global){
  const PREFIX='kg_ui_resizable_region_v1__';
  const initialized=new WeakSet();
  const instances=new Map();
  const number=(value,fallback)=>Number.isFinite(Number(value))?Number(value):fallback;
  const clamp=(value,min,max)=>Math.min(max,Math.max(min,value));
  const storage=()=>global.KGAppStorage||null;
  function read(key,fallback){
    try{
      const api=storage();
      if(api?.readJSON)return number(api.readJSON(PREFIX+key,{height:fallback})?.height,fallback);
      const parsed=JSON.parse(global.localStorage?.getItem(PREFIX+key)||'null');
      return number(parsed?.height,fallback);
    }catch(error){return fallback}
  }
  function write(key,height){
    const value={height:Math.round(height),updatedAt:Date.now()};
    try{
      const api=storage();
      if(api?.writeJSON)return api.writeJSON(PREFIX+key,value);
      global.localStorage?.setItem(PREFIX+key,JSON.stringify(value));
      return true;
    }catch(error){return false}
  }
  function remove(key){
    try{
      const api=storage();
      if(api?.remove)return api.remove(PREFIX+key);
      global.localStorage?.removeItem(PREFIX+key);
      return true;
    }catch(error){return false}
  }
  function disabledByViewport(region){
    return global.innerWidth<=number(region.dataset.kgResizableBreakpoint,820);
  }
  function createHandle(region,key){
    let handle=region.nextElementSibling;
    if(!handle?.classList?.contains('kg-resizable-handle')||handle.dataset.kgResizableFor!==key){
      handle=document.createElement('div');
      handle.className='kg-resizable-handle';
      handle.dataset.kgResizableFor=key;
      handle.setAttribute('role','separator');
      handle.setAttribute('tabindex','0');
      handle.setAttribute('aria-orientation','horizontal');
      handle.setAttribute('aria-label',region.dataset.kgResizableLabel||'拖动调整区域高度；双击恢复默认高度');
      region.insertAdjacentElement('afterend',handle);
    }
    return handle;
  }
  function init(region){
    if(!region||initialized.has(region))return instances.get(region.dataset.kgResizableKey||region.id)||null;
    const key=String(region.dataset.kgResizableKey||region.id||'region').trim();
    const defaultHeight=number(region.dataset.kgResizableDefault,480);
    const minimum=number(region.dataset.kgResizableMin,260);
    const maximum=Math.max(minimum,number(region.dataset.kgResizableMax,1400));
    const step=Math.max(1,number(region.dataset.kgResizableStep,24));
    const handle=createHandle(region,key);
    let height=clamp(read(key,defaultHeight),minimum,maximum),dragging=false,startY=0,startHeight=height;
    function apply(next,{persist=false}={}){
      height=clamp(number(next,defaultHeight),minimum,maximum);
      const disabled=disabledByViewport(region);
      region.classList.toggle('kg-resizable-active',!disabled);
      if(disabled){region.style.removeProperty('--kg-resizable-height');handle.setAttribute('aria-hidden','true')}
      else{
        region.style.setProperty('--kg-resizable-height',Math.round(height)+'px');
        handle.removeAttribute('aria-hidden');
        handle.setAttribute('aria-valuemin',String(Math.round(minimum)));
        handle.setAttribute('aria-valuemax',String(Math.round(maximum)));
        handle.setAttribute('aria-valuenow',String(Math.round(height)));
        handle.setAttribute('aria-valuetext',Math.round(height)+' 像素');
      }
      if(persist)write(key,height);
      region.dispatchEvent(new CustomEvent('kg-resizable-region-change',{bubbles:true,detail:{key,height,disabled}}));
      return height;
    }
    function reset(){height=defaultHeight;remove(key);apply(height);write(key,height)}
    handle.addEventListener('pointerdown',event=>{
      if(disabledByViewport(region))return;
      dragging=true;startY=event.clientY;startHeight=height;
      handle.classList.add('dragging');document.documentElement.classList.add('kg-resizing-region');
      handle.setPointerCapture?.(event.pointerId);event.preventDefault();
    });
    handle.addEventListener('pointermove',event=>{if(dragging)apply(startHeight+(event.clientY-startY))});
    const finish=event=>{
      if(!dragging)return;dragging=false;handle.classList.remove('dragging');document.documentElement.classList.remove('kg-resizing-region');
      try{handle.releasePointerCapture?.(event.pointerId)}catch(error){}
      write(key,height);
    };
    handle.addEventListener('pointerup',finish);handle.addEventListener('pointercancel',finish);
    handle.addEventListener('dblclick',event=>{event.preventDefault();reset()});
    handle.addEventListener('keydown',event=>{
      if(disabledByViewport(region))return;
      if(!['ArrowUp','ArrowDown','PageUp','PageDown','Home','End','Enter'].includes(event.key))return;
      event.preventDefault();
      if(event.key==='Home')apply(minimum,{persist:true});
      else if(event.key==='End')apply(maximum,{persist:true});
      else if(event.key==='Enter')reset();
      else apply(height+(event.key==='ArrowDown'||event.key==='PageDown'?1:-1)*(event.key.startsWith('Page')?step*4:step),{persist:true});
    });
    const onResize=()=>apply(height);
    global.addEventListener('resize',onResize,{passive:true});
    initialized.add(region);
    const api=Object.freeze({key,region,handle,get height(){return height},apply,reset,destroy(){global.removeEventListener('resize',onResize);handle.remove();initialized.delete(region);instances.delete(key)}});
    instances.set(key,api);apply(height);return api;
  }
  function scan(root=document){root.querySelectorAll?.('[data-kg-resizable-region]').forEach(init)}
  function boot(){scan();if(global.MutationObserver){new MutationObserver(records=>records.forEach(record=>record.addedNodes.forEach(node=>{if(node.nodeType!==1)return;if(node.matches?.('[data-kg-resizable-region]'))init(node);scan(node)}))).observe(document.documentElement,{childList:true,subtree:true})}}
  const API=Object.freeze({init,scan,get:key=>instances.get(String(key)),reset:key=>instances.get(String(key))?.reset(),storagePrefix:PREFIX});
  global.KGResizableRegion=API;
  if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',boot,{once:true});else boot();
})(globalThis);
