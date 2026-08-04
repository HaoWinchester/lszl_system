'use strict';

(function(global){
  const PANEL_SELECTOR='[data-workspace-panel]';
  const GROUP_SELECTOR='[data-workspace-group]';
  const state={maximized:null,collapsed:new Map()};
  let rail=null;

  function titleOf(panel){return panel.dataset.workspaceTitle||panel.querySelector('h2,h3')?.textContent?.trim()||'工作区域'}
  function ensureRail(){
    if(rail)return rail;
    rail=document.createElement('aside');rail.className='wsp-collapsed-rail';rail.id='wspCollapsedRail';rail.setAttribute('aria-label','已收起的工作区域');document.body.appendChild(rail);return rail;
  }
  function groupOf(panel){return panel.closest(GROUP_SELECTOR)}
  function updateGroup(group){
    if(!group)return;
    const panels=[...group.querySelectorAll(`:scope > ${PANEL_SELECTOR}, :scope > * > ${PANEL_SELECTOR}`)].filter(panel=>panel.closest(GROUP_SELECTOR)===group);
    const visible=panels.filter(panel=>!panel.classList.contains('wsp-panel-collapsed'));
    const columnPanels=visible.filter(panel=>panel.dataset.workspaceSpan!=='full');
    group.dataset.visiblePanels=String(Math.max(1,columnPanels.length||Math.min(visible.length,1)));
  }
  function dispatch(panel,mode){panel.dispatchEvent(new CustomEvent('workspacepanelchange',{bubbles:true,detail:{panelId:panel.dataset.workspacePanel,mode}}))}
  function updateControl(panel){
    const max=panel.querySelector('[data-wsp-action="maximize"]');if(max){const active=state.maximized===panel;max.setAttribute('aria-pressed',String(active));max.innerHTML=active?'<span aria-hidden="true">↙</span><span>还原</span>':'<span aria-hidden="true">⛶</span><span>放大</span>'}
  }
  function restoreMaximized(){
    const panel=state.maximized;if(!panel)return;panel.classList.remove('wsp-panel-maximized');document.body.classList.remove('wsp-has-maximized');state.maximized=null;updateControl(panel);dispatch(panel,'restored');
  }
  function maximize(panel){
    if(panel.classList.contains('wsp-panel-collapsed'))restore(panel);
    if(state.maximized===panel){restoreMaximized();return}
    restoreMaximized();state.maximized=panel;panel.classList.add('wsp-panel-maximized');document.body.classList.add('wsp-has-maximized');updateControl(panel);dispatch(panel,'maximized');requestAnimationFrame(()=>panel.scrollIntoView({block:'start'}));
  }
  function collapse(panel){
    if(state.maximized===panel)restoreMaximized();if(panel.classList.contains('wsp-panel-collapsed'))return;
    panel.classList.add('wsp-panel-collapsed');panel.setAttribute('aria-hidden','true');const button=document.createElement('button');button.type='button';button.className='wsp-rail-button';button.dataset.restorePanel=panel.dataset.workspacePanel;button.innerHTML=`<span>${titleOf(panel)}</span><b aria-hidden="true">↩</b>`;button.addEventListener('click',()=>restore(panel));ensureRail().appendChild(button);state.collapsed.set(panel,button);ensureRail().hidden=false;updateGroup(groupOf(panel));dispatch(panel,'collapsed');
  }
  function restore(panel){
    if(!panel)return;panel.classList.remove('wsp-panel-collapsed');panel.removeAttribute('aria-hidden');const button=state.collapsed.get(panel);button?.remove();state.collapsed.delete(panel);if(rail)rail.hidden=state.collapsed.size===0;updateGroup(groupOf(panel));dispatch(panel,'restored');requestAnimationFrame(()=>panel.scrollIntoView({behavior:'smooth',block:'nearest'}));
  }
  function controls(panel){
    const container=document.createElement('div');container.className='wsp-panel-controls';container.setAttribute('aria-label',`${titleOf(panel)}显示控制`);
    const maximizeButton=document.createElement('button');maximizeButton.type='button';maximizeButton.dataset.wspAction='maximize';maximizeButton.className='wsp-control';maximizeButton.title='放大到页面';maximizeButton.innerHTML='<span aria-hidden="true">⛶</span><span>放大</span>';
    const collapseButton=document.createElement('button');collapseButton.type='button';collapseButton.dataset.wspAction='collapse';collapseButton.className='wsp-control';collapseButton.title='收起到侧栏';collapseButton.innerHTML='<span aria-hidden="true">⇥</span><span>收起</span>';
    container.append(maximizeButton,collapseButton);container.addEventListener('click',event=>{const button=event.target.closest('[data-wsp-action]');if(!button)return;button.dataset.wspAction==='maximize'?maximize(panel):collapse(panel)});return container;
  }
  function findHeader(panel){
    const selector=panel.dataset.workspaceControlsTarget;if(selector){const target=panel.querySelector(selector);if(target)return target}
    return panel.querySelector(':scope > header, :scope > .cc-panel-title, :scope > .cc-library-head, :scope > .ca-panel-head, :scope > .ca-section-head')||panel.firstElementChild;
  }
  function initPanel(panel,index){
    if(panel.dataset.workspaceReady==='true')return;panel.dataset.workspaceReady='true';if(!panel.dataset.workspacePanel)panel.dataset.workspacePanel=`panel-${index+1}`;panel.classList.add('wsp-panel');const header=findHeader(panel);if(header)header.appendChild(controls(panel));updateControl(panel);
  }
  function init(){
    ensureRail().hidden=true;const panels=[...document.querySelectorAll(PANEL_SELECTOR)];panels.forEach(initPanel);document.querySelectorAll(GROUP_SELECTOR).forEach(updateGroup);
    document.addEventListener('keydown',event=>{if(event.key==='Escape'&&state.maximized)restoreMaximized()});
  }

  global.KGWorkspacePanels=Object.freeze({init,maximize,collapse,restore,restoreMaximized});
  if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',init);else init();
})(window);
