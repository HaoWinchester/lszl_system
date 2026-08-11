'use strict';
const fs=require('fs');
const path=require('path');
const assert=require('assert');
const ROOT=path.resolve(__dirname,'..');
const read=file=>fs.readFileSync(path.join(ROOT,file),'utf8');
const exists=file=>fs.existsSync(path.join(ROOT,file));

for(const file of [
  'src/canvas/92-canvas-edge-toolbar-controller.js','src/canvas/89-canvas-runtime.js','src/canvas/82-canvas-selection-controller.js',
  'src/graph/node-toolbar-controller.js','styles/unified-canvas-runtime.css'
])assert(exists(file),file);

const edge=read('src/canvas/92-canvas-edge-toolbar-controller.js');
for(const token of ['CanvasEdgeToolbarController v3','data-uc-toolbar-drag','data-uc-edge-panel="line"','uc-toolbar-popover','添加文本','createPopover'])assert(edge.includes(token),token);
assert.strictEqual((edge.match(/<button[^>]+data-uc-edge-panel="line"/g)||[]).length,1,'one consolidated line trigger');
assert(!edge.includes('data-uc-edge-panel="path"'),'no standalone path trigger');
assert(!edge.includes('data-uc-edge-panel="width"'),'no standalone width trigger');
assert(!edge.includes('data-uc-edge-panel="arrow"'),'no standalone arrow trigger');

const runtime=read('src/canvas/89-canvas-runtime.js');
for(const token of ['Unified Canvas Runtime v2','KGCanvasFloatingToolbarController','createFloatingToolbarPopover','positionRect','positionPoint','bindDrag','repositionAll'])assert(runtime.includes(token),token);
const node=read('src/graph/node-toolbar-controller.js');
for(const token of ['uc-toolbar-shell','uc-toolbar-main','uc-toolbar-grip','KGCanvasFloatingToolbarController','uc-toolbar-popover'])assert(node.includes(token),token);
const selection=read('src/canvas/82-canvas-selection-controller.js');
for(const token of ['CanvasSelectionController v2','isInteractionUI','[data-stage-ui]','isInteractionTarget'])assert(selection.includes(token),token);
const kernel=read('src/canvas/81-canvas-kernel.js');assert(kernel.includes('isSelectionInteractionUI'));

const css=read('styles/unified-canvas-runtime.css');
for(const token of ['.uc-toolbar-main{','.uc-toolbar-btn{','.uc-toolbar-grip{','.uc-toolbar-popover{','opacity:0','transform:scaleY(.96)','transform-origin:top center','transition:opacity .14s ease,transform .14s ease','.uc-toolbar-popover.show{opacity:1;transform:scaleY(1)}','.uc-toolbar-popover.is-closing'])assert(css.includes(token),token);
assert(!/\.uc-toolbar-popover\{[^}]*height\s*:/s.test(css),'popover must not animate a fixed/variable height');
const graph=read('src/10-graph-editor.js');assert(graph.includes("className:'edge-toolbar-unified'"));assert(!graph.includes("className:'edge-quick-style-panel'"));
const multi=read('src/77-multi-question-workspace.js');
for(const token of ['onLineStyle:value=>','onPathStyle:value=>','onWidth:value=>','onArrowStyle:value=>','onLabel:()=>'])assert(multi.includes(token),token);
console.log('v90-p437-unified-edge-toolbar-ok');
