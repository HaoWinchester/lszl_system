'use strict';

/* Shared zoom-dock semantics: 1%-400%, 100% + center, fit and fullscreen. */
(function(global){
  const LEVELS=Object.freeze([.01,.02,.03,.05,.10,.15,.20,.33,.50,.75,1,1.25,1.5,2,2.5,3,4]);
  const clamp=(value,min=.01,max=4)=>Math.max(min,Math.min(max,Number(value)||1));
  function nextLevel(current,direction){
    const value=clamp(current);
    if(direction>0)return LEVELS.find(level=>level>value+.000001)??4;
    for(let index=LEVELS.length-1;index>=0;index--)if(LEVELS[index]<value-.000001)return LEVELS[index];
    return .01;
  }
  function toggleFullscreen(element){
    if(!element)return false;
    if(!document.fullscreenElement){
      const request=element.requestFullscreen||element.webkitRequestFullscreen;
      if(request){request.call(element);return true}
      return false;
    }
    const exit=document.exitFullscreen||document.webkitExitFullscreen;
    if(exit){exit.call(document);return true}
    return false;
  }
  function create(options={}){
    const adapter=options.adapter||{};
    const dock=options.dock;
    const percent=options.percent;
    const fullscreen=options.fullscreen;
    let destroyed=false;
    function centerAt100(){
      if(destroyed)return false;
      if(typeof adapter.centerAt100==='function')return adapter.centerAt100()!==false;
      const bounds=adapter.getContentBounds?.();
      return adapter.focusBounds?.(bounds,{zoom:1,maxZoom:1,minZoom:1,duration:420,instant:false,persist:true,source:'percent-reset'})!==false;
    }
    function fit(){return adapter.fit?.()!==false}
    function update(viewport=adapter.getViewport?.()||{}){
      const zoom=clamp(viewport.zoom??viewport.scale);
      if(percent)percent.textContent=Math.round(zoom*100)+'%';
      const slider=dock?.querySelector?.('input[type="range"]');
      if(slider&&document.activeElement!==slider)slider.value=String(Math.round(zoom*100));
      if(fullscreen){
        const active=document.fullscreenElement===adapter.getFullscreenElement?.();
        fullscreen.classList.toggle('active-toggle',!!active);
        fullscreen.title=active?'退出全屏':'全屏';
        fullscreen.setAttribute('aria-label',active?'退出全屏':'全屏显示画布');
      }
      return zoom;
    }
    const onFullscreen=()=>update();
    document.addEventListener('fullscreenchange',onFullscreen);
    document.addEventListener('webkitfullscreenchange',onFullscreen);
    return Object.freeze({
      centerAt100,
      fit,
      update,
      nextLevel,
      toggleFullscreen:()=>toggleFullscreen(adapter.getFullscreenElement?.()),
      destroy(){
        if(destroyed)return false;destroyed=true;
        document.removeEventListener('fullscreenchange',onFullscreen);
        document.removeEventListener('webkitfullscreenchange',onFullscreen);
        return true;
      }
    });
  }
  global.KGCanvasZoomDockController=Object.freeze({LEVELS,nextLevel,toggleFullscreen,create});
})(window);
