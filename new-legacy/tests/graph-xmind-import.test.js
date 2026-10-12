const test=require('node:test');const assert=require('node:assert/strict');const fs=require('node:fs');
const {confirmation,groupWarnings}=require('../src/graph/xmind-import-controller.js');
test('selection requires deliberate warning acceptance and isolates unselected warnings',()=>{
 const p={sheets:[{id:'a'},{id:'b'}],warnings:[{id:'w1',sheetId:'a'},{id:'w2',sheetId:'b'}]};
 assert.throws(()=>confirmation(p,[],true),/工作表/);
 assert.throws(()=>confirmation(p,['a'],false),/差异/);
 assert.deepEqual(confirmation(p,['a'],true),{sheetIds:['a'],acceptedWarnings:['w1']});
});
test('shared XMind importer is loaded at both actual file import entry points',()=>{
 for(const path of ['new-legacy/index.html','new-legacy/file-manager.html'])assert.match(fs.readFileSync(path,'utf8'),/src\/graph\/xmind-import-controller.js/);
 for(const path of ['new-legacy/src/20-flashcards-toolbar.js','new-legacy/src/27-graph-file-manager.js'])assert.match(fs.readFileSync(path,'utf8'),/KGXMindImport\.open/);
 const bundles=JSON.parse(fs.readFileSync('frontend/scripts/homepage-bundles.json','utf8'));assert.ok(bundles.groups.some(g=>g.scripts.includes('src/graph/xmind-import-controller.js')));
});

test('compatibility groups use human sheet/topic names while retaining all acceptance records',()=>{
 const warnings=[{id:'w1',sheetId:'uuid-s',objectId:'uuid-t',sheetTitle:'中文工作表',objectTitle:'中文主题',code:'font'},{id:'w2',sheetId:'uuid-s',objectId:'uuid-t',sheetTitle:'中文工作表',objectTitle:'中文主题',code:'shape'}];
 const groups=groupWarnings(warnings);assert.equal(groups.length,1);assert.equal(groups[0].objectTitle,'中文主题');assert.deepEqual(groups[0].warnings,warnings);
});
