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
    const baseKey=scope==='workspace'?'kg_multi_question_theme_v1':KEY;
    const owner=()=>global.KGAuthCore?.currentUser?.()?.username||'';
    const key=()=>baseKey+'__'+encodeURIComponent(owner()||'guest');
    const roots=()=>[].concat(typeof options.roots==='function'?options.roots():options.roots||[]).filter(Boolean);
    function saved(){
      let own='';try{own=global.KGDevicePreferences?.getString(key(),'')||''}catch(_){}
      if(THEMES.has(own))return own;
      // Consume each old mode's value once, only for the first signed-in owner.
      // An account without its own value never inherits another mode/account.
      const raw=owner()?readRaw(baseKey):'';
      if(THEMES.has(raw)){
        const next=scope==='recall'&&raw==='parchment'&&readRaw(MIGRATION_KEY)!=='1'?'platform':raw;
        try{if(global.KGDevicePreferences){global.KGDevicePreferences.setString(key(),next);writeRaw(baseKey,'')}}catch(_){}
        return next;
      }
      return 'platform';
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
      if(!global.KGDevicePreferences)throw new Error('主题偏好服务尚未就绪，请刷新后重试。');
      global.KGDevicePreferences.setString(key(),next);
      return render(next);
    }
    // storage 只在其他标签页触发；更新外观与控件，不回写，避免标签页相互广播。
    global.addEventListener('storage',event=>{
      if(event.storageArea!==global.localStorage||(event.key!==key()&&event.key!==null))return;
      render(saved());
    });
    global.addEventListener('kg-auth-session-change',()=>render(saved()));
    return {init:()=>{const next=saved();try{return apply(next)}catch(_){return render(next)}},apply,preview:render,saved,THEMES,get key(){return key()},scope};
  }
  function bindControls(controller,select,existingMenu){
    if(!controller||!select)return null;
    // Keep the original native dropdown in each toolbar; choosing a theme saves immediately.
    if(existingMenu)existingMenu.replaceWith(select);
    select.classList.remove('kr-theme-compat-select');
    select.classList.add('learning-theme-select');
    select.hidden=false;select.tabIndex=0;select.removeAttribute('aria-hidden');
    const sync=()=>{select.value=controller.saved()};
    const owner=()=>global.KGAuthCore?.currentUser?.()?.username||'';
    let interactionOwner;
    for(const type of ['pointerdown','keydown'])select.addEventListener(type,()=>{interactionOwner=owner()});
    select.addEventListener('change',()=>{
      const stale=interactionOwner!==undefined&&interactionOwner!==owner();interactionOwner=undefined;
      if(stale){sync();return}
      try{select.value=controller.apply(select.value)}
      catch(_){sync();global.KGDialogs?.alert('主题保存失败，请重试。')}
    });
    global.addEventListener('kg:deep-recall-theme-change',event=>{
      if(event.detail?.scope===controller.scope)select.value=event.detail.theme;
    });
    sync();return select;
  }
  global.KGLearningTheme=Object.freeze({create,bindControls,THEMES,captureWorkspaceBackground,applyWorkspaceBackground});
})(window);
