'use strict';
const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const vm=require('node:vm');
const path=require('node:path');
const window={};
const file=path.join(__dirname,'../src/canvas/94-canvas-ink.js');
if(fs.existsSync(file))vm.runInNewContext(fs.readFileSync(file,'utf8'),{window});
const stroke={id:'a',tool:'pen',color:'#2563eb',width:3,points:[[0,0],[10,20]]};
test('ink round trip preserves independent stroke data',()=>{
 assert.ok(window.KGCanvasInk,'shared ink module required');
 const result=window.KGCanvasInk.normalize([stroke]);
 assert.equal(JSON.stringify(result),JSON.stringify([stroke]));
 result[0].points[0][0]=40;assert.equal(stroke.points[0][0],0);
 assert.equal(JSON.stringify(window.KGCanvasInk.normalize(undefined)),'[]');
});
test('invalid strokes cannot reach persistence or SVG',()=>{
 const ink=window.KGCanvasInk;assert.ok(ink);
 for(const patch of [{tool:'script'},{color:'url(javascript:x)'},{width:0},{width:25},{points:[[Infinity,0]]},{points:[[true,0]]},{points:[]}])assert.throws(()=>ink.normalize([{...stroke,...patch}]));
 assert.throws(()=>ink.normalize([stroke,stroke]));
 assert.throws(()=>ink.normalize([{...stroke,tool:'highlighter',width:3}]));
 assert.throws(()=>ink.normalize([{...stroke,points:Array.from({length:5001},()=>[0,0])}]));
});
test('world coordinates account for viewport offset pan and zoom',()=>{
 assert.ok(window.KGCanvasInk);
 assert.equal(JSON.stringify(window.KGCanvasInk.point({clientX:170,clientY:130},{left:10,top:20},{x:40,y:10,scale:2})),'[60,50]');
});
test('SVG single points draw dots and curves preserve endpoints',()=>{
 const ink=window.KGCanvasInk;assert.ok(ink);
 assert.match(ink.path([[5,6]]),/^M 5 6 l/);
 assert.match(ink.path([[0,0],[10,10],[20,0]]),/^M 0 0 Q/);
 assert.match(ink.path([[0,0],[10,10],[20,0]]),/20 0$/);
});
