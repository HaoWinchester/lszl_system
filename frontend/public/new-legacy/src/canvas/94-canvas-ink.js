'use strict';

/* Shared world-coordinate ink. Page adapters own persistence and access control. */
(function(global){
  const LIMITS={strokes:2000,points:5000,total:100000,coordinate:10000000};
  const TOOLS={pen:{min:1,max:24,width:3,color:'#2563eb',opacity:1},highlighter:{min:4,max:48,width:16,color:'#facc15',opacity:.3}};
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
    toolbar.innerHTML='<div class="canvas-ink-tools"><button type="button" data-ink-tool="select" title="选择（Esc）" aria-label="选择">↖</button><button type="button" data-ink-tool="pen" aria-label="画笔" title="画笔"><svg viewBox="0 0 24 24" aria-hidden="true"><path d="m15 4 5 5M4 20l5-1L20 8a2 2 0 0 0-5-5L4 14z"/></svg></button><button type="button" data-ink-tool="highlighter" aria-label="荧光笔" title="荧光笔"><svg viewBox="0 0 24 24" aria-hidden="true"><path d="m10 15 5 5 7-10-8-8-10 7 5 5M5 15l4 4-4 3-3-3zM2 23h16"/></svg></button><span class="canvas-ink-divider"></span><button type="button" data-ink-action="undo" aria-label="撤销笔迹" title="撤销笔迹（Ctrl/Command+Z）">↶</button><button type="button" data-ink-action="redo" aria-label="重做笔迹" title="重做笔迹（Ctrl/Command+Shift+Z）">↷</button><button type="button" data-ink-action="clear" aria-label="清空笔迹" title="清空笔迹"><svg viewBox="0 0 24 24" aria-hidden="true"><path d="M4 7h16M9 7V4h6v3M6 7l1 13h10l1-13M10 10v7M14 10v7"/></svg></button></div><div class="canvas-ink-options" hidden><div class="canvas-ink-colors" aria-label="笔迹颜色"></div><label class="canvas-ink-width">粗细 <input type="range" aria-label="笔迹粗细" step="1"><output></output></label><svg class="canvas-ink-preview" viewBox="0 0 180 52" aria-label="笔触预览"><path d="M 12 32 Q 45 10 80 26 T 168 24" fill="none" stroke-linecap="round"/></svg><small>Esc 选择 · 空格 / 右键移动</small></div>';
    (options.toolbarHost||viewport).append(toolbar);
    const panel=toolbar.querySelector('.canvas-ink-options'),range=toolbar.querySelector('input[type=range]'),preview=toolbar.querySelector('.canvas-ink-preview path');
    const prefs={pen:{...TOOLS.pen},highlighter:{...TOOLS.highlighter}};
    let tool='select',active=null,frame=0,space=false,destroyed=false,suppressClickUntil=0,sequence=0;
    const listeners=[];
    const readonly=()=>!!options.isReadonly?.();
    const report=error=>options.onError?.(error?.message||String(error));
    const history=options.history||global.KGCanvasHistoryController?.create({onChange:refreshControls});
    const ownHistory=!options.history;
    const getStrokes=()=>options.getStrokes?.()||[];
    const inside=target=>target===viewport||world.contains(target);
    const stop=event=>{event.preventDefault();event.stopImmediatePropagation()};
    function listen(target,type,callback,config){target.addEventListener(type,callback,config);listeners.push(()=>target.removeEventListener(type,callback,config))}
    function makePath(stroke){
      const el=doc.createElementNS(ns,'path');
      el.setAttribute('d',path(stroke.points));el.setAttribute('fill','none');el.setAttribute('stroke',stroke.color);el.setAttribute('stroke-width',stroke.width);el.setAttribute('stroke-linecap','round');el.setAttribute('stroke-linejoin','round');el.setAttribute('opacity',TOOLS[stroke.tool].opacity);el.dataset.strokeId=stroke.id;
      return el;
    }
    function refreshControls(){
      if(destroyed)return;
      const locked=readonly(),state=history?.getState?.()||{};
      if(locked&&tool!=='select')setTool('select');
      toolbar.querySelectorAll('[data-ink-tool]').forEach(btn=>{btn.setAttribute('aria-pressed',String(btn.dataset.inkTool===tool));btn.disabled=locked&&btn.dataset.inkTool!=='select'});
      for(const action of ['undo','redo']){const btn=toolbar.querySelector('[data-ink-action='+action+']');btn.hidden=!ownHistory;btn.disabled=locked||!state[action==='undo'?'canUndo':'canRedo']}
      toolbar.querySelector('[data-ink-action=clear]').disabled=locked||!getStrokes().length;
      panel.hidden=tool==='select';
      if(tool!=='select'){
        const pref=prefs[tool];range.min=pref.min;range.max=pref.max;range.value=pref.width;toolbar.querySelector('output').textContent=pref.width;
        toolbar.querySelector('input[type=color]').value=pref.color;
        toolbar.querySelectorAll('[data-ink-color]').forEach(btn=>btn.setAttribute('aria-pressed',String(btn.dataset.inkColor===pref.color)));
        preview.setAttribute('stroke',pref.color);preview.setAttribute('stroke-width',pref.width);preview.setAttribute('opacity',pref.opacity);
      }
    }
    function render(){
      if(destroyed)return;
      try{const strokes=normalize(getStrokes());layer.replaceChildren(...strokes.map(makePath));if(active){active.el=makePath(active.stroke);layer.append(active.el)}}catch(error){report(error)}
      refreshControls();
    }
    function apply(strokes){
      if(readonly())throw new Error('当前画布只读，不能修改笔迹');
      options.setStrokes(normalize(strokes));render();
    }
    function change(next,label){
      const before=normalize(getStrokes()),after=normalize(next);
      apply(after);history?.push({label,undo:()=>apply(before),redo:()=>apply(after)});refreshControls();
    }
    function cancel(){
      if(frame){global.cancelAnimationFrame(frame);frame=0}
      if(!active)return;
      const id=active.pointerId;active.el.remove();active=null;
      try{if(viewport.hasPointerCapture(id))viewport.releasePointerCapture(id)}catch(_){}
    }
    function setTool(value){
      cancel();tool=TOOLS[value]&&!readonly()?value:'select';
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
    toolbar.querySelectorAll('[data-ink-tool]').forEach(btn=>btn.addEventListener('click',()=>setTool(btn.dataset.inkTool)));
    toolbar.querySelectorAll('[data-ink-action]').forEach(btn=>btn.addEventListener('click',()=>{
      if(readonly())return;cancel();
      try{
        const action=btn.dataset.inkAction;
        if(action==='clear'){if(getStrokes().length&&global.confirm('清空当前画布的全部笔迹？题目、卡片和连线会保留，可以撤销此操作。'))change([],'清空笔迹')}
        else history?.[action]?.();
        refreshControls();
      }catch(error){report(error)}
    }));
    listen(toolbar,'pointerdown',event=>event.stopPropagation());
    listen(toolbar,'wheel',event=>event.stopPropagation());
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
    listen(global,'resize',cancel);
    listen(global,'blur',()=>{cancel();space=false;viewport.classList.remove('canvas-ink-panning')});
    // Cancel instead of mixing coordinate systems if zoom changes mid-stroke.
    listen(global,'wheel',event=>{if(active&&viewport.contains(event.target))cancel()},true);
    function reset(){cancel();setTool('select');if(ownHistory)history?.clear();render()}
    function destroy(){cancel();destroyed=true;listeners.forEach(remove=>remove());layer.remove();toolbar.remove();viewport.classList.remove('canvas-ink-drawing','canvas-ink-panning');delete viewport.dataset.inkTool}
    render();
    return {render,cancel,reset,setTool,destroy,get tool(){return tool},get temporaryPan(){return space}};
  }
  global.KGCanvasInk=Object.freeze({normalize,point,path,create});
})(window);
