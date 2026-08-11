'use strict';

(function(global){
  function create(options={}){
    const threshold=Math.max(1,Number(options.threshold)||5);
    let active=null;
    function begin(kind,event,meta={}){
      if(active)return null;
      active={kind:String(kind||'drag'),pointerId:event&&event.pointerId,startClientX:Number(event&&event.clientX)||0,startClientY:Number(event&&event.clientY)||0,clientX:Number(event&&event.clientX)||0,clientY:Number(event&&event.clientY)||0,moved:false,historyCaptured:false,...meta};
      if(typeof options.onBegin==='function')options.onBegin(active,event);return active;
    }
    function update(event){
      if(!active||event&&active.pointerId!==event.pointerId)return null;
      active.clientX=Number(event&&event.clientX)||active.clientX;active.clientY=Number(event&&event.clientY)||active.clientY;
      const dx=active.clientX-active.startClientX,dy=active.clientY-active.startClientY;
      if(!active.moved&&Math.hypot(dx,dy)>=threshold){
        active.moved=true;
        if(!active.historyCaptured&&typeof options.onFirstMove==='function'){options.onFirstMove(active,event);active.historyCaptured=true}
      }
      if(typeof options.onMove==='function')options.onMove(active,event,{dx,dy});return active;
    }
    function finish(event,{cancelled=false}={}){
      if(!active||event&&active.pointerId!==event.pointerId)return null;
      const result=active;active=null;
      if(cancelled&&typeof options.onCancel==='function')options.onCancel(result,event);
      else if(typeof options.onFinish==='function')options.onFinish(result,event);
      return result;
    }
    function cancel(){if(!active)return null;const result=active;active=null;if(typeof options.onCancel==='function')options.onCancel(result,null);return result}
    return Object.freeze({begin,update,finish,cancel,isActive:()=>!!active,getActive:()=>active});
  }
  global.KGGraphDragController=Object.freeze({create});
})(typeof window!=='undefined'?window:globalThis);
