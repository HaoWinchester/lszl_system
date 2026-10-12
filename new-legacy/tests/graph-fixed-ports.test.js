'use strict';
const assert=require('node:assert/strict'),test=require('node:test'),fs=require('node:fs'),vm=require('node:vm');
const geometry=require('../src/graph/edge-geometry.js');
const plain=value=>JSON.parse(JSON.stringify(value));
const near=(actual,expected)=>{for(const axis of ['x','y'])assert.ok(Math.abs(actual[axis]-expected[axis])<1e-7,JSON.stringify({actual,expected}))};
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
