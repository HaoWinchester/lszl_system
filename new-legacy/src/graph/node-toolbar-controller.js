'use strict';

(function(global){
  const ICONS=Object.freeze({
    type:'<svg viewBox="0 0 24 24" aria-hidden="true"><rect x="3.5" y="4" width="17" height="16" rx="3"></rect><path d="M3.5 10h17"></path></svg>',
    fill:'<span class="node-toolbar-color-circle" aria-hidden="true"></span>',
    border:'<svg viewBox="0 0 24 24" aria-hidden="true"><rect x="3.5" y="3.5" width="17" height="17" rx="3"></rect><path d="M7 7h10v10H7z" stroke-dasharray="2 2"></path></svg>',
    textColor:'<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M6 19h12"></path><path d="M9 16l3-10 3 10"></path><path d="M10 12h4"></path><path d="M6 21h12"></path></svg>',
    textAlign:'<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M4 6h16M4 10h11M4 14h16M4 18h8"></path></svg>',
    fontFamily:'<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M4 18 9 5h2l5 13M6 13h8"></path><path d="M16 9h4M18 9v9M16 18h4"></path></svg>',
    fontSize:'<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M4 6h9M8.5 6v12M5.5 18h6"></path><path d="M15 8h5M17.5 8v10M15 18h5"></path></svg>',
    bold:'<span class="node-toolbar-letter-icon node-toolbar-bold-icon" aria-hidden="true">B</span>',
    italic:'<span class="node-toolbar-letter-icon node-toolbar-italic-icon" aria-hidden="true">I</span>',
    underline:'<span class="node-toolbar-letter-icon node-toolbar-underline-icon" aria-hidden="true">U</span>',
    strike:'<span class="node-toolbar-letter-icon node-toolbar-strike-icon" aria-hidden="true">S</span>',
    lineHeight:'<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M8 5h11M8 10h8M8 15h11M8 20h8"></path><path d="M4 5v15M2.5 7 4 5l1.5 2M2.5 18 4 20l1.5-2"></path></svg>',
    nodeSize:'<svg viewBox="0 0 24 24" aria-hidden="true"><rect x="4" y="6" width="10" height="12" rx="2"></rect><path d="M17 8h3v8h-3M18.5 8V5M18.5 19v-3"></path></svg>',
    align:'<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M4 4v16"></path><rect x="7" y="6" width="10" height="4" rx="1"></rect><rect x="7" y="14" width="13" height="4" rx="1"></rect></svg>',
    lock:'<svg viewBox="0 0 24 24" aria-hidden="true"><rect x="5" y="10" width="14" height="10" rx="2"></rect><path d="M8 10V7a4 4 0 0 1 8 0v3"></path></svg>',
    unlock:'<svg viewBox="0 0 24 24" aria-hidden="true"><rect x="5" y="10" width="14" height="10" rx="2"></rect><path d="M9 10V7a4 4 0 0 1 7.5-2"></path></svg>',
    relatedCanvas:'<svg viewBox="0 0 24 24" aria-hidden="true"><rect x="3.5" y="4" width="17" height="16" rx="3"></rect><circle cx="8" cy="10" r="1.4"></circle><circle cx="16" cy="9" r="1.4"></circle><circle cx="13" cy="15.5" r="1.4"></circle><path d="M9.3 10.4l5.3-1M8.9 11.1l3.2 3.3M15.3 10.3l-1.6 3.8"></path></svg>',
    more:'<svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="5" cy="12" r="1.5"></circle><circle cx="12" cy="12" r="1.5"></circle><circle cx="19" cy="12" r="1.5"></circle></svg>',
    grip:'<svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="8" cy="7" r="1"></circle><circle cx="16" cy="7" r="1"></circle><circle cx="8" cy="12" r="1"></circle><circle cx="16" cy="12" r="1"></circle><circle cx="8" cy="17" r="1"></circle><circle cx="16" cy="17" r="1"></circle></svg>'
  });
  function button(action,label,icon,extra=''){
    return `<button type="button" class="node-toolbar-btn uc-toolbar-btn" data-node-toolbar-action="${action}" aria-label="${label}" data-tooltip="${label}" ${extra}>${icon}</button>`;
  }
  function create(options={}){
    const stage=options.stage;
    let root=null,popovers=null,floating=null,visible=false,manual=false,drag=null,lastNodeId='';
    function ensure(){
      if(root&&root.isConnected)return root;
      root=document.createElement('div');root.id=options.id||'nodeStyleToolbar';root.className='node-style-toolbar uc-floating-toolbar uc-toolbar-shell';root.dataset.stageUi='true';root.hidden=true;
      root.innerHTML=`<div class="node-style-toolbar-main uc-toolbar-main" role="toolbar" aria-label="节点样式工具栏">
        <button type="button" class="node-toolbar-btn uc-toolbar-btn node-toolbar-grip uc-toolbar-grip" data-node-toolbar-drag aria-label="拖动工具栏" data-tooltip="拖动工具栏；双击恢复自动停靠">${ICONS.grip}</button>
        ${button('type','节点类型',ICONS.type,'data-node-toolbar-panel="type" aria-haspopup="true" aria-expanded="false"')}
        ${button('fill','背景填充',ICONS.fill,'data-node-toolbar-panel="fill" aria-haspopup="true" aria-expanded="false"')}
        ${button('border','边框设置',ICONS.border,'data-node-toolbar-panel="border" aria-haspopup="true" aria-expanded="false"')}
        ${button('text-color','文字颜色',ICONS.textColor,'data-node-toolbar-panel="text-color" aria-haspopup="true" aria-expanded="false"')}
        ${button('font-family','文本字体',ICONS.fontFamily,'data-node-toolbar-panel="font-family" aria-haspopup="true" aria-expanded="false"')}
        ${button('font-size','字号',ICONS.fontSize,'data-node-toolbar-panel="font-size" aria-haspopup="true" aria-expanded="false"')}
        ${button('font-style','文字样式',ICONS.bold,'data-node-toolbar-panel="font-style" aria-haspopup="true" aria-expanded="false"')}
        ${button('line-height','行高',ICONS.lineHeight,'data-node-toolbar-panel="line-height" aria-haspopup="true" aria-expanded="false"')}
        ${button('text-align','文字对齐',ICONS.textAlign,'data-node-toolbar-panel="text-align" aria-haspopup="true" aria-expanded="false"')}
        ${button('node-size','卡牌尺寸',ICONS.nodeSize,'data-node-toolbar-panel="node-size" aria-haspopup="true" aria-expanded="false"')}
        ${button('align','节点对齐',ICONS.align,'data-node-toolbar-panel="align" aria-haspopup="true" aria-expanded="false"')}
        ${button('lock','完全锁定节点',ICONS.unlock,'aria-pressed="false"')}
        ${button('related-canvas','打开相关画布',ICONS.relatedCanvas)}
        ${button('more','更多设置',ICONS.more,'data-node-toolbar-panel="more" aria-haspopup="true" aria-expanded="false"')}
      </div><div class="node-style-toolbar-panels uc-toolbar-panels"></div>`;
      root.addEventListener('pointerdown',event=>event.stopPropagation());
      root.addEventListener('dblclick',event=>event.stopPropagation());
      const grip=root.querySelector('[data-node-toolbar-drag]');
      floating=global.KGCanvasFloatingToolbarController?.create?.({
        host:stage,getRoot:()=>root,mainSelector:'.node-style-toolbar-main',gap:Number(options.gap)||14,pad:8,
        avoidSelector:options.avoidSelector,onPosition:()=>popovers&&popovers.reposition(),onDragStart:()=>popovers&&popovers.close()
      })||null;
      if(floating)floating.bindDrag(grip);
      else{
      grip.addEventListener('pointerdown',event=>{
        if(event.button!==0)return;
        const rect=root.getBoundingClientRect(),sr=stage.getBoundingClientRect();
        drag={pointerId:event.pointerId,startX:event.clientX,startY:event.clientY,left:rect.left-sr.left,top:rect.top-sr.top};
        manual=true;root.classList.add('dragging','manual-position');popovers&&popovers.close();
        try{grip.setPointerCapture(event.pointerId)}catch(error){}
        event.preventDefault();event.stopPropagation();
      });
      grip.addEventListener('pointermove',event=>{
        if(!drag||drag.pointerId!==event.pointerId)return;
        setPosition(drag.left+event.clientX-drag.startX,drag.top+event.clientY-drag.startY);
        event.preventDefault();event.stopPropagation();
      });
      const finishDrag=event=>{
        if(!drag||drag.pointerId!==event.pointerId)return;
        try{grip.releasePointerCapture(event.pointerId)}catch(error){}
        drag=null;root.classList.remove('dragging');event.preventDefault();event.stopPropagation();
      };
      grip.addEventListener('pointerup',finishDrag);grip.addEventListener('pointercancel',finishDrag);
      grip.addEventListener('dblclick',event=>{event.preventDefault();event.stopPropagation();resetPosition()});
      }
      root.addEventListener('click',event=>{
        const trigger=event.target.closest('[data-node-toolbar-panel]');
        if(trigger){event.preventDefault();event.stopPropagation();const name=trigger.dataset.nodeToolbarPanel;popovers.toggle(name,trigger);return}
        const action=event.target.closest('[data-node-toolbar-action]');
        if(action&&typeof options.onAction==='function'){event.preventDefault();event.stopPropagation();options.onAction(action.dataset.nodeToolbarAction,action,event)}
      });
      stage.appendChild(root);
      popovers=global.KGGraphStylePopoverController.create({root,onOpen:(name,panel,trigger)=>{if(typeof options.onPanelOpen==='function')options.onPanelOpen(name,root,panel,trigger)}});
      if(typeof options.buildPanels==='function')options.buildPanels(root.querySelector('.node-style-toolbar-panels'),root);
      root.querySelectorAll('[data-node-style-panel]').forEach(panel=>panel.classList.add('uc-toolbar-popover'));
      root.querySelectorAll('[title]').forEach(element=>{
        const value=element.getAttribute('title');
        if(value&&!element.dataset.tooltip)element.dataset.tooltip=value;
        element.removeAttribute('title');
      });
      return root;
    }
    function show(context={}){
      ensure();visible=true;root.hidden=false;root.classList.add('show');root.dataset.nodeId=context.nodeId||'';root.dataset.selectionCount=String(context.selectionCount||1);lastNodeId=context.nodeId||lastNodeId;position();return root;
    }
    function hide(){
      if(!root)return;visible=false;drag=null;root.classList.remove('show','dragging');root.hidden=true;popovers&&popovers.close();
    }
    function avoidStageToolbarCollision(left,top,width,height,sr,pad){
      const selector=String(options.avoidSelector||'.canvas-toolbar-left,.canvas-toolbar-right,#topToolbar');
      const obstacles=[...stage.querySelectorAll(selector)].filter(element=>element!==root&&element.isConnected&&!element.hidden);
      for(const obstacle of obstacles){
        const style=global.getComputedStyle?.(obstacle);if(style&&(style.display==='none'||style.visibility==='hidden'||style.pointerEvents==='none'))continue;
        const rect=obstacle.getBoundingClientRect(),box={left:rect.left-sr.left,top:rect.top-sr.top,right:rect.right-sr.left,bottom:rect.bottom-sr.top};
        const overlaps=left<box.right+6&&left+width>box.left-6&&top<box.bottom+6&&top+height>box.top-6;
        if(!overlaps)continue;
        const below=box.bottom+8,above=box.top-height-8,maxTop=Math.max(pad,sr.height-height-pad);
        if(below<=maxTop)top=below;else if(above>=pad)top=above;
      }
      return {left,top};
    }
    function setPosition(left,top){
      if(!root)return false;if(floating)return floating.setPosition(left,top);
      const sr=stage.getBoundingClientRect(),width=root.offsetWidth||390,height=root.offsetHeight||44,pad=8;
      left=Math.max(pad,Math.min(Number(left)||pad,Math.max(pad,sr.width-width-pad)));
      top=Math.max(pad,Math.min(Number(top)||pad,Math.max(pad,sr.height-height-pad)));
      ({left,top}=avoidStageToolbarCollision(left,top,width,height,sr,pad));
      left=Math.max(pad,Math.min(left,Math.max(pad,sr.width-width-pad)));
      top=Math.max(pad,Math.min(top,Math.max(pad,sr.height-height-pad)));
      root.style.left=Math.round(left)+'px';root.style.top=Math.round(top)+'px';popovers&&popovers.reposition();return true;
    }
    function position(){
      if(!visible||!root)return false;
      const anchor=typeof options.getAnchor==='function'?options.getAnchor():null;
      const providedRect=typeof options.getAnchorRect==='function'?options.getAnchorRect():null;
      if((!anchor||!anchor.isConnected)&&!providedRect){hide();return false}
      if(floating)return floating.positionRect(providedRect||anchor.getBoundingClientRect(),{gap:Number(options.gap)||14});
      if(manual)return setPosition(parseFloat(root.style.left)||8,parseFloat(root.style.top)||8);
      const sr=stage.getBoundingClientRect(),ar=providedRect||anchor.getBoundingClientRect();
      const width=root.offsetWidth||390,height=root.offsetHeight||44,gap=Number(options.gap)||14,pad=8;
      const anchorBox={left:ar.left-sr.left,top:ar.top-sr.top,right:ar.right-sr.left,bottom:ar.bottom-sr.top};
      const selector=String(options.avoidSelector||'.canvas-toolbar-left,.canvas-toolbar-right,#topToolbar');
      const obstacles=[...stage.querySelectorAll(selector)].filter(element=>element!==root&&element.isConnected&&!element.hidden).map(element=>{
        const style=global.getComputedStyle?.(element);if(style&&(style.display==='none'||style.visibility==='hidden'||style.pointerEvents==='none'))return null;
        const rect=element.getBoundingClientRect();return{left:rect.left-sr.left,top:rect.top-sr.top,right:rect.right-sr.left,bottom:rect.bottom-sr.top};
      }).filter(Boolean);
      const centeredLeft=anchorBox.left+((anchorBox.right-anchorBox.left)-width)/2;
      const centeredTop=anchorBox.top+((anchorBox.bottom-anchorBox.top)-height)/2;
      const candidates=[
        {left:centeredLeft,top:anchorBox.top-height-gap},
        {left:centeredLeft,top:anchorBox.bottom+gap},
        {left:anchorBox.right+gap,top:centeredTop},
        {left:anchorBox.left-width-gap,top:centeredTop}
      ];
      const overlaps=(a,b,margin=6)=>a.left<b.right+margin&&a.right>b.left-margin&&a.top<b.bottom+margin&&a.bottom>b.top-margin;
      const fits=candidate=>{
        const box={left:candidate.left,top:candidate.top,right:candidate.left+width,bottom:candidate.top+height};
        if(box.left<pad||box.top<pad||box.right>sr.width-pad||box.bottom>sr.height-pad)return false;
        if(overlaps(box,anchorBox,Math.max(2,gap-2)))return false;
        return !obstacles.some(obstacle=>overlaps(box,obstacle,6));
      };
      const chosen=candidates.find(fits)||candidates[0];
      return setPosition(chosen.left,chosen.top);
    }
    function resetPosition(){if(floating)return floating.resetPosition();manual=false;if(root)root.classList.remove('manual-position');return position()}
    function isVisible(){return visible&&!!root&&!root.hidden}
    function getRoot(){return ensure()}
    function closePanels(){popovers&&popovers.close()}
    return Object.freeze({ensure,show,hide,position,setPosition,resetPosition,isManual:()=>floating?floating.isManual():manual,isVisible,getRoot,closePanels,icons:ICONS});
  }
  global.KGGraphNodeToolbarController=Object.freeze({create,icons:ICONS});
})(typeof window!=='undefined'?window:globalThis);
