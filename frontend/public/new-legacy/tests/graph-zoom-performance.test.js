'use strict';
const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const vm=require('node:vm');
const path=require('node:path');
const root=path.resolve(__dirname,'..');
const read=file=>fs.readFileSync(path.join(root,file),'utf8');

test('zoom changes control scale only on selected elements, including newly selected cards',()=>{
  const writes=new Map();
  const element=id=>({style:{setProperty:(key,value)=>writes.set(id+key,value),removeProperty:key=>writes.delete(id+key)}});
  const selected=element('selected');let targets=[selected];
  const world=element('world');world.querySelectorAll=()=>targets;
  const context={window:{}};vm.createContext(context);
  vm.runInContext(read('src/graph/viewport-controller.js'),context);
  const controller=context.window.KGGraphViewportController.create({world,getViewport:()=>({x:10,y:20,scale:.1})});
  controller.apply();
  assert.equal(writes.get('world--graph-ui-inverse-scale'),undefined,'inherited world property invalidates every card');
  assert.equal(writes.get('selected--graph-ui-inverse-scale'),'10');
  const next=element('next');targets=[next];controller.syncControlScale();
  assert.equal(writes.get('selected--graph-ui-inverse-scale'),undefined);
  assert.equal(writes.get('next--graph-ui-inverse-scale'),'10');
});

test('percentage updates do not synchronously measure canvas layout',()=>{
  const source=read('src/20-flashcards-toolbar.js');
  const fn=source.slice(source.indexOf('function updateCanvasZoomControls(){'),source.indexOf('window.updateCanvasZoomControls='));
  let measures=0;const percent={textContent:''};const slider={min:'1',max:'400',value:'100'};
  const context={$:id=>id==='canvasZoomPercentBtn'?percent:slider,zoomPercentValue:()=>50,graphMinZoom:()=>.01,graphMaxZoom:()=>4,clamp:(v,min,max)=>Math.max(min,Math.min(max,v)),document:{activeElement:null},updateCanvasStatusChipPosition:()=>measures++};
  vm.createContext(context);vm.runInContext(fn+'updateCanvasZoomControls()',context);
  assert.equal(percent.textContent,'50%');assert.equal(slider.value,'50');assert.equal(measures,0);
});
