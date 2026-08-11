'use strict';

/*
 * CanvasDragPerformanceController v1
 * Coalesces geometry work into one animation frame and exposes a lightweight
 * drag lifecycle without knowing anything about the page's graph model.
 */
(function(global){
  function create(options={}){
    const root=options.root||null;
    const activeClass=String(options.activeClass||'is-drag-lite');
    const update=typeof options.update==='function'?options.update:()=>{};
    const onStart=typeof options.onStart==='function'?options.onStart:()=>{};
    const onStop=typeof options.onStop==='function'?options.onStop:()=>{};
    const requestFrame=global.requestAnimationFrame||((callback)=>global.setTimeout(callback,16));
    const cancelFrame=global.cancelAnimationFrame||global.clearTimeout;
    let active=false,frame=0,destroyed=false;
    const pendingIds=new Set(),activeIds=new Set();

    function addIds(ids=[]){
      (Array.isArray(ids)?ids:[ids]).forEach(id=>{if(id!==undefined&&id!==null&&String(id)){const key=String(id);pendingIds.add(key);if(active)activeIds.add(key)}});
    }
    function flush(){
      if(frame){cancelFrame(frame);frame=0}
      if(!pendingIds.size)return false;
      const ids=[...pendingIds];pendingIds.clear();
      update(ids,{active});
      return true;
    }
    function schedule(ids=[]){
      if(destroyed)return false;
      addIds(ids);
      if(frame)return true;
      frame=requestFrame(()=>{frame=0;flush()});
      return true;
    }
    function start(ids=[]){
      if(destroyed)return false;
      addIds(ids);
      if(!active){active=true;pendingIds.forEach(id=>activeIds.add(id));root?.classList?.add(activeClass);onStart([...activeIds])}
      return true;
    }
    function stop(ids=[]){
      if(destroyed)return false;
      addIds(ids);const completed=[...activeIds];flush();
      if(active){active=false;root?.classList?.remove(activeClass);onStop(completed)}
      pendingIds.clear();activeIds.clear();
      return true;
    }
    function destroy(){
      if(destroyed)return false;
      stop();destroyed=true;return true;
    }
    return Object.freeze({start,schedule,flush,stop,destroy,isActive:()=>active});
  }
  global.KGCanvasDragPerformanceController=Object.freeze({create});
})(typeof window!=='undefined'?window:globalThis);
