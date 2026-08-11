'use strict';
const assert=require('assert');
const fs=require('fs');
const path=require('path');
const ROOT=path.resolve(__dirname,'..');
const read=file=>fs.readFileSync(path.join(ROOT,file),'utf8');

const index=read('index.html');
assert(index.includes('styles/home-selection-p4326.css'));
assert(index.includes('src/canvas/93-canvas-drag-performance-controller.js'));
assert(!index.includes('按住 <span class="tutorial-kbd">Shift</span>'));
assert(index.includes('无需按 Shift'));

const editor=read('src/10-graph-editor.js');
for(const token of [
  'function hasLockedHomeSelectionBounds()',
  'function beginLockedHomeSelectionPointer(event)',
  'function beginHomeSelectionBoundsDrag(event)',
  "activeClass:'graph-edge-drag-lite'",
  'updateLinkedEdgeGeometryNow(ids,{lite:true})',
  "stage.addEventListener('pointerdown',beginLockedHomeSelectionPointer,true)"
])assert(editor.includes(token),token);
assert(!editor.includes('shouldDeferEdgesDuringCardDrag'));

const css=read('styles/home-selection-p4326.css');
for(const token of ['home-selection-interaction-locked','graph-edge-drag-lite','.edge-feedback-layer','.uc-alignment-guides','marker-end:none'])assert(css.includes(token),token);
const perf=read('src/canvas/93-canvas-drag-performance-controller.js');
for(const token of ['CanvasDragPerformanceController v1','requestAnimationFrame','pendingIds','activeIds'])assert(perf.includes(token),token);

const help=read('src/102-help-content.js');
for(const token of ['直接拖出选框，无需按 Shift','取消发布会立即下架','做题模式、深度回忆、多题画布和单题深学','保存关键词配置','科目级联想库'])assert(help.includes(token),token);
const tour=read('src/40-guided-tour.js');
assert(tour.includes('直接框选全部图元'));
assert(tour.includes('已有选框时，可直接在选框外开始新的框选'));
assert(!tour.includes('电脑端按住 Shift'));
console.log('v90-p4326-home-selection-help-audit-ok');
