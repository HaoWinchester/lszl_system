'use strict';

/*
 * 本文件由原单文件 HTML 自动拆分而来。
 * 维护建议：继续把本文件中的强耦合函数逐步迁移为显式模块 API。
 */

let graphIndexCache=null,graphIndexStateRef=null,graphIndexNodesRef=null,graphIndexLinksRef=null,graphIndexNodeLength=-1,graphIndexLinkLength=-1;
function getGraphIndex(){
  const nodes=Array.isArray(state&&state.nodes)?state.nodes:[],links=Array.isArray(state&&state.links)?state.links:[];
  if(graphIndexCache&&graphIndexStateRef===state&&graphIndexNodesRef===nodes&&graphIndexLinksRef===links&&graphIndexNodeLength===nodes.length&&graphIndexLinkLength===links.length)return graphIndexCache;
  const nodeMap=new Map(),linkMap=new Map(),linksByNodeId=new Map();
  for(const n of nodes){if(n&&n.id)nodeMap.set(n.id,n)}
  const addLinkForNode=(id,link)=>{if(!id)return;let arr=linksByNodeId.get(id);if(!arr){arr=[];linksByNodeId.set(id,arr)}arr.push(link)};
  for(const l of links){
    if(!l||!l.id)continue;
    linkMap.set(l.id,l);
    if(nodeMap.has(l.from)&&nodeMap.has(l.to)){addLinkForNode(l.from,l);addLinkForNode(l.to,l)}
  }
  graphIndexCache={nodeMap,linkMap,linksByNodeId};
  graphIndexStateRef=state;graphIndexNodesRef=nodes;graphIndexLinksRef=links;graphIndexNodeLength=nodes.length;graphIndexLinkLength=links.length;
  return graphIndexCache;
}
function nodeById(id){return getGraphIndex().nodeMap.get(id)||null}
function linkById(id){return getGraphIndex().linkMap.get(id)||null}
function linksForNodeId(id){return getGraphIndex().linksByNodeId.get(id)||[]}
function dimsForSize(size){if(size==='small')return{w:104,h:110};if(size==='big')return{w:160,h:166};return{w:CARD_W,h:CARD_H}}
function nodeDims(n){return dimsForSize(n&&n.size)}
function isRelatedGatherActive(){return !!(relatedGatherLayout&&relatedGatherLayout.active&&relatedGatherLayout.anchorId===currentRelatedScopeAnchorId())}
function visualPositionForNode(n,options={}){
  if(!n)return{x:0,y:0};
  if(!options.ignoreGather&&isRelatedGatherActive()&&relatedGatherLayout.positions&&relatedGatherLayout.positions.has(n.id)){
    const p=relatedGatherLayout.positions.get(n.id);
    return{x:p.x,y:p.y};
  }
  return{x:n.x,y:n.y};
}
function nodeCenter(n){const d=nodeDims(n),p=visualPositionForNode(n);return{x:p.x+d.w/2,y:p.y+d.h/2}}
function applyTransform(){world.style.transform=`translate(${state.viewport.x}px, ${state.viewport.y}px) scale(${state.viewport.scale})`;updateCardQuickActionsPosition();updateSelectedEdgeQuickStylePosition();updateEdgeInlineLabelEditorPosition();if(typeof updateCanvasZoomControls==='function')updateCanvasZoomControls()}
function screenToWorld(clientX,clientY){const r=stage.getBoundingClientRect();return{x:(clientX-r.left-state.viewport.x)/state.viewport.scale,y:(clientY-r.top-state.viewport.y)/state.viewport.scale}}
function pathStyleForLink(link){
  const style=link&&link.pathStyle;
  return LINE_PATH_STYLES&&LINE_PATH_STYLES.has(style)?style:DEFAULTS.linkPathStyle;
}
function pathFor(a,b,pathStyle=DEFAULTS.linkPathStyle){
  const style=LINE_PATH_STYLES&&LINE_PATH_STYLES.has(pathStyle)?pathStyle:DEFAULTS.linkPathStyle;
  const dx=b.x-a.x,dy=b.y-a.y,adx=Math.abs(dx),ady=Math.abs(dy);
  if(style==='straight')return`M ${a.x} ${a.y} L ${b.x} ${b.y}`;
  if(style==='elbow'){
    if(adx>=ady){
      const mx=Math.round((a.x+b.x)/2);
      return`M ${a.x} ${a.y} L ${mx} ${a.y} L ${mx} ${b.y} L ${b.x} ${b.y}`;
    }
    const my=Math.round((a.y+b.y)/2);
    return`M ${a.x} ${a.y} L ${a.x} ${my} L ${b.x} ${my} L ${b.x} ${b.y}`;
  }
  const c=Math.max(80,adx*.45);
  return`M ${a.x} ${a.y} C ${a.x+c} ${a.y}, ${b.x-c} ${b.y}, ${b.x} ${b.y}`;
}
function dashArrayForLineStyle(style,strokeWidth=4){
  const width=Math.max(1,Number(strokeWidth)||4);
  if(style==='dashed')return `${formatSvgNumber(width*4)} ${formatSvgNumber(width*2)}`;
  if(style==='dotted')return `${formatSvgNumber(width)} ${formatSvgNumber(width*1.5)}`;
  return '';
}
function formatSvgNumber(value){
  return String(Math.round(value*10)/10);
}
function relationExists(a,b){return linksForNodeId(a).some(l=>(l.from===a&&l.to===b)||(l.from===b&&l.to===a))}
function isImportant(n){return String(n&&n.level||'').trim()==='重点'}
const LARGE_GRAPH_NODE_THRESHOLD=90,LARGE_GRAPH_LINK_THRESHOLD=120,LARGE_GRAPH_OVERVIEW_LINK_LIMIT=140,LARGE_GRAPH_SELECTED_LINK_LIMIT=120,LARGE_GRAPH_SELECTED_LABEL_LIMIT=50;
const GRAPH_VIEWPORT_MIN_SCALE=.01,GRAPH_VIEWPORT_MAX_SCALE=4,GRAPH_FIT_ALL_DESKTOP_MARGIN=240,GRAPH_FIT_ALL_COARSE_MARGIN=130;
const GRAPH_BUTTON_ZOOM_LEVELS=[.01,.02,.03,.05,.10,.15,.20,.33,.50,.75,1,1.25,1.50,2,2.50,3,4];
const GRAPH_WHEEL_ZOOM_LEVELS=[.01,.02,.03,.04,.05,.07,.09,.11,.13,.17,.21,.26,.33,.41,.51,.64,.80,1,1.20,1.44,1.73,2.07,2.49,2.99,3.58,4];
function graphViewportMinScale(){return GRAPH_VIEWPORT_MIN_SCALE}
function graphViewportMaxScale(){return GRAPH_VIEWPORT_MAX_SCALE}
function graphZoomLevelList(levels){
  const min=graphViewportMinScale(),max=graphViewportMaxScale();
  return (Array.isArray(levels)?levels:[]).map(v=>clamp(Number(v)||1,min,max)).filter((v,i,a)=>i===0||Math.abs(v-a[i-1])>.000001);
}
function graphNextZoomLevel(current,direction,levels){
  const min=graphViewportMinScale(),max=graphViewportMaxScale(),list=graphZoomLevelList(levels),value=clamp(Number(current)||1,min,max),eps=.000001;
  if(direction>0){
    for(const item of list){if(item>value+eps)return item}
    return max;
  }
  for(let i=list.length-1;i>=0;i--){if(list[i]<value-eps)return list[i]}
  return min;
}
function nextGraphButtonZoomScale(current,direction){return graphNextZoomLevel(current,direction,GRAPH_BUTTON_ZOOM_LEVELS)}
function nextGraphWheelZoomScale(current,direction){return graphNextZoomLevel(current,direction,GRAPH_WHEEL_ZOOM_LEVELS)}
window.nextGraphButtonZoomScale=nextGraphButtonZoomScale;
window.nextGraphWheelZoomScale=nextGraphWheelZoomScale;

// v7.9.58：缩放操作从“瞬间跳变”改为短时补间动画。
// 关键点：滚轮连续触发时，下一档位基于“计划目标比例”继续推进，避免动画未完成时卡在同一档。
let graphSmoothZoomFrame=0,graphSmoothZoomTarget=null,graphSmoothZoomToken=0;
function easeGraphSmoothZoom(t){return 1-Math.pow(1-t,4)}
function cancelGraphSmoothZoom(){
  if(graphSmoothZoomFrame)cancelAnimationFrame(graphSmoothZoomFrame);
  graphSmoothZoomFrame=0;
  graphSmoothZoomTarget=null;
  graphSmoothZoomToken++;
  if(stage&&stage.classList)stage.classList.remove('viewport-smooth-zooming');
}
function graphViewportForScaleAtClientPoint(scale,clientX,clientY){
  const r=stage.getBoundingClientRect();
  const currentScale=Math.max(graphViewportMinScale(),Number(state.viewport.scale)||1);
  const worldPoint={
    x:(clientX-r.left-(Number(state.viewport.x)||0))/currentScale,
    y:(clientY-r.top-(Number(state.viewport.y)||0))/currentScale
  };
  const ns=clamp(Number(scale)||1,graphViewportMinScale(),graphViewportMaxScale());
  return{
    scale:ns,
    x:clientX-r.left-worldPoint.x*ns,
    y:clientY-r.top-worldPoint.y*ns
  };
}
function animateGraphViewportSmooth(target,options={}){
  const persist=options.persist!==false;
  const duration=Number(options.duration)||180;
  const reduceMotion=window.matchMedia&&window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  if(graphSmoothZoomFrame)cancelAnimationFrame(graphSmoothZoomFrame);
  graphSmoothZoomFrame=0;
  const start={x:Number(state.viewport.x)||0,y:Number(state.viewport.y)||0,scale:Number(state.viewport.scale)||1};
  const tx=Number(target.x)||0,ty=Number(target.y)||0,ts=clamp(Number(target.scale)||1,graphViewportMinScale(),graphViewportMaxScale());
  const distance=Math.hypot(tx-start.x,ty-start.y)+Math.abs(ts-start.scale)*220;
  const token=++graphSmoothZoomToken;
  graphSmoothZoomTarget={x:tx,y:ty,scale:ts,source:options.source||'zoom'};
  if(reduceMotion||duration<=0||distance<.35){
    state.viewport.x=tx;state.viewport.y=ty;state.viewport.scale=ts;
    viewportDirty=true;
    applyTransform();
    if(persist) scheduleViewportCommit();
    graphSmoothZoomTarget=null;
    if(stage&&stage.classList)stage.classList.remove('viewport-smooth-zooming');
    return ts;
  }
  if(stage&&stage.classList)stage.classList.add('viewport-smooth-zooming');
  const started=performance.now();
  const step=now=>{
    if(token!==graphSmoothZoomToken)return;
    const t=clamp((now-started)/duration,0,1),k=easeGraphSmoothZoom(t);
    state.viewport.x=start.x+(tx-start.x)*k;
    state.viewport.y=start.y+(ty-start.y)*k;
    state.viewport.scale=start.scale+(ts-start.scale)*k;
    viewportDirty=true;
    applyTransform();
    if(t<1){
      graphSmoothZoomFrame=requestAnimationFrame(step);
      return;
    }
    graphSmoothZoomFrame=0;
    state.viewport.x=tx;state.viewport.y=ty;state.viewport.scale=ts;
    viewportDirty=true;
    applyTransform();
    if(persist)scheduleViewportCommit();
    graphSmoothZoomTarget=null;
    if(stage&&stage.classList)stage.classList.remove('viewport-smooth-zooming');
  };
  graphSmoothZoomFrame=requestAnimationFrame(step);
  return ts;
}
function smoothGraphZoomToScaleAtClientPoint(scale,clientX,clientY,options={}){
  const target=graphViewportForScaleAtClientPoint(scale,clientX,clientY);
  return animateGraphViewportSmooth(target,options);
}
function smoothGraphZoomByLevelsAtClientPoint(direction,levels,clientX,clientY,options={}){
  const sameSource=graphSmoothZoomTarget&&graphSmoothZoomTarget.source===(options.source||'zoom');
  const baseScale=sameSource?graphSmoothZoomTarget.scale:(Number(state.viewport.scale)||1);
  const next=graphNextZoomLevel(baseScale,direction,levels);
  return smoothGraphZoomToScaleAtClientPoint(next,clientX,clientY,options);
}
function smoothGraphButtonZoomAtStageCenter(direction){
  const r=stage.getBoundingClientRect();
  return smoothGraphZoomByLevelsAtClientPoint(direction,GRAPH_BUTTON_ZOOM_LEVELS,r.left+r.width/2,r.top+r.height/2,{duration:230,source:'button'});
}
function smoothGraphWheelZoomAtClientPoint(direction,clientX,clientY){
  return smoothGraphZoomByLevelsAtClientPoint(direction,GRAPH_WHEEL_ZOOM_LEVELS,clientX,clientY,{duration:150,source:'wheel'});
}
window.cancelGraphSmoothZoom=cancelGraphSmoothZoom;
window.smoothGraphZoomToScaleAtClientPoint=smoothGraphZoomToScaleAtClientPoint;
window.smoothGraphButtonZoomAtStageCenter=smoothGraphButtonZoomAtStageCenter;
window.smoothGraphWheelZoomAtClientPoint=smoothGraphWheelZoomAtClientPoint;
const RELATED_GATHER_TRIGGER_SCALE=.66,RELATED_GATHER_MIN_SCALE=.64,RELATED_GATHER_MAX_SCALE=1.08;
let largeGraphModeNotified=false,largeGraphOverviewEnabled=false,largeGraphRelatedFocusEnabled=false,flowModeEnabled=false,relatedScopeAnchorNodeId=null;
let relatedGatherLayout=null;
let cardQuickActionsEl=null;
const CENTER_SCOPE_ICON='<svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="12" cy="12" r="7"></circle><circle cx="12" cy="12" r="2"></circle><path d="M12 2v3M12 19v3M2 12h3M19 12h3"></path></svg>';
const FIT_SCOPE_ICON='<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M8 3H3v5"></path><path d="M16 3h5v5"></path><path d="M8 21H3v-5"></path><path d="M16 21h5v-5"></path><path d="M3 3l6 6"></path><path d="M21 3l-6 6"></path><path d="M3 21l6-6"></path><path d="M21 21l-6-6"></path></svg>';
const RESTORE_SCOPE_ICON='<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M3 12a9 9 0 1 0 3-6.7"></path><path d="M3 4v6h6"></path><path d="M9 12h6"></path></svg>';

let relatedCanvasModalEl=null,relatedCanvasState=null,relatedCanvasDrag=null,relatedCanvasPanDrag=null,relatedCanvasInfoState=null,relatedCanvasInfoDrag=null;
const RELATED_CANVAS_MIN_SCALE=.45,RELATED_CANVAS_MAX_SCALE=1.8,RELATED_CANVAS_SCALE_STEP=1.14;
const RELATED_CANVAS_CLOSE_ICON='<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M7 7l10 10M17 7L7 17"></path></svg>';
const RELATED_CANVAS_MINIMIZE_ICON='<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M6 12h12"></path></svg>';
const RELATED_CANVAS_EXPAND_INFO_ICON='<svg viewBox="0 0 24 24" aria-hidden="true"><rect x="6" y="6" width="12" height="12" rx="2"></rect><path d="M9 12h6"></path></svg>';
const RELATED_CANVAS_FULLSCREEN_ICON='<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M8 3H3v5M16 3h5v5M8 21H3v-5M16 21h5v-5"></path><path d="M3 3l6 6M21 3l-6 6M3 21l6-6M21 21l-6-6"></path></svg>';
const RELATED_CANVAS_EXIT_FULLSCREEN_ICON='<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M9 3v6H3M15 3v6h6M9 21v-6H3M15 21v-6h6"></path></svg>';
function relatedCanvasNodeCenter(id){
  if(!relatedCanvasState||!relatedCanvasState.positions)return null;
  const n=nodeById(id),p=relatedCanvasState.positions.get(id);if(!n||!p)return null;
  const d=nodeDims(n);return{x:p.x+d.w/2,y:p.y+d.h/2};
}

function updateRelatedCanvasZoomLabel(){
  if(!relatedCanvasModalEl||!relatedCanvasState)return;
  const label=relatedCanvasModalEl.querySelector('.related-canvas-zoom-label');
  if(label)label.textContent=Math.round((relatedCanvasState.scale||1)*100)+'%';
}
function applyRelatedCanvasScale(){
  if(!relatedCanvasModalEl||!relatedCanvasState)return;
  const viewport=relatedCanvasModalEl.querySelector('.related-canvas-viewport'),stageEl=relatedCanvasModalEl.querySelector('.related-canvas-stage');
  if(!viewport||!stageEl)return;
  const scale=relatedCanvasState.scale||1;
  const panX=Number.isFinite(relatedCanvasState.panX)?relatedCanvasState.panX:0;
  const panY=Number.isFinite(relatedCanvasState.panY)?relatedCanvasState.panY:0;
  viewport.style.width='100%';
  viewport.style.height='100%';
  stageEl.style.width=relatedCanvasState.width+'px';stageEl.style.height=relatedCanvasState.height+'px';
  stageEl.style.transform=`translate(${panX}px, ${panY}px) scale(${scale})`;
  updateRelatedCanvasZoomLabel();
}
function centerRelatedCanvasStage(){
  if(!relatedCanvasModalEl||!relatedCanvasState)return;
  const body=relatedCanvasModalEl.querySelector('.related-canvas-body');if(!body)return;
  const scale=relatedCanvasState.scale||1;
  relatedCanvasState.panX=Math.round((body.clientWidth-relatedCanvasState.width*scale)/2);
  relatedCanvasState.panY=Math.round((body.clientHeight-relatedCanvasState.height*scale)/2);
}
function setRelatedCanvasScale(next,originEvent){
  if(!relatedCanvasModalEl||!relatedCanvasState)return;
  const body=relatedCanvasModalEl.querySelector('.related-canvas-body');if(!body)return;
  const oldScale=relatedCanvasState.scale||1,nextScale=clamp(next,RELATED_CANVAS_MIN_SCALE,RELATED_CANVAS_MAX_SCALE);
  const oldPanX=Number.isFinite(relatedCanvasState.panX)?relatedCanvasState.panX:0;
  const oldPanY=Number.isFinite(relatedCanvasState.panY)?relatedCanvasState.panY:0;
  const r=body.getBoundingClientRect();
  const anchorX=originEvent?originEvent.clientX-r.left:body.clientWidth/2;
  const anchorY=originEvent?originEvent.clientY-r.top:body.clientHeight/2;
  const worldX=(anchorX-oldPanX)/oldScale,worldY=(anchorY-oldPanY)/oldScale;
  relatedCanvasState.scale=nextScale;
  relatedCanvasState.panX=Math.round(anchorX-worldX*nextScale);
  relatedCanvasState.panY=Math.round(anchorY-worldY*nextScale);
  applyRelatedCanvasScale();
}
function beginRelatedCanvasPan(e){
  if(e.button!==undefined&&e.button!==0)return;
  if(!relatedCanvasModalEl||!relatedCanvasState)return;
  if(e.target&&e.target.closest&&e.target.closest('.related-canvas-card,.related-canvas-info,.related-canvas-header,button,input,textarea,select,a'))return;
  const body=e.currentTarget;if(!body)return;
  relatedCanvasPanDrag={pointerId:e.pointerId,body,startX:e.clientX,startY:e.clientY,startPanX:Number.isFinite(relatedCanvasState.panX)?relatedCanvasState.panX:0,startPanY:Number.isFinite(relatedCanvasState.panY)?relatedCanvasState.panY:0,moved:false};
  body.classList.add('panning');
  document.addEventListener('pointermove',moveRelatedCanvasPan,true);
  document.addEventListener('pointerup',endRelatedCanvasPan,true);
  document.addEventListener('pointercancel',endRelatedCanvasPan,true);
  try{body.setPointerCapture(e.pointerId)}catch{}
  e.preventDefault();e.stopPropagation();
}
function moveRelatedCanvasPan(e){
  const drag=relatedCanvasPanDrag;if(!drag||drag.pointerId!==e.pointerId)return;
  const dx=e.clientX-drag.startX,dy=e.clientY-drag.startY;
  if(Math.hypot(dx,dy)>2)drag.moved=true;
  if(!relatedCanvasState)return;
  relatedCanvasState.panX=Math.round(drag.startPanX+dx);
  relatedCanvasState.panY=Math.round(drag.startPanY+dy);
  applyRelatedCanvasScale();
  e.preventDefault();e.stopPropagation();
}
function endRelatedCanvasPan(e){
  const drag=relatedCanvasPanDrag;if(!drag||drag.pointerId!==e.pointerId)return;
  try{drag.body.releasePointerCapture(e.pointerId)}catch{}
  drag.body.classList.remove('panning');
  relatedCanvasPanDrag=null;
  document.removeEventListener('pointermove',moveRelatedCanvasPan,true);
  document.removeEventListener('pointerup',endRelatedCanvasPan,true);
  document.removeEventListener('pointercancel',endRelatedCanvasPan,true);
  e.preventDefault();e.stopPropagation();
}
function resetRelatedCanvasScale(){if(!relatedCanvasState)return;relatedCanvasState.scale=1;centerRelatedCanvasStage();applyRelatedCanvasScale()}
function toggleRelatedCanvasFullscreen(){
  if(!relatedCanvasModalEl)return;
  const on=!relatedCanvasModalEl.classList.contains('related-canvas-fullscreen');
  relatedCanvasModalEl.classList.toggle('related-canvas-fullscreen',on);
  const btn=relatedCanvasModalEl.querySelector('.related-canvas-fullscreen-toggle');
  if(btn){btn.title=on?'退出全屏':'全屏';btn.setAttribute('aria-label',on?'退出全屏':'全屏');btn.innerHTML=on?RELATED_CANVAS_EXIT_FULLSCREEN_ICON:RELATED_CANVAS_FULLSCREEN_ICON}
  requestAnimationFrame(()=>{centerRelatedCanvasStage();applyRelatedCanvasScale();const info=relatedCanvasModalEl&&relatedCanvasModalEl.querySelector('.related-canvas-info');if(info)placeRelatedCanvasInfo(info)});
}
function beginRelatedCanvasInfoDrag(e){
  if(e.button!==undefined&&e.button!==0)return;
  if(e.target&&e.target.closest&&e.target.closest('button'))return;
  const box=e.currentTarget.closest('.related-canvas-info'),dialog=relatedCanvasModalEl&&relatedCanvasModalEl.querySelector('.related-canvas-dialog');
  if(!box||!dialog)return;
  const br=box.getBoundingClientRect(),dr=dialog.getBoundingClientRect();
  relatedCanvasInfoDrag={pointerId:e.pointerId,box,dialog,startX:e.clientX,startY:e.clientY,originX:br.left-dr.left,originY:br.top-dr.top};
  box.classList.add('dragging');
  document.addEventListener('pointermove',moveRelatedCanvasInfoDrag,true);
  document.addEventListener('pointerup',endRelatedCanvasInfoDrag,true);
  document.addEventListener('pointercancel',endRelatedCanvasInfoDrag,true);
  try{box.setPointerCapture(e.pointerId)}catch{}
  e.preventDefault();e.stopPropagation();
}
function placeRelatedCanvasInfo(box){
  const dialog=relatedCanvasModalEl&&relatedCanvasModalEl.querySelector('.related-canvas-dialog');if(!box||!dialog)return;
  const dw=dialog.clientWidth,dh=dialog.clientHeight;
  if(!relatedCanvasInfoState)relatedCanvasInfoState={x:null,y:null,collapsed:false};
  const defaultX=Math.max(18,dw-398),defaultY=76;
  const w=box.offsetWidth||360,h=box.offsetHeight||260;
  const x=clamp(relatedCanvasInfoState.x==null?defaultX:relatedCanvasInfoState.x,12,Math.max(12,dw-w-12));
  const y=clamp(relatedCanvasInfoState.y==null?defaultY:relatedCanvasInfoState.y,58,Math.max(58,dh-h-12));
  relatedCanvasInfoState.x=x;relatedCanvasInfoState.y=y;
  box.style.left=x+'px';box.style.top=y+'px';box.style.right='auto';box.style.bottom='auto';
}
function moveRelatedCanvasInfoDrag(e){
  const drag=relatedCanvasInfoDrag;if(!drag||drag.pointerId!==e.pointerId)return;
  const dw=drag.dialog.clientWidth,dh=drag.dialog.clientHeight,w=drag.box.offsetWidth,h=drag.box.offsetHeight;
  const x=clamp(Math.round(drag.originX+e.clientX-drag.startX),12,Math.max(12,dw-w-12));
  const y=clamp(Math.round(drag.originY+e.clientY-drag.startY),58,Math.max(58,dh-h-12));
  if(!relatedCanvasInfoState)relatedCanvasInfoState={};
  relatedCanvasInfoState.x=x;relatedCanvasInfoState.y=y;
  drag.box.style.left=x+'px';drag.box.style.top=y+'px';drag.box.style.right='auto';drag.box.style.bottom='auto';
  e.preventDefault();e.stopPropagation();
}
function endRelatedCanvasInfoDrag(e){
  const drag=relatedCanvasInfoDrag;if(!drag||drag.pointerId!==e.pointerId)return;
  try{drag.box.releasePointerCapture(e.pointerId)}catch{}
  drag.box.classList.remove('dragging');relatedCanvasInfoDrag=null;
  document.removeEventListener('pointermove',moveRelatedCanvasInfoDrag,true);
  document.removeEventListener('pointerup',endRelatedCanvasInfoDrag,true);
  document.removeEventListener('pointercancel',endRelatedCanvasInfoDrag,true);
  e.preventDefault();e.stopPropagation();
}
function removeRelatedCanvasInfo(){
  if(!relatedCanvasModalEl)return;
  const old=relatedCanvasModalEl.querySelector('.related-canvas-info');
  if(old)old.remove();
}
function showRelatedCanvasNodeInfo(id){
  if(!relatedCanvasModalEl)return;
  const n=nodeById(id);if(!n)return;
  removeRelatedCanvasInfo();
  if(!relatedCanvasInfoState)relatedCanvasInfoState={x:null,y:null,collapsed:false};
  const box=document.createElement('div');
  box.className='related-canvas-info'+(relatedCanvasInfoState.collapsed?' collapsed':'');
  const color=safeColor(n.color);
  box.innerHTML=`<div class="related-canvas-info-header" title="拖拽移动详情窗"><div class="detail-top"><div class="detail-mini-icon" style="background:${color}">${escapeHTML((n.title||'?').slice(0,1))}</div><div><div class="detail-name">${escapeHTML(n.title||'未命名知识点')}</div><div class="detail-title">${escapeHTML(n.category||'未填写分类')} ${n.level?`｜${escapeHTML(n.level)}`:''}</div></div></div><div class="related-canvas-info-actions"><button type="button" class="related-canvas-info-collapse" title="收起/展开" aria-label="收起/展开">${relatedCanvasInfoState.collapsed?RELATED_CANVAS_EXPAND_INFO_ICON:RELATED_CANVAS_MINIMIZE_ICON}</button><button type="button" class="related-canvas-info-close" title="关闭" aria-label="关闭">${RELATED_CANVAS_CLOSE_ICON}</button></div></div><div class="related-canvas-info-content"><div class="detail-grid"><div class="label">关键词</div><div>${escapeHTML(n.keywords||'—')}</div><div class="label">说明</div><div>${escapeHTML(n.summary||'—')}</div><div class="label">学习提示</div><div>${escapeHTML(n.notes||'—')}</div></div></div>`;
  box.querySelector('.related-canvas-info-close').onclick=()=>box.remove();
  const collapseBtn=box.querySelector('.related-canvas-info-collapse');
  collapseBtn.onclick=e=>{e.preventDefault();e.stopPropagation();relatedCanvasInfoState.collapsed=!relatedCanvasInfoState.collapsed;box.classList.toggle('collapsed',relatedCanvasInfoState.collapsed);collapseBtn.innerHTML=relatedCanvasInfoState.collapsed?RELATED_CANVAS_EXPAND_INFO_ICON:RELATED_CANVAS_MINIMIZE_ICON;requestAnimationFrame(()=>placeRelatedCanvasInfo(box))};
  box.querySelector('.related-canvas-info-header').addEventListener('pointerdown',beginRelatedCanvasInfoDrag);
  box.addEventListener('wheel',e=>e.stopPropagation(),{passive:true});
  relatedCanvasModalEl.querySelector('.related-canvas-dialog').appendChild(box);
  requestAnimationFrame(()=>placeRelatedCanvasInfo(box));
}
function closeRelatedCanvasModal(showMessage=false){
  relatedCanvasDrag=null;relatedCanvasPanDrag=null;relatedCanvasInfoDrag=null;relatedCanvasInfoState=null;
  document.removeEventListener('pointermove',moveRelatedCanvasPan,true);
  document.removeEventListener('pointerup',endRelatedCanvasPan,true);
  document.removeEventListener('pointercancel',endRelatedCanvasPan,true);
  document.removeEventListener('pointermove',moveRelatedCanvasInfoDrag,true);
  document.removeEventListener('pointerup',endRelatedCanvasInfoDrag,true);
  document.removeEventListener('pointercancel',endRelatedCanvasInfoDrag,true);
  if(relatedCanvasModalEl){relatedCanvasModalEl.remove();relatedCanvasModalEl=null}
  relatedCanvasState=null;
  document.body.classList.remove('related-canvas-open');
  if(showMessage&&typeof showStatus==='function')showStatus('已退出临时相关画布，原图谱保持不变。');
}
function relatedCanvasLinksForNodeSet(nodeIds){
  const set=new Set(nodeIds),seen=new Set(),links=[];
  const anchor=currentRelatedScopeAnchorId()||state.selectedNodeId;
  const anchorLinks=anchor?linksForNodeId(anchor):[];
  for(const l of anchorLinks){if(l&&set.has(l.from)&&set.has(l.to)&&!seen.has(l.id)){seen.add(l.id);links.push(l)}}
  for(const l of state.links){if(l&&set.has(l.from)&&set.has(l.to)&&!seen.has(l.id)){seen.add(l.id);links.push(l)}}
  return links;
}
function computeRelatedCanvasLayout(nodes,viewW,viewH){
  const anchorId=currentRelatedScopeAnchorId()||state.selectedNodeId||(nodes[0]&&nodes[0].id);
  const anchor=nodeById(anchorId)||nodes[0];
  const others=nodes.filter(n=>n&&n.id!==anchor.id).sort((a,b)=>String(a.category||'').localeCompare(String(b.category||''),'zh-Hans-CN')||String(a.title||'').localeCompare(String(b.title||''),'zh-Hans-CN'));
  const ad=nodeDims(anchor),pad=46,cellW=isCoarse?176:198,cellH=isCoarse?158:178,gapY=30;
  const maxCols=Math.max(1,Math.floor((Math.max(520,viewW)-pad*2)/cellW));
  const idealCols=Math.max(1,Math.ceil(Math.sqrt(Math.max(1,others.length)*1.45)));
  const cols=Math.max(1,Math.min(maxCols,idealCols));
  const rows=Math.max(1,Math.ceil(others.length/cols));
  const minCanvasScale=Math.max(.01,RELATED_CANVAS_MIN_SCALE||.45);
  const minVisibleW=Math.ceil(viewW/minCanvasScale),minVisibleH=Math.ceil(viewH/minCanvasScale);
  const canvasW=Math.max(minVisibleW,cols*cellW+pad*2,ad.w+pad*2);
  const canvasH=Math.max(minVisibleH,ad.h+gapY+rows*cellH+pad*2);
  const positions=new Map();
  positions.set(anchor.id,{x:Math.round((canvasW-ad.w)/2),y:pad});
  const startX=(canvasW-cols*cellW)/2,startY=pad+ad.h+gapY;
  others.forEach((n,i)=>{const d=nodeDims(n),col=i%cols,row=Math.floor(i/cols);positions.set(n.id,{x:Math.round(startX+col*cellW+(cellW-d.w)/2),y:Math.round(startY+row*cellH+(cellH-d.h)/2)})});
  return{anchorId:anchor.id,positions,width:Math.ceil(canvasW),height:Math.ceil(canvasH)};
}
function renderRelatedCanvasEdges(){
  if(!relatedCanvasState||!relatedCanvasModalEl)return;
  const svg=relatedCanvasModalEl.querySelector('.related-canvas-edges');if(!svg)return;
  svg.setAttribute('width',relatedCanvasState.width);svg.setAttribute('height',relatedCanvasState.height);svg.setAttribute('viewBox',`0 0 ${relatedCanvasState.width} ${relatedCanvasState.height}`);
  const frag=document.createDocumentFragment();
  for(const l of relatedCanvasState.links){
    const a=relatedCanvasNodeCenter(l.from),b=relatedCanvasNodeCenter(l.to);if(!a||!b)continue;
    const g=document.createElementNS('http://www.w3.org/2000/svg','g'),path=document.createElementNS('http://www.w3.org/2000/svg','path');
    path.setAttribute('class','edge-visible related-canvas-edge');path.style.setProperty('--edge-color',safeColor(l.color,DEFAULTS.linkColor));path.setAttribute('d',pathFor(a,b,pathStyleForLink(l)));
    const relatedDash=dashArrayForLineStyle(LINE_STYLES.has(l.lineStyle)?l.lineStyle:DEFAULTS.linkStyle,2.6);if(relatedDash)path.setAttribute('stroke-dasharray',relatedDash)
    g.appendChild(path);
    const labelText=l.type||l.note;
    if(labelText){const text=document.createElementNS('http://www.w3.org/2000/svg','text');text.setAttribute('text-anchor','middle');text.setAttribute('class','edge-label related-canvas-label');text.setAttribute('x',(a.x+b.x)/2);text.setAttribute('y',(a.y+b.y)/2-8);text.textContent=truncate(labelText,12);g.appendChild(text)}
    frag.appendChild(g);
  }
  svg.replaceChildren(frag);
}
function beginRelatedCanvasCardDrag(e,id){
  if(!relatedCanvasState||!relatedCanvasState.positions.has(id))return;
  const card=e.currentTarget,pos=relatedCanvasState.positions.get(id);
  relatedCanvasDrag={id,pointerId:e.pointerId,startX:e.clientX,startY:e.clientY,originX:pos.x,originY:pos.y,moved:false,card};
  card.classList.add('dragging');
  try{card.setPointerCapture(e.pointerId)}catch{}
  e.preventDefault();e.stopPropagation();
}
function moveRelatedCanvasCardDrag(e){
  const drag=relatedCanvasDrag;if(!drag||drag.pointerId!==e.pointerId||!relatedCanvasState)return;
  const scale=relatedCanvasState.scale||1,dx=(e.clientX-drag.startX)/scale,dy=(e.clientY-drag.startY)/scale;
  if(Math.hypot(e.clientX-drag.startX,e.clientY-drag.startY)>3)drag.moved=true;
  const d=nodeDims(nodeById(drag.id)),nx=clamp(Math.round(drag.originX+dx),8,Math.max(8,relatedCanvasState.width-d.w-8)),ny=clamp(Math.round(drag.originY+dy),8,Math.max(8,relatedCanvasState.height-d.h-8));
  relatedCanvasState.positions.set(drag.id,{x:nx,y:ny});
  drag.card.style.left=nx+'px';drag.card.style.top=ny+'px';
  renderRelatedCanvasEdges();
  e.preventDefault();e.stopPropagation();
}
function endRelatedCanvasCardDrag(e){
  const drag=relatedCanvasDrag;if(!drag||drag.pointerId!==e.pointerId)return false;
  try{drag.card.releasePointerCapture(e.pointerId)}catch{}
  drag.card.classList.remove('dragging');
  const wasMoved=drag.moved,id=drag.id;
  relatedCanvasDrag=null;
  e.preventDefault();e.stopPropagation();
  if(!wasMoved)showRelatedCanvasNodeInfo(id);
  return true;
}
function renderRelatedCanvasCards(){
  if(!relatedCanvasState||!relatedCanvasModalEl)return;
  const layer=relatedCanvasModalEl.querySelector('.related-canvas-cards');if(!layer)return;
  const frag=document.createDocumentFragment();
  for(const n of relatedCanvasState.nodes){
    const p=relatedCanvasState.positions.get(n.id);if(!p)continue;
    const card=renderCardElement(n,null);
    card.classList.add('related-canvas-card','readonly-card');
    if(n.id===relatedCanvasState.anchorId)card.classList.add('related-canvas-anchor-card');
    card.style.left=p.x+'px';card.style.top=p.y+'px';
    const tools=card.querySelector('.node-size-tools');if(tools)tools.remove();
    card.addEventListener('pointerdown',e=>beginRelatedCanvasCardDrag(e,n.id));
    card.addEventListener('pointermove',moveRelatedCanvasCardDrag);
    card.addEventListener('pointerup',endRelatedCanvasCardDrag);
    card.addEventListener('pointercancel',endRelatedCanvasCardDrag);
    card.addEventListener('dblclick',e=>{e.preventDefault();e.stopPropagation();showRelatedCanvasNodeInfo(n.id)});
    frag.appendChild(card);
  }
  layer.replaceChildren(frag);
}
function openRelatedCanvasModal(showMessage=true){
  const relation=largeGraphRelationState();
  if(!relation||!relation.related||!relation.related.size){showStatus('请先开启只看相关并选择中心卡牌。');return false}
  const nodes=[...relation.related].map(id=>nodeById(id)).filter(Boolean);
  if(!nodes.length)return false;
  closeRelatedCanvasModal(false);
  const overlay=document.createElement('div');overlay.className='related-canvas-backdrop';overlay.dataset.stageUi='true';
  overlay.innerHTML=`<section class="related-canvas-dialog" role="dialog" aria-modal="true" aria-label="临时相关画布"><header class="related-canvas-header"><div><strong>临时相关画布</strong><span>只读学习视图，拖拽只调整临时展示位置</span></div><div class="related-canvas-header-actions"><button type="button" class="related-canvas-tool related-canvas-zoom-out" title="缩小" aria-label="缩小">−</button><span class="related-canvas-zoom-label">100%</span><button type="button" class="related-canvas-tool related-canvas-zoom-in" title="放大" aria-label="放大">+</button><button type="button" class="related-canvas-tool related-canvas-zoom-reset" title="重置缩放" aria-label="重置缩放">1:1</button><button type="button" class="related-canvas-tool related-canvas-fullscreen-toggle" title="全屏" aria-label="全屏">${RELATED_CANVAS_FULLSCREEN_ICON}</button><button type="button" class="related-canvas-close" title="退出临时画布" aria-label="退出临时画布">${RELATED_CANVAS_CLOSE_ICON}</button></div></header><div class="related-canvas-body"><div class="related-canvas-viewport"><div class="related-canvas-stage"><svg class="related-canvas-edges"></svg><div class="related-canvas-cards"></div></div></div></div></section>`;
  overlay.addEventListener('wheel',e=>e.stopPropagation(),{passive:true});
  overlay.addEventListener('pointerdown',e=>e.stopPropagation());
  const bodyEl=overlay.querySelector('.related-canvas-body');
  bodyEl.addEventListener('wheel',e=>{if(e.target&&e.target.closest&&e.target.closest('.related-canvas-info'))return;e.preventDefault();e.stopPropagation();const factor=e.deltaY<0?RELATED_CANVAS_SCALE_STEP:1/RELATED_CANVAS_SCALE_STEP;setRelatedCanvasScale((relatedCanvasState&&relatedCanvasState.scale||1)*factor,e)},{passive:false});
  bodyEl.addEventListener('pointerdown',beginRelatedCanvasPan);
  overlay.querySelector('.related-canvas-zoom-out').onclick=()=>setRelatedCanvasScale((relatedCanvasState&&relatedCanvasState.scale||1)/RELATED_CANVAS_SCALE_STEP);
  overlay.querySelector('.related-canvas-zoom-in').onclick=()=>setRelatedCanvasScale((relatedCanvasState&&relatedCanvasState.scale||1)*RELATED_CANVAS_SCALE_STEP);
  overlay.querySelector('.related-canvas-zoom-reset').onclick=()=>resetRelatedCanvasScale();
  overlay.querySelector('.related-canvas-fullscreen-toggle').onclick=()=>toggleRelatedCanvasFullscreen();
  overlay.querySelector('.related-canvas-close').onclick=()=>closeRelatedCanvasModal(true);
  overlay.addEventListener('click',e=>{if(e.target===overlay)closeRelatedCanvasModal(true)});
  document.body.appendChild(overlay);document.body.classList.add('related-canvas-open');relatedCanvasModalEl=overlay;
  requestAnimationFrame(()=>{
    const body=overlay.querySelector('.related-canvas-body'),stageEl=overlay.querySelector('.related-canvas-stage');
    const bw=Math.max(720,body.clientWidth||1200),bh=Math.max(520,body.clientHeight||760);
    const layout=computeRelatedCanvasLayout(nodes,bw,bh);
    const nodeIds=nodes.map(n=>n.id),links=relatedCanvasLinksForNodeSet(nodeIds);
    relatedCanvasState={nodes,links,positions:layout.positions,anchorId:layout.anchorId,width:layout.width,height:layout.height,scale:1,panX:0,panY:0};
    stageEl.style.width=layout.width+'px';stageEl.style.height=layout.height+'px';
    centerRelatedCanvasStage();
    applyRelatedCanvasScale();
    renderRelatedCanvasEdges();renderRelatedCanvasCards();
    showRelatedCanvasNodeInfo(layout.anchorId);
  });
  if(showMessage)showStatus(`已打开临时相关画布：${nodes.length} 张卡牌，关闭后原图谱保持不变。`);
  return true;
}
window.closeRelatedCanvasModal=closeRelatedCanvasModal;
function isLargeGraphPreferenceEnabled(){
  const prefs=window.KGGraphUserPreferences&&typeof window.KGGraphUserPreferences.get==='function'?window.KGGraphUserPreferences.get():null;
  return !prefs||prefs.largeGraphMode!==false;
}
function isGraphOverLargeThreshold(){return state.nodes.length>=LARGE_GRAPH_NODE_THRESHOLD||state.links.length>=LARGE_GRAPH_LINK_THRESHOLD}
function isLargeGraphMode(){return isLargeGraphPreferenceEnabled()}
function shouldShowLargeGraphOverview(){return !!(isLargeGraphMode()&&largeGraphOverviewEnabled)}
function normalizeRelatedScopeAnchor(){
  if(relatedScopeAnchorNodeId&&!nodeById(relatedScopeAnchorNodeId))relatedScopeAnchorNodeId=null;
  return relatedScopeAnchorNodeId;
}
function currentRelatedScopeAnchorId(){
  normalizeRelatedScopeAnchor();
  return largeGraphRelatedFocusEnabled&&relatedScopeAnchorNodeId?relatedScopeAnchorNodeId:null;
}
function relationLayerEnabled(){return !!(flowModeEnabled||largeGraphRelatedFocusEnabled)}
let focusVisualTransitionTimer=null;
function shouldReduceFocusMotion(){
  const root=document.documentElement,body=document.body;
  return !!((window.matchMedia&&window.matchMedia('(prefers-reduced-motion: reduce)').matches)||
    (root&&root.classList&&root.classList.contains('kg-perf-no-animations'))||
    (body&&body.classList&&body.classList.contains('kg-perf-no-animations')));
}
function beginFocusVisualTransition(duration=560){
  if(!stage||shouldReduceFocusMotion())return;
  clearTimeout(focusVisualTransitionTimer);
  stage.classList.add('focus-visual-transition');
  focusVisualTransitionTimer=setTimeout(()=>stage.classList.remove('focus-visual-transition'),Math.max(120,duration));
}
function updateFlowModeButton(){
  const btn=$('flowModeBtn');if(!btn)return;
  btn.classList.toggle('active-toggle',!!flowModeEnabled);
  const txt='心流 L';
  btn.setAttribute('aria-label',txt);
  btn.removeAttribute('title');
  btn.dataset.tooltip=txt;
}
function toggleFlowMode(){
  beginFocusVisualTransition();
  flowModeEnabled=!flowModeEnabled;
  syncGraphModeClasses();
  renderHeader();
  renderEdges();
  refreshCardClasses();
  renderDetails();
  updateCardQuickActions();
  showStatus(flowModeEnabled?'已开启心流模式：点击卡牌会突出相关内容，弱化无关内容。':'已关闭心流模式：制作时点击卡牌不再触发大范围弱化。');
}
let hoverLargeGraphNodeId=null,hoverLargeGraphTimer=null;
const LARGE_GRAPH_HOVER_DETAIL_DELAY=650,LARGE_GRAPH_HOVER_RELATION_DELAY=120;
function largeGraphLocalIds(){
  const ids=new Set();
  const lockedAnchor=currentRelatedScopeAnchorId();
  if(lockedAnchor)ids.add(lockedAnchor);
  else{
    if(state.selectedNodeId)ids.add(state.selectedNodeId);
    if(state.linkSourceId)ids.add(state.linkSourceId);
    if(hoverLargeGraphNodeId&&!state.selectedNodeId&&!state.selectedLinkId)ids.add(hoverLargeGraphNodeId);
    if(selectedNodeIds&&selectedNodeIds.size&&selectedNodeIds.size<=8)selectedNodeIds.forEach(id=>ids.add(id));
  }
  return ids;
}
function largeGraphExplorationIds(){
  const ids=new Set();
  const lockedAnchor=currentRelatedScopeAnchorId();
  if(lockedAnchor){
    ids.add(lockedAnchor);
  }else{
    if(state.selectedNodeId)ids.add(state.selectedNodeId);
    if(state.linkSourceId)ids.add(state.linkSourceId);
    if(state.selectedLinkId){
      const l=linkById(state.selectedLinkId);
      if(l){ids.add(l.from);ids.add(l.to)}
    }
    if(selectedNodeIds&&selectedNodeIds.size&&selectedNodeIds.size<=8)selectedNodeIds.forEach(id=>ids.add(id));
  }
  return ids;
}
function largeGraphRelationState(){
  const anchors=largeGraphExplorationIds();
  if(!anchors.size)return null;
  const related=new Set(anchors),seenLinks=new Set();
  let linkCount=0;
  for(const id of anchors){
    for(const link of linksForNodeId(id)){
      if(!link||seenLinks.has(link.id))continue;
      seenLinks.add(link.id);
      linkCount++;
      related.add(link.from);
      related.add(link.to);
    }
  }
  return{anchors,related,linkCount,relatedCount:Math.max(0,related.size-anchors.size)};
}
function hasLargeGraphLocalContext(){return largeGraphLocalIds().size>0}
function syncGraphModeClasses(){
  normalizeRelatedScopeAnchor();
  const large=isLargeGraphMode(),hasLocal=large&&hasLargeGraphLocalContext(),showOverview=large&&largeGraphOverviewEnabled,relationState=largeGraphRelationState(),relationVisual=!!relationState&&relationLayerEnabled();
  stage.classList.toggle('focus-mode',!!state.focusMode);
  stage.classList.toggle('flow-mode',!!flowModeEnabled);
  stage.classList.toggle('graph-gather-layout',isRelatedGatherActive());
  stage.classList.toggle('large-graph-mode',large);
  stage.classList.toggle('large-graph-local-relations',hasLocal);
  stage.classList.toggle('large-graph-overview-relations',showOverview);
  stage.classList.toggle('large-graph-lines-off',large&&!hasLocal&&!largeGraphOverviewEnabled);
  stage.classList.toggle('graph-trunk-lines',!large&&largeGraphOverviewEnabled);
  stage.classList.toggle('graph-related-focus',relationVisual);
  stage.classList.toggle('graph-related-only',!!relationState&&largeGraphRelatedFocusEnabled);
  stage.classList.toggle('large-graph-related-focus',large&&relationVisual);
  stage.classList.toggle('large-graph-related-only',large&&!!relationState&&largeGraphRelatedFocusEnabled);
  if(large&&isGraphOverLargeThreshold()&&!largeGraphModeNotified){
    largeGraphModeNotified=true;
    if(typeof showStatus==='function')showStatus(`当前图谱达到中型以上规模（${state.nodes.length} 个知识点 / ${state.links.length} 条关系），大图模式已启用：默认关闭主干关系线，选中卡牌后显示局部关系。`);
  }
  if(!large)largeGraphModeNotified=false;
  updateLargeGraphLinesButton();
  updateLargeGraphRelatedButton();
  updateFlowModeButton();
  return large;
}
function render(options={}){if(options&&options.persist)invalidateGraphSearchIndex();syncGraphModeClasses();applyTransform();renderHeader();renderEdges();renderCards();renderDetails();renderSelectedEdgeQuickStylePanel();updateCardQuickActions();if(options&&options.persist)save()}
window.addEventListener('kg-graph-preferences-change',event=>{
  const keys=event&&event.detail&&Array.isArray(event.detail.changedKeys)?event.detail.changedKeys:[];
  if(!keys.includes('largeGraphMode'))return;
  hoverLargeGraphNodeId=null;
  largeGraphModeNotified=false;
  render();
  showStatus(isLargeGraphMode()?'已开启大图模式：任何数量的卡牌都会使用大图渲染策略。':'已关闭大图模式：当前按普通图谱模式显示，关系线较多时可能变卡。');
});
function updateLargeGraphLinesButton(){
  const btn=$('largeGraphLinesBtn');if(!btn)return;
  const on=largeGraphOverviewEnabled;
  btn.classList.toggle('active-toggle',on);
  btn.classList.remove('soft-disabled');
  const txt='主干线 G';
  btn.setAttribute('aria-label',txt);
  btn.removeAttribute('title');
  btn.dataset.tooltip=txt;
}
function toggleLargeGraphOverviewRelations(){
  beginFocusVisualTransition(500);
  const large=isLargeGraphMode();
  largeGraphOverviewEnabled=!largeGraphOverviewEnabled;
  hoverLargeGraphNodeId=null;
  syncGraphModeClasses();
  renderHeader();
  renderEdges();
  if(large){
    showStatus(largeGraphOverviewEnabled?'已显示大图谱主干关系线。选中卡牌仍会优先显示局部关系。':'已关闭大图谱主干关系线。请选中卡牌查看局部关系。');
  }else{
    showStatus(largeGraphOverviewEnabled?'已显示骨架线：当前仅展示知识结构主线，选中卡牌后仍保留一度局部关系。':'已关闭骨架线，已恢复普通模式全部关系线。');
  }
}
function updateLargeGraphRelatedButton(){
  const btn=$('largeGraphRelatedBtn');if(!btn)return;
  const hasRelation=!!largeGraphRelationState(),on=largeGraphRelatedFocusEnabled;
  btn.classList.toggle('active-toggle',on);
  btn.classList.remove('soft-disabled');
  btn.classList.toggle('needs-selection',!hasRelation);
  const txt='相关 R';
  btn.setAttribute('aria-label',txt);
  btn.removeAttribute('title');
  btn.dataset.tooltip=txt;
}
function toggleLargeGraphRelatedFocus(){
  beginFocusVisualTransition();
  largeGraphRelatedFocusEnabled=!largeGraphRelatedFocusEnabled;
  if(largeGraphRelatedFocusEnabled){
    if(state.selectedNodeId)relatedScopeAnchorNodeId=state.selectedNodeId;
    else if(!relatedScopeAnchorNodeId)normalizeRelatedScopeAnchor();
  }else{
    relatedScopeAnchorNodeId=null;
    clearRelatedGatherLayout({render:false,message:false});
  }
  syncGraphModeClasses();
  refreshCardClasses();
  renderEdges();
  renderDetails();
  updateCardQuickActions();
  const relation=largeGraphRelationState(),anchor=nodeById(currentRelatedScopeAnchorId());
  if(largeGraphRelatedFocusEnabled){
    showStatus(relation?`已开启只看相关：以“${anchor?anchor.title:'当前卡牌'}”为中心，显示 ${relation.related.size} 个相关知识点、${relation.linkCount} 条局部关系。`:'已开启只看相关。请先选中一张卡牌。');
  }else{
    showStatus('已显示全部卡牌。');
  }
}
function renderHeader(){ const fileStore=window.KGGraphFileStore,currentFile=fileStore&&fileStore.getCurrentFileMeta?fileStore.getCurrentFileMeta():(fileStore&&fileStore.getCurrentFile?fileStore.getCurrentFile():null),currentName=currentFile&&currentFile.name||state.meta.title||'知识点关系图谱',titleEl=$('appTitle'),subtitleEl=$('appSubtitle');if(titleEl){titleEl.textContent=currentName;titleEl.title=currentName}if(subtitleEl){const subtitle=[state.meta.subject,state.meta.audience].filter(Boolean).join('｜')||'通用知识图谱工具';subtitleEl.textContent=subtitle;subtitleEl.title=subtitle} const txt=state.focusMode?'退出聚焦':'重点聚焦',focus=$('focusBtn'),mobileFocus=$('mFocusBtn');if(focus){focus.setAttribute('aria-label',txt);focus.setAttribute('title',txt);focus.dataset.tooltip=txt;focus.classList.toggle('active-toggle',!!state.focusMode)}if(mobileFocus)mobileFocus.textContent=txt; updateLargeGraphLinesButton();updateLargeGraphRelatedButton();updateFlowModeButton();updateStyleControls() }
let edgeDomById=new Map(),cardDomById=new Map();
function updateLinkGeometry(link,nodeMap){const dom=edgeDomById.get(link&&link.id);if(!dom)return false;const a=(nodeMap&&nodeMap.get(link.from))||nodeById(link.from),b=(nodeMap&&nodeMap.get(link.to))||nodeById(link.to);if(!a||!b)return false;const ca=nodeCenter(a),cb=nodeCenter(b),d=pathFor(ca,cb,pathStyleForLink(link));dom.hit.setAttribute('d',d);dom.vis.setAttribute('d',d);if(dom.label){dom.label.setAttribute('x',(ca.x+cb.x)/2);dom.label.setAttribute('y',(ca.y+cb.y)/2-8)}if(state.selectedLinkId===link.id)updateSelectedEdgeQuickStylePosition();return true}
let selectedEdgeQuickStylePanel=null,selectedEdgeQuickStyleAnchorWorld=null;
function ensureSelectedEdgeQuickStylePanel(){
  if(selectedEdgeQuickStylePanel&&selectedEdgeQuickStylePanel.isConnected)return selectedEdgeQuickStylePanel;
  const panel=document.createElement('div');
  panel.id='edgeQuickStylePanel';
  panel.className='edge-quick-style-panel edge-radial-style-panel';
  panel.dataset.stageUi='true';
  panel.setAttribute('role','group');
  panel.setAttribute('aria-label','关系线快捷样式');
  panel.innerHTML='<button type="button" class="edge-radial-btn edge-radial-dashed" data-line-style="dashed" aria-label="长虚线" title="长虚线"><svg aria-hidden="true" viewBox="0 0 24 24"><rect x="2" y="11" width="8" height="2"/><rect x="14" y="11" width="8" height="2"/></svg></button><button type="button" class="edge-radial-btn edge-radial-solid" data-line-style="solid" aria-label="实线" title="实线"><svg aria-hidden="true" viewBox="0 0 24 24"><path d="M4 12h16"/></svg></button><button type="button" class="edge-radial-btn edge-radial-dotted" data-line-style="dotted" aria-label="短虚线" title="短虚线"><svg aria-hidden="true" viewBox="0 0 24 24"><rect x="2" y="10.5" width="3" height="3"/><rect x="7.5" y="10.5" width="3" height="3"/><rect x="13" y="10.5" width="3" height="3"/><rect x="18.5" y="10.5" width="3" height="3"/></svg></button><button type="button" class="edge-radial-btn edge-radial-label" data-edge-action="label" aria-label="编辑关系文字" title="文字"><span class="edge-radial-text-icon">T</span></button><label class="edge-radial-btn edge-radial-color" aria-label="修改关系线颜色" title="颜色"><input class="edge-radial-color-input" type="color" aria-label="修改关系线颜色"/><span class="edge-radial-color-dot"></span></label><button type="button" class="edge-radial-btn edge-radial-straight" data-path-style="straight" aria-label="直线" title="直线"><svg aria-hidden="true" viewBox="0 0 24 24"><path d="M4 18 20 6"/></svg></button><button type="button" class="edge-radial-btn edge-radial-elbow" data-path-style="elbow" aria-label="折线" title="折线"><svg aria-hidden="true" viewBox="0 0 24 24"><path d="M5 7h7v10h7"/></svg></button><button type="button" class="edge-radial-btn edge-radial-curve" data-path-style="curve" aria-label="曲线" title="曲线"><svg aria-hidden="true" viewBox="0 0 24 24"><path d="M4 17 C8 6, 16 18, 20 7"/></svg></button>';
  panel.addEventListener('pointerdown',e=>{e.stopPropagation()});
  panel.addEventListener('dblclick',e=>{e.stopPropagation()});
  panel.addEventListener('click',e=>{
    const actionBtn=e.target.closest&&e.target.closest('[data-edge-action]');
    const lineBtn=e.target.closest&&e.target.closest('[data-line-style]');
    const pathBtn=e.target.closest&&e.target.closest('[data-path-style]');
    if(!actionBtn&&!lineBtn&&!pathBtn)return;
    e.preventDefault();
    e.stopPropagation();
    if(actionBtn){
      const action=actionBtn.dataset.edgeAction;
      if(action==='label'){
        const id=state.selectedLinkId,pt=selectedEdgeQuickScreenPoint(),sr=stage.getBoundingClientRect();
        if(id){
          const anchorEvent=pt?{clientX:sr.left+pt.x,clientY:sr.top+pt.y}:e;
          openEdgeInlineLabelEditor(id,anchorEvent);
          hideSelectedEdgeQuickStylePanel();
        }
        return;
      }
    }
    if(lineBtn){
      const style=lineBtn.dataset.lineStyle;
      if(LINE_STYLES.has(style)&&typeof applyLineStyle==='function')applyLineStyle(style);
      return;
    }
    const style=pathBtn.dataset.pathStyle;
    if(LINE_PATH_STYLES.has(style)&&typeof applyPathStyle==='function')applyPathStyle(style);
  });
  const colorInput=panel.querySelector('.edge-radial-color-input');
  if(colorInput){
    colorInput.addEventListener('pointerdown',e=>e.stopPropagation());
    colorInput.addEventListener('click',e=>e.stopPropagation());
    colorInput.addEventListener('input',e=>{
      e.stopPropagation();
      if(typeof applyLineColor==='function')applyLineColor(e.target.value);
    });
  }
  stage.appendChild(panel);
  selectedEdgeQuickStylePanel=panel;
  return panel;
}
function selectedEdgeQuickScreenPoint(){
  const link=linkById(state.selectedLinkId);
  if(!link)return null;
  const a=nodeById(link.from),b=nodeById(link.to);
  if(!a||!b)return null;
  const ca=nodeCenter(a),cb=nodeCenter(b);
  const fallback={x:((ca.x+cb.x)/2)*state.viewport.scale+state.viewport.x,y:((ca.y+cb.y)/2)*state.viewport.scale+state.viewport.y,link};
  if(selectedEdgeQuickStyleAnchorWorld){
    return{x:selectedEdgeQuickStyleAnchorWorld.x*state.viewport.scale+state.viewport.x,y:selectedEdgeQuickStyleAnchorWorld.y*state.viewport.scale+state.viewport.y,link};
  }
  return fallback;
}
function setSelectedEdgeQuickStyleAnchorFromEvent(event){
  if(event&&Number.isFinite(event.clientX)&&Number.isFinite(event.clientY)){
    selectedEdgeQuickStyleAnchorWorld=screenToWorld(event.clientX,event.clientY);
  }else{
    selectedEdgeQuickStyleAnchorWorld=null;
  }
}
function updateSelectedEdgeQuickStylePosition(){
  const panel=selectedEdgeQuickStylePanel;
  if(!panel||!panel.isConnected||!panel.classList.contains('show'))return;
  const pt=selectedEdgeQuickScreenPoint();
  if(!pt){hideSelectedEdgeQuickStylePanel();return}
  const pad=10,w=panel.offsetWidth||160,h=panel.offsetHeight||160;
  let x=pt.x-w/2,y=pt.y-h/2;
  x=clamp(x,pad,Math.max(pad,stage.clientWidth-w-pad));
  y=clamp(y,pad,Math.max(pad,stage.clientHeight-h-pad));
  panel.style.left=Math.round(x)+'px';
  panel.style.top=Math.round(y)+'px';
}
function hideSelectedEdgeQuickStylePanel(){
  if(selectedEdgeQuickStylePanel)selectedEdgeQuickStylePanel.classList.remove('show');
  selectedEdgeQuickStyleAnchorWorld=null;
}
function renderSelectedEdgeQuickStylePanel(){
  const link=linkById(state.selectedLinkId);
  if(!link){hideSelectedEdgeQuickStylePanel();hideEdgeInlineLabelEditor();return}
  const panel=ensureSelectedEdgeQuickStylePanel();
  const style=LINE_STYLES.has(link.lineStyle)?link.lineStyle:DEFAULTS.linkStyle;
  const pathStyle=pathStyleForLink(link);
  const edgeColor=safeColor(link.color,DEFAULTS.linkColor);panel.style.setProperty('--edge-radial-color',edgeColor);const colorInput=panel.querySelector('.edge-radial-color-input');if(colorInput&&colorInput.value!==edgeColor)colorInput.value=edgeColor;
  panel.querySelectorAll('[data-line-style]').forEach(btn=>btn.classList.toggle('active',btn.dataset.lineStyle===style));
  panel.querySelectorAll('[data-path-style]').forEach(btn=>btn.classList.toggle('active',btn.dataset.pathStyle===pathStyle));
  panel.classList.add('show');
  updateSelectedEdgeQuickStylePosition();
}

let edgeInlineLabelEditorEl=null,edgeInlineLabelEditingId=null,edgeInlineLabelAnchorWorld=null;
function ensureEdgeInlineLabelEditor(){
  if(edgeInlineLabelEditorEl&&edgeInlineLabelEditorEl.isConnected)return edgeInlineLabelEditorEl;
  const editor=document.createElement('div');
  editor.id='edgeInlineLabelEditor';
  editor.className='edge-inline-label-editor';
  editor.dataset.stageUi='true';
  editor.setAttribute('role','dialog');
  editor.setAttribute('aria-label','编辑关系文字');
  editor.innerHTML='<input id="edgeInlineLabelInput" type="text" maxlength="60" placeholder="输入关系文字" autocomplete="off"/>';
  editor.addEventListener('pointerdown',e=>{e.stopPropagation()});
  editor.addEventListener('dblclick',e=>{e.stopPropagation()});
  const input=editor.querySelector('input');
  input.addEventListener('keydown',e=>{
    if(e.key==='Enter'){e.preventDefault();e.stopPropagation();commitEdgeInlineLabelEditor()}
    else if(e.key==='Escape'){e.preventDefault();e.stopPropagation();cancelEdgeInlineLabelEditor()}
  });
  input.addEventListener('blur',()=>{if(editor.classList.contains('show'))commitEdgeInlineLabelEditor()});
  stage.appendChild(editor);
  edgeInlineLabelEditorEl=editor;
  return editor;
}
function setEdgeInlineLabelAnchorFromEvent(event){
  if(event&&Number.isFinite(event.clientX)&&Number.isFinite(event.clientY))edgeInlineLabelAnchorWorld=screenToWorld(event.clientX,event.clientY);
  else edgeInlineLabelAnchorWorld=null;
}
function edgeInlineLabelScreenPoint(){
  const link=linkById(edgeInlineLabelEditingId||state.selectedLinkId);
  if(!link)return null;
  const a=nodeById(link.from),b=nodeById(link.to);
  if(!a||!b)return null;
  if(edgeInlineLabelAnchorWorld)return{x:edgeInlineLabelAnchorWorld.x*state.viewport.scale+state.viewport.x,y:edgeInlineLabelAnchorWorld.y*state.viewport.scale+state.viewport.y};
  const ca=nodeCenter(a),cb=nodeCenter(b);
  return{x:((ca.x+cb.x)/2)*state.viewport.scale+state.viewport.x,y:((ca.y+cb.y)/2)*state.viewport.scale+state.viewport.y};
}
function updateEdgeInlineLabelEditorPosition(){
  const editor=edgeInlineLabelEditorEl;
  if(!editor||!editor.isConnected||!editor.classList.contains('show'))return;
  const pt=edgeInlineLabelScreenPoint();
  if(!pt){hideEdgeInlineLabelEditor();return}
  const pad=10,w=editor.offsetWidth||210,h=editor.offsetHeight||42;
  let x=pt.x+12,y=pt.y-h-14;
  if(x+w+pad>stage.clientWidth)x=pt.x-w-12;
  if(y<pad)y=pt.y+14;
  x=clamp(x,pad,Math.max(pad,stage.clientWidth-w-pad));
  y=clamp(y,pad,Math.max(pad,stage.clientHeight-h-pad));
  editor.style.left=Math.round(x)+'px';
  editor.style.top=Math.round(y)+'px';
}
function hideEdgeInlineLabelEditor(){
  if(edgeInlineLabelEditorEl)edgeInlineLabelEditorEl.classList.remove('show');
  edgeInlineLabelEditingId=null;
  edgeInlineLabelAnchorWorld=null;
}
function openEdgeInlineLabelEditor(id,event=null){
  const link=linkById(id);
  if(!link)return;
  if(typeof authRequire==='function'&&!authRequire('登录后才能编辑关系文字。'))return;
  clearMultiSelection();
  clearHoverDetail(false);
  setSelectedEdgeQuickStyleAnchorFromEvent(event);
  setEdgeInlineLabelAnchorFromEvent(event);
  state.selectedLinkId=id;
  state.selectedNodeId=null;
  state.linkSourceId=null;
  refreshSelectionUI();
  edgeInlineLabelEditingId=id;
  const editor=ensureEdgeInlineLabelEditor(),input=editor.querySelector('input');
  input.value=String(link.type||'');
  input.placeholder='输入关系文字';
  editor.classList.add('show');
  updateEdgeInlineLabelEditorPosition();
  setTimeout(()=>{input.focus();input.select()},20);
  showStatus('正在编辑关系文字：Enter 保存，Esc 取消，留空可清除文字。');
}
function commitEdgeInlineLabelEditor(){
  const editor=edgeInlineLabelEditorEl,input=editor&&editor.querySelector('input'),link=linkById(edgeInlineLabelEditingId);
  if(!editor||!input||!link){hideEdgeInlineLabelEditor();return false}
  const oldText=String(link.type||''),nextText=String(input.value||'').trim().slice(0,60);
  hideEdgeInlineLabelEditor();
  if(nextText===oldText){renderSelectedEdgeQuickStylePanel();return true}
  pushGraphUndoSnapshot('修改关系文字');
  link.type=nextText;
  render({persist:true});
  showStatus(nextText?`已更新关系文字：${nextText}`:'已清空关系文字。');
  return true;
}
function cancelEdgeInlineLabelEditor(){
  hideEdgeInlineLabelEditor();
  renderSelectedEdgeQuickStylePanel();
  showStatus('已取消编辑关系文字。');
}
function isLargeGraphOverviewNode(n){
  if(!n)return false;
  const cat=String(n.category||''),title=String(n.title||''),size=String(n.size||'');
  return size==='big'||isImportant(n)||/绩效领域|聚焦区|核心原则|原则/.test(cat)||/^绩效领域：|^聚焦区：|^原则：/.test(title);
}
function isLargeGraphOverviewLink(link,a,b){
  if(!link||!a||!b)return false;
  const t=String(link.type||'');
  if(/展开|定位|流转|指导|关联|支撑/.test(t))return true;
  return isLargeGraphOverviewNode(a)&&isLargeGraphOverviewNode(b);
}
function isNormalGraphTrunkNode(n){
  if(!n)return false;
  const title=String(n.title||''),cat=String(n.category||''),level=String(n.level||'');
  if(/总览|PMP 第八版知识图谱|PMP第八版知识图谱/.test(title))return true;
  if(/原则：|绩效领域|聚焦区：/.test(title))return true;
  if(/总览|项目管理原则|绩效领域/.test(cat))return true;
  return level.trim()==='重点';
}
function isNormalGraphTrunkLink(link,a,b){
  if(!link||!a||!b)return false;
  const t=String(link.type||link.note||'');
  if(/包含|展开|指导|支撑|核心|主线|骨架|总览|原则|绩效领域/.test(t))return true;
  return isNormalGraphTrunkNode(a)&&isNormalGraphTrunkNode(b);
}
function normalModeEdgeLabelNodeIds(){
  const ids=new Set();
  if(state.selectedNodeId)ids.add(state.selectedNodeId);
  if(state.linkSourceId)ids.add(state.linkSourceId);
  if(selectedNodeIds&&selectedNodeIds.size)selectedNodeIds.forEach(id=>ids.add(id));
  return ids;
}
function shouldShowEdgeLabel(link,large,edgeIsLocal,labelText,labelCount,normalLabelNodeIds){
  if(!labelText)return false;
  if(state.selectedLinkId===link.id)return true;
  if(large)return !!(edgeIsLocal&&labelCount<LARGE_GRAPH_SELECTED_LABEL_LIMIT);
  return !!(normalLabelNodeIds&&normalLabelNodeIds.size&&(normalLabelNodeIds.has(link.from)||normalLabelNodeIds.has(link.to)));
}
function shouldRenderLinkInCurrentMode(link,nodeMap,localIds,renderedCount){
  if(!link)return false;
  if(!isLargeGraphMode()){
    if(state.selectedLinkId===link.id)return true;
    const localMatch=!!(localIds&&localIds.size&&(localIds.has(link.from)||localIds.has(link.to)));
    if(largeGraphRelatedFocusEnabled&&localIds&&localIds.size)return localMatch;
    const a=(nodeMap&&nodeMap.get(link.from))||nodeById(link.from),b=(nodeMap&&nodeMap.get(link.to))||nodeById(link.to);
    if(!a||!b)return false;
    if(largeGraphOverviewEnabled){
      if(localMatch)return true;
      return isNormalGraphTrunkLink(link,a,b);
    }
    return true;
  }
  if(state.selectedLinkId===link.id)return true;
  const a=(nodeMap&&nodeMap.get(link.from))||nodeById(link.from),b=(nodeMap&&nodeMap.get(link.to))||nodeById(link.to);
  if(!a||!b)return false;
  const localMatch=!!(localIds&&localIds.size&&(localIds.has(link.from)||localIds.has(link.to)));
  if(largeGraphRelatedFocusEnabled&&localIds&&localIds.size){
    if(!localMatch)return false;
    return renderedCount<LARGE_GRAPH_SELECTED_LINK_LIMIT;
  }
  if(localIds&&localIds.size&&localMatch)return renderedCount<LARGE_GRAPH_SELECTED_LINK_LIMIT;
  if(!largeGraphOverviewEnabled)return false;
  const overlayLimit=(localIds&&localIds.size)?Math.max(LARGE_GRAPH_OVERVIEW_LINK_LIMIT,LARGE_GRAPH_SELECTED_LINK_LIMIT+60):LARGE_GRAPH_OVERVIEW_LINK_LIMIT;
  if(renderedCount>=overlayLimit)return false;
  return isLargeGraphOverviewLink(link,a,b);
}
function renderEdges(){
  const nodeMap=getGraphIndex().nodeMap,frag=document.createDocumentFragment(),nextEdgeDom=new Map(),large=isLargeGraphMode(),relationState=largeGraphRelationState();
  const normalLocalMode=!large&&relationState&&(largeGraphRelatedFocusEnabled||largeGraphOverviewEnabled);
  const localIds=large?largeGraphLocalIds():(normalLocalMode?relationState.anchors:new Set());
  const normalLabelNodeIds=large?null:normalModeEdgeLabelNodeIds();
  let renderedCount=0,labelCount=0;
  for(const link of state.links){
    if(!shouldRenderLinkInCurrentMode(link,nodeMap,localIds,renderedCount))continue;
    const a=nodeMap.get(link.from),b=nodeMap.get(link.to);if(!a||!b)continue;
    const edgeIsLocal=!!(localIds&&localIds.size&&(localIds.has(link.from)||localIds.has(link.to)));
    renderedCount++;
    const g=document.createElementNS('http://www.w3.org/2000/svg','g'),hit=document.createElementNS('http://www.w3.org/2000/svg','path'),vis=document.createElementNS('http://www.w3.org/2000/svg','path');
    const lineColor=safeColor(link.color,DEFAULTS.linkColor),lineStyle=LINE_STYLES.has(link.lineStyle)?link.lineStyle:DEFAULTS.linkStyle,importantLink=!!state.focusMode&&isImportant(a)&&isImportant(b),normalRelationLayer=!large&&relationLayerEnabled()&&relationState&&relationState.anchors&&relationState.anchors.size?(relationState.anchors.has(link.from)||relationState.anchors.has(link.to)?'active':'muted'):'';
    g.setAttribute('data-link-id',link.id);
    if(large)g.setAttribute('data-large-edge-mode',edgeIsLocal?'local':'overview');
    if(normalRelationLayer)g.setAttribute('data-relation-layer',normalRelationLayer);
    hit.setAttribute('class','edge-hit'+(state.selectedLinkId===link.id?' selected':'')+(normalRelationLayer==='active'?' edge-related-active':'')+(normalRelationLayer==='muted'?' edge-related-muted':''));
    const interactive=normalRelationLayer!=='muted';
    // v7.9.20：大图模式下已渲染的主干/骨架线也允许单击选中、双击就地编辑文字。
    if(interactive){
      hit.addEventListener('pointerdown',e=>{if(isCanvasPanMode()||e.button===2)return;e.stopPropagation()});
      hit.addEventListener('click',e=>{if(isCanvasPanMode()){e.preventDefault();return}e.stopPropagation();selectLink(link.id,e)});
      hit.addEventListener('dblclick',e=>{if(isCanvasPanMode()){e.preventDefault();return}e.preventDefault();e.stopPropagation();if(e.altKey)openLinkModal(link.id);else openEdgeInlineLabelEditor(link.id,e)});
    }
    vis.setAttribute('class','edge-visible'+(importantLink?' focus-important-edge':'')+(normalRelationLayer==='active'?' edge-related-active':'')+(normalRelationLayer==='muted'?' edge-related-muted':''));
    vis.style.setProperty('--edge-color',lineColor);
    const dashArray=dashArrayForLineStyle(lineStyle,4);if(dashArray)vis.setAttribute('stroke-dasharray',dashArray)
    g.appendChild(hit);g.appendChild(vis);
    let label=null;
    const labelText=link.type||link.note;
    const showLabel=shouldShowEdgeLabel(link,large,edgeIsLocal,labelText,labelCount,normalLabelNodeIds);
    if(showLabel&&labelText){
      labelCount++;
      label=document.createElementNS('http://www.w3.org/2000/svg','text');
      label.setAttribute('text-anchor','middle');
      label.setAttribute('class','edge-label'+(state.selectedLinkId===link.id?' edge-selected-label':'')+(importantLink?' focus-important-label':'')+(normalRelationLayer==='active'?' edge-related-active':'')+(normalRelationLayer==='muted'?' edge-related-muted':''));
      label.textContent=truncate(labelText,12);
      g.appendChild(label);
    }
    nextEdgeDom.set(link.id,{g,hit,vis,label,link});
    frag.appendChild(g);
  }
  edgeDomById=nextEdgeDom;
  for(const link of state.links){if(edgeDomById.has(link.id))updateLinkGeometry(link,nodeMap)}
  edgeGroup.replaceChildren(frag);
}
let edgeRenderPending=false,edgeGeometryRenderPending=false,pendingEdgeNodeIds=new Set();
function requestEdgeRender(){if(edgeRenderPending)return;edgeRenderPending=true;requestAnimationFrame(()=>{edgeRenderPending=false;renderEdges()})}
function updateVisibleLinkGeometryForDrag(link,dom,nodeMap){
  if(!link||!dom||!dom.vis)return false;
  const a=(nodeMap&&nodeMap.get(link.from))||nodeById(link.from),b=(nodeMap&&nodeMap.get(link.to))||nodeById(link.to);
  if(!a||!b)return false;
  const ca=nodeCenter(a),cb=nodeCenter(b),d=pathFor(ca,cb,pathStyleForLink(link));
  dom.vis.setAttribute('d',d);
  if(!isLargeGraphMode()){
    if(dom.hit)dom.hit.setAttribute('d',d);
    if(dom.label){dom.label.setAttribute('x',(ca.x+cb.x)/2);dom.label.setAttribute('y',(ca.y+cb.y)/2-8)}
  }
  return true;
}
function requestLinkedEdgeGeometryRender(nodeIds){
  const ids=Array.isArray(nodeIds)?nodeIds:[nodeIds];ids.forEach(id=>{if(id)pendingEdgeNodeIds.add(id)});
  if(edgeGeometryRenderPending)return;
  edgeGeometryRenderPending=true;
  requestAnimationFrame(()=>{
    edgeGeometryRenderPending=false;
    const ids=new Set(pendingEdgeNodeIds);
    pendingEdgeNodeIds.clear();
    if(!ids.size)return;
    const index=getGraphIndex(),nodeMap=index.nodeMap;
    if(isLargeGraphMode()){
      for(const dom of edgeDomById.values()){
        const link=dom&&dom.link;
        if(!link)continue;
        if(dom.g&&dom.g.getAttribute('data-large-edge-mode')!=='local')continue;
        if(ids.has(link.from)||ids.has(link.to))updateVisibleLinkGeometryForDrag(link,dom,nodeMap);
      }
      return;
    }
    const seenLinks=new Set();
    for(const id of ids){
      for(const link of linksForNodeId(id)){
        if(!link||seenLinks.has(link.id))continue;
        seenLinks.add(link.id);
        updateLinkGeometry(link,nodeMap);
      }
    }
  })
}

function clearMultiSelection(){
  selectedNodeIds.clear();
}
function selectedNodeTitle(){
  if(!selectedNodeIds.size)return '';
  const names=[...selectedNodeIds].map(id=>nodeById(id)).filter(Boolean).slice(0,3).map(n=>n.title);
  return names.join('、')+(selectedNodeIds.size>3?' 等':'');
}

const GRAPH_UNDO_LIMIT=20;
let graphUndoStack=[],graphClipboardNodes=null,lastGraphPointerWorldPosition=null;
function cloneGraphValue(value){
  try{return JSON.parse(JSON.stringify(value))}catch(e){return value}
}
function graphUndoSnapshot(){
  return{
    nodes:cloneGraphValue(state.nodes||[]),
    links:cloneGraphValue(state.links||[]),
    selectedNodeId:state.selectedNodeId||null,
    selectedLinkId:state.selectedLinkId||null,
    linkSourceId:state.linkSourceId||null,
    selectedNodeIds:[...selectedNodeIds]
  };
}
function pushGraphUndoSnapshot(label='操作'){
  graphUndoStack.push({label,snapshot:graphUndoSnapshot(),createdAt:Date.now()});
  if(graphUndoStack.length>GRAPH_UNDO_LIMIT)graphUndoStack.splice(0,graphUndoStack.length-GRAPH_UNDO_LIMIT);
}
function restoreGraphUndoSnapshot(){
  const item=graphUndoStack.pop();
  if(!item){showStatus('暂无可撤回的操作。');return true}
  clearRelatedGatherLayout({render:false,message:false});
  state.nodes=cloneGraphValue(item.snapshot.nodes||[]);
  state.links=cloneGraphValue(item.snapshot.links||[]);
  const nodeIds=new Set(state.nodes.map(n=>n.id)),linkIds=new Set(state.links.map(l=>l.id));
  state.selectedNodeId=nodeIds.has(item.snapshot.selectedNodeId)?item.snapshot.selectedNodeId:null;
  state.selectedLinkId=linkIds.has(item.snapshot.selectedLinkId)?item.snapshot.selectedLinkId:null;
  state.linkSourceId=nodeIds.has(item.snapshot.linkSourceId)?item.snapshot.linkSourceId:null;
  if(relatedScopeAnchorNodeId&&!nodeIds.has(relatedScopeAnchorNodeId))relatedScopeAnchorNodeId=null;
  selectedNodeIds=new Set((item.snapshot.selectedNodeIds||[]).filter(id=>nodeIds.has(id)));
  render({persist:true});
  showStatus(`已撤回：${item.label}。`);
  return true;
}
function selectedNodeIdsForClipboard(){
  const rawIds=selectedNodeIds&&selectedNodeIds.size?[...selectedNodeIds]:(state.selectedNodeId?[state.selectedNodeId]:[]);
  const idSet=new Set(rawIds.filter(id=>nodeById(id)));
  return state.nodes.filter(n=>idSet.has(n.id)).map(n=>n.id);
}
function copySelectedGraphCards(){
  const ids=selectedNodeIdsForClipboard();
  if(!ids.length){showStatus('请先选择要复制的卡牌。');return false}
  graphClipboardNodes=ids.map(id=>{
    const n=nodeById(id),d=nodeDims(n);
    return{
      title:n.title||'未命名知识点',
      category:n.category||'',
      color:safeColor(n.color,DEFAULTS.nodeColor),
      size:NODE_SIZES.has(n.size)?n.size:'',
      level:n.level||'基础',
      keywords:n.keywords||'',
      summary:n.summary||'',
      notes:n.notes||'',
      highlightTerms:n.highlightTerms||'',
      x:n.x,
      y:n.y,
      w:d.w,
      h:d.h
    };
  });
  showStatus(`已复制 ${graphClipboardNodes.length} 张卡牌。将鼠标移到目标位置后按 Ctrl+V 粘贴。`);
  return true;
}
function graphClipboardBounds(nodes){
  let minX=Infinity,minY=Infinity,maxX=-Infinity,maxY=-Infinity;
  nodes.forEach(n=>{
    minX=Math.min(minX,n.x);minY=Math.min(minY,n.y);
    maxX=Math.max(maxX,n.x+(n.w||CARD_W));maxY=Math.max(maxY,n.y+(n.h||CARD_H));
  });
  if(!Number.isFinite(minX))return{x:0,y:0,w:0,h:0,cx:0,cy:0};
  return{x:minX,y:minY,w:maxX-minX,h:maxY-minY,cx:(minX+maxX)/2,cy:(minY+maxY)/2};
}
function currentPasteWorldPoint(){
  if(lastGraphPointerWorldPosition)return{...lastGraphPointerWorldPosition};
  const r=stage.getBoundingClientRect();
  return screenToWorld(r.left+r.width/2,r.top+r.height/2);
}
function pasteGraphClipboardCards(){
  const source=Array.isArray(graphClipboardNodes)?graphClipboardNodes:[];
  if(!source.length){showStatus('剪贴板中还没有已复制的卡牌。');return false}
  if(typeof authRequire==='function'&&!authRequire('登录后才能粘贴卡牌。'))return true;
  const sub=window.KGSubscription;
  if(sub&&typeof sub.requireUsageLimit==='function'&&!sub.requireUsageLimit('graphNodes',state.nodes.length,source.length,{label:'图谱卡牌'}))return true;
  const available=Math.max(0,2500-state.nodes.length);
  if(source.length>available){showStatus(`当前图谱最多还可新增 ${available} 张卡牌，无法粘贴 ${source.length} 张。`);return true}
  const target=currentPasteWorldPoint(),bounds=graphClipboardBounds(source),created=[];
  clearRelatedGatherLayout({render:false,message:false});
  pushGraphUndoSnapshot(`粘贴 ${source.length} 张卡牌`);
  source.forEach(item=>{
    const n=makeNode(
      item.title||'未命名知识点',
      Math.round(target.x+(item.x-bounds.cx)),
      Math.round(target.y+(item.y-bounds.cy)),
      safeColor(item.color,DEFAULTS.nodeColor),
      item.category||'',
      item.level||'基础',
      item.keywords||'',
      item.summary||'',
      item.notes||'',
      NODE_SIZES.has(item.size)?item.size:''
    );
    n.highlightTerms=item.highlightTerms||'';
    state.nodes.push(n);
    created.push(n.id);
  });
  selectedNodeIds=new Set(created);
  state.selectedNodeId=created[0]||null;
  state.selectedLinkId=null;
  state.linkSourceId=null;
  render({persist:true});
  showStatus(`已粘贴 ${created.length} 张卡牌。`);
  return true;
}
function toggleCardMultiSelection(id){
  const n=nodeById(id);if(!n)return;
  clearHoverDetail(false);
  state.selectedLinkId=null;
  state.linkSourceId=null;
  if(state.selectedNodeId&&state.selectedNodeId!==id&&!selectedNodeIds.size)selectedNodeIds.add(state.selectedNodeId);
  if(state.selectedNodeId===id&&!selectedNodeIds.size)selectedNodeIds.add(id);
  if(selectedNodeIds.has(id))selectedNodeIds.delete(id);else selectedNodeIds.add(id);
  state.selectedNodeId=selectedNodeIds.size?[...selectedNodeIds][0]:null;
  showStatus(selectedNodeIds.size?`已选择 ${selectedNodeIds.size} 张卡牌。Ctrl+点击可继续增减选择。`:`已取消选择“${n.title}”。`);
  refreshSelectionUI();
}
function screenRectForBox(a,b){
  const left=Math.min(a.x,b.x),top=Math.min(a.y,b.y),width=Math.abs(a.x-b.x),height=Math.abs(a.y-b.y);
  return{left,top,width,height,right:left+width,bottom:top+height};
}
function worldRectFromScreenRect(rect){
  const p1=screenToWorld(rect.left,rect.top),p2=screenToWorld(rect.right,rect.bottom);
  return{left:Math.min(p1.x,p2.x),top:Math.min(p1.y,p2.y),right:Math.max(p1.x,p2.x),bottom:Math.max(p1.y,p2.y)};
}
function rectsOverlap(a,b){
  return !(a.right<b.left||a.left>b.right||a.bottom<b.top||a.top>b.bottom);
}
function nodeWorldRect(n){
  const d=nodeDims(n);
  return{left:n.x,top:n.y,right:n.x+d.w,bottom:n.y+d.h};
}
function ensureSelectionBox(){
  let box=$('selectionBox');
  if(!box){
    box=document.createElement('div');
    box.id='selectionBox';
    box.className='selection-box';
    stage.appendChild(box);
  }
  return box;
}
function updateSelectionBoxVisual(rect){
  const box=ensureSelectionBox();
  box.style.left=rect.left+'px';
  box.style.top=rect.top+'px';
  box.style.width=rect.width+'px';
  box.style.height=rect.height+'px';
  box.classList.add('show');
}
function hideSelectionBox(){
  const box=$('selectionBox');
  if(box)box.classList.remove('show');
}
function idsInsideWorldRect(rect){
  return state.nodes.filter(n=>rectsOverlap(nodeWorldRect(n),rect)).map(n=>n.id);
}
function startBoxSelection(e){
  clearHoverDetail(false);
  boxSelect={pointerId:e.pointerId,start:{x:e.clientX,y:e.clientY},last:{x:e.clientX,y:e.clientY},moved:false};
  try{stage.setPointerCapture(e.pointerId)}catch{}
  const r=stage.getBoundingClientRect();
  updateSelectionBoxVisual({left:e.clientX-r.left,top:e.clientY-r.top,width:0,height:0,right:e.clientX-r.left,bottom:e.clientY-r.top});
  stage.classList.remove('panning');
  e.preventDefault();
  e.stopPropagation();
}
function moveBoxSelection(e){
  if(!boxSelect||boxSelect.pointerId!==e.pointerId)return;
  const r=stage.getBoundingClientRect();
  boxSelect.last={x:e.clientX,y:e.clientY};
  if(Math.hypot(e.clientX-boxSelect.start.x,e.clientY-boxSelect.start.y)>4)boxSelect.moved=true;
  const rect=screenRectForBox({x:boxSelect.start.x-r.left,y:boxSelect.start.y-r.top},{x:e.clientX-r.left,y:e.clientY-r.top});
  updateSelectionBoxVisual(rect);
  const ids=idsInsideWorldRect(worldRectFromScreenRect(rect));
  selectedNodeIds=new Set(ids);
  state.selectedNodeId=ids[0]||null;
  state.selectedLinkId=null;
  state.linkSourceId=null;
  refreshCardClasses();
  e.preventDefault();
  e.stopPropagation();
}
function finishBoxSelection(e,cancelled=false){
  if(!boxSelect||boxSelect.pointerId!==e.pointerId)return;
  const count=selectedNodeIds.size,moved=!!boxSelect.moved;
  boxSelect=null;
  try{stage.releasePointerCapture(e.pointerId)}catch{}
  hideSelectionBox();
  if(cancelled){
    clearMultiSelection();
    refreshSelectionUI();
    return;
  }
  if(!moved){
    clearSelection();
    showStatus('已关闭详情。');
  }else if(count){
    renderDetails();
    showStatus(`已框选 ${count} 个知识点${count<=3?'：'+selectedNodeTitle():''}。拖动任一选中卡片可整体移动。`);
  }else{
    clearSelection();
    showStatus('没有框选到知识点。');
  }
  e.preventDefault();
  e.stopPropagation();
}
function cardElementByNodeId(id){
  return cardDomById.get(id)||null;
}

function cardRelationState(){const relationState=largeGraphRelationState();return relationLayerEnabled()?relationState:null}
function classForCard(n,relationState=null){
  const sizeClass=n.size==='small'?' size-small':n.size==='big'?' size-big':'';
  let cls='knowledge-card'+sizeClass+(state.selectedNodeId===n.id?' active':'')+(selectedNodeIds.has(n.id)?' multi-selected':'')+(state.linkSourceId===n.id?' link-source':'')+(isImportant(n)?' focus-card':'');
  if(relationState&&relationState.related&&relationState.related.size){
    if(relationState.anchors.has(n.id))cls+=' large-related-anchor';
    else if(relationState.related.has(n.id))cls+=' large-related-neighbor';
    else cls+=largeGraphRelatedFocusEnabled?' large-related-hidden':' large-related-muted';
  }
  if(isRelatedGatherActive()&&relatedGatherLayout.positions&&relatedGatherLayout.positions.has(n.id)){
    cls+=' gather-temp-card';
    if(currentRelatedScopeAnchorId()===n.id)cls+=' gather-anchor-card';
  }
  return cls;
}
function renderCardElement(n,relationState=null){
  const card=document.createElement('div'),color=safeColor(n.color),pos=visualPositionForNode(n);
  card.className=classForCard(n,relationState);
  card.style.left=pos.x+'px';card.style.top=pos.y+'px';card.style.setProperty('--node-color',color);card.dataset.nodeId=n.id;
  const first=(n.title||'?').trim().slice(0,1);
  card.innerHTML=`<div class="card-body"><div class="node-top" style="background:linear-gradient(180deg, ${tint(color,.88)}, #e5e7eb)"><div class="node-icon" style="background:${color}">${escapeHTML(first)}</div></div><div class="node-title">${escapeHTML(n.title||'未命名知识点')}</div></div><div class="node-size-tools" aria-label="卡牌尺寸"><button type="button" class="node-size-btn" data-size="small" title="小卡">-</button><button type="button" class="node-size-btn" data-size="big" title="大卡">+</button><button type="button" class="node-size-btn" data-size="" title="默认尺寸">o</button></div>`;
  return card;
}
function renderCards(){const frag=document.createDocumentFragment(),nextCardDom=new Map(),relationState=cardRelationState();for(const n of state.nodes){const card=renderCardElement(n,relationState);nextCardDom.set(n.id,card);frag.appendChild(card)}cardDomById=nextCardDom;cardsLayer.replaceChildren(frag);updateNodeGrowthHandles()}
function refreshCardClasses(){
  const relationState=cardRelationState();
  for(const card of cardsLayer.querySelectorAll('.knowledge-card')){
    const n=nodeById(card.dataset.nodeId);if(!n){card.remove();continue}
    card.className=classForCard(n,relationState);
  }
  updateLargeGraphRelatedButton();
  updateCardQuickActions();
  updateNodeGrowthHandles();
}
function refreshSelectionUI(options={}){
  syncGraphModeClasses();
  renderHeader();
  renderEdges();
  refreshCardClasses();
  renderDetails();
  renderSelectedEdgeQuickStylePanel();
  if(options.persist)save();
}
let cardDrag=null;
function shouldDeferEdgesDuringCardDrag(drag){
  const ids=drag&&Array.isArray(drag.ids)?drag.ids:[drag&&drag.id].filter(Boolean);
  if(ids.length<=1)return false;
  const prefs=window.KGGraphUserPreferences&&typeof window.KGGraphUserPreferences.get==='function'?window.KGGraphUserPreferences.get():null;
  return !prefs||prefs.deferEdgesDuringDrag!==false;
}
function cardFromEvent(e){const card=e.target.closest&&e.target.closest('.knowledge-card');return card&&cardsLayer.contains(card)?card:null}

// v7.9.43：选中卡牌后显示四向快速生长点，悬浮预览，点击复制尺寸/颜色并自动连线创建新知识点。
let nodeGrowthLayer=null,nodeGrowthPreviewDirection=null,nodeGrowthCreateLockUntil=0;
const NODE_GROWTH_DIRECTIONS={
  top:{label:'上方',dx:0,dy:-1},
  right:{label:'右侧',dx:1,dy:0},
  bottom:{label:'下方',dx:0,dy:1},
  left:{label:'左侧',dx:-1,dy:0}
};
const NODE_GROWTH_GAP=96;
function ensureNodeGrowthLayer(){
  if(nodeGrowthLayer&&nodeGrowthLayer.isConnected)return nodeGrowthLayer;
  nodeGrowthLayer=document.createElement('div');
  nodeGrowthLayer.className='node-growth-layer';
  nodeGrowthLayer.dataset.stageUi='true';
  nodeGrowthLayer.setAttribute('aria-label','快速创建相邻知识点');
  cardsLayer.appendChild(nodeGrowthLayer);
  return nodeGrowthLayer;
}
function hideNodeGrowthHandles(){
  nodeGrowthPreviewDirection=null;
  if(nodeGrowthLayer)nodeGrowthLayer.replaceChildren();
}
function canShowNodeGrowthHandles(){
  if(!state||!state.selectedNodeId||state.selectedLinkId||state.linkSourceId)return false;
  if(selectedNodeIds&&selectedNodeIds.size>1)return false;
  if(cardDrag||boxSelect||isCanvasPanMode()||isRelatedGatherActive())return false;
  if(stage&&stage.classList&&(stage.classList.contains('viewport-fitting')||stage.classList.contains('graph-card-dragging-defer-edges')))return false;
  return !!nodeById(state.selectedNodeId);
}
function nodeGrowthSizeClass(size){
  return size==='small'?' size-small':size==='big'?' size-big':'';
}
function nodeGrowthHandlePosition(n,dir){
  const d=nodeDims(n),p=visualPositionForNode(n),offset=12;
  if(dir==='top')return{x:p.x+d.w/2,y:p.y-offset};
  if(dir==='right')return{x:p.x+d.w+offset,y:p.y+d.h/2};
  if(dir==='bottom')return{x:p.x+d.w/2,y:p.y+d.h+offset};
  return{x:p.x-offset,y:p.y+d.h/2};
}
function rawNodeGrowthPosition(n,dir){
  const d=nodeDims(n),p=visualPositionForNode(n),gap=NODE_GROWTH_GAP;
  if(dir==='top')return{x:p.x,y:p.y-d.h-gap};
  if(dir==='right')return{x:p.x+d.w+gap,y:p.y};
  if(dir==='bottom')return{x:p.x,y:p.y+d.h+gap};
  return{x:p.x-d.w-gap,y:p.y};
}
function nodeGrowthRectsOverlap(a,b,margin=18){
  return !(a.x+a.w+margin<=b.x||b.x+b.w+margin<=a.x||a.y+a.h+margin<=b.y||b.y+b.h+margin<=a.y);
}
function nodeGrowthPositionOverlaps(pos,dims,sourceId=null,options={}){
  const rect={x:pos.x,y:pos.y,w:dims.w,h:dims.h};
  const ignoreSource=!!options.ignoreSource;
  for(const item of state.nodes||[]){
    if(!item)continue;
    if(ignoreSource&&item.id===sourceId)continue;
    const d=nodeDims(item),p=visualPositionForNode(item,{ignoreGather:true});
    if(nodeGrowthRectsOverlap(rect,{x:p.x,y:p.y,w:d.w,h:d.h},18))return true;
  }
  return false;
}
function nodeGrowthVisibleWorldRect(){
  if(!stage||!state||!state.viewport)return null;
  const r=stage.getBoundingClientRect&&stage.getBoundingClientRect();
  if(!r||!r.width||!r.height)return null;
  const scale=Math.max(.05,Number(state.viewport.scale)||1);
  return{
    x:(0-state.viewport.x)/scale,
    y:(0-state.viewport.y)/scale,
    w:r.width/scale,
    h:r.height/scale
  };
}
function clampNodeGrowthPositionToVisible(pos,dims){
  const rect=nodeGrowthVisibleWorldRect();
  if(!rect)return{x:Math.round(pos.x),y:Math.round(pos.y)};
  const pad=28;
  const minX=rect.x+pad,minY=rect.y+pad;
  const maxX=rect.x+rect.w-dims.w-pad,maxY=rect.y+rect.h-dims.h-pad;
  return{
    x:Math.round(clamp(pos.x,minX,Math.max(minX,maxX))),
    y:Math.round(clamp(pos.y,minY,Math.max(minY,maxY)))
  };
}
function nodeGrowthPositionInsideVisible(pos,dims){
  const rect=nodeGrowthVisibleWorldRect();
  if(!rect)return true;
  const pad=18;
  return pos.x>=rect.x+pad&&pos.y>=rect.y+pad&&pos.x+dims.w<=rect.x+rect.w-pad&&pos.y+dims.h<=rect.y+rect.h-pad;
}
function scoreNodeGrowthCandidate(candidate,base,n,dir,dims,sourcePos,sourceDims){
  const dx=candidate.x-base.x,dy=candidate.y-base.y;
  let score=Math.hypot(dx,dy);
  // 优先保持在用户点击的小点方向附近；实在被挡住时才允许轻微绕到附近空位。
  if(dir==='right'&&candidate.x<sourcePos.x+sourceDims.w+18)score+=900;
  if(dir==='left'&&candidate.x+dims.w>sourcePos.x-18)score+=900;
  if(dir==='bottom'&&candidate.y<sourcePos.y+sourceDims.h+18)score+=900;
  if(dir==='top'&&candidate.y+dims.h>sourcePos.y-18)score+=900;
  if(!nodeGrowthPositionInsideVisible(candidate,dims))score+=1200;
  return score;
}
function nodeGrowthCandidateOffsets(dir,dims){
  const xStep=Math.round(dims.w+36),yStep=Math.round(dims.h+36);
  const primaryStep=dir==='left'||dir==='right'?xStep:yStep;
  const perpStep=dir==='left'||dir==='right'?yStep:xStep;
  const offsets=[{a:0,b:0}];
  const perpOrder=[1,-1,2,-2,3,-3,4,-4];
  const forwardOrder=[0,1,-1,2,-2,3,-3];
  for(const f of forwardOrder){
    for(const p of perpOrder){
      offsets.push({a:f*primaryStep*.42,b:p*perpStep});
      offsets.push({a:f*primaryStep*.42,b:p*perpStep*.55});
    }
  }
  for(let ring=1;ring<=7;ring++){
    const radius=Math.round(ring*Math.min(xStep,yStep)*.72);
    const stride=Math.max(24,Math.round(radius/2));
    for(let ox=-radius;ox<=radius;ox+=stride)offsets.push({x:ox,y:-radius},{x:ox,y:radius});
    for(let oy=-radius;oy<=radius;oy+=stride)offsets.push({x:-radius,y:oy},{x:radius,y:oy});
  }
  return offsets.map(item=>{
    if(item.x!==undefined)return{x:item.x,y:item.y};
    if(dir==='right')return{x:item.a,y:item.b};
    if(dir==='left')return{x:-item.a,y:item.b};
    if(dir==='bottom')return{x:item.b,y:item.a};
    return{x:item.b,y:-item.a};
  });
}
function resolveNodeGrowthPosition(n,dir){
  const dims=nodeDims(n),base=rawNodeGrowthPosition(n,dir),sourcePos=visualPositionForNode(n,{ignoreGather:true}),sourceDims=nodeDims(n);
  // v7.9.48：修复 v7.9.47 的误替换问题，并保留“就近原则”落点算法。
  const seen=new Set(),candidates=[];
  const pushCandidate=pos=>{
    const clamped=clampNodeGrowthPositionToVisible(pos,dims);
    const key=clamped.x+','+clamped.y;
    if(seen.has(key))return;
    seen.add(key);
    candidates.push(clamped);
  };
  pushCandidate(base);
  for(const off of nodeGrowthCandidateOffsets(dir,dims))pushCandidate({x:base.x+off.x,y:base.y+off.y});
  candidates.sort((a,b)=>scoreNodeGrowthCandidate(a,base,n,dir,dims,sourcePos,sourceDims)-scoreNodeGrowthCandidate(b,base,n,dir,dims,sourcePos,sourceDims));
  for(const pos of candidates){
    if(nodeGrowthPositionInsideVisible(pos,dims)&&!nodeGrowthPositionOverlaps(pos,dims,n.id,{ignoreSource:false}))return{x:Math.round(pos.x),y:Math.round(pos.y)};
  }
  for(const pos of candidates){
    if(!nodeGrowthPositionOverlaps(pos,dims,n.id,{ignoreSource:false}))return{x:Math.round(pos.x),y:Math.round(pos.y)};
  }
  // 极端拥挤时仍保持同屏：宁可贴近当前视野，也不把卡牌推到远处。
  return clampNodeGrowthPositionToVisible(base,dims);
}
function nodeGrowthLinePoints(n,dir,pos){
  const d=nodeDims(n),p=visualPositionForNode(n);
  if(dir==='top')return{x1:p.x+d.w/2,y1:p.y,x2:pos.x+d.w/2,y2:pos.y+d.h};
  if(dir==='right')return{x1:p.x+d.w,y1:p.y+d.h/2,x2:pos.x,y2:pos.y+d.h/2};
  if(dir==='bottom')return{x1:p.x+d.w/2,y1:p.y+d.h,x2:pos.x+d.w/2,y2:pos.y};
  return{x1:p.x,y1:p.y+d.h/2,x2:pos.x+d.w,y2:pos.y+d.h/2};
}
function createNodeGrowthHandle(dir,n){
  const point=nodeGrowthHandlePosition(n,dir),meta=NODE_GROWTH_DIRECTIONS[dir],btn=document.createElement('div');
  btn.className='node-growth-handle node-growth-'+dir;
  btn.dataset.growthDir=dir;
  btn.dataset.nodeId=n.id;
  btn.dataset.stageUi='true';
  btn.title=`在${meta.label}快速创建知识点`;
  btn.setAttribute('role','button');
  btn.setAttribute('tabindex','0');
  btn.setAttribute('aria-label',btn.title);
  btn.style.left=point.x+'px';
  btn.style.top=point.y+'px';
  const create=e=>{
    if(e){e.preventDefault();e.stopPropagation()}
    quickCreateNodeFromGrowthHandle(btn.dataset.growthDir,btn.dataset.nodeId);
  };
  btn.addEventListener('pointerdown',create);
  btn.addEventListener('mousedown',create);
  btn.addEventListener('click',create);
  btn.addEventListener('pointerenter',()=>showNodeGrowthPreview(btn.dataset.growthDir));
  btn.addEventListener('pointerleave',()=>hideNodeGrowthPreview());
  btn.addEventListener('keydown',e=>{
    if(e.key==='Enter'||e.key===' '){create(e)}
  });
  return btn;
}
function createNodeGrowthPreviewLineSvg(line,dir){
  const horizontal=dir==='left'||dir==='right';
  const mid=horizontal?Math.round((line.x1+line.x2)/2):Math.round((line.y1+line.y2)/2);
  const points=horizontal
    ?[{x:line.x1,y:line.y1},{x:mid,y:line.y1},{x:mid,y:line.y2},{x:line.x2,y:line.y2}]
    :[{x:line.x1,y:line.y1},{x:line.x1,y:mid},{x:line.x2,y:mid},{x:line.x2,y:line.y2}];
  const pad=22,minX=Math.min(...points.map(p=>p.x))-pad,minY=Math.min(...points.map(p=>p.y))-pad,maxX=Math.max(...points.map(p=>p.x))+pad,maxY=Math.max(...points.map(p=>p.y))+pad;
  const svg=document.createElementNS('http://www.w3.org/2000/svg','svg');
  svg.classList.add('node-growth-preview-svg');
  svg.setAttribute('aria-hidden','true');
  svg.style.left=Math.round(minX)+'px';
  svg.style.top=Math.round(minY)+'px';
  svg.style.width=Math.max(8,Math.round(maxX-minX))+'px';
  svg.style.height=Math.max(8,Math.round(maxY-minY))+'px';
  svg.setAttribute('viewBox',`0 0 ${Math.max(8,Math.round(maxX-minX))} ${Math.max(8,Math.round(maxY-minY))}`);
  const markerId='nodeGrowthPreviewArrow';
  const defs=document.createElementNS('http://www.w3.org/2000/svg','defs');
  const marker=document.createElementNS('http://www.w3.org/2000/svg','marker');
  marker.setAttribute('id',markerId);
  marker.setAttribute('markerWidth','8');
  marker.setAttribute('markerHeight','8');
  marker.setAttribute('refX','7');
  marker.setAttribute('refY','4');
  marker.setAttribute('orient','auto');
  marker.setAttribute('markerUnits','strokeWidth');
  const arrow=document.createElementNS('http://www.w3.org/2000/svg','path');
  arrow.setAttribute('d','M 0 1 L 7 4 L 0 7 z');
  arrow.setAttribute('class','node-growth-preview-arrow');
  marker.appendChild(arrow);
  defs.appendChild(marker);
  svg.appendChild(defs);
  const path=document.createElementNS('http://www.w3.org/2000/svg','path');
  const d=points.map((p,i)=>`${i?'L':'M'} ${Math.round(p.x-minX)} ${Math.round(p.y-minY)}`).join(' ');
  path.setAttribute('d',d);
  path.setAttribute('class','node-growth-preview-path');
  path.setAttribute('marker-end',`url(#${markerId})`);
  svg.appendChild(path);
  return svg;
}
function createNodeGrowthPreview(n,dir){
  const d=nodeDims(n),pos=resolveNodeGrowthPosition(n,dir),line=nodeGrowthLinePoints(n,dir,pos),color=safeColor(n.color,DEFAULTS.nodeColor);
  const frag=document.createDocumentFragment();
  const card=document.createElement('div');
  card.className='node-growth-preview-card'+nodeGrowthSizeClass(n.size);
  card.style.left=pos.x+'px';
  card.style.top=pos.y+'px';
  card.style.width=d.w+'px';
  card.style.height=d.h+'px';
  card.style.setProperty('--node-color',color);
  card.setAttribute('aria-hidden','true');
  // v7.9.49：就近落点可能产生偏移，预览线改为 SVG 折线，始终真实连接原卡牌边缘与虚框边缘。
  frag.appendChild(createNodeGrowthPreviewLineSvg(line,dir));
  frag.appendChild(card);
  return frag;
}
function updateNodeGrowthHandles(){
  if(!canShowNodeGrowthHandles()){hideNodeGrowthHandles();return}
  const n=nodeById(state.selectedNodeId),layer=ensureNodeGrowthLayer();
  if(!n){hideNodeGrowthHandles();return}
  const frag=document.createDocumentFragment();
  ['top','right','bottom','left'].forEach(dir=>frag.appendChild(createNodeGrowthHandle(dir,n)));
  if(nodeGrowthPreviewDirection&&NODE_GROWTH_DIRECTIONS[nodeGrowthPreviewDirection])frag.appendChild(createNodeGrowthPreview(n,nodeGrowthPreviewDirection));
  layer.replaceChildren(frag);
}
function showNodeGrowthPreview(dir){
  if(!NODE_GROWTH_DIRECTIONS[dir])return;
  nodeGrowthPreviewDirection=dir;
  updateNodeGrowthHandles();
}
function hideNodeGrowthPreview(){
  if(!nodeGrowthPreviewDirection)return;
  nodeGrowthPreviewDirection=null;
  updateNodeGrowthHandles();
}
function shouldKeepNodeGrowthPreviewFromEvent(e){
  const target=e&&e.target;
  return !!(target&&target.closest&&target.closest('.node-growth-handle'));
}
document.addEventListener('pointermove',e=>{
  if(nodeGrowthPreviewDirection&&!shouldKeepNodeGrowthPreviewFromEvent(e))hideNodeGrowthPreview();
},{passive:true});
window.addEventListener('blur',hideNodeGrowthPreview);
document.addEventListener('scroll',hideNodeGrowthPreview,true);
function quickCreateNodeFromGrowthHandle(dir,sourceId=null){
  if(!NODE_GROWTH_DIRECTIONS[dir])return false;
  // sourceId 只用于定位原卡牌；新卡牌 ID 仍由 makeNode() 生成，绝不复用原卡牌 ID。
  const source=nodeById(sourceId||state.selectedNodeId);if(!source)return false;
  if(isCanvasPanMode()||state.selectedLinkId||state.linkSourceId||isRelatedGatherActive())return false;
  const now=Date.now();
  if(now<nodeGrowthCreateLockUntil)return false;
  const sub=window.KGSubscription;
  if(sub&&typeof sub.requireUsageLimit==='function'&&!sub.requireUsageLimit('graphNodes',state.nodes.length,1,{label:'图谱卡牌'}))return false;
  nodeGrowthCreateLockUntil=now+280;
  clearRelatedGatherLayout({render:false,message:false});
  clearMultiSelection();
  if(typeof pushGraphUndoSnapshot==='function')pushGraphUndoSnapshot(`快速创建${NODE_GROWTH_DIRECTIONS[dir].label}知识点`);
  const pos=resolveNodeGrowthPosition(source,dir);
  const next=makeNode('未命名知识点',pos.x,pos.y,safeColor(source.color,DEFAULTS.nodeColor),'','基础','','','','',source.size||'');
  const link=makeLink(source.id,next.id,'关联','',state.defaults.linkStyle,state.defaults.linkColor,state.defaults.linkPathStyle);
  state.nodes.push(next);
  state.links.push(link);
  state.selectedNodeId=next.id;
  state.selectedLinkId=null;
  state.linkSourceId=null;
  nodeGrowthPreviewDirection=null;
  render({persist:true});
  showStatus(`已在${NODE_GROWTH_DIRECTIONS[dir].label}创建“未命名知识点”，并自动建立关系线。`);
  return true;
}
cardsLayer.addEventListener('pointerdown',e=>{
  const handle=e.target.closest&&e.target.closest('.node-growth-handle');
  if(!handle)return;
  // v7.9.45：创建动作绑定在小点自身，捕获阶段不再 stopPropagation，
  // 避免事件到不了目标元素；这里仅保留委托兜底。
},true);
cardsLayer.addEventListener('pointerover',e=>{
  const handle=e.target.closest&&e.target.closest('.node-growth-handle');
  if(!handle||!cardsLayer.contains(handle))return;
  showNodeGrowthPreview(handle.dataset.growthDir);
});
cardsLayer.addEventListener('pointerout',e=>{
  const handle=e.target.closest&&e.target.closest('.node-growth-handle');
  if(!handle)return;
  hideNodeGrowthPreview();
});
cardsLayer.addEventListener('click',e=>{
  const handle=e.target.closest&&e.target.closest('.node-growth-handle');
  if(!handle)return;
  e.preventDefault();
  e.stopPropagation();
  quickCreateNodeFromGrowthHandle(handle.dataset.growthDir,handle.dataset.nodeId);
},true);


cardsLayer.addEventListener('click',e=>{
  if(isCanvasPanMode()){e.preventDefault();e.stopPropagation();return}
  const btn=e.target.closest&&e.target.closest('.node-size-btn');if(!btn)return;
  e.stopPropagation();e.preventDefault();
  const card=btn.closest('.knowledge-card'),n=card&&nodeById(card.dataset.nodeId);if(!n)return;
  n.size=NODE_SIZES.has(btn.dataset.size)?btn.dataset.size:'';
  state.defaults.nodeSize=n.size||'';
  showStatus(n.size==='small'?`“${n.title}”已设为小卡。`:n.size==='big'?`“${n.title}”已设为大卡。`:`“${n.title}”已恢复默认尺寸。`);
  render({persist:true});
});
cardsLayer.addEventListener('pointerdown',e=>{
  if(isCanvasPanMode()||e.button===2)return;
  if(e.target.closest&&e.target.closest('.node-size-btn')){e.stopPropagation();return}
  const card=cardFromEvent(e);if(!card||e.button!==0)return;
  const id=card.dataset.nodeId,n=nodeById(id);if(!n)return;
  hideNodeGrowthHandles();
  e.stopPropagation();e.preventDefault();
  const toggleMulti=e.ctrlKey||e.metaKey;
  const groupIds=toggleMulti?[id]:(selectedNodeIds.has(id)&&selectedNodeIds.size>1?[...selectedNodeIds]:[id]);
  if(groupIds.length===1&&!e.shiftKey&&!e.ctrlKey&&!e.metaKey)clearMultiSelection();
  const startPositions=Object.fromEntries(groupIds.map(gid=>{const gn=nodeById(gid);return[gid,{x:gn.x,y:gn.y}]}));
  cardDrag={id,ids:groupIds,card,pointerId:e.pointerId,moved:false,longOpened:false,toggleMulti,startClient:{x:e.clientX,y:e.clientY},startPos:{x:n.x,y:n.y},startPositions,longTimer:null};
  cardDrag.ids.forEach(gid=>{const el=cardElementByNodeId(gid);if(el)el.classList.add(groupIds.length>1?'group-dragging':'dragging')});
  card.setPointerCapture(e.pointerId);
  cardDrag.longTimer=setTimeout(()=>{
    if(!cardDrag||cardDrag.pointerId!==e.pointerId||cardDrag.moved)return;
    cardDrag.longOpened=true;card.classList.remove('dragging');try{card.releasePointerCapture(e.pointerId)}catch{}
    openNodeModal(id);showStatus('长按：编辑知识点。');
  },isCoarse?560:760);
});
cardsLayer.addEventListener('pointermove',e=>{
  if(!cardDrag||cardDrag.pointerId!==e.pointerId||cardDrag.longOpened)return;
  e.stopPropagation();e.preventDefault();
  markStageInteracting();
  const px=e.clientX-cardDrag.startClient.x,py=e.clientY-cardDrag.startClient.y;
  if(Math.hypot(px,py)>5){cardDrag.moved=true;clearTimeout(cardDrag.longTimer)}
  if(isRelatedGatherActive()&&cardDrag.moved){
    if(!cardDrag.gatherDragBlocked)showStatus('当前是临时聚拢布局，仅用于讲解查看；请先退出聚拢后再调整原图谱位置。');
    cardDrag.gatherDragBlocked=true;
    return;
  }
  const dx=px/state.viewport.scale,dy=py/state.viewport.scale;
  for(const gid of cardDrag.ids||[cardDrag.id]){
    const n=nodeById(gid),start=cardDrag.startPositions&&cardDrag.startPositions[gid];if(!n||!start)continue;
    n.x=Math.round(start.x+dx);
    n.y=Math.round(start.y+dy);
    const el=cardElementByNodeId(gid);
    if(el){el.style.left=n.x+'px';el.style.top=n.y+'px'}
  }
  if(cardDrag.moved&&cardDrag.deferEdgesDuringDrag===undefined)cardDrag.deferEdgesDuringDrag=shouldDeferEdgesDuringCardDrag(cardDrag);
  if(cardDrag.deferEdgesDuringDrag){
    stage.classList.add('graph-card-dragging-defer-edges');
    stage.classList.remove('large-graph-dragging-local-lines');
  }else{
    stage.classList.toggle('large-graph-dragging-local-lines',isLargeGraphMode()&&edgeDomById.size>0);
    requestLinkedEdgeGeometryRender(cardDrag.ids||[cardDrag.id]);
  }
});
function finishCardPointer(e,cancelled=false){
  if(!cardDrag||cardDrag.pointerId!==e.pointerId)return;
  const drag=cardDrag;cardDrag=null;clearTimeout(drag.longTimer);
  e.stopPropagation();
  (drag.ids||[drag.id]).forEach(gid=>{const el=cardElementByNodeId(gid);if(el)el.classList.remove('dragging','group-dragging')});
  stage.classList.remove('large-graph-dragging-local-lines','graph-card-dragging-defer-edges');
  try{drag.card.releasePointerCapture(e.pointerId)}catch{}
  const renderDeferredEdges=()=>{if(drag.deferEdgesDuringDrag&&drag.moved&&!drag.gatherDragBlocked)renderEdges()};
  if(cancelled||drag.longOpened){renderDeferredEdges();return}
  if(drag.gatherDragBlocked){handleNodeTap(drag.id);return}
  if(!drag.moved){if(drag.toggleMulti){toggleCardMultiSelection(drag.id);return}handleNodeTap(drag.id);return}
  state.selectedNodeId=drag.id;state.selectedLinkId=null;state.linkSourceId=null;
  if((drag.ids||[]).length>1){
    selectedNodeIds=new Set(drag.ids);
    showStatus(drag.deferEdgesDuringDrag?`已整体移动 ${drag.ids.length} 个知识点，并刷新关系线。`:`已整体移动 ${drag.ids.length} 个知识点。${isLargeGraphMode()?'已刷新局部关系线。':''}`);
  }else{
    clearMultiSelection();
    showStatus(isLargeGraphMode()?'已移动知识点，并刷新该卡牌的局部关系线。':'已移动知识点。双击卡牌可设为连线起点。');
  }
  refreshSelectionUI({persist:true});
}
cardsLayer.addEventListener('pointerup',e=>finishCardPointer(e));
cardsLayer.addEventListener('pointercancel',e=>finishCardPointer(e,true));
cardsLayer.addEventListener('dblclick',e=>{if(isCanvasPanMode())return;const card=cardFromEvent(e);if(!card||e.target.closest('.node-size-btn'))return;e.stopPropagation();activateLinkSource(card.dataset.nodeId)});
function clearHoverDetail(shouldRender=true){
  clearTimeout(hoverDetailTimer);
  clearTimeout(hoverLargeGraphTimer);
  if(hoverLargeGraphNodeId){hoverLargeGraphNodeId=null;if(isLargeGraphMode()&&!state.selectedNodeId&&!state.selectedLinkId){syncGraphModeClasses();renderEdges()}}
  hoverDetailNodeId=null;
  if(shouldRender&&!state.selectedNodeId&&!state.selectedLinkId)renderDetails();
}
function isHoverDetailBlocked(){
  const inlineEditorOpen=!!(edgeInlineLabelEditorEl&&edgeInlineLabelEditorEl.classList&&edgeInlineLabelEditorEl.classList.contains('show'));
  const selecting=typeof boxSelect!=='undefined'&&!!boxSelect;
  return !!(isCoarse||cardDrag||selecting||state.selectedNodeId||state.selectedLinkId||isCanvasPanMode()||stage.classList.contains('viewport-fitting')||inlineEditorOpen);
}
function showHoverDetail(id){
  const node=nodeById(id);
  if(!node)return;
  if(isLargeGraphMode()){
    if(isHoverDetailBlocked())return;
    clearTimeout(hoverDetailTimer);
    clearTimeout(hoverLargeGraphTimer);
    if(largeGraphOverviewEnabled){
      hoverLargeGraphTimer=setTimeout(()=>{
        if(isHoverDetailBlocked()||!nodeById(id))return;
        hoverLargeGraphNodeId=id;
        syncGraphModeClasses();
        renderEdges();
      },LARGE_GRAPH_HOVER_RELATION_DELAY);
    }
    hoverDetailTimer=setTimeout(()=>{
      if(isHoverDetailBlocked()||!nodeById(id))return;
      hoverDetailNodeId=id;
      renderDetails();
    },LARGE_GRAPH_HOVER_DETAIL_DELAY);
    return;
  }
  if(isCoarse||cardDrag||state.selectedNodeId||state.selectedLinkId)return;
  clearTimeout(hoverDetailTimer);
  hoverDetailNodeId=id;
  renderDetails();
}
function scheduleHoverDetailHide(){
  if((!hoverDetailNodeId&&!hoverLargeGraphNodeId)||state.selectedNodeId||state.selectedLinkId)return;
  clearTimeout(hoverDetailTimer);
  clearTimeout(hoverLargeGraphTimer);
  hoverDetailTimer=setTimeout(()=>{
    if(detailPanel.matches(':hover'))return;
    clearHoverDetail(true);
  },180);
}
cardsLayer.addEventListener('pointerover',e=>{
  const card=cardFromEvent(e);if(!card||card.contains(e.relatedTarget))return;
  showHoverDetail(card.dataset.nodeId);
});
cardsLayer.addEventListener('pointerout',e=>{
  const card=cardFromEvent(e);if(!card||card.contains(e.relatedTarget))return;
  const id=card.dataset.nodeId;
  clearTimeout(hoverDetailTimer);
  clearTimeout(hoverLargeGraphTimer);
  if(hoverDetailNodeId===id||hoverLargeGraphNodeId===id)scheduleHoverDetailHide();
});
detailPanel.addEventListener('pointerenter',()=>clearTimeout(hoverDetailTimer));
detailPanel.addEventListener('pointerleave',()=>scheduleHoverDetailHide());


function relatedScopeRelationForNode(id){
  if(!id)return null;
  const related=new Set([id]),seenLinks=new Set();let linkCount=0;
  for(const link of linksForNodeId(id)){
    if(!link||seenLinks.has(link.id))continue;
    seenLinks.add(link.id);linkCount++;
    related.add(link.from);related.add(link.to);
  }
  return{anchors:new Set([id]),related,linkCount,relatedCount:Math.max(0,related.size-1)};
}
function setRelatedScopeCenter(id,options={}){
  const n=nodeById(id);if(!n)return;
  clearRelatedGatherLayout({render:false,message:false});
  relatedScopeAnchorNodeId=id;
  if(!largeGraphRelatedFocusEnabled)largeGraphRelatedFocusEnabled=true;
  hoverLargeGraphNodeId=null;
  syncGraphModeClasses();
  renderEdges();
  refreshCardClasses();
  renderDetails();
  updateCardQuickActions();
  if(options.fit)fitRelatedScopeToView(false);
  const relation=largeGraphRelationState();
  showStatus(relation?`已以“${n.title}”为中心：${relation.relatedCount} 个相关知识点，${relation.linkCount} 条关系。`:`已以“${n.title}”为中心。`);
}
function clearRelatedGatherLayout(options={}){
  const was=!!relatedGatherLayout;
  relatedGatherLayout=null;
  stage.classList.remove('graph-gather-layout');
  if(options.render){renderHeader();renderEdges();renderCards();renderDetails();updateCardQuickActions()}
  if(options.message&&was)showStatus('已退出临时聚拢布局，恢复原图谱位置。');
}
function layoutRelatedNodesForGather(nodes,anchorId){
  const anchor=nodeById(anchorId)||nodes[0];
  if(!anchor)return null;
  const others=nodes.filter(n=>n&&n.id!==anchor.id).sort((a,b)=>String(a.category||'').localeCompare(String(b.category||''),'zh-Hans-CN')||String(a.title||'').localeCompare(String(b.title||''),'zh-Hans-CN'));
  const ad=nodeDims(anchor),ap=visualPositionForNode(anchor,{ignoreGather:true}),center={x:ap.x+ad.w/2,y:ap.y+ad.h/2};
  const maxCols=isCoarse?4:7,cols=Math.max(2,Math.min(maxCols,Math.ceil(Math.sqrt(Math.max(1,others.length)*1.28))));
  const cellW=isCoarse?178:196,cellH=isCoarse?172:188,gapY=isCoarse?30:42;
  const rows=Math.max(1,Math.ceil(others.length/cols));
  const totalW=cols*cellW,totalH=ad.h+gapY+rows*cellH;
  const positions=new Map();
  const anchorX=center.x-ad.w/2,anchorY=center.y-totalH/2;
  positions.set(anchor.id,{x:Math.round(anchorX),y:Math.round(anchorY)});
  const startX=center.x-totalW/2,startY=anchorY+ad.h+gapY;
  others.forEach((n,i)=>{
    const d=nodeDims(n),col=i%cols,row=Math.floor(i/cols);
    positions.set(n.id,{x:Math.round(startX+col*cellW+(cellW-d.w)/2),y:Math.round(startY+row*cellH+(cellH-d.h)/2)});
  });
  return{active:true,anchorId:anchor.id,positions,nodeIds:new Set(nodes.map(n=>n.id)),createdAt:Date.now()};
}
function activateRelatedGatherLayout(nodes,showMessage=true){
  const anchorId=currentRelatedScopeAnchorId()||state.selectedNodeId;
  const layout=layoutRelatedNodesForGather(nodes,anchorId);
  if(!layout)return false;
  relatedGatherLayout=layout;
  syncGraphModeClasses();
  renderHeader();renderEdges();renderCards();renderDetails();updateCardQuickActions();
  const b=boundsForNodes(nodes);if(b)fitBoundsToView(b,{minScale:RELATED_GATHER_MIN_SCALE,maxScale:RELATED_GATHER_MAX_SCALE});
  if(showMessage)showStatus(`已进入临时聚拢布局：${nodes.length} 张相关卡牌已汇聚到一起，原图谱位置不会被修改。`);
  return true;
}
function boundsForNodes(nodes,options={}){
  if(!nodes.length)return null;
  let minX=Infinity,minY=Infinity,maxX=-Infinity,maxY=-Infinity;
  for(const n of nodes){
    const d=nodeDims(n),p=visualPositionForNode(n,options);
    minX=Math.min(minX,p.x);minY=Math.min(minY,p.y);
    maxX=Math.max(maxX,p.x+d.w);maxY=Math.max(maxY,p.y+d.h);
  }
  return{minX,minY,maxX,maxY,width:Math.max(1,maxX-minX),height:Math.max(1,maxY-minY)};
}
function fitBoundsToView(b,options={}){
  const r=stage.getBoundingClientRect(),margin=options.margin??(isCoarse?72:120);
  const rawScale=Math.min((r.width-margin)/(b.width||1),(r.height-margin)/(b.height||1));
  const scale=clamp(rawScale,options.minScale??.2,options.maxScale??1.18);
  state.viewport.scale=scale;
  state.viewport.x=(r.width-(b.minX+b.maxX)*scale)/2;
  state.viewport.y=(r.height-(b.minY+b.maxY)*scale)/2;
  applyTransform();
  viewportDirty=true;
  scheduleViewportCommit();
  updateCardQuickActions();
  return{rawScale,scale};
}
function fitRelatedScopeToView(showMessage=true){
  openRelatedCanvasModal(showMessage);
}
function ensureCardQuickActions(){
  if(cardQuickActionsEl&&stage.contains(cardQuickActionsEl))return cardQuickActionsEl;
  cardQuickActionsEl=document.createElement('div');
  cardQuickActionsEl.id='cardQuickActions';
  cardQuickActionsEl.className='card-context-actions';
  cardQuickActionsEl.dataset.stageUi='true';
  cardQuickActionsEl.addEventListener('pointerdown',e=>e.stopPropagation());
  cardQuickActionsEl.addEventListener('click',e=>{
    const btn=e.target.closest&&e.target.closest('button');if(!btn)return;
    e.preventDefault();e.stopPropagation();
    const id=cardQuickActionsEl.dataset.nodeId;
    if(btn.dataset.action==='center')setRelatedScopeCenter(id);
    if(btn.dataset.action==='fit')fitRelatedScopeToView(true);
    if(btn.dataset.action==='restore')clearRelatedGatherLayout({render:true,message:true});
  });
  stage.appendChild(cardQuickActionsEl);
  return cardQuickActionsEl;
}
function updateCardQuickActionsPosition(){
  if(!cardQuickActionsEl||!cardQuickActionsEl.classList.contains('show'))return;
  const id=cardQuickActionsEl.dataset.nodeId,card=id&&cardElementByNodeId(id);
  if(!card){cardQuickActionsEl.classList.remove('show');return}
  const cr=card.getBoundingClientRect(),sr=stage.getBoundingClientRect();
  const left=clamp(cr.right-sr.left+8,8,Math.max(8,sr.width-cardQuickActionsEl.offsetWidth-8));
  const top=clamp(cr.top-sr.top,8,Math.max(8,sr.height-cardQuickActionsEl.offsetHeight-8));
  cardQuickActionsEl.style.left=left+'px';
  cardQuickActionsEl.style.top=top+'px';
}
function updateCardQuickActions(){
  if(!largeGraphRelatedFocusEnabled||!state.selectedNodeId||!nodeById(state.selectedNodeId)){
    if(cardQuickActionsEl)cardQuickActionsEl.classList.remove('show');
    return;
  }
  const el=ensureCardQuickActions(),id=state.selectedNodeId,anchor=currentRelatedScopeAnchorId();
  el.dataset.nodeId=id;
  const isCenter=anchor===id,restore=isRelatedGatherActive();
  el.innerHTML=`${isCenter?'':`<button type="button" data-action="center" title="设为中心" aria-label="设为中心">${CENTER_SCOPE_ICON}</button>`}<button type="button" data-action="fit" title="适配相关" aria-label="适配相关">${FIT_SCOPE_ICON}</button>${restore?`<button type="button" data-action="restore" title="退出聚拢" aria-label="退出聚拢">${RESTORE_SCOPE_ICON}</button>`:''}`;
  el.classList.add('show');
  updateCardQuickActionsPosition();
}

function renderDetails(){
  const l=linkById(state.selectedLinkId),n=nodeById(state.selectedNodeId||(!state.selectedLinkId?hoverDetailNodeId:null)),isHoverPreview=!state.selectedNodeId&&!state.selectedLinkId&&!!hoverDetailNodeId;
  if(!n&&!l){detailPanel.classList.remove('show','hover-preview','detail-actions-expanded');detailPanel.innerHTML='';return}
  detailPanel.classList.remove('detail-actions-expanded');
  detailPanel.classList.toggle('hover-preview',!!isHoverPreview);
  const tools=`<button class="detail-actions-toggle detail-panel-control" id="detailActionsToggle" aria-expanded="false" title="展开操作"><span class="detail-actions-chevron" aria-hidden="true"><svg viewBox="0 0 16 16" focusable="false"><path d="m4 6 4 4 4-4"/></svg></span></button><button class="close-detail detail-panel-control" id="closeDetailBtn" aria-label="关闭详情"><span class="detail-close-icon" aria-hidden="true"><svg viewBox="0 0 16 16" focusable="false"><path d="m4 4 8 8M12 4l-8 8"/></svg></span></button>`;
  if(l){const a=nodeById(l.from),b=nodeById(l.to),lineColor=safeColor(l.color,DEFAULTS.linkColor);detailPanel.innerHTML=`${tools}<div class="detail-top"><div class="detail-mini-icon" style="background:#2563eb">线</div><div><div class="detail-name">知识关系</div><div class="detail-title">${escapeHTML(a?a.title:'?')} ↔ ${escapeHTML(b?b.title:'?')}</div></div></div><div class="detail-grid"><div class="label">关系</div><div><span class="badge">${escapeHTML(l.type||'关联')}</span></div><div class="label">线型</div><div>${l.lineStyle==='dashed'?'虚线':'实线'} ｜ <span style="display:inline-block;width:14px;height:14px;border-radius:4px;background:${lineColor};vertical-align:-2px;margin-right:4px"></span>${escapeHTML(lineColor)}</div><div class="label">备注</div><div>${escapeHTML(l.note||'暂无备注')}</div></div><div class="detail-actions"><button id="editLinkFromDetailBtn" class="primary">编辑关系</button><button id="deleteLinkFromDetailBtn" class="danger">删除线</button></div>`;detailPanel.classList.add('show');bindDetailBasics();$('editLinkFromDetailBtn').onclick=()=>openLinkModal(l.id);$('deleteLinkFromDetailBtn').onclick=()=>{if(confirm('确定删除这条知识关系吗？')){state.links=state.links.filter(i=>i.id!==l.id);clearSelection({persist:true});showStatus('关系线已删除。')}};return}
  const nodeColor=safeColor(n.color),nodeRelation=relatedScopeRelationForNode(n.id),anchor=nodeById(currentRelatedScopeAnchorId()),relationInfo=nodeRelation?`<div class="label">局部关系</div><div>${nodeRelation.relatedCount} 个相关知识点 ｜ ${nodeRelation.linkCount} 条关系${largeGraphRelatedFocusEnabled?` ｜ 只看相关中心：${escapeHTML(anchor?anchor.title:n.title)}`:''}</div>`:'';
  const scopeButtons=largeGraphRelatedFocusEnabled?`<button id="setScopeCenterBtn">以当前卡牌为中心</button><button id="fitScopeFromDetailBtn">适配相关</button>${isRelatedGatherActive()?'<button id="exitGatherLayoutBtn">退出聚拢</button>':''}`:'';
  detailPanel.innerHTML=`${tools}<div class="detail-top"><div class="detail-mini-icon" style="background:${nodeColor}">${escapeHTML((n.title||'?').slice(0,1))}</div><div><div class="detail-name">${escapeHTML(n.title||'未命名知识点')}</div><div class="detail-title">${escapeHTML(n.category||'未填写分类')} ${n.level?`｜${escapeHTML(n.level)}`:''}</div></div></div><div class="detail-grid">${relationInfo}<div class="label">关键词</div><div>${escapeHTML(n.keywords||'—')}</div><div class="label">说明</div><div>${escapeHTML(n.summary||'—')}</div><div class="label">学习提示</div><div>${escapeHTML(n.notes||'—')}</div></div><div class="detail-actions"><button id="editFromDetailBtn" class="primary">编辑知识点</button>${scopeButtons}<button id="toggleSourceBtn">${state.linkSourceId===n.id?'取消起点':'设为连线起点'}</button><button id="deleteNodeFromDetailBtn" class="danger">删除知识点</button></div>`;
  detailPanel.classList.add('show');bindDetailBasics();$('editFromDetailBtn').onclick=()=>openNodeModal(n.id);const setScopeBtn=$('setScopeCenterBtn');if(setScopeBtn)setScopeBtn.onclick=()=>setRelatedScopeCenter(n.id);const fitScopeBtn=$('fitScopeFromDetailBtn');if(fitScopeBtn)fitScopeBtn.onclick=()=>fitRelatedScopeToView(true);const exitGatherBtn=$('exitGatherLayoutBtn');if(exitGatherBtn)exitGatherBtn.onclick=()=>clearRelatedGatherLayout({render:true,message:true});$('toggleSourceBtn').onclick=()=>{state.linkSourceId=state.linkSourceId===n.id?null:n.id;showStatus(state.linkSourceId?`“${n.title}”已设为连线起点。`:'已取消连线起点。');render()};$('deleteNodeFromDetailBtn').onclick=()=>deleteNode(n.id);
}
function closeDetailPanel(){hoverDetailNodeId=null;clearTimeout(hoverDetailTimer);resetDetailPanelPosition();clearSelection()}
function bindDetailBasics(){
  const btn=$('closeDetailBtn');if(btn)btn.onclick=closeDetailPanel;
  const toggle=$('detailActionsToggle');if(toggle)toggle.onclick=e=>{
    e.stopPropagation();
    const expanded=!detailPanel.classList.contains('detail-actions-expanded');
    detailPanel.classList.toggle('detail-actions-expanded',expanded);
    toggle.classList.toggle('is-expanded',expanded);
    toggle.setAttribute('aria-expanded',expanded?'true':'false');
    toggle.title=expanded?'收起操作':'展开操作';
  };
}

function resetDetailPanelPosition(){
  detailPanelDragged=false;
  detailPanel.style.left='';
  detailPanel.style.top='';
  detailPanel.style.right='';
  detailPanel.style.bottom='';
  detailPanel.style.width='';
}
function clampDetailPanelToStage(left,top,width,height){
  const sr=stage.getBoundingClientRect(),margin=8;
  const maxLeft=sr.width-width-margin,maxTop=sr.height-height-margin;
  return{x:clamp(left,margin,Math.max(margin,maxLeft)),y:clamp(top,margin,Math.max(margin,maxTop))};
}
detailPanel.addEventListener('pointerdown',e=>{
  if(isCanvasPanMode())return;
  if(e.button!==0||e.target.closest('button,input,textarea,select'))return;
  const handle=e.target.closest('.detail-top');if(!handle||!detailPanel.contains(handle)||!detailPanel.classList.contains('show'))return;
  e.preventDefault();e.stopPropagation();
  const rect=detailPanel.getBoundingClientRect(),sr=stage.getBoundingClientRect();
  detailPanelDragged=true;
  detailDrag={pointerId:e.pointerId,startX:e.clientX,startY:e.clientY,left:rect.left-sr.left,top:rect.top-sr.top,width:rect.width,height:rect.height};
  detailPanel.classList.add('detail-dragging');
  detailPanel.style.width=rect.width+'px';
  detailPanel.style.left=detailDrag.left+'px';
  detailPanel.style.top=detailDrag.top+'px';
  detailPanel.style.right='auto';
  detailPanel.style.bottom='auto';
  detailPanel.setPointerCapture&&detailPanel.setPointerCapture(e.pointerId);
});
detailPanel.addEventListener('pointermove',e=>{
  if(!detailDrag||detailDrag.pointerId!==e.pointerId)return;
  e.preventDefault();e.stopPropagation();
  const next=clampDetailPanelToStage(detailDrag.left+e.clientX-detailDrag.startX,detailDrag.top+e.clientY-detailDrag.startY,detailDrag.width,detailDrag.height);
  detailPanel.style.left=next.x+'px';
  detailPanel.style.top=next.y+'px';
});
function finishDetailDrag(e){
  if(!detailDrag||detailDrag.pointerId!==e.pointerId)return;
  e.preventDefault();e.stopPropagation();
  try{detailPanel.releasePointerCapture&&detailPanel.releasePointerCapture(e.pointerId)}catch{}
  detailDrag=null;detailPanel.classList.remove('detail-dragging');
}
detailPanel.addEventListener('pointerup',finishDetailDrag);
detailPanel.addEventListener('pointercancel',finishDetailDrag);
function handleNodeTap(id){
  clearMultiSelection();
  clearHoverDetail(false);
  state.selectedLinkId=null;
  const clicked=nodeById(id);if(!clicked)return;
  let changed=false;
  if(state.linkSourceId&&state.linkSourceId!==id){
    const source=state.linkSourceId,a=nodeById(source),b=clicked;
    if(relationExists(source,id)){
      showStatus(`“${a?a.title:'起点'}”与“${b.title}”之间已有关系线。`);
    }else{
      const link=makeLink(source,id,'关联','',state.defaults.linkStyle,state.defaults.linkColor);
      state.links.push(link);state.selectedLinkId=link.id;changed=true;
      showStatus(`已建立关系：${a?a.title:'起点'} → ${b.title}`);
    }
    state.selectedNodeId=null;
    state.linkSourceId=null;
  }else{
    state.selectedNodeId=id;
    if(largeGraphRelatedFocusEnabled&&!currentRelatedScopeAnchorId())relatedScopeAnchorNodeId=id;
    const relation=largeGraphRelationState();
    showStatus(relation&&relationLayerEnabled()?`已查看“${clicked.title}”：${relation.relatedCount} 个相关知识点，${relation.linkCount} 条关系。`:`已查看“${clicked.title}”。双击该卡牌可设为连线起点。`);
  }
  refreshSelectionUI({persist:changed});
}
function activateLinkSource(id){
  clearMultiSelection();
  clearHoverDetail(false);
  const n=nodeById(id);if(!n)return;
  state.selectedLinkId=null;
  state.selectedNodeId=id;
  state.linkSourceId=id;
  showStatus(`“${n.title}”已设为连线起点，请单击另一个知识点建立关系。`);
  refreshSelectionUI();
}
function selectLink(id,event=null){clearMultiSelection();clearHoverDetail(false);setSelectedEdgeQuickStyleAnchorFromEvent(event);state.selectedLinkId=id;state.selectedNodeId=null;state.linkSourceId=null;const l=linkById(id),a=nodeById(l&&l.from),b=nodeById(l&&l.to);showStatus(l&&a&&b?`已选择关系：${a.title} ↔ ${b.title}。可在线旁切换实线/虚线。`:'已选择关系线。可在线旁切换实线/虚线。');refreshSelectionUI()}
function clearSelection(options={}){hoverDetailNodeId=null;clearTimeout(hoverDetailTimer);clearMultiSelection();state.selectedNodeId=null;state.selectedLinkId=null;state.linkSourceId=null;refreshSelectionUI(options)}
function createNodeAt(x,y){const sub=window.KGSubscription;if(sub&&typeof sub.requireUsageLimit==='function'&&!sub.requireUsageLimit('graphNodes',state.nodes.length,1,{label:'图谱卡牌'}))return null;clearRelatedGatherLayout({render:false,message:false});clearMultiSelection();const size=state.defaults.nodeSize||'',color=safeColor(state.defaults.nodeColor,DEFAULTS.nodeColor),d=dimsForSize(size),n=makeNode('新知识点',Math.round(x-d.w/2),Math.round(y-d.h/2),color,'','基础','','','',size);state.nodes.push(n);state.selectedNodeId=n.id;state.selectedLinkId=null;state.linkSourceId=null;render({persist:true});openNodeModal(n.id,true);return n}

let graphSearchPanel=null,graphSearchInputTimer=null,graphSearchIndexCache=null,graphSearchIndexStateRef=null,graphSearchIndexNodesRef=null,graphSearchIndexNodeLength=-1,graphSearchIndexVersion=0,graphSearchIndexBuiltVersion=-1;
function invalidateGraphSearchIndex(){
  graphSearchIndexVersion++;
  graphSearchIndexCache=null;
}
function normalizeGraphSearchText(v){
  return String(v||'').trim().toLowerCase();
}
function graphSearchText(n){
  return [n.title,n.category,n.level,n.keywords,n.summary,n.notes,n.highlightTerms].filter(Boolean).join(' ').toLowerCase();
}
function buildGraphSearchIndex(){
  const nodes=Array.isArray(state&&state.nodes)?state.nodes:[];
  if(graphSearchIndexCache&&graphSearchIndexStateRef===state&&graphSearchIndexNodesRef===nodes&&graphSearchIndexNodeLength===nodes.length&&graphSearchIndexBuiltVersion===graphSearchIndexVersion)return graphSearchIndexCache;
  graphSearchIndexCache=nodes.map(n=>{
    const title=normalizeGraphSearchText(n&&n.title),category=normalizeGraphSearchText(n&&n.category),keywords=normalizeGraphSearchText(n&&n.keywords);
    return{node:n,title,category,keywords,haystack:graphSearchText(n||{})};
  });
  graphSearchIndexStateRef=state;
  graphSearchIndexNodesRef=nodes;
  graphSearchIndexNodeLength=nodes.length;
  graphSearchIndexBuiltVersion=graphSearchIndexVersion;
  return graphSearchIndexCache;
}
function graphSearchResults(query){
  const q=normalizeGraphSearchText(query);
  if(!q)return[];
  const terms=q.split(/\s+/).filter(Boolean);
  const results=[];
  for(const item of buildGraphSearchIndex()){
    if(!item||!item.node)continue;
    let score=0;
    for(const term of terms){
      if(!item.haystack.includes(term)){score=-1;break}
      if(item.title.includes(term))score+=12;
      if(item.keywords.includes(term))score+=7;
      if(item.category.includes(term))score+=5;
      score+=1;
    }
    if(score>=0)results.push({node:item.node,score});
  }
  return results.sort((a,b)=>b.score-a.score||String(a.node.title||'').localeCompare(String(b.node.title||''),'zh-Hans-CN')).slice(0,80);
}
function ensureGraphSearchPanel(){
  if(graphSearchPanel&&stage.contains(graphSearchPanel))return graphSearchPanel;
  graphSearchPanel=document.createElement('aside');
  graphSearchPanel.id='graphSearchPanel';
  graphSearchPanel.className='graph-search-panel';
  graphSearchPanel.dataset.stageUi='true';
  graphSearchPanel.innerHTML=`<div class="graph-search-head"><strong>搜索定位</strong><button type="button" id="graphSearchCloseBtn" aria-label="关闭搜索">×</button></div><input id="graphSearchInput" class="graph-search-input" placeholder="搜索标题、分类、关键词、说明…" autocomplete="off"/><div class="graph-search-meta" id="graphSearchMeta">输入关键词后，点击结果可自动定位并显示局部关系。</div><div class="graph-search-results" id="graphSearchResults"></div>`;
  stage.appendChild(graphSearchPanel);
  graphSearchPanel.addEventListener('pointerdown',e=>e.stopPropagation());
  graphSearchPanel.addEventListener('dblclick',e=>e.stopPropagation());
  graphSearchPanel.addEventListener('wheel',e=>e.stopPropagation(),{passive:true});
  graphSearchPanel.addEventListener('touchmove',e=>e.stopPropagation(),{passive:true});
  const input=graphSearchPanel.querySelector('#graphSearchInput');
  const close=graphSearchPanel.querySelector('#graphSearchCloseBtn');
  close.onclick=closeGraphSearchPanel;
  input.addEventListener('input',()=>{clearTimeout(graphSearchInputTimer);graphSearchInputTimer=setTimeout(()=>renderGraphSearchResults(input.value),90)});
  input.addEventListener('keydown',e=>{
    if(e.key==='Escape'){e.preventDefault();closeGraphSearchPanel();return}
    if(e.key==='Enter'){
      const first=graphSearchPanel.querySelector('.graph-search-result');
      if(first){e.preventDefault();focusGraphNodeFromSearch(first.dataset.nodeId)}
    }
  });
  return graphSearchPanel;
}
function openGraphSearchPanel(){
  const panel=ensureGraphSearchPanel(),input=panel.querySelector('#graphSearchInput');
  panel.classList.add('show');
  renderGraphSearchResults(input.value);
  setTimeout(()=>{input.focus();input.select()},30);
}
function closeGraphSearchPanel(){
  if(graphSearchPanel)graphSearchPanel.classList.remove('show');
}
function renderGraphSearchResults(query){
  const panel=ensureGraphSearchPanel(),box=panel.querySelector('#graphSearchResults'),meta=panel.querySelector('#graphSearchMeta'),q=String(query||'').trim();
  if(!q){
    box.innerHTML='<div class="graph-search-empty">输入关键词搜索卡牌。</div>';
    meta.textContent=`当前图谱：${state.nodes.length} 张卡牌，${state.links.length} 条关系。`;
    return;
  }
  const results=graphSearchResults(q);
  meta.textContent=results.length?`找到 ${results.length}${results.length>=80?'+' : ''} 个结果。点击结果自动定位。`:'没有找到匹配卡牌。';
  if(!results.length){box.innerHTML='<div class="graph-search-empty">换一个关键词试试，例如分类、标题或关键词。</div>';return}
  box.innerHTML=results.map(({node:n})=>`<button type="button" class="graph-search-result" data-node-id="${escapeHTML(n.id)}"><span class="graph-search-result-title">${escapeHTML(n.title||'未命名知识点')}</span><span class="graph-search-result-sub">${escapeHTML([n.category,n.level].filter(Boolean).join(' ｜ ')||'未填写分类')}</span><span class="graph-search-result-keywords">${escapeHTML(n.keywords||n.summary||'')}</span></button>`).join('');
  box.querySelectorAll('.graph-search-result').forEach(btn=>btn.onclick=()=>focusGraphNodeFromSearch(btn.dataset.nodeId));
}
function centerViewportOnNode(n,options={}){
  if(!n)return;
  const r=stage.getBoundingClientRect(),d=nodeDims(n),p=visualPositionForNode(n);
  const targetScale=options.scale||clamp(Math.max(state.viewport.scale,isLargeGraphMode()?.64:.95),.2,1.35);
  state.viewport.scale=targetScale;
  state.viewport.x=r.width/2-(p.x+d.w/2)*targetScale;
  state.viewport.y=r.height/2-(p.y+d.h/2)*targetScale;
  applyTransform();
  viewportDirty=true;
  scheduleViewportCommit();
}
function focusGraphNodeFromSearch(id){
  const n=nodeById(id);if(!n)return;
  clearMultiSelection();
  clearHoverDetail(false);
  state.selectedNodeId=n.id;
  state.selectedLinkId=null;
  state.linkSourceId=null;
  clearRelatedGatherLayout({render:false,message:false});
  if(largeGraphRelatedFocusEnabled)relatedScopeAnchorNodeId=n.id;
  centerViewportOnNode(n);
  refreshSelectionUI();
  const relation=largeGraphRelationState();
  showStatus(relation&&relationLayerEnabled()?`已定位“${n.title}”：${relation.relatedCount} 个相关知识点，${relation.linkCount} 条关系。`:`已定位“${n.title}”。`);
}
const GRAPH_POINTER_ARROW_ICON='<svg aria-hidden="true" viewBox="0 0 24 24"><path d="M5 3l13 8-6 1.2 3.7 6.2-2.8 1.6-3.6-6.1L5 18V3z"/></svg>';
const GRAPH_POINTER_HAND_ICON='<svg aria-hidden="true" viewBox="0 0 24 24"><path d="M8 12V6.5a1.5 1.5 0 0 1 3 0V11"/><path d="M11 11V5.5a1.5 1.5 0 0 1 3 0V11"/><path d="M14 11V7.5a1.5 1.5 0 0 1 3 0V13"/><path d="M8 12l-1.1-1.1a1.6 1.6 0 0 0-2.3 2.2l4.2 5.1A5.5 5.5 0 0 0 13 20h1a5 5 0 0 0 5-5v-3.5a1.5 1.5 0 0 0-3 0V13"/></svg>';
let graphPointerMode='edit',temporaryPanMode=false,temporaryPanReason='',rightPanPointerId=null;
function isCanvasPanMode(){return graphPointerMode==='pan'||temporaryPanMode}
function isPermanentPanMode(){return graphPointerMode==='pan'}
function updateGraphPointerModeUI(){
  stage.classList.toggle('pointer-edit-mode',!isCanvasPanMode());
  stage.classList.toggle('pointer-pan-mode',graphPointerMode==='pan');
  stage.classList.toggle('pointer-temp-pan-mode',!!temporaryPanMode);
  const btn=$('pointerModeBtn');
  if(btn){
    const pan=isPermanentPanMode();
    btn.classList.toggle('active-toggle',pan);
    btn.innerHTML=pan?GRAPH_POINTER_HAND_ICON:GRAPH_POINTER_ARROW_ICON;
    const txt='选择/手型 V';
    btn.setAttribute('aria-label',txt);
    btn.removeAttribute('title');
    btn.dataset.tooltip=txt;
  }
}
function setTemporaryGraphPanMode(active,reason=''){
  if(active){
    temporaryPanMode=true;
    temporaryPanReason=reason||temporaryPanReason;
  }else if(!reason||temporaryPanReason===reason){
    temporaryPanMode=false;
    temporaryPanReason='';
  }
  updateGraphPointerModeUI();
}
function setGraphPointerMode(mode,announce=false){
  graphPointerMode=mode==='pan'?'pan':'edit';
  temporaryPanMode=false;
  temporaryPanReason='';
  updateGraphPointerModeUI();
  if(announce&&typeof showStatus==='function')showStatus(graphPointerMode==='pan'?'已切换为演示模式：拖动画布浏览，卡牌与关系线不会被编辑。':'已切换为编辑模式：可选择、拖拽和编辑卡牌，画布拖动需按住空格或右键。');
}
function toggleGraphPointerMode(){setGraphPointerMode(graphPointerMode==='pan'?'edit':'pan',true)}
function isPanBlockedUI(target){
  return !!(target&&target.closest&&target.closest('[data-stage-ui],.canvas-toolbar-left,.canvas-toolbar-right,.account-menu-shell,.account-menu,.detail-panel,.mobile-bar,.toolbar,.floating-toolbox,.modal-backdrop,.help-card'));
}
const activePointers=new Map();let pan=null,pinch=null,viewportDirty=false,stageTap=null;
let stageInteractingTimer=null;
function markStageInteracting(){if(!stage.classList.contains('is-interacting'))stage.classList.add('is-interacting');clearTimeout(stageInteractingTimer);stageInteractingTimer=setTimeout(()=>{stage.classList.remove('is-interacting');stageInteractingTimer=null},220)}
function isUI(target){return !!(target&&target.closest&&target.closest('[data-stage-ui],.canvas-toolbar-left,.canvas-toolbar-right,.account-menu-shell,.account-menu,.knowledge-card,.edge-hit,.detail-panel,.mobile-bar,.toolbar,.floating-toolbox,.modal-backdrop,.help-card'))}
// C-1.4.2：为画布内的悬浮 UI 建立显式事件隔离层。
// 即使后续 DOM 结构或选择器变化，悬浮模块上的按下、双击和滚轮也不会冒泡到画布平移/缩放/新建节点逻辑。
function bindStageUIEventGuards(){
  document.querySelectorAll('[data-stage-ui],.canvas-toolbar-left,.canvas-toolbar-right').forEach(root=>{
    if(!root||root.dataset.stageEventGuard==='1')return;
    root.dataset.stageEventGuard='1';
    root.addEventListener('pointerdown',event=>event.stopPropagation());
    root.addEventListener('dblclick',event=>event.stopPropagation());
    // 滚轮不再隔离：只要鼠标位于首页图谱画布区域内，卡牌、关系线、工具栏和面板上都允许缩放。
  });
}
bindStageUIEventGuards();
function startStageEditTap(e){
  stageTap={id:e.pointerId,startX:e.clientX,startY:e.clientY,moved:false};
  try{stage.setPointerCapture(e.pointerId)}catch{}
}
function moveStageEditTap(e){
  if(!stageTap||stageTap.id!==e.pointerId)return;
  if(Math.hypot(e.clientX-stageTap.startX,e.clientY-stageTap.startY)>5)stageTap.moved=true;
}
function finishStageEditTap(e,cancelled=false){
  if(!stageTap||stageTap.id!==e.pointerId)return;
  const tap=stageTap;stageTap=null;
  try{stage.releasePointerCapture(e.pointerId)}catch{}
  if(!cancelled&&!tap.moved){clearSelection();showStatus('已关闭详情。')}
}
stage.addEventListener('pointerdown',e=>{
  if(typeof cancelGraphSmoothZoom==='function')cancelGraphSmoothZoom();
  const touchPan=e.pointerType==='touch';
  const rightPan=e.button===2;
  const panRequested=touchPan||rightPan||isCanvasPanMode();
  if(!panRequested){
    if(e.button!==0)return;
    if(isUI(e.target))return;
    startBoxSelection(e);
    return;
  }
  if(e.button!==0&&e.button!==2)return;
  if(isPanBlockedUI(e.target))return;
  if(rightPan){rightPanPointerId=e.pointerId;setTemporaryGraphPanMode(true,'right')}
  e.preventDefault();
  activePointers.set(e.pointerId,{x:e.clientX,y:e.clientY,startX:e.clientX,startY:e.clientY});
  try{stage.setPointerCapture(e.pointerId)}catch{}
  if(activePointers.size===1){pan={id:e.pointerId,x:e.clientX,y:e.clientY,vx:state.viewport.x,vy:state.viewport.y,moved:false};stage.classList.add('panning')}
  else if(activePointers.size===2){const pts=[...activePointers.values()];const center=mid(pts[0],pts[1]);pinch={dist:dist(pts[0],pts[1]),scale:state.viewport.scale,worldCenter:screenToWorld(center.x,center.y),moved:false};pan=null}
});
stage.addEventListener('pointermove',e=>{if(!activePointers.has(e.pointerId))return;e.preventDefault();const p=activePointers.get(e.pointerId);p.x=e.clientX;p.y=e.clientY;if(activePointers.size>=2&&pinch){const pts=[...activePointers.values()].slice(0,2);const d=dist(pts[0],pts[1]);const center=mid(pts[0],pts[1]);const r=stage.getBoundingClientRect();const ns=clamp(pinch.scale*(d/pinch.dist),graphViewportMinScale(),graphViewportMaxScale());if(Math.abs(d-pinch.dist)>4)pinch.moved=true;markStageInteracting();state.viewport.scale=ns;state.viewport.x=center.x-r.left-pinch.worldCenter.x*ns;state.viewport.y=center.y-r.top-pinch.worldCenter.y*ns;viewportDirty=true;applyTransform();return}if(pan&&pan.id===e.pointerId){const dx=e.clientX-pan.x,dy=e.clientY-pan.y;if(Math.hypot(dx,dy)>5)pan.moved=true;markStageInteracting();state.viewport.x=pan.vx+dx;state.viewport.y=pan.vy+dy;viewportDirty=true;applyTransform()}});
stage.addEventListener('pointermove',moveStageEditTap,{passive:true});
stage.addEventListener('pointermove',moveBoxSelection,{passive:false});
stage.addEventListener('pointerup',e=>finishBoxSelection(e),{passive:false});
stage.addEventListener('pointercancel',e=>finishBoxSelection(e,true),{passive:false});
stage.addEventListener('pointerup',e=>finishStageEditTap(e),{passive:false});
stage.addEventListener('pointercancel',e=>finishStageEditTap(e,true),{passive:false});
stage.addEventListener('contextmenu',e=>{if(!isPanBlockedUI(e.target))e.preventDefault()});
stage.addEventListener('pointerup',endStagePointer);stage.addEventListener('pointercancel',endStagePointer);
let viewportCommitTimer=null;
function commitViewportIfDirty(){if(!viewportDirty)return;viewportDirty=false;save()}
function scheduleViewportCommit(){clearTimeout(viewportCommitTimer);viewportCommitTimer=setTimeout(()=>{viewportCommitTimer=null;commitViewportIfDirty()},240)}
function endStagePointer(e){if(!activePointers.has(e.pointerId))return;const wasPan=pan&&pan.id===e.pointerId,panMoved=pan&&pan.moved,pinchMoved=pinch&&pinch.moved;activePointers.delete(e.pointerId);try{stage.releasePointerCapture(e.pointerId)}catch{}if(e.pointerId===rightPanPointerId){rightPanPointerId=null;setTemporaryGraphPanMode(false,'right')}if(activePointers.size<2)pinch=null;if(activePointers.size===0){stage.classList.remove('panning');if(wasPan&&!panMoved&&!pinchMoved){clearSelection();showStatus('已关闭详情。')}pan=null;commitViewportIfDirty()}else if(activePointers.size===1){const remain=[...activePointers.values()][0];pan={id:[...activePointers.keys()][0],x:remain.x,y:remain.y,vx:state.viewport.x,vy:state.viewport.y,moved:false}}}
stage.addEventListener('dblclick',e=>{if(isCanvasPanMode()||isUI(e.target))return;const pt=screenToWorld(e.clientX,e.clientY);createNodeAt(pt.x,pt.y)});
function isTextEditingTarget(target){const el=target&&target.closest&&target.closest('input,textarea,select,[contenteditable]');return !!(el&&(!el.hasAttribute||el.getAttribute('contenteditable')!=='false'))}
document.addEventListener('keydown',e=>{if((e.code==='Space'||e.key===' ')&&!e.repeat&&!isTextEditingTarget(e.target)){setTemporaryGraphPanMode(true,'space');e.preventDefault()}});
document.addEventListener('keyup',e=>{if(e.code==='Space'||e.key===' '){setTemporaryGraphPanMode(false,'space');e.preventDefault()}});
updateGraphPointerModeUI();
stage.addEventListener('pointermove',e=>{lastGraphPointerWorldPosition=screenToWorld(e.clientX,e.clientY)},{passive:true});
stage.addEventListener('pointerdown',e=>{lastGraphPointerWorldPosition=screenToWorld(e.clientX,e.clientY)},{passive:true});
function selectAllGraphNodesFromShortcut(){
  const ids=(state.nodes||[]).map(n=>n&&n.id).filter(Boolean);
  if(!ids.length){showStatus('当前图谱还没有知识点。');return true}
  clearHoverDetail(false);
  state.selectedLinkId=null;
  state.linkSourceId=null;
  selectedNodeIds=new Set(ids);
  state.selectedNodeId=ids[0]||null;
  refreshSelectionUI();
  showStatus(`已全选 ${ids.length} 个知识点。按 Delete 可批量删除。`);
  return true;
}
function handleGraphClipboardShortcut(e){
  if(isTextEditingTarget(e.target)||e.altKey)return;
  const combo=e.ctrlKey||e.metaKey;
  if(!combo)return;
  const key=String(e.key||'').toLowerCase();
  if(key==='a'){
    if(selectAllGraphNodesFromShortcut()){e.preventDefault();e.stopPropagation()}
    return;
  }
  if(key==='c'){
    if(copySelectedGraphCards()){e.preventDefault();e.stopPropagation()}
    return;
  }
  if(key==='v'){
    if(pasteGraphClipboardCards()){e.preventDefault();e.stopPropagation()}
    return;
  }
  if(key==='z'&&!e.shiftKey){
    if(restoreGraphUndoSnapshot()){e.preventDefault();e.stopPropagation()}
  }
}
document.addEventListener('keydown',handleGraphClipboardShortcut);
stage.addEventListener('wheel',e=>{
  if(isTextEditingTarget(e.target))return;
  e.preventDefault();
  markStageInteracting();
  const direction=e.deltaY<0?1:-1;
  if(typeof smoothGraphWheelZoomAtClientPoint==='function'){
    smoothGraphWheelZoomAtClientPoint(direction,e.clientX,e.clientY);
  }else{
    const before=screenToWorld(e.clientX,e.clientY),ns=nextGraphWheelZoomScale(state.viewport.scale||1,direction),r=stage.getBoundingClientRect();
    state.viewport.scale=ns;state.viewport.x=e.clientX-r.left-before.x*ns;state.viewport.y=e.clientY-r.top-before.y*ns;viewportDirty=true;applyTransform();scheduleViewportCommit();
  }
},{passive:false});
let editingNodeId=null,editingLinkId=null;
function openNodeModal(id,isNew=false){const n=nodeById(id);if(!n)return;editingNodeId=id;$('nodeModalTitle').textContent=isNew?'创建知识点':'编辑知识点';$('nTitle').value=n.title||'';$('nCategory').value=n.category||'';$('nColor').value=safeColor(n.color,'#64748b');$('nSize').value=n.size||'';$('nLevel').value=n.level||'基础';$('nKeywords').value=n.keywords||'';$('nSummary').value=n.summary||'';$('nNotes').value=n.notes||'';$('deleteNodeBtn').style.display=isNew?'none':'';$('nodeModal').classList.add('show');setTimeout(()=>$('nTitle').focus(),80)}
function closeNodeModal(){$('nodeModal').classList.remove('show')}
$('cancelNodeBtn').onclick=closeNodeModal;
$('saveNodeBtn').onclick=()=>{const n=nodeById(editingNodeId);if(!n)return;n.title=$('nTitle').value.trim()||'未命名知识点';n.category=$('nCategory').value.trim();n.color=safeColor($('nColor').value,'#64748b');n.size=NODE_SIZES.has($('nSize').value)?$('nSize').value:'';n.level=$('nLevel').value||'基础';n.keywords=$('nKeywords').value.trim();n.summary=$('nSummary').value.trim();n.notes=$('nNotes').value.trim();closeNodeModal();render({persist:true});showStatus('知识点已保存。')};
$('deleteNodeBtn').onclick=()=>{if(editingNodeId)deleteNode(editingNodeId,true)};
function deleteNode(id,fromModal=false){const n=nodeById(id);if(!n)return;if(confirm(`确定删除“${n.title}”及相关关系线吗？`)){pushGraphUndoSnapshot(`删除“${n.title}”`);if(relatedGatherLayout&&relatedGatherLayout.positions&&relatedGatherLayout.positions.has(n.id))clearRelatedGatherLayout({render:false,message:false});state.nodes=state.nodes.filter(i=>i.id!==n.id);selectedNodeIds.delete(n.id);state.links=state.links.filter(l=>l.from!==n.id&&l.to!==n.id);if(state.selectedNodeId===n.id)state.selectedNodeId=null;if(state.linkSourceId===n.id)state.linkSourceId=null;if(relatedScopeAnchorNodeId===n.id)relatedScopeAnchorNodeId=null;if(fromModal)closeNodeModal();render({persist:true});showStatus('知识点已删除。')}}
function deleteSelectedNodesBatch(){
  const ids=[...selectedNodeIds].filter(id=>nodeById(id));
  if(!ids.length)return false;
  if(ids.length===1){deleteNode(ids[0]);return true}
  if(typeof authRequire==='function'&&!authRequire('登录后才能删除框选知识点。'))return true;
  const sample=ids.map(id=>nodeById(id)).filter(Boolean).slice(0,3).map(n=>n.title).join('、');
  const suffix=ids.length>3?' 等':'';
  if(!confirm(`确定删除框选的 ${ids.length} 个知识点及相关关系线吗？${sample?'\n'+sample+suffix:''}`))return true;
  pushGraphUndoSnapshot(`删除 ${ids.length} 个框选知识点`);
  const idSet=new Set(ids);
  if(relatedGatherLayout&&relatedGatherLayout.positions&&ids.some(id=>relatedGatherLayout.positions.has(id)))clearRelatedGatherLayout({render:false,message:false});
  state.nodes=state.nodes.filter(n=>!idSet.has(n.id));
  state.links=state.links.filter(l=>!idSet.has(l.from)&&!idSet.has(l.to));
  if(idSet.has(state.selectedNodeId))state.selectedNodeId=null;
  if(idSet.has(state.linkSourceId))state.linkSourceId=null;
  if(idSet.has(relatedScopeAnchorNodeId))relatedScopeAnchorNodeId=null;
  state.selectedNodeId=null;
  state.selectedLinkId=null;
  clearMultiSelection();
  render({persist:true});
  showStatus(`已删除 ${ids.length} 个框选知识点及相关关系线。`);
  return true;
}
function openLinkModal(id){const l=linkById(id);if(!l)return;editingLinkId=id;state.selectedLinkId=id;state.selectedNodeId=null;state.linkSourceId=null;$('linkType').value=l.type||'关联';$('linkStyle').value=l.lineStyle||DEFAULTS.linkStyle;$('linkColor').value=safeColor(l.color,DEFAULTS.linkColor);$('linkNote').value=l.note||'';$('linkModal').classList.add('show');setTimeout(()=>$('linkNote').focus(),80);renderEdges()}
function closeLinkModal(){$('linkModal').classList.remove('show')}
$('cancelLinkBtn').onclick=closeLinkModal;
$('saveLinkBtn').onclick=()=>{const l=linkById(editingLinkId);if(l){l.type=$('linkType').value||'关联';l.lineStyle=LINE_STYLES.has($('linkStyle').value)?$('linkStyle').value:DEFAULTS.linkStyle;l.color=safeColor($('linkColor').value,DEFAULTS.linkColor);l.note=$('linkNote').value.trim()}closeLinkModal();render({persist:true});showStatus('关系线已保存。')};
$('deleteLinkBtn').onclick=()=>{if(editingLinkId){state.links=state.links.filter(l=>l.id!==editingLinkId);state.selectedLinkId=null}closeLinkModal();render({persist:true});showStatus('关系线已删除。')};
function currentGraphTitle(){
  const fileStore=window.KGGraphFileStore,currentFile=fileStore&&fileStore.getCurrentFileMeta?fileStore.getCurrentFileMeta():(fileStore&&fileStore.getCurrentFile?fileStore.getCurrentFile():null);
  return currentFile&&currentFile.name||state.meta.title||'知识点关系图谱';
}
function formatGraphInfoTime(value){
  const time=Number(value)||0;
  if(!time)return '—';
  try{return new Date(time).toLocaleString('zh-CN',{year:'numeric',month:'2-digit',day:'2-digit',hour:'2-digit',minute:'2-digit'})}
  catch(err){return new Date(time).toLocaleString()}
}
function formatGraphInfoSize(bytes){
  const size=Math.max(0,Number(bytes)||0);
  if(size>=1024*1024)return (size/1024/1024).toFixed(size>=10*1024*1024?1:2)+' MB';
  if(size>=1024)return (size/1024).toFixed(size>=10*1024?1:2)+' KB';
  return size+' B';
}
function graphInfoSnapshot(){
  try{
    if(typeof saveableState==='function')return saveableState();
  }catch(err){}
  return state;
}
function graphInfoFileBytes(){
  const data=graphInfoSnapshot();
  const text=JSON.stringify(data||{});
  try{return new TextEncoder().encode(text).length}catch(err){return text.length}
}
function collectGraphTextParts(value,parts=[]){
  if(value==null)return parts;
  if(typeof value==='string'){const text=value.trim();if(text)parts.push(text);return parts}
  if(typeof value==='number'||typeof value==='boolean')return parts;
  if(Array.isArray(value)){value.forEach(item=>collectGraphTextParts(item,parts));return parts}
  if(typeof value==='object'){
    Object.entries(value).forEach(([key,item])=>{
      if(/^(id|from|to|x|y|color|lineStyle|createdAt|updatedAt|lastOpenedAt|order|viewport|scale)$/i.test(key))return;
      collectGraphTextParts(item,parts);
    });
  }
  return parts;
}
function graphInfoWordCount(){
  const text=collectGraphTextParts(graphInfoSnapshot(),[]).join('\n');
  const cjk=(text.match(/[\u3400-\u9fff]/g)||[]).length;
  const words=(text.replace(/[\u3400-\u9fff]/g,' ').match(/[A-Za-z0-9]+(?:[-_'][A-Za-z0-9]+)*/g)||[]).length;
  return cjk+words;
}
function updateGraphInfoModal(){
  const fileStore=window.KGGraphFileStore,currentFile=fileStore&&fileStore.getCurrentFileMeta?fileStore.getCurrentFileMeta():(fileStore&&fileStore.getCurrentFile?fileStore.getCurrentFile():null);
  const now=Date.now(),created=currentFile&&currentFile.createdAt||state.meta&&state.meta.createdAt||now,updated=currentFile&&currentFile.updatedAt||state.meta&&state.meta.updatedAt||created;
  const set=(id,value)=>{const el=$(id);if(el)el.textContent=value};
  set('gCreatedAt',formatGraphInfoTime(created));
  set('gUpdatedAt',formatGraphInfoTime(updated));
  set('gFileSize',formatGraphInfoSize(graphInfoFileBytes()));
  set('gNodeCount',`${state.nodes&&state.nodes.length||0} 个`);
  set('gWordCount',`${graphInfoWordCount()} 字`);
}
function saveGraphTitle(nextTitle,options={}){
  nextTitle=String(nextTitle||'').trim().slice(0,40)||'知识点关系图谱';
  const fileStore=window.KGGraphFileStore,currentFile=fileStore&&fileStore.getCurrentFileMeta?fileStore.getCurrentFileMeta():(fileStore&&fileStore.getCurrentFile?fileStore.getCurrentFile():null),oldTitle=state.meta&&state.meta.title;
  if(!state.meta)state.meta={};
  state.meta.title=nextTitle;
  if(currentFile&&typeof persistCurrentGraphNow==='function'){
    const saved=persistCurrentGraphNow({force:true,name:nextTitle,emit:true});
    if(!saved){state.meta.title=oldTitle||currentFile.name||'知识点关系图谱';showStatus('图谱标题保存失败：浏览器本地存储空间可能已满。');return false}
    if(window.KGGraphFileAutosave&&window.KGGraphFileAutosave.clearDirty)window.KGGraphFileAutosave.clearDirty('title-saved');
  }else if(currentFile&&fileStore&&fileStore.renameFile){
    const renamed=fileStore.renameFile(currentFile.id,nextTitle,{emit:true});
    if(!renamed){state.meta.title=oldTitle||'知识点关系图谱';showStatus('文件名称保存失败：浏览器本地存储空间可能已满。');return false}
  }else{
    render({persist:true});
  }
  renderHeader();
  render({persist:false});
  if(window.KGGraphFileTabs&&window.KGGraphFileTabs.refresh)window.KGGraphFileTabs.refresh();
  if(options.message!==false)showStatus('图谱标题已保存，并已同步为文件名称。');
  return true;
}
function openGraphModal(){
  $('gTitle').value=currentGraphTitle();
  updateGraphInfoModal();
  $('graphModal').classList.add('show');
  setTimeout(()=>$('gTitle').focus(),80);
}
$('cancelGraphBtn').onclick=()=>$('graphModal').classList.remove('show');
$('saveGraphBtn').onclick=()=>{
  if(!saveGraphTitle($('gTitle').value))return;
  updateGraphInfoModal();
  $('graphModal').classList.remove('show');
};
function requestGraphMetaEdit(){if(typeof authRequire==='function'&&!authRequire('登录后才能编辑图谱标题。'))return;openGraphModal()}
let graphTitleEditTimer=null,graphTitleInput=null;
function closeInlineGraphTitleEdit(commit=false){
  if(!graphTitleInput)return;
  const input=graphTitleInput;
  const value=input.value;
  graphTitleInput=null;
  input.remove();
  const titleEl=$('appTitle');
  if(titleEl)titleEl.style.display='';
  if(commit)saveGraphTitle(value);
}
function openInlineGraphTitleEdit(){
  if(typeof authRequire==='function'&&!authRequire('登录后才能编辑图谱标题。'))return;
  if(graphTitleInput)return;
  const display=$('graphMetaDisplay'),titleEl=$('appTitle');
  if(!display||!titleEl)return;
  const input=document.createElement('input');
  input.className='graph-title-inline-input';
  input.type='text';
  input.maxLength=40;
  input.value=currentGraphTitle();
  input.setAttribute('aria-label','编辑图谱标题');
  input.dataset.stageUi='true';
  titleEl.style.display='none';
  display.insertBefore(input,titleEl.nextSibling);
  graphTitleInput=input;
  input.addEventListener('click',e=>e.stopPropagation());
  input.addEventListener('dblclick',e=>e.stopPropagation());
  input.addEventListener('keydown',e=>{
    if(e.key==='Enter'){e.preventDefault();e.stopPropagation();closeInlineGraphTitleEdit(true)}
    else if(e.key==='Escape'){e.preventDefault();e.stopPropagation();closeInlineGraphTitleEdit(false);renderHeader()}
  });
  input.addEventListener('blur',()=>closeInlineGraphTitleEdit(true));
  setTimeout(()=>{input.focus();input.select()},20);
}
const graphMetaDisplay=$('graphMetaDisplay');
if(graphMetaDisplay){
  graphMetaDisplay.setAttribute('aria-label','图谱标题，单击可直接修改，双击查看文件信息');
  graphMetaDisplay.removeAttribute('title');
  graphMetaDisplay.addEventListener('click',e=>{
    if(e.target&&e.target.closest&&e.target.closest('.graph-title-inline-input'))return;
    clearTimeout(graphTitleEditTimer);
    graphTitleEditTimer=setTimeout(()=>openInlineGraphTitleEdit(),220);
  });
  graphMetaDisplay.addEventListener('dblclick',e=>{
    e.preventDefault();e.stopPropagation();
    clearTimeout(graphTitleEditTimer);
    if(graphTitleInput)closeInlineGraphTitleEdit(false);
    requestGraphMetaEdit();
  });
  graphMetaDisplay.addEventListener('keydown',e=>{
    if(e.key==='Enter'||e.key===' '){e.preventDefault();openInlineGraphTitleEdit()}
    if(e.key==='F2'){e.preventDefault();requestGraphMetaEdit()}
  });
}
function bindGraphSearchButton(){
  const graphSearchBtn=$('graphSearchBtn');
  if(!graphSearchBtn||graphSearchBtn.dataset.graphSearchBound==='1')return;
  graphSearchBtn.dataset.graphSearchBound='1';
  graphSearchBtn.addEventListener('click',event=>{
    event.preventDefault();
    event.stopPropagation();
    openGraphSearchPanel();
  });
}
bindGraphSearchButton();
['nodeModal','linkModal','graphModal','templateModal','flashcardModal'].forEach(id=>{$(id).addEventListener('click',e=>{if(e.target===$(id))$(id).classList.remove('show')})});

document.addEventListener('keydown',e=>{if(e.key==='Escape'&&relatedCanvasModalEl){e.preventDefault();closeRelatedCanvasModal(true)}});
