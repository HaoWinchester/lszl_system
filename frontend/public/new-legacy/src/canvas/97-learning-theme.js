'use strict';

/* Shared scene implementation; each learning mode owns its saved selection. */
(function(global){
  const KEY='kg_deep_recall_theme_v1';
  const MIGRATION_KEY='kg_deep_recall_theme_platform_migrated_v1';
  const THEMES=new Set(['platform','parchment','aurora','neon','sakura','ocean','latte']);
  const Store=global.KGAppStorage||{};
  function readRaw(key){
    try{return Store.readString?Store.readString(key,''):(global.localStorage?.getItem(key)||'')}catch(e){return ''}
  }
  function writeRaw(key,value){
    try{if(Store.writeString)Store.writeString(key,value);else global.localStorage?.setItem(key,value)}catch(e){/* 存储不可用时仅失去持久化 */}
  }
  // A learning theme decorates controls/cards; workspace background belongs to the document.
  function captureWorkspaceBackground(surface,layer){
    const css=layer?global.getComputedStyle(layer):null;
    const appearance=global.KGCanvasAppearanceController?.read?.()||{};
    const color=surface?global.getComputedStyle(surface).getPropertyValue('--uc-canvas-bg').trim():'';
    if(/^#[0-9a-f]{6}$/i.test(color))appearance.backgroundColor=color;
    const surfaceCss=surface?global.getComputedStyle(surface):null;
    return {appearance,surface:{ink:surfaceCss?.getPropertyValue('--uc-canvas-pattern-ink').trim()||'',majorInk:surfaceCss?.getPropertyValue('--uc-canvas-pattern-major-ink').trim()||''},layer:{
      color:css?.backgroundColor||'',image:css?.backgroundImage||'none',repeat:css?.backgroundRepeat||'repeat'
    }};
  }
  function applyWorkspaceBackground(surface,layer,background){
    if(!background)return false;
    global.KGCanvasAppearanceController?.applySurface?.(surface,background.appearance);
    if(surface&&background.surface){
      surface.style.setProperty('--uc-canvas-pattern-ink',background.surface.ink);
      surface.style.setProperty('--uc-canvas-pattern-major-ink',background.surface.majorInk);
    }
    if(layer&&background.layer){
      layer.style.backgroundColor=background.layer.color;
      layer.style.backgroundImage=background.layer.image;
      layer.style.backgroundRepeat=background.layer.repeat;
    }
    return true;
  }
  function create(options={}){
    const scope=options.scope==='workspace'?'workspace':'recall';
    const key=scope==='workspace'?'kg_multi_question_theme_v1':KEY;
    const roots=()=>[].concat(typeof options.roots==='function'?options.roots():options.roots||[]).filter(Boolean);
    // 一次性迁移：旧默认 parchment 统一升级为 platform，之后按存储值走。
    function saved(){
      if(scope==='workspace'){
        const own=readRaw(key);if(THEMES.has(own))return own;
        const legacy=readRaw(KEY),migrated=readRaw(MIGRATION_KEY)==='1';
        return THEMES.has(legacy)&&(legacy!=='parchment'||migrated)?legacy:'platform';
      }
      const raw=readRaw(KEY);
      const migrated=readRaw(MIGRATION_KEY)==='1';
      if(!migrated&&(!raw||raw==='parchment')){
        writeRaw(MIGRATION_KEY,'1');writeRaw(KEY,'platform');
        return 'platform';
      }
      return THEMES.has(raw)?raw:'platform';
    }
    function render(theme){
      const next=THEMES.has(theme)?theme:'platform';
      for(const el of roots())el.dataset.theme=next;
      document.body.dataset.krTheme=next;
      global.dispatchEvent(new CustomEvent('kg:deep-recall-theme-change',{detail:{theme:next,scope}}));
      return next;
    }
    function apply(theme){
      const next=THEMES.has(theme)?theme:'platform';
      writeRaw(key,next);
      return render(next);
    }
    // storage 只在其他标签页触发；更新外观与控件，不回写，避免标签页相互广播。
    global.addEventListener('storage',event=>{
      if(event.storageArea!==global.localStorage||(event.key!==key&&event.key!==null))return;
      render(event.newValue);
    });
    return {init:()=>apply(saved()),apply,saved,THEMES,key,scope};
  }
  global.KGLearningTheme=Object.freeze({create,THEMES,captureWorkspaceBackground,applyWorkspaceBackground});
})(window);
