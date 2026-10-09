'use strict';

/* Shared world-coordinate ink. Page adapters own persistence and access control. */
(function(global){
  const LIMITS={strokes:2000,points:5000,total:100000,coordinate:10000000};
  const TOOLS={pen:{min:1,max:24,width:3,color:'#2563eb',opacity:1},highlighter:{min:4,max:48,width:16,color:'#facc15',opacity:.3},text:{min:12,max:72,width:24,color:'#111827',opacity:1}};
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
      if(!Array.isArray(stroke.points)||!stroke.points.length||stroke.points.length>LIMITS.points||(total+=stroke.points.length)>LIMITS.total)throw new Error('笔迹点数超出限制，请清理部分笔迹');
      const points=stroke.points.map(p=>{
        if(!Array.isArray(p)||p.length!==2||p.some(n=>typeof n!=='number'||!Number.isFinite(n)||Math.abs(n)>LIMITS.coordinate))throw new Error('笔迹坐标无效');
        return [...p];
      });
      if(stroke.tool==='text'){
        if(typeof stroke.text!=='string'||!stroke.text.trim()||stroke.text.length>TEXT_LIMIT)throw new Error('文字内容无效');
        return {id:stroke.id,tool:stroke.tool,color:stroke.color,width:stroke.width,points,text:stroke.text};
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
    const inside=target=>!target?.closest?.('.qw-analysis-panel,[data-canvas-ui],[data-stage-ui]')&&(target===viewport||world.contains(target));
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
      el.textContent=stroke.text;
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
      // eraser 无色板偏好但也需要专属光标（固定配色）；select 恢复默认光标。
      if(destroyed||tool==='select'||!CURSOR_HOTSPOT[tool]){cursorStyle.textContent='';return}
      const art=cursorArt(tool,TOOLS[tool]?prefs[tool].color:'#1e293b');
      // :not(#kg-cursor-anchor) 抬高特异性到 (1,3,1)，压过 custom-cursor.css 的 crosshair (1,2,1)!important
      cursorStyle.textContent=`.canvas-ink-drawing:not(#kg-cursor-anchor):not(.canvas-ink-panning)[data-ink-tool='${tool}']{cursor:url("data:image/svg+xml,${encodeURIComponent(art)}") ${CURSOR_HOTSPOT[tool]}, crosshair!important}.canvas-ink-drawing:not(#kg-cursor-anchor):not(.canvas-ink-panning)[data-ink-tool='${tool}'] *{cursor:inherit!important}`;
    }
    function refreshControls(){
      if(destroyed)return;
      const locked=readonly(),state=history?.getState?.()||{};
      if(locked&&tool!=='select')setTool('select');
      toolbar.querySelectorAll('[data-ink-tool]').forEach(btn=>{btn.setAttribute('aria-pressed',String(btn.dataset.inkTool===tool));btn.disabled=locked&&btn.dataset.inkTool!=='select'});
      for(const action of ['undo','redo']){const btn=toolbar.querySelector('[data-ink-action='+action+']');btn.hidden=!(ownHistory||options.showHistory);btn.disabled=locked||!state[action==='undo'?'canUndo':'canRedo']}
      toolbar.hidden=!opened;
      const launch=trigger();if(launch){if(!launch.querySelector('svg'))launch.innerHTML=penIcon;launch.classList.add('canvas-ink-entry');launch.setAttribute('aria-expanded',String(opened));launch.disabled=locked;const tip=locked?'当前画布只读，无法使用画笔':opened?'收起画笔工具并退出绘画':'展开画笔工具，在画布上书写或标注';if(launch.hasAttribute('data-tooltip')){launch.dataset.tooltip=tip;launch.removeAttribute('title')}else launch.title=tip;launch.querySelector('svg')?.style.setProperty('color',prefs[TOOLS[tool]?tool:'pen'].color)}
      for(const name of Object.keys(prefs)){const btn=toolbar.querySelector('button[data-ink-tool='+name+']');btn.querySelector('svg')?.style.setProperty('color',prefs[name].color);btn.title=(name==='pen'?'画笔：拖动绘制笔迹':name==='highlighter'?'荧光笔：拖动高亮标注':'文字：点击画布插入文字，点击已有文字可编辑')+'；单击切换工具，双击调整颜色和粗细'}
      panel.hidden=!settingsOpen||!TOOLS[tool];
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
      try{const strokes=normalize(getStrokes());layer.replaceChildren(...strokes.map(makeEl));if(active){active.el=makeEl(active.stroke);layer.append(active.el)}}catch(error){report(error)}
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
      if(frame){global.cancelAnimationFrame(frame);frame=0}
      if(!active)return;
      const id=active.pointerId;active.el.remove();active=null;
      try{if(viewport.hasPointerCapture(id))viewport.releasePointerCapture(id)}catch(_){}
    }
    function setTool(value){
      cancel();if(!TOOLS[value])settingsOpen=false;tool=(TOOLS[value]||value==='eraser')&&!readonly()?value:'select';
      viewport.classList.toggle('canvas-ink-drawing',tool!=='select');viewport.dataset.inkTool=tool;
      if(tool!=='select')options.onDrawMode?.();
      refreshControls();
    }
    const palette=toolbar.querySelector('.canvas-ink-colors');
    for(const [color,name] of [['#2563eb','蓝色'],['#111827','黑色'],['#ef4444','红色'],['#facc15','黄色'],['#22c55e','绿色'],['#a855f7','紫色']]){
      const btn=doc.createElement('button');btn.type='button';btn.dataset.inkColor=color;btn.style.setProperty('--ink-color',color);btn.setAttribute('aria-label',name);btn.title=name;palette.append(btn);
      btn.addEventListener('click',()=>{if(prefs[tool]){prefs[tool].color=color;refreshControls()}});
    }
    const color=doc.createElement('input');color.type='color';color.setAttribute('aria-label','自定义笔迹颜色');color.title='自定义颜色';palette.append(color);
    color.addEventListener('input',()=>{if(prefs[tool]){prefs[tool].color=color.value;refreshControls()}});
    range.addEventListener('input',()=>{if(prefs[tool]){prefs[tool].width=Number(range.value);refreshControls()}});
    // 单击只切换工具（Boardmix 式）；双击绘图工具才展开颜色和粗细设置。
    toolbar.querySelectorAll('[data-ink-tool]').forEach(btn=>btn.addEventListener('click',()=>{const next=btn.dataset.inkTool;if(TOOLS[next])settingsOpen=false;setTool(next)}));
    toolbar.querySelectorAll('[data-ink-tool]').forEach(btn=>btn.addEventListener('dblclick',event=>{
      stop(event);
      const next=btn.dataset.inkTool;
      if(!TOOLS[next]||tool!==next)return;
      settingsOpen=true;refreshControls();positionToolbar();
    }));
    toolbar.querySelector('[data-ink-tool=eraser]').addEventListener('dblclick',event=>{
      stop(event);if(readonly())return;cancel();try{if(getStrokes().length)change([],'清空笔迹')}catch(error){report(error)}
    });
    listen(doc,'click',event=>{const launch=trigger();if(launch&&(event.target===launch||launch.contains(event.target))){setOpen(!opened)}});
    listen(global,'pointerdown',event=>{if(settingsOpen&&!toolbar.contains(event.target)){settingsOpen=false;refreshControls()}},true);
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
    // 文字工具：点击画布插入文字，点击已有文字进入编辑；回车确认、Esc 取消。
    let textSession=null;
    function closeTextEditor(commit){
      const session=textSession;if(!session)return;
      textSession=null;
      const value=session.editor.value.trim().slice(0,TEXT_LIMIT);
      session.editor.remove();
      if(!commit)return;
      try{
        if(session.existing){
          if(!value)change(getStrokes().filter(item=>item.id!==session.existing.id),'删除文字');
          else if(value!==session.existing.text)change(getStrokes().map(item=>item.id===session.existing.id?{...item,text:value,color:prefs.text.color,width:prefs.text.width}:item),'编辑文字');
        }else if(value){
          change([...getStrokes(),{id:'ink-'+Date.now().toString(36)+'-'+(++sequence)+'-'+Math.random().toString(36).slice(2,8),tool:'text',color:prefs.text.color,width:prefs.text.width,points:[session.world],text:value}],'添加文字');
        }
      }catch(error){report(error)}
    }
    function openTextEditor(clientX,clientY,existing){
      closeTextEditor(false);
      const view=options.getViewport(),rect=viewport.getBoundingClientRect(),scale=view.scale||view.zoom||1;
      // existing 为命中的文字笔迹（裸 stroke），点击空白时为 null
      const world=existing?existing.points[0]:point({clientX,clientY},rect,view);
      const editor=doc.createElement('textarea');
      editor.className='canvas-ink-text-editor';editor.rows=1;editor.placeholder='输入文字，回车确认';
      editor.value=existing?existing.text:'';
      editor.style.left=(rect.left+view.x+world[0]*scale)+'px';
      editor.style.top=(rect.top+view.y+world[1]*scale)+'px';
      editor.style.fontSize=(existing?existing.width:prefs.text.width)*scale+'px';
      editor.style.color=prefs.text.color;
      doc.body.append(editor);
      textSession={editor,existing,world};
      editor.addEventListener('keydown',event=>{
        event.stopPropagation();
        if(event.key==='Enter'&&!event.shiftKey){event.preventDefault();closeTextEditor(true)}
        else if(event.key==='Escape'){event.preventDefault();closeTextEditor(false)}
      });
      editor.addEventListener('input',()=>{editor.style.height='auto';editor.style.height=editor.scrollHeight+'px'});
      editor.addEventListener('blur',()=>closeTextEditor(true));
      editor.focus();
    }
    function hitTextStroke(location,padding){
      for(const el of [...layer.querySelectorAll('[data-stroke-id]')].reverse()){
        const stroke=getStrokes().find(item=>item.id===el.dataset.strokeId);
        if(stroke?.tool!=='text')continue;
        try{
          const box=el.getBBox();
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
      if(destroyed||active||tool==='select'||space||readonly()||event.button!==0||event.isPrimary===false||!inside(event.target))return;
      stop(event);
      try{
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
          openTextEditor(event.clientX,event.clientY,hitTextStroke(location,16/(view.scale||view.zoom||1)));
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
      if(!active||event.pointerId!==active.pointerId)return;stop(event);
      if(readonly()){cancel();return}
      const samples=event.getCoalescedEvents?.()||[];
      for(const sample of samples.length?samples:[event])addPoint(sample);
      if(!frame)frame=global.requestAnimationFrame(()=>{frame=0;if(active)active.el.setAttribute('d',path(active.stroke.points))});
    },true);
    listen(global,'pointerup',event=>{
      if(!active||event.pointerId!==active.pointerId)return;stop(event);addPoint(event);
      const {stroke,limited}=active;cancel();suppressClickUntil=Date.now()+400;
      try{if(stroke.points.length)change([...getStrokes(),stroke],stroke.tool==='pen'?'画笔':'荧光笔');if(limited)report(new Error('此笔已达长度上限，请抬笔后继续绘制'))}catch(error){render();report(error)}
    },true);
    listen(global,'pointercancel',event=>{if(active&&event.pointerId===active.pointerId){cancel();stop(event)}},true);
    listen(viewport,'lostpointercapture',event=>{if(active&&event.pointerId===active.pointerId)cancel()});
    listen(global,'click',event=>{if(inside(event.target)&&(Date.now()<suppressClickUntil||(tool!=='select'&&!space)))stop(event)},true);
    listen(global,'keydown',event=>{
      if(event.target?.closest?.('input,textarea,select,[contenteditable="true"],[contenteditable=""]'))return;
      if(event.key==='Escape'){setTool('select');return}
      if(event.code==='Space'&&tool!=='select'){space=true;cancel();viewport.classList.add('canvas-ink-panning');event.preventDefault()}
      if(ownHistory&&!readonly()&&(event.ctrlKey||event.metaKey)&&event.key.toLowerCase()==='z'&&!event.altKey){stop(event);cancel();try{history?.[event.shiftKey?'redo':'undo']?.();refreshControls()}catch(error){report(error)}}
    },true);
    listen(global,'keyup',event=>{if(event.code==='Space'){space=false;viewport.classList.remove('canvas-ink-panning')}},true);
    listen(global,'resize',()=>{cancel();positionToolbar()});
    listen(doc,'scroll',()=>{cancel();positionToolbar()},true);
    listen(global,'blur',()=>{cancel();space=false;viewport.classList.remove('canvas-ink-panning')});
    // Cancel instead of mixing coordinate systems if zoom changes mid-stroke.
    listen(global,'wheel',event=>{if(active&&viewport.contains(event.target))cancel()},true);
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
      cancel();settingsOpen=false;
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
    function destroy(){closeTextEditor(false);stopEraserHold();cursorStyle.remove();cancel();destroyed=true;listeners.forEach(remove=>remove());layer.remove();toolbar.remove();viewport.classList.remove('canvas-ink-drawing','canvas-ink-panning');delete viewport.dataset.inkTool}
    render();
    return {render,refreshControls,cancel,reset,setTool,setOpen,destroy,clearAll,get tool(){return tool},get temporaryPan(){return space}};
  }
  global.KGCanvasInk=Object.freeze({normalize,point,path,create});
})(window);
