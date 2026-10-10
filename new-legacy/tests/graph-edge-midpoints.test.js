'use strict';
const assert=require('node:assert/strict');
const fs=require('node:fs');
const vm=require('node:vm');
const source=fs.readFileSync(require('node:path').join(__dirname,'../src/10-graph-editor.js'),'utf8');
const nodes=new Map();
const context={Math,Number,String,Array,Map,Set,window:{},DEFAULTS:{linkPathStyle:'curve'},LINE_PATH_STYLES:new Set(['curve','straight','elbow']),nodeById:id=>nodes.get(id),nodeDims:n=>({w:n.w,h:n.h}),visualPositionForNode:n=>({x:n.x,y:n.y}),nodeCenter:n=>({x:n.x+n.w/2,y:n.y+n.h/2})};
vm.createContext(context);
vm.runInContext(source.slice(source.indexOf('function nodeOutlinePoint('),source.indexOf('function relationExists(')),context);
const plain=value=>JSON.parse(JSON.stringify(value));
function check(a,b,start,end){
  nodes.set('a',a);nodes.set('b',b);
  const points=context.linkRenderPoints({from:'a',to:'b'});
  assert.deepEqual(plain(points.a),start);assert.deepEqual(plain(points.b),end);
  for(const style of ['curve','elbow','straight']){
    const geometry=context.linkPathGeometry({pathStyle:style},points.a,points.b,points);
    assert.deepEqual(plain(geometry.endpoints),[start,end]);
    const inside=(p,n)=>p.x>n.x+.001&&p.x<n.x+n.w-.001&&p.y>n.y+.001&&p.y<n.y+n.h-.001;
    assert.ok(geometry.samples.every(p=>!inside(p,a)&&!inside(p,b)),style+' must not enter attached cards');
  }
  return points;
}
const a={x:0,y:0,w:160,h:80};
check(a,{x:400,y:100,w:200,h:100},{x:160,y:40},{x:400,y:150});
check(a,{x:-400,y:50,w:120,h:120},{x:0,y:40},{x:-280,y:110});
check(a,{x:40,y:350,w:200,h:100},{x:80,y:80},{x:140,y:350});
check(a,{x:40,y:-350,w:200,h:100},{x:80,y:0},{x:140,y:-250});
// Centers are horizontally dominant, even when wide cards leave a narrow gap.
const wideA={x:0,y:0,w:500,h:80},wideB={x:530,y:170,w:500,h:80};
const p=check(wideA,wideB,{x:500,y:40},{x:530,y:210});
const curve=context.linkPathGeometry({pathStyle:'curve'},p.a,p.b,p);
assert.equal(curve.controls[0].y,40);assert.equal(curve.controls[1].y,210);
assert.ok(curve.controls[0].x>=500&&curve.controls[0].x<=530,'short gap controls cannot overshoot');
// Multiple children in one horizontal branch share their parent's exact side midpoint.
const siblings=[100,200,-100].map(y=>context.linkOutlinePoints(a,{x:500,y,w:100,h:60}).a);
assert.deepEqual(plain(siblings),[{x:160,y:40},{x:160,y:40},{x:160,y:40}]);
const stored=[{x:250,y:-100},{x:400,y:250}];
assert.deepEqual(plain(context.linkPathGeometry({pathStyle:'curve',curveControls:stored},p.a,p.b,p).controls.map(({x,y})=>({x,y}))),stored,'retain user-controlled curve');
const free=context.linkRenderPoints({fromPoint:{x:7,y:8},toPoint:{x:30,y:40}});
assert.deepEqual(plain([free.a,free.b]),[{x:7,y:8},{x:30,y:40}]);
assert.equal(context.linkRenderPoints({from:'missing',to:'b'}),null);
// Disjoint cards may overlap on the dominant axis: automatic routes must use the secondary gap.
for(const [first,second] of [
  [{x:0,y:0,w:500,h:80},{x:400,y:170,w:500,h:80}],
  [{x:400,y:170,w:500,h:80},{x:0,y:0,w:500,h:80}],
  [{x:0,y:170,w:500,h:80},{x:400,y:0,w:500,h:80}],
  [{x:0,y:0,w:80,h:500},{x:170,y:400,w:80,h:500}],
  [{x:170,y:400,w:80,h:500},{x:0,y:0,w:80,h:500}],
  [{x:170,y:0,w:80,h:500},{x:0,y:400,w:80,h:500}],
  [{x:0,y:0,w:500,h:80},{x:500,y:170,w:500,h:80}],
  [{x:0,y:0,w:500,h:80},{x:400,y:81,w:500,h:80}]
]){
  nodes.set('a',first);nodes.set('b',second);
  const points=context.linkRenderPoints({from:'a',to:'b'});
  const inside=(p,n)=>p.x>n.x+.001&&p.x<n.x+n.w-.001&&p.y>n.y+.001&&p.y<n.y+n.h-.001;
  for(const style of ['curve','elbow']){
    const geometry=context.linkPathGeometry({pathStyle:style},points.a,points.b,points);
    assert.deepEqual(plain(geometry.endpoints),plain([points.a,points.b]));
    const dense=geometry.samples.flatMap((p,i,all)=>i?Array.from({length:41},(_,j)=>({x:all[i-1].x+(p.x-all[i-1].x)*j/40,y:all[i-1].y+(p.y-all[i-1].y)*j/40})):[p]);
    assert.ok(dense.every(p=>!inside(p,first)&&!inside(p,second)),`${style} must clear overlapping projections: ${JSON.stringify([first,second])}`);
    assert.ok(dense.every(p=>p.x>=Math.min(first.x,second.x)-25&&p.x<=Math.max(first.x+first.w,second.x+second.w)+25&&p.y>=Math.min(first.y,second.y)-25&&p.y<=Math.max(first.y+first.h,second.y+second.h)+25),'detours stay near cards');
  }
  const manual=[{x:-20,y:-40},{x:30,y:15}];
  assert.deepEqual(plain(context.linkPathGeometry({pathStyle:'curve',curveControls:manual},points.a,points.b,points).controls.map(({x,y})=>({x,y}))),manual);
  assert.deepEqual(plain(context.linkPathGeometry({pathStyle:'elbow',waypoints:manual},points.a,points.b,points).samples),plain([points.a,...manual,points.b]));
  assert.equal(context.linkPathGeometry({pathStyle:'straight'},points.a,points.b,points).samples.length,2,'explicit straight style remains one direct segment');
}
// Exercise route persistence and actual move/control handlers: rounded routes must not be truncated to two controls.
for(const [start,end] of [
  ['function edgeRouteSnapshot(','function selectEdgeForDirectManipulation('],
  ['function applyEdgeMoveDragPoint(','function scheduleEdgeMoveDrag('],
  ['function applyEdgeControlDragPoint(','function scheduleEdgeControlDrag(']
])vm.runInContext(source.slice(source.indexOf(start),source.indexOf(end)),context);
nodes.set('a',{id:'a',x:0,y:0,w:500,h:80});nodes.set('b',{id:'b',x:400,y:170,w:500,h:80});
const routeLink={id:'detour',from:'a',to:'b',pathStyle:'curve'};
const routePoints=context.linkRenderPoints(routeLink);
const initialData=JSON.stringify(routeLink);
const routeGeometry=context.linkPathGeometry(routeLink,routePoints.a,routePoints.b,routePoints);
assert.equal(JSON.stringify(routeLink),initialData,'automatic layout must not persist route data');
context.persistDerivedEdgeRoute(routeLink,routeGeometry);
assert.equal(routeLink.waypoints.length,4);assert.equal(routeLink.curveControls,undefined);
const persisted=context.linkPathGeometry(JSON.parse(JSON.stringify(routeLink)),routePoints.a,routePoints.b,routePoints);
assert.equal(persisted.d,routeGeometry.d,'persisted route reload retains all smooth corners');
const original=context.edgeRouteSnapshot(routeLink);
context.setLinkFreeEndpoint(routeLink,'from',{x:520,y:70});
assert.equal(context.bindLinkEndpoint(routeLink,'from','a'),true);
const rebound=context.linkRenderPoints(routeLink);
assert.equal(context.linkPathGeometry(routeLink,rebound.a,rebound.b,rebound).d,routeGeometry.d,'rebinding to the same card preserves smooth route');
Object.assign(context,{
  edgeMoveDrag:{linkId:'detour',startWorld:{x:0,y:0},startClient:{x:0,y:0},geometry:routeGeometry,moved:false,history:true},
  linkById:()=>routeLink,edgeDomById:new Map([['detour',{geometry:routeGeometry}]]),state:{viewport:{scale:1}},
  getGraphIndex:()=>({nodeMap:nodes}),stage:{classList:{add(){}}},hideEdgeHoverFeedback(){},
  updateLinkGeometry(link){const p=context.linkRenderPoints(link);context.movedGeometry=context.linkPathGeometry(link,p.a,p.b,p)}
});
context.applyEdgeMoveDragPoint({x:30,y:-15});
assert.equal(routeLink.from,'');assert.equal(routeLink.to,'');assert.equal(routeLink.waypoints.length,4);
assert.equal(routeLink.curveControls,undefined);
const expectedSamples=routeGeometry.samples.map(p=>({x:p.x+30,y:p.y-15}));
assert.equal(context.movedGeometry.samples.length,expectedSamples.length);
context.movedGeometry.samples.forEach((p,i)=>assert.ok(Math.abs(p.x-expectedSamples[i].x)<1e-8&&Math.abs(p.y-expectedSamples[i].y)<1e-8,'moving a rounded route must translate every sample'));
const reloaded=JSON.parse(JSON.stringify(routeLink)),reloadPoints=context.linkRenderPoints(reloaded);
assert.equal(context.linkPathGeometry(reloaded,reloadPoints.a,reloadPoints.b,reloadPoints).d,context.movedGeometry.d,'reload after whole-edge movement preserves geometry');
context.edgeControlDrag={linkId:'detour',kind:'waypoint',index:2};
context.applyEdgeControlDragPoint({x:350,y:130});
assert.deepEqual(plain(routeLink.waypoints[2]),{x:350,y:130});
assert.equal(context.movedGeometry.controls.length,4,'manual corner drag retains all four controls');
context.restoreEdgeRoute(routeLink,original);
assert.equal(context.linkPathGeometry(routeLink,routePoints.a,routePoints.b,routePoints).d,routeGeometry.d,'cancel/restore retains original smooth geometry');
console.log('PASS graph edge midpoints: directions, overlapping projections, tight gaps, manual routes, free endpoints, route persistence, move/reload, rebind and control dragging');
