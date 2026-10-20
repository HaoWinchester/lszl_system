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
      const fields=stroke.tool==='text'?['id','tool','color','width','points','opacity','text','bold','boxWidth','boxHeight']:['id','tool','color','width','points','opacity'];
      if(Object.keys(stroke).some(key=>!fields.includes(key)))throw new Error('笔迹不能包含额外字段');
      if(stroke.opacity!==undefined&&(typeof stroke.opacity!=='number'||!Number.isFinite(stroke.opacity)||stroke.opacity<0||stroke.opacity>1))throw new Error('笔迹透明度无效');
      const opacity=stroke.opacity===undefined?{}:{opacity:stroke.opacity};
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
        return {id:stroke.id,tool:stroke.tool,color:stroke.color,width:stroke.width,points,...opacity,text:stroke.text,...dimensions,...(stroke.bold===undefined?{}:{bold:stroke.bold})};
      }
      return {id:stroke.id,tool:stroke.tool,color:stroke.color,width:stroke.width,points,...opacity};
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
  function textLayout(stroke,measure){
    measure.font=(stroke.bold?'700 ':'400 ')+stroke.width+'px system-ui';
    const lines=[];for(const paragraph of stroke.text.split('\n')){let line='';for(const char of paragraph){if(stroke.boxWidth&&line&&measure.measureText(line+char).width>stroke.boxWidth){lines.push(line);line=''}line+=char}lines.push(line)}
    return {lines,x:stroke.points[0][0],y:stroke.points[0][1],width:stroke.boxWidth||Math.max(40,...lines.map(line=>measure.measureText(line).width)),height:Math.max(stroke.boxHeight||24,lines.length*stroke.width*1.35),fontSize:stroke.width};
  }
  function bounds(strokes,measure){
    let minX=Infinity,minY=Infinity,maxX=-Infinity,maxY=-Infinity;
    for(const stroke of normalize(strokes)){
      if(stroke.tool==='text'){const box=textLayout(stroke,measure);minX=Math.min(minX,box.x);minY=Math.min(minY,box.y);maxX=Math.max(maxX,box.x+box.width);maxY=Math.max(maxY,box.y+box.height)}
      else for(const [x,y] of stroke.points){const radius=stroke.width/2;minX=Math.min(minX,x-radius);minY=Math.min(minY,y-radius);maxX=Math.max(maxX,x+radius);maxY=Math.max(maxY,y+radius)}
    }
    return Number.isFinite(minX)?{x:minX,y:minY,width:maxX-minX,height:maxY-minY}:null;
  }
  function draw(context,strokes){
    for(const stroke of normalize(strokes)){
      context.save();context.globalAlpha=stroke.opacity??TOOLS[stroke.tool].opacity;
      if(stroke.tool==='text'){const layout=textLayout(stroke,context);context.fillStyle=stroke.color;context.textBaseline='hanging';layout.lines.forEach((line,index)=>context.fillText(line,layout.x,layout.y+index*stroke.width*1.35))}
      else{context.strokeStyle=stroke.color;context.lineWidth=stroke.width;context.lineCap='round';context.lineJoin='round';context.stroke(new global.Path2D(path(stroke.points)))}
      context.restore();
    }
  }
  function svgStroke(stroke,doc,measure,{selected=false}={}){
    const ns="http://www.w3.org/2000/svg";
    if(stroke.tool!=='text'){
      const el=doc.createElementNS(ns,'path');
      el.setAttribute('d',path(stroke.points));el.setAttribute('fill','none');el.setAttribute('stroke',stroke.color);el.setAttribute('stroke-width',stroke.width);el.setAttribute('stroke-linecap','round');el.setAttribute('stroke-linejoin','round');el.setAttribute('opacity',stroke.opacity??TOOLS[stroke.tool].opacity);el.dataset.strokeId=stroke.id;
      return el;
    }

    const el=doc.createElementNS(ns,'text');
    el.setAttribute('x',stroke.points[0][0]);el.setAttribute('y',stroke.points[0][1]);
    el.setAttribute('fill',stroke.color);el.setAttribute('font-size',stroke.width);
    el.setAttribute('font-family','system-ui,-apple-system,sans-serif');
    el.setAttribute('dominant-baseline','hanging');
    el.setAttribute('opacity',stroke.opacity??TOOLS.text.opacity);el.dataset.strokeId=stroke.id;
    el.setAttribute('font-weight',stroke.bold?'700':'400');
    el.setAttribute('xml:space','preserve');
    textLayout(stroke,measure).lines.forEach((line,index)=>{const span=doc.createElementNS(ns,'tspan');span.setAttribute('x',stroke.points[0][0]);span.setAttribute('y',stroke.points[0][1]+index*stroke.width*1.35);span.textContent=line||'\u00a0';el.append(span)});
    el.classList.toggle('canvas-ink-text-selected',selected);
    return el;
  }

  function create(options){
    const {viewport,world}=options;if(!viewport||!world)return null;
    const doc=viewport.ownerDocument,ns='http://www.w3.org/2000/svg';
    const layer=doc.createElementNS(ns,'svg');layer.classList.add('canvas-ink-layer');layer.setAttribute('aria-hidden','true');world.append(layer);
    const toolbar=doc.createElement('div');toolbar.className='canvas-ink-toolbar';toolbar.dataset.canvasUi='true';toolbar.setAttribute('role','group');toolbar.setAttribute('aria-label','画笔工具');
    toolbar.innerHTML='<div class="canvas-ink-tools"><button type="button" data-ink-tool="select" title="选择（Esc）" aria-label="选择"><svg viewBox="0 0 24 24" aria-hidden="true"><path d="M5 3l13.5 7.8-6.1 1.6-2.7 5.9z"/></svg></button><button type="button" data-ink-tool="pen" aria-label="画笔" title="画笔"><svg viewBox="0 0 24 24" aria-hidden="true"><path d="m15 4 5 5M4 20l5-1L20 8a2 2 0 0 0-5-5L4 14z"/></svg></button><button type="button" data-ink-tool="highlighter" aria-label="荧光笔" title="荧光笔"><svg viewBox="0 0 24 24" aria-hidden="true"><path d="m10 15 5 5 7-10-8-8-10 7 5 5M5 15l4 4-4 3-3-3zM2 23h16"/></svg></button><button type="button" data-ink-tool="text" aria-label="文字" title="文字"><svg viewBox="0 0 24 24" aria-hidden="true"><path d="M5 7V5h14v2M12 5v14M9 19h6"/></svg></button><button type="button" data-ink-tool="eraser" aria-label="橡皮擦" title="橡皮擦：拖动连续擦除整笔；双击此按钮清空全部笔迹，可撤销"><svg viewBox="0 0 24 24" aria-hidden="true"><path d="m14 3 7 7-11 11H6l-4-4zM8 11l7 7M10 21h12"/></svg></button><span class="canvas-ink-divider"></span><button type="button" data-ink-action="undo" aria-label="撤销笔迹" title="撤销笔迹（Ctrl/Command+Z）">↶</button><button type="button" data-ink-action="redo" aria-label="重做笔迹" title="重做笔迹（Ctrl/Command+Shift+Z）">↷</button><button type="button" data-ink-settings aria-label="笔迹设置" title="颜色、粗细和透明度" aria-expanded="false">⚙</button><span class="canvas-ink-divider"></span><button type="button" data-ink-close aria-label="关闭画笔工具" title="关闭画笔工具，返回选择"><svg viewBox="0 0 24 24" aria-hidden="true"><path d="m6 6 12 12M18 6 6 18"/></svg></button></div><div class="canvas-ink-colors" aria-label="笔迹颜色"></div><div class="canvas-ink-options" hidden><label class="canvas-ink-width">粗细 <input type="range" aria-label="笔迹粗细" step="1"><input type="number" data-ink-width-number aria-label="笔迹粗细数值" step="1"><output hidden></output></label><label class="canvas-ink-font" hidden>字号 <input type="number" min="6" max="288" step="1" aria-label="文字字号"></label><label class="canvas-ink-opacity">透明度 <input type="range" min="0" max="1" step="0.05" aria-label="笔迹透明度"><output data-ink-opacity-value></output></label><svg class="canvas-ink-preview" viewBox="0 0 180 52" aria-label="笔触预览"><path d="M 12 32 Q 45 10 80 26 T 168 24" fill="none" stroke-linecap="round"/></svg><small>Esc / 双击右键退出绘画 · 空格拖动平移</small></div>';
    (options.toolbarHost||viewport).append(toolbar);
    const panel=toolbar.querySelector('.canvas-ink-options'),range=toolbar.querySelector('input[type=range]'),preview=toolbar.querySelector('.canvas-ink-preview path');
    const prefs={pen:{...TOOLS.pen},highlighter:{...TOOLS.highlighter},text:{...TOOLS.text}};
    let opened=!options.trigger,settingsOpen=false,tool='select',active=null,frame=0,space=false,destroyed=false,suppressClickUntil=0,sequence=0;
    const listeners=[];
    let selectedId=null,textDrag=null,textResize=null,erasing=null;
    const selected=()=>getStrokes().find(item=>item.id===selectedId);
    const styleTool=()=>textSession?'text':tool==='select'?selected()?.tool:tool;
    const currentStyle=()=>{const name=styleTool(),selection=selected();return textSession?{...TOOLS.text,...textSession.style}:selection&&(tool==='select'||tool==='text')?{...TOOLS[name],...selection}:prefs[name]};
    const measure=doc.createElement('canvas').getContext('2d');
    const textLines=stroke=>textLayout(stroke,measure).lines;
    const textBox=stroke=>textLayout(stroke,measure);
    function renderTextHandles(stroke){
      const content=textBox(stroke),box={...content,x:content.x-8,y:content.y-4,width:content.width+16,height:content.height+8},group=doc.createElementNS(ns,'g');group.classList.add('canvas-ink-text-box');
      const scale=options.getViewport().scale||options.getViewport().zoom||1,size=14/scale;
      group.classList.toggle('is-interacting',!!textResize);
      const border=doc.createElementNS(ns,'rect');border.classList.add('canvas-ink-text-outline');for(const [key,value] of Object.entries({x:box.x,y:box.y,width:box.width,height:box.height,fill:'none',stroke:'#2563eb','stroke-width':1/scale,'stroke-dasharray':`${4/scale} ${3/scale}`}))border.setAttribute(key,value);group.append(border);
      const edge=border.cloneNode(false);edge.classList.remove('canvas-ink-text-outline');edge.dataset.inkTextMove=stroke.id;edge.setAttribute('stroke','transparent');edge.setAttribute('stroke-width',12/scale);edge.removeAttribute('stroke-dasharray');edge.style.pointerEvents='stroke';edge.style.cursor='grab';group.append(edge);
      for(const handle of ['nw','n','ne','e','se','s','sw','w']){
        const el=doc.createElementNS(ns,'rect');el.classList.add('canvas-ink-handle-hit');const x=box.x+(handle.includes('w')?0:handle.includes('e')?box.width:box.width/2),y=box.y+(handle.includes('n')?0:handle.includes('s')?box.height:box.height/2);el.dataset.inkResizeHandle=handle;el.dataset.textId=stroke.id;for(const [key,value] of Object.entries({x:x-size/2,y:y-size/2,width:size,height:size,fill:'transparent',stroke:'none'}))el.setAttribute(key,value);el.style.pointerEvents='all';el.style.cursor=handle+'-resize';group.append(el);
        const dot=doc.createElementNS(ns,'rect');dot.classList.add('canvas-ink-text-handle-dot');for(const [key,value] of Object.entries({x:x-4/scale,y:y-4/scale,width:8/scale,height:8/scale,rx:1/scale,'stroke-width':1.5/scale}))dot.setAttribute(key,value);group.append(dot);
      }
      layer.append(group);
    }
    const readonly=()=>!!options.isReadonly?.();
    const report=error=>options.onError?.(error?.message||String(error));
    const history=options.history||global.KGCanvasHistoryController?.create({onChange:refreshControls});
    const ownHistory=!options.history;
    const penIcon='<svg class="canvas-ink-entry-icon" viewBox="0 0 24 24" aria-hidden="true"><path d="m15 4 5 5M4 20l5-1L20 8a2 2 0 0 0-5-5L4 14z"/></svg>';
    const trigger=()=>typeof options.trigger==='function'?options.trigger():options.trigger;
    if(options.trigger)toolbar.classList.add('canvas-ink-popover');
    function positionToolbar(){
      if(options.trigger){
        if(!opened)return;
        // Keep the existing bottom-center dock, moving it above visible canvas
        // docks only when their actual rectangles overlap its controls.
        toolbar.style.bottom='';
        let box=toolbar.getBoundingClientRect(),bottom=parseFloat(global.getComputedStyle(toolbar).bottom)||0;
        const docks=[...viewport.querySelectorAll('.uc-minimap-dock,.canvas-zoom-dock,.lp-canvas-zoom-dock')].filter(el=>el.getClientRects().length&&global.getComputedStyle(el).visibility!=='hidden');
        for(const dock of docks){const r=dock.getBoundingClientRect();if(box.left<r.right&&box.right>r.left&&box.top<r.bottom&&box.bottom>r.top){bottom+=box.bottom-r.top+8;toolbar.style.bottom=Math.min(bottom,global.innerHeight-box.height-8)+'px';box=toolbar.getBoundingClientRect()}}
        panel.style.maxHeight=Math.max(40,box.top-16)+'px';panel.style.overflowY='auto';
        return;
      }
      if(!opened||!trigger())return;
      const rect=trigger().getBoundingClientRect(),box=toolbar.getBoundingClientRect(),settings=panel.hidden?null:panel.getBoundingClientRect();
      const left=Math.max(8,Math.min(options.placement==='right'?rect.right+8:rect.right-box.width,global.innerWidth-box.width-8));
      toolbar.style.left=left+'px';
      toolbar.style.top=Math.max(8,Math.min(options.placement==='right'?rect.top:rect.bottom+8,global.innerHeight-box.height-(settings?settings.height+8:0)-8))+'px';
      if(settings){panel.style.right='auto';panel.style.left=(Math.max(8,Math.min(left+box.width-settings.width,global.innerWidth-settings.width-8))-left)+'px'}
    }
    function setOpen(value){
      if(!value&&textSession){cancel();textSession.onSaved=()=>setOpen(false);closeTextEditor(true);return}
      opened=!!value;if(!opened){settingsOpen=false;space=false;viewport.classList.remove('canvas-ink-panning');setTool('select');options.onExitDraw?.()}else setTool('pen');
      options.onOpenChange?.(opened);refreshControls();positionToolbar();
    }

    const getStrokes=()=>options.getStrokes?.()||[];
    // 页面适配器可用 options.isInside 覆盖命中判定（如弹层画布内含 [data-stage-ui] 祖先时）。
    const defaultInside=target=>!target?.closest?.('.qw-analysis-panel,[data-canvas-ui],[data-stage-ui]')&&(target===viewport||world.contains(target)||(target?.parentElement===viewport&&target.classList.contains('qw-background')));
    const inside=target=>options.isInside?options.isInside(target):defaultInside(target);
    const stop=event=>{event.preventDefault();event.stopImmediatePropagation()};
    function listen(target,type,callback,config){target.addEventListener(type,callback,config);listeners.push(()=>target.removeEventListener(type,callback,config))}
    function makeEl(stroke){return svgStroke(stroke,doc,measure,{selected:stroke.id===selectedId})}
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
      if(destroyed||readonly()){cursorStyle.textContent='';return}
      const scope=`.canvas-ink-drawing:not(#kg-cursor-anchor):not(.canvas-ink-panning)[data-ink-tool='${tool}']`;
      const dragging='.canvas-ink-text-dragging:not(#kg-cursor-anchor):not(.canvas-ink-panning)[data-ink-tool]';
      const art=cursorArt(tool,TOOLS[tool]?prefs[tool].color:'#1e293b');
      // :not(#kg-cursor-anchor) 抬高特异性到 (1,3,1)，压过 custom-cursor.css 的 crosshair (1,2,1)!important
      cursorStyle.textContent=(CURSOR_HOTSPOT[tool]?`${scope}{cursor:url("data:image/svg+xml,${encodeURIComponent(art)}") ${CURSOR_HOTSPOT[tool]}, crosshair!important}${scope} :where(:not([data-ink-resize-handle],[data-ink-text-move],[data-ink-edit-drag],.canvas-ink-text-editor)){cursor:inherit!important}`:'')+`${dragging},${dragging} *{cursor:grabbing!important}`;
    }
    function refreshControls(){
      if(destroyed)return;
      const locked=readonly(),state=history?.getState?.()||{};
      if(locked)stopEraserHold();
      // 只读（切题过渡/访客）不再把工具强制降回 select：工具选择保留，绘制入口由
      // pointerdown 的 readonly 拦截兜底，按钮 disabled + 光标还原表达锁定；
      // 只读解除后工具与自定义光标自动恢复（切题保持画笔状态的前提）。
      toolbar.querySelectorAll('[data-ink-tool]').forEach(btn=>{btn.setAttribute('aria-pressed',String(btn.dataset.inkTool===tool));btn.disabled=locked&&btn.dataset.inkTool!=='select'});
      for(const action of ['undo','redo']){const btn=toolbar.querySelector('[data-ink-action='+action+']');btn.hidden=!(ownHistory||options.showHistory);btn.disabled=locked||!state[action==='undo'?'canUndo':'canRedo']}
      toolbar.hidden=!opened;
      const launch=trigger();if(launch){if(!launch.querySelector('svg'))launch.innerHTML=penIcon;launch.classList.add('canvas-ink-entry');launch.setAttribute('aria-expanded',String(opened));launch.disabled=locked;const tip=locked?'当前画布只读，无法使用画笔':opened?'收起画笔工具并退出绘画':'展开画笔工具，在画布上书写或标注';if(launch.hasAttribute('data-tooltip')){launch.dataset.tooltip=tip;launch.removeAttribute('title')}else launch.title=tip;launch.querySelector('svg')?.style.setProperty('color',prefs[TOOLS[tool]?tool:'pen'].color)}
      for(const name of Object.keys(prefs)){const btn=toolbar.querySelector('button[data-ink-tool='+name+']');btn.querySelector('svg')?.style.setProperty('color',prefs[name].color);btn.title=(name==='pen'?'画笔：拖动绘制笔迹':name==='highlighter'?'荧光笔：拖动高亮标注':'文字：点击空白插入，单击选择并拖动文字，双击编辑')+(name==='text'?'；单击显示颜色、字号与加粗':'；点击设置调整粗细和透明度')}
      const currentTool=styleTool(),pref=currentStyle();
      panel.hidden=!settingsOpen||!pref;
      toolbar.querySelector('[data-ink-settings]').disabled=locked||!pref;toolbar.querySelector('[data-ink-settings]').setAttribute('aria-expanded',String(!panel.hidden));
      toolbar.querySelectorAll('.canvas-ink-colors input,.canvas-ink-colors button').forEach(input=>input.disabled=locked||!pref);
      toolbar.querySelector('.canvas-ink-font').hidden=currentTool!=='text';
      toolbar.querySelector('[data-ink-bold]').hidden=currentTool!=='text';toolbar.querySelector('[data-ink-bold]').disabled=locked;toolbar.querySelector('[data-ink-bold]').setAttribute('aria-pressed',String(!!pref?.bold));
      panel.querySelectorAll('input,button').forEach(input=>input.disabled=locked);range.setAttribute('aria-label',currentTool==='text'?'文字字号滑块':'笔迹粗细');
      toolbar.querySelector('.canvas-ink-width').hidden=currentTool==='text';
      const eraserBtn=toolbar.querySelector('button[data-ink-tool=eraser]');
      if(eraserBtn)eraserBtn.title='橡皮擦：拖动连续擦除整笔；双击此按钮清空当前题全部笔迹，可撤销'+(typeof options.onLongPressEraser==='function'?'；长按 3 秒清空整套试卷笔迹（需确认）':'');
      toolbar.querySelector('.canvas-ink-preview').style.display=currentTool==='text'?'none':'';
      if(pref){
        toolbar.querySelector('.canvas-ink-font input').value=pref.width;
        const widthNumber=toolbar.querySelector('[data-ink-width-number]');widthNumber.min=pref.min;widthNumber.max=pref.max;widthNumber.value=pref.width;
        toolbar.querySelector('.canvas-ink-opacity input').value=pref.opacity??TOOLS[currentTool].opacity;
        toolbar.querySelector('[data-ink-opacity-value]').textContent=Math.round((pref.opacity??TOOLS[currentTool].opacity)*100)+'%';
        range.min=pref.min;range.max=pref.max;range.value=pref.width;toolbar.querySelector('output').textContent=pref.width;
        toolbar.querySelector('input[type=color]').value=pref.color;
        toolbar.querySelectorAll('[data-ink-color]').forEach(btn=>btn.setAttribute('aria-pressed',String(btn.dataset.inkColor===pref.color)));
        preview.setAttribute('stroke',pref.color);preview.setAttribute('stroke-width',pref.width);preview.setAttribute('opacity',pref.opacity??TOOLS[currentTool].opacity);
      }
      updateCursor();
      positionToolbar();
    }
    function strokeStateSignature(){return JSON.stringify(normalize(getStrokes()))}
    function cancelStaleGesture(){
      const gesture=erasing||textDrag||textResize;
      if(!gesture||gesture.beforeSignature===strokeStateSignature())return false;
      cancel();return true;
    }
    function render(){
      if(destroyed||cancelStaleGesture())return;
      try{const strokes=normalize(getStrokes()).filter(item=>!erasing?.removed.has(item.id));layer.replaceChildren(...strokes.map(makeEl));const selection=strokes.find(item=>item.id===selectedId);if(selection&&!readonly()){if(selection.tool==='text')renderTextHandles(selection);else renderStrokeSelection(selection)}if(active){active.el=makeEl(active.stroke);layer.append(active.el)}}catch(error){report(error)}
      textSession?.relocate();refreshControls();
    }
    function strokeElement(id){return [...layer.querySelectorAll('[data-stroke-id]')].find(el=>el.dataset.strokeId===id)}
    function renderStrokeSelection(stroke){
      const el=strokeElement(stroke.id);if(!el)return;
      const box=el.getBBox(),border=doc.createElementNS(ns,'rect'),scale=options.getViewport().scale||options.getViewport().zoom||1,pad=(stroke.width/2)+4/scale;
      border.classList.add('canvas-ink-stroke-selection');for(const [key,value] of Object.entries({x:box.x-pad,y:box.y-pad,width:box.width+pad*2,height:box.height+pad*2,fill:'none',stroke:'#2563eb','stroke-width':1/scale,'stroke-dasharray':(4/scale)+' '+(3/scale)}))border.setAttribute(key,value);layer.append(border);
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
      stopEraserHold();
      if(erasing){const id=erasing.pointerId;erasing=null;try{if(viewport.hasPointerCapture(id))viewport.releasePointerCapture(id)}catch(_){};render()}
      if(textSession?.drag){const drag=textSession.drag;textSession.drag=null;textSession.border.classList.remove('is-dragging');textSession.world.splice(0,2,...drag.world);textSession.relocate();try{drag.target.releasePointerCapture(drag.pointerId)}catch(_){};}
      if(textResize){const id=textResize.pointerId;textResize=null;try{viewport.releasePointerCapture(id)}catch(_){};render()}
      if(textDrag){const id=textDrag.pointerId;textDrag=null;viewport.classList.remove('canvas-ink-text-dragging');try{if(viewport.hasPointerCapture(id))viewport.releasePointerCapture(id)}catch(_){};render()}
      if(frame){global.cancelAnimationFrame(frame);frame=0}
      if(!active)return;
      const id=active.pointerId;active.el.remove();active=null;
      try{if(viewport.hasPointerCapture(id))viewport.releasePointerCapture(id)}catch(_){}
    }
    function setTool(value){
      cancel();
      // Keep the latest tool request on the draft until IME and persistence finish.
      if(textSession){textSession.onSaved=value!==tool?()=>setTool(value):null;if(value!==tool){closeTextEditor(true);return;}}
      if(value!=='select'&&(value!=='text'||selected()?.tool!=='text'))selectedId=null;if(!TOOLS[value])settingsOpen=false;tool=(TOOLS[value]||value==='eraser')&&!readonly()?value:'select';
      viewport.classList.toggle('canvas-ink-drawing',tool!=='select');viewport.dataset.inkTool=tool;
      if(tool!=='select')options.onDrawMode?.();
      render();
      refreshControls();
    }
    const bold=doc.createElement('button');bold.type='button';bold.dataset.inkBold='true';bold.textContent='B';bold.setAttribute('aria-label','文字加粗');panel.insertBefore(bold,toolbar.querySelector('.canvas-ink-preview'));
    function updateTextStyle(patch){
      if(readonly())return;
      cancel();const current=styleTool();if(!prefs[current])return;
      Object.assign(prefs[current],patch);
      const selection=selected();
      if(selection&&(tool==='text'||tool==='select')&&!textSession){try{change(getStrokes().map(item=>item.id===selection.id?{...item,...patch}:item),'笔迹格式')}catch(error){report(error)}}
      if(textSession){Object.assign(textSession.style,patch);textSession.editor.style.color=textSession.style.color;textSession.editor.style.fontWeight=textSession.style.bold?'700':'400';textSession.editor.style.fontSize=textSession.style.width*(options.getViewport().scale||options.getViewport().zoom||1)+'px';textSession.editor.dispatchEvent(new global.Event('input'))}
      refreshControls();
    }
    bold.addEventListener('click',()=>updateTextStyle({bold:!currentStyle()?.bold}));
    const palette=toolbar.querySelector('.canvas-ink-colors');
    toolbar.querySelector('.canvas-ink-tools').insertBefore(palette,toolbar.querySelector('[data-ink-settings]'));
    for(const [color,name] of [['#2563eb','蓝色'],['#111827','黑色'],['#ef4444','红色'],['#facc15','黄色'],['#22c55e','绿色'],['#a855f7','紫色']]){
      const btn=doc.createElement('button');btn.type='button';btn.dataset.inkColor=color;btn.style.setProperty('--ink-color',color);btn.setAttribute('aria-label',name);btn.title=name;palette.append(btn);
      btn.addEventListener('click',()=>updateTextStyle({color}));
    }
    const color=doc.createElement('input');color.type='color';color.setAttribute('aria-label','自定义笔迹颜色');color.title='自定义颜色';palette.append(color);
    color.addEventListener('input',()=>updateTextStyle({color:color.value}));
    range.addEventListener('input',()=>updateTextStyle({width:Number(range.value)}));
    toolbar.querySelector('.canvas-ink-font input').addEventListener('change',event=>{const value=Number(event.target.value);if(event.target.value&&Number.isFinite(value)&&value>=6&&value<=288)updateTextStyle({width:value});else refreshControls()});
    toolbar.querySelector('[data-ink-width-number]').addEventListener('change',event=>{const value=Number(event.target.value),limits=TOOLS[styleTool()];if(event.target.value&&limits&&Number.isFinite(value)&&value>=limits.min&&value<=limits.max)updateTextStyle({width:value});else refreshControls()});
    toolbar.querySelector('.canvas-ink-opacity input').addEventListener('input',event=>updateTextStyle({opacity:Number(event.target.value)}));
    toolbar.querySelector('[data-ink-settings]').addEventListener('click',()=>{settingsOpen=!settingsOpen;refreshControls()});
    // 文字格式单击可见；所有工具均可通过设置按钮打开参数，双击仍兼容。
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
    listen(toolbar.querySelector('[data-ink-close]'),'click',()=>setOpen(false));
    listen(toolbar,'pointerdown',event=>event.stopPropagation());
    listen(toolbar,'wheel',event=>event.stopPropagation());
    // 文字工具：单击选择，拖动移动，双击编辑；Enter 换行，Ctrl/⌘+Enter 保存。
    let textSession=null;
    async function closeTextEditor(commit){
      const session=textSession;if(!session)return true;
      if(commit&&session.closing)return session.closing;
      const close=async()=>{
        if(commit){
          if(session.composing){session.deferredCommit=true;return false}
          session.resize();const draft={text:session.editor.value.slice(0,TEXT_LIMIT),...session.style,points:[[...session.world]]};
          if(JSON.stringify(draft)!==JSON.stringify(session.edit.state().draft))session.edit.update(draft);
          session.editor.dataset.saveState='committing';
          const success=await session.edit.commit();
          if(textSession!==session)return false;
          session.editor.dataset.saveState=session.edit.state().status;
          if(!success){session.onSaved=null;if(session.edit.state().status==='failed'){session.status.textContent='文字未保存，请点击外部重试';report(session.edit.state().error)}return false}
        }else{session.edit.cancel();if(session.applied&&!session.stale){options.setStrokes?options.setStrokes(session.before):options.change(session.before,'取消文字修改');render()}}
        const onSaved=commit?session.onSaved:null;
        textSession=null;session.unmount.forEach(dispose=>dispose());session.frame.remove();session.status.remove();session.border.remove();refreshControls();onSaved?.();return true;
      };
      if(!commit)return close();
      session.closing=close();
      try{return await session.closing}finally{session.closing=null}
    }
    function openTextEditor(clientX,clientY,existing){
      if(textSession){closeTextEditor(true);return}
      const view=options.getViewport(),rect=viewport.getBoundingClientRect(),scale=view.scale||view.zoom||1;
      const world=existing?[...existing.points[0]]:point({clientX,clientY},rect,view);
      const box=existing?textBox(existing):{width:40,height:24};
      const style={color:existing?existing.color:prefs.text.color,width:existing?existing.width:prefs.text.width,bold:!!(existing?existing.bold:prefs.text.bold),opacity:existing?(existing.opacity??1):prefs.text.opacity,...(existing?.boxWidth?{boxWidth:existing.boxWidth}:{}),boxHeight:Math.max(24,box.height)};
      const editor=doc.createElement('textarea');
      const editorFrame=doc.createElement('div');editorFrame.className='canvas-ink-text-editor-viewport';editorFrame.dataset.canvasUi='true';editorFrame.append(editor);
      editor.className='canvas-ink-text-editor';editor.rows=1;editor.maxLength=TEXT_LIMIT;editor.placeholder='点击外部保存 · Enter 换行 · Esc 取消';editor.setAttribute('aria-label','画布文字内容');editor.value=existing?existing.text:'';
      editor.style.position='relative';editor.style.left='0';editor.style.top='0';editor.style.width=box.width*scale+'px';
      editor.style.fontSize=style.width*scale+'px';editor.style.color=style.color;editor.style.fontWeight=style.bold?'700':'400';
      const status=doc.createElement('div');status.className='canvas-ink-text-status';status.dataset.canvasUi='true';status.setAttribute('role','status');
      const border=doc.createElement('div');border.className='canvas-ink-text-edit-border';border.dataset.canvasUi='true';border.setAttribute('aria-hidden','true');
      for(const side of ['top','right','bottom','left']){const edge=doc.createElement('div');edge.dataset.inkEditDrag=side;border.append(edge)}
      for(const side of ['nw','n','ne','e','se','s','sw','w']){const dot=doc.createElement('span');dot.className='canvas-ink-text-edit-point';dot.dataset.inkEditPoint=side;dot.dataset.inkEditDrag='point';border.append(dot)}
      const overlayHost=options.overlayHost||doc.body;overlayHost.append(editorFrame,status,border);
      const before=normalize(getStrokes()),id=existing?.id||'ink-'+Date.now().toString(36)+'-'+(++sequence)+'-'+Math.random().toString(36).slice(2,8);
      const session={editor,frame:editorFrame,status,border,existing,world,style,before,unmount:[],applied:false,composing:false};textSession=session;
      session.edit=global.KGTextEditSession.create({original:{text:editor.value,...style,points:[[...world]]},persist:async draft=>{
        if(session.stale)throw new Error('画布已切换，文字草稿仍保留，请复制输入或按 Esc 关闭');
        if(!existing&&!draft.text.trim())return true;
        const stroke={id,tool:'text',...draft};stroke.boxHeight=Math.min(4000,Math.max(draft.boxHeight||24,textLines(stroke).length*stroke.width*1.35));
        const signature=JSON.stringify(stroke);
        if(signature!==session.appliedSignature){change(existing||session.applied?getStrokes().map(item=>item.id===id?stroke:item):[...getStrokes(),stroke],existing?'编辑文字':'添加文字');session.applied=true;session.appliedSignature=signature}
        return options.persistText?await options.persistText():true;
      }});
      function revealCaret(){
        const s=options.getViewport().scale||options.getViewport().zoom||1,layout=textBox({text:editor.value.slice(0,editor.selectionStart),...style,boxHeight:24,points:[[...world]]});
        const x=(8+measure.measureText(layout.lines.at(-1)||'').width)*s,y=(4+(layout.lines.length-1)*style.width*1.35)*s,line=style.width*1.35*s;
        if(x>editorFrame.scrollLeft+editorFrame.clientWidth-12)editorFrame.scrollLeft=x-editorFrame.clientWidth+12;
        else if(x<editorFrame.scrollLeft+8)editorFrame.scrollLeft=Math.max(0,x-8);
        if(y+line>editorFrame.scrollTop+editorFrame.clientHeight)editorFrame.scrollTop=y+line-editorFrame.clientHeight;
        else if(y<editorFrame.scrollTop)editorFrame.scrollTop=y;
      }
      const resize=()=>{
        const v=options.getViewport(),s=v.scale||v.zoom||1,natural=textBox({text:editor.value,...style,boxHeight:24,points:[[...world]]});
        style.boxHeight=Math.min(4000,natural.height);
        const r=viewport.getBoundingClientRect();
        editor.style.boxSizing='content-box';editor.style.padding=(4*s)+'px '+(8*s)+'px';
        editor.style.width=natural.width*s+'px';editor.style.fontSize=style.width*s+'px';editor.style.opacity=style.opacity;
        // Match the character wrapping used by SVG/export, and measure the live
        // textarea too so browser line metrics never clip the editable draft.
        editor.style.whiteSpace=style.boxWidth?'pre-wrap':'pre';
        editor.style.height='0px';const placeholder=editor.placeholder;editor.placeholder='';
        const css=global.getComputedStyle(editor),padding=parseFloat(css.paddingTop)+parseFloat(css.paddingBottom);
        style.boxHeight=Math.min(4000,Math.max(style.boxHeight,(editor.scrollHeight-padding)/s));editor.placeholder=placeholder;
        editor.style.height=Math.max(natural.height,style.boxHeight)*s+'px';
        // Clip only the live presentation. The textarea retains its natural
        // width, explicit wrapping and world geometry inside this scroll frame.
        const width=Math.min(editor.offsetWidth,Math.max(1,global.innerWidth-16)),height=Math.min(editor.offsetHeight,Math.max(1,global.innerHeight-16));
        const left=Math.max(8,Math.min(r.left+v.x+(world[0]-8)*s,global.innerWidth-width-8)),top=Math.max(8,Math.min(r.top+v.y+(world[1]-4)*s,global.innerHeight-height-8));
        Object.assign(editorFrame.style,{left:left+'px',top:top+'px',width:width+'px',height:height+'px'});
        status.style.left=left+'px';status.style.top=Math.min(global.innerHeight-status.offsetHeight-8,top+height+4)+'px';
        Object.assign(border.style,{left:left+'px',top:top+'px',width:width+'px',height:height+'px'});
        if(doc.activeElement===editor)revealCaret();
      };
      const relocate=()=>resize();
      session.resize=resize;session.relocate=relocate;
      const updateDraft=()=>{resize();session.edit.update({text:editor.value,...style,points:[[...world]]});editor.dataset.saveState='draft';status.textContent=''};
      border.addEventListener('pointerdown',event=>{
        if(event.button!==0||readonly()||session.stale)return;stop(event);
        session.drag={pointerId:event.pointerId,target:event.target,x:event.clientX,y:event.clientY,world:[...world]};event.target.setPointerCapture(event.pointerId);
        border.classList.add('is-dragging');
      });
      const move=event=>{const drag=session.drag;if(!drag||event.pointerId!==drag.pointerId)return;stop(event);if(readonly()){cancel();return}const v=options.getViewport(),s=v.scale||v.zoom||1;world.splice(0,2,drag.world[0]+(event.clientX-drag.x)/s,drag.world[1]+(event.clientY-drag.y)/s);relocate();updateDraft()};
      const end=event=>{const drag=session.drag;if(!drag||event.pointerId!==drag.pointerId)return;stop(event);if(event.type!=='pointerup'){cancel();updateDraft();return}session.drag=null;border.classList.remove('is-dragging');drag.target.releasePointerCapture(drag.pointerId)};
      for(const [type,handler] of [['pointermove',move],['pointerup',end],['pointercancel',end],['lostpointercapture',end]]){border.addEventListener(type,handler);session.unmount.push(()=>border.removeEventListener(type,handler))}
      editorFrame.addEventListener('wheel',event=>event.stopPropagation(),{passive:true});
      if(global.KGCanvasDomInteraction&&!options.overlayHost){session.unmount.push(global.KGCanvasDomInteraction.mountOverlay(editorFrame,doc.body,relocate),global.KGCanvasDomInteraction.mountOverlay(status,doc.body),global.KGCanvasDomInteraction.mountOverlay(border,doc.body))}
      else{doc.addEventListener('fullscreenchange',relocate);session.unmount.push(()=>doc.removeEventListener('fullscreenchange',relocate))}
      editor.addEventListener('compositionstart',()=>{session.composing=true;session.edit.setComposing(true)});
      editor.addEventListener('compositionend',()=>{session.composing=false;session.edit.setComposing(false);if(session.deferredCommit){session.deferredCommit=false;closeTextEditor(true)}});
      editor.addEventListener('keydown',event=>{event.stopPropagation();if(event.isComposing||event.keyCode===229)return;if(event.key==='Enter'&&(event.ctrlKey||event.metaKey)){event.preventDefault();closeTextEditor(true)}else if(event.key==='Escape'){event.preventDefault();closeTextEditor(false)}});
      editor.addEventListener('input',updateDraft);
      editor.addEventListener('keyup',revealCaret);editor.addEventListener('select',revealCaret);
      editor.addEventListener('blur',event=>{if(toolbar.contains(event.relatedTarget))return;global.setTimeout(()=>{if(textSession===session&&!toolbar.contains(doc.activeElement))closeTextEditor(true)},160)});
      editor.focus();resize();refreshControls();
    }
    listen(global,'pointerdown',event=>{if(!textSession||textSession.frame.contains(event.target)||textSession.border.contains(event.target)||toolbar.contains(event.target))return;closeTextEditor(true);},true);
    function hitStroke(location,padding,textOnly=false){
      const target=new global.DOMPoint(...location),byId=new Map(getStrokes().map(stroke=>[stroke.id,stroke]));
      for(const el of [...layer.querySelectorAll('[data-stroke-id]')].reverse()){
        const stroke=byId.get(el.dataset.strokeId);if(!stroke||(textOnly&&stroke.tool!=='text'))continue;
        if(stroke.tool==='text'){const box=textBox(stroke);if(location[0]>=box.x-padding&&location[0]<=box.x+box.width+padding&&location[1]>=box.y-padding&&location[1]<=box.y+box.height+padding)return stroke;continue}
        const box=el.getBBox(),radius=stroke.width/2+padding;if(location[0]<box.x-radius||location[0]>box.x+box.width+radius||location[1]<box.y-radius||location[1]>box.y+box.height+radius)continue;
        const width=el.getAttribute('stroke-width');let hit=false;
        try{el.setAttribute('stroke-width',Number(width)+padding*2);hit=el.isPointInStroke(target)}finally{el.setAttribute('stroke-width',width)}
        if(hit)return stroke;
      }return null;
    }
    function eraseTo(event){
      const next=point(event,viewport.getBoundingClientRect(),options.getViewport());if(next.some(n=>!Number.isFinite(n)||Math.abs(n)>LIMITS.coordinate))return;
      const scale=options.getViewport().scale||options.getViewport().zoom||1,padding=8/scale,from=erasing.last,steps=Math.max(1,Math.ceil(Math.hypot(next[0]-from[0],next[1]-from[1])/(padding/2)));
      for(let i=0;i<=steps;i++){const location=[from[0]+(next[0]-from[0])*i/steps,from[1]+(next[1]-from[1])*i/steps];let hit;while((hit=hitStroke(location,padding))){erasing.removed.add(hit.id);strokeElement(hit.id).remove()}}
      erasing.last=next;
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
      if(textSession||destroyed||space||event.button!==0||event.isPrimary===false)return;
      const handle=event.target.closest?.('[data-ink-resize-handle]');if(handle&&layer.contains(handle)&&!readonly()){stop(event);const stroke=getStrokes().find(item=>item.id===handle.dataset.textId);textResize={beforeSignature:strokeStateSignature(),pointerId:event.pointerId,handle:handle.dataset.inkResizeHandle,start:point(event,viewport.getBoundingClientRect(),options.getViewport()),original:normalize([stroke])[0],box:textBox(stroke)};viewport.setPointerCapture(event.pointerId);return}
      if(destroyed||active||erasing||textDrag||textResize||space||readonly()||event.button!==0||event.isPrimary===false||!inside(event.target))return;
      const view=options.getViewport(),location=point(event,viewport.getBoundingClientRect(),view);
      // In selection mode, annotations must not steal the card's native controls.
      const control=tool==='select'&&event.target.closest?.('button,a,input,select,textarea,[contenteditable],[role=button]');
      const edge=event.target.closest?.('[data-ink-text-move]');
      const textHit=!control&&(tool==='select'||tool==='text')?(edge&&layer.contains(edge)?getStrokes().find(item=>item.id===edge.dataset.inkTextMove):hitStroke(location,4/(view.scale||view.zoom||1),tool==='text')):null;
      if(tool==='select'&&!textHit){selectedId=null;suppressClickUntil=0;render();return}
      stop(event);
      try{
        if(textHit){if(!viewport.hasAttribute('tabindex'))viewport.tabIndex=-1;viewport.focus({preventScroll:true});selectedId=textHit.id;Object.assign(prefs[textHit.tool],{color:textHit.color,width:textHit.width,bold:!!textHit.bold,opacity:textHit.opacity??TOOLS[textHit.tool].opacity});textDrag={beforeSignature:strokeStateSignature(),pointerId:event.pointerId,start:location,original:normalize([textHit])[0],moved:false};render();viewport.classList.add('canvas-ink-text-dragging');viewport.setPointerCapture(event.pointerId);return}
        if(tool==='eraser'){
          selectedId=null;erasing={beforeSignature:strokeStateSignature(),pointerId:event.pointerId,before:normalize(getStrokes()),removed:new Set(),last:location};
          eraseTo(event);viewport.setPointerCapture(event.pointerId);suppressClickUntil=Date.now()+400;return;
        }
        if(tool==='text'){
          const view=options.getViewport(),location=point(event,viewport.getBoundingClientRect(),view);
          selectedId=null;openTextEditor(event.clientX,event.clientY,null);
          suppressClickUntil=Date.now()+400;return;
        }
        const strokes=normalize(getStrokes()),remaining=LIMITS.total-strokes.reduce((sum,s)=>sum+s.points.length,0);
        if(strokes.length>=LIMITS.strokes||remaining<1)throw new Error('当前画布笔迹已达上限，请清理部分笔迹后继续');
        const pref=prefs[tool],stroke={id:'ink-'+Date.now().toString(36)+'-'+(++sequence)+'-'+Math.random().toString(36).slice(2,8),tool,color:pref.color,width:pref.width,opacity:pref.opacity,points:[]};
        active={pointerId:event.pointerId,stroke,el:makeEl(stroke),pointLimit:Math.min(remaining,LIMITS.points)};
        addPoint(event);layer.append(active.el);active.el.setAttribute('d',path(stroke.points));viewport.setPointerCapture(event.pointerId);
      }catch(error){cancel();report(error)}
    },true);
    listen(global,'pointermove',event=>{
      if(cancelStaleGesture())return;
      if(erasing&&event.pointerId===erasing.pointerId){stop(event);if(readonly()){cancel();return}for(const sample of event.getCoalescedEvents?.().length?event.getCoalescedEvents():[event])eraseTo(sample);return}
      if(textResize&&event.pointerId===textResize.pointerId){stop(event);if(readonly()){cancel();return}const current=point(event,viewport.getBoundingClientRect(),options.getViewport()),drag=textResize,next=global.KGTextBoxGeometry.resize(drag.box,drag.handle,{x:current[0]-drag.start[0],y:current[1]-drag.start[1]});const natural=textBox({...drag.original,points:[[next.x,next.y]],width:next.fontSize,boxWidth:next.width,boxHeight:next.height});const clamped=global.KGTextBoxGeometry.clampToTextBounds(next,natural);drag.next={...drag.original,points:[[clamped.x,clamped.y]],width:clamped.fontSize,boxWidth:clamped.width,boxHeight:clamped.height};drag.next.boxHeight=Math.min(4000,Math.max(clamped.height,textLines(drag.next).length*clamped.fontSize*1.35));layer.replaceChildren(...getStrokes().map(item=>makeEl(item.id===drag.original.id?drag.next:item)));renderTextHandles(drag.next);return}
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
      if(cancelStaleGesture())return;
      if(erasing&&event.pointerId===erasing.pointerId){stop(event);if(readonly()){cancel();return}eraseTo(event);const gesture=erasing;cancel();suppressClickUntil=Date.now()+400;if(gesture.removed.size)try{change(gesture.before.filter(item=>!gesture.removed.has(item.id)),'擦除笔迹')}catch(error){render();report(error)}return}
      if(textResize&&event.pointerId===textResize.pointerId){stop(event);if(readonly()){cancel();return}const drag=textResize;cancel();if(drag.next&&JSON.stringify(drag.next)!==JSON.stringify(drag.original))try{change(getStrokes().map(item=>item.id===drag.original.id?drag.next:item),'调整文本框大小');Promise.resolve(options.persistText?.()).catch(report)}catch(error){report(error)}return}
      if(textDrag&&event.pointerId===textDrag.pointerId){stop(event);const drag=textDrag;cancel();suppressClickUntil=Date.now()+400;if(drag.moved&&drag.next)try{change(getStrokes().map(item=>item.id===drag.original.id?drag.next:item),drag.original.tool==='text'?'移动文字':'移动笔迹')}catch(error){render();report(error)}return}
      if(!active||event.pointerId!==active.pointerId)return;stop(event);addPoint(event);
      const {stroke,limited}=active;cancel();suppressClickUntil=Date.now()+400;
      try{if(stroke.points.length)change([...getStrokes(),stroke],stroke.tool==='pen'?'画笔':'荧光笔');if(limited)report(new Error('此笔已达长度上限，请抬笔后继续绘制'))}catch(error){render();report(error)}
    },true);
    listen(global,'pointercancel',event=>{if((erasing&&event.pointerId===erasing.pointerId)||(textResize&&event.pointerId===textResize.pointerId)||(active&&event.pointerId===active.pointerId)||(textDrag&&event.pointerId===textDrag.pointerId)){cancel();stop(event)}},true);
    listen(viewport,'lostpointercapture',event=>{if((erasing&&event.pointerId===erasing.pointerId)||(textResize&&event.pointerId===textResize.pointerId)||(active&&event.pointerId===active.pointerId)||(textDrag&&event.pointerId===textDrag.pointerId))cancel()});
    listen(global,'dblclick',event=>{if(readonly()||space||!inside(event.target)||(tool!=='select'&&tool!=='text'))return;const view=options.getViewport(),hit=hitStroke(point(event,viewport.getBoundingClientRect(),view),4/(view.scale||view.zoom||1),true);if(hit){stop(event);selectedId=hit.id;openTextEditor(event.clientX,event.clientY,hit)}},true);
    listen(global,'click',event=>{if(inside(event.target)&&(Date.now()<suppressClickUntil||(tool!=='select'&&!space)))stop(event)},true);
    function handleKeyDown(event){
      if(destroyed)return false;
      if(global.KGCanvasDomInteraction?.isEditingTarget(event)||event.target?.closest?.('input,textarea,[contenteditable]'))return false;
      if((event.key==='Delete'||event.key==='Backspace')&&selected()&&!readonly()){stop(event);cancel();const id=selectedId;selectedId=null;try{change(getStrokes().filter(item=>item.id!==id),'删除笔迹')}catch(error){report(error)}return true}
      if(event.key==='Escape'){if(textResize){cancel();return true}setTool('select');return true}
      if(event.code==='Space'&&tool!=='select'){space=true;cancel();viewport.classList.add('canvas-ink-panning');event.preventDefault();return true}
      if((event.ctrlKey||event.metaKey)&&!event.altKey&&['z','y'].includes(event.key.toLowerCase())){
        // Delegated page history must first cancel the same transient gesture.
        cancel();
        if(ownHistory&&!readonly()&&event.key.toLowerCase()==='z'){stop(event);try{history?.[event.shiftKey?'redo':'undo']?.();refreshControls()}catch(error){report(error)}return true}
      }
      return false;
    }
    listen(global,'keydown',handleKeyDown,true);
    listen(global,'keyup',event=>{if(event.code==='Space'){space=false;viewport.classList.remove('canvas-ink-panning')}},true);
    listen(global,'resize',()=>{cancel();textSession?.relocate();positionToolbar()});
    listen(doc,'click',()=>{if(opened)global.requestAnimationFrame(()=>{if(!destroyed)positionToolbar()})});
    listen(doc,'scroll',()=>{cancel();positionToolbar()},true);
    listen(global,'blur',()=>{cancel();space=false;viewport.classList.remove('canvas-ink-panning')});
    // Cancel instead of mixing coordinate systems if zoom changes mid-stroke.
    listen(global,'wheel',event=>{if((active||erasing||textDrag||textResize)&&viewport.contains(event.target))cancel()},true);
    listen(global,'wheel',event=>{if(textSession&&viewport.contains(event.target))global.requestAnimationFrame(()=>textSession?.relocate())},{passive:true});
    // 画笔状态下双击右键退出绘画；单击右键仅屏蔽菜单（右键拖动平移不受影响）。
    let lastRightPress={t:0,x:0,y:0},suppressContextMenuUntil=0;
    const resetRightPress=()=>{lastRightPress={t:0,x:0,y:0}};
    listen(doc,'contextmenu',event=>{
      if(destroyed||tool==='select'||space)return;
      if(!viewport.contains(event.target)||!inside(event.target))return;
      stop(event);
    },true);
    listen(doc,'contextmenu',event=>{
      // 双击右键退出的第二次点击：tool 已切回 select，仍需拦下浏览器菜单。
      if(!destroyed&&Date.now()<suppressContextMenuUntil&&viewport.contains(event.target)&&inside(event.target))stop(event);
    },true);
    listen(global,'pointerdown',event=>{
      if(destroyed||event.button!==2||tool==='select'||space)return;
      if(!viewport.contains(event.target)||!inside(event.target)){resetRightPress();return}
      const now=Date.now();
      if(now-lastRightPress.t<=400&&Math.hypot(event.clientX-lastRightPress.x,event.clientY-lastRightPress.y)<=24){
        resetRightPress();
        suppressContextMenuUntil=now+400;
        stop(event);
        setTool('select');
        options.onExitDraw?.();
        return;
      }
      lastRightPress={t:now,x:event.clientX,y:event.clientY};
    },true);
    listen(global,'pointermove',event=>{
      // 右键按住拖动（平移）超过阈值即取消双击判定，避免平移被误判为第二次右击。
      if(!lastRightPress.t||(event.buttons&2)!==2)return;
      if(Math.hypot(event.clientX-lastRightPress.x,event.clientY-lastRightPress.y)>24)resetRightPress();
    },true);
    // 橡皮擦长按 3 秒：由页面回调实现整套试卷笔迹清空（含确认）。
    let eraserHoldTimer=0;
    const eraserHoldBtn=toolbar.querySelector('[data-ink-tool=eraser]');
    const stopEraserHold=()=>{if(eraserHoldTimer){global.clearTimeout(eraserHoldTimer);eraserHoldTimer=0}eraserHoldBtn?.classList.remove('canvas-ink-holding')};
    listen(eraserHoldBtn,'pointerdown',event=>{
      if(event.button!==0||typeof options.onLongPressEraser!=='function')return;
      stopEraserHold();
      eraserHoldBtn.classList.add('canvas-ink-holding');
      eraserHoldTimer=global.setTimeout(()=>{eraserHoldTimer=0;stopEraserHold();if(!destroyed&&!readonly())Promise.resolve(options.onLongPressEraser()).catch(report)},3000);
    });
    listen(global,'pointerup',stopEraserHold);
    listen(global,'pointercancel',stopEraserHold);
    listen(eraserHoldBtn,'pointerleave',stopEraserHold);
    function reset(options){
      if(textSession&&!options?.discardDraft){textSession.stale=true;textSession.editor.dataset.saveState='failed';textSession.status.textContent='画布已切换，草稿仍保留，请复制输入或按 Esc 关闭';report(new Error('文字草稿尚未保存，请先保存或按 Esc 取消'));cancel();selectedId=null;if(ownHistory)history?.clear();render();return false}cancel();closeTextEditor(false);selectedId=null;settingsOpen=false;
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
    function activateText(){if(destroyed||readonly())return false;opened=true;settingsOpen=true;setTool('text');options.onOpenChange?.(true);return true}
    async function openTextAt(clientX,clientY){
      if(destroyed||readonly()||!Number.isFinite(clientX)||!Number.isFinite(clientY))return false;
      if(textSession&&!await closeTextEditor(true))return false;
      if(!activateText())return false;openTextEditor(clientX,clientY,null);return true;
    }
    const tools=toolbar.querySelector('.canvas-ink-tools'),ui=global.KGCanvasToolbar;
    if(ui){
      tools.querySelectorAll('.canvas-ink-divider').forEach(el=>el.remove());
      ui.group(tools,'选择',[[toolbar.querySelector('[data-ink-tool=select]'),'select','选择']]);
      ui.group(tools,'绘制',[[toolbar.querySelector('[data-ink-tool=pen]'),'pen','画笔'],[toolbar.querySelector('[data-ink-tool=highlighter]'),'highlighter','高亮'],[toolbar.querySelector('[data-ink-tool=text]'),'text','文字'],[toolbar.querySelector('[data-ink-tool=eraser]'),'eraser','橡皮']]);
      ui.group(tools,'撤销重做',[[toolbar.querySelector('[data-ink-action=undo]'),'undo','撤销'],[toolbar.querySelector('[data-ink-action=redo]'),'redo','重做']]);
      ui.group(tools,'笔迹设置',[[toolbar.querySelector('[data-ink-settings]'),'settings','设置'],[toolbar.querySelector('[data-ink-close]'),'close','收起']]);
      tools.append(palette);
    }
    render();
    return {activateText,openTextAt,handleKeyDown,commitText:()=>closeTextEditor(true),hasTextDraft:()=>!!textSession,render,refreshControls,cancel,reset,setTool,setOpen,destroy,clearAll,get tool(){return tool},get temporaryPan(){return space}};
  }
  global.KGCanvasInk=Object.freeze({normalize,point,path,textLayout,bounds,draw,svgStroke,create});
})(window);
