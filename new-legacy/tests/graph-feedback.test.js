'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),vm=require('node:vm'),fs=require('node:fs');
const source=fs.readFileSync(require('node:path').join(__dirname,'../src/10-graph-editor.js'),'utf8');
function fixture(){
 const nodes=new Map([['a',{id:'a',x:0,y:0,w:120,h:80}],['b',{id:'b',x:300,y:160,w:120,h:80}],['c',{id:'c',x:300,y:-160,w:120,h:80}]]);
 const context={Math,Number,String,Array,Map,Set,window:{KGGraphEdgeGeometry:require('../src/graph/edge-geometry.js')},DEFAULTS:{linkPathStyle:'curve'},LINE_PATH_STYLES:new Set(['curve','straight','elbow']),nodeById:id=>nodes.get(id),nodeDims:n=>({w:n.w,h:n.h}),visualPositionForNode:n=>({x:n.x,y:n.y}),nodeCenter:n=>({x:n.x+n.w/2,y:n.y+n.h/2})};
 vm.createContext(context);vm.runInContext(source.slice(source.indexOf('function nodeOutlinePoint('),source.indexOf('function relationExists(')),context);
 return context;
}
const plain=p=>JSON.parse(JSON.stringify(p));
function endpointFixture(link,options={}){
 const c=fixture();if(options.setup)options.setup(c);
 const p=c.linkRenderPoints(link),geometry=c.linkPathGeometry(link,p.a,p.b,p),side=options.side||'to',target=c.nodeById(options.targetId===undefined?(link.to==='c'?'b':'c'):options.targetId);
 Object.assign(c,{edgeEndpointDrag:{pointerId:1,linkId:link.id,side,startClient:plain(side==='from'?p.a:p.b),history:false,moved:false,historyController:{checkpoint(){}}},edgeEndpointDragFrame:0,edgeEndpointDragPoint:null,linkById:()=>link,edgeDomById:new Map([[link.id,{geometry}]]),getGraphIndex:()=>({nodeMap:null}),edgeEndpointTargetFromClient:()=>target,setEdgeEndpointBindTarget(){},clearEdgeEndpointBindTarget(){},updateLinkGeometry(){},invalidateGraphIndexCache(){},stage:{classList:{remove(){}}},finishGraphGestureHistory(drag,cancelled){if(cancelled)c.restoreEdgeRoute(link,drag.original)},save(){},renderDetails(){},renderSelectedEdgeControls(){},renderSelectedEdgeQuickStylePanel(){},showStatus(){}});
 vm.runInContext(fs.readFileSync(require('node:path').join(__dirname,'../src/graph/graph-persistence.js'),'utf8'),c);
 vm.runInContext(source.slice(source.indexOf('function edgeRouteSnapshot('),source.indexOf('function translateEdgePoint(')),c);
 vm.runInContext(source.slice(source.indexOf('function applyEdgeEndpointDragPoint('),source.indexOf('function scheduleEdgeEndpointDrag(')),c);
 vm.runInContext(source.slice(source.indexOf('function finishEdgeEndpointDrag('),source.indexOf('function createEdgeEndpointHandle(')),c);
 c.edgeEndpointDrag.original=c.edgeRouteSnapshot(link);
 return c;
}
const endpointEvent=()=>({pointerId:1,preventDefault(){},stopPropagation(){}});
for(const side of ['from','to'])for(const [port,drop,expected] of [
 ['top',{x:330,y:161},{x:360,y:160}],
 ['right',{x:419,y:175},{x:420,y:200}],
 ['bottom',{x:390,y:239},{x:360,y:240}],
 ['left',{x:301,y:185},{x:300,y:200}]
])test(`dragging ${side} endpoint snaps to the nearest ${port} edge midpoint instead of its old port`,()=>{
 const link={id:'snap',from:side==='from'?'b':'a',to:side==='to'?'b':'a',fromPort:'left',toPort:'right',pathStyle:'curve'},c=endpointFixture(link,{side,targetId:'b'}),original=c.edgeRouteSnapshot(link);
 c.applyEdgeEndpointDragPoint({clientX:drop.x,clientY:drop.y,world:drop});c.finishEdgeEndpointDrag(endpointEvent());
 assert.equal(link[side+'Port'],port);
 assert.deepEqual(plain(c.linkRenderPoints(link)[side==='from'?'a':'b']),expected);
 assert.equal(link[side==='from'?'toPort':'fromPort'],side==='from'?'right':'left','opposite endpoint is unchanged');
 c.restoreEdgeRoute(link,original);assert.deepEqual(plain(c.edgeRouteSnapshot(link)),plain(original));
});
test('mirrored right branches share a parent attachment and mirrored curve controls including a primary midpoint',()=>{
 const c=fixture();const shapes=['b','c'].map(to=>{const l={from:'a',to,pathStyle:'curve'},p=c.linkRenderPoints(l);return c.linkPathGeometry(l,p.a,p.b,p)});
 assert.equal(shapes[0].endpoints[0].x,shapes[1].endpoints[0].x);assert.equal(shapes[0].endpoints[0].y,shapes[1].endpoints[0].y);
 shapes[0].samples.forEach((p,i)=>{assert.equal(p.x,shapes[1].samples[i].x);assert.ok(Math.abs(p.y+shapes[1].samples[i].y-80)<1e-8)});
 assert.equal(shapes[0].controls.filter(p=>p.kind==='curve-midpoint').length,1);
 assert.equal(new Set(shapes[0].controls.map(p=>p.index)).size,shapes[0].controls.length,'every visible curve handle has a unique DOM index');
});
test('automatic left and right fans bend toward each child with horizontal tangents at both cards',()=>{
 for(const x of [-300,300]){
  const c=fixture(),child=c.nodeById('b');child.x=x;
  for(const y of [-160,-80,0,80,160]){
   child.y=y;const link={from:'a',to:'b',pathStyle:'curve'},p=c.linkRenderPoints(link),g=c.linkPathGeometry(link,p.a,p.b,p);
   assert.deepEqual(plain(g.endpoints),[{x:x>0?120:0,y:40},{x:x>0?300:-180,y:y+40}]);
   assert.equal(g.curveControls[0].y,40);assert.equal(g.curveControls[1].y,y+40);
   assert.ok((g.curveControls[0].x-g.endpoints[0].x)*Math.sign(x)>0,'source tangent points toward the fan');
   assert.ok((g.endpoints[1].x-g.curveControls[1].x)*Math.sign(x)>0,'target tangent approaches the child horizontally');
   g.samples.forEach((point,index,all)=>{if(index)assert.ok((point.y-all[index-1].y)*Math.sign(y)>=0,'every branch moves toward its child without an opposite bow')});
   assert.equal(link.curveControls,undefined,'fan rendering must leave automatic routes derived');
  }
 }
});
for(const ports of [{},{fromPort:'right',toPort:'left'}])for(const [from,to,y] of [['c','b',200],['b','c',-120]]){
 test(`rebinding an automatic ${from==='c'?'upper branch below':'lower branch above'} the parent follows its new target with ${ports.fromPort?'fixed':'automatic'} side ports`,()=>{
  const link={id:'branch',from:'a',to:from,pathStyle:'curve',...ports},c=endpointFixture(link),original=c.edgeRouteSnapshot(link);
  c.applyEdgeEndpointDragPoint({clientX:300,clientY:y,world:{x:300,y}});
  assert.equal(c.bindLinkEndpoint(link,'to',c.edgeEndpointDrag.targetId),true);
  assert.equal(link.to,to);
  const next=c.linkRenderPoints(link),after=c.linkPathGeometry(link,next.a,next.b,next);
  assert.ok(after.samples.every(point=>point.y>=Math.min(40,y)&&point.y<=Math.max(40,y)),'the curve must stay between the new card attachments instead of bowing toward the old target');
  assert.equal(link.curveControls,undefined,'moving an endpoint must not freeze a previously automatic cubic');
  c.restoreEdgeRoute(link,original);
  assert.equal(link.to,from);assert.equal(link.curveControls,undefined,'cancel/undo restores automatic routing');
  assert.equal(link.fromPort,ports.fromPort||'auto');assert.equal(link.toPort,ports.toPort||'auto');
 });
}
test('rebinding to the same card retains manually bent controls and route restoration',()=>{
 const controls=[{x:170,y:-50},{x:250,y:-200}],link={id:'manual',from:'a',to:'c',fromPort:'right',toPort:'left',pathStyle:'curve',curveControls:plain(controls)},c=endpointFixture(link,{targetId:'c'}),original=c.edgeRouteSnapshot(link);
 c.applyEdgeEndpointDragPoint({clientX:300,clientY:-100,world:{x:300,y:-100}});c.finishEdgeEndpointDrag(endpointEvent());
 assert.deepEqual(plain(link.curveControls),controls);assert.equal(link.to,'c');assert.equal(link.fromPort,'right');assert.equal(link.toPort,'left');
 c.restoreEdgeRoute(link,original);assert.deepEqual(plain(c.edgeRouteSnapshot(link)),plain(original));
});
for(const [from,to,y,controls] of [
 ['c','b',337,[{x:-213.653,y:108.623},{x:-162.648,y:30.696}]],
 ['b','c',81,[{x:-213.653,y:309.377},{x:-162.648,y:387.304}]]
])test(`rebinding a legacy stored ${from==='c'?'upper curve below':'lower curve above'} recalculates its bow and undo restores the old route`,()=>{
 const link={id:'legacy',from:'a',to:from,fromPort:'auto',toPort:'auto',pathStyle:'curve',curveControls:plain(controls)},c=endpointFixture(link,{setup(c){
  Object.assign(c.nodeById('a'),{x:-424,y:143,w:128,h:132});Object.assign(c.nodeById('c'),{x:-64,y:15,w:128,h:132});Object.assign(c.nodeById('b'),{x:-64,y:271,w:128,h:132});
 }}),original=c.edgeRouteSnapshot(link);
 c.applyEdgeEndpointDragPoint({clientX:-64,clientY:y,world:{x:-64,y}});c.finishEdgeEndpointDrag(endpointEvent());
 const p=c.linkRenderPoints(link),g=c.linkPathGeometry(link,p.a,p.b,p);
 assert.equal(link.to,to);assert.ok(g.samples.every(point=>point.y>=Math.min(209,y)&&point.y<=Math.max(209,y)),'old controls must not pull the new branch toward the former card');
 assert.equal(link.curveControls,undefined);assert.equal(g.curveControls[0].y,209);assert.equal(g.curveControls[1].y,y);
 assert.equal(link.fromPort,'auto');assert.equal(link.toPort,'left');
 c.restoreEdgeRoute(link,original);assert.deepEqual(plain(c.edgeRouteSnapshot(link)),plain(original),'undo recovers the precise legacy controls and original binding');
});
test('rebinding the source to a different card recalculates the stored curve too',()=>{
 const link={id:'source',from:'c',to:'a',pathStyle:'curve',curveControls:[{x:250,y:-200},{x:170,y:-50}]},c=endpointFixture(link,{side:'from',targetId:'b'});
 c.applyEdgeEndpointDragPoint({clientX:300,clientY:200,world:{x:300,y:200}});c.finishEdgeEndpointDrag(endpointEvent());
 const p=c.linkRenderPoints(link),g=c.linkPathGeometry(link,p.a,p.b,p);
 assert.equal(link.from,'b');assert.ok(g.samples.every(point=>point.y>=40&&point.y<=200));assert.equal(link.curveControls,undefined);
});
test('binding a previously free endpoint preserves its manually drawn path',()=>{
 const controls=[{x:170,y:-50},{x:250,y:-200}],link={id:'free',from:'a',to:'',toPoint:{x:300,y:-120},pathStyle:'curve',curveControls:plain(controls)},c=endpointFixture(link,{targetId:'b'});
 c.applyEdgeEndpointDragPoint({clientX:300,clientY:200,world:{x:300,y:200}});c.finishEdgeEndpointDrag(endpointEvent());
 assert.equal(link.to,'b');assert.deepEqual(plain(link.curveControls),controls);
});
test('detaching a bound endpoint into free space preserves its manually drawn path',()=>{
 const controls=[{x:170,y:-50},{x:250,y:-200}],link={id:'detach',from:'a',to:'c',pathStyle:'curve',curveControls:plain(controls)},c=endpointFixture(link,{targetId:null});
 c.applyEdgeEndpointDragPoint({clientX:300,clientY:200,world:{x:300,y:200}});c.finishEdgeEndpointDrag(endpointEvent());
 assert.equal(link.to,'');assert.deepEqual(plain(link.curveControls),controls);
});
test('cancelling a stored curve rebind restores the original binding and controls',()=>{
 const link={id:'cancel',from:'a',to:'c',pathStyle:'curve',curveControls:[{x:170,y:-50},{x:250,y:-200}]},c=endpointFixture(link),original=c.edgeRouteSnapshot(link);
 c.applyEdgeEndpointDragPoint({clientX:300,clientY:200,world:{x:300,y:200}});c.finishEdgeEndpointDrag(endpointEvent(),true);
 assert.deepEqual(plain(c.edgeRouteSnapshot(link)),plain(original));
});
test('rebinding an automatic elbow still persists its complete orthogonal route',()=>{
 const link={id:'elbow',from:'a',to:'c',pathStyle:'elbow'},c=endpointFixture(link);
 c.applyEdgeEndpointDragPoint({clientX:300,clientY:200,world:{x:300,y:200}});c.finishEdgeEndpointDrag(endpointEvent());
 assert.deepEqual(plain(link.waypoints),[{x:210,y:40},{x:210,y:-120}]);assert.equal(link.curveControls,undefined);
});
test('a short body drag bends the bound curve without detaching cards',()=>{
 const c=fixture(),link={id:'ab',from:'a',to:'b',pathStyle:'curve'},p=c.linkRenderPoints(link),geometry=c.linkPathGeometry(link,p.a,p.b,p);
 Object.assign(c,{translateEdgePoint:(p,x,y)=>({x:p.x+x,y:p.y+y}),edgeMoveDrag:{linkId:'ab',startWorld:{x:210,y:120},startClient:{x:210,y:120},geometry,moved:false,history:true},linkById:()=>link,edgeDomById:new Map([['ab',{geometry}]]),state:{viewport:{scale:1}},getGraphIndex:()=>({nodeMap:null}),stage:{classList:{add(){}}},hideEdgeHoverFeedback(){},updateLinkGeometry(){}});
 vm.runInContext(source.slice(source.indexOf('function applyEdgeMoveDragPoint('),source.indexOf('function scheduleEdgeMoveDrag(')),c);
 c.applyEdgeMoveDragPoint({x:216,y:124});assert.equal(link.from,'a');assert.equal(link.to,'b');
 const after=c.linkPathGeometry(link,p.a,p.b,p);assert.ok(Math.abs(after.samples[12].x-geometry.samples[12].x-6)<1e-8);assert.ok(Math.abs(after.samples[12].y-geometry.samples[12].y-4)<1e-8);
});
test('segment dragging moves a complete orthogonal elbow segment, not a single corner',()=>{
 const c=fixture(),link={id:'ab',from:'a',to:'b',pathStyle:'elbow',waypoints:[{x:210,y:40},{x:210,y:200}]};
 Object.assign(c,{state:{viewport:{scale:1}},edgeControlDrag:{linkId:'ab',kind:'segment',index:1,startWorld:{x:210,y:120},geometry:{endpoints:[{x:120,y:40},{x:300,y:200}],waypoints:plain(link.waypoints)},moved:false},linkById:()=>link,getGraphIndex:()=>({nodeMap:null}),updateLinkGeometry(){}});
 vm.runInContext(source.slice(source.indexOf('function applyEdgeControlDragPoint('),source.indexOf('function scheduleEdgeControlDrag(')),c);
 c.applyEdgeControlDragPoint({x:216,y:124});assert.deepEqual(plain(link.waypoints),[{x:216,y:40},{x:216,y:200}]);assert.equal(link.from,'a');assert.equal(link.to,'b');
 c.applyEdgeControlDragPoint({x:210,y:120});assert.deepEqual(plain(link.waypoints),[{x:210,y:40},{x:210,y:200}]);
});
for(const kind of ['segment','body'])for(const vertical of [false,true])test(`a ${vertical?'vertical':'horizontal'} elbow ${kind} drag along its locked axis creates no route data or history`,()=>{
 const link={id:'locked',from:'a',to:'b',pathStyle:'elbow'},c=endpointFixture(link,{setup(c){if(vertical)Object.assign(c.nodeById('b'),{x:100,y:300})}}),original=c.edgeRouteSnapshot(link),p=c.linkRenderPoints(link),geometry=c.linkPathGeometry(link,p.a,p.b,p);
 const startWorld=vertical?{x:110,y:190}:{x:210,y:120},lockedPoint=vertical?{x:119,y:190}:{x:210,y:129};
 vm.runInContext(fs.readFileSync(require('node:path').join(__dirname,'../src/graph/history-controller.js'),'utf8'),c);
 const history=c.window.KGGraphHistoryController.create({capture:()=>c.edgeRouteSnapshot(link),restore:snapshot=>c.restoreEdgeRoute(link,snapshot)});
 history.begin('drag');if(kind==='segment')history.checkpoint('drag');
 Object.assign(c,{state:{viewport:{scale:1}},stage:{classList:{add(){},remove(){}}},hideEdgeHoverFeedback(){},finishGraphGestureHistory(drag,cancelled){return cancelled?history.rollback():history.commit()},translateEdgePoint:(p,x,y)=>({x:p.x+x,y:p.y+y})});
 if(kind==='segment'){
  link.waypoints=plain(geometry.waypoints);
  c.edgeControlDrag={pointerId:1,linkId:link.id,kind:'segment',index:1,startWorld,geometry,moved:false,historyController:history};
  vm.runInContext(source.slice(source.indexOf('function applyEdgeControlDragPoint('),source.indexOf('function createEdgeControlHandle(')),c);
  Object.assign(c,{edgeControlDragFrame:0,edgeControlDragPoint:null});
  c.applyEdgeControlDragPoint(lockedPoint);c.finishEdgeControlDrag(endpointEvent());
 }else{
  c.edgeMoveDrag={pointerId:1,linkId:link.id,startWorld,startClient:startWorld,geometry,moved:false,history:false,historyController:history};
  Object.assign(c,{edgeMoveDragFrame:0,edgeMoveDragPoint:null,selectEdgeForDirectManipulation(){},performance:{now:()=>0}});
  vm.runInContext(source.slice(source.indexOf('function applyEdgeMoveDragPoint('),source.indexOf('function clearEdgeEndpointBindTarget(')),c);
  c.applyEdgeMoveDragPoint(lockedPoint);c.finishEdgeMoveDrag(endpointEvent());
 }
 assert.deepEqual(plain(c.edgeRouteSnapshot(link)),plain(original));assert.equal(history.getState().undoCount,0);
});

test('outer segment movement beyond twelve corners renders every orthogonal segment',()=>{
 const c=fixture(),start={x:0,y:0},end={x:70,y:60},waypoints=Array.from({length:12},(_,i)=>({x:Math.ceil((i+1)/2)*10,y:Math.floor((i+1)/2)*10}));
 const moved=c.window.KGGraphEdgeGeometry.moveElbowSegment(start,end,waypoints,0,{x:0,y:-10});
 assert.equal(moved.length,13);
 const rendered=c.linkPathGeometry({pathStyle:'elbow',waypoints:moved},start,end);
 assert.equal(rendered.waypoints.length,13);
 const points=[start,...plain(rendered.waypoints),end];
 for(let i=1;i<points.length;i++)assert.ok(points[i].x===points[i-1].x||points[i].y===points[i-1].y,JSON.stringify(points));
});

for(const [hasField,originalFields] of [[false,undefined],[true,undefined],[true,[]],[true,['fontSize']]]){
 test(`cancelled color preview preserves ${hasField?JSON.stringify(originalFields):'absent'} manual fields and permits the next theme`,()=>{
  const context={window:{},console,Math,Number,String,Array,Map,Set,nodeColorEditSession:null,nodeToolbarTextElement:()=>null,nodeToolbarSelectedIds:()=>['a'],render(){}};
  vm.createContext(context);
  for(const name of ['graph-model.js','mindmap-themes.js'])vm.runInContext(fs.readFileSync(require('node:path').join(__dirname,'../src/graph',name),'utf8'),context);
  const model=context.window.KGGraphModel,themes=context.window.KGGraphMindmapThemes;
  const graph={nodes:[model.normalizeNode({id:'a',title:'Color cancellation'})],links:[]},node=graph.nodes[0];
  themes.apply(graph,{themeId:'blue',override:true});
  if(!hasField)delete node.manualAppearanceFields;else node.manualAppearanceFields=originalFields?.slice();
  const before=plain(model.appearanceOf(node));
  Object.assign(context,{nodeById:id=>graph.nodes.find(item=>item.id===id),safeColor:model.safeColor});
  vm.runInContext(source.slice(source.indexOf('function nodeColorLabel('),source.indexOf('function ensureNodeFloatingColorWindow(')),context);
  context.previewNodeColorEdit('body-fill',{color:'#aa3c3c',opacity:1});
  assert.equal(model.appearanceOf(node).fillColor,'#aa3c3c');
  context.previewNodeColorEdit('body-fill',{color:'#336699',opacity:.5});
  context.cancelNodeColorEdit();
  assert.deepEqual(plain(model.appearanceOf(node)),before,'cancel restores every appearance field');
  const restoredFields=node.manualAppearanceFields===undefined?undefined:plain(node.manualAppearanceFields);
  const restoredOwnField=Object.hasOwn(node,'manualAppearanceFields');
  themes.apply(graph,{themeId:'paper'});
  assert.equal(model.appearanceOf(node).fillColor,'#fef3c7','cancel must not mark the previewed background as manually customized');
  assert.deepEqual(restoredFields,originalFields,'cancel restores all original manual fields');
  assert.equal(restoredOwnField,hasField,'cancel preserves whether the property originally existed');
 });
}
