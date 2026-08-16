'use strict';

(function(global){
  const ICONS=Object.freeze({
    copy:'<svg viewBox="0 0 24 24" aria-hidden="true"><rect x="8" y="8" width="12" height="12" rx="2"></rect><path d="M16 8V6a2 2 0 0 0-2-2H6a2 2 0 0 0-2 2v8a2 2 0 0 0 2 2h2"></path></svg>',
    paste:'<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M9 5h6"></path><rect x="5" y="5" width="14" height="16" rx="2"></rect><rect x="8" y="2.5" width="8" height="5" rx="1.5"></rect></svg>',
    layers:'<svg viewBox="0 0 24 24" aria-hidden="true"><path d="m12 3 9 5-9 5-9-5 9-5Z"></path><path d="m3 12 9 5 9-5M3 16l9 5 9-5"></path></svg>',
    up:'<svg viewBox="0 0 24 24" aria-hidden="true"><path d="m7 11 5-5 5 5M12 6v12"></path></svg>',
    down:'<svg viewBox="0 0 24 24" aria-hidden="true"><path d="m7 13 5 5 5-5M12 18V6"></path></svg>',
    front:'<svg viewBox="0 0 24 24" aria-hidden="true"><path d="m7 8 5-5 5 5M12 3v11"></path><path d="M5 18h14"></path></svg>',
    back:'<svg viewBox="0 0 24 24" aria-hidden="true"><path d="m7 16 5 5 5-5M12 21V10"></path><path d="M5 6h14"></path></svg>',
    chevron:'<svg viewBox="0 0 24 24" aria-hidden="true"><path d="m9 6 6 6-6 6"></path></svg>',
    refresh:'<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M20 6v5h-5"></path><path d="M4 18v-5h5"></path><path d="M6.1 9A7 7 0 0 1 18.5 6.5L20 11M4 13l1.5 4.5A7 7 0 0 0 18 15"></path></svg>'
  });
  function actionButton(action,label,icon,extra=''){
    return `<button type="button" class="graph-context-menu-item" data-graph-context-action="${action}" ${extra}>${icon}<span>${label}</span></button>`;
  }
  function create(options={}){
    const stage=options.stage||document.body;
    const allowedActions=Array.isArray(options.actions)&&options.actions.length?new Set(options.actions.map(String)):null;
    const configuredActions=allowedActions;
    function actionAllowed(action){
      const runtimeActions=Array.isArray(context&&context.actions)&&context.actions.length?new Set(context.actions.map(String)):null;
      const allowed=runtimeActions||configuredActions;
      return !allowed||allowed.has(String(action))||(String(action).startsWith('layer:')&&allowed.has('layer'));
    }
    let root=null,visible=false,context=null;
    function ensure(){
      if(root&&root.isConnected)return root;
      root=document.createElement('div');root.className='graph-context-menu';root.hidden=true;root.dataset.stageUi='true';root.setAttribute('role','menu');root.setAttribute('aria-label','画布快捷菜单');
      root.innerHTML=`<div class="graph-context-menu-list">
        ${actionButton('copy','复制',ICONS.copy,'role="menuitem"')}
        ${actionButton('paste','粘贴',ICONS.paste,'role="menuitem"')}
        <div class="graph-context-submenu-wrap" data-graph-context-layer-wrap>
          ${actionButton('layer','层级',ICONS.layers,'role="menuitem" aria-haspopup="true" aria-expanded="false"')}
          <span class="graph-context-chevron">${ICONS.chevron}</span>
          <div class="graph-context-submenu" role="menu" aria-label="层级">
            ${actionButton('layer:raise','上移一层',ICONS.up,'role="menuitem"')}
            ${actionButton('layer:lower','下移一层',ICONS.down,'role="menuitem"')}
            ${actionButton('layer:front','置于顶层',ICONS.front,'role="menuitem"')}
            ${actionButton('layer:back','置于底层',ICONS.back,'role="menuitem"')}
          </div>
        </div>
        <div class="graph-context-separator" role="separator"></div>
        ${actionButton('refresh','文字高清',ICONS.refresh,'role="menuitem"')}
      </div>`;
      root.addEventListener('pointerdown',event=>event.stopPropagation());
      root.addEventListener('contextmenu',event=>{event.preventDefault();event.stopPropagation()});
      root.addEventListener('click',event=>{
        const button=event.target.closest('[data-graph-context-action]');if(!button||button.dataset.graphContextAction==='layer'||button.disabled)return;
        event.preventDefault();event.stopPropagation();
        const action=button.dataset.graphContextAction;
        const detail={action,context:{...(context||{})},button,event};
        hide();if(typeof options.onAction==='function')options.onAction(detail);
      });
      stage.appendChild(root);return root;
    }
    function setVisible(action,show){const button=root.querySelector(`[data-graph-context-action="${action}"]`);if(button)button.hidden=!show}
    function setEnabled(action,enabled){const button=root.querySelector(`[data-graph-context-action="${action}"]`);if(button){button.disabled=!enabled;button.setAttribute('aria-disabled',enabled?'false':'true')}}
    function configure(){
      ensure();const type=context&&context.type==='canvas'?'canvas':'node',locked=!!(context&&context.locked),canPaste=context&&context.canPaste!==false;
      root.dataset.contextType=type;root.classList.toggle('locked-context',locked);
      const showCopy=actionAllowed('copy')&&type==='node'&&!locked;
      const showPaste=actionAllowed('paste')&&!locked;
      const showLayer=actionAllowed('layer')&&type==='node'&&!locked;
      const showRefresh=actionAllowed('refresh');
      setVisible('copy',showCopy);
      setVisible('paste',showPaste);
      setVisible('refresh',showRefresh);
      setEnabled('paste',canPaste&&!locked);
      const layerWrap=root.querySelector('[data-graph-context-layer-wrap]');if(layerWrap)layerWrap.hidden=!showLayer;
      const separator=root.querySelector('.graph-context-separator');if(separator)separator.hidden=!showRefresh||!(showCopy||showPaste||showLayer);
      root.setAttribute('aria-label',type==='canvas'?'画布快捷菜单':locked?'锁定节点快捷菜单':'节点快捷菜单');
    }
    function position(clientX,clientY){
      ensure();const stageRect=stage.getBoundingClientRect(),width=root.offsetWidth||172,height=root.offsetHeight||126,pad=8;
      let left=Number(clientX)-stageRect.left,top=Number(clientY)-stageRect.top;
      left=Math.max(pad,Math.min(left,Math.max(pad,stageRect.width-width-pad)));
      top=Math.max(pad,Math.min(top,Math.max(pad,stageRect.height-height-pad)));
      root.style.left=Math.round(left)+'px';root.style.top=Math.round(top)+'px';
      const submenu=root.querySelector('.graph-context-submenu'),wrap=root.querySelector('.graph-context-submenu-wrap');
      if(submenu&&wrap&&!wrap.hidden){const wrapRect=wrap.getBoundingClientRect(),submenuWidth=submenu.offsetWidth||154;wrap.classList.toggle('open-left',wrapRect.right+submenuWidth>stageRect.right-pad)}
    }
    function show(settings={}){
      ensure();context={type:'node',...(settings.context||{})};configure();root.hidden=false;root.classList.add('show');visible=true;position(settings.clientX,settings.clientY);
      requestAnimationFrame(()=>root.querySelector('.graph-context-menu-item:not([hidden]):not(:disabled)')?.focus?.({preventScroll:true}));return root;
    }
    function hide(){if(!root)return false;visible=false;context=null;root.classList.remove('show','locked-context');root.hidden=true;return true}
    function onOutside(event){if(!visible||!root)return;if(root.contains(event.target))return;hide()}
    function onKey(event){if(!visible)return;if(event.key==='Escape'){event.preventDefault();hide()}}
    document.addEventListener('pointerdown',onOutside,true);document.addEventListener('keydown',onKey,true);global.addEventListener?.('resize',hide,{passive:true});
    function destroy(){hide();document.removeEventListener('pointerdown',onOutside,true);document.removeEventListener('keydown',onKey,true);root?.remove();root=null}
    return Object.freeze({show,hide,position,isVisible:()=>visible,getRoot:ensure,getContext:()=>context&&{...context},destroy});
  }
  global.KGGraphContextMenuController=Object.freeze({create,icons:ICONS});
})(typeof window!=='undefined'?window:globalThis);
