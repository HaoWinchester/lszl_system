'use strict';
const fs=require('fs'),path=require('path'),assert=require('assert');
const root=path.resolve(__dirname,'..');
const js=fs.readFileSync(path.join(root,'src/77-multi-question-workspace.js'),'utf8');

assert(js.includes('const live=liveCardLayout(record)'),'diagnosis should use live rendered geometry');
assert(js.includes('const tolerance=Math.max(28,Math.min(64'));
assert(js.includes('Math.max(overflow.left,overflow.top,overflow.right,overflow.bottom)>tolerance'));
assert(!js.includes('if(rect.x<0||rect.y<0||rect.x+rect.width>WORLD_WIDTH||rect.y+rect.height>WORLD_HEIGHT)'));

function meaningful(rect,bounds={left:0,top:0,right:8000,bottom:5000}){
  const overflow={
    left:Math.max(0,bounds.left-Number(rect.x)),
    top:Math.max(0,bounds.top-Number(rect.y)),
    right:Math.max(0,Number(rect.x)+Number(rect.width)-bounds.right),
    bottom:Math.max(0,Number(rect.y)+Number(rect.height)-bounds.bottom)
  };
  const tolerance=Math.max(28,Math.min(64,Math.min(Number(rect.width||0),Number(rect.height||0))*.08));
  return Math.max(overflow.left,overflow.top,overflow.right,overflow.bottom)>tolerance;
}
assert.strictEqual(meaningful({x:100,y:100,width:400,height:300}),false);
assert.strictEqual(meaningful({x:-10,y:100,width:400,height:300}),false,'minor rounding spill should not warn');
assert.strictEqual(meaningful({x:7600,y:4700,width:400,height:300}),false,'card exactly on bounds should not warn');
assert.strictEqual(meaningful({x:-100,y:100,width:400,height:300}),true,'meaningful left overflow should warn');
assert.strictEqual(meaningful({x:7900,y:100,width:400,height:300}),true,'meaningful right overflow should warn');
console.log('v862-p2216-diagnosis-bounds-ok');
