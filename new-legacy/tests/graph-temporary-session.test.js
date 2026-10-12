'use strict';
const test=require('node:test'),assert=require('node:assert/strict');
require('../src/graph/history-controller.js');
require('../src/graph/graph-session.js');
require('../src/graph/related-canvas-controller.js');
const graph={nodes:Array.from({length:12},(_,i)=>({id:String(i),x:i*20,y:30,content:{title:'card '+i}})),links:[{id:'a',from:'0',to:'1',type:'x'},{id:'b',from:'1',to:'2',type:'y'},{id:'c',from:'3',to:'2'},{id:'d',from:'1',to:'3'},{id:'z',from:'9',to:'10'}],resources:[{id:'r',metadata:{x:1}}]};
test('one hop union includes every selected card and induced links without recursion',()=>{
 const scope=KGRelatedCanvasController.scopeOneHop(graph,['0','3','11']);
 assert.deepEqual(scope.nodes.map(n=>n.id),['0','1','2','3','11']);
 assert.deepEqual(scope.links.map(n=>n.id),['a','b','c','d']);
 assert.deepEqual(KGRelatedCanvasController.scopeOneHop(graph,['11']).nodes.map(n=>n.id),['11']);
 assert.equal(KGRelatedCanvasController.scopeOneHop(graph,graph.nodes.map(n=>n.id)).nodes.length,12);
});
test('temporary sessions clone graph, reject persistence and own disposable history/resources',()=>{
 let writes=0;assert.throws(()=>KGGraphSession.create({kind:'temporary',graph,persist:()=>writes++}),/persist/i);
 const original=JSON.stringify(graph),formal=KGGraphSession.create({kind:'formal',graph,fileId:'file',persist:()=>writes++});
 formal.history.checkpoint('formal');const s=KGGraphSession.create({kind:'temporary',graph});
 s.history.run('edit',()=>{s.getState().nodes[0].content.title='temp';s.getState().resources[0].metadata.x=2});
 assert.equal(s.persist(),true);assert.equal(writes,0);assert.equal(JSON.stringify(graph),original);
 s.history.undo();assert.equal(s.getState().nodes[0].content.title,'card 0');s.history.redo();assert.equal(s.getState().nodes[0].content.title,'temp');
 assert.equal(formal.fileId,'file');assert.equal(formal.history.getState().undoCount,1);
 let revoked=[];s.trackObjectUrl('blob:test',url=>revoked.push(url));s.close();s.close();
 assert.deepEqual(revoked,['blob:test']);assert.equal(s.history.getState().undoCount,0);assert.throws(()=>s.getState(),/closed/);
 assert.equal(KGGraphSession.create({kind:'temporary',graph}).getState().nodes[0].content.title,'card 0');
});

test('one hop resources copy only referenced descriptors and reject unknown selections',()=>{
 const source={nodes:[{id:'a',resourceId:'used'},{id:'b',resourceIds:['second']},{id:'c',assetId:'other'}],links:[{id:'ab',from:'a',to:'b'}],resources:[{id:'used',data:{x:1}},{id:'second'},{id:'other'}]};
 const scope=KGRelatedCanvasController.scopeOneHop(source,['a','not-visible']);
 assert.deepEqual(scope.resources.map(r=>r.id),['used','second']);assert.equal(scope.nodes.length,2);
 const s=KGGraphSession.create({kind:'temporary',graph:scope});s.getState().resources[0].data.x=9;
 assert.equal(source.resources[0].data.x,1);assert.equal(KGRelatedCanvasController.scopeOneHop(source,['not-visible']).nodes.length,0);
});
test('formal autosave refuses explicitly temporary sessions without invoking its adapter',()=>{
 const fs=require('node:fs'),vm=require('node:vm');let writes=0;
 const window={dispatchEvent(){},addEventListener(){},persistCurrentGraphNow(){writes++;return true}};
 vm.runInNewContext(fs.readFileSync(require.resolve('../src/24-graph-file-autosave.js'),'utf8'),{window,document:{documentElement:{dataset:{}}},CustomEvent:function(){},console,setInterval,clearInterval});
 assert.equal(window.KGGraphFileAutosave.saveNow({force:true,session:{kind:'temporary'}}),false);assert.equal(writes,0);
});
