'use strict';
const fs=require('fs'),path=require('path'),assert=require('assert'),vm=require('vm');
const root=path.resolve(__dirname,'..'),read=p=>fs.readFileSync(path.join(root,p),'utf8');

const html=read('index.html');
assert(html.includes('src/09-graph-connector-drag-controller.js'));
assert(html.indexOf('src/09-graph-connector-drag-controller.js')<html.indexOf('src/10-graph-editor.js'));
assert(html.includes('<option value="">无文字</option>'));

const config=read('src/00-config-state.js');
assert(config.includes("function makeLink(from,to,type=''"));
assert(config.includes("type:safeString(l.type??'','',60)"));

const graph=read('src/10-graph-editor.js');
assert(graph.includes('function createConnectionFromGrowthHandle(sourceId,targetId)'));
assert(graph.includes("makeLink(source.id,target.id,'',''"));
assert(graph.includes('beginNodeGrowthConnectDrag(event,btn)'));
assert(graph.includes("showStatus(`已建立无文字关系线"));
assert(graph.includes("makeLink(source.id,next.id,'',''"));

const mainCss=read('styles/main.css');
assert(mainCss.includes('.stage .knowledge-card:hover:not(.dragging):not(.group-dragging)'));
assert(mainCss.includes('outline:2px solid #ef4444'));
assert(mainCss.includes('.edge-connect-draft'));
assert(mainCss.includes('.knowledge-card.is-connector-drag-target'));
const workspaceCss=read('styles/question-workspace.css');
assert(workspaceCss.includes('.question-workspace-page .qw-question-card:hover:not(.is-selected):not(.is-dragging)'));
assert(workspaceCss.includes('outline:2px solid #ef4444'));

// Pure pointer-controller test: one drag connects, one stationary press remains a click.
const listeners={};
const doc={
  addEventListener(type,fn){listeners[type]=fn},
  removeEventListener(type,fn){if(listeners[type]===fn)delete listeners[type]}
};
let frameId=0;const frames=new Map();
const window={document:doc,requestAnimationFrame(fn){const id=++frameId;frames.set(id,fn);return id},cancelAnimationFrame(id){frames.delete(id)}};
const sandbox={window,document:doc,setTimeout,clearTimeout,console,Object,Math};
vm.createContext(sandbox);
vm.runInContext(read('src/09-graph-connector-drag-controller.js'),sandbox);
const calls=[];
const controller=window.KGGraphConnectorDrag.create({
  document:doc,
  requestAnimationFrame:window.requestAnimationFrame,
  cancelAnimationFrame:window.cancelAnimationFrame,
  threshold:6,
  resolveTarget:()=> 'target-b',
  onConnect:r=>calls.push(['connect',r.sourceId,r.targetId]),
  onClick:r=>calls.push(['click',r.sourceId])
});
const event=(type,x,y)=>({type,pointerId:7,button:0,clientX:x,clientY:y,preventDefault(){},stopPropagation(){}});
controller.begin(event('pointerdown',10,10),{sourceId:'source-a'});
listeners.pointermove(event('pointermove',30,30));
for(const [id,fn] of [...frames]){frames.delete(id);fn()}
listeners.pointerup(event('pointerup',30,30));
assert.deepStrictEqual(calls.shift(),['connect','source-a','target-b']);
controller.begin(event('pointerdown',10,10),{sourceId:'source-c'});
listeners.pointerup(event('pointerup',10,10));
assert.deepStrictEqual(calls.shift(),['click','source-c']);

console.log('v862-p2228-graph-hover-drag-connect-static-ok');
