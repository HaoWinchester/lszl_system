'use strict';

/* Shared world-coordinate ink. Page adapters own persistence and access control. */
(function(global){
  const LIMITS={strokes:2000,points:5000,total:100000,coordinate:10000000};
  const TOOLS={pen:{min:1,max:24,width:3,color:'#2563eb',opacity:1},highlighter:{min:4,max:48,width:16,color:'#facc15',opacity:.3},text:{min:6,max:288,width:24,color:'#111827',opacity:1}};
  const TEXT_LIMIT=500;
  function normalize(value){
    if(value===undefined)return [];
    if(!Array.isArray(value)||value.length>LIMITS.strokes)throw new Error('笔迹数量超出限制');
    const ids=new Set();let total=0;
    return value.map(stroke=>{
      const tool=Object.hasOwn(TOOLS,stroke?.tool)?TOOLS[stroke.tool]:null;
      if(!tool||typeof stroke.id!=='string'||!stroke.id.trim()||stroke.id.length>100||ids.has(stroke.id))throw new Error('笔迹类型或标识无效');
      ids.add(stroke.id);
      if(typeof stroke.color!=='string'||!/^#[0-9a-f]{6}$/i.test(stroke.color))throw new Error('笔迹颜色无效');
      if(typeof stroke.width!=='number'||!Number.isFinite(stroke.width)||stroke.width<tool.min||stroke.width>tool.max)throw new Error('笔迹粗细无效');
      if(stroke.bold!==undefined&&stroke.tool!=='text')throw new Error('加粗只适用于文字');
      if(!Array.isArray(stroke.points)||!stroke.points.length||stroke.points.length>LIMITS.points||(total+=stroke.points.length)>LIMITS.total)throw new Error('笔迹点数超出限制，请清理部分笔迹');
      const points=stroke.points.map(p=>{
        if(!Array.isArray(p)||p.length!==2||p.some(n=>typeof n!=='number'||!Number.isFinite(n)||Math.abs(n)>LIMITS.coordinate))throw new Error('笔迹坐标无效');
        return [...p];
      });
      if(stroke.tool==='text'){
        if(stroke.bold!==undefined&&typeof stroke.bold!=='boolean')throw new Error('文字加粗格式无效');
        if(typeof stroke.text!=='string'||stroke.text.length>TEXT_LIMIT)throw new Error('文字内容无效');
        const dimensions={};for(const [key,min] of [['boxWidth',40],['boxHeight',24]]){if(stroke[key]!==undefined){if(typeof stroke[key]!=='number'||!Number.isFinite(stroke[key])||stroke[key]<min||stroke[key]>4000)throw new Error('文字框尺寸无效');dimensions[key]=stroke[key]}}
        return {id:stroke.id,tool:stroke.tool,color:stroke.color,width:stroke.width,points,text:stroke.text,...dimensions,...(stroke.bold===undefined?{}:{bold:stroke.bold})};
      }
      return {id:stroke.id,tool:stroke.tool,color:stroke.color,width:stroke.width,points};
    });
  }
  function point(event,rect,view){
    const scale=view.scale||view.zoom||1;
    return [(event.clientX-rect.left-view.x)/scale,(event.clientY-rect.top-view.y)/scale];
  }
  function path(points){
    if(!points.length)return '';
    const pair=p=>p.map(n=>Math.round(n*100)/100).join(' ');
    let d='M '+pair(points[0]);
    if(points.length===1)return d+' l .01 0';
    for(let i=1;i<points.length-1;i++)d+=' Q '+pair(points[i])+' '+pair([(points[i][0]+points[i+1][0])/2,(points[i][1]+points[i+1][1])/2]);
    return d+' L '+pair(points.at(-1));
  }
  function create(options){
    const {viewport,world}=options;if(!viewport||!world)return null;
    const doc=viewport.ownerDocument,ns='http://www.w3.org/2000/svg';
    const layer=doc.createElementNS(ns,'svg');layer.classList.add('canvas-ink-layer');layer.setAttribute('aria-hidden','true');world.append(layer);
    const toolbar=doc.createElement('div');toolbar.className='canvas-ink-toolbar';toolbar.dataset.canvasUi='true';toolbar.setAttribute('role','group');toolbar.setAttribute('aria-label','画笔工具');
    toolbar.innerHTML='<div class="canvas-ink-tools"><button type="button" data-ink-tool="select" title="选择（Esc）" aria-label="选择"><svg viewBox="0 0 24 24" aria-hidden="true"><path d="M5 3l13.5 7.8-6.1 1.6-2.7 5.9z"/></svg></button><button type="button" data-ink-tool="pen" aria-label="画笔" title="画笔"><svg viewBox="0 0 24 24" aria-hidden="true"><path d="m15 4 5 5M4 20l5-1L20 8a2 2 0 0 0-5-5L4 14z"/></svg></button><button type="button" data-ink-tool="highlighter" aria-label="荧光笔" title="荧光笔"><svg viewBox="0 0 24 24" aria-hidden="true"><path d="m10 15 5 5 7-10-8-8-10 7 5 5M5 15l4 4-4 3-3-3zM2 23h16"/></svg></button><button type="button" data-ink-tool="text" aria-label="文字" title="文字"><svg viewBox="0 0 24 24" aria-hidden="true"><path d="M5 7V5h14v2M12 5v14M9 19h6"/></svg></button><button type="button" data-ink-tool="eraser" aria-label="橡皮擦" title="橡皮擦：单击擦除一笔；双击此按钮清空全部笔迹，可撤销"><svg viewBox="0 0 24 24" aria-hidden="true"><path d="m14 3 7 7-11 11H6l-4-4zM8 11l7 7M10 21h12"/></svg></button><span class="canvas-ink-divider"></span><button type="button" data-ink-action="undo" aria-label="撤销笔迹" title="撤销笔迹（Ctrl/Command+Z）">↶</button><button type="button" data-ink-action="redo" aria-label="重做笔迹" title="重做笔迹（Ctrl/Command+Shift+Z）">↷</button></div><div class="canvas-ink-options" hidden><div class="canvas-ink-colors" aria-label="笔迹颜色"></div><label class="canvas-ink-width">粗细 <input type="range" aria-label="笔迹粗细" step="1"><output></output></label><svg class="canvas-ink-preview" viewBox="0 0 180 52" aria-label="笔触预览"><path d="M 12 32 Q 45 10 80 26 T 168 24" fill="none" stroke-linecap="round"/></svg><small>Esc / 右击画布退出绘画 · 空格拖动平移</small></div>';
    (options.toolbarHost||viewport).append(toolbar);
    const panel=toolbar.querySelector('.canvas-ink-options'),range=toolbar.querySelector('input[type=range]'),preview=toolbar.querySelector('.canvas-ink-preview path');
    const prefs={pen:{...TOOLS.pen},highlighter:{...TOOLS.highlighter},text:{...TOOLS.text}};
    let opened=!options.trigger,settingsOpen=false,tool='select',active=null,frame=0,space=false,destroyed=false,suppressClickUntil=0,sequence=0;
    const listeners=[];
    let selectedTextId=null,textDrag=null,textResize=null;
    const measure=doc.createElement('canvas').getContext('2d');
    function textLines(stroke){
      measure.font=(stroke.bold?'700 ':'400 ')+stroke.width+'px system-ui';
      const lines=[];for(const paragraph of stroke.text.split('\n')){let line='';for(const char of paragraph){if(stroke.boxWidth&&line&&measure.measureText(line+char).width>stroke.boxWidth){lines.push(line);line=''}line+=char}lines.push(line)}return lines;
    }
    function textBox(stroke){const lines=textLines(stroke);measure.font=(stroke.bold?'700 ':'400 ')+stroke.width+'px system-ui';return {x:stroke.points[0][0],y:stroke.points[0][1],width:stroke.boxWidth||Math.max(40,...lines.map(line=>measure.measureText(line).width)),height:Math.max(stroke.boxHeight||24,lines.length*stroke.width*1.35),fontSize:stroke.width}}
    function renderTextHandles(stroke){
      const box=textBox(stroke),group=doc.createElementNS(ns,'g');group.classList.add('canvas-ink-text-box');
      const border=doc.createElementNS(ns,'rect');for(const [key,value] of Object.entries({x:box.x,y:box.y,width:box.width,height:box.height,fill:'none',stroke:'#2563eb'}))border.setAttribute(key,value);border.setAttribute('stroke-dasharray','4 3');group.append(border);
      const scale=options.getViewport().scale||options.getViewport().zoom||1,size=10/scale;
      for(const handle of ['nw','n','ne','e','se','s','sw','w']){const el=doc.createElementNS(ns,'rect'),x=box.x+(handle.includes('w')?0:handle.includes('e')?box.width:box.width/2),y=box.y+(handle.includes('n')?0:handle.includes('s')?box.height:box.height/2);el.dataset.inkResizeHandle=handle;el.dataset.textId=stroke.id;for(const [key,value] of Object.entries({x:x-size/2,y:y-size/2,width:size,height:size,fill:'white',stroke:'#2563eb'}))el.setAttribute(key,value);el.style.pointerEvents='all';el.style.cursor=handle+'-resize';group.append(el)}layer.append(group);
    }
    const readonly=()=>!!options.isReadonly?.();
    const report=error=>options.onError?.(error?.message||String(error));
    const history=options.history||global.KGCanvasHistoryController?.create({onChange:refreshControls});
    const ownHistory=!options.history;
    const penIcon='<svg class="canvas-ink-entry-icon" viewBox="0 0 24 24" aria-hidden="true"><path d="m15 4 5 5M4 20l5-1L20 8a2 2 0 0 0-5-5L4 14z"/></svg>';
    const trigger=()=>typeof options.trigger==='function'?options.trigger():options.trigger;
    if(options.trigger)toolbar.classList.add('canvas-ink-popover');
    function positionToolbar(){
      // Popover mode docks at the bottom center via CSS; only the anchored legacy mode is JS-positioned.
      if(options.trigger)return;
      if(!opened||!trigger())return;
      const rect=trigger().getBoundingClientRect(),box=toolbar.getBoundingClientRect(),settings=panel.hidden?null:panel.getBoundingClientRect();
      const left=Math.max(8,Math.min(options.placement==='right'?rect.right+8:rect.right-box.width,global.innerWidth-box.width-8));
      toolbar.style.left=left+'px';
      toolbar.style.top=Math.max(8,Math.min(options.placement==='right'?rect.top:rect.bottom+8,global.innerHeight-box.height-(settings?settings.height+8:0)-8))+'px';
      if(settings){panel.style.right='auto';panel.style.left=(Math.max(8,Math.min(left+box.width-settings.width,global.innerWidth-settings.width-8))-left)+'px'}
    }
    function setOpen(value){opened=!!value;if(!opened){settingsOpen=false;setTool('select')}else setTool('pen');refreshControls();positionToolbar()}

    const getStrokes=()=>options.getStrokes?.()||[];
    const inside=target=>!target?.closest?.('.qw-analysis-panel,[data-canvas-ui],[data-stage-ui]')&&(target===viewport||world.contains(target)||(target?.parentElement===viewport&&target.classList.contains('qw-background')));
    const stop=event=>{event.preventDefault();event.stopImmediatePropagation()};
    function listen(target,type,callback,config){target.addEventListener(type,callback,config);listeners.push(()=>target.removeEventListener(type,callback,config))}
    function makePath(stroke){
      const el=doc.createElementNS(ns,'path');
      el.setAttribute('d',path(stroke.points));el.setAttribute('fill','none');el.setAttribute('stroke',stroke.color);el.setAttribute('stroke-width',stroke.width);el.setAttribute('stroke-linecap','round');el.setAttribute('stroke-linejoin','round');el.setAttribute('opacity',TOOLS[stroke.tool].opacity);el.dataset.strokeId=stroke.id;
      return el;
    }
    function makeEl(stroke){
      if(stroke.tool!=='text')return makePath(stroke);
      const el=doc.createElementNS(ns,'text');
      el.setAttribute('x',stroke.points[0][0]);el.setAttribute('y',stroke.points[0][1]);
      el.setAttribute('fill',stroke.color);el.setAttribute('font-size',stroke.width);
      el.setAttribute('font-family','system-ui,-apple-system,sans-serif');
      el.setAttribute('dominant-baseline','hanging');
      el.setAttribute('opacity',TOOLS.text.opacity);el.dataset.strokeId=stroke.id;
      el.setAttribute('font-weight',stroke.bold?'700':'400');
      el.setAttribute('xml:space','preserve');
      textLines(stroke).forEach((line,index)=>{const span=doc.createElementNS(ns,'tspan');span.setAttribute('x',stroke.points[0][0]);span.setAttribute('y',stroke.points[0][1]+index*stroke.width*1.35);span.textContent=line||'\u00a0';el.append(span)});
      el.classList.toggle('canvas-ink-text-selected',stroke.id===selectedTextId);
      return el;
    }
    // 工具光标：画笔/荧光笔/橡皮擦各显示对应形状，颜色跟随当前色板。
    const cursorStyle=doc.createElement('style');
    function cursorArt(name,color){
      if(name==='pen')return `<svg xmlns='http://www.w3.org/2000/svg' width='26' height='26'><path d='M4.5 24.5l2.2-7 11-11a2.6 2.6 0 0 1 3.7 3.7l-11 11z' fill='${color}' stroke='#1e293b' stroke-width='1.4' stroke-linejoin='round'/><path d='M4.5 24.5l4.6-2.2' stroke='#1e293b' stroke-width='1.2'/></svg>`;
      if(name==='highlighter')return `<svg xmlns='http://www.w3.org/2000/svg' width='28' height='28'><path d='M5 25l3-10 12-12 5 5-12 12z' fill='${color}' fill-opacity='.6' stroke='#1e293b' stroke-width='1.4' stroke-linejoin='round'/><path d='M3 26h9' stroke='${color}' stroke-width='4' stroke-linecap='round' stroke-opacity='.55'/></svg>`;
      if(name==='eraser')return `<svg xmlns='http://www.w3.org/2000/svg' width='26' height='26'><path d='M6 20l9-11 8 6-9 11H9z' fill='#f8fafc' stroke='#1e293b' stroke-width='1.5' stroke-linejoin='round'/><path d='M11 14l8 6' stroke='#1e293b' stroke-width='1.2'/><path d='M4 25h18' stroke='#94a3b8' stroke-width='1.5' stroke-linecap='round'/></svg>`;
      return `<svg xmlns='http://www.w3.org/2000/svg' width='26' height='26'><path d='M7 4h12M7 22h12M13 4v18' stroke='${color}' stroke-width='2' stroke-linecap='round' fill='none'/></svg>`;
    }
    const CURSOR_HOTSPOT={pen:'3 24',highlighter:'4 24',eraser:'5 22',text:'13 12'};
    doc.head.append(cursorStyle);
    function updateCursor(){
      // eraser 无色板偏好但也需要专属光标（固定配色）；select/只读时恢复默认光标。
      if(destroyed||tool==='select'||!CURSOR_HOTSPOT[tool]||readonly()){cursorStyle.textContent='';return}
      const art=cursorArt(tool,TOOLS[tool]?prefs[tool].color:'#1e293b');
      // :not(#kg-cursor-anchor) 抬高特异性到 (1,3,1)，压过 custom-cursor.css 的 crosshair (1,2,1)!important
      cursorStyle.textContent=`.canvas-ink-drawing:not(#kg-cursor-anchor):not(.canvas-ink-panning)[data-ink-tool='${tool}']{cursor:url("data:image/svg+xml,${encodeURIComponent(art)}") ${CURSOR_HOTSPOT[tool]}, crosshair!important}.canvas-ink-drawing:not(#kg-cursor-anchor):not(.canvas-ink-panning)[data-ink-tool='${tool}'] *{cursor:inherit!important}`;
    }
    function refreshControls(){
      if(destroyed)return;
      const locked=readonly(),state=history?.getState?.()||{};
      // 只读（切题过渡/访客）不再把工具强制降回 select：工具选择保留，绘制入口由
      // pointerdown 的 readonly 拦截兜底，按钮 disabled + 光标还原表达锁定；
      // 只读解除后工具与自定义光标自动恢复（切题保持画笔状态的前提）。
      toolbar.querySelectorAll('[data-ink-tool]').forEach(btn=>{btn.setAttribute('aria-pressed',String(btn.dataset.inkTool===tool));btn.disabled=locked&&btn.dataset.inkTool!=='select'});
      for(const action of ['undo','redo']){const btn=toolbar.querySelector('[data-ink-action='+action+']');btn.hidden=!(ownHistory||options.showHistory);btn.disabled=locked||!state[action==='undo'?'canUndo':'canRedo']}
      toolbar.hidden=!opened;
      const launch=trigger();if(launch){if(!launch.querySelector('svg'))launch.innerHTML=penIcon;launch.classList.add('canvas-ink-entry');launch.setAttribute('aria-expanded',String(opened));launch.disabled=locked;const tip=locked?'当前画布只读，无法使用画笔':opened?'收起画笔工具并退出绘画':'展开画笔工具，在画布上书写或标注';if(launch.hasAttribute('data-tooltip')){launch.dataset.tooltip=tip;launch.removeAttribute('title')}else launch.title=tip;launch.querySelector('svg')?.style.setProperty('color',prefs[TOOLS[tool]?tool:'pen'].color)}
      for(const name of Object.keys(prefs)){const btn=toolbar.querySelector('button[data-ink-tool='+name+']');btn.querySelector('svg')?.style.setProperty('color',prefs[name].color);btn.title=(name==='pen'?'画笔：拖动绘制笔迹':name==='highlighter'?'荧光笔：拖动高亮标注':'文字：点击空白插入，单击选择并拖动文字，双击编辑')+(name==='text'?'；单击显示颜色、字号与加粗':'；单击切换工具，双击调整颜色和粗细')}
      panel.hidden=!settingsOpen||!TOOLS[tool];
      toolbar.querySelector('[data-ink-bold]').hidden=tool!=='text';toolbar.querySelector('[data-ink-bold]').disabled=locked;toolbar.querySelector('[data-ink-bold]').setAttribute('aria-pressed',String(!!prefs.text.bold));
      panel.querySelectorAll('input,button').forEach(input=>input.disabled=locked);range.setAttribute('aria-label',tool==='text'?'文字字号':'笔迹粗细');
      toolbar.querySelector('.canvas-ink-width').hidden=tool==='text';
      const eraserBtn=toolbar.querySelector('button[data-ink-tool=eraser]');
      if(eraserBtn)eraserBtn.title='橡皮擦：单击擦除一笔；双击此按钮清空当前题全部笔迹，可撤销'+(typeof options.onLongPressEraser==='function'?'；长按 3 秒清空整套试卷笔迹（需确认）':'');
      toolbar.querySelector('.canvas-ink-preview').style.display=tool==='text'?'none':'';
      if(TOOLS[tool]){
        const pref=prefs[tool];range.min=pref.min;range.max=pref.max;range.value=pref.width;toolbar.querySelector('output').textContent=pref.width;
        toolbar.querySelector('input[type=color]').value=pref.color;
        toolbar.querySelectorAll('[data-ink-color]').forEach(btn=>btn.setAttribute('aria-pressed',String(btn.dataset.inkColor===pref.color)));
        preview.setAttribute('stroke',pref.color);preview.setAttribute('stroke-width',pref.width);preview.setAttribute('opacity',pref.opacity);
      }
      updateCursor();
      positionToolbar();
    }
    function render(){
      if(destroyed)return;
      try{const strokes=normalize(getStrokes());layer.replaceChildren(...strokes.map(makeEl));const selected=strokes.find(item=>item.id===selectedTextId&&item.tool==='text');if(selected&&!readonly())renderTextHandles(selected);if(active){active.el=makeEl(active.stroke);layer.append(active.el)}}catch(error){report(error)}
      refreshControls();
    }
    function apply(strokes){
      if(readonly())throw new Error('当前画布只读，不能修改笔迹');
      options.setStrokes(normalize(strokes));render();
    }
    function change(next,label){
      const before=normalize(getStrokes()),after=normalize(next);
      if(readonly())throw new Error('当前画布只读，不能修改笔迹');
      if(options.change){options.change(after,label);render()}else{apply(after);history?.push({label,undo:()=>apply(before),redo:()=>apply(after)})}refreshControls();
    }
    function cancel(){
      if(textResize){const id=textResize.pointerId;textResize=null;try{viewport.releasePointerCapture(id)}catch(_){};render()}
      if(textDrag){const id=textDrag.pointerId;textDrag=null;try{if(viewport.hasPointerCapture(id))viewport.releasePointerCapture(id)}catch(_){};render()}
      if(frame){global.cancelAnimationFrame(frame);frame=0}
      if(!active)return;
      const id=active.pointerId;active.el.remove();active=null;
      try{if(viewport.hasPointerCapture(id))viewport.releasePointerCapture(id)}catch(_){}
    }
    function setTool(value){
      cancel();if(value!==tool&&textSession){closeTextEditor(true).then(saved=>{if(saved)setTool(value)});return;}if(value!=='text'&&value!=='select')selectedTextId=null;if(!TOOLS[value])settingsOpen=false;tool=(TOOLS[value]||value==='eraser')&&!readonly()?value:'select';
      viewport.classList.toggle('canvas-ink-drawing',tool!=='select');viewport.dataset.inkTool=tool;
      if(tool!=='select')options.onDrawMode?.();
      render();
      refreshControls();
    }
    const bold=doc.createElement('button');bold.type='button';bold.dataset.inkBold='true';bold.textContent='B';bold.setAttribute('aria-label','文字加粗');panel.insertBefore(bold,toolbar.querySelector('.canvas-ink-preview'));
    function updateTextStyle(patch){
      if(readonly())return;
      Object.assign(prefs.text,tool==='text'?patch:{});
      const selected=getStrokes().find(item=>item.id===selectedTextId&&item.tool==='text');
      if(selected&&tool==='text'&&!textSession){try{change(getStrokes().map(item=>item.id===selected.id?{...item,...patch}:item),'文字格式')}catch(error){report(error)}}
      if(textSession){Object.assign(textSession.style,patch);textSession.editor.style.color=textSession.style.color;textSession.editor.style.fontWeight=textSession.style.bold?'700':'400';textSession.editor.style.fontSize=textSession.style.width*(options.getViewport().scale||options.getViewport().zoom||1)+'px';textSession.editor.dispatchEvent(new global.Event('input'))}
      refreshControls();
    }
    bold.addEventListener('click',()=>updateTextStyle({bold:!prefs.text.bold}));
    const palette=toolbar.querySelector('.canvas-ink-colors');
    for(const [color,name] of [['#2563eb','蓝色'],['#111827','黑色'],['#ef4444','红色'],['#facc15','黄色'],['#22c55e','绿色'],['#a855f7','紫色']]){
      const btn=doc.createElement('button');btn.type='button';btn.dataset.inkColor=color;btn.style.setProperty('--ink-color',color);btn.setAttribute('aria-label',name);btn.title=name;palette.append(btn);
      btn.addEventListener('click',()=>{if(prefs[tool]){prefs[tool].color=color;if(tool==='text')updateTextStyle({color});else refreshControls()}});
    }
    const color=doc.createElement('input');color.type='color';color.setAttribute('aria-label','自定义笔迹颜色');color.title='自定义颜色';palette.append(color);
    color.addEventListener('input',()=>{if(prefs[tool]){prefs[tool].color=color.value;if(tool==='text')updateTextStyle({color:color.value});else refreshControls()}});
    range.addEventListener('input',()=>{if(prefs[tool]){prefs[tool].width=Number(range.value);if(tool==='text')updateTextStyle({width:Number(range.value)});else refreshControls()}});
    // 文字格式单击可见；画笔与荧光笔仍双击打开设置。
    toolbar.querySelectorAll('[data-ink-tool]').forEach(btn=>btn.addEventListener('click',()=>{const next=btn.dataset.inkTool;if(TOOLS[next])settingsOpen=next==='text';setTool(next)}));
    toolbar.querySelectorAll('[data-ink-tool]').forEach(btn=>btn.addEventListener('dblclick',event=>{
      const next=btn.dataset.inkTool;
      // 非绘图工具（橡皮擦）放行事件给后续 dblclick 处理器（双击清空当前画布）。
      if(!TOOLS[next]||tool!==next)return;
      stop(event);
      settingsOpen=true;refreshControls();positionToolbar();
    }));
    toolbar.querySelector('[data-ink-tool=eraser]').addEventListener('dblclick',event=>{
      stop(event);if(readonly())return;cancel();try{if(getStrokes().length)change([],'清空笔迹')}catch(error){report(error)}
    });
    listen(doc,'click',event=>{const launch=trigger();if(launch&&(event.target===launch||launch.contains(event.target))){setOpen(!opened)}});
    listen(global,'pointerdown',event=>{if(settingsOpen&&tool!=='text'&&!toolbar.contains(event.target)){settingsOpen=false;refreshControls()}},true);
    toolbar.querySelectorAll('[data-ink-action]').forEach(btn=>btn.addEventListener('click',()=>{
      if(readonly())return;cancel();
      try{
        const action=btn.dataset.inkAction;
        history?.[action]?.();
        refreshControls();
      }catch(error){report(error)}
    }));
    listen(toolbar,'pointerdown',event=>event.stopPropagation());
    listen(toolbar,'wheel',event=>event.stopPropagation());
    // 文字工具：单击选择，拖动移动，双击编辑；Enter 换行，Ctrl/⌘+Enter 保存。
    let textSession=null;
    async function closeTextEditor(commit){
      const session=textSession;if(!session)return true;
      if(commit){
        if(session.composing){session.deferredCommit=true;return false}
        const draft={text:session.editor.value.slice(0,TEXT_LIMIT),...session.style};
        if(JSON.stringify(draft)!==JSON.stringify(session.edit.state().draft))session.edit.update(draft);
        session.editor.dataset.saveState='committing';
        const success=await session.edit.commit();
        if(textSession!==session)return false;
        session.editor.dataset.saveState=session.edit.state().status;
        if(!success){if(session.edit.state().status==='failed'){session.status.textContent='文字未保存，请点击外部重试';report(session.edit.state().error)}return false}
      }else{session.edit.cancel();if(session.applied&&!session.stale){options.setStrokes?options.setStrokes(session.before):options.change(session.before,'取消文字修改');render()}}
      textSession=null;session.unmount.forEach(dispose=>dispose());session.editor.remove();session.status.remove();return true;
    }
    function openTextEditor(clientX,clientY,existing){
      if(textSession){closeTextEditor(true);return}
      const view=options.getViewport(),rect=viewport.getBoundingClientRect(),scale=view.scale||view.zoom||1;
      const world=existing?existing.points[0]:point({clientX,clientY},rect,view);
      const box=existing?textBox(existing):{width:200,height:100};
      const style={color:existing?existing.color:prefs.text.color,width:existing?existing.width:prefs.text.width,bold:!!(existing?existing.bold:prefs.text.bold),boxWidth:Math.max(40,box.width),boxHeight:Math.max(24,box.height)};
      const editor=doc.createElement('textarea');
      editor.className='canvas-ink-text-editor';editor.maxLength=TEXT_LIMIT;editor.placeholder='点击外部保存 · Enter 换行 · Esc 取消';editor.setAttribute('aria-label','画布文字内容');editor.value=existing?existing.text:'';
      editor.style.left=(rect.left+view.x+world[0]*scale)+'px';editor.style.top=(rect.top+view.y+world[1]*scale)+'px';editor.style.width=style.boxWidth*scale+'px';
      editor.style.fontSize=style.width*scale+'px';editor.style.color=style.color;editor.style.fontWeight=style.bold?'700':'400';
      const status=doc.createElement('div');status.className='canvas-ink-text-status';status.dataset.canvasUi='true';status.setAttribute('role','status');
      doc.body.append(editor,status);
      const before=normalize(getStrokes()),id=existing?.id||'ink-'+Date.now().toString(36)+'-'+(++sequence)+'-'+Math.random().toString(36).slice(2,8);
      const session={editor,status,existing,world,style,before,unmount:[],applied:false,composing:false};textSession=session;
      session.edit=global.KGTextEditSession.create({original:{text:editor.value,...style},persist:async draft=>{
        if(session.stale)throw new Error('画布已切换，文字草稿仍保留，请复制输入或按 Esc 关闭');
        if(!existing&&!draft.text.trim())return true;
        const stroke={id,tool:'text',points:[world],...draft};stroke.boxHeight=Math.min(4000,Math.max(stroke.boxHeight,textLines(stroke).length*stroke.width*1.35));
        const signature=JSON.stringify(stroke);
        if(signature!==session.appliedSignature){change(existing||session.applied?getStrokes().map(item=>item.id===id?stroke:item):[...getStrokes(),stroke],existing?'编辑文字':'添加文字');session.applied=true;session.appliedSignature=signature}
        return options.persistText?await options.persistText():true;
      }});
      const resize=()=>{editor.style.height='auto';editor.style.height=Math.max(style.boxHeight*scale,editor.scrollHeight)+'px';status.style.left=editor.style.left;status.style.top=(parseFloat(editor.style.top)+editor.offsetHeight+4)+'px'};
      if(global.KGCanvasDomInteraction){
        const relocate=()=>{const r=viewport.getBoundingClientRect(),v=options.getViewport(),s=v.scale||v.zoom||1;editor.style.left=(r.left+v.x+world[0]*s)+'px';editor.style.top=(r.top+v.y+world[1]*s)+'px';resize()};
        session.unmount.push(global.KGCanvasDomInteraction.mountOverlay(editor,doc.body,relocate),global.KGCanvasDomInteraction.mountOverlay(status,doc.body));
      }
      editor.addEventListener('compositionstart',()=>{session.composing=true;session.edit.setComposing(true)});
      editor.addEventListener('compositionend',()=>{session.composing=false;session.edit.setComposing(false);if(session.deferredCommit){session.deferredCommit=false;closeTextEditor(true)}});
      editor.addEventListener('keydown',event=>{event.stopPropagation();if(event.isComposing||event.keyCode===229)return;if(event.key==='Enter'&&(event.ctrlKey||event.metaKey)){event.preventDefault();closeTextEditor(true)}else if(event.key==='Escape'){event.preventDefault();closeTextEditor(false)}});
      editor.addEventListener('input',()=>{session.edit.update({text:editor.value,...style});editor.dataset.saveState='draft';status.textContent='';resize()});
      editor.addEventListener('blur',event=>{if(toolbar.contains(event.relatedTarget))return;global.setTimeout(()=>{if(textSession===session&&!toolbar.contains(doc.activeElement))closeTextEditor(true)},160)});
      editor.focus();resize();
    }
    listen(global,'pointerdown',event=>{if(!textSession||textSession.editor.contains(event.target)||toolbar.contains(event.target))return;closeTextEditor(true);},true);
    function hitTextStroke(location,padding){
      for(const el of [...layer.querySelectorAll('[data-stroke-id]')].reverse()){
        const stroke=getStrokes().find(item=>item.id===el.dataset.strokeId);
        if(stroke?.tool!=='text')continue;
        try{
          const box=stroke.boxWidth?textBox(stroke):el.getBBox();
          if(location[0]>=box.x-padding&&location[0]<=box.x+box.width+padding&&location[1]>=box.y-padding&&location[1]<=box.y+box.height+padding)return stroke;
        }catch(_){}
      }
      return null;
    }
    function addPoint(event){
      if(!active)return;
      const next=point(event,viewport.getBoundingClientRect(),options.getViewport());
      if(next.some(n=>!Number.isFinite(n)||Math.abs(n)>LIMITS.coordinate))return;
      const points=active.stroke.points,last=points.at(-1),scale=options.getViewport().scale||options.getViewport().zoom||1;
      if(points.length&&Math.hypot(next[0]-last[0],next[1]-last[1])*scale<1.5)return;
      if(points.length>=active.pointLimit){active.limited=true;return}
      points.push(next);
    }
    listen(global,'pointerdown',event=>{
      if(textSession)return;
      const handle=event.target.closest?.('[data-ink-resize-handle]');if(handle&&layer.contains(handle)&&!readonly()){stop(event);const stroke=getStrokes().find(item=>item.id===handle.dataset.textId);textResize={pointerId:event.pointerId,handle:handle.dataset.inkResizeHandle,start:point(event,viewport.getBoundingClientRect(),options.getViewport()),original:normalize([stroke])[0],box:textBox(stroke)};viewport.setPointerCapture(event.pointerId);return}
      if(destroyed||active||textDrag||textResize||space||readonly()||event.button!==0||event.isPrimary===false||!inside(event.target))return;
      const view=options.getViewport(),location=point(event,viewport.getBoundingClientRect(),view);
      const textHit=(tool==='select'||tool==='text')?hitTextStroke(location,4/(view.scale||view.zoom||1)):null;
      if(tool==='select'&&!textHit){selectedTextId=null;render();return}
      stop(event);
      try{
        if(textHit){selectedTextId=textHit.id;Object.assign(prefs.text,{color:textHit.color,width:textHit.width,bold:!!textHit.bold});textDrag={pointerId:event.pointerId,start:location,original:normalize([textHit])[0],moved:false};render();viewport.setPointerCapture(event.pointerId);return}
        if(tool==='eraser'){
          const view=options.getViewport(),location=point(event,viewport.getBoundingClientRect(),view);
          const target=new global.DOMPoint(...location),padding=16/(view.scale||view.zoom||1);
          // Use SVG's actual smoothed curve geometry; a polyline approximation
          // would miss bends and accidentally erase nearby strokes.
          for(const el of [...layer.querySelectorAll('[data-stroke-id]')].reverse()){
            let hit=false;
            const stroke=getStrokes().find(item=>item.id===el.dataset.strokeId);
            if(stroke?.tool==='text'){
              try{const box=el.getBBox();hit=location[0]>=box.x-padding&&location[0]<=box.x+box.width+padding&&location[1]>=box.y-padding&&location[1]<=box.y+box.height+padding}catch(_){hit=false}
              if(hit){change(getStrokes().filter(item=>item.id!==el.dataset.strokeId),'擦除文字');break}
              continue;
            }
            const width=el.getAttribute('stroke-width');
            try{el.setAttribute('stroke-width',Number(width)+padding);hit=el.isPointInStroke(target)}
            finally{el.setAttribute('stroke-width',width)}
            if(hit){change(getStrokes().filter(stroke=>stroke.id!==el.dataset.strokeId),'擦除笔迹');break}
          }
          suppressClickUntil=Date.now()+400;return;
        }
        if(tool==='text'){
          const view=options.getViewport(),location=point(event,viewport.getBoundingClientRect(),view);
          selectedTextId=null;openTextEditor(event.clientX,event.clientY,null);
          suppressClickUntil=Date.now()+400;return;
        }
        const strokes=normalize(getStrokes()),remaining=LIMITS.total-strokes.reduce((sum,s)=>sum+s.points.length,0);
        if(strokes.length>=LIMITS.strokes||remaining<1)throw new Error('当前画布笔迹已达上限，请清理部分笔迹后继续');
        const pref=prefs[tool],stroke={id:'ink-'+Date.now().toString(36)+'-'+(++sequence)+'-'+Math.random().toString(36).slice(2,8),tool,color:pref.color,width:pref.width,points:[]};
        active={pointerId:event.pointerId,stroke,el:makePath(stroke),pointLimit:Math.min(remaining,LIMITS.points)};
        addPoint(event);layer.append(active.el);active.el.setAttribute('d',path(stroke.points));viewport.setPointerCapture(event.pointerId);
      }catch(error){cancel();report(error)}
    },true);
    listen(global,'pointermove',event=>{
      if(textResize&&event.pointerId===textResize.pointerId){stop(event);const current=point(event,viewport.getBoundingClientRect(),options.getViewport()),drag=textResize,next=global.KGTextBoxGeometry.resize(drag.box,drag.handle,{x:current[0]-drag.start[0],y:current[1]-drag.start[1]});drag.next={...drag.original,points:[[next.x,next.y]],width:next.fontSize,boxWidth:next.width,boxHeight:next.height};drag.next.boxHeight=Math.min(4000,Math.max(next.height,textLines(drag.next).length*next.fontSize*1.35));layer.replaceChildren(...getStrokes().map(item=>makeEl(item.id===drag.original.id?drag.next:item)));renderTextHandles(drag.next);return}
      if(textDrag&&event.pointerId===textDrag.pointerId){
        stop(event);if(readonly()){cancel();return}
        const current=point(event,viewport.getBoundingClientRect(),options.getViewport()),dx=current[0]-textDrag.start[0],dy=current[1]-textDrag.start[1],scale=options.getViewport().scale||options.getViewport().zoom||1;
        if(Math.hypot(dx,dy)*scale>=3)textDrag.moved=true;
        if(textDrag.moved){textDrag.next={...textDrag.original,points:textDrag.original.points.map(([x,y])=>[x+dx,y+dy])};const el=[...layer.querySelectorAll('[data-stroke-id]')].find(item=>item.dataset.strokeId===textDrag.original.id);if(el)el.replaceWith(makeEl(textDrag.next))}return;
      }
      if(!active||event.pointerId!==active.pointerId)return;stop(event);
      if(readonly()){cancel();return}
      const samples=event.getCoalescedEvents?.()||[];
      for(const sample of samples.length?samples:[event])addPoint(sample);
      if(!frame)frame=global.requestAnimationFrame(()=>{frame=0;if(active)active.el.setAttribute('d',path(active.stroke.points))});
    },true);
    listen(global,'pointerup',event=>{
      if(textResize&&event.pointerId===textResize.pointerId){stop(event);const drag=textResize;cancel();if(drag.next&&JSON.stringify(drag.next)!==JSON.stringify(drag.original))try{change(getStrokes().map(item=>item.id===drag.original.id?drag.next:item),'调整文本框大小');Promise.resolve(options.persistText?.()).catch(report)}catch(error){report(error)}return}
      if(textDrag&&event.pointerId===textDrag.pointerId){stop(event);const drag=textDrag;cancel();suppressClickUntil=Date.now()+400;if(drag.moved&&drag.next)try{change(getStrokes().map(item=>item.id===drag.original.id?drag.next:item),'移动文字')}catch(error){render();report(error)}return}
      if(!active||event.pointerId!==active.pointerId)return;stop(event);addPoint(event);
      const {stroke,limited}=active;cancel();suppressClickUntil=Date.now()+400;
      try{if(stroke.points.length)change([...getStrokes(),stroke],stroke.tool==='pen'?'画笔':'荧光笔');if(limited)report(new Error('此笔已达长度上限，请抬笔后继续绘制'))}catch(error){render();report(error)}
    },true);
    listen(global,'pointercancel',event=>{if((textResize&&event.pointerId===textResize.pointerId)||(active&&event.pointerId===active.pointerId)||(textDrag&&event.pointerId===textDrag.pointerId)){cancel();stop(event)}},true);
    listen(viewport,'lostpointercapture',event=>{if((textResize&&event.pointerId===textResize.pointerId)||(active&&event.pointerId===active.pointerId)||(textDrag&&event.pointerId===textDrag.pointerId))cancel()});
    listen(global,'dblclick',event=>{if(readonly()||space||!inside(event.target)||(tool!=='select'&&tool!=='text'))return;const view=options.getViewport(),hit=hitTextStroke(point(event,viewport.getBoundingClientRect(),view),4/(view.scale||view.zoom||1));if(hit){stop(event);selectedTextId=hit.id;openTextEditor(event.clientX,event.clientY,hit)}},true);
    listen(global,'click',event=>{if(inside(event.target)&&(Date.now()<suppressClickUntil||(tool!=='select'&&!space)))stop(event)},true);
    listen(global,'keydown',event=>{
      if(global.KGCanvasDomInteraction?.isEditingTarget(event)||event.target?.closest?.('input,textarea,[contenteditable]'))return;
      if(event.key==='Escape'){if(textResize){cancel();return}setTool('select');return}
      if(event.code==='Space'&&tool!=='select'){space=true;cancel();viewport.classList.add('canvas-ink-panning');event.preventDefault()}
      if(ownHistory&&!readonly()&&(event.ctrlKey||event.metaKey)&&event.key.toLowerCase()==='z'&&!event.altKey){stop(event);cancel();try{history?.[event.shiftKey?'redo':'undo']?.();refreshControls()}catch(error){report(error)}}
    },true);
    listen(global,'keyup',event=>{if(event.code==='Space'){space=false;viewport.classList.remove('canvas-ink-panning')}},true);
    listen(global,'resize',()=>{cancel();positionToolbar()});
    listen(doc,'scroll',()=>{cancel();positionToolbar()},true);
    listen(global,'blur',()=>{cancel();space=false;viewport.classList.remove('canvas-ink-panning')});
    // Cancel instead of mixing coordinate systems if zoom changes mid-stroke.
    listen(global,'wheel',event=>{if((active||textDrag)&&viewport.contains(event.target))cancel()},true);
    // 画笔状态下右击画布退出绘画，回到选择模式（右键拖动平移不受影响）。
    listen(doc,'contextmenu',event=>{
      if(destroyed||tool==='select'||space)return;
      if(!viewport.contains(event.target)||!inside(event.target))return;
      stop(event);
      setTool('select');
      options.onExitDraw?.();
    },true);
    // 橡皮擦长按 3 秒：由页面回调实现整套试卷笔迹清空（含确认）。
    let eraserHoldTimer=0;
    const eraserHoldBtn=toolbar.querySelector('[data-ink-tool=eraser]');
    const stopEraserHold=()=>{if(eraserHoldTimer){global.clearTimeout(eraserHoldTimer);eraserHoldTimer=0}eraserHoldBtn?.classList.remove('canvas-ink-holding')};
    listen(eraserHoldBtn,'pointerdown',event=>{
      if(event.button!==0||typeof options.onLongPressEraser!=='function')return;
      stopEraserHold();
      eraserHoldBtn.classList.add('canvas-ink-holding');
      eraserHoldTimer=global.setTimeout(()=>{eraserHoldTimer=0;stopEraserHold();options.onLongPressEraser()},3000);
    });
    listen(global,'pointerup',stopEraserHold);
    listen(global,'pointercancel',stopEraserHold);
    listen(eraserHoldBtn,'pointerleave',stopEraserHold);
    function reset(options){
      if(textSession&&!options?.discardDraft){textSession.stale=true;textSession.editor.dataset.saveState='failed';textSession.status.textContent='画布已切换，草稿仍保留，请复制输入或按 Esc 关闭';report(new Error('文字草稿尚未保存，请先保存或按 Esc 取消'));cancel();selectedTextId=null;if(ownHistory)history?.clear();render();return false}cancel();closeTextEditor(false);selectedTextId=null;settingsOpen=false;
      if(!options?.keepTool)setTool('select');else refreshControls();
      if(ownHistory)history?.clear();render();
    }
    // 供橡皮擦长按等页面入口清空当前画布全部笔迹（走 change，可撤销）。
    function clearAll(label){
      cancel();
      if(!getStrokes().length)return false;
      try{change([],label||'清空笔迹');return true}
      catch(error){report(error);return false}
    }
    function destroy(){if(textSession){report(new Error('文字草稿尚未保存'));return false}closeTextEditor(false);stopEraserHold();cursorStyle.remove();cancel();destroyed=true;listeners.forEach(remove=>remove());layer.remove();toolbar.remove();viewport.classList.remove('canvas-ink-drawing','canvas-ink-panning');delete viewport.dataset.inkTool}
    render();
    return {commitText:()=>closeTextEditor(true),hasTextDraft:()=>!!textSession,render,refreshControls,cancel,reset,setTool,setOpen,destroy,clearAll,get tool(){return tool},get temporaryPan(){return space}};
  }
  global.KGCanvasInk=Object.freeze({normalize,point,path,create});
})(window);
