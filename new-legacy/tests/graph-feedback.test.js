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
test('mirrored right branches share a parent attachment and mirrored curve controls including a primary midpoint',()=>{
 const c=fixture();const shapes=['b','c'].map(to=>{const l={from:'a',to,pathStyle:'curve'},p=c.linkRenderPoints(l);return c.linkPathGeometry(l,p.a,p.b,p)});
 assert.equal(shapes[0].endpoints[0].x,shapes[1].endpoints[0].x);assert.equal(shapes[0].endpoints[0].y,shapes[1].endpoints[0].y);
 shapes[0].samples.forEach((p,i)=>{assert.equal(p.x,shapes[1].samples[i].x);assert.ok(Math.abs(p.y+shapes[1].samples[i].y-80)<1e-8)});
 assert.equal(shapes[0].controls.filter(p=>p.kind==='curve-midpoint').length,1);
 assert.equal(new Set(shapes[0].controls.map(p=>p.index)).size,shapes[0].controls.length,'every visible curve handle has a unique DOM index');
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

test('outer segment movement beyond twelve corners renders every orthogonal segment',()=>{
 const c=fixture(),start={x:0,y:0},end={x:70,y:60},waypoints=Array.from({length:12},(_,i)=>({x:Math.ceil((i+1)/2)*10,y:Math.floor((i+1)/2)*10}));
 const moved=c.window.KGGraphEdgeGeometry.moveElbowSegment(start,end,waypoints,0,{x:0,y:-10});
 assert.equal(moved.length,13);
 const rendered=c.linkPathGeometry({pathStyle:'elbow',waypoints:moved},start,end);
 assert.equal(rendered.waypoints.length,13);
 const points=[start,...plain(rendered.waypoints),end];
 for(let i=1;i<points.length;i++)assert.ok(points[i].x===points[i-1].x||points[i].y===points[i-1].y,JSON.stringify(points));
});
