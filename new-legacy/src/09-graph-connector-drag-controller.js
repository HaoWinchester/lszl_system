'use strict';

/*
 * Knowledge graph connector drag controller.
 * Keeps pointer lifecycle and rAF throttling outside the page-sized graph editor.
 */
(function(global){
  function create(options={}){
    const doc=options.document||global.document;
    const raf=options.requestAnimationFrame||global.requestAnimationFrame?.bind(global)||((fn)=>setTimeout(fn,16));
    const caf=options.cancelAnimationFrame||global.cancelAnimationFrame?.bind(global)||clearTimeout;
    const threshold=Math.max(1,Number(options.threshold)||6);
    let active=null;
    let pendingEvent=null;
    let frame=0;

    function detach(){
      if(!doc)return;
      doc.removeEventListener('pointermove',onPointerMove,true);
      doc.removeEventListener('pointerup',onPointerUp,true);
      doc.removeEventListener('pointercancel',onPointerCancel,true);
    }
    function snapshot(event){
      if(!active)return null;
      return {
        ...active,
        event,
        targetId:active.targetId||null
      };
    }
    function flush(){
      frame=0;
      const event=pendingEvent;
      pendingEvent=null;
      if(!active||!event||event.pointerId!==active.pointerId)return;
      const dx=event.clientX-active.startClientX;
      const dy=event.clientY-active.startClientY;
      if(!active.moved&&Math.hypot(dx,dy)>=threshold)active.moved=true;
      active.clientX=event.clientX;
      active.clientY=event.clientY;
      active.targetId=typeof options.resolveTarget==='function'
        ? (options.resolveTarget(event,active)||null)
        : null;
      if(typeof options.onMove==='function')options.onMove(snapshot(event));
    }
    function onPointerMove(event){
      if(!active||event.pointerId!==active.pointerId)return;
      pendingEvent=event;
      if(!frame)frame=raf(flush);
      if(active.moved||Math.hypot(event.clientX-active.startClientX,event.clientY-active.startClientY)>=threshold){
        event.preventDefault();
      }
    }
    function finish(event,cancelled){
      if(!active||event.pointerId!==active.pointerId)return false;
      if(frame){caf(frame);frame=0}
      if(pendingEvent){
        const queued=pendingEvent;
        pendingEvent=null;
        if(queued.pointerId===active.pointerId){
          const dx=queued.clientX-active.startClientX;
          const dy=queued.clientY-active.startClientY;
          if(!active.moved&&Math.hypot(dx,dy)>=threshold)active.moved=true;
          active.clientX=queued.clientX;
          active.clientY=queued.clientY;
          active.targetId=typeof options.resolveTarget==='function'
            ? (options.resolveTarget(queued,active)||null)
            : null;
        }
      }
      const result=snapshot(event);
      active=null;
      detach();
      if(cancelled){
        if(typeof options.onCancel==='function')options.onCancel(result);
      }else if(result.moved&&result.targetId){
        if(typeof options.onConnect==='function')options.onConnect(result);
      }else if(result.moved){
        if(typeof options.onDropMiss==='function')options.onDropMiss(result);
      }else if(typeof options.onClick==='function'){
        options.onClick(result);
      }
      event.preventDefault();
      event.stopPropagation();
      return true;
    }
    function onPointerUp(event){finish(event,false)}
    function onPointerCancel(event){finish(event,true)}
    function begin(event,meta={}){
      if(!doc||!event||event.button!==0)return false;
      cancel();
      active={
        ...meta,
        pointerId:event.pointerId,
        startClientX:event.clientX,
        startClientY:event.clientY,
        clientX:event.clientX,
        clientY:event.clientY,
        moved:false,
        targetId:null
      };
      doc.addEventListener('pointermove',onPointerMove,true);
      doc.addEventListener('pointerup',onPointerUp,true);
      doc.addEventListener('pointercancel',onPointerCancel,true);
      if(typeof options.onStart==='function')options.onStart(snapshot(event));
      event.preventDefault();
      event.stopPropagation();
      return true;
    }
    function cancel(){
      if(!active)return false;
      const result=snapshot(null);
      active=null;
      pendingEvent=null;
      if(frame){caf(frame);frame=0}
      detach();
      if(typeof options.onCancel==='function')options.onCancel(result);
      return true;
    }
    return Object.freeze({begin,cancel,isActive:()=>!!active,getState:()=>snapshot(null)});
  }

  global.KGGraphConnectorDrag=Object.freeze({create});
})(window);
