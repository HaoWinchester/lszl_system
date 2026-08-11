'use strict';
const fs=require('fs');
const path=require('path');
const vm=require('vm');
const assert=require('assert');
const ROOT=path.resolve(__dirname,'..');
const read=file=>fs.readFileSync(path.join(ROOT,file),'utf8');


assert(read('index.html').includes('<link rel="stylesheet" href="styles/home-canvas-performance.css"/>'),'performance stylesheet must load');

const geometryContext={window:{},console};geometryContext.window.window=geometryContext.window;vm.createContext(geometryContext);
vm.runInContext(read('src/canvas/84-canvas-edge-selection-geometry.js'),geometryContext);
const G=geometryContext.window.KGCanvasEdgeSelectionGeometry;
assert(G.createPolylineIndex&&G.collectPolylineIds,'polyline selection cache is missing');
const entries=[
  {id:'a',points:[{x:0,y:0},{x:100,y:100}]},
  {id:'b',points:[{x:0,y:120},{x:100,y:120}]}
];
const index=G.createPolylineIndex(entries,{cellSize:64});
assert.deepEqual(G.collectPolylineIds(entries,{left:40,top:40,right:60,bottom:60},{index}),['a']);

const graph=read('src/10-graph-editor.js'),css=read('styles/home-canvas-performance.css'),config=read('src/00-config-state.js');
assert(graph.includes('edge-selection-overlay'));
assert(graph.includes('edge-hover-overlay'));
assert(graph.includes('renderSelectedEdgeControls'));
assert(graph.includes('createPolylineIndex'));
assert(graph.includes('requestAnimationFrame(()=>{if(!boxSelect)return'));
assert(css.includes('首页画布独立关系线、轮廓悬浮与稳定便签阴影'));
assert(css.includes('.stage .knowledge-card.card-style-sticky .card-body'));
assert(config.includes('curveControls'));
assert(config.includes('waypoints'));
console.log('v90-p435-home-edge-card-performance-ok');
