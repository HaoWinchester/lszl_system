'use strict';
const assert=require('assert');
const fs=require('fs');
const path=require('path');
const ROOT=path.resolve(__dirname,'..');
const read=file=>fs.readFileSync(path.join(ROOT,file),'utf8');
const exists=file=>fs.existsSync(path.join(ROOT,file));

for(const file of [
  'src/canvas/85-canvas-appearance-controller.js','src/canvas/86-canvas-zoom-dock-controller.js',
  'src/canvas/87-canvas-minimap-controller.js','src/canvas/88-canvas-settings-controller.js',
  'src/canvas/89-canvas-runtime.js','styles/unified-canvas-runtime.css'
])assert(exists(file),file);
const appearance=read('src/canvas/85-canvas-appearance-controller.js');
for(const token of ['kg_canvas_view_preferences_v1',"theme:'light'", "pattern:'dots'", "id:'eye-yellow'", "id:'black'",'applyViewport'])assert(appearance.includes(token),token);
const zoom=read('src/canvas/86-canvas-zoom-dock-controller.js');
assert(zoom.includes("[.01,.02,.03,.05,.10,.15,.20,.33,.50,.75,1,1.25,1.5,2,2.5,3,4]"));
assert(zoom.includes('centerAt100'));
const minimap=read('src/canvas/87-canvas-minimap-controller.js');
for(const token of ['centerFromPoint','minimap-drag','persistViewport','setMinimapExpanded'])assert(minimap.includes(token),token);
const runtime=read('src/canvas/89-canvas-runtime.js');
for(const token of ['KGUnifiedCanvasRuntime','KGCanvasAppearanceController','KGCanvasZoomDockController','KGCanvasMinimapController','KGCanvasSettingsController'])assert(runtime.includes(token),token);
for(const htmlFile of ['index.html','question-workspace.html','question-training.html','knowledge-recall.html']){
  const html=read(htmlFile);
  assert(html.includes('styles/unified-canvas-runtime.css'),htmlFile+' css');
  for(let n=85;n<=89;n++)assert(html.includes(`src/canvas/${n}-canvas-`),htmlFile+' script '+n);
}
const home=read('src/20-flashcards-toolbar.js');
assert(home.includes('KGHomeGraphCanvasAdapter'));
assert(home.includes('centerHomeGraphAt100'));
assert(home.includes('resetCanvasZoomTo100()'));
const multi=read('src/77-multi-question-workspace.js');
assert(multi.includes('KGMultiQuestionCanvasAdapter'));
assert(multi.includes('centerMultiCanvasAt100'));
assert(multi.includes('state.runtime?.centerAt100'));
const single=read('src/74-infinite-learning-canvas.js');
assert(single.includes('KGSingleQuestionCanvasAdapter'));
assert(single.includes('centerSingleCanvasAt100'));
assert(single.includes('state.runtime?.centerAt100'));
const recall=read('src/86-knowledge-recall.js');
assert(recall.includes('KGRecallCanvasAdapter'));
assert(recall.includes('recallCanvasContentBounds'));
assert(recall.includes('transform:{x:Number(state.transform.x)'));
const css=read('styles/unified-canvas-runtime.css');
for(const token of ['data-canvas-pattern="dots"','data-canvas-pattern="grid"','data-canvas-pattern="solid"','.uc-minimap','.uc-settings-dialog'])assert(css.includes(token),token);
console.log('v90-p430-unified-canvas-runtime-ok');
