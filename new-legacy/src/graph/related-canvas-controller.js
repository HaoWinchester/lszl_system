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
    const graph=()=>session.getState(),node=id=>graph().nodes.find(n=>n.id===id);
    let nodeIds=new Set(),linkIds=new Set(),drag=null,closed=false;
    const overlay=document.createElement('div');overlay.className='related-canvas-backdrop';overlay.dataset.stageUi='true';
    overlay.innerHTML='<section class="related-canvas-dialog" role="dialog" aria-modal="true" aria-label="临时相关画布"><header class="related-canvas-header"><div><strong>临时相关画布</strong><span>修改仅在本次视图中有效，关闭即丢弃；题目功能不可用</span></div><div class="related-canvas-header-actions"><button data-action="add">新增卡片</button><button data-action="connect">连线</button><button data-action="delete">删除</button><button data-action="undo">撤销</button><button data-action="redo">重做</button><button data-action="fit">适应</button><button data-action="fullscreen">全屏</button><button class="related-canvas-close" data-action="close" aria-label="退出临时画布"><svg viewBox="0 0 24 24" aria-hidden="true"><path d="M7 7l10 10M17 7L7 17"></path></svg></button></div></header><div class="related-canvas-body"><div class="related-canvas-viewport"><div class="related-canvas-stage"><svg class="related-canvas-edges"></svg><div class="related-canvas-cards"></div></div></div></div><form class="related-canvas-info" style="left:18px;top:76px;width:260px;padding:14px"><label>标题<input name="title" aria-label="临时卡片标题"></label><label>说明<textarea name="summary" aria-label="临时卡片说明"></textarea></label><label>颜色<input name="color" type="color" aria-label="临时卡片颜色"></label><button type="submit">应用临时修改</button><p class="related-canvas-empty"></p></form></section>';
    const body=overlay.querySelector('.related-canvas-body'),stage=overlay.querySelector('.related-canvas-stage'),cards=overlay.querySelector('.related-canvas-cards'),svg=overlay.querySelector('.related-canvas-edges'),form=overlay.querySelector('form');
    cards.style.pointerEvents='none';
    const viewport={x:0,y:0,scale:1};
    function applyViewport(){stage.style.width='10000px';stage.style.height='10000px';stage.style.transform=`translate(${viewport.x}px,${viewport.y}px) scale(${viewport.scale})`}
    function fit(){let x=Infinity,y=Infinity,right=-Infinity,bottom=-Infinity;for(const n of graph().nodes){const g=model.geometryOf(n),d=nodeDims(n);x=Math.min(x,g.x);y=Math.min(y,g.y);right=Math.max(right,g.x+d.w);bottom=Math.max(bottom,g.y+d.h)}if(!Number.isFinite(x))return;viewport.scale=Math.max(.05,Math.min(1.15,(body.clientWidth-120)/Math.max(1,right-x),(body.clientHeight-120)/Math.max(1,bottom-y)));viewport.x=body.clientWidth/2-(x+right)/2*viewport.scale;viewport.y=body.clientHeight/2-(y+bottom)/2*viewport.scale;applyViewport()}
    function details(){const n=node(graph().selectedNodeId);form.hidden=!n;if(n){form.elements.title.value=model.contentOf(n).title||'';form.elements.summary.value=model.contentOf(n).summary||'';form.elements.color.value=model.appearanceOf(n).color||'#2563eb';form.querySelector('p').textContent=graph().links.some(l=>l.from===n.id||l.to===n.id)?'':'此卡片没有一跳关联内容，仍可临时编辑。'}}
    const selection=global.KGGraphSelectionController.create({getState:graph,getNodeSet:()=>nodeIds,setNodeSet:value=>nodeIds=value,getLinkSet:()=>linkIds,setLinkSet:value=>linkIds=value,onChange:()=>renderer.render()});
    const styles=global.KGGraphStyleController.create({getGraph:graph,model,history:session.history,onChange:()=>renderer.render('full',{persist:true})});
    const connection=global.KGGraphConnectionController.create({getState:graph,getNode:node,relationExists:(a,b)=>graph().links.some(l=>l.from===a&&l.to===b),createLink:(from,to)=>({id:idFactory('l'),from,to,type:'',color:'#64748b',lineStyle:'solid',pathStyle:'curve'}),addLink:link=>session.history.run('临时连线',()=>graph().links.push(link)),onChange:()=>renderer.render('full',{persist:true})});
    const markerId=idFactory('temporary-arrow');
    function renderEdges(){
      svg.setAttribute('width','10000');svg.setAttribute('height','10000');svg.style.overflow='visible';svg.replaceChildren();
      options.ensureMarkers(svg,markerId);
      const nodeMap=new Map(graph().nodes.map(n=>[n.id,n]));
      for(const link of graph().links){
        const presentation=options.renderRelation(link,nodeMap,{markerId,ignoreGather:true});if(!presentation)continue;
        const {path,label}=presentation;
        path.classList.add('related-canvas-edge');path.dataset.linkId=link.id;path.style.pointerEvents='stroke';
        path.onclick=e=>{e.stopPropagation();selection.selectLink(link.id)};svg.append(path);
        if(label){label.classList.add('related-canvas-label');label.style.pointerEvents='none';svg.append(label)}
      }
    }
    function renderCards(){cards.replaceChildren();for(const n of graph().nodes){const card=renderCard(n,{state:graph(),selectedNodeIds:nodeIds,position:model.geometryOf(n)});card.classList.add('related-canvas-card');card.style.pointerEvents='auto';card.querySelectorAll('.node-size-tools,.graph-node-resize-layer').forEach(el=>el.remove());card.addEventListener('pointerdown',e=>{if(e.button!==0)return;e.preventDefault();if(connection.source()){connection.connectTo(n.id);return}selection.selectNodes([n.id]);const g=model.geometryOf(n);drag={id:n.id,pointerId:e.pointerId,x:e.clientX,y:e.clientY,start:g};body.setPointerCapture(e.pointerId)});cards.append(card)}}
    const renderer=global.KGGraphRenderer.create({renderCards,renderEdges,renderDetails:details,applyViewport,persist:()=>session.persist()});
    function mutate(label,work){session.history.run(label,work);renderer.render('full',{persist:true})}
    function remove(){const s=graph();if(s.selectedNodeId)mutate('临时删除卡片',()=>{const id=s.selectedNodeId;s.nodes=s.nodes.filter(n=>n.id!==id);s.links=s.links.filter(l=>l.from!==id&&l.to!==id);s.selectedNodeId=null});else if(s.selectedLinkId)mutate('临时删除连线',()=>{s.links=s.links.filter(l=>l.id!==s.selectedLinkId);s.selectedLinkId=null})}
    function action(name){if(name==='close'){onClose();return}if(name==='fit')fit();else if(name==='fullscreen'){overlay.classList.toggle('related-canvas-fullscreen');fit()}else if(name==='undo'||name==='redo'){session.history[name]();renderer.render()}else if(name==='delete')remove();else if(name==='connect')connection.setSource(graph().selectedNodeId);else if(name==='add'){const id=idFactory('n');mutate('临时新增卡片',()=>graph().nodes.push(model.normalizeNode({id,title:'临时新卡片',x:(body.clientWidth/2-viewport.x)/viewport.scale,y:(body.clientHeight/2-viewport.y)/viewport.scale})));selection.selectNodes([id])}}
    overlay.addEventListener('click',e=>{const button=e.target.closest('[data-action]');if(button)action(button.dataset.action);e.stopPropagation()});
    overlay.addEventListener('pointerdown',e=>e.stopPropagation());
    form.addEventListener('wheel',e=>e.stopPropagation(),{passive:true});
    form.addEventListener('submit',e=>{e.preventDefault();const id=graph().selectedNodeId;if(!id)return;const content={title:form.elements.title.value,summary:form.elements.summary.value},appearance={color:form.elements.color.value};styles.updateContent([id],content);styles.updateAppearance([id],appearance)});
    body.addEventListener('pointermove',e=>{if(!drag||drag.pointerId!==e.pointerId)return;const dx=(e.clientX-drag.x)/viewport.scale,dy=(e.clientY-drag.y)/viewport.scale;if(drag.pan){viewport.x=drag.start.x+dx*viewport.scale;viewport.y=drag.start.y+dy*viewport.scale;applyViewport();return}if(!drag.started&&Math.hypot(dx,dy)>3){session.history.begin('临时移动卡片');session.history.checkpoint();drag.started=true}if(drag.started){model.updateGeometry(node(drag.id),{x:drag.start.x+dx,y:drag.start.y+dy});renderer.render('geometry')}});
    const end=e=>{if(!drag||drag.pointerId!==e.pointerId)return;if(drag.started){session.history.commit();session.persist()}body.releasePointerCapture(e.pointerId);drag=null};body.addEventListener('pointerup',end);body.addEventListener('pointercancel',end);
    body.addEventListener('pointerdown',e=>{if(e.button!==2)return;e.preventDefault();drag={pan:true,pointerId:e.pointerId,x:e.clientX,y:e.clientY,start:{x:viewport.x,y:viewport.y}};body.setPointerCapture(e.pointerId)});body.addEventListener('contextmenu',e=>e.preventDefault());
    body.addEventListener('wheel',e=>{e.preventDefault();e.stopPropagation();const r=body.getBoundingClientRect(),x=e.clientX-r.left,y=e.clientY-r.top,old=viewport.scale,next=Math.max(.05,Math.min(3,old*(e.deltaY<0?1.14:1/1.14)));viewport.x=x-(x-viewport.x)*next/old;viewport.y=y-(y-viewport.y)*next/old;viewport.scale=next;applyViewport()},{passive:false});
    // Capture before formal document shortcuts, including events whose focus remained behind the modal.
    const key=e=>{if(closed)return;if(e.key==='Escape'){e.preventDefault();onClose()}else if(!global.KGCanvasDomInteraction.isEditingTarget(e)){if((e.metaKey||e.ctrlKey)&&e.key.toLowerCase()==='z'){e.preventDefault();action(e.shiftKey?'redo':'undo')}else if(['Delete','Backspace'].includes(e.key)){e.preventDefault();remove()}}e.stopImmediatePropagation()};
    const clipboard=e=>{if(!global.KGCanvasDomInteraction.isEditingTarget(e))e.preventDefault();e.stopImmediatePropagation()};
    document.addEventListener('keydown',key,true);for(const type of ['copy','cut','paste'])document.addEventListener(type,clipboard,true);
    (options.host||document.body).append(overlay);const unmount=global.KGCanvasDomInteraction.mountOverlay(overlay);document.body.classList.add('related-canvas-open');
    graph().selectedNodeId=graph().nodes[0]?.id||null;renderer.render();fit();
    function close(){if(closed)return;closed=true;if(drag){try{body.releasePointerCapture(drag.pointerId)}catch{}drag=null}document.removeEventListener('keydown',key,true);for(const type of ['copy','cut','paste'])document.removeEventListener(type,clipboard,true);unmount();overlay.remove();session.close();document.body.classList.remove('related-canvas-open')}
    return Object.freeze({session,overlay,close,renderer,selection,styles,connection});
  }
  global.KGRelatedCanvasController=Object.freeze({scopeOneHop,create});
  if(typeof module!=='undefined')module.exports=global.KGRelatedCanvasController;
})(typeof window!=='undefined'?window:globalThis);
