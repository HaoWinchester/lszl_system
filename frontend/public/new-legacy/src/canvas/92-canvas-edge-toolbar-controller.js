'use strict';

/*
 * CanvasEdgeToolbarController v3
 * 首页画布与多题画布共用的统一关系线悬浮工具栏。
 * 主栏只保留拖拽、颜色、线条类型和添加文本；线条细项收敛到同一二级菜单。
 */
(function(global){
  const icon=Object.freeze({
    grip:'<svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="8" cy="7" r="1"></circle><circle cx="16" cy="7" r="1"></circle><circle cx="8" cy="12" r="1"></circle><circle cx="16" cy="12" r="1"></circle><circle cx="8" cy="17" r="1"></circle><circle cx="16" cy="17" r="1"></circle></svg>',
    color:'<span class="uc-edge-color-dot" aria-hidden="true"></span>',
    path:'<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M4 17h7V7h9"></path></svg>',
    label:'<span class="uc-edge-text-icon" aria-hidden="true">T</span>',
    straight:'<svg viewBox="0 0 24 24" aria-hidden="true"><path d="m4 18 16-12"></path></svg>',
    elbow:'<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M4 7h8v10h8"></path></svg>',
    curve:'<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M4 17C8 5 16 19 20 7"></path></svg>',
    solid:'<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M3 12h18"></path></svg>',
    dashed:'<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M3 12h7m4 0h7"></path></svg>',
    dotted:'<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M4 12h1m4 0h1m4 0h1m4 0h1"></path></svg>',
    palette:'<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 3a9 9 0 1 0 0 18h1.2a2 2 0 0 0 1.6-3.2l-.5-.7a1.6 1.6 0 0 1 1.3-2.5H18a3 3 0 0 0 3-3A8.6 8.6 0 0 0 12 3z"></path><circle cx="7.5" cy="10" r="1"></circle><circle cx="10" cy="6.8" r="1"></circle><circle cx="14" cy="6.8" r="1"></circle><circle cx="16.7" cy="10" r="1"></circle></svg>'
  });
  const DEFAULT_COLOR_PRESETS=Object.freeze(['#ffffff','#f8fafc','#e2e8f0','#fee2e2','#ffedd5','#fef3c7','#dcfce7','#cffafe','#dbeafe','#ede9fe','#fce7f3','#0f172a','#2563eb','#7c3aed','#16a34a','#ea580c']);
  function fallbackPositioner(options={}){
    const host=options.host,getRoot=options.getRoot;let manual=false,drag=null,lastPoint=null;
    function setPosition(left,top){
      const root=getRoot();if(!root)return false;const hr=host.getBoundingClientRect(),width=root.offsetWidth||190,height=root.querySelector('.uc-toolbar-main')?.offsetHeight||44,pad=8;
      left=Math.max(pad,Math.min(Number(left)||pad,Math.max(pad,hr.width-width-pad)));top=Math.max(pad,Math.min(Number(top)||pad,Math.max(pad,hr.height-height-pad)));
      root.style.left=Math.round(left)+'px';root.style.top=Math.round(top)+'px';options.onPosition?.();return true;
    }
    function positionPoint(point){
      if(!point)return false;lastPoint={x:Number(point.x)||0,y:Number(point.y)||0};const root=getRoot();if(!root)return false;if(manual)return setPosition(parseFloat(root.style.left)||8,parseFloat(root.style.top)||8);
      const width=root.offsetWidth||190,height=root.querySelector('.uc-toolbar-main')?.offsetHeight||44,pad=8,hr=host.getBoundingClientRect();let left=lastPoint.x-width/2,top=lastPoint.y-height-14;if(top<pad)top=lastPoint.y+14;
      return setPosition(Math.max(pad,Math.min(left,hr.width-width-pad)),Math.max(pad,Math.min(top,hr.height-height-pad)));
    }
    function bindDrag(grip){
      grip.addEventListener('pointerdown',event=>{if(event.button!==0)return;const root=getRoot(),rr=root.getBoundingClientRect(),hr=host.getBoundingClientRect();drag={id:event.pointerId,x:event.clientX,y:event.clientY,left:rr.left-hr.left,top:rr.top-hr.top};manual=true;root.classList.add('dragging','manual-position');options.onDragStart?.();try{grip.setPointerCapture(event.pointerId)}catch(error){}event.preventDefault();event.stopPropagation()});
      grip.addEventListener('pointermove',event=>{if(!drag||drag.id!==event.pointerId)return;setPosition(drag.left+event.clientX-drag.x,drag.top+event.clientY-drag.y);event.preventDefault();event.stopPropagation()});
      const finish=event=>{if(!drag||drag.id!==event.pointerId)return;drag=null;getRoot()?.classList.remove('dragging');event.preventDefault();event.stopPropagation()};grip.addEventListener('pointerup',finish);grip.addEventListener('pointercancel',finish);
      grip.addEventListener('dblclick',event=>{event.preventDefault();event.stopPropagation();manual=false;getRoot()?.classList.remove('manual-position');positionPoint(lastPoint)});return true;
    }
    return{setPosition,positionPoint,bindDrag,resetPosition(){manual=false;getRoot()?.classList.remove('manual-position');return positionPoint(lastPoint)},isManual:()=>manual,destroy:()=>true};
  }
  function fallbackPopover(options={}){
    const root=options.root;let active='',activeTrigger=null,openTimer=0,closeTimer=0;
    const panels=()=>[...root.querySelectorAll('[data-uc-edge-popover]')],triggers=()=>[...root.querySelectorAll('[data-uc-edge-panel]')];
    const panelFor=name=>panels().find(panel=>panel.dataset.ucEdgePopover===String(name))||null;
    const triggerFor=name=>triggers().find(trigger=>trigger.dataset.ucEdgePanel===String(name))||null;
    function reposition(){
      const panel=panelFor(active),trigger=activeTrigger||triggerFor(active);if(!panel||panel.hidden||!trigger)return false;
      const host=options.host||root.parentElement,hostBox=host.getBoundingClientRect(),offsetBox=(panel.offsetParent||root).getBoundingClientRect(),triggerBox=trigger.getBoundingClientRect(),pw=panel.offsetWidth||260,ph=panel.offsetHeight||220,pad=8,gap=8;
      let left=triggerBox.left-offsetBox.left+triggerBox.width/2-pw/2;
      let globalLeft=offsetBox.left+left;if(globalLeft<hostBox.left+pad)left+=hostBox.left+pad-globalLeft;globalLeft=offsetBox.left+left;if(globalLeft+pw>hostBox.right-pad)left-=globalLeft+pw-(hostBox.right-pad);
      const fitBelow=triggerBox.bottom+gap+ph<=hostBox.bottom-pad,fitAbove=triggerBox.top-gap-ph>=hostBox.top+pad,above=!fitBelow&&fitAbove;
      root.dataset.panelPlacement=above?'above':'below';panel.classList.toggle('is-above',above);panel.style.left=Math.round(left)+'px';panel.style.top=Math.round((above?triggerBox.top-gap-ph:triggerBox.bottom+gap)-offsetBox.top)+'px';return true;
    }
    function finish(panel){if(!panel)return;panel.hidden=true;panel.classList.remove('show','is-closing','is-above');panel.style.removeProperty('left');panel.style.removeProperty('top')}
    function close(settings={}){clearTimeout(openTimer);clearTimeout(closeTimer);active='';activeTrigger=null;triggers().forEach(trigger=>{trigger.classList.remove('active');trigger.setAttribute('aria-expanded','false')});panels().forEach(panel=>{panel.classList.remove('show');if(settings.immediate)finish(panel);else{panel.classList.add('is-closing');setTimeout(()=>finish(panel),140)}});return true}
    function open(name,trigger){clearTimeout(openTimer);clearTimeout(closeTimer);const panel=panelFor(name);trigger=trigger||triggerFor(name);if(!panel||!trigger||trigger.disabled)return false;panels().forEach(item=>{if(item!==panel)finish(item)});triggers().forEach(item=>{item.classList.remove('active');item.setAttribute('aria-expanded','false')});active=String(name);activeTrigger=trigger;panel.hidden=false;panel.classList.remove('is-closing');trigger.classList.add('active');trigger.setAttribute('aria-expanded','true');reposition();requestAnimationFrame(()=>{if(active===String(name))panel.classList.add('show')});return true}
    function toggle(name,trigger){if(active===String(name)&&!panelFor(name)?.hidden)return close();return open(name,trigger)}
    root.addEventListener('pointerover',event=>{const trigger=event.target.closest?.('[data-uc-edge-panel]');if(trigger){clearTimeout(closeTimer);openTimer=setTimeout(()=>open(trigger.dataset.ucEdgePanel,trigger),140)}else if(event.target.closest?.('[data-uc-edge-popover]'))clearTimeout(closeTimer)});
    root.addEventListener('pointerout',event=>{if(event.target.closest?.('[data-uc-edge-panel],[data-uc-edge-popover]')){clearTimeout(openTimer);closeTimer=setTimeout(close,240)}});
    return{open,toggle,close,reposition,isOpen:name=>active===String(name)&&!panelFor(name)?.hidden,getActive:()=>active};
  }
  function create(options={}){
    const host=options.host;let root=null,visible=false,current={},popover=null,floating=null,lastPoint=null;
    function ensure(){
      if(root?.isConnected)return root;if(!host||typeof document==='undefined')return null;
      root=document.createElement('div');root.id=options.id||'';root.className=('uc-floating-toolbar uc-toolbar-shell uc-edge-toolbar '+String(options.className||'')).trim();
      root.hidden=true;root.dataset.stageUi='true';root.dataset.panelPlacement='above';root.setAttribute('aria-label','关系线样式工具栏');
      root.innerHTML=`<div class="uc-toolbar-main uc-edge-toolbar-main" role="toolbar" aria-label="关系线样式工具栏">
        <button type="button" class="uc-toolbar-btn uc-toolbar-grip uc-edge-toolbar-grip" data-uc-toolbar-drag aria-label="拖动工具栏" data-tooltip="拖动工具栏；双击恢复自动停靠">${icon.grip}</button>
        <button type="button" class="uc-toolbar-btn" data-uc-edge-panel="color" data-edge-action="color" aria-haspopup="true" aria-expanded="false" aria-label="关系线颜色" data-tooltip="关系线颜色">${icon.color}</button>
        <span class="uc-toolbar-divider" aria-hidden="true"></span>
        <button type="button" class="uc-toolbar-btn" data-uc-edge-panel="line" aria-haspopup="true" aria-expanded="false" aria-label="线条类型" data-tooltip="线条类型">${icon.path}</button>
        <span class="uc-toolbar-divider" aria-hidden="true"></span>
        <button type="button" class="uc-toolbar-btn" data-uc-edge-action="label" data-edge-action="label" aria-label="添加文本" data-tooltip="添加文本">${icon.label}</button>
        <span class="uc-edge-batch-count" data-uc-edge-count data-edge-batch-count hidden></span>
      </div>
      <div class="uc-toolbar-panels uc-edge-toolbar-panels">
        <section class="uc-toolbar-popover uc-edge-toolbar-popover uc-edge-color-popover" data-uc-edge-popover="color" hidden aria-label="关系线颜色设置">
          <strong class="uc-toolbar-panel-title">预设颜色</strong>
          <div class="uc-edge-color-grid" role="group" aria-label="关系线预设颜色">${(Array.isArray(options.colorPresets)&&options.colorPresets.length?options.colorPresets:DEFAULT_COLOR_PRESETS).map(color=>`<button type="button" class="uc-edge-color-swatch" data-uc-edge-color="${color}" aria-label="${color}" style="--uc-edge-swatch:${color}"></button>`).join('')}</div>
          <button type="button" class="uc-edge-custom-color-btn" data-uc-edge-action="color-custom">${icon.palette}<span>自定义颜色</span></button>
        </section>
        <section class="uc-toolbar-popover uc-edge-toolbar-popover" data-uc-edge-popover="line" hidden aria-label="线条类型设置">
          <strong class="uc-toolbar-panel-title">线条类型</strong>
          <div class="uc-edge-option-grid" role="group" aria-label="路径类型"><button type="button" data-uc-edge-path="straight" data-path-style="straight" data-tooltip="直线">${icon.straight}</button><button type="button" data-uc-edge-path="curve" data-path-style="curve" data-tooltip="曲线">${icon.curve}</button><button type="button" data-uc-edge-path="elbow" data-path-style="elbow" data-tooltip="折线">${icon.elbow}</button></div>
          <strong class="uc-toolbar-panel-title secondary">线条样式</strong>
          <div class="uc-edge-option-grid" role="group" aria-label="线条样式"><button type="button" data-uc-edge-line="solid" data-line-style="solid" data-tooltip="实线">${icon.solid}</button><button type="button" data-uc-edge-line="dashed" data-line-style="dashed" data-tooltip="长虚线">${icon.dashed}</button><button type="button" data-uc-edge-line="dotted" data-line-style="dotted" data-tooltip="短虚线">${icon.dotted}</button></div>
          <strong class="uc-toolbar-panel-title secondary">线条粗细</strong>
          <div class="uc-edge-width-row"><input type="range" min="1" max="8" step="1" value="3" data-uc-edge-width aria-label="线条粗细"><output data-uc-edge-width-output>3</output></div>
          <strong class="uc-toolbar-panel-title secondary">箭头样式</strong>
          <div class="uc-edge-option-grid uc-edge-arrow-grid" role="group" aria-label="箭头样式"><button type="button" data-uc-edge-arrow="none" data-tooltip="无箭头">—</button><button type="button" data-uc-edge-arrow="end" data-tooltip="末端箭头">→</button><button type="button" data-uc-edge-arrow="both" data-tooltip="双向箭头">↔</button></div>
        </section>
      </div>`;
      ['pointerdown','pointerup','dblclick','contextmenu'].forEach(type=>root.addEventListener(type,event=>event.stopPropagation()));
      root.addEventListener('uc-selection-filter-open',event=>{event.stopPropagation();popover?.close?.()});
      root.addEventListener('click',event=>{
        event.stopPropagation();const panelButton=event.target.closest?.('[data-uc-edge-panel]');if(panelButton){event.preventDefault();current.selectionFilter?.closeMenu?.();popover?.toggle?.(panelButton.dataset.ucEdgePanel,panelButton);return}
        const action=event.target.closest?.('[data-uc-edge-action]')?.dataset.ucEdgeAction,color=event.target.closest?.('[data-uc-edge-color]')?.dataset.ucEdgeColor,line=event.target.closest?.('[data-uc-edge-line]')?.dataset.ucEdgeLine,path=event.target.closest?.('[data-uc-edge-path]')?.dataset.ucEdgePath,arrow=event.target.closest?.('[data-uc-edge-arrow]')?.dataset.ucEdgeArrow;
        if(!action&&!color&&!line&&!path&&!arrow)return;event.preventDefault();
        if(color)options.onColorPreset?.(color,event,root);
        else if(action==='color-custom'){(options.onColorCustom||options.onColor)?.(event,root,root.querySelector('[data-uc-edge-panel="color"]'));popover?.close?.()}
        else if(action==='label'&&!event.target.closest('button')?.disabled)options.onLabel?.(event,root);
        else if(line){options.onLineStyle?.(line,event);popover?.close?.()}else if(path){options.onPathStyle?.(path,event);popover?.close?.()}else if(arrow){options.onArrowStyle?.(arrow,event);popover?.close?.()}
      });
      const slider=root.querySelector('[data-uc-edge-width]');slider.addEventListener('input',event=>{event.stopPropagation();root.querySelector('[data-uc-edge-width-output]').textContent=event.target.value});slider.addEventListener('change',event=>{event.stopPropagation();options.onWidth?.(Number(event.target.value),event);popover?.close?.()});
      host.appendChild(root);
      const shared=global.KGCanvasFloatingToolbarController;
      floating=shared?.create?.({host,getRoot:()=>root,mainSelector:'.uc-edge-toolbar-main',gap:Number(options.gap)||14,pad:8,avoidSelector:options.avoidSelector,onPosition:()=>popover?.reposition?.(),onDragStart:()=>popover?.close?.()})||fallbackPositioner({host,getRoot:()=>root,onPosition:()=>popover?.reposition?.(),onDragStart:()=>popover?.close?.()});
      floating.bindDrag(root.querySelector('[data-uc-toolbar-drag]'));
      popover=shared?.createPopover?.({root,host,mainSelector:'.uc-edge-toolbar-main',panelSelector:'[data-uc-edge-popover]',triggerSelector:'[data-uc-edge-panel]',panelAttribute:'data-uc-edge-popover',triggerAttribute:'data-uc-edge-panel',hoverOpenDelay:140,hoverCloseDelay:240,beforeOpen:()=>current.selectionFilter?.closeMenu?.()})||fallbackPopover({root,host});
      return root;
    }
    function position(point){if(!visible||!root||!point)return false;lastPoint={x:Number(point.x),y:Number(point.y)};return floating?.positionPoint?.(lastPoint,{gap:Number(options.gap)||14})||false}
    function update(context={}){
      ensure();current={...current,...context};root.style.setProperty('--uc-edge-color',String(current.color||'#64748b'));
      const count=Math.max(1,Number(current.count)||1),label=root.querySelector('[data-uc-edge-action="label"]');if(label){label.disabled=count!==1;label.setAttribute('aria-disabled',count!==1?'true':'false');label.dataset.tooltip=count!==1?'多选关系线时不能编辑文字':'添加文本'}
      root.querySelectorAll('[data-uc-edge-line]').forEach(button=>button.classList.toggle('active',current.lineStyle!=null&&button.dataset.ucEdgeLine===String(current.lineStyle)));
      root.querySelectorAll('[data-uc-edge-path]').forEach(button=>button.classList.toggle('active',current.pathStyle!=null&&button.dataset.ucEdgePath===String(current.pathStyle)));
      root.querySelectorAll('[data-uc-edge-arrow]').forEach(button=>button.classList.toggle('active',current.arrowStyle!=null&&button.dataset.ucEdgeArrow===String(current.arrowStyle)));
      const slider=root.querySelector('[data-uc-edge-width]'),out=root.querySelector('[data-uc-edge-width-output]');if(slider&&current.width!=null)slider.value=String(Math.max(1,Math.min(8,Number(current.width)||1)));if(out)out.textContent=slider?.value||'';
      root.classList.toggle('is-batch',count>1);root.dataset.selectionCount=String(count);const badge=root.querySelector('[data-uc-edge-count]'),hasSnapshot=!!current.selectionFilter?.hasSnapshot?.();if(badge){badge.hidden=hasSnapshot||count<=1;badge.textContent=count>1?String(count)+' 条':''}root.querySelectorAll('[data-uc-edge-color]').forEach(button=>button.classList.toggle('active',String(button.dataset.ucEdgeColor).toLowerCase()===String(current.color||'').toLowerCase()));return root;
    }
    function show(context={}){ensure();update(context);visible=true;root.hidden=false;root.classList.add('show');if(context.selectionFilter?.mountInto)context.selectionFilter.mountInto(root.querySelector('.uc-edge-toolbar-main'),{beforeSelector:'[data-uc-edge-panel="color"]'});position(context.point||lastPoint);return root}
    function hide(){if(!root)return;visible=false;root.hidden=true;root.classList.remove('show','dragging');current.selectionFilter?.closeMenu?.();popover?.close?.({immediate:true});lastPoint=null}
    function handleDocumentPointer(event){if(popover?.getActive?.()&&root&&!root.contains(event.target))popover.close()}
    if(typeof document!=='undefined')document.addEventListener('pointerdown',handleDocumentPointer,true);
    function destroy(){if(typeof document!=='undefined')document.removeEventListener('pointerdown',handleDocumentPointer,true);floating?.destroy?.();root?.remove();root=null;visible=false;current={};lastPoint=null;return true}
    return Object.freeze({ensure,show,hide,update,position,setPosition:(left,top)=>floating?.setPosition?.(left,top)||false,resetPosition:()=>floating?.resetPosition?.()||false,closePanels:()=>popover?.close?.(),isManual:()=>floating?.isManual?.()||false,isVisible:()=>visible,root:()=>root,destroy});
  }
  global.KGCanvasEdgeToolbarController=Object.freeze({create});
})(typeof window!=='undefined'?window:globalThis);
