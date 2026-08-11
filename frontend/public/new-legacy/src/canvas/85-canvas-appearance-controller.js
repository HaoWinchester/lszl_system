'use strict';

/*
 * CanvasAppearanceController v1
 * Shared canvas appearance preferences for graph, multi-question, single-question and recall canvases.
 */
(function(global){
  const STORAGE_KEY='kg_canvas_view_preferences_v1';
  const EVENT_NAME='kg:canvas-view-preferences-changed';
  const PALETTES=Object.freeze({
    light:Object.freeze([
      Object.freeze({id:'light-gray',label:'浅灰色',color:'#f4f6f8'}),
      Object.freeze({id:'eye-yellow',label:'护眼黄',color:'#fff8dc'}),
      Object.freeze({id:'eye-green',label:'护眼绿',color:'#eef8ee'}),
      Object.freeze({id:'light-blue',label:'浅蓝色',color:'#eef6ff'}),
      Object.freeze({id:'light-pink',label:'浅粉色',color:'#fff1f5'}),
      Object.freeze({id:'eye-purple',label:'护眼紫',color:'#f6f0ff'})
    ]),
    dark:Object.freeze([
      Object.freeze({id:'dark-gray',label:'深灰色',color:'#20242b'}),
      Object.freeze({id:'black',label:'黑色',color:'#0b0d10'})
    ])
  });
  const DEFAULTS=Object.freeze({
    version:1,
    theme:'light',
    pattern:'dots',
    backgroundColor:'#f4f6f8',
    lightColor:'#f4f6f8',
    darkColor:'#20242b',
    minimapExpanded:true
  });
  const listeners=new Set();

  const clone=value=>JSON.parse(JSON.stringify(value));
  const safeTheme=value=>value==='dark'?'dark':'light';
  const safePattern=value=>['dots','grid','solid'].includes(value)?value:'dots';
  const safeColor=(value,fallback)=>/^#[0-9a-f]{6}$/i.test(String(value||''))?String(value).toLowerCase():fallback;
  function normalize(value={}){
    const theme=safeTheme(value.theme);
    const lightColor=safeColor(value.lightColor,DEFAULTS.lightColor);
    const darkColor=safeColor(value.darkColor,DEFAULTS.darkColor);
    const backgroundColor=safeColor(value.backgroundColor,theme==='dark'?darkColor:lightColor);
    return {
      version:1,
      theme,
      pattern:safePattern(value.pattern),
      backgroundColor,
      lightColor,
      darkColor,
      minimapExpanded:value.minimapExpanded!==false
    };
  }
  function read(){
    try{
      const raw=global.localStorage?.getItem(STORAGE_KEY);
      return normalize(raw?JSON.parse(raw):DEFAULTS);
    }catch(_){return normalize(DEFAULTS)}
  }
  function write(next={},meta={}){
    const current=read();
    const merged=normalize({...current,...next});
    if(Object.prototype.hasOwnProperty.call(next,'theme')&&!Object.prototype.hasOwnProperty.call(next,'backgroundColor')){
      merged.backgroundColor=merged.theme==='dark'?merged.darkColor:merged.lightColor;
    }
    if(Object.prototype.hasOwnProperty.call(next,'backgroundColor')){
      if(merged.theme==='dark')merged.darkColor=merged.backgroundColor;
      else merged.lightColor=merged.backgroundColor;
    }
    try{global.localStorage?.setItem(STORAGE_KEY,JSON.stringify(merged))}catch(_){}
    const detail={preferences:clone(merged),source:String(meta.source||'canvas-appearance')};
    listeners.forEach(listener=>{try{listener(detail.preferences,detail)}catch(error){console.error(error)}});
    try{global.dispatchEvent(new CustomEvent(EVENT_NAME,{detail}))}catch(_){}
    return clone(merged);
  }
  function setMinimapExpanded(expanded,meta={}){
    return write({minimapExpanded:expanded!==false},{source:meta.source||'minimap'});
  }
  function subscribe(listener){
    if(typeof listener!=='function')return()=>{};
    listeners.add(listener);
    return()=>listeners.delete(listener);
  }
  function contrastFor(color){
    const hex=safeColor(color,'#f4f6f8').slice(1);
    const r=parseInt(hex.slice(0,2),16),g=parseInt(hex.slice(2,4),16),b=parseInt(hex.slice(4,6),16);
    const luminance=(.2126*r+.7152*g+.0722*b)/255;
    return luminance<.42?'dark':'light';
  }
  function patternInk(preferences){
    return preferences.theme==='dark'?'rgba(226,232,240,.16)':'rgba(71,85,105,.13)';
  }
  function applySurface(surface,preferences=read()){
    if(!surface)return false;
    const prefs=normalize(preferences);
    surface.classList.add('uc-canvas-surface');
    surface.dataset.unifiedCanvasSurface='true';
    surface.dataset.canvasTheme=prefs.theme;
    surface.dataset.canvasPattern=prefs.pattern;
    surface.dataset.canvasContrast=contrastFor(prefs.backgroundColor);
    surface.style.setProperty('--uc-canvas-bg',prefs.backgroundColor);
    surface.style.setProperty('--uc-canvas-pattern-ink',patternInk(prefs));
    surface.style.setProperty('--uc-canvas-pattern-major-ink',prefs.theme==='dark'?'rgba(226,232,240,.23)':'rgba(71,85,105,.20)');
    return true;
  }
  function applyViewport(surface,viewport={},options={}){
    if(!surface)return false;
    const zoom=Math.max(.01,Number(viewport.zoom??viewport.scale)||1);
    const x=Number(viewport.x??viewport.panX)||0;
    const y=Number(viewport.y??viewport.panY)||0;
    const base=Math.max(8,Number(options.baseGrid)||24);
    let worldGrid=base,screenGrid=worldGrid*zoom;
    while(screenGrid<12){worldGrid*=2;screenGrid=worldGrid*zoom}
    while(screenGrid>42&&worldGrid>3){worldGrid/=2;screenGrid=worldGrid*zoom}
    const major=screenGrid*4;
    const mod=(value,size)=>((value%size)+size)%size;
    surface.style.setProperty('--uc-canvas-grid-size',screenGrid.toFixed(3)+'px');
    surface.style.setProperty('--uc-canvas-grid-major-size',major.toFixed(3)+'px');
    surface.style.setProperty('--uc-canvas-grid-x',mod(x,screenGrid).toFixed(3)+'px');
    surface.style.setProperty('--uc-canvas-grid-y',mod(y,screenGrid).toFixed(3)+'px');
    surface.style.setProperty('--uc-canvas-grid-major-x',mod(x,major).toFixed(3)+'px');
    surface.style.setProperty('--uc-canvas-grid-major-y',mod(y,major).toFixed(3)+'px');
    surface.dataset.canvasGridLod=zoom<.2?'far':zoom>1.8?'near':'normal';
    return true;
  }
  function create(options={}){
    const surface=options.surface;
    let preferences=read();
    let destroyed=false;
    const apply=next=>{
      if(destroyed)return false;
      preferences=normalize(next||read());
      applySurface(surface,preferences);
      if(typeof options.getViewport==='function')applyViewport(surface,options.getViewport(),options);
      options.onApply?.(clone(preferences));
      return clone(preferences);
    };
    const onPreferenceEvent=event=>apply(event.detail?.preferences||read());
    global.addEventListener(EVENT_NAME,onPreferenceEvent);
    apply(preferences);
    return Object.freeze({
      key:STORAGE_KEY,
      get:()=>clone(preferences),
      apply,
      notifyViewport:viewport=>applyViewport(surface,viewport,options),
      update:(next,meta={})=>write(next,{source:meta.source||options.id||'canvas'}),
      destroy(){
        if(destroyed)return false;
        destroyed=true;
        global.removeEventListener(EVENT_NAME,onPreferenceEvent);
        return true;
      }
    });
  }

  global.KGCanvasAppearanceController=Object.freeze({
    STORAGE_KEY,
    EVENT_NAME,
    DEFAULTS,
    PALETTES,
    normalize,
    read,
    write,
    subscribe,
    setMinimapExpanded,
    applySurface,
    applyViewport,
    create
  });
})(window);
