'use strict';
const fs=require('fs'),path=require('path');
function assert(cond,msg){if(!cond)throw new Error(msg)}
const root=path.resolve(__dirname,'..');
const read=file=>fs.readFileSync(path.join(root,file),'utf8');
const recall=read('src/86-knowledge-recall.js');
const assoc=read('src/95-recall-association-library.js');
const css=read('styles/knowledge-recall-p4517.css');
const html=read('knowledge-recall.html');

for(const token of ['const indexCache=new WeakMap();','function index(library)','const cached=indexCache.get(library)'])assert(assoc.includes(token),token);
for(const token of [
  "associationRuntime={subject:'',library:null,nodeCache:new Map(),resolveCache:new Map()}",
  'function appendNodeElement(node)','function appendEdgeElement(edge)',
  'function updateConnectedEdges(instanceId','function renderGraphDelta(',
  'let nodeDrag=null','touch-action:none'
]) {
  if(token==='touch-action:none')assert(css.includes(token),token);else assert(recall.includes(token),token);
}
assert(!/return `<path class="kr-edge-glow"/.test(recall),'edge renderer must not emit glow path');
assert(recall.includes('return `<path class="${cls}" data-edge-id='),'edge renderer must emit one path');
assert(css.includes('filter:none!important')&&css.includes('box-shadow:none!important'),'repeated graph paint must be lightweight');
assert(css.includes('.kr-edge-glow{display:none!important}'),'legacy glow must be hidden');
assert(recall.includes('for(const point of candidates||[])if(positionIsOpen'),'placement must use lightweight candidates');
assert(!recall.includes('for(let ring=1;ring<=6;ring++)'),'old 6-ring collision search must be removed');
assert(recall.includes("centerAt100:()=>{const r=viewport.getBoundingClientRect();setZoomScale(1"),'100 percent must preserve viewport center');
assert(recall.includes("$('krCenterBtn').onclick=()=>centerOn(0,0,true)"),'return-to-question control must remain separate');
assert(html.includes('styles/knowledge-recall-p4517.css'),'P4.5.17 css must load');
console.log('v90-p4517-deep-recall-large-graph-performance-ok');
