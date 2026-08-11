'use strict';

(function(global){
  function create(options={}){
    let activeName='',activeTrigger=null,openTimer=0,closeTimer=0,bound=false;
    const root=options.root||null;
    const hoverQuery='(hover:hover) and (pointer:fine)';
    const canHover=()=>!global.matchMedia||global.matchMedia(hoverQuery).matches;
    function panels(){return root?[...root.querySelectorAll('[data-node-style-panel]')]:[]}
    function triggers(){return root?[...root.querySelectorAll('[data-node-toolbar-panel]')]:[]}
    // P4.2.12: keep the trigger tooltip visible while the pointer remains still,
    // even after its secondary panel opens. Moving into the panel naturally ends :hover.
    function suppressTooltip(){
      document.dispatchEvent(new CustomEvent('kg-node-toolbar-popover-hover',{detail:{open:true,keepTooltip:true}}));
    }
    function releaseTooltip(){
      document.dispatchEvent(new CustomEvent('kg-node-toolbar-popover-hover',{detail:{open:false,keepTooltip:true}}));
    }
    const sharedFactory=global.KGCanvasFloatingToolbarController?.createPopover;
    if(typeof sharedFactory==='function')return sharedFactory({
      root,host:root.parentElement,mainSelector:'.node-style-toolbar-main',
      panelSelector:'[data-node-style-panel]',triggerSelector:'[data-node-toolbar-panel]',
      panelAttribute:'data-node-style-panel',triggerAttribute:'data-node-toolbar-panel',
      alignLastTrigger:true,hoverOpenDelay:options.hoverOpenDelay,hoverCloseDelay:options.hoverCloseDelay,
      beforeOpen:suppressTooltip,onClose:()=>{releaseTooltip();if(typeof options.onClose==='function')options.onClose()},
      onOpen:(name,panel,trigger)=>{if(typeof options.onOpen==='function')options.onOpen(name,panel,trigger)}
    });
    function clearTimers(){clearTimeout(openTimer);clearTimeout(closeTimer);openTimer=0;closeTimer=0}
    function panelFor(name){return root&&root.querySelector(`[data-node-style-panel="${name}"]`)}
    function triggerFor(name){return root&&root.querySelector(`[data-node-toolbar-panel="${name}"]`)}
    function positionPanel(panel,trigger){
      if(!root||!panel||!trigger)return false;
      const stage=root.parentElement,main=root.querySelector('.node-style-toolbar-main');
      if(!stage||!main)return false;
      const stageRect=stage.getBoundingClientRect(),rootRect=root.getBoundingClientRect(),triggerRect=trigger.getBoundingClientRect();
      const panelWidth=panel.offsetWidth||180,panelHeight=panel.offsetHeight||80,mainHeight=main.offsetHeight||44,pad=8;
      let left;
      if(String(trigger.dataset.nodeToolbarPanel)==='more')left=triggerRect.right-rootRect.left-panelWidth;
      else left=triggerRect.left-rootRect.left+triggerRect.width/2-panelWidth/2;
      const globalLeft=rootRect.left+left;
      if(globalLeft<stageRect.left+pad)left+=stageRect.left+pad-globalLeft;
      const globalRight=rootRect.left+left+panelWidth;
      if(globalRight>stageRect.right-pad)left-=globalRight-(stageRect.right-pad);
      const belowTop=rootRect.top+mainHeight+8;
      const canFitBelow=belowTop+panelHeight<=stageRect.bottom-pad;
      const canFitAbove=rootRect.top-panelHeight-8>=stageRect.top+pad;
      panel.classList.toggle('is-above',!canFitBelow&&canFitAbove);
      panel.style.left=Math.round(left)+'px';
      panel.style.top=(!canFitBelow&&canFitAbove?-(mainHeight+panelHeight+8):8)+'px';
      return true;
    }
    function reposition(){const panel=panelFor(activeName),trigger=activeTrigger||triggerFor(activeName);return panel&&!panel.hidden?positionPanel(panel,trigger):false}
    function close(){
      clearTimers();activeName='';activeTrigger=null;
      panels().forEach(panel=>{panel.hidden=true;panel.classList.remove('show','is-above');panel.style.removeProperty('left');panel.style.removeProperty('top')});
      triggers().forEach(btn=>btn.setAttribute('aria-expanded','false'));
      releaseTooltip();
      if(typeof options.onClose==='function')options.onClose();
    }
    function open(name,trigger,settings={}){
      clearTimers();suppressTooltip();
      const panel=panelFor(name);trigger=trigger||triggerFor(name);if(!panel||!trigger||trigger.disabled||trigger.hidden)return false;
      if(settings.toggle&&activeName===name&&!panel.hidden){close();return false}
      panels().forEach(item=>{item.hidden=true;item.classList.remove('show','is-above')});
      triggers().forEach(btn=>btn.setAttribute('aria-expanded','false'));
      activeName=name;activeTrigger=trigger;panel.hidden=false;panel.classList.add('show');trigger.setAttribute('aria-expanded','true');
      requestAnimationFrame(()=>positionPanel(panel,trigger));
      if(typeof options.onOpen==='function')options.onOpen(name,panel,trigger);
      return true;
    }
    function toggle(name,trigger){return open(name,trigger,{toggle:true})}
    function scheduleOpen(name,trigger){
      suppressTooltip();clearTimeout(closeTimer);closeTimer=0;clearTimeout(openTimer);
      openTimer=setTimeout(()=>open(name,trigger),Math.max(0,Number(options.hoverOpenDelay)||140));
    }
    function scheduleClose(){
      clearTimeout(openTimer);openTimer=0;clearTimeout(closeTimer);
      closeTimer=setTimeout(close,Math.max(80,Number(options.hoverCloseDelay)||240));
    }
    function relatedInside(target,element){return !!(target&&element&&element.contains&&element.contains(target))}
    function bind(){
      if(bound||!root)return;bound=true;
      root.addEventListener('pointerover',event=>{
        if(!canHover())return;
        const trigger=event.target.closest&&event.target.closest('[data-node-toolbar-panel]');
        if(trigger&&root.contains(trigger)&&!relatedInside(event.relatedTarget,trigger)){
          scheduleOpen(trigger.dataset.nodeToolbarPanel,trigger);return;
        }
        const panel=event.target.closest&&event.target.closest('[data-node-style-panel]');
        if(panel&&root.contains(panel)){clearTimeout(closeTimer);closeTimer=0}
      });
      root.addEventListener('pointerout',event=>{
        if(!canHover())return;
        const trigger=event.target.closest&&event.target.closest('[data-node-toolbar-panel]');
        if(trigger&&root.contains(trigger)&&!relatedInside(event.relatedTarget,trigger)){
          const panel=panelFor(trigger.dataset.nodeToolbarPanel);
          if(!relatedInside(event.relatedTarget,panel))scheduleClose();
          return;
        }
        const panel=event.target.closest&&event.target.closest('[data-node-style-panel]');
        if(panel&&root.contains(panel)&&!relatedInside(event.relatedTarget,panel)&&!relatedInside(event.relatedTarget,activeTrigger))scheduleClose();
      });
      root.addEventListener('keydown',event=>{if(event.key==='Escape'&&activeName){event.preventDefault();const trigger=activeTrigger;close();trigger?.focus?.()}});
    }
    bind();
    function isOpen(name){return activeName===name&&!!panelFor(name)&&!panelFor(name).hidden}
    function getActive(){return activeName}
    return Object.freeze({open,toggle,close,reposition,isOpen,getActive});
  }
  global.KGGraphStylePopoverController=Object.freeze({create});
})(typeof window!=='undefined'?window:globalThis);
