'use strict';
(function(global){
  function scopeOneHop(graph,selectedIds){
    const valid=new Set(graph.nodes.map(n=>n.id)),selected=new Set([...selectedIds].filter(id=>valid.has(id))),scope=new Set(selected);
    for(const link of graph.links||[])if(selected.has(link.from)||selected.has(link.to)){if(valid.has(link.from))scope.add(link.from);if(valid.has(link.to))scope.add(link.to)}
    const nodes=graph.nodes.filter(n=>scope.has(n.id)),links=(graph.links||[]).filter(l=>scope.has(l.from)&&scope.has(l.to));
    const referenced=new Set();
    const visit=value=>{if(!value||typeof value!=='object')return;for(const [key,item] of Object.entries(value)){if(['resourceId','assetId'].includes(key)&&typeof item==='string')referenced.add(item);else if(key==='resourceIds'&&Array.isArray(item))item.forEach(id=>referenced.add(id));else visit(item)}};
    nodes.forEach(visit);links.forEach(visit);
    return {nodes,links,elements:[],resources:(graph.resources||[]).filter(r=>referenced.has(r.id)),defaults:graph.defaults||{}};
  }
  function create(options){
    const {session,renderCard,nodeDims,idFactory,model=global.KGGraphModel,onClose}=options;
    if(session.kind!=='temporary')throw new Error('Related canvas requires a temporary session');
    // 只读（阅读模式打开）：仅保留适应/全屏/关闭与查看，编辑按钮与画笔全部隐藏。
    const readOnly=()=>!!options.readOnly;
    const graph=()=>session.getState(),node=id=>graph().nodes.find(n=>n.id===id);
    let nodeIds=new Set(),linkIds=new Set(),drag=null,closed=false;
    const inkButton=readOnly()?'':'<button data-action="ink" aria-label="画笔" title="画笔（在临时画布上书写标注，关闭即丢弃）"><svg viewBox="0 0 24 24" aria-hidden="true"><path d="m15 4 5 5M4 20l5-1L20 8a2 2 0 0 0-5-5L4 14z"></path></svg></button>';
    const editButtons=readOnly()?'':'<button data-action="add">新增卡片</button><button data-action="connect">连线</button><button data-action="delete">删除</button>'+inkButton+'<button data-action="undo">撤销</button><button data-action="redo">重做</button>';
    const overlay=document.createElement('div');overlay.className='related-canvas-backdrop';overlay.dataset.stageUi='true';
    overlay.innerHTML='<section class="related-canvas-dialog" role="dialog" aria-modal="true" aria-label="临时相关画布"><header class="related-canvas-header"><div><strong>临时相关画布</strong><span>'+(readOnly()?'只读查看：仅供演示浏览，不提供编辑':'修改仅在本次视图中有效，关闭即丢弃；题目功能不可用')+'</span></div><div class="related-canvas-header-actions">'+editButtons+'<button data-action="fit">适应</button><button data-action="fullscreen">全屏</button><button class="related-canvas-close" data-action="close" aria-label="退出临时画布"><svg viewBox="0 0 24 24" aria-hidden="true"><path d="M7 7l10 10M17 7L7 17"></path></svg></button></div></header><div class="related-canvas-body"><div class="related-canvas-viewport"><div class="related-canvas-stage"><svg class="related-canvas-edges"></svg><div class="related-canvas-cards"></div></div></div></div><section class="related-canvas-info"><div class="related-canvas-detail"></div><p class="related-canvas-empty"></p></section></section>';
    const body=overlay.querySelector('.related-canvas-body'),stage=overlay.querySelector('.related-canvas-stage'),cards=overlay.querySelector('.related-canvas-cards'),svg=overlay.querySelector('.related-canvas-edges'),viewportEl=overlay.querySelector('.related-canvas-viewport'),info=overlay.querySelector('.related-canvas-info'),detail=overlay.querySelector('.related-canvas-detail');
    cards.style.pointerEvents='none';
    const viewport={x:0,y:0,scale:1};
    function applyViewport(){stage.style.width='10000px';stage.style.height='10000px';stage.style.transform=`translate(${viewport.x}px,${viewport.y}px) scale(${viewport.scale})`}
    function fit(){
      info.style.top=`${body.offsetTop+12}px`;
      let x=Infinity,y=Infinity,right=-Infinity,bottom=-Infinity;
      for(const n of graph().nodes){const g=model.geometryOf(n),d=nodeDims(n);x=Math.min(x,g.x);y=Math.min(y,g.y);right=Math.max(right,g.x+d.w);bottom=Math.max(bottom,g.y+d.h)}
      if(!Number.isFinite(x))return;
      const narrow=body.clientWidth<=760,left=narrow?0:Math.min(info.offsetWidth+36,body.clientWidth*.45),top=narrow?Math.min(info.offsetHeight+24,body.clientHeight*.48):0;
      const width=Math.max(100,body.clientWidth-left),height=Math.max(100,body.clientHeight-top);
      viewport.scale=Math.max(.05,Math.min(1.15,(width-80)/Math.max(1,right-x),(height-80)/Math.max(1,bottom-y)));
      viewport.x=left+width/2-(x+right)/2*viewport.scale;viewport.y=top+height/2-(y+bottom)/2*viewport.scale;applyViewport();
    }
    function details(){
      const n=node(graph().selectedNodeId);info.hidden=!n;if(!n)return;
      const links=graph().links.filter(l=>l.from===n.id||l.to===n.id),related=new Set(links.flatMap(l=>[l.from,l.to]).filter(id=>id!==n.id));
      detail.innerHTML=global.KGGraphNodeDetailView.render(n,{relationMarkup:`<div class="label">局部关系</div><div>${related.size} 个相关知识点 ｜ ${links.length} 条关系</div>`,imagesMarkup:options.renderImages?.(n)||''});
      info.querySelector('.related-canvas-empty').textContent=links.length?'':'此卡片没有一跳关联内容，可在此查看详情。';
    }
    const selection=global.KGGraphSelectionController.create({getState:graph,getNodeSet:()=>nodeIds,setNodeSet:value=>nodeIds=value,getLinkSet:()=>linkIds,setLinkSet:value=>linkIds=value,onChange:()=>renderer.render()});
    const connection=global.KGGraphConnectionController.create({getState:graph,getNode:node,relationExists:(a,b)=>graph().links.some(l=>l.from===a&&l.to===b),createLink:(from,to)=>({id:idFactory('l'),from,to,type:'',color:'#64748b',lineStyle:'solid',pathStyle:'curve'}),addLink:link=>session.history.run('临时连线',()=>graph().links.push(link)),onChange:()=>renderer.render('full',{persist:true})});
    // The isolated session owns one timeline for cards and ephemeral ink; closing discards both.
    graph().strokes=[];
    let ink=null,inkOpen=false;
    function ensureInk(){
      if(ink||readOnly())return ink;
      if(!global.KGCanvasInk)return null;
      ink=global.KGCanvasInk.create({
        viewport:viewportEl,world:stage,
        getViewport:()=>viewport,
        getStrokes:()=>graph().strokes||[],
        setStrokes:strokes=>{graph().strokes=strokes;ink.render()},
        history:{getState:session.history.getState,undo:()=>action('undo'),redo:()=>action('redo')},showHistory:true,
        change:(strokes,label)=>mutate(label,()=>{graph().strokes=strokes}),
        // 弹层整体带 [data-stage-ui]，默认命中判定会拒绝；此处按临时视口判定，包含变换后 stage 外的空白。
        isInside:target=>!target?.closest?.('[data-canvas-ui]')&&(target===viewportEl||viewportEl.contains(target)),
        isReadonly:readOnly,onOpenChange:value=>{inkOpen=value},
        onError:error=>global.console?.warn?.('临时画布画笔：',error?.message||error)
      });
      return ink;
    }
    const markerId=idFactory('temporary-arrow');
    function renderEdges(){
      svg.setAttribute('width','10000');svg.setAttribute('height','10000');svg.style.overflow='visible';svg.replaceChildren();
      options.ensureMarkers(svg,markerId);
      const nodeMap=new Map(graph().nodes.map(n=>[n.id,n]));
      for(const link of graph().links){
        const presentation=options.renderRelation(link,nodeMap,{markerId,ignoreGather:true});if(!presentation)continue;
        const {path,label}=presentation;
        path.classList.add('related-canvas-edge');path.dataset.linkId=link.id;path.style.pointerEvents=readOnly()?'none':'stroke';
        if(!readOnly())path.onclick=e=>{e.stopPropagation();selection.selectLink(link.id)};svg.append(path);
        if(label){label.classList.add('related-canvas-label');label.style.pointerEvents='none';svg.append(label)}
      }
    }
    function renderCards(){cards.replaceChildren();for(const n of graph().nodes){const card=renderCard(n,{state:graph(),selectedNodeIds:nodeIds,position:model.geometryOf(n)});card.classList.add('related-canvas-card');card.style.pointerEvents='auto';card.querySelectorAll('.node-size-tools,.graph-node-resize-layer').forEach(el=>el.remove());card.addEventListener('pointerdown',e=>{if(e.button!==0)return;e.preventDefault();if(readOnly()){selection.selectNodes([n.id]);return}if(connection.source()){connection.connectTo(n.id);return}selection.selectNodes([n.id]);const g=model.geometryOf(n);drag={id:n.id,pointerId:e.pointerId,x:e.clientX,y:e.clientY,start:g};body.setPointerCapture(e.pointerId)});cards.append(card)}}
    const renderer=global.KGGraphRenderer.create({renderCards,renderEdges,renderDetails:details,renderQuickActions:()=>ink?.render(),applyViewport,persist:()=>session.persist()});
    function mutate(label,work){session.history.run(label,work);renderer.render('full',{persist:true})}
    function remove(){const s=graph();if(s.selectedNodeId)mutate('临时删除卡片',()=>{const id=s.selectedNodeId;s.nodes=s.nodes.filter(n=>n.id!==id);s.links=s.links.filter(l=>l.from!==id&&l.to!==id);s.selectedNodeId=null});else if(s.selectedLinkId)mutate('临时删除连线',()=>{s.links=s.links.filter(l=>l.id!==s.selectedLinkId);s.selectedLinkId=null})}
    function action(name){
      if(name==='close'){onClose();return}
      if(readOnly()&&name!=='fit'&&name!=='fullscreen')return;
      if(name==='fit')fit();
      else if(name==='fullscreen'){overlay.classList.toggle('related-canvas-fullscreen');fit()}
      else if(name==='ink'){
        const instance=ensureInk();if(!instance)return;
        inkOpen=!inkOpen;instance.setOpen(inkOpen);
      }
      else if(name==='undo'||name==='redo'){ink?.cancel();session.history[name]();renderer.render()}
      else if(name==='delete')remove();
      else if(name==='connect')connection.setSource(graph().selectedNodeId);
      else if(name==='add'){const id=idFactory('n');mutate('临时新增卡片',()=>{const nodes=graph().nodes,x=nodes.length?Math.max(...nodes.map(n=>model.geometryOf(n).x+nodeDims(n).w))+48:0,y=nodes.length?Math.min(...nodes.map(n=>model.geometryOf(n).y)):0;nodes.push(model.normalizeNode({id,title:'临时新卡片',x,y}))});selection.selectNodes([id]);fit()}
    }
    overlay.addEventListener('click',e=>{const button=e.target.closest('[data-action]');if(button)action(button.dataset.action);e.stopPropagation()});
    overlay.addEventListener('pointerdown',e=>e.stopPropagation());
    body.addEventListener('pointermove',e=>{if(!drag||drag.pointerId!==e.pointerId)return;const dx=(e.clientX-drag.x)/viewport.scale,dy=(e.clientY-drag.y)/viewport.scale;if(drag.pan){viewport.x=drag.start.x+dx*viewport.scale;viewport.y=drag.start.y+dy*viewport.scale;applyViewport();return}if(!drag.started&&Math.hypot(dx,dy)>3){session.history.begin('临时移动卡片');session.history.checkpoint();drag.started=true}if(drag.started){model.updateGeometry(node(drag.id),{x:drag.start.x+dx,y:drag.start.y+dy});renderer.render('geometry')}});
    const end=e=>{if(!drag||drag.pointerId!==e.pointerId)return;if(drag.started){session.history.commit();session.persist()}body.releasePointerCapture(e.pointerId);drag=null};body.addEventListener('pointerup',end);body.addEventListener('pointercancel',end);
    body.addEventListener('pointerdown',e=>{if(e.button!==2)return;e.preventDefault();drag={pan:true,pointerId:e.pointerId,x:e.clientX,y:e.clientY,start:{x:viewport.x,y:viewport.y}};body.setPointerCapture(e.pointerId)});body.addEventListener('contextmenu',e=>e.preventDefault());
    body.addEventListener('wheel',e=>{e.preventDefault();e.stopPropagation();const r=body.getBoundingClientRect(),x=e.clientX-r.left,y=e.clientY-r.top,old=viewport.scale,next=Math.max(.05,Math.min(3,old*(e.deltaY<0?1.14:1/1.14)));viewport.x=x-(x-viewport.x)*next/old;viewport.y=y-(y-viewport.y)*next/old;viewport.scale=next;applyViewport()},{passive:false});
    // Capture before formal document shortcuts, including events whose focus remained behind the modal.
    const key=e=>{
      if(closed)return;
      // Native text/IME keys belong to the shared draft editor, including Escape.
      if(e.target?.closest?.('.canvas-ink-text-editor'))return;
      if(e.key==='Escape'){
        e.preventDefault();
        // 画笔激活时 ESC 先退出绘画，再按一次才关闭弹层。
        if(ink&&inkOpen&&ink.tool!=='select'){ink.setTool('select');e.stopImmediatePropagation();return}
        onClose();return;
      }
      if(readOnly())return;
      // This modal captures first; shared ink owns deletion/gesture cancellation, session owns history.
      if(ink&&inkOpen&&ink.handleKeyDown(e))return;
      if(!global.KGCanvasDomInteraction.isEditingTarget(e)){
        if((e.metaKey||e.ctrlKey)&&e.key.toLowerCase()==='z'){e.preventDefault();action(e.shiftKey?'redo':'undo')}
        else if(['Delete','Backspace'].includes(e.key)){e.preventDefault();remove()}
      }
      e.stopImmediatePropagation();
    };
    const clipboard=e=>{if(readOnly())return;if(!global.KGCanvasDomInteraction.isEditingTarget(e))e.preventDefault();e.stopImmediatePropagation()};
    // keydown 挂 window 捕获：必须先于画笔内核的 window 级 ESC 处理（ink 晚于弹层注册），否则
    // ink 会先把工具切回 select，导致弹层把「退出绘画」误判成「关闭弹层」。
    global.addEventListener('keydown',key,true);for(const type of ['copy','cut','paste'])document.addEventListener(type,clipboard,true);
    (options.host||document.body).append(overlay);const unmount=global.KGCanvasDomInteraction.mountOverlay(overlay);document.body.classList.add('related-canvas-open');
    graph().selectedNodeId=node(options.initialNodeId)?.id||graph().nodes[0]?.id||null;
    global.KGGraphMindmapLayout.apply(graph(),{rootIds:[graph().selectedNodeId,...graph().nodes.map(n=>n.id)].filter(Boolean),direction:'right',model,endpoints:options.layoutEndpoints});
    renderer.render();fit();
    function close(){
      if(closed)return;closed=true;
      if(drag){try{body.releasePointerCapture(drag.pointerId)}catch{}drag=null}
      if(ink){try{ink.reset({discardDraft:true})}catch{}try{ink.destroy()}catch{}ink=null;inkOpen=false}
      global.removeEventListener('keydown',key,true);for(const type of ['copy','cut','paste'])document.removeEventListener(type,clipboard,true);unmount();overlay.remove();session.close();document.body.classList.remove('related-canvas-open')
    }
    return Object.freeze({session,overlay,close,renderer,selection,connection});
  }
  global.KGRelatedCanvasController=Object.freeze({scopeOneHop,create});
  if(typeof module!=='undefined')module.exports=global.KGRelatedCanvasController;
})(typeof window!=='undefined'?window:globalThis);
