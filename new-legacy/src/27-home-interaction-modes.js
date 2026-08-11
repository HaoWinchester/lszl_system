'use strict';

/*
 * 首页交互模式：阅读 / 高效 / 专业。
 *
 * 设计约束：
 * - 不改变首页既有布局，搜索、缩放、居中、缩略图等独立控件保持原位。
 * - 仅切换主悬浮工具栏、节点工具栏和画布交互能力。
 * - 手机端强制阅读模式，但不覆盖 PC 端偏好。
 */
(function(global){
  const STORAGE_KEY='kg_home_interaction_mode_v1';
  const PROFESSIONAL_FLOW_KEY='kg_home_professional_flow_v1';
  const MODES=Object.freeze({READING:'reading',EFFICIENT:'efficient',PROFESSIONAL:'professional'});
  const LABELS=Object.freeze({reading:'阅读',efficient:'高效',professional:'专业'});
  const FULL_LABELS=Object.freeze({reading:'阅读模式',efficient:'高效模式',professional:'专业模式'});
  const TOOLTIPS=Object.freeze({
    reading:'阅读模式：专注浏览图谱，不提供编辑操作',
    efficient:'高效模式：保留常用编辑、框选与多选',
    professional:'专业模式：提供完整编辑与路径控制'
  });
  const CAPABILITIES=Object.freeze({
    reading:Object.freeze({
      read:true,editGraph:false,nodeDrag:false,nodeEdit:false,nodeResize:false,textEdit:false,textDrag:false,
      boxSelect:false,multiSelect:false,selectionBoundsMove:false,connections:false,nodeToolbar:false,
      edgeSelect:false,edgeMove:false,edgeAdvanced:false,edgeToolbar:false,edgeLabelEdit:false,contextMenu:true,contextMenuAdvanced:false
    }),
    efficient:Object.freeze({
      read:true,editGraph:true,nodeDrag:true,nodeEdit:true,nodeResize:true,textEdit:true,textDrag:true,
      boxSelect:true,multiSelect:true,selectionBoundsMove:true,connections:true,nodeToolbar:true,
      edgeSelect:true,edgeMove:false,edgeAdvanced:false,edgeToolbar:false,edgeLabelEdit:true,contextMenu:true,contextMenuAdvanced:false
    }),
    professional:Object.freeze({
      read:true,editGraph:true,nodeDrag:true,nodeEdit:true,nodeResize:true,textEdit:true,textDrag:true,
      boxSelect:true,multiSelect:true,selectionBoundsMove:true,connections:true,nodeToolbar:true,
      edgeSelect:true,edgeMove:true,edgeAdvanced:true,edgeToolbar:true,edgeLabelEdit:true,contextMenu:true,contextMenuAdvanced:true
    })
  });
  const ICONS=Object.freeze({
    reading:'<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M3 12s3.5-6 9-6 9 6 9 6-3.5 6-9 6-9-6-9-6Z"></path><circle cx="12" cy="12" r="2.5"></circle></svg>',
    efficient:'<svg viewBox="0 0 24 24" aria-hidden="true"><path d="m13 2-8 12h7l-1 8 8-12h-7l1-8Z"></path></svg>',
    professional:'<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M4 7h10M18 7h2M4 17h2M10 17h10M4 12h4M12 12h8"></path><circle cx="16" cy="7" r="2"></circle><circle cx="8" cy="17" r="2"></circle><circle cx="10" cy="12" r="2"></circle></svg>',
    chevron:'<svg viewBox="0 0 20 20" aria-hidden="true"><path d="m6 8 4 4 4-4"></path></svg>'
  });

  let preferredDesktopMode=readStoredMode();
  let effectiveMode='';
  let menuRoot=null;
  let resizeTimer=0;

  function storageRead(key,fallback=null){
    try{
      const store=global.KGAppStorage;
      if(store&&typeof store.readJSON==='function')return store.readJSON(key,fallback);
      const raw=global.localStorage&&global.localStorage.getItem(key);
      return raw==null?fallback:JSON.parse(raw);
    }catch(error){return fallback}
  }
  function storageWrite(key,value){
    try{
      const store=global.KGAppStorage;
      if(store&&typeof store.writeJSON==='function')return store.writeJSON(key,value);
      global.localStorage&&global.localStorage.setItem(key,JSON.stringify(value));
      return true;
    }catch(error){return false}
  }
  function normalizeMode(value){return Object.values(MODES).includes(String(value))?String(value):MODES.EFFICIENT}
  function readStoredMode(){return normalizeMode(storageRead(STORAGE_KEY,MODES.EFFICIENT))}
  function isPhone(){
    const narrow=global.matchMedia&&global.matchMedia('(max-width: 720px)').matches;
    const mobileUA=/Android.+Mobile|iPhone|iPod|Windows Phone|Mobile Safari/i.test(String(global.navigator&&global.navigator.userAgent||''));
    return !!(narrow||mobileUA);
  }
  function resolvedMode(){return isPhone()?MODES.READING:preferredDesktopMode}
  function getMode(){return effectiveMode||resolvedMode()}
  function can(capability){const mode=getMode();return !!(CAPABILITIES[mode]&&CAPABILITIES[mode][capability])}
  function is(mode){return getMode()===normalizeMode(mode)}

  function readProfessionalFlow(){return !!storageRead(PROFESSIONAL_FLOW_KEY,false)}
  function rememberProfessionalFlow(){
    const flow=global.KGGraphFlowMode;
    if(flow&&typeof flow.isEnabled==='function')storageWrite(PROFESSIONAL_FLOW_KEY,!!flow.isEnabled());
  }
  function applyFlowPolicy(previous,next,options={}){
    const flow=global.KGGraphFlowMode;
    if(!flow||typeof flow.set!=='function')return;
    if(previous===MODES.PROFESSIONAL&&next!==MODES.PROFESSIONAL)rememberProfessionalFlow();
    const enabled=next===MODES.READING||next===MODES.EFFICIENT?true:readProfessionalFlow();
    flow.set(enabled,{render:options.render!==false,silent:true,source:'interaction-mode'});
  }
  function setDocumentMode(mode){
    const body=document.body,root=document.documentElement,stage=document.getElementById('stage');
    [body,root,stage].forEach(element=>{if(element)element.dataset.graphInteractionMode=mode});
    if(body){body.classList.toggle('graph-mode-reading',mode===MODES.READING);body.classList.toggle('graph-mode-efficient',mode===MODES.EFFICIENT);body.classList.toggle('graph-mode-professional',mode===MODES.PROFESSIONAL);body.classList.toggle('graph-phone-reading',isPhone())}
  }
  function cancelTransient(){
    try{global.KGGraphModeRuntime&&global.KGGraphModeRuntime.cancel&&global.KGGraphModeRuntime.cancel()}catch(error){}
    try{global.KGHomeToolbarRegistry&&global.KGHomeToolbarRegistry.hideTransientMenus&&global.KGHomeToolbarRegistry.hideTransientMenus()}catch(error){}
  }
  function refreshModeUI(){
    try{global.KGHomeToolbarRegistry&&global.KGHomeToolbarRegistry.setMode&&global.KGHomeToolbarRegistry.setMode(getMode())}catch(error){}
    try{global.KGGraphModeRuntime&&global.KGGraphModeRuntime.refresh&&global.KGGraphModeRuntime.refresh()}catch(error){}
    updateMenu();
  }
  function applyMode(next,options={}){
    const requested=normalizeMode(next);
    if(!isPhone()&&options.persist!==false){preferredDesktopMode=requested;storageWrite(STORAGE_KEY,preferredDesktopMode)}
    const resolved=isPhone()?MODES.READING:requested;
    const previous=effectiveMode||resolved;
    if(previous===resolved&&options.force!==true){setDocumentMode(resolved);updateMenu();return resolved}
    cancelTransient();
    effectiveMode=resolved;
    setDocumentMode(resolved);
    applyFlowPolicy(previous,resolved,{render:false});
    refreshModeUI();
    global.dispatchEvent(new CustomEvent('kg-home-interaction-mode-change',{detail:{mode:resolved,preferredDesktopMode,mobileForced:isPhone()}}));
    if(options.announce!==false&&typeof global.showStatus==='function')global.showStatus(`已切换为${FULL_LABELS[resolved]}。`);
    return resolved;
  }

  function closeMenu(){
    if(!menuRoot)return;
    const menu=menuRoot.querySelector('.graph-mode-menu'),trigger=menuRoot.querySelector('.graph-mode-trigger');
    if(menu)menu.hidden=true;
    menuRoot.classList.remove('menu-open');
    if(trigger)trigger.setAttribute('aria-expanded','false');
  }
  function toggleMenu(event){
    event&&event.preventDefault();event&&event.stopPropagation();
    if(!menuRoot)return;
    const menu=menuRoot.querySelector('.graph-mode-menu'),trigger=menuRoot.querySelector('.graph-mode-trigger');
    const open=!!(menu&&menu.hidden);
    if(menu)menu.hidden=!open;
    menuRoot.classList.toggle('menu-open',open);
    if(trigger)trigger.setAttribute('aria-expanded',open?'true':'false');
  }
  function updateMenu(){
    if(!menuRoot)return;
    const mode=getMode(),trigger=menuRoot.querySelector('.graph-mode-trigger'),label=menuRoot.querySelector('.graph-mode-trigger-label'),icon=menuRoot.querySelector('.graph-mode-trigger-icon');
    if(label)label.textContent=LABELS[mode];
    if(icon)icon.innerHTML=ICONS[mode];
    if(trigger){trigger.dataset.tooltip=TOOLTIPS[mode];trigger.setAttribute('aria-label',FULL_LABELS[mode])}
    menuRoot.querySelectorAll('[data-graph-mode-option]').forEach(button=>{
      const active=button.dataset.graphModeOption===mode;
      button.classList.toggle('active',active);button.setAttribute('aria-checked',active?'true':'false');
    });
    menuRoot.hidden=isPhone();
  }
  function createMenu(){
    if(menuRoot&&menuRoot.isConnected)return menuRoot;
    const dock=document.getElementById('home-graph-canvasMinimapDock')||document.querySelector('.uc-minimap-dock');
    if(!dock)return null;
    const root=document.createElement('div');root.className='graph-mode-switcher';root.id='graphModeSwitcher';root.dataset.stageUi='true';
    root.innerHTML=`<button type="button" class="graph-mode-trigger" aria-haspopup="menu" aria-expanded="false"><span class="graph-mode-trigger-icon"></span><span class="graph-mode-trigger-label"></span>${ICONS.chevron}</button><div class="graph-mode-menu" role="menu" aria-label="图谱模式" hidden>${Object.values(MODES).map(mode=>`<button type="button" role="menuitemradio" aria-checked="false" data-graph-mode-option="${mode}" data-tooltip="${TOOLTIPS[mode]}"><span class="graph-mode-option-icon">${ICONS[mode]}</span><span>${FULL_LABELS[mode]}</span></button>`).join('')}</div>`;
    root.addEventListener('pointerdown',event=>event.stopPropagation());
    root.querySelector('.graph-mode-trigger').addEventListener('click',toggleMenu);
    root.querySelectorAll('[data-graph-mode-option]').forEach(button=>button.addEventListener('click',event=>{event.preventDefault();event.stopPropagation();applyMode(button.dataset.graphModeOption,{persist:true,announce:true});closeMenu()}));
    dock.insertBefore(root,dock.firstChild);menuRoot=root;updateMenu();return root;
  }
  function initialize(){
    effectiveMode=resolvedMode();
    setDocumentMode(effectiveMode);
    applyFlowPolicy('',effectiveMode,{render:false});
    createMenu();
    refreshModeUI();
  }

  document.addEventListener('pointerdown',event=>{if(menuRoot&&!menuRoot.contains(event.target))closeMenu()},true);
  document.addEventListener('keydown',event=>{if(event.key==='Escape')closeMenu()});
  global.addEventListener('resize',()=>{clearTimeout(resizeTimer);resizeTimer=setTimeout(()=>{const next=resolvedMode();if(next!==effectiveMode)applyMode(preferredDesktopMode,{persist:false,announce:false,force:true});else{setDocumentMode(next);updateMenu()}},120)});

  global.KGHomeInteractionModes=Object.freeze({
    MODES,LABELS,FULL_LABELS,CAPABILITIES,getMode,getPreferredDesktopMode:()=>preferredDesktopMode,
    isPhone,is,can,setMode:(mode,options={})=>applyMode(mode,options),refresh:refreshModeUI,ensureMenu:createMenu
  });

  if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',initialize,{once:true});
  else initialize();
})(typeof window!=='undefined'?window:globalThis);
