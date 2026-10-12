const test=require('node:test'),assert=require('node:assert/strict');
require('../src/graph/graph-model.js');
const layout=require('../src/graph/mindmap-layout.js'),themes=require('../src/graph/mindmap-themes.js');
const model=global.KGGraphModel;
function fixture(){return model.normalizeGraph({nodes:['a','b','c','d','e'].map((id,i)=>({id,title:id,x:i*20,y:0,geometry:{width:100+i*20,height:70+i*10}})),links:[{id:'ab',from:'a',to:'b'},{id:'ac',from:'a',to:'c'},{id:'bd',from:'b',to:'d'},{id:'cd',from:'c',to:'d'},{id:'da',from:'d',to:'a'}]})}
test('four directions, stable spanning forest and every cross relation survive',()=>{const g=fixture(),original=JSON.stringify(g);for(const direction of ['right','left','bilateral','down']){const r=layout.compute(g,{rootIds:['a'],direction});assert.equal(Object.keys(r.positions).length,5);assert.equal(r.treeEdges.length+r.crossEdges.length,5);assert.deepEqual(r,layout.compute(g,{rootIds:['a'],direction}));if(direction==='right')assert(r.positions.b.x>r.positions.a.x);if(direction==='left')assert(r.positions.b.x<r.positions.a.x);if(direction==='down')assert(r.positions.b.y>r.positions.a.y);if(direction==='bilateral')assert((r.positions.b.x-r.positions.a.x)*(r.positions.c.x-r.positions.a.x)<0)}assert.equal(JSON.stringify(g),original)});
test('mirror honors dimensions and explicit selection stays scoped; ambiguous graph requires root',()=>{const g=fixture(),right=layout.compute(g,{rootIds:['a'],direction:'right'}),left=layout.compute(g,{rootIds:['a'],direction:'left'});for(const n of g.nodes.filter(n=>n.id!=='e'))assert.equal(right.positions[n.id].x+left.positions[n.id].x+n.geometry.width,100);assert.deepEqual(Object.keys(layout.compute(g,{rootIds:['b'],scopeIds:['b','d']}).positions).sort(),['b','d']);assert.throws(()=>layout.compute(g,{}),/根节点/)});
test('six themes change defaults and protect individual manual appearance across themes',()=>{const g=fixture();model.updateAppearance(g.nodes[1],{fillColor:'#123456',fontSize:36});const before=g.nodes.map(n=>model.geometryOf(n));assert.equal(themes.presets.length,6);themes.apply(g,{themeId:'blue',model});assert.equal(model.appearanceOf(g.nodes[0]).fillColor,'#dbeafe');assert.equal(model.appearanceOf(g.nodes[1]).fillColor,'#123456');assert.equal(model.appearanceOf(g.nodes[1]).fontSize,36);model.updateAppearance(g.nodes[0],{borderColor:'#abcdef'});themes.apply(g,{themeId:'paper',model});assert.equal(model.appearanceOf(g.nodes[0]).fillColor,'#fef3c7');assert.equal(model.appearanceOf(g.nodes[0]).borderColor,'#abcdef');themes.apply(g,{themeId:'wire',model,override:true});assert.equal(model.appearanceOf(g.nodes[1]).fillColor,'#ffffff');assert.deepEqual(g.nodes.map(n=>model.geometryOf(n)),before)});

require('../src/graph/edge-geometry.js');
test('layout transforms manual routes from both endpoint snapshots, retains ports and repeat positions',()=>{
 const g=fixture();g.links[0].fromPort='left';g.links[0].toPort='top';g.links[0].curveControls=[{x:20,y:30},{x:60,y:70}];
 const endpoint=(l,m)=>({a:{x:m.get(l.from).x,y:m.get(l.from).y},b:{x:m.get(l.to).x,y:m.get(l.to).y}}),map=new Map(g.nodes.map(n=>[n.id,n]));
 const old={...g.links[0],start:endpoint(g.links[0],map).a,end:endpoint(g.links[0],map).b};
 const r=layout.apply(g,{rootIds:['a'],model,endpoints:endpoint});const next=endpoint(g.links[0],map);
 const expected=global.KGGraphEdgeGeometry.moveRoute(old,{x:next.a.x-old.start.x,y:next.a.y-old.start.y},{x:next.b.x-old.end.x,y:next.b.y-old.end.y});assert.deepEqual(g.links[0].curveControls,expected.curveControls);assert.equal(g.links[0].fromPort,'left');assert.equal(g.links[0].toPort,'top');
 assert.deepEqual(layout.apply(g,{rootIds:['a'],model,endpoints:endpoint}).positions,r.positions);
 const original=JSON.stringify(g.nodes.filter(n=>!['b','d'].includes(n.id)));layout.apply(g,{rootIds:['b'],scopeIds:['b','d'],direction:'down',model,endpoints:endpoint});assert.equal(JSON.stringify(g.nodes.filter(n=>!['b','d'].includes(n.id))),original);
});
test('disconnected down layout has disjoint component regions and theme manual fields persist',()=>{
 const g=fixture(),r=layout.compute(g,{rootIds:['a'],direction:'down'});assert(r.positions.e.y>Math.max(...g.nodes.filter(n=>n.id!=='e').map(n=>r.positions[n.id].y+n.geometry.height)));
 themes.apply(g,{themeId:'blue',model});model.updateAppearance(g.nodes[0],{fillColor:'#123456'});themes.apply(g,{themeId:'paper',model});themes.apply(g,{themeId:'wire',model});assert.equal(model.appearanceOf(g.nodes[0]).fillColor,'#123456');
});

test('manual edge appearance remains protected through multiple themes and explicit override resets it',()=>{
 const g=fixture();themes.apply(g,{themeId:'blue',model});g.links[0].color='#abcdef';themes.apply(g,{themeId:'paper',model});themes.apply(g,{themeId:'mono',model});assert.equal(g.links[0].color,'#abcdef');themes.apply(g,{themeId:'wire',model,override:true});assert.equal(g.links[0].color,'#64748b');
});

test('directed hierarchy descendants take priority over incoming cycle shortcuts',()=>{const r=layout.compute(fixture(),{rootIds:['a']});assert(r.treeEdges.some(e=>e.id==='bd'));assert(r.crossEdges.some(e=>e.id==='da'));assert(r.crossEdges.some(e=>e.id==='cd'))});
test('declared hierarchy beats earlier ordinary shortcuts and determines the inferred root',()=>{
 const g=global.KGGraphModel.normalizeGraph({nodes:['a','b','c'].map(id=>({id})),links:[{id:'shortcut',from:'a',to:'c'},{id:'back',from:'c',to:'a'},{id:'ab',from:'a',to:'b',hierarchy:true},{id:'bc',from:'b',to:'c',hierarchy:true}]});
 const r=layout.compute(g,{});assert.deepEqual(r.rootIds,['a']);assert.deepEqual(r.treeEdges.map(l=>l.id),['ab','bc']);assert.deepEqual(r.crossEdges.map(l=>l.id),['shortcut','back']);
});
test('hierarchy boolean survives model, storage and fragment copy; missing or truthy strings are ordinary',()=>{
 require('../src/graph/graph-persistence.js');const fragment=require('../src/graph/graph-fragment.js');
 const g=model.normalizeGraph({nodes:[{id:'a'},{id:'b'}],links:[{id:'ab',from:'a',to:'b',hierarchy:true},{id:'ba',from:'b',to:'a',hierarchy:'true'}]});
 const stored=global.KGGraphPersistence.toStorageState(g);assert.equal(stored.links[0].hierarchy,true);assert.equal(stored.links[1].hierarchy,false);assert.equal(global.KGGraphPersistence.hydrate({nodes:g.nodes,links:[{id:'old',from:'a',to:'b'}]}).links[0].hierarchy,false);
 const copied=fragment.remap(fragment.capture(stored,{nodeIds:['a','b']}),{idFactory:(kind,id)=>'copy-'+id}).fragment;assert.equal(copied.links[0].hierarchy,true);assert.equal(copied.links[1].hierarchy,false);
});

test('explicit ordinary root reaches a declared parent before consuming its child shortcut',()=>{
 const g=model.normalizeGraph({nodes:['a','b','c'].map(id=>({id})),links:[{id:'ac',from:'a',to:'c'},{id:'ab',from:'a',to:'b'},{id:'bc',from:'b',to:'c',hierarchy:true}]});const r=layout.compute(g,{rootIds:['a']});assert.deepEqual(r.treeEdges.map(l=>l.id),['ab','bc']);assert.deepEqual(r.crossEdges.map(l=>l.id),['ac']);
});
