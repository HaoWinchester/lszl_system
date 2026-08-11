'use strict';

const assert=require('assert');
const fs=require('fs');
const path=require('path');
const vm=require('vm');

const ROOT=path.resolve(__dirname,'..');
const context={console,structuredClone:global.structuredClone,setTimeout,clearTimeout};
context.globalThis=context;
vm.createContext(context);
[
  'src/graph/graph-model.js',
  'src/graph/graph-persistence.js',
  'src/graph/history-controller.js',
  'src/graph/selection-controller.js',
  'src/graph/drag-controller.js',
  'src/graph/connection-controller.js',
  'src/graph/clipboard-controller.js',
  'src/graph/style-controller.js',
  'src/graph/viewport-controller.js',
  'src/graph/graph-renderer.js'
].forEach(file=>vm.runInContext(fs.readFileSync(path.join(ROOT,file),'utf8'),context,{filename:file}));

const Model=context.KGGraphModel;
const Persistence=context.KGGraphPersistence;
assert(Model&&Persistence,'graph model and persistence modules should load');

const legacy={id:'n1',title:'Legacy',summary:'Legacy description',category:'Base',level:'重点',keywords:'a,b',notes:'note',x:12,y:34,color:'#123456',size:'big'};
const node=Model.normalizeNode(legacy);
assert.strictEqual(node.content.title,'Legacy');
assert.strictEqual(node.content.description,'Legacy description');
assert.strictEqual(node.appearance.cardStyle,'standard','legacy nodes must default to standard card');
assert.strictEqual(node.appearance.color,'#123456');
assert.deepStrictEqual(JSON.parse(JSON.stringify(node.geometry)),{x:12,y:34,width:160,height:166});
assert.strictEqual(node.title,'Legacy');
assert.strictEqual(node.x,12);

const beforeAppearance=JSON.stringify(node.appearance),beforeGeometry=JSON.stringify(node.geometry);
Model.updateContent(node,{title:'Updated',description:'Changed'});
assert.strictEqual(node.title,'Updated');
assert.strictEqual(node.summary,'Changed');
assert.strictEqual(JSON.stringify(node.appearance),beforeAppearance,'content update must not change appearance');
assert.strictEqual(JSON.stringify(node.geometry),beforeGeometry,'content update must not change geometry');

const beforeContent=JSON.stringify(node.content),geometryBeforeAppearance=JSON.stringify(node.geometry);
Model.updateAppearance(node,{color:'#abcdef',cardStyle:'sticky',textAlign:'left'});
assert.strictEqual(node.color,'#abcdef');
assert.strictEqual(node.cardStyle,'sticky');
assert.strictEqual(node.textAlign,'left');
assert.strictEqual(JSON.stringify(node.content),beforeContent,'appearance update must not change content');
assert.strictEqual(JSON.stringify(node.geometry),geometryBeforeAppearance,'non-size appearance update must not change geometry');

const contentBeforeGeometry=JSON.stringify(node.content),appearanceBeforeGeometry=JSON.stringify(node.appearance);
Model.updateGeometry(node,{x:88,y:99});
assert.strictEqual(node.x,88);
assert.strictEqual(node.y,99);
assert.strictEqual(JSON.stringify(node.content),contentBeforeGeometry,'geometry update must not change content');
assert.strictEqual(JSON.stringify(node.appearance),appearanceBeforeGeometry,'position update must not change appearance');

const oldGraph={nodes:[legacy,{id:'n2',title:'Second',x:0,y:0,color:'#654321'}],links:[{id:'l1',from:'n1',to:'n2',type:'关联'}],viewport:{x:1,y:2,scale:1}};
const hydrated=Persistence.hydrate(oldGraph);
assert.strictEqual(hydrated.nodes.length,2);
assert.strictEqual(hydrated.links.length,1);
assert.strictEqual(hydrated.links[0].from,'n1');
assert.strictEqual(hydrated.nodes[1].appearance.cardStyle,'standard');
const stored=Persistence.toStorageState({...hydrated,selectedNodeId:'n1',selectedLinkId:'l1',linkSourceId:'n2'});
assert.strictEqual(stored.selectedNodeId,null);
assert.strictEqual(stored.selectedLinkId,null);
assert.strictEqual(stored.linkSourceId,null);
assert.strictEqual(stored.links[0].id,'l1');

let graph=Persistence.hydrate({
  defaults:{nodeColor:'#64748b',nodeCardStyle:'standard',nodeTextAlign:'center'},
  nodes:[{id:'a',title:'A',x:0,y:0,color:'#111111'},{id:'b',title:'B',x:10,y:10,color:'#222222'}],
  links:[]
});
function clone(value){return JSON.parse(JSON.stringify(value))}
const history=context.KGGraphHistoryController.create({
  limit:10,
  capture:()=>clone(graph),
  restore:snapshot=>{graph=clone(snapshot)}
});
let styleEvents=0;
const style=context.KGGraphStyleController.create({
  model:Model,getGraph:()=>graph,history,onChange:()=>styleEvents++
});
style.updateAppearance(['a','b'],{color:'#ff0000',cardStyle:'sticky'},'批量换样式');
assert.strictEqual(history.getState().undoCount,1,'batch style update must create exactly one history entry');
assert.strictEqual(styleEvents,1);
assert.strictEqual(graph.nodes[0].appearance.color,'#ff0000');
assert.strictEqual(graph.nodes[1].appearance.cardStyle,'sticky');
assert.strictEqual(graph.defaults.nodeColor,'#ff0000');
assert.strictEqual(graph.defaults.nodeCardStyle,'sticky');
const undoItem=history.undo();
assert.strictEqual(undoItem.label,'批量换样式');
assert.strictEqual(graph.nodes[0].appearance.color,'#111111');
assert.strictEqual(graph.nodes[1].appearance.color,'#222222');
assert.strictEqual(graph.defaults.nodeColor,'#64748b');
assert.strictEqual(history.getState().redoCount,1);
history.redo();
assert.strictEqual(graph.nodes[0].appearance.color,'#ff0000');
assert.strictEqual(graph.nodes[1].appearance.color,'#ff0000');
const beforeDefaultHistory=history.getState().undoCount;
style.updateDefaultAppearance({nodeCardStyle:'text',nodeTextAlign:'right'},'修改默认卡牌外观');
assert.strictEqual(history.getState().undoCount,beforeDefaultHistory+1,'default appearance update must create one history entry');
assert.strictEqual(graph.defaults.nodeCardStyle,'text');
assert.strictEqual(graph.defaults.nodeTextAlign,'right');
history.undo();
assert.strictEqual(graph.defaults.nodeCardStyle,'sticky');
assert.strictEqual(graph.defaults.nodeTextAlign,'center');

const largeNodes=Array.from({length:2500},(_,i)=>({id:`large-${i}`,title:`Node ${i}`,x:i%100,y:Math.floor(i/100)}));
const largeLinks=Array.from({length:2499},(_,i)=>({id:`large-link-${i}`,from:`large-${i}`,to:`large-${i+1}`}));
const indexStarted=process.hrtime.bigint();
const largeIndex=Model.createIndex({nodes:largeNodes,links:largeLinks});
const indexElapsedMs=Number(process.hrtime.bigint()-indexStarted)/1e6;
assert.strictEqual(largeIndex.nodeMap.size,2500);
assert.strictEqual(largeIndex.linkMap.size,2499);
assert.strictEqual(largeIndex.linksByNodeId.get('large-1000').length,2);
assert(indexElapsedMs<2000,`large graph index should stay linear and fast, got ${indexElapsedMs.toFixed(1)}ms`);

const renderCalls={viewport:0,cards:0,edges:0,header:0,details:0};
const renderer=context.KGGraphRenderer.create({
  applyViewport:()=>renderCalls.viewport++,renderCards:()=>renderCalls.cards++,renderEdges:()=>renderCalls.edges++,renderHeader:()=>renderCalls.header++,renderDetails:()=>renderCalls.details++
});
renderer.render('viewport');
assert.deepStrictEqual(renderCalls,{viewport:1,cards:0,edges:0,header:0,details:0},'viewport render must not redraw cards or edges');
assert.strictEqual(renderer.diagnostics().full,0);
renderer.render('full');
assert.strictEqual(renderer.diagnostics().full,1);
assert.strictEqual(renderCalls.cards,1);
assert.strictEqual(renderCalls.edges,1);

const world={style:{transform:''}},stage={getBoundingClientRect:()=>({left:100,top:50})};
const viewportState={x:20,y:30,scale:2};
const viewport=context.KGGraphViewportController.create({stage,world,getViewport:()=>viewportState,minScale:.01,maxScale:4});
viewport.apply();
assert.strictEqual(world.style.transform,'translate(20px, 30px) scale(2)');
assert.deepStrictEqual(JSON.parse(JSON.stringify(viewport.screenToWorld(140,100))),{x:10,y:10});
assert.strictEqual(viewport.getDiagnostics().fullRedrawCount,0);

let nodeSelection=new Set(),linkSelection=new Set();
const selectionState={selectedNodeId:null,selectedLinkId:null,linkSourceId:null};
const selection=context.KGGraphSelectionController.create({
  getState:()=>selectionState,getNodeSet:()=>nodeSelection,setNodeSet:value=>{nodeSelection=value},getLinkSet:()=>linkSelection,setLinkSet:value=>{linkSelection=value}
});
selection.selectNodes(['a','b'],{primary:'b'});
assert.deepStrictEqual(JSON.parse(JSON.stringify(selection.snapshot().selectedNodeIds.sort())),['a','b']);
assert.strictEqual(selectionState.selectedNodeId,'b');
selection.clearAll();
assert.strictEqual(selection.snapshot().selectedNodeIds.length,0);

let firstMoveCount=0;
const drag=context.KGGraphDragController.create({threshold:5,onFirstMove:()=>firstMoveCount++});
const dragSession=drag.begin('node',{pointerId:1,clientX:0,clientY:0},{id:'a'});
assert(dragSession);
drag.update({pointerId:1,clientX:3,clientY:4});
drag.update({pointerId:1,clientX:8,clientY:0});
drag.update({pointerId:1,clientX:12,clientY:0});
assert.strictEqual(firstMoveCount,1,'drag history checkpoint must happen once');
drag.finish({pointerId:1});
assert.strictEqual(drag.isActive(),false);

const graphForConnection={nodes:[{id:'a'},{id:'b'}],links:[],selectedNodeId:null,selectedLinkId:null,linkSourceId:null};
const connection=context.KGGraphConnectionController.create({
  getState:()=>graphForConnection,getNode:id=>graphForConnection.nodes.find(n=>n.id===id),relationExists:(a,b)=>graphForConnection.links.some(l=>l.from===a&&l.to===b),
  createLink:(from,to)=>({id:'l1',from,to}),addLink:link=>graphForConnection.links.push(link)
});
assert.strictEqual(connection.setSource('a'),true);
const connected=connection.connectTo('b');
assert.strictEqual(connected.ok,true);
assert.strictEqual(graphForConnection.links.length,1);
assert.strictEqual(graphForConnection.linkSourceId,null);

const clipboard=context.KGGraphClipboardController.create();
clipboard.write([{id:'a',x:0,y:0,w:100,h:100},{id:'b',x:200,y:0,w:100,h:100}]);
assert.deepStrictEqual(JSON.parse(JSON.stringify(clipboard.bounds())),{x:0,y:0,w:300,h:100,cx:150,cy:50});
const placed=clipboard.placeAt({x:500,y:500});
assert.strictEqual(placed[0].x,350);
assert.strictEqual(placed[1].x,550);

console.log('v90-p420-graph-kernel-ok');
