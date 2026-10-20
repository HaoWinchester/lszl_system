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
    const menu=existingMenu||document.createElement('details');
    menu.className='learning-theme-menu';menu.dataset.learningThemeMenu=controller.scope;
    const choices=[...select.options].map(option=>({id:option.value,label:option.textContent}));
    if(!existingMenu)select.before(menu);
    select.hidden=true;select.tabIndex=-1;
    const summary=document.createElement('summary');summary.textContent='卡片主题';summary.setAttribute('aria-label','设置卡片主题');
    const panel=document.createElement('div');panel.className='learning-theme-panel';panel.dataset.learningThemePanel='';
    const title=document.createElement('strong');title.textContent='卡片主题';
    const hint=document.createElement('p');hint.textContent='预览整张卡片；文档背景保持独立。';
    const grid=document.createElement('div');grid.className='learning-theme-choices';grid.setAttribute('role','group');grid.setAttribute('aria-label','卡片主题');
    let draft=controller.saved(),openingOwner='';
    const sync=value=>{draft=value;select.value=value;grid.querySelectorAll('button').forEach(button=>button.setAttribute('aria-pressed',String(button.dataset.krTheme===value)))};
    for(const choice of choices){const button=document.createElement('button');button.type='button';button.dataset.krTheme=choice.id;button.className='kr-scene-option';button.textContent=choice.label;button.addEventListener('click',()=>{sync(choice.id);controller.preview(choice.id)});grid.append(button)}
    const actions=document.createElement('footer'),cancel=document.createElement('button'),save=document.createElement('button');cancel.type=save.type='button';cancel.textContent='取消';save.textContent='保存主题';save.dataset.themeSave='';
    const cancelPreview=()=>{controller.preview(controller.saved());sync(controller.saved());menu.open=false};
    cancel.onclick=cancelPreview;save.onclick=()=>{if(openingOwner!==(global.KGAuthCore?.currentUser?.()?.username||'')){cancelPreview();return}try{controller.apply(draft);menu.open=false}catch(_){hint.textContent='主题保存失败，请重试。';hint.setAttribute('role','status')}};
    actions.append(cancel,save);panel.append(title,hint,grid,actions);menu.replaceChildren(summary,panel,select);
    menu.addEventListener('toggle',()=>{if(menu.open){openingOwner=global.KGAuthCore?.currentUser?.()?.username||'';sync(controller.saved())}else{controller.preview(controller.saved());sync(controller.saved())}});
    document.addEventListener('click',event=>{if(menu.open&&!menu.contains(event.target))cancelPreview()});
    document.addEventListener('keydown',event=>{if(event.key==='Escape'&&menu.open){event.preventDefault();cancelPreview();summary.focus()}});
    global.addEventListener('kg-auth-session-change',cancelPreview);
    select.addEventListener('change',()=>{controller.apply(select.value);sync(select.value)});
    sync(controller.saved());return menu;
  }
  global.KGLearningTheme=Object.freeze({create,bindControls,THEMES,captureWorkspaceBackground,applyWorkspaceBackground});
})(window);
