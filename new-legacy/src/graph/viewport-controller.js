'use strict';

(function(global){
  function create(options={}){
    const stage=options.stage,world=options.world;
    const getViewport=()=>typeof options.getViewport==='function'?options.getViewport():{x:0,y:0,scale:1};
    const minScale=Number(options.minScale)||.01,maxScale=Number(options.maxScale)||4;
    let applyCount=0;
    const clamp=(v,min,max)=>Math.max(min,Math.min(max,v));
    function apply(viewport=getViewport(),meta={}){
      if(!world)return false;
      const x=Number(viewport.x)||0,y=Number(viewport.y)||0,scale=clamp(Number(viewport.scale)||1,minScale,maxScale);
      world.style.transform=`translate(${x}px, ${y}px) scale(${scale})`;applyCount++;
      if(meta.hideTransient&&typeof options.hideTransient==='function')options.hideTransient();
      if(typeof options.onApply==='function')options.onApply({x,y,scale,source:meta.source||'apply'});
      return true;
    }
    function screenToWorld(clientX,clientY,viewport=getViewport()){
      const rect=stage&&stage.getBoundingClientRect?stage.getBoundingClientRect():{left:0,top:0};
      const scale=Math.max(minScale,Number(viewport.scale)||1);
      return{x:(clientX-rect.left-(Number(viewport.x)||0))/scale,y:(clientY-rect.top-(Number(viewport.y)||0))/scale};
    }
    function viewportForScaleAt(scale,clientX,clientY,viewport=getViewport()){
      const rect=stage&&stage.getBoundingClientRect?stage.getBoundingClientRect():{left:0,top:0};
      const point=screenToWorld(clientX,clientY,viewport),next=clamp(Number(scale)||1,minScale,maxScale);
      return{scale:next,x:clientX-rect.left-point.x*next,y:clientY-rect.top-point.y*next};
    }
    function getDiagnostics(){return{applyCount,fullRedrawCount:0}}
    return Object.freeze({apply,screenToWorld,viewportForScaleAt,getDiagnostics,minScale,maxScale});
  }
  global.KGGraphViewportController=Object.freeze({create});
})(typeof window!=='undefined'?window:globalThis);
