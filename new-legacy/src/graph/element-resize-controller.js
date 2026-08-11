'use strict';

(function(global){
  const HANDLES=Object.freeze(['nw','n','ne','e','se','s','sw','w']);
  const HANDLE_SET=new Set(HANDLES);
  function finite(value,fallback=0){const n=Number(value);return Number.isFinite(n)?n:fallback}
  function cloneGeometry(value={}){return{x:finite(value.x),y:finite(value.y),width:finite(value.width,1),height:finite(value.height,1)}}
  function changed(a,b,epsilon=.25){return Math.abs(a.x-b.x)>epsilon||Math.abs(a.y-b.y)>epsilon||Math.abs(a.width-b.width)>epsilon||Math.abs(a.height-b.height)>epsilon}
  function computeGeometry(start,handle,dx,dy,limits={}){
    const minWidth=Math.max(1,finite(limits.minWidth,40)),minHeight=Math.max(1,finite(limits.minHeight,24));
    const maxWidth=Math.max(minWidth,finite(limits.maxWidth,Number.MAX_SAFE_INTEGER)),maxHeight=Math.max(minHeight,finite(limits.maxHeight,Number.MAX_SAFE_INTEGER));
    let x=start.x,y=start.y,width=start.width,height=start.height;
    if(handle.includes('e'))width=start.width+dx;
    if(handle.includes('s'))height=start.height+dy;
    if(handle.includes('w')){width=start.width-dx;x=start.x+dx}
    if(handle.includes('n')){height=start.height-dy;y=start.y+dy}
    if(limits.preserveAspectRatio){
      const ratio=Math.max(.0001,start.width/Math.max(1,start.height));
      const horizontal=handle==='e'||handle==='w'||Math.abs(dx)>=Math.abs(dy);
      if(horizontal)height=width/ratio;else width=height*ratio;
      if(handle.includes('w'))x=start.x+start.width-width;
      if(handle.includes('n'))y=start.y+start.height-height;
    }
    width=Math.min(maxWidth,Math.max(minWidth,width));height=Math.min(maxHeight,Math.max(minHeight,height));
    if(handle.includes('w'))x=start.x+start.width-width;
    if(handle.includes('n'))y=start.y+start.height-height;
    return{x:Math.round(x),y:Math.round(y),width:Math.round(width),height:Math.round(height)};
  }
  function create(options={}){
    const threshold=Math.max(0,finite(options.threshold,2));
    let active=null;
    function scale(){return Math.max(.0001,finite(typeof options.getScale==='function'?options.getScale():1,1))}
    function begin(event,config={}){
      if(active||!event||event.button!==0)return false;
      const handle=String(config.handle||'').toLowerCase();if(!HANDLE_SET.has(handle))return false;
      const id=String(config.id||'');if(!id)return false;
      const raw=typeof options.getGeometry==='function'?options.getGeometry(id,config):config.geometry;
      if(!raw)return false;
      const start=cloneGeometry(raw),captureTarget=config.captureTarget||event.currentTarget||event.target;
      active={id,handle,pointerId:event.pointerId,startClientX:finite(event.clientX),startClientY:finite(event.clientY),start,last:{...start},moved:false,historyCaptured:false,captureTarget,config:{...config}};
      try{captureTarget?.setPointerCapture?.(event.pointerId)}catch(error){}
      if(typeof options.onBegin==='function')options.onBegin(active,event);
      event.preventDefault?.();event.stopPropagation?.();return true;
    }
    function update(event){
      if(!active||!event||active.pointerId!==event.pointerId)return false;
      const dx=(finite(event.clientX)-active.startClientX)/scale(),dy=(finite(event.clientY)-active.startClientY)/scale();
      const next=computeGeometry(active.start,active.handle,dx,dy,{
        minWidth:active.config.minWidth??options.minWidth,
        minHeight:active.config.minHeight??options.minHeight,
        maxWidth:active.config.maxWidth??options.maxWidth,
        maxHeight:active.config.maxHeight??options.maxHeight,
        preserveAspectRatio:!!(active.config.preserveAspectRatio??options.preserveAspectRatio)
      });
      if(!active.moved&&Math.hypot(dx,dy)>=threshold){
        active.moved=true;
        if(!active.historyCaptured&&typeof options.onFirstResize==='function'){options.onFirstResize(active,event);active.historyCaptured=true}
      }
      if(active.moved&&changed(active.last,next,0)){
        active.last=next;
        if(typeof options.applyGeometry==='function')options.applyGeometry(active.id,next,{preview:true,session:active,event});
        if(typeof options.onResize==='function')options.onResize(active,event,next);
      }
      event.preventDefault?.();event.stopPropagation?.();return true;
    }
    function finish(event,{cancelled=false}={}){
      if(!active||event&&active.pointerId!==event.pointerId)return false;
      const session=active;active=null;
      try{session.captureTarget?.releasePointerCapture?.(session.pointerId)}catch(error){}
      if(cancelled&&session.moved){
        if(typeof options.applyGeometry==='function')options.applyGeometry(session.id,session.start,{preview:false,cancelled:true,session,event});
        if(typeof options.onCancel==='function')options.onCancel(session,event);
      }else if(session.moved){
        if(typeof options.applyGeometry==='function')options.applyGeometry(session.id,session.last,{preview:false,session,event});
        if(typeof options.onCommit==='function')options.onCommit(session,event);
      }else if(typeof options.onNoop==='function')options.onNoop(session,event);
      if(typeof options.onEnd==='function')options.onEnd(session,event,{cancelled:!!cancelled});
      event?.preventDefault?.();event?.stopPropagation?.();return session;
    }
    function cancel(){return active?finish(null,{cancelled:true}):false}
    return Object.freeze({begin,update,finish,cancel,isActive:()=>!!active,getActive:()=>active,handles:HANDLES});
  }
  global.KGGraphElementResizeController=Object.freeze({create,HANDLES,computeGeometry});
})(typeof window!=='undefined'?window:globalThis);
