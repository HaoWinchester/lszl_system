'use strict';
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const test=require('node:test');
const vm=require('node:vm');
const root=path.resolve(__dirname,'..');
const read=file=>fs.readFileSync(path.join(root,file),'utf8');

test('formal-library indexes are reused for repeated large-graph lookups',()=>{
  const context={console,globalThis:null,window:null};context.globalThis=context;context.window=context;
  vm.createContext(context);
  vm.runInContext(read('src/95-recall-association-library.js'),context);
  const api=context.KGRecallAssociationLibrary;
  const library={nodes:Array.from({length:500},(_,i)=>({id:`n${i}`,title:`节点${i}`,aliases:[`alias-${i}`]})),edges:[]};
  api.setSessionLibrary(library,'b'.repeat(64));
  const bound=api.read('PMP');
  assert.strictEqual(api.index(bound),api.index(bound));
  assert.equal(api.resolve(bound,'alias-499').id,'n499');
});

test('large-graph controller keeps updates local and avoids browser progress persistence',()=>{
  const js=read('src/86-knowledge-recall.js');
  assert.match(js,/function renderGraphDelta\(/);
  assert.match(js,/function updateConnectedEdges\(/);
  assert.match(js,/connectedEdges:state\.edges\.filter/);
  assert.match(js,/progressSaveTimer=setTimeout\(\(\)=>\{progressSaveTimer=0;void writeProgressNow\(\)\},420\)/);
  assert.doesNotMatch(js,/RecallStorage\.(?:readProgress|writeProgress|removeProgress)/);
  assert.doesNotMatch(js,/indexedDB|KGSharedRuntimeState/);
});
