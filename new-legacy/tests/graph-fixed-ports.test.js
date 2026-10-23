'use strict';
const assert=require('node:assert/strict'),test=require('node:test'),fs=require('node:fs'),vm=require('node:vm');
const geometry=require('../src/graph/edge-geometry.js');
const plain=value=>JSON.parse(JSON.stringify(value));
const near=(actual,expected)=>{for(const axis of ['x','y'])assert.ok(Math.abs(actual[axis]-expected[axis])<1e-7,JSON.stringify({actual,expected}))};
test('nearest edge uses distance to the edge, including long cards and off-center drop points',()=>{
 const rect={x:-300,y:40,width:400,height:80};
 for(const [p,port] of [[{x:-290,y:70},'left'],[{x:80,y:55},'top'],[{x:-280,y:105},'bottom'],[{x:99,y:95},'right']])assert.equal(geometry.nearestPort(rect,p),port);
});
function environment(){
  const nodes=new Map(),c={console,window:{},Math,Number,String,Array,Map,Set,clamp:(v,a,b)=>Math.max(a,Math.min(b,v)),matchMedia:()=>({matches:false}),document:{getElementById:()=>null},nodeById:id=>nodes.get(id),nodeDims:n=>({w:n.w,h:n.h}),visualPositionForNode:n=>({x:n.x,y:n.y}),nodeCenter:n=>({x:n.x+n.w/2,y:n.y+n.h/2}),invalidateGraphIndexCache(){}};
  c.window=c;c.globalThis=c;vm.createContext(c);
  for(const file of ['graph/edge-geometry.js','graph/graph-model.js','graph/graph-persistence.js','graph/connection-controller.js'])vm.runInContext(fs.readFileSync(require('node:path').join(__dirname,'../src',file),'utf8'),c);
  const config=fs.readFileSync(require('node:path').join(__dirname,'../src/00-config-state.js'),'utf8');
  vm.runInContext(config.slice(config.indexOf('const CARD_W='),config.indexOf('const $='))+config.slice(config.indexOf('function uid('),config.indexOf('function templateState('))+config.slice(config.indexOf('function safeString('),config.indexOf('function normalizeState(')),c);
  const editor=fs.readFileSync(require('node:path').join(__dirname,'../src/10-graph-editor.js'),'utf8');
  vm.runInContext(editor.slice(editor.indexOf('function nodeOutlinePoint('),editor.indexOf('function relationExists(')),c);
  vm.runInContext(editor.slice(editor.indexOf('function edgeRouteSnapshot('),editor.indexOf('function selectEdgeForDirectManipulation(')),c);
  return{c,nodes};
}
test('four fixed sides use shape outline intersections, independent of opposite node',()=>{
  const n={x:10,y:20,width:200,height:100};
  for(const shape of ['standard','circle','triangle']){
    const expected=shape==='triangle'?{top:{x:110,y:20},right:{x:160,y:70},bottom:{x:110,y:120},left:{x:60,y:70}}:{top:{x:110,y:20},right:{x:210,y:70},bottom:{x:110,y:120},left:{x:10,y:70}};
    for(const [port,want] of Object.entries(expected))for(const opposite of [{x:-900,y:500},{x:1000,y:-700}])near(geometry.portPoint({...n,cardStyle:shape},port,opposite),want);
  }
});
test('automatic and invalid ports retain rectangle midpoints and curved shape rays',()=>{
  const n={x:10,y:20,width:200,height:100};
  for(const port of ['auto',undefined,'unknown','toString','__proto__'])near(geometry.portPoint(n,port,{x:210,y:120}),{x:210,y:70});
  near(geometry.portPoint({...n,cardStyle:'circle'},'auto',{x:210,y:120}),{x:180.71067811865476,y:105.35533905932738});
  near(geometry.portPoint({...n,cardStyle:'triangle'},'auto',{x:210,y:70}),{x:160,y:70});
});
test('sanitizer and storage hydrate roundtrip preserve fixed ports and normalize missing/invalid values',()=>{
  const {c}=environment(),raw={nodes:[{id:'a'},{id:'b'}],links:[{id:'fixed',from:'a',to:'b',fromPort:'right',toPort:'top'},{id:'old',from:'a',to:'b'},{id:'invalid',from:'a',to:'b',fromPort:'RIGHT',toPort:{bad:1}}]};
  const clean=c.sanitizeState(raw);
  assert.deepEqual(plain(clean.links.map(l=>[l.fromPort,l.toPort])),[['right','top'],['auto','auto'],['auto','auto']]);
  for(const operation of [c.KGGraphPersistence.hydrate,c.KGGraphPersistence.toStorageState]){
    const stored=operation(raw);assert.deepEqual(plain(stored.links.map(l=>[l.fromPort,l.toPort])),[['right','top'],['auto','auto'],['auto','auto']]);
    assert.equal(raw.links[1].fromPort,undefined,'input remains unchanged');
    assert.deepEqual(plain(c.sanitizeState(JSON.parse(JSON.stringify(stored))).links),plain(clean.links));
  }
});

test('an outer-segment route retains every corner through sanitizing and storage reload',()=>{
  const {c}=environment(),start={x:0,y:0},end={x:70,y:60};
  const before=Array.from({length:12},(_,i)=>({x:Math.ceil((i+1)/2)*10,y:Math.floor((i+1)/2)*10}));
  const moved=geometry.moveElbowSegment(start,end,before,0,{x:0,y:-10});
  const raw={nodes:[{id:'a'},{id:'b'}],links:[{id:'long',from:'a',to:'b',pathStyle:'elbow',waypoints:moved}]};
  const clean=c.sanitizeState(raw),stored=c.KGGraphPersistence.toStorageState(clean);
  const reopened=c.sanitizeState(c.KGGraphPersistence.hydrate(JSON.parse(JSON.stringify(stored))));
  assert.equal(moved.length,13);assert.deepEqual(plain(reopened.links[0].waypoints),moved);
});
test('creation/controller and route cancel/rebind keep the selected endpoint ports',()=>{
  const {c,nodes}=environment();nodes.set('a',{id:'a',x:10,y:20,w:200,h:100});nodes.set('b',{id:'b',x:500,y:200,w:100,h:80});
  const s={linkSourceId:'a',links:[]};
  const controller=c.KGGraphConnectionController.create({getState:()=>s,getNode:id=>nodes.get(id),createLink:(a,b)=>c.makeLink(a,b),addLink:l=>s.links.push(l)});
  const link=controller.connectTo('b',{fromPort:'right',toPort:'top'}).link;
  assert.deepEqual([link.fromPort,link.toPort],['right','top']);
  const before=c.edgeRouteSnapshot(link);c.setLinkFreeEndpoint(link,'from',{x:300,y:190});assert.ok(c.bindLinkEndpoint(link,'from','a'));
  assert.deepEqual(plain(c.linkRenderPoints(link).a),{x:210,y:70});
  link.fromPort='left';link.toPort='bottom';c.restoreEdgeRoute(link,before);
  assert.deepEqual([link.fromPort,link.toPort],['right','top']);
  assert.deepEqual(plain(c.linkRenderPoints(link).b),{x:550,y:200});
  nodes.get('a').x=-600;nodes.get('a').w=340;nodes.get('a').h=260;
  assert.deepEqual(plain(c.linkRenderPoints(link).a),{x:-260,y:150});
  assert.deepEqual(plain(c.linkRenderPoints(link).b),{x:550,y:200});
  const moved=geometry.moveRoute({...plain(before),start:{x:210,y:70},end:{x:550,y:200},curveControls:[{x:300,y:70},{x:550,y:100}]},{x:12,y:23},{x:12,y:23});
  assert.deepEqual([moved.fromPort,moved.toPort],['right','top']);
  assert.deepEqual(plain(c.makeLink('a','b').fromPort),'auto');
});

test('automatic curves leave and approach each fixed side with outward control tangents',()=>{
  const {c,nodes}=environment();nodes.set('a',{id:'a',x:0,y:0,w:160,h:80});nodes.set('b',{id:'b',x:400,y:200,w:200,h:100});
  const link={from:'a',to:'b',fromPort:'left',toPort:'bottom',pathStyle:'curve'},p=c.linkRenderPoints(link),g=c.linkPathGeometry(link,p.a,p.b,p);
  assert.equal(g.curveControls[0].y,40);assert.ok(g.curveControls[0].x<0,'left port must leave to the left');
  assert.equal(g.curveControls[1].x,500);assert.ok(g.curveControls[1].y>300,'bottom port must approach from below');
  const manual=[{x:10,y:15},{x:25,y:35}];
  assert.deepEqual(plain(c.linkPathGeometry({...link,curveControls:manual},p.a,p.b,p).curveControls),manual,'fixed ports do not override explicit manual controls');
});

test('storage normalization leaves malformed legacy link entries for the sanitizer to discard',()=>{
  const {c}=environment(),raw={nodes:[{id:'a'},{id:'b'}],links:[null,{id:'ok',from:'a',to:'b',fromPort:'left',toPort:'top'}]};
  const clean=c.sanitizeState(c.KGGraphPersistence.hydrate(raw));
  assert.equal(clean.links.length,1);assert.deepEqual([clean.links[0].fromPort,clean.links[0].toPort],['left','top']);
});

test('elbows keep bottom-to-top ports vertical with a horizontal trunk, including stale diagonal waypoints',()=>{
 const {c}=environment(),a={x:80,y:80},b={x:500,y:240};
 for(const waypoints of [undefined,[{x:140,y:113},{x:340,y:172}]]){
  const link={pathStyle:'elbow',fromPort:'bottom',toPort:'top',waypoints},g=c.linkPathGeometry(link,a,b);
  assert.equal(g.samples[1].x,a.x);assert.ok(g.samples[1].y>a.y);
  assert.equal(g.samples.at(-2).x,b.x);assert.ok(g.samples.at(-2).y<b.y);
  for(let i=1;i<g.samples.length;i++)assert.ok(g.samples[i-1].x===g.samples[i].x||g.samples[i-1].y===g.samples[i].y,'all segments must be orthogonal');
  assert.equal(link.waypoints,waypoints,'rendering must not replace saved route');
 }
});
test('elbow rendering removes forward collinear corners while retaining necessary backtracks',()=>{
 const {c}=environment(),g=c.linkPathGeometry({pathStyle:'elbow',waypoints:[{x:20,y:0},{x:40,y:0},{x:40,y:100}]},{x:0,y:0},{x:100,y:100});
 assert.deepEqual(plain(g.samples),[{x:0,y:0},{x:40,y:0},{x:40,y:100},{x:100,y:100}]);
});

test('edge settings prefer the triggering click over distant cubic control handles',()=>{
 const {c}=environment();c.selectedEditableLinks=()=>[{id:'edge'}];c.edgeDomById=new Map([['edge',{geometry:{style:'curve',curveControls:[{},{}],controls:[{kind:'curve-control',x:2000,y:2000},{kind:'curve-control',x:3000,y:3000}]}}]]);c.state={viewport:{scale:2,x:10,y:20}};c.selectedEdgeQuickStyleAnchorWorld={x:50,y:60};
 const src=fs.readFileSync(require('node:path').join(__dirname,'../src/10-graph-editor.js'),'utf8');vm.runInContext(src.slice(src.indexOf('function selectedEdgeQuickScreenPoint('),src.indexOf('function setSelectedEdgeQuickStyleAnchorFromEvent(')),c);
 const p=c.selectedEdgeQuickScreenPoint();assert.equal(p.x,110);assert.equal(p.y,140);
});

test('batch elbow conversion and card moves preserve selected ports, ids and every arrow route',()=>{
 const {c,nodes}=environment();nodes.set('a',{id:'a',x:10,y:20,w:180,h:100});nodes.set('b',{id:'b',x:540,y:280,w:200,h:100});
 const links=['top','right','bottom','left'].flatMap(fromPort=>['top','right','bottom','left'].map(toPort=>({id:fromPort+'-'+toPort,from:'a',to:'b',fromPort,toPort,pathStyle:'curve',waypoints:[{x:333,y:111},{x:444,y:222}]})));
 links.forEach(l=>l.pathStyle='elbow');
 for(const move of [0,730]){
  nodes.get('a').x=10+move;nodes.get('a').y=20-move/2;
  for(const link of links){
   const p=c.linkRenderPoints(link),g=c.linkPathGeometry(link,p.a,p.b,p),samples=g.samples,from=geometry.portDirection(link.fromPort),to=geometry.portDirection(link.toPort);
   const first=samples[1],last=samples.at(-2);
   assert.ok((first.x-p.a.x)*from.x+(first.y-p.a.y)*from.y>0,link.id+' outward start');
   assert.ok((last.x-p.b.x)*to.x+(last.y-p.b.y)*to.y>0,link.id+' outward end');
   for(let i=1;i<samples.length;i++)assert.ok(samples[i-1].x===samples[i].x||samples[i-1].y===samples[i].y);
   assert.equal(link.from,'a');assert.equal(link.to,'b');
  }
 }
 assert.equal(new Set(links.map(l=>l.id)).size,16);
});

test('actual planner and renderer share generated fixed-port trunks with generated and manual peers',()=>{
 for(const manual of [[],[1],[0]]){
  const {c}=environment();vm.runInContext(fs.readFileSync(require('node:path').join(__dirname,'../src/graph/edge-bundle.js'),'utf8'),c);
  const links=[0,1].map(i=>({id:'route-'+i,from:'source-'+i,to:'target-'+i,pathStyle:'elbow',fromPort:'bottom',toPort:'top',arrowStyle:i?'both':'end',...(manual.includes(i)?{waypoints:[{x:i*20,y:100+i*20},{x:200+i*20,y:100+i*20}]}:{})}));
  const points=links.map((l,i)=>({a:{x:i*20,y:i*20},b:{x:200+i*20,y:200+i*20},ca:{x:i*20,y:i*20-40},cb:{x:200+i*20,y:240+i*20}}));
  const before=JSON.stringify(links),bundlePlan=c.KGGraphEdgeBundle.plan(links.map((l,i)=>({...l,...points[i],waypoints:l.waypoints||[],hasFromPort:true,hasToPort:true,hasStoredWaypoints:!!l.waypoints})));
  const rendered=links.map((l,i)=>c.linkPathGeometry(l,points[i].a,points[i].b,{...points[i],mainGraph:true,bundlePlan}));
  assert.equal(bundlePlan.segmentChannels.size,2,'both independent relations must have planned trunks');
  for(const g of rendered){
   const s=g.samples;assert.equal(s[0].x,s[1].x);assert.ok(s[1].y>s[0].y);assert.equal(s.at(-1).x,s.at(-2).x);assert.ok(s.at(-2).y<s.at(-1).y);
   assert.equal(s[1].y,120,'generated route must consume the planned common channel');
   for(let i=1;i<s.length;i++)assert.ok(s[i-1].x===s[i].x||s[i-1].y===s[i].y);
  }
  assert.equal(JSON.stringify(links),before,'bundling must preserve ports, ids, arrows and manual guides');
 }
});

test('mixed generated and manual right-to-left trunks share their planned vertical segment',()=>{
 const {c}=environment();vm.runInContext(fs.readFileSync(require('node:path').join(__dirname,'../src/graph/edge-bundle.js'),'utf8'),c);
 const links=[{id:'auto',pathStyle:'elbow',fromPort:'right',toPort:'left'},{id:'manual',pathStyle:'elbow',fromPort:'right',toPort:'left',waypoints:[{x:120,y:20},{x:120,y:220}]}];
 const points=links.map((l,i)=>({a:{x:i*20,y:i*20},b:{x:200+i*20,y:200+i*20},ca:{x:i*20-40,y:i*20},cb:{x:240+i*20,y:200+i*20}}));
 const bundlePlan=c.KGGraphEdgeBundle.plan(links.map((l,i)=>({...l,...points[i],waypoints:l.waypoints||[],hasFromPort:true,hasToPort:true})));
 for(const [i,link] of links.entries()){
  const samples=c.linkPathGeometry(link,points[i].a,points[i].b,{...points[i],mainGraph:true,bundlePlan}).samples;
  assert.equal(samples[1].x,120);assert.equal(samples[1].y,samples[0].y);assert.ok(samples[1].x>samples[0].x);
  assert.equal(samples.at(-2).y,samples.at(-1).y);assert.ok(samples.at(-2).x<samples.at(-1).x);
 }
});
