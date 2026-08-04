'use strict';
const fs=require('fs');
const path=require('path');
const vm=require('vm');
const assert=require('assert');
const ROOT=path.resolve(__dirname,'..');
const read=p=>fs.readFileSync(path.join(ROOT,p),'utf8');

const context={window:{},console};
context.window.window=context.window;
vm.createContext(context);
vm.runInContext(read('src/canvas/84-canvas-edge-selection-geometry.js'),context);
const G=context.window.KGCanvasEdgeSelectionGeometry;
assert(G,'geometry helper missing');

function linePath(x1,y1,x2,y2){
  return{
    getBBox(){return {x:Math.min(x1,x2),y:Math.min(y1,y2),width:Math.abs(x2-x1),height:Math.abs(y2-y1)}},
    getTotalLength(){return Math.hypot(x2-x1,y2-y1)},
    getPointAtLength(d){const total=this.getTotalLength()||1,t=Math.max(0,Math.min(1,d/total));return{x:x1+(x2-x1)*t,y:y1+(y2-y1)*t}}
  };
}
assert.equal(G.pathIntersectsRect(linePath(0,0,100,100),{left:40,top:40,right:60,bottom:60}),true);
assert.equal(G.pathIntersectsRect(linePath(0,0,100,0),{left:40,top:20,right:60,bottom:30}),false);
assert.deepEqual(G.collectPathIds([{id:'a',path:linePath(0,0,100,100)},{id:'b',path:linePath(0,100,100,100)}],{left:45,top:45,right:55,bottom:105}),['a','b']);

const graph=read('src/10-graph-editor.js');
const multi=read('src/77-multi-question-workspace.js');
const toolbar=read('src/20-flashcards-toolbar.js');
assert(graph.includes('linkIdsInsideWorldRect'));
assert(graph.includes('deleteGraphBatchSelection'));
assert(multi.includes('edgeIdsInsideWorldRect'));
assert(multi.includes('deleteWorkspaceBatchSelection'));
assert(toolbar.includes('deleteGraphBatchSelection'));
assert(read('index.html').includes('84-canvas-edge-selection-geometry.js'));
assert(read('question-workspace.html').includes('84-canvas-edge-selection-geometry.js'));

// P2.2.36 high-quality commit is intentionally reverted to the smoother P2.2.35 strategy.
assert(!read('src/canvas/79-canvas-viewport-controller.js').includes('qualityClass'));
assert(!graph.includes('scheduleGraphViewportQualityCommit'));
assert(read('styles/main.css').includes('.world{position:absolute;left:0;top:0;transform-origin:0 0;will-change:transform'));

console.log('v862-p2237-batch-edge-selection-ok');
