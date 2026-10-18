'use strict';
const assert=require('node:assert/strict');
const fs=require('node:fs');
const vm=require('node:vm');
const path=require('node:path');
const context={console,Map,Set,Object,Number,Math,globalThis:null};context.globalThis=context;context.window=context;
vm.runInNewContext(fs.readFileSync(path.join(__dirname,'../src/canvas/89-canvas-runtime.js'),'utf8'),context);
const controller=context.KGCanvasFloatingToolbarController;
assert.equal(typeof controller.placePopover,'function','shared popover geometry must be available to all toolbar adapters');
const rect=(left,top,width,height)=>({left,top,right:left+width,bottom:top+height,width,height});
const overlaps=(a,b)=>a.left<b.right&&a.right>b.left&&a.top<b.bottom&&a.bottom>b.top;
const bounds=rect(100,60,900,650),trigger=rect(520,200,40,40),curve=rect(480,260,150,280),card=rect(300,80,320,90);
for(const blocked of [[curve],[curve,card]]){
 const placed=controller.placePopover({bounds,anchor:trigger,width:260,height:240,avoidRects:blocked});
 assert(!blocked.some(r=>overlaps(placed,r)),'popover avoids selected curves/cards when a side fits');
 assert(placed.left>=bounds.left+8&&placed.right<=bounds.right-8&&placed.top>=bounds.top+8&&placed.bottom<=bounds.bottom-8);
}
const small=controller.placePopover({bounds:rect(0,0,220,160),anchor:rect(100,70,30,30),width:300,height:480,avoidRects:[]});
assert(small.width<=204&&small.height<=144,'small canvases constrain both dimensions');
assert(small.top>=8&&small.bottom<=152);
for(const toolbar of [rect(16,120,104,384),rect(880,120,104,384)]){
 const button=rect(toolbar.left+9,toolbar.top+336,40,40);
 const placed=controller.placePopover({bounds:rect(0,80,1000,640),anchor:button,width:134,height:90,avoidRects:[toolbar],preferredSide:'right'});
 assert(['right','left'].includes(placed.placement),'vertical toolbars open alongside the button, never below the entire toolbar');
 assert(!overlaps(placed,toolbar));
 assert(Math.abs((placed.top+placed.bottom-button.top-button.bottom)/2)<1,'submenu stays centered beside its trigger');
}
{
 const toolbar=rect(1323,135,104,430),button=rect(1332,517,40,40),shortcuts=rect(1368,555,54,205);
 const placed=controller.placePopover({bounds:rect(0,38,1440,862),anchor:button,width:134,height:89,avoidRects:[shortcuts,toolbar],preferredSide:'right'});
 assert(placed.right<=toolbar.left-8,'a distant shortcut bar must not detach the submenu from its toolbar');
 assert(Math.abs((placed.top+placed.bottom-button.top-button.bottom)/2)<1,'obstacle ordering preserves trigger alignment');
 const crowdedToolbar=rect(1163,135,104,430),crowdedButton=rect(1218,368,40,40),leftDock=rect(1101,247.5,54,205);
 const crowded=controller.placePopover({bounds:rect(0,38,1280,682),anchor:crowdedButton,width:134,height:128,avoidRects:[leftDock,crowdedToolbar],preferredSide:'right'});
 assert(Math.abs((crowded.top+crowded.bottom-crowdedButton.top-crowdedButton.bottom)/2)<1,'a second dock must not displace a side menu below the toolbar when a horizontal gap exists');
}
console.log('PASS shared popover avoids targets and clamps small/fullscreen bounds');

vm.runInNewContext(fs.readFileSync(path.join(__dirname,'../src/graph/graph-renderer.js'),'utf8'),context);
const calls=[];
const renderer=context.KGGraphRenderer.create({renderEdges:()=>calls.push('edges'),renderEdgeStylePanel:()=>calls.push('panel')});
renderer.render('edges');assert.deepEqual(calls,['edges','panel'],'path/style changes refresh truthful toolbar state');
console.log('PASS edge-only render refreshes the current contextual toolbar');
