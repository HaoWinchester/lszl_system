'use strict';

/*
 * 本文件由原单文件 HTML 自动拆分而来。
 * 维护建议：继续把本文件中的强耦合函数逐步迁移为显式模块 API。
 */

function graphModeAllows(capability){
  const api=window.KGHomeInteractionModes;
  return !api||typeof api.can!=='function'?true:api.can(capability);
}
function currentGraphInteractionMode(){
  const api=window.KGHomeInteractionModes;
  return api&&typeof api.getMode==='function'?api.getMode():'professional';
}

const graphKernelControllers={renderer:null,viewport:null,selection:null,history:null,clipboard:null,drag:null,resize:null,connection:null,style:null,alignment:null};
function ensureGraphViewportController(){
  if(graphKernelControllers.viewport)return graphKernelControllers.viewport;
  const factory=window.KGGraphViewportController;
  if(!factory||typeof factory.create!=='function')return null;
  graphKernelControllers.viewport=factory.create({
    stage,world,minScale:GRAPH_VIEWPORT_MIN_SCALE,maxScale:GRAPH_VIEWPORT_MAX_SCALE,
    getViewport:()=>state.viewport,
    hideTransient:()=>hideGraphTransientMenus(),
    onApply:()=>{updateCardQuickActionsPosition();updateSelectedEdgeQuickStylePosition();updateEdgeInlineLabelEditorPosition();if(typeof updateCanvasZoomControls==='function')updateCanvasZoomControls();window.KGHomeCanvasRuntime?.notifyViewport?.()}
  });
  return graphKernelControllers.viewport;
}
function ensureGraphSelectionController(){
  if(graphKernelControllers.selection)return graphKernelControllers.selection;
  const factory=window.KGGraphSelectionController;
  if(!factory||typeof factory.create!=='function')return null;
  graphKernelControllers.selection=factory.create({
    getState:()=>state,
    getNodeSet:()=>selectedNodeIds,
    setNodeSet:set=>{selectedNodeIds=set},
    getLinkSet:()=>selectedLinkIds,
    setLinkSet:set=>{selectedLinkIds=set}
  });
  return graphKernelControllers.selection;
}
function ensureGraphClipboardController(){
  if(graphKernelControllers.clipboard)return graphKernelControllers.clipboard;
  const factory=window.KGGraphClipboardController;
  if(!factory||typeof factory.create!=='function')return null;
  graphKernelControllers.clipboard=factory.create();
  return graphKernelControllers.clipboard;
}
function ensureGraphDragController(){
  if(graphKernelControllers.drag)return graphKernelControllers.drag;
  const factory=window.KGGraphDragController;
  if(!factory||typeof factory.create!=='function')return null;
  graphKernelControllers.drag=factory.create({threshold:5,onFirstMove:session=>pushGraphUndoSnapshot(session.historyLabel||'移动知识点')});
  return graphKernelControllers.drag;
}
function ensureGraphElementResizeController(){
  if(graphKernelControllers.resize)return graphKernelControllers.resize;
  const factory=window.KGGraphElementResizeController;
  if(!factory||typeof factory.create!=='function')return null;
  let ownsHistoryTransaction=false,resizeOriginalManualSize=false,resizeEntityType='text-element';
  graphKernelControllers.resize=factory.create({
    threshold:2,minWidth:24,minHeight:24,getScale:()=>state.viewport.scale,
    getGeometry:(id,config={})=>{
      if(config.entityType==='node'){
        const node=nodeById(id);return node&&window.KGGraphModel.geometryOf(node);
      }
      const item=textElementById(id);return item&&window.KGGraphModel.textElementGeometryOf(item);
    },
    applyGeometry:(id,geometry,meta={})=>{
      if(meta.session&&meta.session.config&&meta.session.config.entityType==='node'){
        const node=nodeById(id);if(!node)return false;
        window.KGGraphModel.updateGeometry(node,geometry);
        updateCardGeometryNodes({ids:[id]});
        return true;
      }
      const item=textElementById(id);if(!item)return false;
      window.KGGraphModel.updateTextElementGeometry(item,{...geometry,manualSize:meta.cancelled?resizeOriginalManualSize:true});
      updateTextElementGeometryDom(id);return true;
    },
    onBegin:session=>{
      resizeEntityType=session.config.entityType==='node'?'node':'text-element';
      if(resizeEntityType==='text-element'){
        const item=textElementById(session.id);resizeOriginalManualSize=!!(item&&window.KGGraphModel.textElementGeometryOf(item).manualSize);
      }else resizeOriginalManualSize=false;
      const history=ensureGraphHistoryController(),label=resizeEntityType==='node'?'调整节点大小':'调整文本框大小';
      ownsHistoryTransaction=!!(history&&history.begin(label));
      stage.classList.add('graph-element-resizing',resizeEntityType==='node'?'graph-node-resizing':'graph-text-resizing');
      nodeStyleToolbarController?.closePanels();nodeFloatingColorWindowController?.close({cancel:true});
    },
    onFirstResize:session=>{
      const history=ensureGraphHistoryController(),label=resizeEntityType==='node'?'调整节点大小':'调整文本框大小';
      if(ownsHistoryTransaction)history.checkpoint(label);else pushGraphUndoSnapshot(label);
    },
    onCommit:session=>{
      const history=ensureGraphHistoryController();if(ownsHistoryTransaction)history.commit();ownsHistoryTransaction=false;
      save();
      showStatus(resizeEntityType==='node'?'节点大小已保存，可按 Ctrl/Command+Z 撤销。':'文本框大小已保存，可按 Ctrl/Command+Z 撤销。');
    },
    onCancel:()=>{
      const history=ensureGraphHistoryController();if(ownsHistoryTransaction)history.rollback();ownsHistoryTransaction=false;
      showStatus(resizeEntityType==='node'?'已取消调整节点大小。':'已取消调整文本框大小。');
    },
    onNoop:()=>{
      const history=ensureGraphHistoryController();if(ownsHistoryTransaction)history.rollback();ownsHistoryTransaction=false
    },
    onEnd:()=>{
      stage.classList.remove('graph-element-resizing','graph-node-resizing','graph-text-resizing');
      updateCardQuickActionsPosition()
    }
  });
  return graphKernelControllers.resize;
}
function ensureGraphConnectionController(){
  if(graphKernelControllers.connection)return graphKernelControllers.connection;
  const factory=window.KGGraphConnectionController;
  if(!factory||typeof factory.create!=='function')return null;
  graphKernelControllers.connection=factory.create({
    getState:()=>state,getNode:id=>nodeById(id),relationExists,
    createLink:(from,to)=>makeLink(from,to,'','',state.defaults.linkStyle,state.defaults.linkColor,state.defaults.linkPathStyle),
    addLink:link=>state.links.push(link)
  });
  return graphKernelControllers.connection;
}
function ensureGraphStyleController(){
  if(graphKernelControllers.style)return graphKernelControllers.style;
  const factory=window.KGGraphStyleController;
  if(!factory||typeof factory.create!=='function')return null;
  graphKernelControllers.style=factory.create({
    model:window.KGGraphModel,getGraph:()=>state,history:ensureGraphHistoryController(),
    onChange:event=>render({mode:event.renderMode||event.section||'appearance',ids:event.ids||null,persist:true})
  });
  return graphKernelControllers.style;
}
function ensureGraphAlignmentController(){
  if(graphKernelControllers.alignment)return graphKernelControllers.alignment;
  const factory=window.KGGraphNodeAlignmentController;
  if(!factory||typeof factory.create!=='function')return null;
  graphKernelControllers.alignment=factory.create({
    model:window.KGGraphModel,getGraph:()=>state,history:ensureGraphHistoryController(),
    onChange:event=>render({mode:'geometry',ids:event.ids||null,persist:true})
  });
  return graphKernelControllers.alignment;
}
function ensureGraphRenderer(){
  if(graphKernelControllers.renderer)return graphKernelControllers.renderer;
  const factory=window.KGGraphRenderer;
  if(!factory||typeof factory.create!=='function')return null;
  graphKernelControllers.renderer=factory.create({
    syncModes:syncGraphModeClasses,applyViewport:applyTransform,renderHeader,renderEdges,renderCards,renderDetails,
    updateCardContent:updateCardContentNodes,updateCardAppearance:updateCardAppearanceNodes,updateCardGeometry:updateCardGeometryNodes,
    renderEdgeStylePanel:renderSelectedEdgeQuickStylePanel,renderQuickActions:updateCardQuickActions,
    refreshCardClasses,refreshEdgeClasses:refreshEdgeSelectionClasses,persist:save
  });
  return graphKernelControllers.renderer;
}
function resetGraphKernelSession(){
  const history=graphKernelControllers.history;if(history&&history.clear)history.clear();
  const clipboard=graphKernelControllers.clipboard;if(clipboard&&clipboard.clear)clipboard.clear();
  const drag=graphKernelControllers.drag;if(drag&&drag.cancel)drag.cancel();
  const resize=graphKernelControllers.resize;if(resize&&resize.cancel)resize.cancel();
  nodeFreeResizeModeId=null;
  if(nodeContextMenuController&&nodeContextMenuController.hide)nodeContextMenuController.hide();
  clearTimeout(nodeRightClickTimer);nodeRightClickTimer=null;nodeRightClickPending=null;nodeRightPointerSession=null;
  graphKernelControllers.connection=null;
}
window.KGGraphKernel=Object.freeze({
  get model(){return window.KGGraphModel},
  get renderer(){return ensureGraphRenderer()},
  get viewport(){return ensureGraphViewportController()},
  get selection(){return ensureGraphSelectionController()},
  get history(){return ensureGraphHistoryController()},
  get clipboard(){return ensureGraphClipboardController()},
  get drag(){return ensureGraphDragController()},
  get resize(){return ensureGraphElementResizeController()},
  get connection(){return ensureGraphConnectionController()},
  get style(){return ensureGraphStyleController()},
  get alignment(){return ensureGraphAlignmentController()},
  resetSession:resetGraphKernelSession,
  diagnostics:()=>({renderer:ensureGraphRenderer()?.diagnostics?.()||{},viewport:ensureGraphViewportController()?.getDiagnostics?.()||{},history:ensureGraphHistoryController()?.getState?.()||{}})
});

let graphIndexCache=null,graphIndexStateRef=null,graphIndexNodesRef=null,graphIndexLinksRef=null,graphIndexNodeLength=-1,graphIndexLinkLength=-1;
function getGraphIndex(){
  const nodes=Array.isArray(state&&state.nodes)?state.nodes:[],links=Array.isArray(state&&state.links)?state.links:[];
  if(graphIndexCache&&graphIndexStateRef===state&&graphIndexNodesRef===nodes&&graphIndexLinksRef===links&&graphIndexNodeLength===nodes.length&&graphIndexLinkLength===links.length)return graphIndexCache;
  const model=window.KGGraphModel;
  if(model&&typeof model.createIndex==='function')graphIndexCache=model.createIndex({nodes,links});
  else{
    const nodeMap=new Map(),linkMap=new Map(),linksByNodeId=new Map();
    for(const n of nodes){if(n&&n.id)nodeMap.set(n.id,n)}
    const addLinkForNode=(id,link)=>{if(!id)return;let arr=linksByNodeId.get(id);if(!arr){arr=[];linksByNodeId.set(id,arr)}arr.push(link)};
    for(const l of links){if(!l||!l.id)continue;linkMap.set(l.id,l);if(nodeMap.has(l.from))addLinkForNode(l.from,l);if(nodeMap.has(l.to)&&l.to!==l.from)addLinkForNode(l.to,l)}
    graphIndexCache={nodeMap,linkMap,linksByNodeId};
  }
  graphIndexStateRef=state;graphIndexNodesRef=nodes;graphIndexLinksRef=links;graphIndexNodeLength=nodes.length;graphIndexLinkLength=links.length;
  return graphIndexCache;
}
function nodeById(id){return getGraphIndex().nodeMap.get(id)||null}
function isNodeFullyLocked(nodeOrId){
  const node=typeof nodeOrId==='string'?nodeById(nodeOrId):nodeOrId;
  return !!(node&&window.KGGraphModel?.interactionOf?.(node).locked);
}
function lockedNodeIdsFrom(ids=[]){return [...new Set(ids)].filter(id=>isNodeFullyLocked(id))}
function selectedLockedNodeIds(){return lockedNodeIdsFrom(selectedNodeIdsForClipboard())}
function rejectLockedNodeAction(action='操作',ids=null){
  const locked=lockedNodeIdsFrom(ids||selectedNodeIdsForClipboard());
  if(!locked.length)return false;
  showStatus(locked.length>1?`选择中有 ${locked.length} 个已锁定节点，不能${action}；请先解锁。`:`该节点已锁定，不能${action}；请先解锁。`);
  return true;
}
function linkById(id){return getGraphIndex().linkMap.get(id)||null}
function linksForNodeId(id){return getGraphIndex().linksByNodeId.get(id)||[]}
function dimsForSize(size){if(size==='small')return{w:104,h:110};if(size==='big')return{w:160,h:166};return{w:CARD_W,h:CARD_H}}
function nodeDims(n){const model=window.KGGraphModel;if(model&&n){const geometry=model.geometryOf(n);return{w:geometry.width,h:geometry.height}}return dimsForSize(n&&n.size)}
function isRelatedGatherActive(){return !!(relatedGatherLayout&&relatedGatherLayout.active&&relatedGatherLayout.anchorId===currentRelatedScopeAnchorId())}
function visualPositionForNode(n,options={}){
  if(!n)return{x:0,y:0};
  if(!options.ignoreGather&&isRelatedGatherActive()&&relatedGatherLayout.positions&&relatedGatherLayout.positions.has(n.id)){
    const p=relatedGatherLayout.positions.get(n.id);
    return{x:p.x,y:p.y};
  }
  const model=window.KGGraphModel,geometry=model&&n?model.geometryOf(n):null;return{x:geometry?geometry.x:n.x,y:geometry?geometry.y:n.y};
}
function nodeCenter(n){const d=nodeDims(n),p=visualPositionForNode(n);return{x:p.x+d.w/2,y:p.y+d.h/2}}
function graphCross(a,b){return a.x*b.y-a.y*b.x}
function graphRayPolygonIntersection(origin,target,points){
  const ray={x:target.x-origin.x,y:target.y-origin.y};if(Math.hypot(ray.x,ray.y)<.001)return origin;
  let best=null;
  for(let i=0;i<points.length;i++){
    const a=points[i],b=points[(i+1)%points.length],edge={x:b.x-a.x,y:b.y-a.y},den=graphCross(ray,edge);
    if(Math.abs(den)<1e-8)continue;
    const offset={x:a.x-origin.x,y:a.y-origin.y},t=graphCross(offset,edge)/den,u=graphCross(offset,ray)/den;
    if(t>=0&&u>=0&&u<=1&&(!best||t<best.t))best={t,x:origin.x+t*ray.x,y:origin.y+t*ray.y};
  }
  return best?{x:best.x,y:best.y}:origin;
}
function nodeOutlinePoint(n,toward){
  const center=nodeCenter(n),dims=nodeDims(n),pos=visualPositionForNode(n),appearance=window.KGGraphModel&&window.KGGraphModel.appearanceOf?window.KGGraphModel.appearanceOf(n):{cardStyle:n&&n.cardStyle||'standard'};
  const dx=toward.x-center.x,dy=toward.y-center.y;if(Math.hypot(dx,dy)<.001)return center;
  if(appearance.cardStyle==='circle'){
    const rx=Math.max(1,dims.w/2),ry=Math.max(1,dims.h/2),t=1/Math.sqrt((dx*dx)/(rx*rx)+(dy*dy)/(ry*ry));
    return{x:center.x+dx*t,y:center.y+dy*t};
  }
  if(appearance.cardStyle==='triangle'){
    return graphRayPolygonIntersection(center,toward,[{x:center.x,y:pos.y},{x:pos.x+dims.w,y:pos.y+dims.h},{x:pos.x,y:pos.y+dims.h}]);
  }
  const hw=Math.max(1,dims.w/2),hh=Math.max(1,dims.h/2),t=Math.min(hw/Math.max(.0001,Math.abs(dx)),hh/Math.max(.0001,Math.abs(dy)));
  return{x:center.x+dx*t,y:center.y+dy*t};
}
function linkOutlinePoints(a,b){const ca=nodeCenter(a),cb=nodeCenter(b);return{a:nodeOutlinePoint(a,cb),b:nodeOutlinePoint(b,ca),ca,cb}}
function invalidateGraphIndexCache(){graphIndexCache=null;graphIndexStateRef=null;graphIndexNodesRef=null;graphIndexLinksRef=null;graphIndexNodeLength=-1;graphIndexLinkLength=-1}
function linkEndpointPointKey(side){return side==='from'?'fromPoint':'toPoint'}
function linkEndpointNode(link,side,nodeMap=null){const id=side==='from'?link&&link.from:link&&link.to;return id?((nodeMap&&nodeMap.get(id))||nodeById(id)):null}
function linkEndpointFreePoint(link,side){return normalizedEdgePoint(link&&link[linkEndpointPointKey(side)])}
function linkRenderPoints(link,nodeMap=null){
  if(!link)return null;
  const aNode=linkEndpointNode(link,'from',nodeMap),bNode=linkEndpointNode(link,'to',nodeMap),freeA=linkEndpointFreePoint(link,'from'),freeB=linkEndpointFreePoint(link,'to');
  const ca=aNode?nodeCenter(aNode):freeA,cb=bNode?nodeCenter(bNode):freeB;if(!ca||!cb)return null;
  const a=aNode?nodeOutlinePoint(aNode,cb):ca,b=bNode?nodeOutlinePoint(bNode,ca):cb;return{a,b,ca,cb,aNode,bNode};
}
function setLinkFreeEndpoint(link,side,point){if(!link)return;const key=linkEndpointPointKey(side),clean=normalizedEdgePoint(point);if(side==='from')link.from='';else link.to='';if(clean)link[key]=clean;else delete link[key]}
function bindLinkEndpoint(link,side,nodeId){if(!link)return false;const node=nodeById(nodeId);if(!node)return false;const other=side==='from'?link.to:link.from;if(other&&other===node.id)return false;if(side==='from')link.from=node.id;else link.to=node.id;delete link[linkEndpointPointKey(side)];return true}
function linkGeometryMidpoint(link){const dom=edgeDomById.get(String(link&&link.id||'')),samples=dom&&dom.geometry&&dom.geometry.samples;if(samples&&samples.length===2)return{x:(samples[0].x+samples[1].x)/2,y:(samples[0].y+samples[1].y)/2};if(samples&&samples.length)return samples[Math.floor(samples.length/2)];const points=linkRenderPoints(link,getGraphIndex().nodeMap);return points?{x:(points.ca.x+points.cb.x)/2,y:(points.ca.y+points.cb.y)/2}:null}
function applyTransform(){const scale=Math.max(.01,Number(state.viewport.scale)||1);world.style.setProperty('--graph-ui-inverse-scale',String(1/scale));updateSelectedEdgeControlScale(scale);updateEdgeHoverFeedbackWidth(scale);const controller=ensureGraphViewportController();if(controller)return controller.apply(state.viewport);world.style.transform=`translate(${state.viewport.x}px, ${state.viewport.y}px) scale(${scale})`;updateCardQuickActionsPosition();updateSelectedEdgeQuickStylePosition();updateEdgeInlineLabelEditorPosition();if(typeof updateCanvasZoomControls==='function')updateCanvasZoomControls()}
function screenToWorld(clientX,clientY){const controller=ensureGraphViewportController();if(controller)return controller.screenToWorld(clientX,clientY,state.viewport);const r=stage.getBoundingClientRect();return{x:(clientX-r.left-state.viewport.x)/state.viewport.scale,y:(clientY-r.top-state.viewport.y)/state.viewport.scale}}
function pathStyleForLink(link){
  const style=link&&link.pathStyle;
  return LINE_PATH_STYLES&&LINE_PATH_STYLES.has(style)?style:DEFAULTS.linkPathStyle;
}
function pathFor(a,b,pathStyle=DEFAULTS.linkPathStyle){
  return linkPathGeometry({pathStyle},a,b).d;
}
function normalizedEdgePoint(value){
  if(!value||typeof value!=='object')return null;
  const x=Number(value.x),y=Number(value.y);if(!Number.isFinite(x)||!Number.isFinite(y))return null;
  return{x:Math.max(-100000,Math.min(100000,x)),y:Math.max(-100000,Math.min(100000,y))};
}
function normalizedEdgePoints(value,max=12){
  return (Array.isArray(value)?value:[]).slice(0,max).map(normalizedEdgePoint).filter(Boolean);
}
function defaultElbowWaypoints(a,b){
  const dx=b.x-a.x,dy=b.y-a.y;
  if(Math.abs(dx)>=Math.abs(dy)){const mx=(a.x+b.x)/2;return[{x:mx,y:a.y},{x:mx,y:b.y}]}
  const my=(a.y+b.y)/2;return[{x:a.x,y:my},{x:b.x,y:my}];
}
function defaultCurveControls(a,b){
  const c=Math.max(80,Math.abs(b.x-a.x)*.45);
  return[{x:a.x+c,y:a.y},{x:b.x-c,y:b.y}];
}
function cubicEdgePoint(a,c1,c2,b,t){
  const mt=1-t,mt2=mt*mt,t2=t*t;
  return{x:mt2*mt*a.x+3*mt2*t*c1.x+3*mt*t2*c2.x+t2*t*b.x,y:mt2*mt*a.y+3*mt2*t*c1.y+3*mt*t2*c2.y+t2*t*b.y};
}
function edgeGeometryBounds(points){
  const clean=(points||[]).filter(Boolean);if(!clean.length)return{left:0,top:0,right:0,bottom:0};
  let left=clean[0].x,right=left,top=clean[0].y,bottom=top;
  for(const point of clean){left=Math.min(left,point.x);right=Math.max(right,point.x);top=Math.min(top,point.y);bottom=Math.max(bottom,point.y)}
  return{left,top,right,bottom,width:right-left,height:bottom-top};
}
function edgePathFromPoints(points){
  if(!points.length)return'';
  return points.map((point,index)=>(index?'L ':'M ')+formatSvgNumber(point.x)+' '+formatSvgNumber(point.y)).join(' ');
}
function linkPathGeometry(link,a,b){
  const style=pathStyleForLink(link),start=normalizedEdgePoint(a)||{x:0,y:0},end=normalizedEdgePoint(b)||{x:0,y:0};
  if(style==='straight'){
    const samples=[start,end],mid={x:(start.x+end.x)/2,y:(start.y+end.y)/2};
    return{style,d:edgePathFromPoints(samples),samples,bounds:edgeGeometryBounds(samples),endpoints:[start,end],controls:[{kind:'straight-bend',index:0,x:mid.x,y:mid.y}]};
  }
  if(style==='elbow'){
    const stored=normalizedEdgePoints(link&&link.waypoints,12),waypoints=stored.length?stored:defaultElbowWaypoints(start,end),samples=[start,...waypoints,end];
    return{style,d:edgePathFromPoints(samples),samples,bounds:edgeGeometryBounds(samples),endpoints:[start,end],controls:waypoints.map((point,index)=>({kind:'waypoint',index,x:point.x,y:point.y})),derivedWaypoints:!stored.length};
  }
  const stored=normalizedEdgePoints(link&&link.curveControls,2),controls=stored.length===2?stored:defaultCurveControls(start,end);
  const c1=controls[0],c2=controls[1],d=`M ${formatSvgNumber(start.x)} ${formatSvgNumber(start.y)} C ${formatSvgNumber(c1.x)} ${formatSvgNumber(c1.y)}, ${formatSvgNumber(c2.x)} ${formatSvgNumber(c2.y)}, ${formatSvgNumber(end.x)} ${formatSvgNumber(end.y)}`;
  const samples=[];for(let index=0;index<=24;index++)samples.push(cubicEdgePoint(start,c1,c2,end,index/24));
  return{style,d,samples,bounds:edgeGeometryBounds(samples),endpoints:[start,end],controls:controls.map((point,index)=>({kind:'curve-control',index,x:point.x,y:point.y})),derivedCurveControls:stored.length!==2};
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
  hideGraphTransientMenus();
  const r=stage.getBoundingClientRect();
  return smoothGraphZoomByLevelsAtClientPoint(direction,GRAPH_BUTTON_ZOOM_LEVELS,r.left+r.width/2,r.top+r.height/2,{duration:230,source:'button'});
}
function smoothGraphWheelZoomAtClientPoint(direction,clientX,clientY){
  hideGraphTransientMenus();
  return smoothGraphZoomByLevelsAtClientPoint(direction,GRAPH_WHEEL_ZOOM_LEVELS,clientX,clientY,{duration:150,source:'wheel'});
}
window.cancelGraphSmoothZoom=cancelGraphSmoothZoom;
window.smoothGraphZoomToScaleAtClientPoint=smoothGraphZoomToScaleAtClientPoint;
window.smoothGraphButtonZoomAtStageCenter=smoothGraphButtonZoomAtStageCenter;
window.smoothGraphWheelZoomAtClientPoint=smoothGraphWheelZoomAtClientPoint;
const RELATED_GATHER_TRIGGER_SCALE=.66,RELATED_GATHER_MIN_SCALE=.64,RELATED_GATHER_MAX_SCALE=1.08;
let largeGraphModeNotified=false,largeGraphOverviewEnabled=false,largeGraphRelatedFocusEnabled=false,flowModeEnabled=false,relatedScopeAnchorNodeId=null;
let relatedGatherLayout=null;
let cardQuickActionsEl=null,nodeStyleToolbarController=null,nodeInlineTextEditorController=null,nodeColorEditSession=null,nodeFloatingColorWindowController=null,nodeContextMenuController=null;
let nodeFreeResizeModeId=null,nodeRightPointerSession=null,nodeRightClickPending=null,nodeRightClickTimer=null;
const NODE_RIGHT_DOUBLE_DELAY=340;
const nodeColorPickerControllers=new Map();
const CENTER_SCOPE_ICON='<svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="12" cy="12" r="7"></circle><circle cx="12" cy="12" r="2"></circle><path d="M12 2v3M12 19v3M2 12h3M19 12h3"></path></svg>';
const FIT_SCOPE_ICON='<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M8 3H3v5"></path><path d="M16 3h5v5"></path><path d="M8 21H3v-5"></path><path d="M16 21h5v-5"></path><path d="M3 3l6 6"></path><path d="M21 3l-6 6"></path><path d="M3 21l6-6"></path><path d="M21 21l-6-6"></path></svg>';
const RESTORE_SCOPE_ICON='<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M3 12a9 9 0 1 0 3-6.7"></path><path d="M3 4v6h6"></path><path d="M9 12h6"></path></svg>';

let relatedCanvasModalEl=null,relatedCanvasState=null,relatedCanvasDrag=null,relatedCanvasPanDrag=null,relatedCanvasPanTimer=0,relatedCanvasInfoState=null,relatedCanvasInfoDrag=null;
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
function fitRelatedCanvasContent(){
  if(!relatedCanvasModalEl||!relatedCanvasState||!relatedCanvasState.positions||!relatedCanvasState.positions.size)return;
  const body=relatedCanvasModalEl.querySelector('.related-canvas-body');if(!body)return;
  let minX=Infinity,minY=Infinity,maxX=-Infinity,maxY=-Infinity;
  for(const node of relatedCanvasState.nodes||[]){
    const p=relatedCanvasState.positions.get(node.id);if(!p)continue;
    const d=nodeDims(node);minX=Math.min(minX,p.x);minY=Math.min(minY,p.y);maxX=Math.max(maxX,p.x+d.w);maxY=Math.max(maxY,p.y+d.h);
  }
  if(!Number.isFinite(minX))return centerRelatedCanvasStage();
  const margin=72,bw=Math.max(1,body.clientWidth),bh=Math.max(1,body.clientHeight),contentW=Math.max(1,maxX-minX),contentH=Math.max(1,maxY-minY);
  const scale=clamp(Math.min((bw-margin*2)/contentW,(bh-margin*2)/contentH,1.15),RELATED_CANVAS_MIN_SCALE,RELATED_CANVAS_MAX_SCALE);
  relatedCanvasState.scale=scale;
  relatedCanvasState.panX=Math.round(bw/2-((minX+maxX)/2)*scale);
  relatedCanvasState.panY=Math.round(bh/2-((minY+maxY)/2)*scale);
  applyRelatedCanvasScale();
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
  if(e.button!==undefined&&e.button!==2)return;
  if(!relatedCanvasModalEl||!relatedCanvasState)return;
  if(e.target&&e.target.closest&&e.target.closest('.related-canvas-card,.related-canvas-info,.related-canvas-header,button,input,textarea,select,a'))return;
  const body=e.currentTarget;if(!body)return;
  clearTimeout(relatedCanvasPanTimer);
  relatedCanvasPanDrag={pointerId:e.pointerId,body,startX:e.clientX,startY:e.clientY,lastX:e.clientX,lastY:e.clientY,startPanX:Number.isFinite(relatedCanvasState.panX)?relatedCanvasState.panX:0,startPanY:Number.isFinite(relatedCanvasState.panY)?relatedCanvasState.panY:0,moved:false,active:true};
  body.classList.remove('right-pan-pending');body.classList.add('panning');
  document.addEventListener('pointermove',moveRelatedCanvasPan,true);
  document.addEventListener('pointerup',endRelatedCanvasPan,true);
  document.addEventListener('pointercancel',endRelatedCanvasPan,true);
  try{body.setPointerCapture(e.pointerId)}catch{}
  e.preventDefault();e.stopPropagation();
}
function moveRelatedCanvasPan(e){
  const drag=relatedCanvasPanDrag;if(!drag||drag.pointerId!==e.pointerId)return;
  drag.lastX=e.clientX;drag.lastY=e.clientY;
  if(!drag.active){e.preventDefault();e.stopPropagation();return}
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
  clearTimeout(relatedCanvasPanTimer);relatedCanvasPanTimer=0;
  try{drag.body.releasePointerCapture(e.pointerId)}catch{}
  drag.body.classList.remove('panning','right-pan-pending');
  relatedCanvasPanDrag=null;
  document.removeEventListener('pointermove',moveRelatedCanvasPan,true);
  document.removeEventListener('pointerup',endRelatedCanvasPan,true);
  document.removeEventListener('pointercancel',endRelatedCanvasPan,true);
  e.preventDefault();e.stopPropagation();
}
function resetRelatedCanvasScale(){if(!relatedCanvasState)return;fitRelatedCanvasContent()}
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
function closeRelatedCanvasModal(showMessage=false,options={}){
  clearTimeout(relatedCanvasPanTimer);relatedCanvasPanTimer=0;relatedCanvasDrag=null;relatedCanvasPanDrag=null;relatedCanvasInfoDrag=null;relatedCanvasInfoState=null;
  document.removeEventListener('pointermove',moveRelatedCanvasPan,true);
  document.removeEventListener('pointerup',endRelatedCanvasPan,true);
  document.removeEventListener('pointercancel',endRelatedCanvasPan,true);
  document.removeEventListener('pointermove',moveRelatedCanvasInfoDrag,true);
  document.removeEventListener('pointerup',endRelatedCanvasInfoDrag,true);
  document.removeEventListener('pointercancel',endRelatedCanvasInfoDrag,true);
  if(relatedCanvasModalEl){relatedCanvasModalEl.remove();relatedCanvasModalEl=null}
  relatedCanvasState=null;
  document.body.classList.remove('related-canvas-open');
  const shouldClearRelatedFocus=options.clearRelatedFocus!==false;
  const hadRelatedOnly=largeGraphRelatedFocusEnabled||!!relatedScopeAnchorNodeId;
  if(shouldClearRelatedFocus){
    largeGraphRelatedFocusEnabled=false;relatedScopeAnchorNodeId=null;hoverLargeGraphNodeId=null;
    clearRelatedGatherLayout({render:false,message:false});
    if(hadRelatedOnly){syncGraphModeClasses();refreshCardClasses();renderEdges();renderDetails();updateCardQuickActions()}
  }
  if(showMessage&&typeof showStatus==='function')showStatus(shouldClearRelatedFocus&&hadRelatedOnly?'已退出临时相关画布，并取消“只看相关”状态。':'已退出临时相关画布，原图谱保持不变。');
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
  if(e.button!==undefined&&e.button!==0)return;
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
  closeRelatedCanvasModal(false,{clearRelatedFocus:false});
  const overlay=document.createElement('div');overlay.className='related-canvas-backdrop';overlay.dataset.stageUi='true';
  overlay.innerHTML=`<section class="related-canvas-dialog" role="dialog" aria-modal="true" aria-label="临时相关画布"><header class="related-canvas-header"><div><strong>临时相关画布</strong><span>只读学习视图，拖拽只调整临时展示位置</span></div><div class="related-canvas-header-actions"><button type="button" class="related-canvas-tool related-canvas-zoom-out" title="缩小" aria-label="缩小">−</button><span class="related-canvas-zoom-label">100%</span><button type="button" class="related-canvas-tool related-canvas-zoom-in" title="放大" aria-label="放大">+</button><button type="button" class="related-canvas-tool related-canvas-zoom-reset" title="重置缩放" aria-label="重置缩放">1:1</button><button type="button" class="related-canvas-tool related-canvas-fullscreen-toggle" title="全屏" aria-label="全屏">${RELATED_CANVAS_FULLSCREEN_ICON}</button><button type="button" class="related-canvas-close" title="退出临时画布" aria-label="退出临时画布">${RELATED_CANVAS_CLOSE_ICON}</button></div></header><div class="related-canvas-body"><div class="related-canvas-viewport"><div class="related-canvas-stage"><svg class="related-canvas-edges"></svg><div class="related-canvas-cards"></div></div></div></div></section>`;
  overlay.addEventListener('wheel',e=>e.stopPropagation(),{passive:true});
  overlay.addEventListener('pointerdown',e=>e.stopPropagation());
  const bodyEl=overlay.querySelector('.related-canvas-body');
  bodyEl.addEventListener('wheel',e=>{if(e.target&&e.target.closest&&e.target.closest('.related-canvas-info'))return;e.preventDefault();e.stopPropagation();const factor=e.deltaY<0?RELATED_CANVAS_SCALE_STEP:1/RELATED_CANVAS_SCALE_STEP;setRelatedCanvasScale((relatedCanvasState&&relatedCanvasState.scale||1)*factor,e)},{passive:false});
  bodyEl.addEventListener('pointerdown',beginRelatedCanvasPan);
  bodyEl.addEventListener('contextmenu',e=>{e.preventDefault();e.stopPropagation()});
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
    renderRelatedCanvasEdges();renderRelatedCanvasCards();
    requestAnimationFrame(()=>{fitRelatedCanvasContent();overlay.classList.add('related-canvas-content-centered')});
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
function isLargeGraphMode(){return isLargeGraphPreferenceEnabled()&&isGraphOverLargeThreshold()}
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
function setFlowModeEnabled(enabled,options={}){
  const next=!!enabled,changed=flowModeEnabled!==next;
  if(changed&&options.animate!==false)beginFocusVisualTransition();
  flowModeEnabled=next;
  if(flowModeEnabled&&largeGraphRelatedFocusEnabled){largeGraphRelatedFocusEnabled=false;relatedScopeAnchorNodeId=null;clearRelatedGatherLayout({render:false,message:false})}
  syncGraphModeClasses();
  updateFlowModeButton();
  if(options.render!==false){
    renderHeader();
    renderEdges();
    refreshCardClasses();
    renderDetails();
    updateCardQuickActions();
  }
  if(options.silent!==true)showStatus(flowModeEnabled?'已开启心流模式：点击卡牌会突出相关内容，弱化无关内容。':'已关闭心流模式：制作时点击卡牌不再触发大范围弱化。');
  return changed;
}
function toggleFlowMode(){return setFlowModeEnabled(!flowModeEnabled)}
window.KGGraphFlowMode=Object.freeze({isEnabled:()=>!!flowModeEnabled,set:setFlowModeEnabled,toggle:toggleFlowMode});
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
let graphModeIndicatorEl=null;
function ensureGraphModeIndicator(){
  if(graphModeIndicatorEl&&graphModeIndicatorEl.isConnected)return graphModeIndicatorEl;
  graphModeIndicatorEl=document.createElement('div');graphModeIndicatorEl.className='graph-mode-indicator';graphModeIndicatorEl.dataset.stageUi='true';graphModeIndicatorEl.hidden=true;
  graphModeIndicatorEl.innerHTML='<strong data-graph-mode-title></strong><span data-graph-mode-copy></span><button type="button" data-graph-mode-exit>退出</button>';
  graphModeIndicatorEl.querySelector('[data-graph-mode-exit]').addEventListener('click',()=>{
    if(largeGraphRelatedFocusEnabled){largeGraphRelatedFocusEnabled=false;relatedScopeAnchorNodeId=null;clearRelatedGatherLayout({render:false,message:false})}
    if(flowModeEnabled)flowModeEnabled=false;
    syncGraphModeClasses();refreshCardClasses();renderEdges();renderDetails();updateCardQuickActions();showStatus('已退出画布模式，恢复完整图谱。');
  });
  stage.appendChild(graphModeIndicatorEl);return graphModeIndicatorEl;
}
function updateGraphModeIndicator(){
  const el=ensureGraphModeIndicator(),mode=largeGraphRelatedFocusEnabled?'related':flowModeEnabled?'flow':'';
  stage.classList.toggle('graph-mode-related',mode==='related');stage.classList.toggle('graph-mode-flow',mode==='flow');
  if(!mode){el.hidden=true;el.classList.remove('related','flow');return}
  el.hidden=false;el.classList.toggle('related',mode==='related');el.classList.toggle('flow',mode==='flow');
  el.querySelector('[data-graph-mode-title]').textContent=mode==='related'?'只看相关':'心流状态';
  el.querySelector('[data-graph-mode-copy]').textContent=mode==='related'?'当前仅显示中心节点及其直接相关内容':'当前突出关联内容，弱化无关信息';
  el.querySelector('[data-graph-mode-exit]').textContent=mode==='related'?'退出只看相关':'退出心流';
}
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
  updateGraphModeIndicator();
  return large;
}
function render(options={}){if(options&&options.persist)invalidateGraphSearchIndex();const renderer=ensureGraphRenderer();if(renderer){const result=renderer.render(options.mode||'full',options);window.KGHomeCanvasRuntime?.refreshMinimap?.(true);return result}syncGraphModeClasses();applyTransform();renderHeader();renderEdges();renderCards();renderDetails();renderSelectedEdgeQuickStylePanel();updateCardQuickActions();window.KGHomeCanvasRuntime?.refreshMinimap?.(true);if(options&&options.persist)save()}
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
  if(largeGraphRelatedFocusEnabled&&flowModeEnabled)flowModeEnabled=false;
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
let edgeDomById=new Map(),cardDomById=new Map(),textElementDomById=new Map();
let edgeHoverLayer=null,edgeBaseLayer=null,edgeFeedbackLayer=null,edgeControlLayer=null,edgeHoverOverlay=null,hoveredEdgeId='',edgeSelectionPaintedIds=new Set();
let edgeControlDrag=null,edgeControlDragFrame=0,edgeControlDragPoint=null;
let edgeMoveDrag=null,edgeMoveDragFrame=0,edgeMoveDragPoint=null,suppressEdgeClickId='',suppressEdgeClickUntil=0;
let edgeEndpointDrag=null,edgeEndpointDragFrame=0,edgeEndpointDragPoint=null,edgeEndpointBindTargetId='';
function svgElement(name,className=''){
  const element=document.createElementNS('http://www.w3.org/2000/svg',name);if(className)element.setAttribute('class',className);return element;
}
function selectedEdgeIdSet(){
  const ids=new Set([...selectedLinkIds].map(String).filter(id=>edgeDomById.has(id)&&linkById(id)));
  if(state.selectedLinkId&&edgeDomById.has(String(state.selectedLinkId))&&linkById(state.selectedLinkId))ids.add(String(state.selectedLinkId));
  return ids;
}
function edgeBaseWidth(link){return Math.max(1,Math.min(8,Number(link&&link.strokeWidth)||4))}
function edgeFeedbackWidth(link){const base=edgeBaseWidth(link);return Math.max(1.25,Math.min(2.75,base*.52))}
function edgeHoverOutlineWidth(link,scale=Number(state?.viewport?.scale)||1){return edgeBaseWidth(link)+(2/Math.max(.01,Number(scale)||1))}
function updateEdgeHoverFeedbackWidth(scale=Number(state?.viewport?.scale)||1){if(!edgeHoverOverlay||!hoveredEdgeId)return;const dom=edgeDomById.get(String(hoveredEdgeId));if(dom)edgeHoverOverlay.style.setProperty('--edge-hover-outline-width',String(edgeHoverOutlineWidth(dom.link,scale)))}
function updateSelectedEdgeControlScale(scale=Number(state?.viewport?.scale)||1){
  const safeScale=Math.max(.01,Number(scale)||1),inverse=1/safeScale;if(!edgeControlLayer)return;
  edgeControlLayer.querySelectorAll('.edge-endpoint-dot').forEach(node=>node.setAttribute('r',String(5.2*inverse)));
  edgeControlLayer.querySelectorAll('.edge-endpoint-hit').forEach(node=>node.setAttribute('r',String(14*inverse)));
  edgeControlLayer.querySelectorAll('.edge-control-dot').forEach(node=>node.setAttribute('r',String(4.8*inverse)));
  edgeControlLayer.querySelectorAll('.edge-control-hit').forEach(node=>node.setAttribute('r',String(12*inverse)));
  edgeControlLayer.style.setProperty('--edge-control-inverse-scale',String(inverse));
}
function hideEdgeHoverFeedback(){hoveredEdgeId='';if(edgeHoverOverlay)edgeHoverOverlay.classList.remove('show')}
function showEdgeHoverFeedback(id){
  const key=String(id||''),dom=edgeDomById.get(key);hoveredEdgeId=key;
  if(!edgeHoverOverlay||!dom?.geometry||selectedEdgeIdSet().has(key)){if(edgeHoverOverlay)edgeHoverOverlay.classList.remove('show');return}
  edgeHoverOverlay.setAttribute('d',dom.geometry.d);
  edgeHoverOverlay.style.setProperty('--edge-hover-outline-width',String(edgeHoverOutlineWidth(dom.link)));
  const dash=dom.vis?.getAttribute('stroke-dasharray');if(dash)edgeHoverOverlay.setAttribute('stroke-dasharray',dash);else edgeHoverOverlay.removeAttribute('stroke-dasharray');
  edgeHoverOverlay.classList.add('show');
}
function createEdgeSelectionOverlay(id){
  const key=String(id),dom=edgeDomById.get(key);if(!dom||!edgeFeedbackLayer||dom.overlay)return;
  const overlay=svgElement('path','edge-selection-overlay');overlay.dataset.linkId=key;overlay.setAttribute('aria-hidden','true');overlay.setAttribute('d',dom.geometry?.d||dom.vis?.getAttribute('d')||'');overlay.style.setProperty('--edge-feedback-width',String(edgeFeedbackWidth(dom.link)));
  edgeFeedbackLayer.appendChild(overlay);dom.overlay=overlay;
}
function removeEdgeSelectionOverlay(id){const dom=edgeDomById.get(String(id));if(dom?.overlay)dom.overlay.remove();if(dom)dom.overlay=null}
function edgeControlGuidePath(geometry){
  if(!geometry||geometry.style!=='curve'||geometry.controls.length!==2)return'';
  const [start,end]=geometry.endpoints,[c1,c2]=geometry.controls;return`M ${start.x} ${start.y} L ${c1.x} ${c1.y} M ${end.x} ${end.y} L ${c2.x} ${c2.y}`;
}
function updateEdgeControlLayerGeometry(link,dom,geometry){
  if(!edgeControlLayer||edgeControlLayer.dataset.linkId!==String(link.id))return;
  const guide=edgeControlLayer.querySelector('.edge-control-guide');if(guide){const d=edgeControlGuidePath(geometry);guide.setAttribute('d',d);guide.hidden=!d}
  edgeControlLayer.querySelector('[data-edge-endpoint-side="from"]')?.setAttribute('transform',`translate(${geometry.endpoints[0].x} ${geometry.endpoints[0].y})`);
  edgeControlLayer.querySelector('[data-edge-endpoint-side="to"]')?.setAttribute('transform',`translate(${geometry.endpoints[1].x} ${geometry.endpoints[1].y})`);
  const handles=[...edgeControlLayer.querySelectorAll('.edge-control-handle')];
  if(handles.length!==geometry.controls.length){if(!edgeControlDrag)renderSelectedEdgeControls();return}
  handles.forEach((handle,index)=>{const point=geometry.controls[index];handle.dataset.edgeControlKind=point.kind;handle.dataset.edgeControlIndex=String(point.index);handle.setAttribute('transform',`translate(${point.x} ${point.y})`)});
}
function updateLinkGeometry(link,nodeMap){
  const dom=edgeDomById.get(link&&link.id);if(!dom)return false;
  const points=linkRenderPoints(link,nodeMap);if(!points)return false;
  const geometry=linkPathGeometry(link,points.a,points.b);dom.geometry=geometry;dom.hit.setAttribute('d',geometry.d);dom.vis.setAttribute('d',geometry.d);
  if(dom.overlay)dom.overlay.setAttribute('d',geometry.d);if(hoveredEdgeId===String(link.id)&&edgeHoverOverlay)edgeHoverOverlay.setAttribute('d',geometry.d);
  updateEdgeControlLayerGeometry(link,dom,geometry);
  if(dom.label){dom.label.setAttribute('x',(points.ca.x+points.cb.x)/2);dom.label.setAttribute('y',(points.ca.y+points.cb.y)/2-8)}
  if(state.selectedLinkId===link.id)updateSelectedEdgeQuickStylePosition();return true;
}
function edgeRouteSnapshot(link){return{from:link.from||'',to:link.to||'',fromPoint:link.fromPoint?{...link.fromPoint}:undefined,toPoint:link.toPoint?{...link.toPoint}:undefined,pathStyle:link.pathStyle,waypoints:Array.isArray(link.waypoints)?link.waypoints.map(point=>({...point})):undefined,curveControls:Array.isArray(link.curveControls)?link.curveControls.map(point=>({...point})):undefined}}
function restoreEdgeRoute(link,snapshot){
  link.from=snapshot.from||'';link.to=snapshot.to||'';
  if(snapshot.fromPoint===undefined)delete link.fromPoint;else link.fromPoint={...snapshot.fromPoint};
  if(snapshot.toPoint===undefined)delete link.toPoint;else link.toPoint={...snapshot.toPoint};
  link.pathStyle=snapshot.pathStyle;if(snapshot.waypoints===undefined)delete link.waypoints;else link.waypoints=snapshot.waypoints.map(point=>({...point}));if(snapshot.curveControls===undefined)delete link.curveControls;else link.curveControls=snapshot.curveControls.map(point=>({...point}));invalidateGraphIndexCache();
}
function persistDerivedEdgeRoute(link,geometry){
  if(!link||!geometry)return;
  if(geometry.style==='elbow'&&!normalizedEdgePoints(link.waypoints,12).length)link.waypoints=geometry.controls.map(point=>({x:point.x,y:point.y}));
  if(geometry.style==='curve'&&normalizedEdgePoints(link.curveControls,2).length!==2)link.curveControls=geometry.controls.map(point=>({x:point.x,y:point.y}));
}
function translateEdgePoint(point,dx,dy){return{x:point.x+dx,y:point.y+dy}}
function selectEdgeForDirectManipulation(linkId,event){
  const id=String(linkId||'');if(!linkById(id))return;
  state.selectedElementId=null;selectedTextElementIds.clear();selectedNodeIds.clear();selectedLinkIds.clear();state.selectedNodeId=null;state.linkSourceId=null;state.selectedLinkId=id;setSelectedEdgeQuickStyleAnchorFromEvent(event);
  refreshCardClasses();refreshEdgeSelectionClasses({renderPanel:false});renderDetails();hideSelectedEdgeQuickStylePanel();
}
function consumeSuppressedEdgeClick(id){if(String(id)===suppressEdgeClickId&&performance.now()<suppressEdgeClickUntil){suppressEdgeClickId='';suppressEdgeClickUntil=0;return true}return false}
function beginEdgeMoveDrag(event,linkId){
  if(!graphModeAllows('edgeMove'))return false;
  if(isCanvasPanMode()||document.body.classList.contains('auth-readonly')||event.button!==0||event.ctrlKey||event.metaKey||event.shiftKey)return false;
  const link=linkById(linkId),dom=edgeDomById.get(String(linkId));if(!link||!dom?.geometry)return false;
  edgeMoveDrag={pointerId:event.pointerId,linkId:String(linkId),handle:event.currentTarget,startClient:{x:event.clientX,y:event.clientY},startWorld:screenToWorld(event.clientX,event.clientY),original:edgeRouteSnapshot(link),geometry:{style:dom.geometry.style,endpoints:dom.geometry.endpoints.map(point=>({...point})),controls:dom.geometry.controls.map(point=>({...point}))},moved:false,history:false};
  try{event.currentTarget.setPointerCapture(event.pointerId)}catch(error){}event.stopPropagation();return true;
}
function applyEdgeMoveDragPoint(point){
  const drag=edgeMoveDrag;if(!drag)return;const link=linkById(drag.linkId),dom=edgeDomById.get(drag.linkId);if(!link||!dom)return;
  const dx=point.x-drag.startWorld.x,dy=point.y-drag.startWorld.y;if(!drag.moved&&Math.hypot(dx,dy)<5/Math.max(.01,state.viewport.scale))return;
  if(!drag.history){pushGraphUndoSnapshot('移动关系线');drag.history=true;selectEdgeForDirectManipulation(drag.linkId,{clientX:drag.startClient.x,clientY:drag.startClient.y})}
  drag.moved=true;const geometry=drag.geometry;setLinkFreeEndpoint(link,'from',translateEdgePoint(geometry.endpoints[0],dx,dy));setLinkFreeEndpoint(link,'to',translateEdgePoint(geometry.endpoints[1],dx,dy));
  if(geometry.style==='elbow'){link.waypoints=geometry.controls.map(point=>translateEdgePoint(point,dx,dy));delete link.curveControls}
  else if(geometry.style==='curve'){link.curveControls=geometry.controls.map(point=>translateEdgePoint(point,dx,dy));delete link.waypoints}
  else{delete link.waypoints;delete link.curveControls}
  invalidateGraphIndexCache();updateLinkGeometry(link,getGraphIndex().nodeMap);stage.classList.add('graph-edge-moving','is-interacting');hideEdgeHoverFeedback();
}
function scheduleEdgeMoveDrag(event){
  if(!edgeMoveDrag||edgeMoveDrag.pointerId!==event.pointerId)return;edgeMoveDragPoint=screenToWorld(event.clientX,event.clientY);
  if(!edgeMoveDragFrame)edgeMoveDragFrame=requestAnimationFrame(()=>{edgeMoveDragFrame=0;const point=edgeMoveDragPoint;edgeMoveDragPoint=null;if(point)applyEdgeMoveDragPoint(point)});
  if(edgeMoveDrag.moved){event.preventDefault();event.stopPropagation()}
}
function finishEdgeMoveDrag(event,cancelled=false){
  const drag=edgeMoveDrag;if(!drag||drag.pointerId!==event.pointerId)return false;
  if(edgeMoveDragFrame){cancelAnimationFrame(edgeMoveDragFrame);edgeMoveDragFrame=0}if(edgeMoveDragPoint&&!cancelled)applyEdgeMoveDragPoint(edgeMoveDragPoint);edgeMoveDragPoint=null;
  const link=linkById(drag.linkId);if((cancelled||!drag.moved)&&link&&drag.history){restoreEdgeRoute(link,drag.original);updateLinkGeometry(link,getGraphIndex().nodeMap)}
  try{drag.handle?.releasePointerCapture?.(event.pointerId)}catch(error){}edgeMoveDrag=null;stage.classList.remove('graph-edge-moving','is-interacting');
  if(!cancelled&&drag.moved){suppressEdgeClickId=drag.linkId;suppressEdgeClickUntil=performance.now()+400;save();renderSelectedEdgeControls();renderSelectedEdgeQuickStylePanel();showStatus('关系线已独立移动，两个端点已解除节点绑定；可拖动端点重新绑定。')}else if(cancelled&&drag.moved)showStatus('已取消移动关系线。');
  if(drag.moved){event.preventDefault();event.stopPropagation()}return drag.moved;
}
function clearEdgeEndpointBindTarget(){if(edgeEndpointBindTargetId)cardElementByNodeId(edgeEndpointBindTargetId)?.classList.remove('edge-endpoint-bind-target');edgeEndpointBindTargetId=''}
function edgeEndpointTargetFromClient(clientX,clientY){const element=document.elementFromPoint(clientX,clientY),card=element&&element.closest&&element.closest('.knowledge-card[data-node-id]');if(!card||!cardsLayer.contains(card))return null;const node=nodeById(card.dataset.nodeId);return node&&!isNodeFullyLocked(node)?node:null}
function setEdgeEndpointBindTarget(node){const id=node&&String(node.id)||'';if(id===edgeEndpointBindTargetId)return;clearEdgeEndpointBindTarget();if(id){edgeEndpointBindTargetId=id;cardElementByNodeId(id)?.classList.add('edge-endpoint-bind-target')}}
function beginEdgeEndpointDrag(event,linkId,side){
  if(!graphModeAllows('edgeAdvanced'))return false;
  if(isCanvasPanMode()||document.body.classList.contains('auth-readonly')||event.button!==0)return;
  const link=linkById(linkId),dom=edgeDomById.get(String(linkId));if(!link||!dom?.geometry)return;const original=edgeRouteSnapshot(link);
  edgeEndpointDrag={pointerId:event.pointerId,linkId:String(linkId),side:side==='from'?'from':'to',handle:event.currentTarget,original,startClient:{x:event.clientX,y:event.clientY},moved:false,history:false,targetId:''};
  setSelectedEdgeQuickStyleAnchorFromEvent(event);hideSelectedEdgeQuickStylePanel();stage.classList.add('graph-edge-endpoint-dragging','is-interacting');try{event.currentTarget.setPointerCapture(event.pointerId)}catch(error){}event.preventDefault();event.stopPropagation();
}
function applyEdgeEndpointDragPoint(payload){
  const drag=edgeEndpointDrag;if(!drag||!payload)return;const link=linkById(drag.linkId);if(!link)return;
  if(!drag.moved&&Math.hypot(payload.clientX-drag.startClient.x,payload.clientY-drag.startClient.y)<3)return;
  if(!drag.history){pushGraphUndoSnapshot('调整关系线端点');persistDerivedEdgeRoute(link,edgeDomById.get(drag.linkId)?.geometry);drag.history=true}
  drag.moved=true;setLinkFreeEndpoint(link,drag.side,payload.world);invalidateGraphIndexCache();const target=edgeEndpointTargetFromClient(payload.clientX,payload.clientY),otherId=drag.side==='from'?link.to:link.from;
  if(target&&target.id!==otherId){drag.targetId=target.id;setEdgeEndpointBindTarget(target)}else{drag.targetId='';clearEdgeEndpointBindTarget()}
  updateLinkGeometry(link,getGraphIndex().nodeMap);
}
function scheduleEdgeEndpointDrag(event){
  if(!edgeEndpointDrag||edgeEndpointDrag.pointerId!==event.pointerId)return;edgeEndpointDragPoint={world:screenToWorld(event.clientX,event.clientY),clientX:event.clientX,clientY:event.clientY};
  if(!edgeEndpointDragFrame)edgeEndpointDragFrame=requestAnimationFrame(()=>{edgeEndpointDragFrame=0;const point=edgeEndpointDragPoint;edgeEndpointDragPoint=null;if(point)applyEdgeEndpointDragPoint(point)});event.preventDefault();event.stopPropagation();
}
function finishEdgeEndpointDrag(event,cancelled=false){
  const drag=edgeEndpointDrag;if(!drag||drag.pointerId!==event.pointerId)return;
  if(edgeEndpointDragFrame){cancelAnimationFrame(edgeEndpointDragFrame);edgeEndpointDragFrame=0}if(edgeEndpointDragPoint&&!cancelled)applyEdgeEndpointDragPoint(edgeEndpointDragPoint);edgeEndpointDragPoint=null;
  const link=linkById(drag.linkId);let bound=false;if(link&&!cancelled&&drag.moved&&drag.targetId)bound=bindLinkEndpoint(link,drag.side,drag.targetId);
  if(link&&(cancelled||!drag.moved)&&drag.history){restoreEdgeRoute(link,drag.original)}else invalidateGraphIndexCache();if(link)updateLinkGeometry(link,getGraphIndex().nodeMap);
  clearEdgeEndpointBindTarget();try{drag.handle?.releasePointerCapture?.(event.pointerId)}catch(error){}edgeEndpointDrag=null;stage.classList.remove('graph-edge-endpoint-dragging','is-interacting');
  if(!cancelled&&drag.moved){save();renderSelectedEdgeControls();renderSelectedEdgeQuickStylePanel();showStatus(bound?'关系线端点已重新绑定到节点。':'关系线端点已移动，当前保持未绑定状态。')}else if(cancelled)showStatus('已取消调整关系线端点。');event.preventDefault();event.stopPropagation();
}
function createEdgeEndpointHandle(link,side,point){
  const handle=svgElement('g','edge-endpoint-handle');handle.dataset.linkId=String(link.id);handle.dataset.edgeEndpointSide=side;handle.setAttribute('transform',`translate(${point.x} ${point.y})`);
  handle.appendChild(svgElement('circle','edge-endpoint-hit'));handle.appendChild(svgElement('circle','edge-endpoint-dot'));
  handle.addEventListener('pointerdown',event=>beginEdgeEndpointDrag(event,link.id,side));handle.addEventListener('pointermove',scheduleEdgeEndpointDrag);handle.addEventListener('pointerup',event=>finishEdgeEndpointDrag(event,false));handle.addEventListener('pointercancel',event=>finishEdgeEndpointDrag(event,true));return handle;
}
function beginEdgeControlDrag(event,linkId,kind,index){
  if(!graphModeAllows('edgeAdvanced'))return false;
  if(isCanvasPanMode()||document.body.classList.contains('auth-readonly')||event.button===2)return;
  const link=linkById(linkId),dom=edgeDomById.get(String(linkId));if(!link||!dom?.geometry)return;const original=edgeRouteSnapshot(link);
  pushGraphUndoSnapshot('调整关系线路径');
  if(kind==='waypoint'&&!normalizedEdgePoints(link.waypoints,12).length)link.waypoints=dom.geometry.controls.map(point=>({x:point.x,y:point.y}));
  if(kind==='curve-control'&&normalizedEdgePoints(link.curveControls,2).length!==2)link.curveControls=dom.geometry.controls.map(point=>({x:point.x,y:point.y}));
  edgeControlDrag={pointerId:event.pointerId,linkId:String(linkId),kind,index:Number(index)||0,handle:event.currentTarget,original,moved:false};stage.classList.add('graph-edge-control-dragging','is-interacting');
  try{event.currentTarget.setPointerCapture(event.pointerId)}catch(error){}
  event.preventDefault();event.stopPropagation();
}
function applyEdgeControlDragPoint(point){
  const drag=edgeControlDrag;if(!drag)return;const link=linkById(drag.linkId);if(!link)return;
  drag.moved=true;
  if(drag.kind==='straight-bend'){
    link.pathStyle='elbow';link.waypoints=[{x:point.x,y:point.y}];delete link.curveControls;drag.kind='waypoint';drag.index=0;if(drag.handle)drag.handle.dataset.edgeControlKind='waypoint';
  }else if(drag.kind==='waypoint'){
    const points=normalizedEdgePoints(link.waypoints,12);while(points.length<=drag.index)points.push({x:point.x,y:point.y});points[drag.index]={x:point.x,y:point.y};link.waypoints=points;
  }else if(drag.kind==='curve-control'){
    const points=normalizedEdgePoints(link.curveControls,2);while(points.length<2)points.push({x:point.x,y:point.y});points[drag.index]={x:point.x,y:point.y};link.curveControls=points;
  }
  updateLinkGeometry(link,getGraphIndex().nodeMap);
}
function scheduleEdgeControlDrag(event){
  if(!edgeControlDrag||edgeControlDrag.pointerId!==event.pointerId)return;edgeControlDragPoint=screenToWorld(event.clientX,event.clientY);
  if(!edgeControlDragFrame)edgeControlDragFrame=requestAnimationFrame(()=>{edgeControlDragFrame=0;const point=edgeControlDragPoint;edgeControlDragPoint=null;if(point)applyEdgeControlDragPoint(point)});
  event.preventDefault();event.stopPropagation();
}
function finishEdgeControlDrag(event,cancelled=false){
  const drag=edgeControlDrag;if(!drag||drag.pointerId!==event.pointerId)return;
  if(edgeControlDragFrame){cancelAnimationFrame(edgeControlDragFrame);edgeControlDragFrame=0}if(edgeControlDragPoint&&!cancelled)applyEdgeControlDragPoint(edgeControlDragPoint);edgeControlDragPoint=null;
  const link=linkById(drag.linkId);if((cancelled||!drag.moved)&&link){restoreEdgeRoute(link,drag.original);updateLinkGeometry(link,getGraphIndex().nodeMap)}
  try{drag.handle?.releasePointerCapture?.(event.pointerId)}catch(error){}edgeControlDrag=null;stage.classList.remove('graph-edge-control-dragging','is-interacting');
  if(!cancelled&&drag.moved){save();renderSelectedEdgeQuickStylePanel();showStatus('关系线路径已更新。')}else if(cancelled)showStatus('已取消调整关系线路径。');
  renderSelectedEdgeControls();event.preventDefault();event.stopPropagation();
}
function createEdgeControlHandle(link,point){
  const handle=svgElement('g','edge-control-handle');handle.dataset.linkId=String(link.id);handle.dataset.edgeControlKind=point.kind;handle.dataset.edgeControlIndex=String(point.index);handle.setAttribute('transform',`translate(${point.x} ${point.y})`);
  handle.appendChild(svgElement('circle','edge-control-hit'));handle.appendChild(svgElement('circle','edge-control-dot'));
  handle.addEventListener('pointerdown',event=>beginEdgeControlDrag(event,link.id,handle.dataset.edgeControlKind,Number(handle.dataset.edgeControlIndex)));
  handle.addEventListener('pointermove',scheduleEdgeControlDrag);handle.addEventListener('pointerup',event=>finishEdgeControlDrag(event,false));handle.addEventListener('pointercancel',event=>finishEdgeControlDrag(event,true));
  return handle;
}
function renderSelectedEdgeControls(){
  if(!edgeControlLayer)return;edgeControlLayer.replaceChildren();delete edgeControlLayer.dataset.linkId;
  if(!graphModeAllows('edgeAdvanced'))return;
  const selected=selectedEdgeIdSet();if(selected.size!==1||selectedNodeIds.size||selectedTextElementIds.size)return;
  const id=selected.values().next().value,link=linkById(id),dom=edgeDomById.get(id);if(!link||!dom?.geometry)return;
  edgeControlLayer.dataset.linkId=id;const guide=svgElement('path','edge-control-guide'),guideD=edgeControlGuidePath(dom.geometry);guide.setAttribute('d',guideD);guide.hidden=!guideD;edgeControlLayer.appendChild(guide);
  edgeControlLayer.appendChild(createEdgeEndpointHandle(link,'from',dom.geometry.endpoints[0]));
  edgeControlLayer.appendChild(createEdgeEndpointHandle(link,'to',dom.geometry.endpoints[1]));
  dom.geometry.controls.forEach(point=>edgeControlLayer.appendChild(createEdgeControlHandle(link,point)));updateSelectedEdgeControlScale();
}
let selectedEdgeQuickStylePanel=null,selectedEdgeQuickStyleToolbarController=null,selectedEdgeQuickStyleAnchorWorld=null;
function selectedEditableLinkIds(){
  const ids=new Set([...selectedLinkIds].map(String).filter(id=>linkById(id)));
  if(state.selectedLinkId&&linkById(state.selectedLinkId))ids.add(String(state.selectedLinkId));
  return [...ids];
}
function selectedEditableLinks(){return selectedEditableLinkIds().map(id=>linkById(id)).filter(Boolean)}
function edgeBatchMixedValue(links,key,fallback){
  if(!links.length)return fallback;const first=links[0][key]??fallback;
  return links.every(link=>(link[key]??fallback)===first)?first:null;
}

function ensureSelectedEdgeQuickStylePanel(){
  if(selectedEdgeQuickStyleToolbarController?.root?.()?.isConnected)return selectedEdgeQuickStyleToolbarController.root();
  const factory=window.KGCanvasEdgeToolbarController;
  if(!factory?.create)return null;
  selectedEdgeQuickStyleToolbarController=factory.create({
    host:stage,id:'edgeQuickStylePanel',className:'edge-toolbar-unified',
    onLineStyle:value=>{if(LINE_STYLES.has(value)&&typeof applyLineStyle==='function')applyLineStyle(value)},
    onPathStyle:value=>{if(LINE_PATH_STYLES.has(value)&&typeof applyPathStyle==='function')applyPathStyle(value)},
    onWidth:value=>{if(typeof applyLineWidth==='function')applyLineWidth(Number(value))},
    onArrowStyle:value=>{if(typeof applyArrowStyle==='function')applyArrowStyle(value)},
    onLabel:event=>{
      const links=selectedEditableLinks(),id=links.length===1?String(links[0].id):'';
      if(id){openEdgeInlineLabelEditor(id,event);hideSelectedEdgeQuickStylePanel()}
    },
    colorPresets:NODE_TOOLBAR_COLOR_PRESETS,
    onColorPreset:color=>{if(typeof applyLineColor==='function')applyLineColor(color)},
    onColorCustom:(event,root,anchor)=>{
      const links=selectedEditableLinks(),link=links[0],picker=window.KGColorPickerV2;
      const stableAnchor=anchor||root.querySelector('[data-uc-edge-panel="color"]');
      if(link&&picker&&typeof picker.open==='function'){
        const colors=[...(state.links||[]).map(item=>item&&item.color),...nodeToolbarDocumentColors()].filter(Boolean);
        picker.open({kind:'edge',title:'关系线颜色',anchor:stableAnchor,pointer:{x:event.clientX,y:event.clientY},value:{color:safeColor(link.color,DEFAULTS.linkColor),opacity:1},allowOpacity:false,allowTransparent:false,presets:NODE_TOOLBAR_COLOR_PRESETS,documentColors:colors,documentLabel:'当前图谱',onCommit:value=>{if(typeof applyLineColor==='function')applyLineColor(value.color)}});
      }
    }
  });
  selectedEdgeQuickStylePanel=selectedEdgeQuickStyleToolbarController.ensure();
  return selectedEdgeQuickStylePanel;
}
function selectedEdgeQuickScreenPoint(){
  const links=selectedEditableLinks();if(!links.length)return null;
  if(selectedEdgeQuickStyleAnchorWorld)return{x:selectedEdgeQuickStyleAnchorWorld.x*state.viewport.scale+state.viewport.x,y:selectedEdgeQuickStyleAnchorWorld.y*state.viewport.scale+state.viewport.y,link:links[0]};
  const points=[];
  for(const link of links){const point=linkGeometryMidpoint(link);if(point)points.push(point)}
  if(!points.length)return null;
  const world={x:points.reduce((sum,p)=>sum+p.x,0)/points.length,y:points.reduce((sum,p)=>sum+p.y,0)/points.length};
  return{x:world.x*state.viewport.scale+state.viewport.x,y:world.y*state.viewport.scale+state.viewport.y,link:links[0]};
}
function setSelectedEdgeQuickStyleAnchorFromEvent(event){
  if(event&&Number.isFinite(event.clientX)&&Number.isFinite(event.clientY))selectedEdgeQuickStyleAnchorWorld=screenToWorld(event.clientX,event.clientY);
  else selectedEdgeQuickStyleAnchorWorld=null;
}
function updateSelectedEdgeQuickStylePosition(){
  if(!selectedEdgeQuickStyleToolbarController?.isVisible?.())return;
  const point=selectedEdgeQuickScreenPoint();if(!point){hideSelectedEdgeQuickStylePanel();return}
  selectedEdgeQuickStyleToolbarController.position(point);
}
function hideSelectedEdgeQuickStylePanel(){
  selectedEdgeQuickStyleToolbarController?.hide?.();selectedEdgeQuickStyleAnchorWorld=null;
}
function renderSelectedEdgeQuickStylePanel(){
  if(!graphModeAllows('edgeToolbar')){hideSelectedEdgeQuickStylePanel();hideEdgeInlineLabelEditor();return}
  const links=selectedEditableLinks();
  if(!links.length||selectedNodeIds.size||selectedTextElementIds.size){hideSelectedEdgeQuickStylePanel();hideEdgeInlineLabelEditor();return}
  const panel=ensureSelectedEdgeQuickStylePanel();if(!panel)return;
  const point=selectedEdgeQuickScreenPoint();if(!point)return;
  selectedEdgeQuickStyleToolbarController.show({
    point,count:links.length,
    lineStyle:edgeBatchMixedValue(links,'lineStyle',DEFAULTS.linkStyle),
    pathStyle:edgeBatchMixedValue(links,'pathStyle',DEFAULTS.linkPathStyle),
    color:safeColor(edgeBatchMixedValue(links,'color',DEFAULTS.linkColor)||DEFAULTS.linkColor,DEFAULTS.linkColor),
    width:edgeBatchMixedValue(links,'strokeWidth',4),
    arrowStyle:edgeBatchMixedValue(links,'arrowStyle','none'),
    selectionFilter:window.KGHomeCanvasRuntime?.selectionFilter
  });
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
  if(edgeInlineLabelAnchorWorld)return{x:edgeInlineLabelAnchorWorld.x*state.viewport.scale+state.viewport.x,y:edgeInlineLabelAnchorWorld.y*state.viewport.scale+state.viewport.y};
  const point=linkGeometryMidpoint(link);if(!point)return null;
  return{x:point.x*state.viewport.scale+state.viewport.x,y:point.y*state.viewport.scale+state.viewport.y};
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
  if(!graphModeAllows('edgeLabelEdit'))return false;
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
  if(state.selectedLinkId===link.id||selectedLinkIds.has(String(link.id)))return true;
  if(large)return !!(edgeIsLocal&&labelCount<LARGE_GRAPH_SELECTED_LABEL_LIMIT);
  return !!(normalLabelNodeIds&&normalLabelNodeIds.size&&(normalLabelNodeIds.has(link.from)||normalLabelNodeIds.has(link.to)));
}
function shouldRenderLinkInCurrentMode(link,nodeMap,localIds,renderedCount){
  if(!link||!linkRenderPoints(link,nodeMap))return false;
  const selected=state.selectedLinkId===link.id||selectedLinkIds.has(String(link.id)),localMatch=!!(localIds&&localIds.size&&(localIds.has(link.from)||localIds.has(link.to)));
  const a=(nodeMap&&nodeMap.get(link.from))||null,b=(nodeMap&&nodeMap.get(link.to))||null;
  if(!isLargeGraphMode()){
    if(selected)return true;
    if(largeGraphRelatedFocusEnabled&&localIds&&localIds.size)return localMatch;
    if(largeGraphOverviewEnabled){if(localMatch)return true;if(!a||!b)return false;return isNormalGraphTrunkLink(link,a,b)}
    return true;
  }
  if(selected)return true;
  if(largeGraphRelatedFocusEnabled&&localIds&&localIds.size){if(!localMatch)return false;return renderedCount<LARGE_GRAPH_SELECTED_LINK_LIMIT}
  if(localIds&&localIds.size&&localMatch)return renderedCount<LARGE_GRAPH_SELECTED_LINK_LIMIT;
  if(!largeGraphOverviewEnabled)return false;
  const overlayLimit=(localIds&&localIds.size)?Math.max(LARGE_GRAPH_OVERVIEW_LINK_LIMIT,LARGE_GRAPH_SELECTED_LINK_LIMIT+60):LARGE_GRAPH_OVERVIEW_LINK_LIMIT;
  if(renderedCount>=overlayLimit)return false;
  if(!a||!b)return true;
  return isLargeGraphOverviewLink(link,a,b);
}
function ensureGraphEdgeMarkers(){
  const svg=$('edgeLayer');if(!svg)return null;
  let defs=svg.querySelector('defs[data-kg-edge-markers]');
  if(defs)return defs;
  defs=document.createElementNS('http://www.w3.org/2000/svg','defs');defs.dataset.kgEdgeMarkers='true';
  defs.innerHTML='<marker id="kgGraphArrow" viewBox="0 0 10 10" refX="8" refY="5" markerWidth="5" markerHeight="5" orient="auto-start-reverse" markerUnits="strokeWidth"><path d="M 0 0 L 10 5 L 0 10 z" fill="context-stroke"></path></marker>';
  svg.insertBefore(defs,svg.firstChild);return defs;
}
function renderEdges(){
  ensureGraphEdgeMarkers();hideEdgeHoverFeedback();
  const nodeMap=getGraphIndex().nodeMap,baseFrag=document.createDocumentFragment(),nextEdgeDom=new Map(),large=isLargeGraphMode(),relationState=largeGraphRelationState();
  const normalLocalMode=!large&&relationState&&(largeGraphRelatedFocusEnabled||largeGraphOverviewEnabled),localIds=large?largeGraphLocalIds():(normalLocalMode?relationState.anchors:new Set());
  edgeHoverLayer=svgElement('g','edge-hover-layer');edgeBaseLayer=svgElement('g','edge-base-layer');edgeFeedbackLayer=svgElement('g','edge-feedback-layer');edgeControlLayer=svgElement('g','edge-control-layer');
  edgeHoverOverlay=svgElement('path','edge-hover-overlay');edgeHoverOverlay.setAttribute('aria-hidden','true');edgeHoverLayer.appendChild(edgeHoverOverlay);
  let renderedCount=0;
  for(const link of state.links){
    if(!shouldRenderLinkInCurrentMode(link,nodeMap,localIds,renderedCount))continue;
    const renderPoints=linkRenderPoints(link,nodeMap);if(!renderPoints)continue;const a=renderPoints.aNode,b=renderPoints.bNode;
    const edgeIsLocal=!!(localIds&&localIds.size&&(localIds.has(link.from)||localIds.has(link.to)));renderedCount++;
    const g=svgElement('g'),hit=svgElement('path'),vis=svgElement('path');
    const lineColor=safeColor(link.color,DEFAULTS.linkColor),lineStyle=LINE_STYLES.has(link.lineStyle)?link.lineStyle:DEFAULTS.linkStyle,importantLink=!!state.focusMode&&a&&b&&isImportant(a)&&isImportant(b),normalRelationLayer=!large&&relationLayerEnabled()&&relationState&&relationState.anchors&&relationState.anchors.size?(relationState.anchors.has(link.from)||relationState.anchors.has(link.to)?'active':'muted'):'';
    g.setAttribute('data-link-id',link.id);if(large)g.setAttribute('data-large-edge-mode',edgeIsLocal?'local':'overview');if(normalRelationLayer)g.setAttribute('data-relation-layer',normalRelationLayer);
    hit.setAttribute('class','edge-hit'+(normalRelationLayer==='active'?' edge-related-active':'')+(normalRelationLayer==='muted'?' edge-related-muted':''));
    const interactive=normalRelationLayer!=='muted'&&graphModeAllows('edgeSelect');
    if(interactive){
      hit.addEventListener('pointerenter',()=>showEdgeHoverFeedback(link.id));hit.addEventListener('pointerleave',()=>{if(hoveredEdgeId===String(link.id))hideEdgeHoverFeedback()});
      if(graphModeAllows('edgeMove')){
        hit.addEventListener('pointerdown',event=>{if(isCanvasPanMode()||event.button===2)return;beginEdgeMoveDrag(event,link.id);event.stopPropagation()});
        hit.addEventListener('pointermove',scheduleEdgeMoveDrag);hit.addEventListener('pointerup',event=>finishEdgeMoveDrag(event,false));hit.addEventListener('pointercancel',event=>finishEdgeMoveDrag(event,true));
      }
      hit.addEventListener('click',event=>{if(consumeSuppressedEdgeClick(link.id)){event.preventDefault();event.stopPropagation();return}if(isCanvasPanMode()){event.preventDefault();return}event.stopPropagation();selectLink(link.id,event)});
      if(graphModeAllows('edgeLabelEdit'))hit.addEventListener('dblclick',event=>{if(isCanvasPanMode()){event.preventDefault();return}event.preventDefault();event.stopPropagation();if(event.altKey&&graphModeAllows('edgeAdvanced'))openLinkModal(link.id);else openEdgeInlineLabelEditor(link.id,event)});
    }
    vis.setAttribute('class','edge-visible'+(importantLink?' focus-important-edge':'')+(normalRelationLayer==='active'?' edge-related-active':'')+(normalRelationLayer==='muted'?' edge-related-muted':''));vis.style.setProperty('--edge-color',lineColor);
    const strokeWidth=Math.max(1,Math.min(8,Number(link.strokeWidth)||4)),arrowStyle=['none','end','both'].includes(String(link.arrowStyle||''))?String(link.arrowStyle):'none';vis.style.strokeWidth=strokeWidth;vis.style.setProperty('--edge-base-width',String(strokeWidth));vis.dataset.strokeWidth=String(strokeWidth);vis.dataset.arrowStyle=arrowStyle;
    if(arrowStyle==='end'||arrowStyle==='both')vis.setAttribute('marker-end','url(#kgGraphArrow)');if(arrowStyle==='both')vis.setAttribute('marker-start','url(#kgGraphArrow)');const dashArray=dashArrayForLineStyle(lineStyle,strokeWidth);if(dashArray)vis.setAttribute('stroke-dasharray',dashArray);
    g.appendChild(hit);g.appendChild(vis);const label=null;nextEdgeDom.set(String(link.id),{g,hit,vis,label,link,overlay:null,geometry:null});baseFrag.appendChild(g);
  }
  edgeDomById=nextEdgeDom;for(const link of state.links){if(edgeDomById.has(String(link.id)))updateLinkGeometry(link,nodeMap)}
  edgeBaseLayer.appendChild(baseFrag);edgeGroup.replaceChildren(edgeHoverLayer,edgeBaseLayer,edgeFeedbackLayer,edgeControlLayer);edgeSelectionPaintedIds=new Set();refreshEdgeSelectionClasses({renderPanel:false});updateSelectedEdgeControlScale();
}
let edgeRenderPending=false,edgeGeometryRenderPending=false,pendingEdgeNodeIds=new Set(),homeEdgeDragPerformanceController=null;
function requestEdgeRender(){if(edgeRenderPending)return;edgeRenderPending=true;requestAnimationFrame(()=>{edgeRenderPending=false;renderEdges()})}
function updateVisibleLinkGeometryForDrag(link,dom,nodeMap){
  if(!link||!dom?.vis)return false;
  const points=linkRenderPoints(link,nodeMap);if(!points)return false;
  const geometry=linkPathGeometry(link,points.a,points.b);dom.geometry=geometry;dom.vis.setAttribute('d',geometry.d);return true;
}
function updateLinkedEdgeGeometryNow(nodeIds,{lite=false}={}){
  const ids=new Set((Array.isArray(nodeIds)?nodeIds:[nodeIds]).map(String).filter(Boolean));if(!ids.size)return 0;
  const nodeMap=getGraphIndex().nodeMap,seenLinks=new Set();let count=0;
  for(const id of ids){
    for(const link of linksForNodeId(id)){
      if(!link||seenLinks.has(String(link.id)))continue;seenLinks.add(String(link.id));
      const dom=edgeDomById.get(String(link.id));if(!dom)continue;
      if(isLargeGraphMode()&&dom.g?.getAttribute('data-large-edge-mode')!=='local')continue;
      if(lite?updateVisibleLinkGeometryForDrag(link,dom,nodeMap):updateLinkGeometry(link,nodeMap))count++;
    }
  }
  return count;
}
function requestLinkedEdgeGeometryRender(nodeIds){
  const ids=Array.isArray(nodeIds)?nodeIds:[nodeIds];ids.forEach(id=>{if(id)pendingEdgeNodeIds.add(String(id))});
  if(edgeGeometryRenderPending)return;
  edgeGeometryRenderPending=true;
  requestAnimationFrame(()=>{edgeGeometryRenderPending=false;const ids=[...pendingEdgeNodeIds];pendingEdgeNodeIds.clear();updateLinkedEdgeGeometryNow(ids)})
}
function ensureHomeEdgeDragPerformanceController(){
  if(homeEdgeDragPerformanceController)return homeEdgeDragPerformanceController;
  const factory=window.KGCanvasDragPerformanceController;if(!factory?.create)return null;
  homeEdgeDragPerformanceController=factory.create({
    root:stage,activeClass:'graph-edge-drag-lite',
    update:ids=>updateLinkedEdgeGeometryNow(ids,{lite:true}),
    onStart:()=>{hideEdgeHoverFeedback();hideSelectedEdgeQuickStylePanel();hideEdgeInlineLabelEditor();window.KGHomeCanvasRuntime?.alignment?.clearGuides?.()},
    onStop:ids=>updateLinkedEdgeGeometryNow(ids,{lite:false})
  });
  return homeEdgeDragPerformanceController;
}

function clearMultiSelection(){selectedTextElementIds.clear();const controller=ensureGraphSelectionController();if(controller)return controller.clearMulti();selectedNodeIds.clear();selectedLinkIds.clear()}
function selectedNodeTitle(){
  if(!selectedNodeIds.size)return '';
  const names=[...selectedNodeIds].map(id=>nodeById(id)).filter(Boolean).slice(0,3).map(n=>n.title);
  return names.join('、')+(selectedNodeIds.size>3?' 等':'');
}

const GRAPH_UNDO_LIMIT=50;
let graphClipboardNodes=null,graphClipboardTextElement=null,lastGraphPointerWorldPosition=null;
function cloneGraphValue(value){
  try{return JSON.parse(JSON.stringify(value))}catch(e){return value}
}
function graphUndoSnapshot(){
  const selection=ensureGraphSelectionController();
  const selected=selection?selection.snapshot():{
    selectedNodeId:state.selectedNodeId||null,
    selectedLinkId:state.selectedLinkId||null,
    linkSourceId:state.linkSourceId||null,
    selectedNodeIds:[...selectedNodeIds],
    selectedLinkIds:[...selectedLinkIds]
  };
  return{
    nodes:cloneGraphValue(state.nodes||[]),
    links:cloneGraphValue(state.links||[]),
    elements:cloneGraphValue(state.elements||[]),
    defaults:cloneGraphValue(state.defaults||{}),
    selection:{...selected,selectedElementId:state.selectedElementId||null,selectedTextElementIds:[...selectedTextElementIds]}
  };
}
function applyGraphHistorySnapshot(snapshot={}){
  clearRelatedGatherLayout({render:false,message:false});
  nodeFreeResizeModeId=null;
  if(nodeContextMenuController)nodeContextMenuController.hide();
  state.nodes=cloneGraphValue(snapshot.nodes||[]).map(node=>window.KGGraphModel&&window.KGGraphModel.normalizeNode?window.KGGraphModel.normalizeNode(node):node);
  state.links=cloneGraphValue(snapshot.links||[]);
  state.elements=cloneGraphValue(snapshot.elements||[]).map(item=>window.KGGraphModel&&window.KGGraphModel.normalizeTextElement?window.KGGraphModel.normalizeTextElement(item):item);
  state.defaults={...state.defaults,...cloneGraphValue(snapshot.defaults||{})};
  const nodeIds=new Set(state.nodes.map(n=>n.id)),linkIds=new Set(state.links.map(l=>l.id)),elementIds=new Set((state.elements||[]).map(item=>item.id));
  const selection=ensureGraphSelectionController(),stored=snapshot.selection||snapshot;
  if(selection){selection.restore(stored,{node:id=>!!id&&nodeIds.has(id),link:id=>!!id&&linkIds.has(id)});state.selectedElementId=elementIds.has(stored.selectedElementId)?stored.selectedElementId:null;selectedTextElementIds=new Set((stored.selectedTextElementIds||[]).filter(id=>elementIds.has(id)))}
  else{
    state.selectedNodeId=nodeIds.has(stored.selectedNodeId)?stored.selectedNodeId:null;
    state.selectedLinkId=linkIds.has(stored.selectedLinkId)?stored.selectedLinkId:null;
    state.linkSourceId=nodeIds.has(stored.linkSourceId)?stored.linkSourceId:null;
    state.selectedElementId=elementIds.has(stored.selectedElementId)?stored.selectedElementId:null;
    selectedNodeIds=new Set((stored.selectedNodeIds||[]).filter(id=>nodeIds.has(id)));
    selectedLinkIds=new Set((stored.selectedLinkIds||[]).filter(id=>linkIds.has(id)));
    selectedTextElementIds=new Set((stored.selectedTextElementIds||[]).filter(id=>elementIds.has(id)));
  }
  if(relatedScopeAnchorNodeId&&!nodeIds.has(relatedScopeAnchorNodeId))relatedScopeAnchorNodeId=null;
  invalidateGraphSearchIndex();
  render({persist:true});
  return true;
}
function ensureGraphHistoryController(){
  if(graphKernelControllers.history)return graphKernelControllers.history;
  const factory=window.KGGraphHistoryController;
  if(!factory||typeof factory.create!=='function')return null;
  graphKernelControllers.history=factory.create({limit:GRAPH_UNDO_LIMIT,capture:graphUndoSnapshot,restore:applyGraphHistorySnapshot});
  return graphKernelControllers.history;
}
function resetGraphHistory(){const history=ensureGraphHistoryController();history?.clear?.();graphKernelControllers.clipboard?.clear?.();graphClipboardNodes=null;graphClipboardTextElement=null;return true}
window.resetGraphHistory=resetGraphHistory;
function pushGraphUndoSnapshot(label='操作'){
  const history=ensureGraphHistoryController();
  return history?history.checkpoint(label):false;
}
function restoreGraphUndoSnapshot(){
  const history=ensureGraphHistoryController(),item=history&&history.undo();
  if(!item){showStatus('暂无可撤销的操作。');return true}
  showStatus(`已撤销：${item.label}。可按 Ctrl/Command+Shift+Z 恢复。`);
  return true;
}
function restoreGraphRedoSnapshot(){
  const history=ensureGraphHistoryController(),item=history&&history.redo();
  if(!item){showStatus('暂无可恢复的操作。');return true}
  showStatus(`已恢复：${item.label}。`);
  return true;
}
function redoGraphUndoSnapshot(){return restoreGraphRedoSnapshot()}
function selectedNodeIdsForClipboard(){
  const rawIds=selectedNodeIds&&selectedNodeIds.size?[...selectedNodeIds]:(state.selectedNodeId?[state.selectedNodeId]:[]);
  const idSet=new Set(rawIds.filter(id=>nodeById(id)));
  return state.nodes.filter(n=>idSet.has(n.id)).map(n=>n.id);
}
function copySelectedGraphCards(){
  const textItem=state.selectedElementId?textElementById(state.selectedElementId):null;
  if(!textItem&&rejectLockedNodeAction('复制'))return false;
  if(textItem){graphClipboardTextElement=cloneGraphValue(textItem);graphClipboardNodes=null;showStatus('已复制文本框，将鼠标移到目标位置后按 Ctrl+V 粘贴。');return true}
  const ids=selectedNodeIdsForClipboard();
  if(!ids.length){showStatus('请先选择要复制的卡牌或文本框。');return false}
  graphClipboardTextElement=null;
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
      h:d.h,
      content:window.KGGraphModel&&window.KGGraphModel.contentOf?window.KGGraphModel.contentOf(n):null,
      appearance:window.KGGraphModel&&window.KGGraphModel.appearanceOf?window.KGGraphModel.appearanceOf(n):null,
      geometry:window.KGGraphModel&&window.KGGraphModel.geometryOf?window.KGGraphModel.geometryOf(n):null,
      cardStyle:n.cardStyle||'standard',
      textAlign:n.textAlign||'center'
    };
  });
  const clipboard=ensureGraphClipboardController();if(clipboard)clipboard.write(graphClipboardNodes);
  showStatus(`已复制 ${graphClipboardNodes.length} 张卡牌。将鼠标移到目标位置后按 Ctrl+V 粘贴。`);
  return true;
}
function graphClipboardBounds(nodes){const clipboard=ensureGraphClipboardController();if(clipboard)return clipboard.bounds(nodes);let minX=Infinity,minY=Infinity,maxX=-Infinity,maxY=-Infinity;nodes.forEach(n=>{minX=Math.min(minX,n.x);minY=Math.min(minY,n.y);maxX=Math.max(maxX,n.x+(n.w||CARD_W));maxY=Math.max(maxY,n.y+(n.h||CARD_H))});if(!Number.isFinite(minX))return{x:0,y:0,w:0,h:0,cx:0,cy:0};return{x:minX,y:minY,w:maxX-minX,h:maxY-minY,cx:(minX+maxX)/2,cy:(minY+maxY)/2}}
function currentPasteWorldPoint(){
  if(lastGraphPointerWorldPosition)return{...lastGraphPointerWorldPosition};
  const r=stage.getBoundingClientRect();
  return screenToWorld(r.left+r.width/2,r.top+r.height/2);
}
function pasteGraphClipboardCards(){
  if(graphClipboardTextElement){
    const model=window.KGGraphModel,target=currentPasteWorldPoint(),source=graphClipboardTextElement,geometry=model.textElementGeometryOf(source),copy=model.normalizeTextElement(cloneGraphValue(source),{idFactory:()=>uid('t')});copy.id=uid('t');
    model.updateTextElementGeometry(copy,{x:Math.round(target.x-geometry.width/2),y:Math.round(target.y-geometry.height/2)});pushGraphUndoSnapshot('粘贴文本框');state.elements.push(copy);clearMultiSelection();state.selectedElementId=copy.id;state.selectedNodeId=null;state.selectedLinkId=null;state.linkSourceId=null;render({persist:true});showStatus('已粘贴文本框。');return true;
  }
  const clipboard=ensureGraphClipboardController(),source=clipboard&&clipboard.hasData()?clipboard.read():(Array.isArray(graphClipboardNodes)?graphClipboardNodes:[]);
  if(!source.length){showStatus('剪贴板中还没有已复制的卡牌或文本框。');return false}
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
    n.highlightTerms=item.highlightTerms||item.content&&item.content.highlightTerms||'';
    if(window.KGGraphModel){
      window.KGGraphModel.updateContent(n,item.content||{description:item.summary||'',highlightTerms:n.highlightTerms});
      window.KGGraphModel.updateAppearance(n,item.appearance||{cardStyle:item.cardStyle||'standard',textAlign:item.textAlign||'center',color:item.color,size:item.size});
      window.KGGraphModel.updateGeometry(n,{x:n.x,y:n.y,width:item.w||item.geometry&&item.geometry.width,height:item.h||item.geometry&&item.geometry.height});
    }
    state.nodes.push(n);
    created.push(n.id);
  });
  selectedNodeIds=new Set(created);
  selectedLinkIds.clear();
  state.selectedElementId=null;
  state.selectedNodeId=created[0]||null;
  state.selectedLinkId=null;
  state.linkSourceId=null;
  render({persist:true});
  showStatus(`已粘贴 ${created.length} 张卡牌。`);
  return true;
}
function toggleCardMultiSelection(id){
  if(!graphModeAllows('multiSelect')){handleNodeTap(id);return}
  window.KGHomeCanvasRuntime?.selectionFilter?.clear?.({reason:'direct-node-toggle',apply:false});
  state.selectedElementId=null;
  const n=nodeById(id);if(!n)return;
  clearHoverDetail(false);
  const controller=ensureGraphSelectionController();if(controller)controller.toggleNode(id);else{state.selectedLinkId=null;selectedLinkIds.clear();state.linkSourceId=null;if(state.selectedNodeId&&state.selectedNodeId!==id&&!selectedNodeIds.size)selectedNodeIds.add(state.selectedNodeId);if(state.selectedNodeId===id&&!selectedNodeIds.size)selectedNodeIds.add(id);if(selectedNodeIds.has(id))selectedNodeIds.delete(id);else selectedNodeIds.add(id);state.selectedNodeId=selectedNodeIds.size?[...selectedNodeIds][0]:null}
  showStatus(selectedNodeIds.size?`已选择 ${selectedNodeIds.size} 张卡牌。Ctrl+点击可继续增减选择。`:`已取消选择“${n.title}”。`);
  refreshSelectionUI();
}
function screenRectForBox(a,b){
  const left=Math.min(a.x,b.x),top=Math.min(a.y,b.y),width=Math.abs(a.x-b.x),height=Math.abs(a.y-b.y);
  return{left,top,width,height,right:left+width,bottom:top+height};
}
function worldRectFromScreenRect(rect){
  const scale=Math.max(.0001,Number(state.viewport.scale)||1);
  const p1={x:(Number(rect.left)-Number(state.viewport.x||0))/scale,y:(Number(rect.top)-Number(state.viewport.y||0))/scale};
  const p2={x:(Number(rect.right)-Number(state.viewport.x||0))/scale,y:(Number(rect.bottom)-Number(state.viewport.y||0))/scale};
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
function textElementWorldRect(item){
  const geometry=window.KGGraphModel?.textElementGeometryOf?.(item)||item||{};
  const left=Number(geometry.x)||0,top=Number(geometry.y)||0,width=Math.max(1,Number(geometry.width)||220),height=Math.max(1,Number(geometry.height)||72);
  return{left,top,right:left+width,bottom:top+height,width,height};
}
function textElementIdsInsideWorldRect(rect){
  return (state.elements||[]).filter(item=>item&&rectsOverlap(textElementWorldRect(item),rect)).map(item=>String(item.id));
}
// Compatibility note: the former createPathIndex SVG-DOM path cache is replaced by createPolylineIndex.
function linkIdsInsideWorldRect(rect,index=null){
  const geometry=window.KGCanvasEdgeSelectionGeometry;if(!geometry?.collectPolylineIds)return[];
  const entries=[];edgeDomById.forEach((dom,id)=>{if(dom?.geometry?.samples?.length)entries.push({id,points:dom.geometry.samples,bounds:dom.geometry.bounds})});
  return geometry.collectPolylineIds(entries,rect,{index});
}
function refreshEdgeSelectionClasses(options={}){
  const next=selectedEdgeIdSet(),changed=new Set([...edgeSelectionPaintedIds,...next]);
  for(const id of changed){
    const dom=edgeDomById.get(String(id));if(!dom)continue;const selected=next.has(String(id)),batch=selectedLinkIds.has(String(id));
    dom.g?.classList.toggle('is-batch-selected',batch);dom.hit?.classList.toggle('selected',selected);dom.hit?.classList.toggle('batch-selected',batch);dom.label?.classList.toggle('edge-selected-label',selected);
    if(selected)createEdgeSelectionOverlay(id);else removeEdgeSelectionOverlay(id);
  }
  edgeSelectionPaintedIds=next;if(hoveredEdgeId)showEdgeHoverFeedback(hoveredEdgeId);renderSelectedEdgeControls();
  if(options.renderPanel!==false){if(!selectedEditableLinkIds().length||selectedNodeIds.size||selectedTextElementIds.size)hideSelectedEdgeQuickStylePanel();else renderSelectedEdgeQuickStylePanel()}
}
function selectedLinkCount(){return [...selectedLinkIds].filter(id=>linkById(id)).length}

let homeSelectionBoundsDrag=null,homeSelectionDismissGesture=null;
function currentHomeFilteredSelectionTotal(){return selectedNodeIds.size+selectedTextElementIds.size+selectedLinkIds.size}
function hasLockedHomeSelectionBounds(){return graphModeAllows('selectionBoundsMove')&&currentHomeFilteredSelectionTotal()>=2&&!!window.KGHomeCanvasRuntime?.selectionFilter?.hasSnapshot?.()&&!document.body.classList.contains('auth-readonly')&&!isCoarse}
function pointerInsideHomeSelectionBounds(event){
  if(currentHomeFilteredSelectionTotal()<2)return false;
  const rect=homeSelectionAnchorRect();if(!rect)return false;const tolerance=3;
  return Number(event.clientX)>=rect.left-tolerance&&Number(event.clientX)<=rect.right+tolerance&&Number(event.clientY)>=rect.top-tolerance&&Number(event.clientY)<=rect.bottom+tolerance;
}
function syncHomeSelectionInteractionLock(){
  const locked=hasLockedHomeSelectionBounds();stage.classList.toggle('home-selection-interaction-locked',locked);
  if(!locked)stage.classList.remove('home-selection-bounds-dragging');
  const bounds=stage.querySelector('.uc-selection-bounds');if(bounds){bounds.dataset.homeSelectionLocked=locked?'1':'0';bounds.setAttribute('aria-hidden',locked?'false':'true')}
  return locked;
}
function isHomeSelectionLockControlTarget(target){return !!target?.closest?.('[data-stage-ui],[data-canvas-ui],.node-style-toolbar,.uc-floating-toolbar,.uc-selection-filter-wrap,.uc-selection-filter,.graph-context-menu,.edge-inline-label-editor,.canvas-toolbar-left,.canvas-toolbar-right,#detailPanel,#floatingToolbox,#canvasZoomDock')}
function canStartHomeReboxFromTarget(target){return !target?.closest?.('.knowledge-card,.graph-text-element,[data-link-id],.edge-hit,.edge-visible,button,a,input,textarea,select,[contenteditable="true"]')}
function dismissLockedHomeSelection(reason='selection-dismiss'){window.KGHomeCanvasRuntime?.selectionFilter?.clear?.({reason,apply:false});clearSelection({reason,preserveFilter:true});syncHomeSelectionInteractionLock();return true}
function selectedHomeMovableIds(){
  return {nodes:[...selectedNodeIds].filter(id=>nodeById(id)),texts:[...selectedTextElementIds].filter(id=>textElementById(id))};
}
function beginHomeSelectionBoundsDrag(event){
  if(event.button!==0||isCanvasPanMode()||!pointerInsideHomeSelectionBounds(event))return false;
  if(event.ctrlKey||event.metaKey||event.shiftKey)return false;
  const ids=selectedHomeMovableIds(),total=ids.nodes.length+ids.texts.length;if(total<2)return false;
  const locked=ids.nodes.filter(id=>window.KGGraphModel?.interactionOf?.(nodeById(id))?.locked);if(locked.length){showStatus(`选择中有 ${locked.length} 个锁定节点，已取消整体移动。`);return false}
  const nodeOrigins=Object.fromEntries(ids.nodes.map(id=>{const node=nodeById(id);return[id,{x:Number(node.x)||0,y:Number(node.y)||0}]}));
  const textOrigins=Object.fromEntries(ids.texts.map(id=>{const item=textElementById(id),g=window.KGGraphModel?.textElementGeometryOf?.(item)||item;return[id,{x:Number(g.x)||0,y:Number(g.y)||0}]}));
  homeSelectionBoundsDrag={pointerId:event.pointerId,startX:event.clientX,startY:event.clientY,nodeIds:ids.nodes,textIds:ids.texts,nodeOrigins,textOrigins,moved:false,history:false,frame:0,pending:null,anchorRect:homeSelectionAnchorRect()};
  try{stage.setPointerCapture(event.pointerId)}catch(error){}
  stage.classList.add('home-selection-bounds-dragging','graph-card-dragging');nodeStyleToolbarController?.hide?.();hideSelectedEdgeQuickStylePanel();window.KGHomeCanvasRuntime?.alignment?.clearGuides?.();
  event.preventDefault();event.stopPropagation();event.stopImmediatePropagation();return true;
}
function applyHomeSelectionBoundsMove(point){
  const drag=homeSelectionBoundsDrag;if(!drag||drag.pointerId!==point.pointerId)return false;
  const dx=(point.clientX-drag.startX)/Math.max(.0001,Number(state.viewport.scale)||1),dy=(point.clientY-drag.startY)/Math.max(.0001,Number(state.viewport.scale)||1);
  if(Math.hypot(point.clientX-drag.startX,point.clientY-drag.startY)>4&&!drag.moved){drag.moved=true;if(!drag.history){pushGraphUndoSnapshot(`移动 ${drag.nodeIds.length+drag.textIds.length} 个图元`);drag.history=true}ensureHomeEdgeDragPerformanceController()?.start?.(drag.nodeIds)}
  if(!drag.moved)return false;
  for(const id of drag.nodeIds){const node=nodeById(id),origin=drag.nodeOrigins[id];if(!node||!origin)continue;window.KGGraphModel?.updateGeometry?.(node,{x:Math.round(origin.x+dx),y:Math.round(origin.y+dy)});const el=cardElementByNodeId(id);if(el){el.style.left=node.x+'px';el.style.top=node.y+'px'}}
  for(const id of drag.textIds){const item=textElementById(id),origin=drag.textOrigins[id];if(!item||!origin)continue;window.KGGraphModel?.updateTextElementGeometry?.(item,{x:Math.round(origin.x+dx),y:Math.round(origin.y+dy)});const el=textElementDomByIdValue(id);if(el){el.style.left=item.x+'px';el.style.top=item.y+'px'}}
  ensureHomeEdgeDragPerformanceController()?.schedule?.(drag.nodeIds);
  if(drag.anchorRect){
    const screenDx=point.clientX-drag.startX,screenDy=point.clientY-drag.startY,rect=drag.anchorRect;
    window.KGHomeCanvasRuntime?.selectionFilter?.refreshPosition?.({left:rect.left+screenDx,top:rect.top+screenDy,right:rect.right+screenDx,bottom:rect.bottom+screenDy,width:rect.width,height:rect.height});
  }
  return true;
}
function moveHomeSelectionBoundsDrag(event){
  const drag=homeSelectionBoundsDrag;if(!drag||drag.pointerId!==event.pointerId)return false;drag.pending={pointerId:event.pointerId,clientX:event.clientX,clientY:event.clientY};
  if(!drag.frame)drag.frame=requestAnimationFrame(()=>{if(!homeSelectionBoundsDrag)return;homeSelectionBoundsDrag.frame=0;const point=homeSelectionBoundsDrag.pending;homeSelectionBoundsDrag.pending=null;if(point)applyHomeSelectionBoundsMove(point)});
  event.preventDefault();event.stopPropagation();event.stopImmediatePropagation();return true;
}
function finishHomeSelectionBoundsDrag(event,cancelled=false){
  const drag=homeSelectionBoundsDrag;if(!drag||drag.pointerId!==event.pointerId)return false;
  if(drag.frame){cancelAnimationFrame(drag.frame);drag.frame=0}if(drag.pending&&!cancelled)applyHomeSelectionBoundsMove(drag.pending);homeSelectionBoundsDrag=null;
  try{stage.releasePointerCapture(event.pointerId)}catch(error){}stage.classList.remove('home-selection-bounds-dragging','graph-card-dragging');ensureHomeEdgeDragPerformanceController()?.stop?.(drag.nodeIds);
  if(cancelled&&drag.moved){for(const id of drag.nodeIds){const node=nodeById(id),origin=drag.nodeOrigins[id];if(node&&origin)window.KGGraphModel?.updateGeometry?.(node,origin)}for(const id of drag.textIds){const item=textElementById(id),origin=drag.textOrigins[id];if(item&&origin)window.KGGraphModel?.updateTextElementGeometry?.(item,origin)}render();showStatus('已取消整体移动。')}
  else if(!drag.moved)dismissLockedHomeSelection('selection-click-dismiss');
  else{save();refreshSelectionUI();requestAnimationFrame(()=>window.KGHomeCanvasRuntime?.selectionFilter?.refreshPosition?.(homeSelectionAnchorRect()));showStatus(`已整体移动 ${drag.nodeIds.length+drag.textIds.length} 个图元，并恢复完整关系线。`)}
  event.preventDefault();event.stopPropagation();event.stopImmediatePropagation();return true;
}
function beginLockedHomeSelectionPointer(event){
  if(!graphModeAllows('selectionBoundsMove')||!hasLockedHomeSelectionBounds()||isHomeSelectionLockControlTarget(event.target)||event.button!==0)return false;
  if(pointerInsideHomeSelectionBounds(event)&&beginHomeSelectionBoundsDrag(event))return true;
  if(!pointerInsideHomeSelectionBounds(event)&&canStartHomeReboxFromTarget(event.target)){startBoxSelection(event);event.stopImmediatePropagation();return true}
  homeSelectionDismissGesture={pointerId:event.pointerId};try{stage.setPointerCapture(event.pointerId)}catch(error){}
  event.preventDefault();event.stopPropagation();event.stopImmediatePropagation();return true;
}
function finishLockedHomeSelectionDismiss(event,cancelled=false){
  if(!homeSelectionDismissGesture||homeSelectionDismissGesture.pointerId!==event.pointerId)return false;homeSelectionDismissGesture=null;try{stage.releasePointerCapture(event.pointerId)}catch(error){}
  if(!cancelled)dismissLockedHomeSelection('selection-click-dismiss');event.preventDefault();event.stopPropagation();event.stopImmediatePropagation();return true;
}
function startBoxSelection(e){
  if(!graphModeAllows('boxSelect'))return false;
  window.KGHomeCanvasRuntime?.selectionFilter?.clear?.({reason:'rebox',apply:false});
  state.selectedElementId=null;
  clearHoverDetail(false);
  const geometry=window.KGCanvasEdgeSelectionGeometry,entries=[];
  edgeDomById.forEach((dom,id)=>{if(dom?.geometry?.samples?.length)entries.push({id,points:dom.geometry.samples,bounds:dom.geometry.bounds})});
  boxSelect={
    pointerId:e.pointerId,
    start:{x:e.clientX,y:e.clientY},
    last:{x:e.clientX,y:e.clientY},
    moved:false,
    additive:!!(e.ctrlKey||e.metaKey||e.shiftKey),
    baseNodeIds:new Set(selectedNodeIds),
    baseLinkIds:new Set(selectedLinkIds),
    baseTextElementIds:new Set(selectedTextElementIds),
    edgeIndex:geometry?.createPolylineIndex?.(entries,{cellSize:360})||null
  };
  try{stage.setPointerCapture(e.pointerId)}catch{}
  const r=stage.getBoundingClientRect();
  updateSelectionBoxVisual({left:e.clientX-r.left,top:e.clientY-r.top,width:0,height:0,right:e.clientX-r.left,bottom:e.clientY-r.top});
  hideSelectedEdgeQuickStylePanel();hideEdgeInlineLabelEditor();
  nodeStyleToolbarController?.hide();stage.classList.add('graph-box-selecting');
  stage.classList.remove('panning');
  e.preventDefault();
  e.stopPropagation();
}
function refreshBoxSelectionElementClasses(previousNodes,previousText){
  const nodeIds=new Set([...(previousNodes||[]),...selectedNodeIds]);for(const id of nodeIds){const card=cardElementByNodeId(id);if(!card)continue;card.classList.toggle('multi-selected',selectedNodeIds.has(id));card.classList.toggle('active',state.selectedNodeId===id)}
  const multiTotal=selectedNodeIds.size+selectedTextElementIds.size+selectedLinkIds.size;
  const textIds=new Set([...(previousText||[]),...selectedTextElementIds]);for(const id of textIds){const element=textElementDomByIdValue(id);if(!element)continue;const selected=state.selectedElementId===id||selectedTextElementIds.has(id);element.classList.toggle('active',selected);element.classList.toggle('multi-selected',selected&&multiTotal>1)}
  updateCardQuickActions();updateNodeGrowthHandles();
}
function applyBoxSelectionMove(point){
  if(!boxSelect||boxSelect.pointerId!==point.pointerId)return;
  const r=stage.getBoundingClientRect(),previousNodes=new Set(selectedNodeIds),previousText=new Set(selectedTextElementIds);boxSelect.last={x:point.clientX,y:point.clientY};
  if(Math.hypot(point.clientX-boxSelect.start.x,point.clientY-boxSelect.start.y)>4)boxSelect.moved=true;
  const rect=screenRectForBox({x:boxSelect.start.x-r.left,y:boxSelect.start.y-r.top},{x:point.clientX-r.left,y:point.clientY-r.top});updateSelectionBoxVisual(rect);
  const worldRect=worldRectFromScreenRect(rect),nodeHits=idsInsideWorldRect(worldRect),textHits=textElementIdsInsideWorldRect(worldRect),linkHits=linkIdsInsideWorldRect(worldRect,boxSelect.edgeIndex);
  selectedNodeIds=boxSelect.additive?new Set([...boxSelect.baseNodeIds,...nodeHits]):new Set(nodeHits);selectedTextElementIds=boxSelect.additive?new Set([...boxSelect.baseTextElementIds,...textHits]):new Set(textHits);selectedLinkIds=boxSelect.additive?new Set([...boxSelect.baseLinkIds,...linkHits]):new Set(linkHits);
  state.selectedNodeId=selectedNodeIds.values().next().value||null;state.selectedElementId=!selectedNodeIds.size?(selectedTextElementIds.values().next().value||null):null;state.selectedLinkId=!selectedNodeIds.size&&!selectedTextElementIds.size&&selectedLinkIds.size===1?selectedLinkIds.values().next().value:null;state.linkSourceId=null;
  refreshBoxSelectionElementClasses(previousNodes,previousText);refreshEdgeSelectionClasses({renderPanel:false});
}
function moveBoxSelection(e){
  if(!boxSelect||boxSelect.pointerId!==e.pointerId)return;boxSelect.pendingPoint={pointerId:e.pointerId,clientX:e.clientX,clientY:e.clientY};
  if(!boxSelect.frame)boxSelect.frame=requestAnimationFrame(()=>{if(!boxSelect)return;boxSelect.frame=0;const point=boxSelect.pendingPoint;boxSelect.pendingPoint=null;if(point)applyBoxSelectionMove(point)});
  e.preventDefault();e.stopPropagation();
}
function finishBoxSelection(e,cancelled=false){
  if(!boxSelect||boxSelect.pointerId!==e.pointerId)return;
  if(boxSelect.frame){cancelAnimationFrame(boxSelect.frame);boxSelect.frame=0}if(boxSelect.pendingPoint&&!cancelled){const point=boxSelect.pendingPoint;boxSelect.pendingPoint=null;applyBoxSelectionMove(point)}
  const moved=!!boxSelect.moved,original=boxSelect;
  boxSelect=null;
  try{stage.releasePointerCapture(e.pointerId)}catch{}
  hideSelectionBox();stage.classList.remove('graph-box-selecting');
  if(cancelled){
    selectedNodeIds=new Set(original.baseNodeIds);
    selectedLinkIds=new Set(original.baseLinkIds);
    selectedTextElementIds=new Set(original.baseTextElementIds);
    state.selectedNodeId=selectedNodeIds.values().next().value||null;
    state.selectedElementId=!selectedNodeIds.size?(selectedTextElementIds.values().next().value||null):null;
    state.selectedLinkId=!selectedNodeIds.size&&!selectedTextElementIds.size&&selectedLinkIds.size===1?selectedLinkIds.values().next().value:null;
    window.KGHomeCanvasRuntime?.selectionFilter?.clear?.({reason:'box-cancel',apply:false});
    refreshSelectionUI();
    return;
  }
  if(!moved){
    if(!original.additive)clearSelection({reason:'blank'});
    showStatus(original.additive?'已保留当前选择。':'已关闭详情。');
  }else{
    const candidates=[];
    selectedNodeIds.forEach(id=>{if(nodeById(id))candidates.push({id:String(id),type:'node'})});
    selectedTextElementIds.forEach(id=>{if(textElementById(id))candidates.push({id:String(id),type:'text-element'})});
    selectedLinkIds.forEach(id=>{if(linkById(id))candidates.push({id:String(id),type:'edge'})});
    if(candidates.length){
      const preferred=candidates.some(item=>item.type==='node')?'node':candidates.some(item=>item.type==='text-element')?'text-element':'edge';
      const categories=new Set(candidates.map(item=>item.type));
      const filterController=window.KGHomeCanvasRuntime?.selectionFilter;
      if(filterController?.setSnapshot)filterController.setSnapshot(candidates,{preferredType:preferred,anchorRect:homeSelectionAnchorRect(),reason:'box-complete'});
      else refreshSelectionUI();
      const counts={node:candidates.filter(item=>item.type==='node').length,'text-element':candidates.filter(item=>item.type==='text-element').length,edge:candidates.filter(item=>item.type==='edge').length};
      if(categories.size>1)showStatus('已框选全部图元；可在“多选”菜单中只保留一种类型。');
      else if(counts.node)showStatus(`已框选 ${counts.node} 个知识点。`);
      else if(counts['text-element'])showStatus(`已框选 ${counts['text-element']} 个文本框。`);
      else showStatus(`已框选 ${counts.edge} 条关系线，可批量修改样式。`);
    }else{
      clearSelection({reason:'empty-box'});
      showStatus('框选区域内没有知识点、文本框或关系线。');
    }
  }
  e.preventDefault();
  e.stopPropagation();
}
function cardElementByNodeId(id){return cardDomById.get(id)||null}
function textElementById(id){return (state.elements||[]).find(item=>item&&item.id===id)||null}
function textElementDomByIdValue(id){return textElementDomById.get(id)||null}

function cardRelationState(){const relationState=largeGraphRelationState();return relationLayerEnabled()?relationState:null}
function classForCard(n,relationState=null){
  const appearance=window.KGGraphModel&&window.KGGraphModel.appearanceOf?window.KGGraphModel.appearanceOf(n):{size:n.size||'',cardStyle:n.cardStyle||'standard'};
  const sizeClass=appearance.size==='small'?' size-small':appearance.size==='big'?' size-big':'';
  const styleClass=' card-style-'+(appearance.cardStyle||'standard');
  let cls='knowledge-card'+sizeClass+styleClass+(state.selectedNodeId===n.id?' active':'')+(selectedNodeIds.has(n.id)?' multi-selected':'')+(state.linkSourceId===n.id?' link-source':'')+(isImportant(n)?' focus-card':'')+(nodeFreeResizeModeId===n.id?' node-free-resize-mode':'')+(window.KGGraphModel?.interactionOf?.(n).locked?' node-locked':'');
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
function graphHexToRgba(hex,opacity=1){
  const value=safeColor(hex,'#ffffff'),n=parseInt(value.slice(1),16),a=Math.max(0,Math.min(1,Number(opacity)));
  return `rgba(${(n>>16)&255},${(n>>8)&255},${n&255},${Number.isFinite(a)?a:1})`;
}
function graphTextColorForFill(hex,opacity=1){
  if(Number(opacity)<.18)return '#0f172a';
  const value=safeColor(hex,'#ffffff'),n=parseInt(value.slice(1),16),r=(n>>16)&255,g=(n>>8)&255,b=n&255;
  return (r*.299+g*.587+b*.114)<150?'#ffffff':'#0f172a';
}
const GRAPH_FONT_FAMILY_STACKS=Object.freeze({
  system:'ui-sans-serif,system-ui,-apple-system,"Segoe UI","Microsoft YaHei",sans-serif',
  sans:'"Microsoft YaHei","PingFang SC","Noto Sans CJK SC",Arial,sans-serif',
  serif:'"Songti SC","SimSun","Noto Serif CJK SC",Georgia,serif',
  kai:'"Kaiti SC","KaiTi","STKaiti",serif',
  mono:'ui-monospace,SFMono-Regular,Consolas,"Liberation Mono",monospace'
});
const GRAPH_LEGACY_FONT_SIZES=Object.freeze({small:13,medium:15,large:20,xlarge:26});
function graphFontSizeNumber(value,fallback=15){
  const model=window.KGGraphModel;
  if(model&&typeof model.fontSizeValue==='function')return model.fontSizeValue(value,fallback);
  if(typeof value==='string'&&Object.prototype.hasOwnProperty.call(GRAPH_LEGACY_FONT_SIZES,value))return GRAPH_LEGACY_FONT_SIZES[value];
  const n=Number(value);return Math.max(6,Math.min(288,Number.isFinite(n)?n:fallback));
}
function graphFontSizeCss(value,fallback=15){return `${graphFontSizeNumber(value,fallback)}px`}
function graphFontFamilyCss(value){return GRAPH_FONT_FAMILY_STACKS[value]||GRAPH_FONT_FAMILY_STACKS.system}
function graphFontWeightCss(value,entity='node'){return value==='normal'?'400':entity==='text'?'700':'800'}
function graphTextDecorationCss(appearance={}){
  const values=[];if(appearance.underline)values.push('underline');if(appearance.strikeThrough)values.push('line-through');return values.length?values.join(' '):'none';
}
function graphLineHeightCss(value,fallback=1.25){const n=Number(value);return String(Math.max(.8,Math.min(3,Number.isFinite(n)?n:fallback)))}
function graphLegacyLetterSpacingCss(){return 'normal'}

const GRAPH_RESIZE_HANDLES=['nw','n','ne','e','se','s','sw','w'];
function graphResizeHandlesMarkup(entity='text'){
  const attr=entity==='node'?'data-node-resize-handle':'data-element-resize-handle';
  return `<div class="graph-element-resize-layer graph-${entity}-resize-layer" aria-hidden="true">${GRAPH_RESIZE_HANDLES.map(handle=>`<span class="graph-element-resize-handle handle-${handle}" ${attr}="${handle}"></span>`).join('')}</div>`;
}
function renderCardElement(n,relationState=null){
  const model=window.KGGraphModel,view=model&&model.view?model.view(n):{content:{title:n.title||'未命名知识点'},appearance:{color:n.color||DEFAULTS.nodeColor,headerIconColor:n.headerIconColor||n.color||DEFAULTS.nodeColor,fillColor:n.fillColor||'#ffffff',fillOpacity:n.fillOpacity??1,headerFillColor:n.headerFillColor||'#eef2ff',bodyFillColor:n.bodyFillColor||n.fillColor||'#ffffff',headerTextColor:n.headerTextColor||'#ffffff',bodyTextColor:n.bodyTextColor||n.textColor||'#0f172a',regionColorsCustomized:!!n.regionColorsCustomized,borderVisible:n.borderVisible!==false,borderColor:n.borderColor||'#cbd5e1',borderWidth:n.borderWidth??1,borderStyle:n.borderStyle||'solid',borderOpacity:n.borderOpacity??1,textColor:n.textColor||'#0f172a',textBackgroundColor:n.textBackgroundColor||'#ffffff',textBackgroundOpacity:n.textBackgroundOpacity??0,cardStyle:n.cardStyle||'standard',textAlign:n.textAlign||'center',fontSize:n.fontSize||15,fontFamily:n.fontFamily||'system',fontWeight:n.fontWeight||'bold',fontStyle:n.fontStyle||'normal',underline:!!n.underline,strikeThrough:!!n.strikeThrough,lineHeight:n.lineHeight||1.25},geometry:{...visualPositionForNode(n),width:nodeDims(n).w,height:nodeDims(n).h},interaction:{locked:!!n.locked}};
  const card=document.createElement('div'),appearance=view.appearance||{},accent=safeColor(appearance.headerIconColor||appearance.color||DEFAULTS.nodeColor),fill=safeColor(appearance.fillColor||'#ffffff'),border=safeColor(appearance.borderColor||'#cbd5e1'),pos=visualPositionForNode(n),dims=nodeDims(n);
  const rawFillOpacity=Number(appearance.fillOpacity),rawBorderOpacity=Number(appearance.borderOpacity),rawBorderWidth=Number(appearance.borderWidth),fillOpacity=Math.max(0,Math.min(1,Number.isFinite(rawFillOpacity)?rawFillOpacity:1)),borderOpacity=Math.max(0,Math.min(1,Number.isFinite(rawBorderOpacity)?rawBorderOpacity:1)),borderWidth=appearance.borderVisible===false?0:Math.max(0,Math.min(8,Number.isFinite(rawBorderWidth)?rawBorderWidth:1));
  const textBg=safeColor(appearance.textBackgroundColor||'#ffffff','#ffffff'),textBgOpacity=Math.max(0,Math.min(1,Number(appearance.textBackgroundOpacity)||0));
  const headerFill=safeColor(appearance.headerFillColor||fill,fill),bodyFill=safeColor(appearance.bodyFillColor||fill,fill);
  const headerText=graphTextColorForFill(accent,1),bodyText=safeColor(appearance.bodyTextColor||appearance.textColor||'#0f172a','#0f172a');
  const headerBackground='linear-gradient(180deg,#f8fafc 0%,#eef2ff 100%)';
  card.className=classForCard(n,relationState);
  card.style.left=pos.x+'px';card.style.top=pos.y+'px';
  card.style.setProperty('--node-color',accent);
  card.style.setProperty('--node-fill-color',graphHexToRgba(fill,fillOpacity));
  card.style.setProperty('--node-header-fill-color',graphHexToRgba(headerFill,fillOpacity));
  card.style.setProperty('--node-body-fill-color',graphHexToRgba(bodyFill,fillOpacity));
  card.style.setProperty('--node-header-text-color',headerText);
  card.style.setProperty('--node-body-text-color',bodyText);
  card.style.setProperty('--node-border-color',graphHexToRgba(border,borderOpacity));
  card.style.setProperty('--node-border-width',borderWidth+'px');
  card.style.setProperty('--node-border-style',appearance.borderStyle||'solid');
  card.style.setProperty('--node-text-color',safeColor(appearance.textColor||graphTextColorForFill(fill,fillOpacity),'#0f172a'));
  card.style.setProperty('--node-text-background',graphHexToRgba(textBg,textBgOpacity));
  card.style.setProperty('--card-w',dims.w+'px');card.style.setProperty('--card-h',dims.h+'px');
  card.style.setProperty('--node-text-align',appearance.textAlign||'center');
  card.style.setProperty('--node-title-justify',appearance.textAlign==='left'?'flex-start':appearance.textAlign==='right'?'flex-end':'center');
  card.style.setProperty('--node-font-size',graphFontSizeCss(appearance.fontSize,15));
  card.style.setProperty('--node-font-family',graphFontFamilyCss(appearance.fontFamily));
  card.style.setProperty('--node-font-weight',graphFontWeightCss(appearance.fontWeight,'node'));
  card.style.setProperty('--node-font-style',appearance.fontStyle==='italic'?'italic':'normal');
  card.style.setProperty('--node-text-decoration',graphTextDecorationCss(appearance));
  card.style.setProperty('--node-line-height',graphLineHeightCss(appearance.lineHeight,1.25));
  card.style.setProperty('--node-letter-spacing',graphLegacyLetterSpacingCss());
  card.dataset.nodeId=n.id;card.dataset.locked=view.interaction&&view.interaction.locked?'true':'false';card.dataset.cardStyle=appearance.cardStyle||'standard';card.dataset.fontSize=String(appearance.fontSize||15);
  const first=(view.content.title||'?').trim().slice(0,1);
  const title=`<span class="node-text-content">${escapeHTML(view.content.title||'未命名知识点')}</span>`;
  card.innerHTML=`<div class="card-body"><div class="node-top" style="background:${headerBackground}"><div class="node-icon" style="background:${accent};color:${headerText}">${escapeHTML(first)}</div></div><div class="node-title">${title}</div></div><div class="node-size-tools" aria-label="卡牌尺寸"><button type="button" class="node-size-btn" data-size="small" title="小卡">-</button><button type="button" class="node-size-btn" data-size="big" title="大卡">+</button><button type="button" class="node-size-btn" data-size="" title="默认尺寸">o</button></div>${graphResizeHandlesMarkup('node')}`;
  return card;
}
function applyTextElementTypographyVariables(el,appearance){
  const fontSize=graphFontSizeCss(appearance.fontSize,20),fontFamily=graphFontFamilyCss(appearance.fontFamily),fontWeight=graphFontWeightCss(appearance.fontWeight,'text'),textBg=safeColor(appearance.textBackgroundColor||'#ffffff','#ffffff'),textBgOpacity=Math.max(0,Math.min(1,Number(appearance.textBackgroundOpacity)||0));
  el.style.setProperty('--text-element-color',appearance.textColor);
  el.style.setProperty('--text-element-background',graphHexToRgba(textBg,textBgOpacity));
  el.style.setProperty('--text-element-align',appearance.textAlign);
  el.style.setProperty('--text-element-font-size',fontSize);
  el.style.setProperty('--text-element-font-family',fontFamily);
  el.style.setProperty('--text-element-font-weight',fontWeight);
  el.style.setProperty('--text-element-font-style',appearance.fontStyle==='italic'?'italic':'normal');
  el.style.setProperty('--text-element-text-decoration',graphTextDecorationCss(appearance));
  el.style.setProperty('--text-element-line-height',graphLineHeightCss(appearance.lineHeight,1.45));
  el.style.setProperty('--text-element-letter-spacing',graphLegacyLetterSpacingCss());
  el.style.setProperty('--node-text-color',appearance.textColor);
  el.style.setProperty('--node-text-background',graphHexToRgba(textBg,textBgOpacity));
  el.style.setProperty('--node-text-align',appearance.textAlign);
  el.style.setProperty('--node-font-size',fontSize);
  el.style.setProperty('--node-font-family',fontFamily);
  el.style.setProperty('--node-font-weight',fontWeight);
  el.style.setProperty('--node-font-style',appearance.fontStyle==='italic'?'italic':'normal');
  el.style.setProperty('--node-text-decoration',graphTextDecorationCss(appearance));
  el.style.setProperty('--node-line-height',graphLineHeightCss(appearance.lineHeight,1.45));
  el.style.setProperty('--node-letter-spacing',graphLegacyLetterSpacingCss());
}
function renderTextElement(item){
  const model=window.KGGraphModel,content=model&&model.textElementContentOf?model.textElementContentOf(item):{text:item.text||'点击编辑文字'},appearance=model&&model.textElementAppearanceOf?model.textElementAppearanceOf(item):{textColor:item.textColor||'#0f172a',textBackgroundColor:item.textBackgroundColor||'#ffffff',textBackgroundOpacity:item.textBackgroundOpacity??0,textAlign:item.textAlign||'center',fontSize:item.fontSize||20,fontFamily:item.fontFamily||'system',fontWeight:item.fontWeight||'bold',fontStyle:item.fontStyle||'normal',underline:!!item.underline,strikeThrough:!!item.strikeThrough,lineHeight:item.lineHeight||1.45},geometry=model&&model.textElementGeometryOf?model.textElementGeometryOf(item):{x:item.x||0,y:item.y||0,width:item.width||220,height:item.height||72,manualSize:!!item.manualSize};
  const selected=state.selectedElementId===item.id||selectedTextElementIds.has(item.id);
  const multiSelected=selected&&(selectedNodeIds.size+selectedTextElementIds.size+selectedLinkIds.size>1);
  const el=document.createElement('div');el.className='graph-text-element'+(selected?' active':'')+(multiSelected?' multi-selected':'');el.dataset.textElementId=item.id;el.dataset.manualSize=geometry.manualSize?'true':'false';el.style.left=geometry.x+'px';el.style.top=geometry.y+'px';el.style.width=geometry.width+'px';el.style.height=geometry.height+'px';applyTextElementTypographyVariables(el,appearance);el.innerHTML=`<div class="graph-text-element-content"><span class="graph-text-inline">${escapeHTML(content.text||'点击编辑文字')}</span></div>${graphResizeHandlesMarkup('text')}`;return el;
}
function measureTextElementTightSize(item){
  const model=window.KGGraphModel,content=model.textElementContentOf(item),appearance=model.textElementAppearanceOf(item);
  const probe=document.createElement('div');probe.className='graph-text-element-measure';probe.textContent=content.text||'点击编辑文字';
  probe.style.fontFamily=graphFontFamilyCss(appearance.fontFamily);probe.style.fontSize=graphFontSizeCss(appearance.fontSize,20);probe.style.fontWeight=graphFontWeightCss(appearance.fontWeight,'text');probe.style.fontStyle=appearance.fontStyle==='italic'?'italic':'normal';probe.style.textDecorationLine=graphTextDecorationCss(appearance);probe.style.letterSpacing='normal';probe.style.lineHeight=graphLineHeightCss(appearance.lineHeight,1.45);
  cardsLayer.appendChild(probe);const width=Math.max(24,Math.min(640,Math.ceil(probe.offsetWidth)+2)),height=Math.max(24,Math.ceil(probe.offsetHeight)+2);probe.remove();return{width,height};
}
function fitTextElementToContent(item,options={}){
  const model=window.KGGraphModel;if(!item||!model)return false;const geometry=model.textElementGeometryOf(item);if(geometry.manualSize&&!options.force)return false;
  const size=measureTextElementTightSize(item),preserveCenter=options.preserveCenter!==false;
  const x=preserveCenter?Math.round(geometry.x+(geometry.width-size.width)/2):geometry.x,y=preserveCenter?Math.round(geometry.y+(geometry.height-size.height)/2):geometry.y;
  model.updateTextElementGeometry(item,{x,y,width:size.width,height:size.height,manualSize:false});return true;
}
function renderCards(){const frag=document.createDocumentFragment(),nextCardDom=new Map(),nextTextDom=new Map(),relationState=cardRelationState();for(const n of state.nodes){const card=renderCardElement(n,relationState);nextCardDom.set(n.id,card);frag.appendChild(card)}for(const item of state.elements||[]){const el=renderTextElement(item);nextTextDom.set(item.id,el);frag.appendChild(el)}cardDomById=nextCardDom;textElementDomById=nextTextDom;cardsLayer.replaceChildren(frag);updateNodeGrowthHandles()}
function replaceCardDomForNode(id){
  const node=nodeById(id),old=cardElementByNodeId(id);if(!node||!old)return false;
  const next=renderCardElement(node,cardRelationState());old.replaceWith(next);cardDomById.set(id,next);return true;
}
function replaceTextElementDomForId(id){
  const item=textElementById(id),old=textElementDomByIdValue(id);if(!item||!old)return false;
  const next=renderTextElement(item);old.replaceWith(next);textElementDomById.set(id,next);return true;
}
function updateTextElementAppearanceDom(id){replaceTextElementDomForId(id);refreshCardClasses();updateCardQuickActionsPosition()}
function updateTextElementGeometryDom(id){const item=textElementById(id),el=textElementDomByIdValue(id);if(!item||!el)return false;const geometry=window.KGGraphModel.textElementGeometryOf(item);el.dataset.manualSize=geometry.manualSize?'true':'false';el.style.left=geometry.x+'px';el.style.top=geometry.y+'px';el.style.width=geometry.width+'px';el.style.height=geometry.height+'px';updateCardQuickActionsPosition();return true}
function updateCardContentNodes(options={}){
  const ids=Array.isArray(options.ids)?options.ids:[];ids.forEach(replaceCardDomForNode);refreshCardClasses();updateNodeGrowthHandles();updateCardQuickActionsPosition();
}
function updateCardAppearanceNodes(options={}){
  const ids=Array.isArray(options.ids)?options.ids:[];ids.forEach(replaceCardDomForNode);refreshCardClasses();updateNodeGrowthHandles();requestLinkedEdgeGeometryRender(ids);updateCardQuickActionsPosition();
}
function updateCardGeometryNodes(options={}){
  const ids=Array.isArray(options.ids)?options.ids:[];
  for(const id of ids){const node=nodeById(id),card=cardElementByNodeId(id);if(!node||!card)continue;const pos=visualPositionForNode(node),dims=nodeDims(node);card.style.left=pos.x+'px';card.style.top=pos.y+'px';card.style.setProperty('--card-w',dims.w+'px');card.style.setProperty('--card-h',dims.h+'px')}
  requestLinkedEdgeGeometryRender(ids);updateNodeGrowthHandles();updateCardQuickActionsPosition();
}
function refreshCardClasses(){
  if(nodeFreeResizeModeId&&(state.selectedNodeId!==nodeFreeResizeModeId||state.selectedElementId||state.selectedLinkId||selectedNodeIds.size>1))nodeFreeResizeModeId=null;
  const relationState=cardRelationState();
  for(const card of cardsLayer.querySelectorAll('.knowledge-card')){
    const n=nodeById(card.dataset.nodeId);if(!n){card.remove();continue}
    card.className=classForCard(n,relationState);
  }
  const multiTotal=selectedNodeIds.size+selectedTextElementIds.size+selectedLinkIds.size;
  for(const el of cardsLayer.querySelectorAll('.graph-text-element')){const item=textElementById(el.dataset.textElementId);if(!item){el.remove();continue}const selected=state.selectedElementId===item.id||selectedTextElementIds.has(item.id);el.classList.toggle('active',selected);el.classList.toggle('multi-selected',selected&&multiTotal>1)}
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
  syncHomeSelectionInteractionLock();
  if(options.persist)save();
}
let cardDrag=null;
function resetGraphPointerInteractions(options={}){
  window.KGHomeCanvasRuntime?.alignment?.end?.();
  clearPendingNodeRightClick();
  if(nodeRightPointerSession){
    const session=nodeRightPointerSession;nodeRightPointerSession=null;
    const card=cardElementByNodeId(session.id);try{card?.releasePointerCapture?.(session.pointerId)}catch(error){}
  }
  if(cardDrag){
    const drag=cardDrag;cardDrag=null;clearTimeout(drag.longTimer);
    try{drag.card?.releasePointerCapture?.(drag.pointerId)}catch(error){}
    (drag.ids||[drag.id]).forEach(id=>cardElementByNodeId(id)?.classList.remove('dragging','group-dragging'));
    const controller=ensureGraphDragController();controller?.cancel?.();
  }
  const resize=graphKernelControllers.resize;if(resize?.isActive?.())resize.cancel();
  ensureHomeEdgeDragPerformanceController()?.stop?.(cardDrag?.ids||[]);stage.classList.remove('large-graph-dragging-local-lines','graph-card-dragging','graph-card-dragging-defer-edges','graph-element-resizing','graph-node-resizing','home-selection-bounds-dragging');
  if(options.hideMenus!==false){nodeContextMenuController?.hide?.();nodeStyleToolbarController?.hide?.()}
  return true;
}
function shouldUseHomeEdgeDragLite(drag){
  const ids=drag&&Array.isArray(drag.ids)?drag.ids:[drag&&drag.id].filter(Boolean);
  const prefs=window.KGGraphUserPreferences&&typeof window.KGGraphUserPreferences.get==='function'?window.KGGraphUserPreferences.get():null;
  if(prefs&&prefs.deferEdgesDuringDrag===false)return false;
  return ids.length>1||edgeDomById.size>=120;
}
function cardFromEvent(e){const card=e.target.closest&&e.target.closest('.knowledge-card');return card&&cardsLayer.contains(card)?card:null}
function textElementFromEvent(e){const el=e.target.closest&&e.target.closest('.graph-text-element');return el&&cardsLayer.contains(el)?el:null}
function clearPendingNodeRightClick(){clearTimeout(nodeRightClickTimer);nodeRightClickTimer=null;nodeRightClickPending=null}
function selectNodeForContextMenu(id,options={}){
  window.KGHomeCanvasRuntime?.selectionFilter?.clear?.({reason:'direct-node-context',apply:false});
  const node=nodeById(id);if(!node)return false;
  if(nodeInlineTextEditorController&&nodeInlineTextEditorController.isEditing())nodeInlineTextEditorController.commit();
  if(!selectedNodeIds.has(id)&&state.selectedNodeId!==id){clearMultiSelection();state.selectedNodeId=id}else if(!state.selectedNodeId)state.selectedNodeId=id;
  state.selectedElementId=null;state.selectedLinkId=null;state.linkSourceId=null;refreshSelectionUI();
  if(options.showToolbar===false)nodeStyleToolbarController?.hide?.();
  return true;
}
function exitNodeFreeResizeMode(options={}){
  if(!nodeFreeResizeModeId)return false;nodeFreeResizeModeId=null;
  if(options.refresh!==false)refreshCardClasses();
  if(options.message)showStatus('已退出节点自由调整大小模式。');
  return true;
}
function enterNodeFreeResizeMode(id){
  const node=nodeById(id);if(!node||isCanvasPanMode()||document.body.classList.contains('auth-readonly'))return false;
  if(window.KGGraphModel?.interactionOf?.(node).locked){showStatus('该节点已锁定，先解锁后才能调整大小。');return false}
  clearPendingNodeRightClick();if(nodeContextMenuController)nodeContextMenuController.hide();
  clearMultiSelection();state.selectedElementId=null;state.selectedNodeId=id;state.selectedLinkId=null;state.linkSourceId=null;nodeFreeResizeModeId=id;
  refreshSelectionUI();showStatus(`已进入“${node.title}”自由调整大小模式；拖动四角或四边，按 Esc 退出。`);return true;
}
function applyNodeLayerAction(action){
  const layer=window.KGGraphLayerController;if(!layer||typeof layer.reorder!=='function')return false;
  const ids=selectedNodeIdsForClipboard();if(!ids.length)return false;
  if(rejectLockedNodeAction('调整层级',ids))return false;
  const result=layer.reorder(state.nodes,ids,action);if(!result.changed){showStatus('节点层级已经位于目标位置。');return false}
  const labels={raise:'上移一层',lower:'下移一层',front:'置于顶层',back:'置于底层'};
  pushGraphUndoSnapshot(`${labels[action]||'调整层级'}（${ids.length} 个节点）`);state.nodes=result.items;render({persist:true});showStatus(`已将 ${ids.length} 个节点${labels[action]||'调整层级'}。`);return true;
}
function ensureNodeContextMenu(){
  if(nodeContextMenuController)return nodeContextMenuController;
  const factory=window.KGGraphContextMenuController;if(!factory||typeof factory.create!=='function')return null;
  nodeContextMenuController=factory.create({stage,onAction:detail=>{
    const action=detail&&detail.action||'',context=detail&&detail.context||{};
    if(context.nodeId)selectNodeForContextMenu(context.nodeId,{showToolbar:false});
    if(action==='copy')copySelectedGraphCards();
    else if(action==='paste')pasteGraphClipboardCards();
    else if(action.startsWith('layer:'))applyNodeLayerAction(action.slice(6));
    else if(action==='refresh'){resetGraphPointerInteractions({hideMenus:true});save();location.reload()}
  }});return nodeContextMenuController;
}
function graphClipboardHasData(){
  if(graphClipboardTextElement)return true;
  const clipboard=ensureGraphClipboardController();
  return !!((clipboard&&clipboard.hasData&&clipboard.hasData())||(Array.isArray(graphClipboardNodes)&&graphClipboardNodes.length));
}
function graphContextMenuActions(){return graphModeAllows('contextMenuAdvanced')?null:['refresh']}
function showNodeContextMenu(id,clientX,clientY){
  if(!graphModeAllows('contextMenu'))return false;
  if(!graphModeAllows('contextMenuAdvanced'))return showCanvasContextMenu(clientX,clientY);
  exitNodeFreeResizeMode({refresh:false});if(!selectNodeForContextMenu(id,{showToolbar:false}))return false;
  lastGraphPointerWorldPosition=screenToWorld(clientX,clientY);const menu=ensureNodeContextMenu();if(!menu)return false;
  menu.show({clientX,clientY,context:{type:'node',nodeId:id,locked:isNodeFullyLocked(id),canPaste:graphClipboardHasData(),actions:graphContextMenuActions()}});return true;
}
function showCanvasContextMenu(clientX,clientY){
  if(!graphModeAllows('contextMenu'))return false;
  exitNodeFreeResizeMode({refresh:false});nodeStyleToolbarController?.hide?.();
  lastGraphPointerWorldPosition=screenToWorld(clientX,clientY);const menu=ensureNodeContextMenu();if(!menu)return false;
  const showOptions={clientX,clientY,context:{type:'canvas',canPaste:graphClipboardHasData()}};
  showOptions.context.actions=graphContextMenuActions();menu.show(showOptions);return true;
}
function scheduleNodeContextMenu(id,clientX,clientY,time){
  clearPendingNodeRightClick();nodeRightClickPending={id,clientX,clientY,time};
  nodeRightClickTimer=setTimeout(()=>{const pending=nodeRightClickPending;nodeRightClickTimer=null;nodeRightClickPending=null;if(pending)showNodeContextMenu(pending.id,pending.clientX,pending.clientY)},NODE_RIGHT_DOUBLE_DELAY);
}

// v9.0-p4.3.30：高效/专业模式悬浮卡牌时显示四向连接点；点击快速生长，拖拽建立连接。
let nodeGrowthLayer=null,nodeGrowthPreviewDirection=null,nodeGrowthCreateLockUntil=0;
let nodeGrowthPreviewTimer=null,nodeGrowthPreviewPendingDirection=null;
let nodeGrowthHoverNodeId=null,nodeGrowthHoverHideTimer=null;
const NODE_GROWTH_PREVIEW_DELAY=280;
const NODE_GROWTH_DIRECTIONS={
  top:{label:'上方',dx:0,dy:-1},
  right:{label:'右侧',dx:1,dy:0},
  bottom:{label:'下方',dx:0,dy:1},
  left:{label:'左侧',dx:-1,dy:0}
};
const NODE_GROWTH_GAP=96;
let nodeGrowthConnectController=null,nodeGrowthConnectDraftPath=null,nodeGrowthConnectTargetId=null,nodeGrowthConnectSourceId=null;
function isNodeGrowthConnectDragActive(){return !!(nodeGrowthConnectController&&nodeGrowthConnectController.isActive&&nodeGrowthConnectController.isActive())}
function activeNodeGrowthSourceId(){return isNodeGrowthConnectDragActive()&&nodeGrowthConnectSourceId?String(nodeGrowthConnectSourceId):String(nodeGrowthHoverNodeId||'')}
function setNodeGrowthHoverNode(id){
  clearTimeout(nodeGrowthHoverHideTimer);nodeGrowthHoverHideTimer=null;
  const next=id&&nodeById(id)?String(id):null;
  if(nodeGrowthHoverNodeId===next){updateNodeGrowthHandles();return}
  nodeGrowthHoverNodeId=next;updateNodeGrowthHandles();
}
function scheduleNodeGrowthHoverClear(id=null){
  clearTimeout(nodeGrowthHoverHideTimer);
  nodeGrowthHoverHideTimer=setTimeout(()=>{
    nodeGrowthHoverHideTimer=null;
    if(isNodeGrowthConnectDragActive())return;
    if(id&&String(nodeGrowthHoverNodeId)!==String(id))return;
    nodeGrowthHoverNodeId=null;hideNodeGrowthHandles();
  },110);
}
function ensureNodeGrowthConnectDraftPath(){
  if(nodeGrowthConnectDraftPath&&nodeGrowthConnectDraftPath.isConnected)return nodeGrowthConnectDraftPath;
  nodeGrowthConnectDraftPath=document.createElementNS('http://www.w3.org/2000/svg','path');
  nodeGrowthConnectDraftPath.setAttribute('class','edge-connect-draft');
  nodeGrowthConnectDraftPath.setAttribute('aria-hidden','true');
  edgeGroup.appendChild(nodeGrowthConnectDraftPath);
  return nodeGrowthConnectDraftPath;
}
function clearNodeGrowthConnectVisuals(){
  if(nodeGrowthConnectDraftPath)nodeGrowthConnectDraftPath.remove();
  nodeGrowthConnectDraftPath=null;
  if(nodeGrowthConnectTargetId){const target=cardElementByNodeId(nodeGrowthConnectTargetId);if(target)target.classList.remove('is-connector-drag-target')}
  if(nodeGrowthConnectSourceId){const source=cardElementByNodeId(nodeGrowthConnectSourceId);if(source)source.classList.remove('is-connector-drag-source')}
  nodeGrowthConnectTargetId=null;
  nodeGrowthConnectSourceId=null;
  if(stage&&stage.classList)stage.classList.remove('graph-connector-dragging');
}
function setNodeGrowthConnectTarget(targetId){
  if(nodeGrowthConnectTargetId===targetId)return;
  if(nodeGrowthConnectTargetId){const old=cardElementByNodeId(nodeGrowthConnectTargetId);if(old)old.classList.remove('is-connector-drag-target')}
  nodeGrowthConnectTargetId=targetId||null;
  if(nodeGrowthConnectTargetId){const next=cardElementByNodeId(nodeGrowthConnectTargetId);if(next)next.classList.add('is-connector-drag-target')}
}
function nodeGrowthConnectTargetAt(event,active){
  if(!event||!document.elementFromPoint)return null;
  const hit=document.elementFromPoint(event.clientX,event.clientY);
  const card=hit&&hit.closest&&hit.closest('.knowledge-card');
  if(!card||!cardsLayer.contains(card))return null;
  const targetId=card.dataset.nodeId||'';
  return targetId&&targetId!==active.sourceId?targetId:null;
}
function updateNodeGrowthConnectDraft(result){
  const source=nodeById(result&&result.sourceId);if(!source)return;
  const start=nodeGrowthHandlePosition(source,result.direction);
  const target=result.targetId&&nodeById(result.targetId);
  const pointer=screenToWorld(result.event.clientX,result.event.clientY),end=target?nodeOutlinePoint(target,start):pointer;
  const path=ensureNodeGrowthConnectDraftPath();
  path.setAttribute('d',pathFor(start,end,state.defaults.linkPathStyle));
  path.classList.toggle('has-target',!!target);
  setNodeGrowthConnectTarget(target&&target.id);
}
function createConnectionFromGrowthHandle(sourceId,targetId){
  const source=nodeById(sourceId),target=nodeById(targetId);if(!source||!target||source.id===target.id)return false;
  if(isNodeFullyLocked(source)||isNodeFullyLocked(target)){showStatus('锁定节点不能建立或接收关系线；请先解锁。');updateNodeGrowthHandles();return false}
  if(isCanvasPanMode()||isRelatedGatherActive())return false;
  if(relationExists(source.id,target.id)){
    showStatus(`“${source.title}”与“${target.title}”之间已有关系线。`);
    updateNodeGrowthHandles();
    return false;
  }
  if(typeof pushGraphUndoSnapshot==='function')pushGraphUndoSnapshot('拖拽建立知识关系');
  const link=makeLink(source.id,target.id,'','',state.defaults.linkStyle,state.defaults.linkColor,state.defaults.linkPathStyle);
  state.links.push(link);
  clearMultiSelection();
  state.selectedNodeId=source.id;
  state.selectedLinkId=null;
  state.linkSourceId=null;
  render({persist:true});
  showStatus(`已建立无文字关系线：${source.title} → ${target.title}`);
  return true;
}
function ensureNodeGrowthConnectController(){
  if(nodeGrowthConnectController)return nodeGrowthConnectController;
  const api=window.KGGraphConnectorDrag;
  if(!api||typeof api.create!=='function')return null;
  nodeGrowthConnectController=api.create({
    threshold:6,
    resolveTarget:nodeGrowthConnectTargetAt,
    onStart:result=>{
      nodeGrowthConnectSourceId=result.sourceId;
      hideNodeGrowthPreview();
      if(stage&&stage.classList)stage.classList.add('graph-connector-dragging');
      const source=cardElementByNodeId(result.sourceId);if(source)source.classList.add('is-connector-drag-source');
      updateNodeGrowthConnectDraft(result);
    },
    onMove:updateNodeGrowthConnectDraft,
    onConnect:result=>{clearNodeGrowthConnectVisuals();createConnectionFromGrowthHandle(result.sourceId,result.targetId)},
    onDropMiss:()=>{clearNodeGrowthConnectVisuals();updateNodeGrowthHandles();showStatus('未建立连线：请把连接点拖到另一张卡牌上。')},
    onClick:result=>{clearNodeGrowthConnectVisuals();quickCreateNodeFromGrowthHandle(result.direction,result.sourceId)},
    onCancel:()=>{clearNodeGrowthConnectVisuals();updateNodeGrowthHandles()}
  });
  return nodeGrowthConnectController;
}
function beginNodeGrowthConnectDrag(event,handle){
  if(!graphModeAllows('connections'))return false;
  if(!event||!handle||event.button!==0)return false;
  const sourceId=handle.dataset.nodeId||activeNodeGrowthSourceId(),direction=handle.dataset.growthDir;
  if(!sourceId||!NODE_GROWTH_DIRECTIONS[direction])return false;
  if(isNodeFullyLocked(sourceId)){showStatus('该节点已锁定，不能创建或建立关系；请先解锁。');return false}
  cancelNodeGrowthPreviewDelay();
  hideNodeGrowthPreview({render:false});
  const controller=ensureNodeGrowthConnectController();
  return !!(controller&&controller.begin(event,{sourceId,direction,handle}));
}
function ensureNodeGrowthLayer(){
  if(nodeGrowthLayer&&nodeGrowthLayer.isConnected)return nodeGrowthLayer;
  nodeGrowthLayer=document.createElement('div');
  nodeGrowthLayer.className='node-growth-layer';
  nodeGrowthLayer.dataset.stageUi='true';
  nodeGrowthLayer.setAttribute('aria-label','快速创建相邻知识点');
  cardsLayer.appendChild(nodeGrowthLayer);
  return nodeGrowthLayer;
}
function removeNodeGrowthPreviewElements(){
  if(!nodeGrowthLayer)return;
  nodeGrowthLayer.querySelectorAll('.node-growth-preview-card,.node-growth-preview-svg').forEach(item=>item.remove());
}
function cancelNodeGrowthPreviewDelay(){
  if(nodeGrowthPreviewTimer){clearTimeout(nodeGrowthPreviewTimer);nodeGrowthPreviewTimer=null}
  nodeGrowthPreviewPendingDirection=null;
}
function scheduleNodeGrowthPreview(dir,handle){
  if(!NODE_GROWTH_DIRECTIONS[dir]||isNodeGrowthConnectDragActive())return;
  cancelNodeGrowthPreviewDelay();
  nodeGrowthPreviewPendingDirection=dir;
  nodeGrowthPreviewTimer=setTimeout(()=>{
    nodeGrowthPreviewTimer=null;
    const pending=nodeGrowthPreviewPendingDirection;
    nodeGrowthPreviewPendingDirection=null;
    if(pending!==dir||isNodeGrowthConnectDragActive()||!handle||!handle.isConnected)return;
    showNodeGrowthPreview(dir);
  },NODE_GROWTH_PREVIEW_DELAY);
}
function hideNodeGrowthHandles(){
  cancelNodeGrowthPreviewDelay();
  nodeGrowthPreviewDirection=null;
  if(nodeGrowthLayer)nodeGrowthLayer.replaceChildren();
}
function canShowNodeGrowthHandles(){
  const sourceId=activeNodeGrowthSourceId();
  if(!graphModeAllows('connections')||!state||!sourceId||state.selectedLinkId||state.linkSourceId)return false;
  if(selectedNodeIds&&selectedNodeIds.size>1)return false;
  if(cardDrag||boxSelect||isCanvasPanMode()||isRelatedGatherActive())return false;
  if(stage&&stage.classList&&(stage.classList.contains('viewport-fitting')||stage.classList.contains('graph-card-dragging-defer-edges')))return false;
  if(isNodeFullyLocked(sourceId))return false;
  return !!nodeById(sourceId);
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
  btn.title=`点击：在${meta.label}快速创建；拖拽：连接到其他卡牌`;
  btn.setAttribute('role','button');
  btn.setAttribute('tabindex','0');
  btn.setAttribute('aria-label',btn.title);
  btn.style.left=point.x+'px';
  btn.style.top=point.y+'px';
  btn.addEventListener('pointerdown',event=>beginNodeGrowthConnectDrag(event,btn));
  btn.addEventListener('click',event=>{event.preventDefault();event.stopPropagation()});
  btn.addEventListener('pointerenter',()=>{clearTimeout(nodeGrowthHoverHideTimer);nodeGrowthHoverHideTimer=null;nodeGrowthHoverNodeId=String(btn.dataset.nodeId||nodeGrowthHoverNodeId||'');if(!isNodeGrowthConnectDragActive())scheduleNodeGrowthPreview(btn.dataset.growthDir,btn)});
  btn.addEventListener('pointerleave',()=>{cancelNodeGrowthPreviewDelay();if(!isNodeGrowthConnectDragActive()){hideNodeGrowthPreview();scheduleNodeGrowthHoverClear(btn.dataset.nodeId)}});
  btn.addEventListener('keydown',e=>{
    if(e.key==='Enter'||e.key===' '){e.preventDefault();e.stopPropagation();quickCreateNodeFromGrowthHandle(btn.dataset.growthDir,btn.dataset.nodeId)}
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
  if(isNodeGrowthConnectDragActive())return;
  if(!canShowNodeGrowthHandles()){hideNodeGrowthHandles();return}
  const n=nodeById(activeNodeGrowthSourceId()),layer=ensureNodeGrowthLayer();
  if(!n){hideNodeGrowthHandles();return}
  const dirs=['top','right','bottom','left'];
  const existing=[...layer.querySelectorAll('.node-growth-handle')];
  const stable=layer.dataset.nodeId===String(n.id)&&existing.length===dirs.length;
  if(!stable){
    layer.replaceChildren();
    layer.dataset.nodeId=String(n.id);
    dirs.forEach(dir=>layer.appendChild(createNodeGrowthHandle(dir,n)));
  }else{
    existing.forEach(handle=>{
      const dir=handle.dataset.growthDir;
      const point=nodeGrowthHandlePosition(n,dir);
      handle.dataset.nodeId=n.id;
      handle.style.left=point.x+'px';
      handle.style.top=point.y+'px';
    });
  }
  removeNodeGrowthPreviewElements();
  if(nodeGrowthPreviewDirection&&NODE_GROWTH_DIRECTIONS[nodeGrowthPreviewDirection]){
    layer.appendChild(createNodeGrowthPreview(n,nodeGrowthPreviewDirection));
  }
}
function showNodeGrowthPreview(dir){
  if(!NODE_GROWTH_DIRECTIONS[dir]||isNodeGrowthConnectDragActive())return;
  cancelNodeGrowthPreviewDelay();
  nodeGrowthPreviewDirection=dir;
  updateNodeGrowthHandles();
}
function hideNodeGrowthPreview(options={}){
  cancelNodeGrowthPreviewDelay();
  nodeGrowthPreviewDirection=null;
  removeNodeGrowthPreviewElements();
}
function shouldKeepNodeGrowthPreviewFromEvent(e){
  const target=e&&e.target;
  return !!(target&&target.closest&&target.closest('.node-growth-handle'));
}
document.addEventListener('pointermove',e=>{
  if(isNodeGrowthConnectDragActive())return;
  if(!shouldKeepNodeGrowthPreviewFromEvent(e)){
    cancelNodeGrowthPreviewDelay();
    if(nodeGrowthPreviewDirection)hideNodeGrowthPreview();
  }
},{passive:true});
window.addEventListener('blur',()=>{cancelNodeGrowthPreviewDelay();hideNodeGrowthPreview();if(nodeGrowthConnectController&&nodeGrowthConnectController.cancel)nodeGrowthConnectController.cancel()});
document.addEventListener('scroll',()=>{cancelNodeGrowthPreviewDelay();hideNodeGrowthPreview()},true);
function quickCreateNodeFromGrowthHandle(dir,sourceId=null){
  if(!NODE_GROWTH_DIRECTIONS[dir])return false;
  // sourceId 只用于定位原卡牌；新卡牌 ID 仍由 makeNode() 生成，绝不复用原卡牌 ID。
  const source=nodeById(sourceId||activeNodeGrowthSourceId());if(!source)return false;
  if(isNodeFullyLocked(source)){showStatus('该节点已锁定，不能快速创建或建立关系；请先解锁。');return false}
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
  if(window.KGGraphModel)window.KGGraphModel.updateAppearance(next,window.KGGraphModel.appearanceOf(source));
  const link=makeLink(source.id,next.id,'','',state.defaults.linkStyle,state.defaults.linkColor,state.defaults.linkPathStyle);
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
cardsLayer.addEventListener('click',e=>{
  const handle=e.target.closest&&e.target.closest('.node-growth-handle');
  if(!handle)return;
  e.preventDefault();
  e.stopPropagation();
},true);


cardsLayer.addEventListener('click',e=>{
  if(isCanvasPanMode()){e.preventDefault();e.stopPropagation();return}
  const btn=e.target.closest&&e.target.closest('.node-size-btn');if(!btn)return;
  e.stopPropagation();e.preventDefault();
  const card=btn.closest('.knowledge-card'),n=card&&nodeById(card.dataset.nodeId);if(!n)return;
  if(isNodeFullyLocked(n)){showStatus('该节点已锁定，不能修改尺寸；请先解锁。');return}
  const size=NODE_SIZES.has(btn.dataset.size)?btn.dataset.size:'';
  const styleController=ensureGraphStyleController();
  if(styleController)styleController.updateAppearance([n.id],{size},`调整“${n.title}”卡牌尺寸`);else{state.defaults.nodeSize=size;n.size=size;if(window.KGGraphModel)window.KGGraphModel.updateAppearance(n,{size});render({persist:true})}
  showStatus(size==='small'?`“${n.title}”已设为小卡。`:size==='big'?`“${n.title}”已设为大卡。`:`“${n.title}”已恢复默认尺寸。`);
});
function startNodeInlineEdit(id,card=null){
  if(!graphModeAllows('nodeEdit'))return false;
  if(isCanvasPanMode()||document.body.classList.contains('auth-readonly'))return false;
  const node=nodeById(id),targetCard=card||cardElementByNodeId(id),host=targetCard&&targetCard.querySelector('.node-title');
  if(!node||!targetCard||!host)return false;
  if(isNodeFullyLocked(node)){showStatus('该节点已锁定，不能编辑文字；请先解锁。');return false}
  state.selectedElementId=null;state.selectedNodeId=node.id;state.selectedLinkId=null;state.linkSourceId=null;clearMultiSelection();refreshSelectionUI();
  const appearance=window.KGGraphModel.appearanceOf(node),multiline=appearance.cardStyle!=='standard';
  const editor=ensureNodeInlineTextEditorController();
  const started=!!(editor&&editor.start({nodeId:node.id,entityType:'node',card:targetCard,host,value:window.KGGraphModel.contentOf(node).title,multiline,label:multiline?'编辑节点文字，Ctrl/Command+Enter 保存':'编辑节点标题，Enter 保存'}));
  if(started)showStatus(multiline?'正在原位编辑节点文字：点击其他位置或 Ctrl/Command+Enter 保存，Esc 取消。':'正在原位编辑节点标题：点击其他位置或 Enter 保存，Esc 取消。');
  return started;
}
function startTextElementInlineEdit(id,element=null){
  if(!graphModeAllows('textEdit'))return false;
  if(isCanvasPanMode()||document.body.classList.contains('auth-readonly'))return false;
  const item=textElementById(id),target=element||textElementDomByIdValue(id),host=target&&target.querySelector('.graph-text-element-content');
  if(!item||!target||!host)return false;
  clearMultiSelection();state.selectedNodeId=null;state.selectedLinkId=null;state.linkSourceId=null;state.selectedElementId=item.id;refreshSelectionUI();
  const editor=ensureNodeInlineTextEditorController();
  const started=!!(editor&&editor.start({nodeId:item.id,entityType:'text-element',card:target,host,value:window.KGGraphModel.textElementContentOf(item).text,multiline:true,label:'编辑文本框，点击其他位置或 Ctrl/Command+Enter 保存'}));
  if(started)showStatus('正在原位编辑文本框：点击其他位置或 Ctrl/Command+Enter 保存，Esc 取消。');
  return started;
}
function nodeResizeHandleFromEvent(e){const handle=e.target.closest&&e.target.closest('[data-node-resize-handle]');return handle&&cardsLayer.contains(handle)?handle:null}
stage.addEventListener('pointerdown',e=>{if(e.button!==2)clearPendingNodeRightClick()},true);
cardsLayer.addEventListener('pointerdown',e=>{
  if(!graphModeAllows('contextMenuAdvanced')||e.button!==2||isCanvasPanMode())return;const card=cardFromEvent(e);if(!card)return;
  e.preventDefault();e.stopPropagation();nodeInlineTextEditorController?.commit?.();if(nodeStyleToolbarController)nodeStyleToolbarController.hide();if(nodeContextMenuController)nodeContextMenuController.hide();
  nodeRightPointerSession={pointerId:e.pointerId,id:card.dataset.nodeId,startX:e.clientX,startY:e.clientY,clientX:e.clientX,clientY:e.clientY,moved:false,time:performance.now()};
  try{card.setPointerCapture(e.pointerId)}catch(error){}
},true);
cardsLayer.addEventListener('pointermove',e=>{
  if(!nodeRightPointerSession||nodeRightPointerSession.pointerId!==e.pointerId)return;
  nodeRightPointerSession.clientX=e.clientX;nodeRightPointerSession.clientY=e.clientY;
  if(Math.hypot(e.clientX-nodeRightPointerSession.startX,e.clientY-nodeRightPointerSession.startY)>5)nodeRightPointerSession.moved=true;
  e.preventDefault();e.stopPropagation();
},true);
cardsLayer.addEventListener('pointerup',e=>{
  if(!nodeRightPointerSession||nodeRightPointerSession.pointerId!==e.pointerId)return;
  const session=nodeRightPointerSession;nodeRightPointerSession=null;e.preventDefault();e.stopPropagation();
  if(session.moved){clearPendingNodeRightClick();return}
  const now=performance.now(),pending=nodeRightClickPending;
  if(pending&&pending.id===session.id&&now-pending.time<=NODE_RIGHT_DOUBLE_DELAY&&graphModeAllows('nodeResize')){clearPendingNodeRightClick();enterNodeFreeResizeMode(session.id);return}
  scheduleNodeContextMenu(session.id,e.clientX,e.clientY,now);
},true);
cardsLayer.addEventListener('pointercancel',e=>{if(nodeRightPointerSession&&nodeRightPointerSession.pointerId===e.pointerId){nodeRightPointerSession=null;clearPendingNodeRightClick();e.preventDefault();e.stopPropagation()}},true);
cardsLayer.addEventListener('contextmenu',e=>{const card=cardFromEvent(e);if(!card)return;e.preventDefault();e.stopPropagation();if(graphModeAllows('contextMenu')&&!graphModeAllows('contextMenuAdvanced'))showCanvasContextMenu(e.clientX,e.clientY)},true);
cardsLayer.addEventListener('pointerdown',e=>{
  if(!graphModeAllows('nodeResize'))return;
  const handle=nodeResizeHandleFromEvent(e);if(!handle||isCanvasPanMode()||e.button!==0||document.body.classList.contains('auth-readonly'))return;
  const card=handle.closest('.knowledge-card'),node=card&&nodeById(card.dataset.nodeId);if(!node||card.classList.contains('multi-selected')||currentHomeFilteredSelectionTotal()>1)return;if(window.KGGraphModel?.interactionOf?.(node).locked){showStatus('该节点已锁定，先解锁后才能调整大小。');return}
  e.preventDefault();e.stopPropagation();cardDrag=null;nodeInlineTextEditorController?.commit?.();
  state.selectedElementId=null;clearMultiSelection();state.selectedNodeId=node.id;state.selectedLinkId=null;state.linkSourceId=null;refreshSelectionUI();
  const appearance=window.KGGraphModel.appearanceOf(node),preserveAspectRatio=appearance.cardStyle==='circle';
  const controller=ensureGraphElementResizeController();controller&&controller.begin(e,{id:node.id,entityType:'node',handle:handle.dataset.nodeResizeHandle,element:card,captureTarget:handle,minWidth:72,minHeight:60,preserveAspectRatio});
});
cardsLayer.addEventListener('pointerdown',e=>{
  if(isCanvasPanMode()||e.button===2)return;
  if(e.target.closest&&e.target.closest('.node-size-btn,.node-inline-text-editor,[data-node-resize-handle]')){e.stopPropagation();return}
  if(nodeInlineTextEditorController&&nodeInlineTextEditorController.isEditing())return;
  const card=cardFromEvent(e);if(!card||e.button!==0)return;
  const id=card.dataset.nodeId,n=nodeById(id);if(!n)return;
  if(!graphModeAllows('nodeDrag')){
    e.preventDefault();e.stopPropagation();handleNodeTap(id);return
  }
  if(isNodeFullyLocked(n)){
    e.preventDefault();e.stopPropagation();
    if(e.ctrlKey||e.metaKey){toggleCardMultiSelection(id);return}
    handleNodeTap(id);showStatus('该节点已完全锁定；仅可打开相关画布或解锁。');return
  }
  hideNodeGrowthHandles();
  e.stopPropagation();e.preventDefault();
  const toggleMulti=e.ctrlKey||e.metaKey;
  const editOnRelease=state.selectedNodeId===id&&!state.selectedLinkId&&!state.linkSourceId&&(!selectedNodeIds||selectedNodeIds.size===0)&&!toggleMulti&&!e.shiftKey;
  const groupIds=toggleMulti?[id]:(selectedNodeIds.has(id)&&selectedNodeIds.size>1?[...selectedNodeIds]:[id]);
  const lockedGroup=groupIds.filter(gid=>window.KGGraphModel?.interactionOf?.(nodeById(gid)).locked);if(lockedGroup.length){showStatus(`选择中有 ${lockedGroup.length} 个锁定节点，已取消整体移动。`);return}
  if(groupIds.length===1&&!e.shiftKey&&!e.ctrlKey&&!e.metaKey)clearMultiSelection();
  const startPositions=Object.fromEntries(groupIds.map(gid=>{const gn=nodeById(gid);return[gid,{x:gn.x,y:gn.y}]}));
  const dragController=ensureGraphDragController();
  cardDrag=dragController?dragController.begin('node',e,{id,ids:groupIds,card,moved:false,longOpened:false,toggleMulti,editOnRelease,startClient:{x:e.clientX,y:e.clientY},startPos:{x:n.x,y:n.y},startPositions,longTimer:null,historyLabel:groupIds.length>1?`移动 ${groupIds.length} 个知识点`:`移动“${n.title}”`}):{id,ids:groupIds,card,pointerId:e.pointerId,moved:false,longOpened:false,toggleMulti,editOnRelease,startClient:{x:e.clientX,y:e.clientY},startPos:{x:n.x,y:n.y},startPositions,longTimer:null};
  cardDrag.edgeLite=shouldUseHomeEdgeDragLite(cardDrag);
  const movingRecords=typeof homeAlignmentRecords==='function'?homeAlignmentRecords().filter(record=>groupIds.includes(String(record.id))):[];
  if(cardDrag.edgeLite)window.KGHomeCanvasRuntime?.alignment?.clearGuides?.();else window.KGHomeCanvasRuntime?.alignment?.begin?.(movingRecords,{kind:'node',ids:groupIds});
  cardDrag.ids.forEach(gid=>{const el=cardElementByNodeId(gid);if(el)el.classList.add(groupIds.length>1?'group-dragging':'dragging')});
  card.setPointerCapture(e.pointerId);
  cardDrag.longTimer=setTimeout(()=>{
    if(!cardDrag||cardDrag.pointerId!==e.pointerId||cardDrag.moved)return;
    const longSession=cardDrag;longSession.longOpened=true;
    resetGraphPointerInteractions({hideMenus:true});
    openNodeModal(id);showStatus('长按：编辑知识点。');
  },isCoarse?560:760);
});
cardsLayer.addEventListener('pointermove',e=>{
  if(!cardDrag||cardDrag.pointerId!==e.pointerId||cardDrag.longOpened)return;
  e.stopPropagation();e.preventDefault();
  markStageInteracting();
  const px=e.clientX-cardDrag.startClient.x,py=e.clientY-cardDrag.startClient.y,wasMoved=!!cardDrag.moved;
  const dragController=ensureGraphDragController();if(dragController)dragController.update(e);
  if(Math.hypot(px,py)>5){if(!wasMoved){stage.classList.add('graph-card-dragging');nodeStyleToolbarController?.hide()}cardDrag.moved=true;clearTimeout(cardDrag.longTimer)}
  if(isRelatedGatherActive()&&cardDrag.moved){
    if(!cardDrag.gatherDragBlocked)showStatus('当前是临时聚拢布局，仅用于讲解查看；请先退出聚拢后再调整原图谱位置。');
    cardDrag.gatherDragBlocked=true;
    return;
  }
  let dx=px/state.viewport.scale,dy=py/state.viewport.scale;
  const snapped=cardDrag.edgeLite?null:window.KGHomeCanvasRuntime?.alignment?.resolve?.(dx,dy,{altKey:!!e.altKey});
  if(snapped){dx=snapped.dx;dy=snapped.dy}
  for(const gid of cardDrag.ids||[cardDrag.id]){
    const n=nodeById(gid),start=cardDrag.startPositions&&cardDrag.startPositions[gid];if(!n||!start)continue;
    const nextX=Math.round(start.x+dx),nextY=Math.round(start.y+dy);
    if(window.KGGraphModel)window.KGGraphModel.updateGeometry(n,{x:nextX,y:nextY});else{n.x=nextX;n.y=nextY}
    const el=cardElementByNodeId(gid);
    if(el){el.style.left=n.x+'px';el.style.top=n.y+'px'}
  }
  if(cardDrag.edgeLite){
    ensureHomeEdgeDragPerformanceController()?.start?.(cardDrag.ids||[cardDrag.id]);
    ensureHomeEdgeDragPerformanceController()?.schedule?.(cardDrag.ids||[cardDrag.id]);
    stage.classList.remove('large-graph-dragging-local-lines','graph-card-dragging-defer-edges');
  }else{
    stage.classList.toggle('large-graph-dragging-local-lines',isLargeGraphMode()&&edgeDomById.size>0);
    requestLinkedEdgeGeometryRender(cardDrag.ids||[cardDrag.id]);
  }
});
function finishCardPointer(e,cancelled=false){
  if(!cardDrag||cardDrag.pointerId!==e.pointerId)return;
  const drag=cardDrag;cardDrag=null;window.KGHomeCanvasRuntime?.alignment?.end?.();if(drag.edgeLite)ensureHomeEdgeDragPerformanceController()?.stop?.(drag.ids||[drag.id]);const dragController=ensureGraphDragController();if(dragController)dragController.finish(e,{cancelled});clearTimeout(drag.longTimer);
  e.stopPropagation();
  (drag.ids||[drag.id]).forEach(gid=>{const el=cardElementByNodeId(gid);if(el)el.classList.remove('dragging','group-dragging')});
  stage.classList.remove('large-graph-dragging-local-lines','graph-card-dragging','graph-card-dragging-defer-edges');
  try{drag.card.releasePointerCapture(e.pointerId)}catch{}
  if(cancelled||drag.longOpened){if(drag.edgeLite&&drag.moved&&!drag.gatherDragBlocked)renderEdges();return}
  if(drag.gatherDragBlocked){handleNodeTap(drag.id);return}
  if(!drag.moved){
    if(drag.toggleMulti){toggleCardMultiSelection(drag.id);return}
    if(drag.editOnRelease&&startNodeInlineEdit(drag.id,drag.card))return;
    handleNodeTap(drag.id);return
  }
  state.selectedElementId=null;state.selectedNodeId=drag.id;state.selectedLinkId=null;state.linkSourceId=null;
  if((drag.ids||[]).length>1){
    selectedNodeIds=new Set(drag.ids);
    showStatus(drag.edgeLite?`已整体移动 ${drag.ids.length} 个知识点，并恢复完整关系线。`:`已整体移动 ${drag.ids.length} 个知识点。${isLargeGraphMode()?'已刷新局部关系线。':''}`);
  }else{
    clearMultiSelection();
    showStatus(isLargeGraphMode()?'已移动知识点，并刷新该卡牌的局部关系线。':'已移动知识点。需要连线时请使用工具栏“连线”或连接手柄。');
  }
  refreshSelectionUI({persist:true});requestAnimationFrame(()=>updateCardQuickActions());
}
cardsLayer.addEventListener('pointerup',e=>finishCardPointer(e));
cardsLayer.addEventListener('pointercancel',e=>finishCardPointer(e,true));
cardsLayer.addEventListener('dblclick',e=>{
  const card=cardFromEvent(e);if(!card)return;
  // P4.2.6: editing is entered by clicking an already-selected node, not by double-clicking.
  e.preventDefault();e.stopPropagation();
});
function textElementResizeHandleFromEvent(e){const handle=e.target.closest&&e.target.closest('[data-element-resize-handle]');return handle&&cardsLayer.contains(handle)?handle:null}
cardsLayer.addEventListener('pointerdown',e=>{
  if(!graphModeAllows('nodeResize'))return;
  const handle=textElementResizeHandleFromEvent(e);if(!handle||isCanvasPanMode()||e.button!==0||document.body.classList.contains('auth-readonly'))return;
  const el=handle.closest('.graph-text-element'),item=el&&textElementById(el.dataset.textElementId);if(!item||el.classList.contains('multi-selected')||currentHomeFilteredSelectionTotal()>1)return;
  e.preventDefault();e.stopPropagation();textElementDrag=null;nodeInlineTextEditorController?.commit?.();
  clearMultiSelection();state.selectedNodeId=null;state.selectedLinkId=null;state.linkSourceId=null;state.selectedElementId=item.id;
  const controller=ensureGraphElementResizeController();controller&&controller.begin(e,{id:item.id,handle:handle.dataset.elementResizeHandle,element:el,captureTarget:handle,minWidth:24,minHeight:24});
});
cardsLayer.addEventListener('pointermove',e=>{const controller=graphKernelControllers.resize;if(controller&&controller.isActive())controller.update(e)});
cardsLayer.addEventListener('pointerup',e=>{const controller=graphKernelControllers.resize;if(controller&&controller.isActive())controller.finish(e)});
cardsLayer.addEventListener('pointercancel',e=>{const controller=graphKernelControllers.resize;if(controller&&controller.isActive())controller.finish(e,{cancelled:true})});
let textElementDrag=null;
cardsLayer.addEventListener('pointerdown',e=>{
  if(isCanvasPanMode()||e.button!==0||e.target.closest('.node-inline-text-editor,[data-element-resize-handle]'))return;
  const el=textElementFromEvent(e);if(!el)return;
  const item=textElementById(el.dataset.textElementId);if(!item)return;
  window.KGHomeCanvasRuntime?.selectionFilter?.clear?.({reason:'direct-text-element',apply:false});
  if(!graphModeAllows('textDrag')){
    e.preventDefault();e.stopPropagation();clearMultiSelection();selectedTextElementIds.clear();state.selectedNodeId=null;state.selectedLinkId=null;state.linkSourceId=null;state.selectedElementId=item.id;refreshSelectionUI();return
  }
  const additive=!!(e.ctrlKey||e.metaKey);
  if(additive){
    e.preventDefault();e.stopPropagation();
    if(selectedTextElementIds.has(String(item.id)))selectedTextElementIds.delete(String(item.id));else selectedTextElementIds.add(String(item.id));
    selectedNodeIds.clear();selectedLinkIds.clear();state.selectedNodeId=null;state.selectedLinkId=null;state.linkSourceId=null;
    state.selectedElementId=selectedTextElementIds.values().next().value||null;refreshSelectionUI();return;
  }
  const groupIds=selectedTextElementIds.has(String(item.id))&&selectedTextElementIds.size>1?[...selectedTextElementIds]:[String(item.id)];
  const editOnRelease=groupIds.length===1&&state.selectedElementId===item.id&&!state.selectedNodeId&&!state.selectedLinkId&&!state.linkSourceId;
  e.preventDefault();e.stopPropagation();if(nodeFloatingColorWindowController)nodeFloatingColorWindowController.close({cancel:true});
  selectedNodeIds.clear();selectedLinkIds.clear();selectedTextElementIds=new Set(groupIds);state.selectedNodeId=null;state.selectedLinkId=null;state.linkSourceId=null;state.selectedElementId=item.id;refreshSelectionUI();
  const startPositions={};
  for(const id of groupIds){const current=textElementById(id);if(!current)continue;const geometry=window.KGGraphModel.textElementGeometryOf(current);startPositions[id]={x:geometry.x,y:geometry.y};const dom=textElementDomByIdValue(id);dom?.classList.add('group-dragging')}
  textElementDrag={pointerId:e.pointerId,id:item.id,ids:groupIds,el,startX:e.clientX,startY:e.clientY,startPositions,moved:false,checkpoint:false,editOnRelease};
  const movingRecords=typeof homeAlignmentRecords==='function'?homeAlignmentRecords().filter(record=>groupIds.includes(String(record.id))):[];
  window.KGHomeCanvasRuntime?.alignment?.begin?.(movingRecords,{kind:'text-element',ids:groupIds});
  nodeStyleToolbarController?.hide();hideSelectedEdgeQuickStylePanel();
  try{el.setPointerCapture(e.pointerId)}catch(error){}
});
cardsLayer.addEventListener('pointermove',e=>{
  if(!textElementDrag||textElementDrag.pointerId!==e.pointerId)return;
  let dx=(e.clientX-textElementDrag.startX)/state.viewport.scale,dy=(e.clientY-textElementDrag.startY)/state.viewport.scale;
  const snapped=window.KGHomeCanvasRuntime?.alignment?.resolve?.(dx,dy,{altKey:!!e.altKey});if(snapped){dx=snapped.dx;dy=snapped.dy}
  if(Math.hypot(dx,dy)>4){textElementDrag.moved=true;if(!textElementDrag.checkpoint){pushGraphUndoSnapshot(textElementDrag.ids.length>1?`移动 ${textElementDrag.ids.length} 个文本框`:'移动文本框');textElementDrag.checkpoint=true}}
  if(!textElementDrag.moved)return;
  for(const id of textElementDrag.ids){const item=textElementById(id),start=textElementDrag.startPositions[id];if(!item||!start)continue;window.KGGraphModel.updateTextElementGeometry(item,{x:Math.round(start.x+dx),y:Math.round(start.y+dy)});const dom=textElementDomByIdValue(id);if(dom){dom.style.left=item.x+'px';dom.style.top=item.y+'px'}}
  updateCardQuickActionsPosition();e.preventDefault();e.stopPropagation();
});
function finishTextElementDrag(e,cancelled=false){
  if(!textElementDrag||textElementDrag.pointerId!==e.pointerId)return;
  const drag=textElementDrag;textElementDrag=null;window.KGHomeCanvasRuntime?.alignment?.end?.();try{drag.el.releasePointerCapture(e.pointerId)}catch(error){}
  drag.ids.forEach(id=>textElementDomByIdValue(id)?.classList.remove('group-dragging'));
  if(cancelled&&drag.moved){for(const id of drag.ids){const item=textElementById(id),start=drag.startPositions[id];if(item&&start)window.KGGraphModel.updateTextElementGeometry(item,{x:start.x,y:start.y})}render({persist:false});showStatus('已取消移动文本框。')}
  else if(drag.moved){save();showStatus(drag.ids.length>1?`已整体移动 ${drag.ids.length} 个文本框，可撤销。`:'文本框位置已保存，可撤销。')}
  else if(drag.editOnRelease&&startTextElementInlineEdit(drag.id,drag.el)){}
  else{refreshSelectionUI();showStatus(drag.ids.length>1?`已选择 ${drag.ids.length} 个文本框。`:'已选择文本框；再次点击即可原位编辑文字。')}
  e.preventDefault();e.stopPropagation();
}
cardsLayer.addEventListener('pointerup',finishTextElementDrag);cardsLayer.addEventListener('pointercancel',e=>finishTextElementDrag(e,true));
cardsLayer.addEventListener('dblclick',e=>{
  const el=textElementFromEvent(e);if(!el)return;
  // P4.2.6: second single click on the selected text element enters editing.
  e.preventDefault();e.stopPropagation();
});
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
  return !!(isCoarse||cardDrag||selecting||(nodeInlineTextEditorController&&nodeInlineTextEditorController.isEditing())||state.selectedElementId||state.selectedNodeId||state.selectedLinkId||isCanvasPanMode()||stage.classList.contains('viewport-fitting')||inlineEditorOpen);
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
  setNodeGrowthHoverNode(card.dataset.nodeId);
  showHoverDetail(card.dataset.nodeId);
});
cardsLayer.addEventListener('pointerout',e=>{
  const card=cardFromEvent(e);if(!card||card.contains(e.relatedTarget))return;
  const id=card.dataset.nodeId,related=e.relatedTarget;
  const relatedHandle=related&&related.closest&&related.closest('.node-growth-handle');
  if(!relatedHandle||String(relatedHandle.dataset.nodeId)!==String(id))scheduleNodeGrowthHoverClear(id);
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
let nodeFillColorRegion='body-fill';
const NODE_TOOLBAR_COLOR_PRESETS=['#ffffff','#f8fafc','#e2e8f0','#fee2e2','#ffedd5','#fef3c7','#dcfce7','#cffafe','#dbeafe','#ede9fe','#fce7f3','#0f172a','#2563eb','#7c3aed','#16a34a','#ea580c'];
const NODE_TOOLBAR_ICONS=Object.freeze({
  left:'<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M4 5v14M7 7h12M7 12h8M7 17h12"></path></svg>',
  center:'<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 4v16M5 7h14M7 12h10M5 17h14"></path></svg>',
  right:'<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M20 5v14M5 7h12M9 12h8M5 17h12"></path></svg>',
  top:'<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M4 4h16M8 7v12M16 7v8"></path></svg>',
  middle:'<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M4 12h16M8 5v14M16 7v10"></path></svg>',
  bottom:'<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M4 20h16M8 5v12M16 9v8"></path></svg>',
  distributeX:'<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M3 4v16M21 4v16"></path><rect x="6" y="8" width="4" height="8" rx="1"></rect><rect x="14" y="8" width="4" height="8" rx="1"></rect></svg>',
  distributeY:'<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M4 3h16M4 21h16"></path><rect x="8" y="6" width="8" height="4" rx="1"></rect><rect x="8" y="14" width="8" height="4" rx="1"></rect></svg>',
  copy:'<svg viewBox="0 0 24 24" aria-hidden="true"><rect x="8" y="8" width="12" height="12" rx="2"></rect><path d="M16 8V6a2 2 0 0 0-2-2H6a2 2 0 0 0-2 2v8a2 2 0 0 0 2 2h2"></path></svg>',
  trash:'<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M4 7h16M9 3h6l1 4H8l1-4zM7 7l1 14h8l1-14M10 11v6M14 11v6"></path></svg>',
  reset:'<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M4 12a8 8 0 1 0 3-6.2"></path><path d="M4 4v6h6"></path></svg>',
  borderSolid:'<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M4 12h16"></path></svg>',
  borderDashed:'<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M3 12h4m3 0h4m3 0h4"></path></svg>',
  borderDotted:'<svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="5" cy="12" r="1"></circle><circle cx="9.5" cy="12" r="1"></circle><circle cx="14.5" cy="12" r="1"></circle><circle cx="19" cy="12" r="1"></circle></svg>',
  eye:'<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M2.5 12s3.5-6 9.5-6 9.5 6 9.5 6-3.5 6-9.5 6-9.5-6-9.5-6z"></path><circle cx="12" cy="12" r="2.5"></circle></svg>',
  eyeOff:'<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M3 3l18 18M10.5 6.2A10 10 0 0 1 12 6c6 0 9.5 6 9.5 6a14 14 0 0 1-2.4 3.1M6.2 6.2C3.8 8 2.5 12 2.5 12s3.5 6 9.5 6a9 9 0 0 0 3-.5"></path></svg>',
  palette:'<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 3a9 9 0 1 0 0 18h1.2a2 2 0 0 0 1.6-3.2l-.5-.7a1.6 1.6 0 0 1 1.3-2.5H18a3 3 0 0 0 3-3A8.6 8.6 0 0 0 12 3z"></path><circle cx="7.5" cy="10" r="1"></circle><circle cx="10" cy="6.8" r="1"></circle><circle cx="14" cy="6.8" r="1"></circle><circle cx="16.7" cy="10" r="1"></circle></svg>',
  bold:'<span class="node-toolbar-letter-icon node-toolbar-bold-icon" aria-hidden="true">B</span>',
  italic:'<span class="node-toolbar-letter-icon node-toolbar-italic-icon" aria-hidden="true">I</span>',
  underline:'<span class="node-toolbar-letter-icon node-toolbar-underline-icon" aria-hidden="true">U</span>',
  strike:'<span class="node-toolbar-letter-icon node-toolbar-strike-icon" aria-hidden="true">S</span>'
});
function nodeToolbarSelectedIds(){
  const ids=new Set();
  if(selectedNodeIds&&selectedNodeIds.size)selectedNodeIds.forEach(id=>{if(nodeById(id))ids.add(id)});
  if(state.selectedNodeId&&nodeById(state.selectedNodeId))ids.add(state.selectedNodeId);
  return state.nodes.filter(node=>ids.has(node.id)).map(node=>node.id);
}
function nodeToolbarPrimaryNode(){return nodeById(state.selectedNodeId)||nodeById(nodeToolbarSelectedIds()[0])}
function nodeToolbarTextElement(){return state.selectedElementId?textElementById(state.selectedElementId):null}
function nodeToolbarIconButton(action,label,icon,extra=''){return `<button type="button" class="node-style-option" data-node-toolbar-action="${action}" data-tooltip="${label}" aria-label="${label}" ${extra}>${icon}</button>`}
function nodeToolbarSwatches(prefix){return NODE_TOOLBAR_COLOR_PRESETS.map(color=>`<button type="button" class="node-color-swatch" data-node-toolbar-action="${prefix}:${color}" data-color="${color}" aria-label="${color}" style="--swatch:${color}"></button>`).join('')}
function buildNodeStyleToolbarPanels(host){
  const registry=window.KGGraphCardStyleRegistry;
  const styles=registry&&registry.list?registry.list():[];
  const fontSizes=(window.KGGraphModel&&window.KGGraphModel.FONT_SIZE_PRESETS)||[6,8,10,12,14,18,24,36,48,64,80,144,288];
  const fontSizeButtons=fontSizes.map(size=>nodeToolbarIconButton(`font-size:${size}`,`${size}px`,`<span class="font-size-number">${size}</span>`,`data-value="${size}"`)).join('');
  const lineHeights=[.8,.9,1,1.25,1.5,2,2.5,3];
  const lineHeightButtons=lineHeights.map(value=>nodeToolbarIconButton(`line-height:${value}`,`行高 ${value}`,`<span class="line-height-number">${value}</span>`,`data-value="${value}"`)).join('');
  host.innerHTML=`
    <section class="node-style-popover node-style-type-panel" data-node-style-panel="type" hidden aria-label="节点类型">
      <div class="node-style-icon-grid">${styles.map(item=>nodeToolbarIconButton(`style:${item.id}`,item.label,item.icon,`data-value="${item.id}"`)).join('')}</div>
    </section>
    <section class="node-style-popover node-style-color-panel" data-node-style-panel="fill" hidden aria-label="背景填充">
      <div class="node-style-panel-title">标准卡牌颜色</div>
      <div class="node-color-region-tabs" role="group" aria-label="标准卡牌颜色区域">
        <button type="button" data-node-toolbar-action="color-region:icon" data-color-region="icon">图标</button>
        <button type="button" data-node-toolbar-action="color-region:body-fill" data-color-region="body-fill">背景</button>
      </div>
      <div class="node-style-panel-title secondary" data-node-fill-region-label>背景</div>
      <div class="node-color-grid">${nodeToolbarSwatches('color-preset:fill')}<button type="button" class="node-color-swatch transparent" data-node-toolbar-action="color-transparent:fill" aria-label="透明背景" title="透明背景"></button></div>
      <button type="button" class="node-custom-color-btn" data-node-toolbar-action="color-custom:fill">${NODE_TOOLBAR_ICONS.palette}<span>自定义颜色</span></button>
    </section>
    <section class="node-style-popover node-style-border-panel" data-node-style-panel="border" hidden aria-label="边框设置">
      <div class="node-style-panel-title">边框</div>
      <div class="node-style-icon-grid compact">
        ${nodeToolbarIconButton('border:toggle','显示或隐藏边框',NODE_TOOLBAR_ICONS.eye,'data-value="visible"')}
        ${nodeToolbarIconButton('border-style:solid','实线',NODE_TOOLBAR_ICONS.borderSolid,'data-value="solid"')}
        ${nodeToolbarIconButton('border-style:dashed','虚线',NODE_TOOLBAR_ICONS.borderDashed,'data-value="dashed"')}
        ${nodeToolbarIconButton('border-style:dotted','点线',NODE_TOOLBAR_ICONS.borderDotted,'data-value="dotted"')}
      </div>
      <div class="node-color-grid">${nodeToolbarSwatches('color-preset:border')}</div>
      <button type="button" class="node-custom-color-btn" data-node-toolbar-action="color-custom:border">${NODE_TOOLBAR_ICONS.palette}<span>自定义颜色</span></button>
      <div class="node-style-control-row node-border-width-row"><label>粗细<input type="range" data-node-style-input="border-width" min="0" max="8" step="1" value="1" aria-label="边框粗细"></label><output data-node-style-output="border-width">1px</output></div>
    </section>
    <section class="node-style-popover node-style-color-panel node-style-text-color-panel" data-node-style-panel="text-color" hidden aria-label="文字颜色与文字背景">
      <div class="node-style-panel-title">文字颜色</div>
      <div class="node-color-grid">${nodeToolbarSwatches('color-preset:text')}</div>
      <button type="button" class="node-custom-color-btn" data-node-toolbar-action="color-custom:text">${NODE_TOOLBAR_ICONS.palette}<span>自定义文字颜色</span></button>
      <div class="node-style-panel-title secondary">文字背景</div>
      <div class="node-color-grid">${nodeToolbarSwatches('color-preset:text-bg')}<button type="button" class="node-color-swatch transparent" data-node-toolbar-action="color-transparent:text-bg" aria-label="无文字背景" title="无文字背景"></button></div>
      <button type="button" class="node-custom-color-btn" data-node-toolbar-action="color-custom:text-bg">${NODE_TOOLBAR_ICONS.palette}<span>自定义文字背景</span></button>
    </section>
    <section class="node-style-popover node-style-font-family-panel" data-node-style-panel="font-family" hidden aria-label="文本字体">
      <div class="node-style-panel-title">文本字体</div>
      <div class="node-style-icon-grid font-family-grid">
        ${nodeToolbarIconButton('font-family:system','系统默认字体','<span class="font-family-icon system">Aa</span>','data-value="system"')}
        ${nodeToolbarIconButton('font-family:sans','无衬线字体','<span class="font-family-icon sans">黑</span>','data-value="sans"')}
        ${nodeToolbarIconButton('font-family:serif','衬线字体','<span class="font-family-icon serif">宋</span>','data-value="serif"')}
        ${nodeToolbarIconButton('font-family:kai','楷体','<span class="font-family-icon kai">楷</span>','data-value="kai"')}
        ${nodeToolbarIconButton('font-family:mono','等宽字体','<span class="font-family-icon mono">M</span>','data-value="mono"')}
      </div>
    </section>
    <section class="node-style-popover node-style-font-size-panel" data-node-style-panel="font-size" hidden aria-label="字号">
      <div class="node-style-panel-title">字号</div>
      <div class="node-style-icon-grid font-size-grid numeric">${fontSizeButtons}</div>
      <div class="node-style-control-row node-font-size-row"><label>自定义<input type="number" data-node-style-input="font-size" min="6" max="288" step="1" value="15" aria-label="自定义字号"></label><output data-node-style-output="font-size">15px</output></div>
    </section>
    <section class="node-style-popover node-style-font-style-panel" data-node-style-panel="font-style" hidden aria-label="文字样式">
      <div class="node-style-panel-title">文字样式</div>
      <div class="node-style-icon-grid font-style-grid">${nodeToolbarIconButton('font-bold','加粗',NODE_TOOLBAR_ICONS.bold)}${nodeToolbarIconButton('font-italic','斜体',NODE_TOOLBAR_ICONS.italic)}${nodeToolbarIconButton('font-underline','下划线',NODE_TOOLBAR_ICONS.underline)}${nodeToolbarIconButton('font-strike','删除线',NODE_TOOLBAR_ICONS.strike)}</div>
    </section>
    <section class="node-style-popover node-style-line-height-panel" data-node-style-panel="line-height" hidden aria-label="行高">
      <div class="node-style-panel-title">行高</div>
      <div class="node-style-icon-grid line-height-grid">${lineHeightButtons}</div>
      <div class="node-style-control-row node-line-height-row"><label>自定义<input type="number" data-node-style-input="line-height" min="0.8" max="3" step="0.05" value="1.25" aria-label="自定义行高"></label><output data-node-style-output="line-height">1.25</output></div>
    </section>
    <section class="node-style-popover" data-node-style-panel="text-align" hidden aria-label="文字对齐">
      <div class="node-style-icon-grid">${nodeToolbarIconButton('text-align:left','文字左对齐',NODE_TOOLBAR_ICONS.left,'data-value="left"')}${nodeToolbarIconButton('text-align:center','文字居中',NODE_TOOLBAR_ICONS.center,'data-value="center"')}${nodeToolbarIconButton('text-align:right','文字右对齐',NODE_TOOLBAR_ICONS.right,'data-value="right"')}</div>
    </section>
    <section class="node-style-popover node-style-node-size-panel" data-node-style-panel="node-size" hidden aria-label="卡牌尺寸">
      <div class="node-style-panel-title">卡牌尺寸</div>
      <div class="node-style-icon-grid">${nodeToolbarIconButton('node-size:small','紧凑卡牌','<span class="size-preset-icon compact"></span>','data-value="small"')}${nodeToolbarIconButton('node-size:default','标准卡牌','<span class="size-preset-icon standard"></span>','data-value=""')}${nodeToolbarIconButton('node-size:big','大卡牌','<span class="size-preset-icon large"></span>','data-value="big"')}</div>
    </section>
    <section class="node-style-popover node-style-align-panel" data-node-style-panel="align" hidden aria-label="节点对齐">
      <div class="node-style-icon-grid align-grid">${nodeToolbarIconButton('align:left','左边缘对齐',NODE_TOOLBAR_ICONS.left,'data-align-min="2"')}${nodeToolbarIconButton('align:center-x','水平居中对齐',NODE_TOOLBAR_ICONS.center,'data-align-min="2"')}${nodeToolbarIconButton('align:right','右边缘对齐',NODE_TOOLBAR_ICONS.right,'data-align-min="2"')}${nodeToolbarIconButton('align:top','顶部对齐',NODE_TOOLBAR_ICONS.top,'data-align-min="2"')}${nodeToolbarIconButton('align:center-y','垂直居中对齐',NODE_TOOLBAR_ICONS.middle,'data-align-min="2"')}${nodeToolbarIconButton('align:bottom','底部对齐',NODE_TOOLBAR_ICONS.bottom,'data-align-min="2"')}${nodeToolbarIconButton('align:distribute-x','水平等距分布',NODE_TOOLBAR_ICONS.distributeX,'data-align-min="3"')}${nodeToolbarIconButton('align:distribute-y','垂直等距分布',NODE_TOOLBAR_ICONS.distributeY,'data-align-min="3"')}</div>
    </section>
    <section class="node-style-popover node-style-more-panel" data-node-style-panel="more" hidden aria-label="更多设置">
      <div class="node-style-icon-grid">${nodeToolbarIconButton('more:copy','复制',NODE_TOOLBAR_ICONS.copy)}${nodeToolbarIconButton('more:reset','恢复当前类型默认样式',NODE_TOOLBAR_ICONS.reset)}${nodeToolbarIconButton('more:delete','删除',NODE_TOOLBAR_ICONS.trash)}</div>
    </section>`;
}
function applyNodeToolbarAppearance(patch,label){
  const ids=nodeToolbarSelectedIds();if(!ids.length)return false;
  if(rejectLockedNodeAction(label||'修改样式',ids))return false;
  const controller=ensureGraphStyleController();if(!controller)return false;
  controller.updateAppearance(ids,patch,ids.length>1?`批量${label}（${ids.length} 张）`:label);
  updateNodeStyleToolbarControls();return true;
}
function applyTextElementAppearance(patch,label){
  const item=nodeToolbarTextElement();if(!item)return false;
  const history=ensureGraphHistoryController(),mutate=()=>{window.KGGraphModel.updateTextElementAppearance(item,patch);fitTextElementToContent(item);return item};
  if(history)history.run(label,mutate);else mutate();
  const defaultMap={textColor:'textElementTextColor',textBackgroundColor:'textElementTextBackgroundColor',textBackgroundOpacity:'textElementTextBackgroundOpacity',textAlign:'textElementTextAlign',fontSize:'textElementFontSize',fontFamily:'textElementFontFamily',fontWeight:'textElementFontWeight',fontStyle:'textElementFontStyle',underline:'textElementUnderline',strikeThrough:'textElementStrikeThrough',lineHeight:'textElementLineHeight'};
  Object.entries(defaultMap).forEach(([field,key])=>{if(Object.prototype.hasOwnProperty.call(patch,field))state.defaults[key]=patch[field]});
  updateTextElementAppearanceDom(item.id);save();return true;
}
function applyNodeToolbarCardStyle(cardStyle){
  const ids=nodeToolbarSelectedIds();if(!ids.length)return false;
  if(rejectLockedNodeAction('切换节点类型',ids))return false;
  const controller=ensureGraphStyleController();if(!controller)return false;
  if(typeof controller.applyCardStyle==='function')controller.applyCardStyle(ids,cardStyle,ids.length>1?`批量切换 ${ids.length} 张节点类型`:'切换节点类型');
  else applyNodeToolbarAppearance({cardStyle},'切换节点类型');
  updateNodeStyleToolbarControls();return true;
}
function nodeToolbarDocumentColors(){
  const colors=[];
  for(const node of state.nodes||[]){
    const appearance=window.KGGraphModel.appearanceOf(node);
    colors.push(appearance.headerIconColor,appearance.fillColor,appearance.headerFillColor,appearance.bodyFillColor,appearance.borderColor,appearance.textColor,appearance.headerTextColor,appearance.bodyTextColor,appearance.textBackgroundColor);
  }
  for(const item of state.elements||[]){const appearance=window.KGGraphModel.textElementAppearanceOf(item);colors.push(appearance.textColor,appearance.textBackgroundColor)}
  return colors.filter(Boolean);
}
function activeNodeFillColorKind(){
  const primary=nodeToolbarPrimaryNode();
  if(!primary)return'fill';
  const appearance=window.KGGraphModel.appearanceOf(primary);
  if(appearance.cardStyle!=='standard')return'fill';
  return nodeFillColorRegion==='icon'?'icon':'body-fill';
}
function nodeColorLabel(kind){
  return kind==='icon'?'图标':kind==='fill'||kind==='body-fill'?'背景':kind==='border'?'边框':kind==='text-bg'?'文字背景':'文字';
}
function nodeColorValue(appearance,kind){
  if(kind==='icon')return{color:appearance.headerIconColor||appearance.color,opacity:1};
  if(kind==='body-fill')return{color:appearance.bodyFillColor||appearance.fillColor,opacity:appearance.fillOpacity};
  if(kind==='fill')return{color:appearance.fillColor,opacity:appearance.fillOpacity};
  if(kind==='border')return{color:appearance.borderColor,opacity:appearance.borderOpacity};
  if(kind==='text-bg')return{color:appearance.textBackgroundColor,opacity:appearance.textBackgroundOpacity};
  return{color:appearance.bodyTextColor||appearance.textColor,opacity:1};
}
function nodeColorPatch(kind,value={}){
  const color=safeColor(value.color,'#0f172a'),opacity=Math.max(0,Math.min(1,Number(value.opacity))),alpha=Number.isFinite(opacity)?opacity:1;
  if(kind==='icon')return{headerIconColor:color};
  if(kind==='fill')return{fillColor:color,fillOpacity:alpha,bodyFillColor:color};
  if(kind==='body-fill')return{fillColor:color,bodyFillColor:color,fillOpacity:alpha};
  if(kind==='border')return{borderColor:color,borderOpacity:alpha,borderVisible:alpha>0};
  if(kind==='text-bg')return{textBackgroundColor:color,textBackgroundOpacity:alpha};
  return{textColor:color,bodyTextColor:color};
}
function restoreNodeColorEditSession(session=nodeColorEditSession){
  if(!session)return;const model=window.KGGraphModel;
  if(session.entityType==='text-element'){
    for(const [id,appearance] of session.originals){const item=textElementById(id);if(item){item.appearance={...appearance};model.syncTextElement(item);updateTextElementAppearanceDom(id)}}
    return;
  }
  for(const [id,appearance] of session.originals){const node=nodeById(id);if(!node)continue;node.appearance={...appearance};model.syncLegacy(node)}
  render({mode:'appearance',ids:session.ids,persist:false});
}
function beginNodeColorEdit(kind){
  const textItem=nodeToolbarTextElement();
  if(textItem){if(kind!=='text'&&kind!=='text-bg')return false;if(nodeColorEditSession)restoreNodeColorEditSession();nodeColorEditSession={kind,entityType:'text-element',ids:[textItem.id],originals:new Map([[textItem.id,{...window.KGGraphModel.textElementAppearanceOf(textItem)}]])};return true}
  const ids=nodeToolbarSelectedIds();if(!ids.length)return false;
  if(nodeColorEditSession&&nodeColorEditSession.kind===kind&&nodeColorEditSession.ids.join('|')===ids.join('|'))return true;
  if(nodeColorEditSession){restoreNodeColorEditSession();nodeColorEditSession=null}
  nodeColorEditSession={kind,entityType:'node',ids,originals:new Map(ids.map(id=>[id,{...window.KGGraphModel.appearanceOf(nodeById(id))}]))};return true;
}
function previewNodeColorEdit(kind,value){
  if(!beginNodeColorEdit(kind))return;const patch=nodeColorPatch(kind,value),session=nodeColorEditSession;
  if(session.entityType==='text-element'){const item=textElementById(session.ids[0]);if(item){window.KGGraphModel.updateTextElementAppearance(item,patch);updateTextElementAppearanceDom(item.id)}return}
  for(const id of session.ids){const node=nodeById(id);if(node)window.KGGraphModel.updateAppearance(node,patch)}render({mode:'appearance',ids:session.ids,persist:false});
}
function commitNodeColorEdit(kind,value){
  if(!nodeColorEditSession||nodeColorEditSession.kind!==kind)beginNodeColorEdit(kind);const session=nodeColorEditSession;if(!session)return;
  restoreNodeColorEditSession(session);nodeColorEditSession=null;const label=`修改${nodeColorLabel(kind)}颜色`;
  if(session.entityType==='text-element')applyTextElementAppearance(nodeColorPatch(kind,value),label);else applyNodeToolbarAppearance(nodeColorPatch(kind,value),label);
}
function cancelNodeColorEdit(){if(!nodeColorEditSession)return;const session=nodeColorEditSession;nodeColorEditSession=null;restoreNodeColorEditSession(session)}
function ensureNodeFloatingColorWindow(){
  if(nodeFloatingColorWindowController)return nodeFloatingColorWindowController;const factory=window.KGGraphFloatingColorWindowController;if(!factory||typeof factory.create!=='function')return null;
  nodeFloatingColorWindowController=factory.create({stage});return nodeFloatingColorWindowController;
}
function openNodeCustomColor(kind,anchor,event=null){
  const item=nodeToolbarTextElement(),primary=nodeToolbarPrimaryNode();if(item&&kind!=='text'&&kind!=='text-bg')return false;if(!item&&!primary)return false;
  const resolvedKind=!item&&kind==='fill'?activeNodeFillColorKind():kind;
  const appearance=item?window.KGGraphModel.textElementAppearanceOf(item):window.KGGraphModel.appearanceOf(primary);
  const value=nodeColorValue(appearance,resolvedKind);
  const controller=ensureNodeFloatingColorWindow();if(!controller)return false;nodeStyleToolbarController?.closePanels();
  const textKind=resolvedKind==='text'||resolvedKind==='icon';
  controller.open({kind:resolvedKind,title:`自定义${nodeColorLabel(resolvedKind)}颜色`,anchor:cardQuickActionsEl||anchor,pointer:event?{x:event.clientX,y:event.clientY}:null,value,allowOpacity:!textKind,allowTransparent:['fill','body-fill','text-bg'].includes(resolvedKind),presets:NODE_TOOLBAR_COLOR_PRESETS,documentColors:nodeToolbarDocumentColors(),documentLabel:'当前图谱',onStart:()=>beginNodeColorEdit(resolvedKind),onPreview:value=>previewNodeColorEdit(resolvedKind,value),onCommit:value=>commitNodeColorEdit(resolvedKind,value),onCancel:cancelNodeColorEdit});return true;
}
function ensureNodeColorPickers(){return null}
function ensureNodeInlineTextEditorController(){
  if(nodeInlineTextEditorController)return nodeInlineTextEditorController;
  const factory=window.KGGraphInlineTextEditorController;if(!factory||typeof factory.create!=='function')return null;
  nodeInlineTextEditorController=factory.create({
    onStart:()=>{stage.classList.add('graph-inline-text-editing');if(nodeStyleToolbarController)nodeStyleToolbarController.hide();nodeFloatingColorWindowController?.close({cancel:true})},
    onEnd:()=>stage.classList.remove('graph-inline-text-editing'),
    onCommit:({nodeId,entityType,value})=>{
      if(entityType==='text-element'){const item=textElementById(nodeId);if(!item)return;const history=ensureGraphHistoryController(),mutate=()=>{window.KGGraphModel.updateTextElementContent(item,{text:value});fitTextElementToContent(item);return item};if(history)history.run('修改文本框文字',mutate);else mutate();render({persist:true});showStatus('文本框文字已保存，可按 Ctrl/Command+Z 撤销。');return}
      const node=nodeById(nodeId),controller=ensureGraphStyleController();if(!node||!controller)return;controller.updateContent([nodeId],{title:value},`修改“${node.title}”文字`);showStatus('节点文字已保存，可按 Ctrl/Command+Z 撤销。');
    },
    onOutsideCommit:({nodeId,textElementId})=>{
      if(nodeId&&nodeById(nodeId)){
        state.selectedElementId=null;clearMultiSelection();clearHoverDetail(false);state.selectedNodeId=nodeId;state.selectedLinkId=null;state.linkSourceId=null;refreshSelectionUI();return;
      }
      if(textElementId&&textElementById(textElementId)){
        clearMultiSelection();state.selectedNodeId=null;state.selectedLinkId=null;state.linkSourceId=null;state.selectedElementId=textElementId;refreshSelectionUI();
      }
    },
    onCancel:()=>showStatus('已取消文字修改。')
  });
  return nodeInlineTextEditorController;
}
function duplicateSelectedTextElement(){
  const item=nodeToolbarTextElement();if(!item)return false;const model=window.KGGraphModel,copy=model.normalizeTextElement(cloneGraphValue(item),{idFactory:()=>uid('t')});copy.id=uid('t');model.updateTextElementGeometry(copy,{x:item.x+28,y:item.y+28});pushGraphUndoSnapshot('复制文本框');state.elements.push(copy);state.selectedElementId=copy.id;render({persist:true});showStatus('已复制文本框。');return true;
}
function deleteSelectedTextElement(){
  const item=nodeToolbarTextElement();if(!item)return false;pushGraphUndoSnapshot('删除文本框');state.elements=(state.elements||[]).filter(entry=>entry.id!==item.id);state.selectedElementId=null;nodeStyleToolbarController?.hide();render({persist:true});showStatus('文本框已删除，可撤销。');return true;
}
function handleNodeToolbarAction(action,button,event=null){
  const parts=String(action||'').split(':'),group=parts[0],value=parts[1],extra=parts.slice(2).join(':');
  const ids=nodeToolbarSelectedIds(),primary=nodeToolbarPrimaryNode(),textItem=nodeToolbarTextElement();if(!textItem&&(!ids.length||!primary))return;
  const lockedIds=!textItem?lockedNodeIdsFrom(ids):[];
  if(lockedIds.length&&group!=='lock'&&group!=='related-canvas'){
    rejectLockedNodeAction('使用此功能',ids);nodeStyleToolbarController?.closePanels();updateNodeStyleToolbarControls();return;
  }
  if(group==='color-region'&&!textItem){nodeFillColorRegion=value||'body-fill';updateNodeStyleToolbarControls();return}
  if(group==='lock'&&!textItem){
    const nodes=ids.map(id=>nodeById(id)).filter(Boolean),allLocked=nodes.length&&nodes.every(node=>window.KGGraphModel?.interactionOf?.(node).locked),history=ensureGraphHistoryController();
    const mutate=()=>nodes.forEach(node=>window.KGGraphModel?.updateInteraction?.(node,{locked:!allLocked}));
    if(history)history.run(allLocked?`解锁 ${nodes.length} 个节点`:`锁定 ${nodes.length} 个节点`,mutate);else mutate();
    if(!allLocked&&nodeFreeResizeModeId&&nodes.some(node=>node.id===nodeFreeResizeModeId))nodeFreeResizeModeId=null;
    render({mode:'selection',ids:nodes.map(node=>node.id),persist:true});showStatus(allLocked?'节点已解锁，全部功能已恢复。':'节点已完全锁定；仅保留打开相关画布与解锁。');return
  }
  if(group==='related-canvas'&&!textItem){
    setRelatedScopeCenter(primary.id);openRelatedCanvasModal(true);nodeStyleToolbarController?.closePanels();
  }else if(group==='color-preset'){
    const kind=!textItem&&value==='fill'?activeNodeFillColorKind():value,color=extra,patch=nodeColorPatch(kind,{color,opacity:1});
    if(textItem){
      if(kind==='text'||kind==='text-bg')applyTextElementAppearance(patch,kind==='text-bg'?'修改文字背景':'修改文字颜色');
    }else applyNodeToolbarAppearance(patch,kind==='icon'?'修改图标颜色':kind==='fill'||kind==='body-fill'?'修改背景颜色':kind==='border'?'修改边框颜色':kind==='text-bg'?'修改文字背景':'修改文字颜色');
  }else if(group==='color-transparent'){
    if(value==='fill'&&!textItem){const kind=activeNodeFillColorKind();if(kind==='icon')return;applyNodeToolbarAppearance(nodeColorPatch(kind,{color:nodeColorValue(window.KGGraphModel.appearanceOf(primary),kind).color,opacity:0}),`设置${nodeColorLabel(kind)}透明`);}
    else if(value==='text-bg'){
      if(textItem)applyTextElementAppearance({textBackgroundOpacity:0},'取消文字背景');
      else applyNodeToolbarAppearance({textBackgroundOpacity:0},'取消文字背景');
    }
  }else if(group==='color-custom')openNodeCustomColor(value,button,event);
  else if(textItem){
    const appearance=window.KGGraphModel.textElementAppearanceOf(textItem);
    if(group==='text-align')applyTextElementAppearance({textAlign:value},'修改文本框对齐');
    else if(group==='font-size')applyTextElementAppearance({fontSize:Number(value)},'修改文本框字号');
    else if(group==='font-family')applyTextElementAppearance({fontFamily:value},'修改文本框字体');
    else if(group==='font-bold')applyTextElementAppearance({fontWeight:appearance.fontWeight==='bold'?'normal':'bold'},appearance.fontWeight==='bold'?'取消文本框粗体':'设置文本框粗体');
    else if(group==='font-italic')applyTextElementAppearance({fontStyle:appearance.fontStyle==='italic'?'normal':'italic'},appearance.fontStyle==='italic'?'取消文本框斜体':'设置文本框斜体');
    else if(group==='font-underline')applyTextElementAppearance({underline:!appearance.underline},appearance.underline?'取消文本框下划线':'设置文本框下划线');
    else if(group==='font-strike')applyTextElementAppearance({strikeThrough:!appearance.strikeThrough},appearance.strikeThrough?'取消文本框删除线':'设置文本框删除线');
    else if(group==='line-height')applyTextElementAppearance({lineHeight:Number(value)},'修改文本框行高');
    else if(group==='more'&&value==='copy')duplicateSelectedTextElement();
    else if(group==='more'&&value==='delete')deleteSelectedTextElement();
    else if(group==='more'&&value==='reset')applyTextElementAppearance({textColor:'#0f172a',textBackgroundColor:'#ffffff',textBackgroundOpacity:0,textAlign:'center',fontSize:20,fontFamily:'system',fontWeight:'bold',fontStyle:'normal',underline:false,strikeThrough:false,lineHeight:1.45},'恢复文本框默认样式');
  }else if(group==='style'){applyNodeToolbarCardStyle(value);showStatus(ids.length>1?`已批量切换 ${ids.length} 张节点类型。`:'已切换节点类型。')}
  else if(group==='border-style')applyNodeToolbarAppearance({borderStyle:value,borderVisible:true},'修改边框线型');
  else if(group==='border'&&value==='toggle'){const current=window.KGGraphModel.appearanceOf(primary);applyNodeToolbarAppearance({borderVisible:!current.borderVisible},current.borderVisible?'隐藏边框':'显示边框')}
  else if(group==='text-align')applyNodeToolbarAppearance({textAlign:value},'修改文字对齐');
  else if(group==='font-size')applyNodeToolbarAppearance({fontSize:Number(value)},'修改字号');
  else if(group==='font-family')applyNodeToolbarAppearance({fontFamily:value},'修改文本字体');
  else if(group==='font-bold'){const appearance=window.KGGraphModel.appearanceOf(primary);applyNodeToolbarAppearance({fontWeight:appearance.fontWeight==='bold'?'normal':'bold'},appearance.fontWeight==='bold'?'取消文字粗体':'设置文字粗体')}
  else if(group==='font-italic'){const appearance=window.KGGraphModel.appearanceOf(primary);applyNodeToolbarAppearance({fontStyle:appearance.fontStyle==='italic'?'normal':'italic'},appearance.fontStyle==='italic'?'取消文字斜体':'设置文字斜体')}
  else if(group==='font-underline'){const appearance=window.KGGraphModel.appearanceOf(primary);applyNodeToolbarAppearance({underline:!appearance.underline},appearance.underline?'取消文字下划线':'设置文字下划线')}
  else if(group==='font-strike'){const appearance=window.KGGraphModel.appearanceOf(primary);applyNodeToolbarAppearance({strikeThrough:!appearance.strikeThrough},appearance.strikeThrough?'取消文字删除线':'设置文字删除线')}
  else if(group==='line-height')applyNodeToolbarAppearance({lineHeight:Number(value)},'修改行高');
  else if(group==='node-size')applyNodeToolbarAppearance({size:value==='default'?'':value},'修改卡牌尺寸');
  else if(group==='align'){
    const locked=ids.filter(id=>window.KGGraphModel?.interactionOf?.(nodeById(id)).locked);if(locked.length){showStatus(`选择中有 ${locked.length} 个锁定节点，已取消对齐。`);return}
    const controller=ensureGraphAlignmentController(),result=controller&&controller.align(ids,value,ids.length>2?`对齐 ${ids.length} 个节点`:'对齐节点');
    if(!result||!result.ok){showStatus(value.startsWith('distribute-')?'等距分布至少需要选择 3 个节点。':'节点对齐至少需要选择 2 个节点。');return}
    showStatus(`已完成 ${ids.length} 个节点的对齐，可撤销。`);
  }else if(group==='more'){
    if(value==='copy'){copySelectedGraphCards();nodeStyleToolbarController?.closePanels()}
    else if(value==='delete'){nodeStyleToolbarController?.closePanels();deleteGraphBatchSelection()}
    else if(value==='reset'){const style=window.KGGraphModel.appearanceOf(primary).cardStyle,controller=ensureGraphStyleController();controller&&controller.resetAppearance(ids,style,ids.length>1?`恢复 ${ids.length} 张节点默认样式`:'恢复节点默认样式');showStatus('已恢复当前节点类型的默认样式。')}
  }
  updateNodeStyleToolbarControls();
}
function bindNodeToolbarInputs(root){
  if(root.dataset.inputsBound==='1')return;root.dataset.inputsBound='1';
  root.addEventListener('change',event=>{
    const input=event.target.closest('[data-node-style-input]');if(!input)return;
    const kind=input.dataset.nodeStyleInput,textItem=nodeToolbarTextElement();
    if(kind==='border-width'&&!textItem)applyNodeToolbarAppearance({borderWidth:Number(input.value),borderVisible:Number(input.value)>0},'修改边框粗细');
    else if(kind==='font-size'){
      const patch={fontSize:Number(input.value)};
      if(textItem)applyTextElementAppearance(patch,'修改文本框字号');else applyNodeToolbarAppearance(patch,'修改字号');
    }else if(kind==='line-height'){
      const patch={lineHeight:Number(input.value)};
      if(textItem)applyTextElementAppearance(patch,'修改文本框行高');else applyNodeToolbarAppearance(patch,'修改行高');
    }
  });
  root.addEventListener('input',event=>{
    const input=event.target.closest('[data-node-style-input]');if(!input)return;
    const kind=input.dataset.nodeStyleInput,output=root.querySelector(`[data-node-style-output="${kind}"]`);
    if(output)output.textContent=kind==='font-size'?`${Number(input.value)}px`:kind==='border-width'?`${Number(input.value)}px`:String(Number(input.value));
  });
}
function updateNodeStyleToolbarControls(){
  if(!cardQuickActionsEl||cardQuickActionsEl.hidden)return;const textItem=nodeToolbarTextElement(),primary=nodeToolbarPrimaryNode(),ids=nodeToolbarSelectedIds(),root=cardQuickActionsEl;if(!textItem&&!primary)return;
  const appearance=textItem?window.KGGraphModel.textElementAppearanceOf(textItem):window.KGGraphModel.appearanceOf(primary);root.classList.toggle('text-element-context',!!textItem);
  const fillTrigger=root.querySelector('[data-node-toolbar-panel="fill"]');
  if(fillTrigger&&!textItem)fillTrigger.style.setProperty('--toolbar-color',safeColor(appearance.headerIconColor||appearance.color,DEFAULTS.nodeColor));
  const fillPanel=root.querySelector('[data-node-style-panel="fill"]'),standardRegion=!textItem&&appearance.cardStyle==='standard';
  if(fillPanel)fillPanel.classList.toggle('standard-region-enabled',standardRegion);
  root.querySelectorAll('[data-color-region]').forEach(btn=>{btn.hidden=!standardRegion;btn.classList.toggle('active',standardRegion&&btn.dataset.colorRegion===nodeFillColorRegion)});
  const regionLabel=root.querySelector('[data-node-fill-region-label]');if(regionLabel)regionLabel.textContent=standardRegion?nodeColorLabel(activeNodeFillColorKind()):'背景';
  const allLocked=!textItem&&ids.length&&ids.every(id=>isNodeFullyLocked(id));
  const lockedContextChanged=root.classList.contains('locked-context')!==!!allLocked;
  root.classList.toggle('locked-context',!!allLocked);
  if(allLocked)nodeStyleToolbarController?.closePanels?.();
  if(lockedContextChanged)requestAnimationFrame(()=>nodeStyleToolbarController?.position?.());
  const lockBtn=root.querySelector('[data-node-toolbar-action="lock"]');if(lockBtn){lockBtn.hidden=!!textItem;lockBtn.classList.toggle('active',!!allLocked);lockBtn.setAttribute('aria-pressed',allLocked?'true':'false');lockBtn.setAttribute('aria-label',allLocked?'解锁节点':'完全锁定节点');lockBtn.dataset.tooltip=allLocked?'解锁节点':'完全锁定节点';lockBtn.innerHTML=allLocked?window.KGGraphNodeToolbarController.icons?.lock||lockBtn.innerHTML:window.KGGraphNodeToolbarController.icons?.unlock||lockBtn.innerHTML}
  ['type','fill','border','node-size','align'].forEach(name=>{const btn=root.querySelector(`[data-node-toolbar-panel="${name}"]`);if(btn)btn.hidden=!!textItem});const relatedCanvasBtn=root.querySelector('[data-node-toolbar-action="related-canvas"]');if(relatedCanvasBtn)relatedCanvasBtn.hidden=!!textItem;
  root.querySelectorAll('[data-value]').forEach(btn=>{
    const action=btn.dataset.nodeToolbarAction||'',value=btn.dataset.value;let active=false;
    if(!textItem&&action.startsWith('style:'))active=appearance.cardStyle===value;
    else if(!textItem&&action.startsWith('border-style:'))active=appearance.borderStyle===value;
    else if(action.startsWith('text-align:'))active=appearance.textAlign===value;
    else if(action.startsWith('font-size:'))active=Math.abs(Number(appearance.fontSize)-Number(value))<.01;
    else if(action.startsWith('font-family:'))active=appearance.fontFamily===value;
    else if(action.startsWith('line-height:'))active=Math.abs(Number(appearance.lineHeight)-Number(value))<.01;
    else if(!textItem&&action.startsWith('node-size:'))active=(appearance.size||'')===value;
    else if(!textItem&&action==='border:toggle')active=appearance.borderVisible;
    btn.classList.toggle('active',active)
  });
  const toggles={
    'font-bold':appearance.fontWeight==='bold',
    'font-italic':appearance.fontStyle==='italic',
    'font-underline':!!appearance.underline,
    'font-strike':!!appearance.strikeThrough
  };
  Object.entries(toggles).forEach(([action,active])=>{const btn=root.querySelector(`[data-node-toolbar-action="${action}"]`);if(btn){btn.classList.toggle('active',active);btn.setAttribute('aria-pressed',active?'true':'false')}});
  const fontStyleTrigger=root.querySelector('[data-node-toolbar-panel="font-style"]');if(fontStyleTrigger){const activeCount=Object.values(toggles).filter(Boolean).length;fontStyleTrigger.classList.toggle('active',activeCount>0);fontStyleTrigger.setAttribute('aria-pressed',activeCount>0?'true':'false')}
  const widthInput=root.querySelector('[data-node-style-input="border-width"]');if(widthInput&&!textItem)widthInput.value=String(appearance.borderWidth);const widthOut=root.querySelector('[data-node-style-output="border-width"]');if(widthOut&&!textItem)widthOut.textContent=appearance.borderWidth+'px';
  const fontInput=root.querySelector('[data-node-style-input="font-size"]');if(fontInput)fontInput.value=String(appearance.fontSize||15);const fontOut=root.querySelector('[data-node-style-output="font-size"]');if(fontOut)fontOut.textContent=Number(appearance.fontSize||15)+'px';
  const lineInput=root.querySelector('[data-node-style-input="line-height"]');if(lineInput)lineInput.value=String(appearance.lineHeight||1.25);const lineOut=root.querySelector('[data-node-style-output="line-height"]');if(lineOut)lineOut.textContent=String(Number(appearance.lineHeight||1.25));
  root.querySelectorAll('.node-color-swatch[data-color]').forEach(btn=>{
    const action=btn.dataset.nodeToolbarAction||'',rawKind=action.split(':')[1],kind=!textItem&&rawKind==='fill'?activeNodeFillColorKind():rawKind,current=nodeColorValue(appearance,kind).color;
    btn.classList.toggle('active',String(btn.dataset.color).toLowerCase()===String(current).toLowerCase())
  });
  root.querySelectorAll('[data-align-min]').forEach(btn=>{btn.disabled=textItem||ids.length<Number(btn.dataset.alignMin||2)});const alignTrigger=root.querySelector('[data-node-toolbar-panel="align"]');if(alignTrigger)alignTrigger.disabled=textItem||ids.length<2;
}
function ensureCardQuickActions(){
  if(cardQuickActionsEl&&stage.contains(cardQuickActionsEl))return cardQuickActionsEl;const factory=window.KGGraphNodeToolbarController;
  if(!factory||typeof factory.create!=='function'){cardQuickActionsEl=document.createElement('div');cardQuickActionsEl.id='cardQuickActions';cardQuickActionsEl.className='card-context-actions';cardQuickActionsEl.dataset.stageUi='true';stage.appendChild(cardQuickActionsEl);return cardQuickActionsEl}
  nodeStyleToolbarController=factory.create({stage,gap:14,getAnchor:()=>state.selectedElementId?textElementDomByIdValue(state.selectedElementId):cardElementByNodeId(state.selectedNodeId||nodeToolbarSelectedIds()[0]),getAnchorRect:()=>window.KGHomeCanvasRuntime?.selectionFilter?.hasSnapshot?.()?homeSelectionAnchorRect():null,buildPanels:buildNodeStyleToolbarPanels,onAction:(action,button,event)=>handleNodeToolbarAction(action,button,event),onPanelOpen:()=>updateNodeStyleToolbarControls()});
  cardQuickActionsEl=nodeStyleToolbarController.ensure();bindNodeToolbarInputs(cardQuickActionsEl);return cardQuickActionsEl;
}
function updateCardQuickActionsPosition(){if(nodeStyleToolbarController)nodeStyleToolbarController.position();if(nodeFloatingColorWindowController)nodeFloatingColorWindowController.reposition()}
function updateCardQuickActions(){
  if(!graphModeAllows('nodeToolbar')){if(nodeStyleToolbarController)nodeStyleToolbarController.hide();else if(cardQuickActionsEl)cardQuickActionsEl.classList.remove('show');return}
  const ids=nodeToolbarSelectedIds(),primary=nodeToolbarPrimaryNode(),textItem=nodeToolbarTextElement();
  const filter=window.KGHomeCanvasRuntime?.selectionFilter,snapshot=filter?.snapshot?.()||{total:ids.length+(textItem?1:0),categories:[]};
  const activeType=filter?.getActiveType?.()||'',mixed=!activeType&&snapshot.categories?.length>1;
  const total=Math.max(Number(snapshot.total)||0,ids.length+selectedTextElementIds.size+selectedLinkIds.size);
  if(boxSelect||cardDrag||stage.classList.contains('graph-box-selecting')||(!textItem&&(!ids.length||!primary))||isCanvasPanMode()||document.body.classList.contains('auth-readonly')){if(nodeStyleToolbarController)nodeStyleToolbarController.hide();else if(cardQuickActionsEl)cardQuickActionsEl.classList.remove('show');return}
  const el=ensureCardQuickActions();if(!el)return;if(!nodeStyleToolbarController){el.classList.remove('show');return}
  nodeStyleToolbarController.show({nodeId:textItem?textItem.id:primary.id,selectionCount:total||1});
  el.classList.toggle('mixed-selection-context',mixed);
  filter?.mountInto?.(el.querySelector('.node-style-toolbar-main'),{afterSelector:'[data-node-toolbar-drag]'});
  nodeStyleToolbarController.position();
  filter?.refreshPosition?.(homeSelectionAnchorRect());
  updateNodeStyleToolbarControls();
}

function renderDetails(){
  const l=linkById(state.selectedLinkId),n=nodeById(state.selectedNodeId||(!state.selectedLinkId?hoverDetailNodeId:null)),isHoverPreview=!state.selectedNodeId&&!state.selectedLinkId&&!!hoverDetailNodeId;
  if(!n&&!l){detailPanel.classList.remove('show','hover-preview','detail-actions-expanded');detailPanel.innerHTML='';return}
  detailPanel.classList.remove('detail-actions-expanded');
  detailPanel.classList.toggle('hover-preview',!!isHoverPreview);
  const tools=`<button class="detail-actions-toggle detail-panel-control" id="detailActionsToggle" aria-expanded="false" title="展开操作"><span class="detail-actions-chevron" aria-hidden="true"><svg viewBox="0 0 24 24"><path d="m7 10 5 5 5-5"/></svg></span></button><button class="close-detail detail-panel-control" id="closeDetailBtn" aria-label="关闭详情"><span class="detail-close-icon" aria-hidden="true"><svg viewBox="0 0 24 24"><path d="m7 7 10 10M17 7 7 17"/></svg></span></button>`;
  if(l){const a=nodeById(l.from),b=nodeById(l.to),lineColor=safeColor(l.color,DEFAULTS.linkColor);detailPanel.innerHTML=`${tools}<div class="detail-top"><div class="detail-mini-icon" style="background:#2563eb">线</div><div><div class="detail-name">知识关系</div><div class="detail-title">${escapeHTML(a?a.title:'?')} ↔ ${escapeHTML(b?b.title:'?')}</div></div></div><div class="detail-grid"><div class="label">关系</div><div><span class="badge">${escapeHTML(l.type||'无文字关系')}</span></div><div class="label">线型</div><div>${l.lineStyle==='dashed'?'虚线':'实线'} ｜ <span style="display:inline-block;width:14px;height:14px;border-radius:4px;background:${lineColor};vertical-align:-2px;margin-right:4px"></span>${escapeHTML(lineColor)}</div><div class="label">备注</div><div>${escapeHTML(l.note||'暂无备注')}</div></div><div class="detail-actions"><button id="editLinkFromDetailBtn" class="primary">编辑关系</button><button id="deleteLinkFromDetailBtn" class="danger">删除线</button></div>`;detailPanel.classList.add('show');bindDetailBasics();$('editLinkFromDetailBtn').onclick=()=>openLinkModal(l.id);$('deleteLinkFromDetailBtn').onclick=()=>{if(confirm('确定删除这条知识关系吗？')){pushGraphUndoSnapshot('删除关系');state.links=state.links.filter(i=>i.id!==l.id);clearSelection({persist:true});showStatus('关系线已删除。')}};return}
  const nodeColor=safeColor(n.color),nodeRelation=relatedScopeRelationForNode(n.id),anchor=nodeById(currentRelatedScopeAnchorId()),relationInfo=nodeRelation?`<div class="label">局部关系</div><div>${nodeRelation.relatedCount} 个相关知识点 ｜ ${nodeRelation.linkCount} 条关系${largeGraphRelatedFocusEnabled?` ｜ 只看相关中心：${escapeHTML(anchor?anchor.title:n.title)}`:''}</div>`:'';
  const scopeButtons=largeGraphRelatedFocusEnabled?`<button id="setScopeCenterBtn">以当前卡牌为中心</button><button id="fitScopeFromDetailBtn">适配相关</button>${isRelatedGatherActive()?'<button id="exitGatherLayoutBtn">退出聚拢</button>':''}`:'';
  const locked=isNodeFullyLocked(n),lockedAttr=locked?' disabled aria-disabled="true"':'';
  detailPanel.innerHTML=`${tools}<div class="detail-top"><div class="detail-mini-icon" style="background:${nodeColor}">${escapeHTML((n.title||'?').slice(0,1))}</div><div><div class="detail-name">${escapeHTML(n.title||'未命名知识点')}</div><div class="detail-title">${escapeHTML(n.category||'未填写分类')} ${n.level?`｜${escapeHTML(n.level)}`:''}</div></div></div><div class="detail-grid">${relationInfo}<div class="label">关键词</div><div>${escapeHTML(n.keywords||'—')}</div><div class="label">说明</div><div>${escapeHTML(n.summary||'—')}</div><div class="label">学习提示</div><div>${escapeHTML(n.notes||'—')}</div></div><div class="detail-actions"><button id="editFromDetailBtn" class="primary"${lockedAttr}>编辑知识点</button>${scopeButtons}<button id="toggleSourceBtn"${lockedAttr}>${state.linkSourceId===n.id?'取消起点':'设为连线起点'}</button><button id="deleteNodeFromDetailBtn" class="danger"${lockedAttr}>删除知识点</button></div>`;
  detailPanel.classList.add('show');bindDetailBasics();$('editFromDetailBtn').onclick=()=>openNodeModal(n.id);const setScopeBtn=$('setScopeCenterBtn');if(setScopeBtn)setScopeBtn.onclick=()=>setRelatedScopeCenter(n.id);const fitScopeBtn=$('fitScopeFromDetailBtn');if(fitScopeBtn)fitScopeBtn.onclick=()=>fitRelatedScopeToView(true);const exitGatherBtn=$('exitGatherLayoutBtn');if(exitGatherBtn)exitGatherBtn.onclick=()=>clearRelatedGatherLayout({render:true,message:true});$('toggleSourceBtn').onclick=()=>{if(isNodeFullyLocked(n)){showStatus('该节点已锁定，不能建立关系；请先解锁。');return}const connection=ensureGraphConnectionController();if(state.linkSourceId===n.id){if(connection)connection.cancel();else state.linkSourceId=null}else if(connection)connection.setSource(n.id);else state.linkSourceId=n.id;showStatus(state.linkSourceId?`“${n.title}”已设为连线起点。`:'已取消连线起点。');render({mode:'selection'})};$('deleteNodeFromDetailBtn').onclick=()=>deleteNode(n.id);
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
  window.KGHomeCanvasRuntime?.selectionFilter?.clear?.({reason:'direct-node',apply:false});
  if(nodeFloatingColorWindowController)nodeFloatingColorWindowController.close({cancel:true});
  state.selectedElementId=null;
  clearMultiSelection();
  clearHoverDetail(false);
  state.selectedLinkId=null;
  const clicked=nodeById(id);if(!clicked)return;
  let changed=false;
  if(state.linkSourceId&&state.linkSourceId!==id){
    const source=state.linkSourceId,a=nodeById(source),b=clicked,connection=ensureGraphConnectionController();
    if(isNodeFullyLocked(a)||isNodeFullyLocked(b)){
      if(connection)connection.cancel();else state.linkSourceId=null;
      state.selectedNodeId=id;showStatus('锁定节点不能建立或接收关系线；请先解锁。');refreshSelectionUI();return;
    }
    if(relationExists(source,id)){
      if(connection)connection.cancel();else state.linkSourceId=null;
      const existing=linksForNodeId(source).find(link=>(link.from===source&&link.to===id)||(link.from===id&&link.to===source));
      state.selectedLinkId=existing?existing.id:null;
      showStatus(`“${a?a.title:'起点'}”与“${b.title}”之间已有关系线。`);
    }else{
      pushGraphUndoSnapshot(`建立“${a?a.title:'起点'}”到“${b.title}”的关系`);
      const result=connection?connection.connectTo(id):null;
      if(result&&result.ok){changed=true;showStatus(`已建立关系：${a?a.title:'起点'} → ${b.title}`)}
      else{
        const link=makeLink(source,id,'','',state.defaults.linkStyle,state.defaults.linkColor,state.defaults.linkPathStyle);
        state.links.push(link);state.selectedLinkId=link.id;state.selectedNodeId=null;state.linkSourceId=null;changed=true;
        showStatus(`已建立关系：${a?a.title:'起点'} → ${b.title}`);
      }
    }
  }else{
    state.selectedNodeId=id;
    if(largeGraphRelatedFocusEnabled&&!currentRelatedScopeAnchorId())relatedScopeAnchorNodeId=id;
    const relation=largeGraphRelationState();
    showStatus(relation&&relationLayerEnabled()?`已查看“${clicked.title}”：${relation.relatedCount} 个相关知识点，${relation.linkCount} 条关系。`:`已查看“${clicked.title}”。需要连线时请使用工具栏“连线”或卡牌连接手柄。`);
  }
  refreshSelectionUI({persist:changed});
}
function activateLinkSource(id){
  window.KGHomeCanvasRuntime?.selectionFilter?.clear?.({reason:'direct-link-source',apply:false});
  state.selectedElementId=null;
  clearMultiSelection();
  clearHoverDetail(false);
  const n=nodeById(id);if(!n)return;
  if(isNodeFullyLocked(n)){showStatus('该节点已锁定，不能作为连线起点；请先解锁。');return}
  const connection=ensureGraphConnectionController();if(connection)connection.setSource(id);else{state.selectedLinkId=null;state.selectedNodeId=id;state.linkSourceId=id}
  showStatus(`“${n.title}”已设为连线起点，请单击另一个知识点建立关系。`);
  refreshSelectionUI();
}
function selectLink(id,event=null){
  if(!graphModeAllows('edgeSelect'))return false;
  window.KGHomeCanvasRuntime?.selectionFilter?.clear?.({reason:'direct-edge',apply:false});
  if(nodeFloatingColorWindowController)nodeFloatingColorWindowController.close({cancel:true});
  const l=linkById(id);if(!l)return;state.selectedElementId=null;clearHoverDetail(false);setSelectedEdgeQuickStyleAnchorFromEvent(event);state.selectedNodeId=null;state.linkSourceId=null;
  const additive=!!(event&&(event.ctrlKey||event.metaKey||event.shiftKey));
  if(additive){
    if(state.selectedLinkId&&!selectedLinkIds.size)selectedLinkIds.add(String(state.selectedLinkId));
    if(selectedLinkIds.has(String(id)))selectedLinkIds.delete(String(id));else selectedLinkIds.add(String(id));
    state.selectedLinkId=selectedLinkIds.size===1?selectedLinkIds.values().next().value:null;
    selectedNodeIds.clear();
    showStatus(selectedLinkIds.size?`已选择 ${selectedLinkIds.size} 条关系线，可批量修改样式。`:'已取消关系线选择。');
  }else{
    clearMultiSelection();state.selectedLinkId=id;
    const a=nodeById(l.from),b=nodeById(l.to);showStatus(a&&b?`已选择关系：${a.title} ↔ ${b.title}。Ctrl/Command+单击可多选。`:'已选择关系线。');
  }
  refreshSelectionUI();
}
function clearSelection(options={}){if(options.preserveFilter!==true)window.KGHomeCanvasRuntime?.selectionFilter?.clear?.({reason:options.reason||'clear-selection',apply:false});if(nodeFloatingColorWindowController)nodeFloatingColorWindowController.close({cancel:true});if(nodeContextMenuController)nodeContextMenuController.hide();clearPendingNodeRightClick();nodeFreeResizeModeId=null;hoverDetailNodeId=null;clearTimeout(hoverDetailTimer);state.selectedElementId=null;selectedTextElementIds.clear();const controller=ensureGraphSelectionController();if(controller)controller.clearAll();else{clearMultiSelection();state.selectedNodeId=null;state.selectedLinkId=null;state.linkSourceId=null}refreshSelectionUI(options)}
function graphNodeRectsOverlap(x,y,w,h,node){const d=nodeDims(node),gap=12;return x<node.x+d.w+gap&&x+w+gap>node.x&&y<node.y+d.h+gap&&y+h+gap>node.y}
function findAvailableNodePosition(x,y,w,h){const origin={x:Math.round(x),y:Math.round(y)};for(let attempt=0;attempt<64;attempt++){const candidate={x:origin.x+(attempt%8)*36,y:origin.y+Math.floor(attempt/8)*36};if(!state.nodes.some(node=>graphNodeRectsOverlap(candidate.x,candidate.y,w,h,node)))return candidate}return{x:origin.x+36,y:origin.y+36}}
function createNodeAt(x,y){if(!graphModeAllows('editGraph'))return null;state.selectedElementId=null;const sub=window.KGSubscription;if(sub&&typeof sub.requireUsageLimit==='function'&&!sub.requireUsageLimit('graphNodes',state.nodes.length,1,{label:'图谱卡牌'}))return null;clearRelatedGatherLayout({render:false,message:false});clearMultiSelection();const size=state.defaults.nodeSize||'',color=safeColor(state.defaults.nodeColor,DEFAULTS.nodeColor),d=dimsForSize(size),position=findAvailableNodePosition(x-d.w/2,y-d.h/2,d.w,d.h),n=makeNode('新知识点',position.x,position.y,color,'','基础','','','',size);if(window.KGGraphModel)window.KGGraphModel.updateAppearance(n,{size,color,fillColor:state.defaults.nodeFillColor||'#ffffff',fillOpacity:Number.isFinite(Number(state.defaults.nodeFillOpacity))?Number(state.defaults.nodeFillOpacity):1,borderVisible:state.defaults.nodeBorderVisible!==false,borderColor:state.defaults.nodeBorderColor||'#cbd5e1',borderWidth:Number.isFinite(Number(state.defaults.nodeBorderWidth))?Number(state.defaults.nodeBorderWidth):1,borderStyle:state.defaults.nodeBorderStyle||'solid',borderOpacity:Number.isFinite(Number(state.defaults.nodeBorderOpacity))?Number(state.defaults.nodeBorderOpacity):1,textColor:state.defaults.nodeTextColor||'#0f172a',cardStyle:state.defaults.nodeCardStyle||DEFAULTS.nodeCardStyle,textAlign:state.defaults.nodeTextAlign||DEFAULTS.nodeTextAlign,fontSize:graphFontSizeNumber(state.defaults.nodeFontSize,15),fontFamily:state.defaults.nodeFontFamily||'system',fontWeight:state.defaults.nodeFontWeight||'bold',fontStyle:state.defaults.nodeFontStyle||'normal',underline:!!state.defaults.nodeUnderline,strikeThrough:!!state.defaults.nodeStrikeThrough,lineHeight:Number(state.defaults.nodeLineHeight)||1.25,textBackgroundColor:state.defaults.nodeTextBackgroundColor||'#ffffff',textBackgroundOpacity:Number(state.defaults.nodeTextBackgroundOpacity)||0,letterSpacing:0});pushGraphUndoSnapshot('新增知识点');state.nodes.push(n);state.selectedNodeId=n.id;state.selectedLinkId=null;state.linkSourceId=null;render({persist:true});openNodeModal(n.id,true);return n}
function createTextElementAt(x,y,options={}){
  if(!graphModeAllows('editGraph'))return null;
  const model=window.KGGraphModel;if(!model||typeof model.createTextElement!=='function')return null;
  clearRelatedGatherLayout({render:false,message:false});clearMultiSelection();
  const width=Math.max(24,Number(options.width)||240),height=Math.max(24,Number(options.height)||76),manualSize=options.manualSize===true||options.width!=null||options.height!=null;
  const item=model.createTextElement({
    content:{text:String(options.text||'点击编辑文字')},
    appearance:{textColor:state.defaults.textElementTextColor||'#0f172a',textBackgroundColor:state.defaults.textElementTextBackgroundColor||'#ffffff',textBackgroundOpacity:Number.isFinite(Number(state.defaults.textElementTextBackgroundOpacity))?Number(state.defaults.textElementTextBackgroundOpacity):0,textAlign:state.defaults.textElementTextAlign||'center',fontSize:state.defaults.textElementFontSize||20,fontFamily:state.defaults.textElementFontFamily||'system',fontWeight:state.defaults.textElementFontWeight||'bold',fontStyle:state.defaults.textElementFontStyle||'normal',underline:!!state.defaults.textElementUnderline,strikeThrough:!!state.defaults.textElementStrikeThrough,lineHeight:Number(state.defaults.textElementLineHeight)||1.45},
    geometry:{x:Math.round(x-width/2),y:Math.round(y-height/2),width,height,manualSize}
  },{idFactory:()=>uid('t')});
  pushGraphUndoSnapshot('新增文本框');state.elements=Array.isArray(state.elements)?state.elements:[];state.elements.push(item);
  state.selectedElementId=item.id;state.selectedNodeId=null;state.selectedLinkId=null;state.linkSourceId=null;
  if(options.edit===false&&!manualSize)fitTextElementToContent(item);
  render({persist:true});showStatus('已新增独立文本框；当前已选中，再次点击即可原位编辑文字。');
  if(options.edit===true)requestAnimationFrame(()=>startTextElementInlineEdit(item.id));
  return item;
}
function addTextElementAtCenter(){const r=stage.getBoundingClientRect(),p=screenToWorld(r.left+r.width/2,r.top+r.height/2);return createTextElementAt(p.x,p.y)}
window.KGGraphTextElements=Object.freeze({createAt:createTextElementAt,addAtCenter:addTextElementAtCenter,getAll:()=>cloneGraphValue(state.elements||[])});

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
  if(!results.length){
    if(state.selectedNodeId||state.selectedLinkId||selectedNodeIds.size||selectedLinkIds.size){clearSelection();refreshSelectionUI()}
    box.innerHTML='<div class="graph-search-empty">换一个关键词试试，例如分类、标题或关键词。</div>';return
  }
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
function hideGraphTransientMenus(){
  if(nodeInlineTextEditorController&&nodeInlineTextEditorController.isEditing())nodeInlineTextEditorController.commit();
  try{window.KGHomeToolbarRegistry?.hideTransientMenus?.()}catch(error){}
  if(nodeStyleToolbarController)nodeStyleToolbarController.hide();else if(cardQuickActionsEl)cardQuickActionsEl.classList.remove('show');
  if(nodeFloatingColorWindowController)nodeFloatingColorWindowController.close({cancel:true});
  if(nodeContextMenuController)nodeContextMenuController.hide();
  if(typeof hideSelectedEdgeQuickStylePanel==='function')hideSelectedEdgeQuickStylePanel();
  const zoomPopover=$('canvasZoomDock');if(zoomPopover)zoomPopover.classList.remove('slider-open');
}
window.hideGraphTransientMenus=hideGraphTransientMenus;
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
stage.addEventListener('pointerdown',beginLockedHomeSelectionPointer,true);
stage.addEventListener('pointermove',event=>{if(homeSelectionBoundsDrag)moveHomeSelectionBoundsDrag(event)},true);
stage.addEventListener('pointerup',event=>{if(homeSelectionBoundsDrag)finishHomeSelectionBoundsDrag(event,false);else finishLockedHomeSelectionDismiss(event,false)},true);
stage.addEventListener('pointercancel',event=>{if(homeSelectionBoundsDrag)finishHomeSelectionBoundsDrag(event,true);else finishLockedHomeSelectionDismiss(event,true)},true);
stage.addEventListener('pointerdown',e=>{
  if(typeof cancelGraphSmoothZoom==='function')cancelGraphSmoothZoom();
  const touchPan=e.pointerType==='touch';
  const rightPan=e.button===2;
  const panRequested=touchPan||rightPan||isCanvasPanMode()||currentGraphInteractionMode()==='reading';
  if(panRequested)hideGraphTransientMenus();
  if(!panRequested){
    if(e.button!==0)return;
    if(isUI(e.target))return;
    if(graphModeAllows('boxSelect'))startBoxSelection(e);
    else startStageEditTap(e);
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
function endStagePointer(e){
  if(!activePointers.has(e.pointerId))return;
  const wasPan=pan&&pan.id===e.pointerId,panMoved=pan&&pan.moved,pinchMoved=pinch&&pinch.moved,wasRightPan=e.pointerId===rightPanPointerId;
  activePointers.delete(e.pointerId);try{stage.releasePointerCapture(e.pointerId)}catch{}
  if(wasRightPan){rightPanPointerId=null;setTemporaryGraphPanMode(false,'right')}
  if(activePointers.size<2)pinch=null;
  if(activePointers.size===0){
    stage.classList.remove('panning');
    if(wasPan&&!panMoved&&!pinchMoved){
      if(wasRightPan)showCanvasContextMenu(e.clientX,e.clientY);
      else{clearSelection();showStatus('已关闭详情。')}
    }
    pan=null;commitViewportIfDirty();
  }else if(activePointers.size===1){const remain=[...activePointers.values()][0];pan={id:[...activePointers.keys()][0],x:remain.x,y:remain.y,vx:state.viewport.x,vy:state.viewport.y,moved:false}}
}
stage.addEventListener('dblclick',e=>{if(isCanvasPanMode()||isUI(e.target))return;const pt=screenToWorld(e.clientX,e.clientY);createNodeAt(pt.x,pt.y)});
function isTextEditingTarget(target){const el=target&&target.closest&&target.closest('input,textarea,select,[contenteditable]');return !!(el&&(!el.hasAttribute||el.getAttribute('contenteditable')!=='false'))}
document.addEventListener('keydown',e=>{if((e.code==='Space'||e.key===' ')&&!e.repeat&&!isTextEditingTarget(e.target)){setTemporaryGraphPanMode(true,'space');e.preventDefault()}});
document.addEventListener('keyup',e=>{if(e.code==='Space'||e.key===' '){setTemporaryGraphPanMode(false,'space');e.preventDefault()}});
updateGraphPointerModeUI();
stage.addEventListener('pointermove',e=>{lastGraphPointerWorldPosition=screenToWorld(e.clientX,e.clientY)},{passive:true});
stage.addEventListener('pointerdown',e=>{lastGraphPointerWorldPosition=screenToWorld(e.clientX,e.clientY)},{passive:true});
function selectAllGraphNodesFromShortcut(){
  state.selectedElementId=null;
  const ids=(state.nodes||[]).map(n=>n&&n.id).filter(Boolean);
  if(!ids.length){showStatus('当前图谱还没有知识点。');return true}
  clearHoverDetail(false);
  state.selectedLinkId=null;
  state.linkSourceId=null;
  const selection=ensureGraphSelectionController();if(selection)selection.selectNodes(ids,{primary:ids[0]});else{selectedNodeIds=new Set(ids);selectedLinkIds.clear();state.selectedNodeId=ids[0]||null}
  refreshSelectionUI();
  showStatus(`已全选 ${ids.length} 个知识点。按 Delete 可批量删除。`);
  return true;
}
function handleGraphClipboardShortcut(e){
  if(isTextEditingTarget(e.target)||e.altKey||!graphModeAllows('editGraph'))return;
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
  if(key==='y'||(key==='z'&&e.shiftKey)){
    if(restoreGraphRedoSnapshot()){e.preventDefault();e.stopPropagation()}
    return;
  }
  if(key==='z'){
    if(restoreGraphUndoSnapshot()){e.preventDefault();e.stopPropagation()}
  }
}
document.addEventListener('keydown',handleGraphClipboardShortcut);
stage.addEventListener('wheel',e=>{
  if(isTextEditingTarget(e.target))return;
  hideGraphTransientMenus();
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
let editingNodeId=null,editingNodeIsNew=false,editingLinkId=null;
function openNodeModal(id,isNew=false){if(!graphModeAllows('nodeEdit'))return false;const n=nodeById(id);if(!n)return;if(!isNew&&isNodeFullyLocked(n)){showStatus('该节点已锁定，不能打开编辑弹窗；请先解锁。');return}resetGraphPointerInteractions({hideMenus:true});editingNodeId=id;editingNodeIsNew=!!isNew;$('nodeModalTitle').textContent=isNew?'创建知识点':'编辑知识点';$('nTitle').value=n.title||'';$('nCategory').value=n.category||'';$('nColor').value=safeColor(n.color,'#64748b');$('nSize').value=n.size||'';$('nLevel').value=n.level||'基础';$('nKeywords').value=n.keywords||'';$('nSummary').value=n.summary||'';$('nNotes').value=n.notes||'';$('deleteNodeBtn').style.display=isNew?'none':'';$('nodeModal').classList.add('show');setTimeout(()=>$('nTitle').focus(),80)}
function closeNodeModal(options={}){resetGraphPointerInteractions({hideMenus:true});const draftId=options.discardNew&&editingNodeIsNew?editingNodeId:null;$('nodeModal').classList.remove('show');editingNodeId=null;editingNodeIsNew=false;if(draftId){state.nodes=state.nodes.filter(node=>node.id!==draftId);state.links=state.links.filter(link=>link.from!==draftId&&link.to!==draftId);selectedNodeIds.delete(draftId);if(state.selectedNodeId===draftId)state.selectedNodeId=null;if(state.linkSourceId===draftId)state.linkSourceId=null;render({persist:true});showStatus('已取消创建知识点。')}}
$('cancelNodeBtn').onclick=()=>closeNodeModal({discardNew:true});
$('saveNodeBtn').onclick=()=>{const n=nodeById(editingNodeId);if(!n)return;if(isNodeFullyLocked(n)){showStatus('该节点已锁定，不能保存编辑；请先解锁。');closeNodeModal();return}const model=window.KGGraphModel,history=ensureGraphHistoryController(),title=$('nTitle').value.trim()||'未命名知识点',size=NODE_SIZES.has($('nSize').value)?$('nSize').value:'',content={title,category:$('nCategory').value.trim(),level:$('nLevel').value||'基础',keywords:$('nKeywords').value.trim(),description:$('nSummary').value.trim(),notes:$('nNotes').value.trim()},appearance={color:safeColor($('nColor').value,'#64748b'),size};const mutate=()=>{if(model){model.updateContent(n,content);model.updateAppearance(n,appearance)}else{n.title=title;n.category=content.category;n.level=content.level;n.keywords=content.keywords;n.summary=content.description;n.notes=content.notes;n.color=appearance.color;n.size=size}};if(history)history.run(`编辑“${n.title}”`,mutate);else mutate();closeNodeModal();render({mode:'geometry',persist:true});showStatus('知识点已保存。')};
$('deleteNodeBtn').onclick=()=>{if(editingNodeId)deleteNode(editingNodeId,true)};
function deleteNode(id,fromModal=false){if(!graphModeAllows('editGraph'))return false;const n=nodeById(id);if(!n)return;if(isNodeFullyLocked(n)){showStatus('该节点已锁定，不能删除；请先解锁。');if(fromModal)closeNodeModal();return false}if(confirm(`确定删除“${n.title}”及相关关系线吗？`)){pushGraphUndoSnapshot(`删除“${n.title}”`);if(relatedGatherLayout&&relatedGatherLayout.positions&&relatedGatherLayout.positions.has(n.id))clearRelatedGatherLayout({render:false,message:false});state.nodes=state.nodes.filter(i=>i.id!==n.id);selectedNodeIds.delete(n.id);state.links=state.links.filter(l=>l.from!==n.id&&l.to!==n.id);if(state.selectedNodeId===n.id)state.selectedNodeId=null;if(state.linkSourceId===n.id)state.linkSourceId=null;if(relatedScopeAnchorNodeId===n.id)relatedScopeAnchorNodeId=null;if(fromModal)closeNodeModal();render({persist:true});showStatus('知识点已删除。')}}
function deleteGraphBatchSelection(){
  if(!graphModeAllows('editGraph'))return false;
  if(state.selectedElementId&&textElementById(state.selectedElementId)&&!state.selectedNodeId&&!state.selectedLinkId&&!selectedNodeIds.size&&!selectedLinkIds.size)return deleteSelectedTextElement();
  const nodeIds=new Set([...selectedNodeIds].filter(id=>nodeById(id)));
  if(state.selectedNodeId&&nodeById(state.selectedNodeId))nodeIds.add(state.selectedNodeId);
  const linkIds=new Set([...selectedLinkIds].filter(id=>linkById(id)));
  if(state.selectedLinkId&&linkById(state.selectedLinkId))linkIds.add(state.selectedLinkId);
  if(!nodeIds.size&&!linkIds.size)return false;
  const lockedBatch=lockedNodeIdsFrom([...nodeIds]);if(lockedBatch.length){showStatus(`选择中有 ${lockedBatch.length} 个已锁定节点，不能删除；请先解锁。`);return true}
  if(nodeIds.size&&typeof authRequire==='function'&&!authRequire('登录后才能删除框选内容。'))return true;
  if(nodeIds.size){
    const sample=[...nodeIds].map(id=>nodeById(id)).filter(Boolean).slice(0,3).map(n=>n.title).join('、');
    const relationText=linkIds.size?'，以及选中的 '+linkIds.size+' 条关系线':'';
    if(!confirm(`确定删除 ${nodeIds.size} 个知识点${relationText}及其相关关系线吗？${sample?'\n'+sample+(nodeIds.size>3?' 等':''):''}`))return true;
  }
  const label=nodeIds.size?`删除 ${nodeIds.size} 个知识点和 ${linkIds.size} 条关系线`:`删除 ${linkIds.size} 条关系线`;
  pushGraphUndoSnapshot(label);
  if(relatedGatherLayout&&relatedGatherLayout.positions&&[...nodeIds].some(id=>relatedGatherLayout.positions.has(id)))clearRelatedGatherLayout({render:false,message:false});
  state.nodes=state.nodes.filter(n=>!nodeIds.has(n.id));
  state.links=state.links.filter(link=>!linkIds.has(link.id)&&!nodeIds.has(link.from)&&!nodeIds.has(link.to));
  if(nodeIds.has(state.selectedNodeId))state.selectedNodeId=null;
  if(linkIds.has(state.selectedLinkId)||!linkById(state.selectedLinkId))state.selectedLinkId=null;
  if(nodeIds.has(state.linkSourceId))state.linkSourceId=null;
  if(nodeIds.has(relatedScopeAnchorNodeId))relatedScopeAnchorNodeId=null;
  selectedNodeIds.clear();
  selectedLinkIds.clear();
  hideSelectedEdgeQuickStylePanel();
  hideEdgeInlineLabelEditor();
  render({persist:true});
  if(nodeIds.size)showStatus(`已删除 ${nodeIds.size} 个知识点及相关关系线${linkIds.size?'，其中包含 '+linkIds.size+' 条框选关系':''}。可按 Ctrl/Command+Z 撤回。`);
  else showStatus(`已删除 ${linkIds.size} 条框选关系线。可按 Ctrl/Command+Z 撤回。`);
  return true;
}
function deleteSelectedNodesBatch(){return deleteGraphBatchSelection()}
function deleteSelectedLinksBatch(){return deleteGraphBatchSelection()}
function openLinkModal(id){if(!graphModeAllows('edgeAdvanced'))return false;const l=linkById(id);if(!l)return;state.selectedElementId=null;editingLinkId=id;state.selectedLinkId=id;state.selectedNodeId=null;state.linkSourceId=null;$('linkType').value=l.type||'';$('linkStyle').value=l.lineStyle||DEFAULTS.linkStyle;$('linkColor').value=safeColor(l.color,DEFAULTS.linkColor);$('linkNote').value=l.note||'';$('linkModal').classList.add('show');setTimeout(()=>$('linkNote').focus(),80);renderEdges()}
function closeLinkModal(){$('linkModal').classList.remove('show')}
$('cancelLinkBtn').onclick=closeLinkModal;
$('saveLinkBtn').onclick=()=>{const l=linkById(editingLinkId);if(l){const next={type:$('linkType').value||'',lineStyle:LINE_STYLES.has($('linkStyle').value)?$('linkStyle').value:DEFAULTS.linkStyle,color:safeColor($('linkColor').value,DEFAULTS.linkColor),note:$('linkNote').value.trim()},changed=l.type!==next.type||l.lineStyle!==next.lineStyle||safeColor(l.color,DEFAULTS.linkColor)!==next.color||l.note!==next.note;if(changed){const history=ensureGraphHistoryController(),mutate=()=>Object.assign(l,next);if(history)history.run('编辑知识关系',mutate);else mutate()}}closeLinkModal();render({persist:true});showStatus('关系线已保存。')};
$('deleteLinkBtn').onclick=()=>{if(editingLinkId&&linkById(editingLinkId)){pushGraphUndoSnapshot('删除知识关系');state.links=state.links.filter(l=>l.id!==editingLinkId);state.selectedLinkId=null}closeLinkModal();render({persist:true});showStatus('关系线已删除，可按 Ctrl/Command+Z 撤销。')};
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
function requestGraphMetaEdit(){if(!graphModeAllows('editGraph'))return false;if(typeof authRequire==='function'&&!authRequire('登录后才能编辑图谱标题。'))return;openGraphModal()}
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
  if(!graphModeAllows('editGraph'))return false;
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
function cancelGraphModeTransientInteractions(){
  resetGraphPointerInteractions({hideMenus:true});
  try{nodeGrowthConnectController?.cancel?.()}catch(error){}
  clearNodeGrowthConnectVisuals();
  clearTimeout(nodeGrowthHoverHideTimer);nodeGrowthHoverHideTimer=null;nodeGrowthHoverNodeId=null;hideNodeGrowthHandles();
  if(boxSelect){
    if(boxSelect.frame)cancelAnimationFrame(boxSelect.frame);
    boxSelect=null;hideSelectionBox();stage.classList.remove('graph-box-selecting');
  }
  if(edgeControlDrag){const drag=edgeControlDrag,link=linkById(drag.linkId);if(link)restoreEdgeRoute(link,drag.original);edgeControlDrag=null}
  if(edgeEndpointDrag){const drag=edgeEndpointDrag,link=linkById(drag.linkId);if(link)restoreEdgeRoute(link,drag.original);edgeEndpointDrag=null;clearEdgeEndpointBindTarget()}
  if(edgeMoveDrag){const drag=edgeMoveDrag,link=linkById(drag.linkId);if(link)restoreEdgeRoute(link,drag.original);edgeMoveDrag=null}
  stage.classList.remove('graph-edge-control-dragging','graph-edge-endpoint-dragging','graph-edge-moving','graph-connector-dragging','is-interacting');
  hideSelectedEdgeQuickStylePanel();hideEdgeInlineLabelEditor();hideEdgeHoverFeedback();
  if(!graphModeAllows('multiSelect')){
    selectedNodeIds.clear();selectedLinkIds.clear();selectedTextElementIds.clear();
    state.selectedLinkId=null;state.selectedElementId=null;
    window.KGHomeCanvasRuntime?.selectionFilter?.clear?.({reason:'interaction-mode',apply:false});
  }
  if(!graphModeAllows('connections'))state.linkSourceId=null;
}
function refreshGraphModeRuntime(){
  if(!stage||!state)return false;
  if(!graphModeAllows('edgeAdvanced')&&edgeControlLayer){edgeControlLayer.replaceChildren();delete edgeControlLayer.dataset.linkId}
  if(!graphModeAllows('nodeToolbar'))nodeStyleToolbarController?.hide?.();
  syncGraphModeClasses();
  renderHeader();
  renderEdges();
  refreshCardClasses();
  renderDetails();
  renderSelectedEdgeQuickStylePanel();
  syncHomeSelectionInteractionLock();
  return true;
}
window.KGGraphModeRuntime=Object.freeze({cancel:cancelGraphModeTransientInteractions,refresh:refreshGraphModeRuntime});

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
let mobileGraphViewportTimer=0;
function graphHasVisibleNode(){
  const r=stage.getBoundingClientRect(),scale=Math.max(graphViewportMinScale(),Number(state.viewport.scale)||1),vx=Number(state.viewport.x)||0,vy=Number(state.viewport.y)||0;
  return state.nodes.some(node=>{const p=visualPositionForNode(node),d=nodeDims(node),left=vx+p.x*scale,top=vy+p.y*scale,right=left+d.w*scale,bottom=top+d.h*scale;return right>8&&bottom>8&&left<r.width-8&&top<r.height-8});
}
function recoverMobileGraphViewport(){
  const r=stage.getBoundingClientRect();
  if(r.width>650||r.width<1||r.height<1||!state.nodes.length||graphHasVisibleNode())return false;
  const bounds=boundsForNodes(state.nodes);if(!bounds)return false;
  fitBoundsToView(bounds,{margin:36,minScale:.05,maxScale:.85});
  return true;
}
function scheduleMobileGraphViewportRecovery(){
  clearTimeout(mobileGraphViewportTimer);
  mobileGraphViewportTimer=setTimeout(()=>recoverMobileGraphViewport(),80);
}
window.addEventListener('resize',scheduleMobileGraphViewportRecovery,{passive:true});
window.visualViewport?.addEventListener('resize',scheduleMobileGraphViewportRecovery,{passive:true});
requestAnimationFrame(()=>requestAnimationFrame(()=>recoverMobileGraphViewport()));
$('nodeModal').addEventListener('click',e=>{if(e.target===$('nodeModal'))closeNodeModal({discardNew:true})});
['linkModal','graphModal','templateModal','flashcardModal'].forEach(id=>{$(id).addEventListener('click',e=>{if(e.target===$(id))$(id).classList.remove('show')})});

document.addEventListener('keydown',e=>{if(e.key!=='Escape')return;window.KGHomeCanvasRuntime?.selectionFilter?.clear?.({reason:'escape',apply:false});window.KGHomeCanvasRuntime?.alignment?.end?.();const resize=graphKernelControllers.resize;if(resize&&resize.isActive()){e.preventDefault();resize.cancel();return}if(nodeContextMenuController&&nodeContextMenuController.isVisible()){e.preventDefault();nodeContextMenuController.hide();return}if(nodeFreeResizeModeId){e.preventDefault();exitNodeFreeResizeMode({message:true});return}if(relatedCanvasModalEl){e.preventDefault();closeRelatedCanvasModal(true);return}if(nodeFloatingColorWindowController&&nodeFloatingColorWindowController.isOpen()){e.preventDefault();nodeFloatingColorWindowController.close({cancel:true,force:true,reason:'escape'});return}if(nodeStyleToolbarController&&nodeStyleToolbarController.isVisible()){e.preventDefault();nodeStyleToolbarController.hide()}});
