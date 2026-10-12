'use strict';
const test=require('node:test'),assert=require('node:assert/strict');
const fs=require('node:fs'),vm=require('node:vm');
function moduleApi(){const c={};c.window=c;vm.createContext(c);vm.runInContext(fs.readFileSync('new-legacy/src/graph/graph-fragment.js','utf8'),c);return c.KGGraphFragment}
const graph={fileId:'source',revision:3,nodes:[{id:'a',x:10,y:20,geometry:{x:10,y:20,width:180,height:90},content:{description:'正文'},appearance:{color:'#fff'}},{id:'b',x:300,y:70},{id:'c'}],links:[{id:'ab',from:'a',to:'b',fromPort:'left',toPort:'top',curveControls:[{x:-50,y:40},{x:300,y:0}]},{id:'ac',from:'a',to:'c'}],elements:[],tables:[]};
test('capture includes internal relations and independent nested content',()=>{const api=moduleApi(),f=api.capture(graph,{nodeIds:['a','b']});assert.equal(f.format,'kg-graph-fragment');assert.equal(f.links.length,1);f.nodes[0].content.description='changed';assert.equal(graph.nodes[0].content.description,'正文');assert.equal(f.source.fileId,'source')});
test('two pastes remap all ids, geometry and route points without changing source',()=>{const api=moduleApi(),f=api.capture(graph,{nodeIds:['a','b']}),before=JSON.stringify(f);let i=0;const one=api.remap(f,{idFactory:()=>`new-${++i}`,offset:{x:100,y:-20}}),two=api.remap(f,{idFactory:()=>`new-${++i}`});assert.notEqual(one.fragment.nodes[0].id,two.fragment.nodes[0].id);assert.equal(one.fragment.links[0].from,one.fragment.nodes[0].id);assert.equal(one.fragment.links[0].to,one.fragment.nodes[1].id);assert.equal(one.fragment.links[0].fromPort,'left');assert.equal(one.fragment.nodes[0].geometry.x,110);assert.equal(one.fragment.links[0].curveControls[0].x,50);assert.equal(JSON.stringify(f),before)});
test('invalid versions, duplicate ids and dangling links fail before paste',()=>{const api=moduleApi(),f=api.capture(graph,{nodeIds:['a','b']});for(const bad of [{...f,version:2},{...f,nodes:[f.nodes[0],f.nodes[0]]},{...f,links:[{id:'bad',from:'a',to:'external'}]}])assert.throws(()=>api.remap(bad,{idFactory:()=> 'new'}));assert.equal(api.parse('ordinary text'),null);assert.equal(api.parse(JSON.stringify({...f,version:99})),null)});
test('explicit event transfer is deep copied; invalid text does not replace clipboard',()=>{
  const c={};c.window=c;vm.createContext(c);for(const path of ['graph-fragment','clipboard-controller'])vm.runInContext(fs.readFileSync(`new-legacy/src/graph/${path}.js`,'utf8'),c);
  const one=c.KGGraphClipboardController.create(),two=c.KGGraphClipboardController.create(),data=new Map(),event={clipboardData:{setData:(k,v)=>data.set(k,v),getData:k=>data.get(k)||''}};
  one.writeFragment(c.KGGraphFragment.capture(graph,{nodeIds:['a','b']}));assert.ok(one.exportEvent(event));assert.ok(two.importEvent(event));
  const read=two.readFragment();read.nodes[0].title='mutation';assert.notEqual(two.readFragment().nodes[0].title,'mutation');
  data.clear();data.set('text/plain','ordinary text');assert.equal(two.importEvent(event),false);assert.ok(two.hasData());two.clear();assert.equal(two.hasData(),false);
});
test('text elements and resource references are independent and only selected resources travel',()=>{
  const api=moduleApi(),g={...graph,nodes:[{...graph.nodes[0],resourceId:'selected'},graph.nodes[1]],resources:[{id:'selected',url:'/resource/one'},{id:'unused',url:'/resource/two'}],elements:[{id:'text',text:'内容',geometry:{x:30,y:40,width:250,height:80},appearance:{fontSize:22}}]};
  const f=api.capture(g,{nodeIds:['a'],elementIds:['text']});assert.equal(f.resources.length,1);assert.equal(f.links.length,0);
  let i=0;const result=api.remap(f,{idFactory:()=>`copy-${++i}`,offset:{x:7,y:9}}).fragment;
  assert.equal(result.elements[0].geometry.x,37);assert.equal(result.elements[0].geometry.y,49);assert.equal(result.elements[0].appearance.fontSize,22);
  result.resources[0].url='changed';assert.equal(g.resources[0].url,'/resource/one');
});
test('account refresh preserves clipboard but logout and account replacement clear it',()=>{
  const callbacks={},c={account:'alice',graphClipboardNodes:null,graphClipboardTextElement:null};c.window=c;c.KGAuthCore={currentUsername:()=>c.account};c.addEventListener=(event,fn)=>callbacks[event]=fn;vm.createContext(c);
  for(const file of ['graph-fragment','clipboard-controller'])vm.runInContext(fs.readFileSync(`new-legacy/src/graph/${file}.js`,'utf8'),c);
  c.clipboard=c.KGGraphClipboardController.create();c.ensureGraphClipboardController=()=>c.clipboard;
  const source=fs.readFileSync('new-legacy/src/10-graph-editor.js','utf8');vm.runInContext(source.slice(source.indexOf('function clearGraphClipboard()'),source.indexOf("document.addEventListener('copy'")),c);
  const fill=()=>c.clipboard.writeFragment(c.KGGraphFragment.capture(graph,{nodeIds:['a']}));fill();callbacks['kg-auth-session-change']();assert.ok(c.clipboard.hasData());c.account='bob';callbacks['kg-auth-session-change']();assert.equal(c.clipboard.hasData(),false);fill();c.account='';callbacks['kg-auth-session-change']();assert.equal(c.clipboard.hasData(),false);
});
test('malformed provenance and endpoint coordinates are rejected',()=>{
  const api=moduleApi(),f=api.capture(graph,{nodeIds:['a','b']});
  assert.equal(api.parse(JSON.stringify({...f,source:null})),null);
  assert.equal(api.parse(JSON.stringify({...f,links:[{...f.links[0],fromPoint:{x:'bad',y:1}}]})),null);
});
test('valid dense graph captures and remaps all 5000 internal links',()=>{
  const api=moduleApi();
  const nodes=Array.from({length:101},(_,index)=>({id:`node-${index}`,x:index*20,y:0}));
  const links=[];
  for(let from=0;from<nodes.length&&links.length<5000;from++){
    for(let to=from+1;to<nodes.length&&links.length<5000;to++){
      links.push({id:`edge-${links.length}`,from:nodes[from].id,to:nodes[to].id,fromPort:'right',toPort:'left'});
    }
  }
  const dense={nodes,links,elements:[],tables:[]};
  const fragment=api.capture(dense,{nodeIds:nodes.map(node=>node.id)});
  assert.equal(fragment.links.length,5000);
  let id=0;
  const copy=api.remap(fragment,{idFactory:()=>`copied-${++id}`}).fragment;
  const copiedIds=new Set(copy.nodes.map(node=>node.id));
  assert.equal(copy.links.length,5000);
  assert.ok(copy.links.every(link=>copiedIds.has(link.from)&&copiedIds.has(link.to)));
  assert.equal(dense.links[4999].id,'edge-4999');
  assert.throws(()=>api.capture({...dense,links:[...links,{id:'overflow',from:nodes[0].id,to:nodes[1].id}]},{nodeIds:nodes.map(node=>node.id)}),/Invalid fragment collection/);
});
test('node and text-element collection limits match existing sanitizer',()=>{
  const api=moduleApi(),empty=api.capture({nodes:[],links:[]},{nodeIds:[]});
  for(const [key,limit] of [['nodes',2500],['elements',1500]]){
    const items=Array.from({length:limit},(_,index)=>({id:`${key}-${index}`}));
    assert.doesNotThrow(()=>api.validate({...empty,[key]:items}));
    assert.throws(()=>api.validate({...empty,[key]:[...items,{id:'overflow'}]}),/Invalid fragment collection/);
  }
});
