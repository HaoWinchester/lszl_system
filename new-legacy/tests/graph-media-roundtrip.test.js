'use strict';
const test=require('node:test'),assert=require('node:assert/strict');
require('../src/graph/graph-model.js');require('../src/graph/graph-persistence.js');
const fragment=require('../src/graph/graph-fragment.js'),model=global.KGGraphModel;
test('duplicate media and long notes survive normalization storage and fragment copy',()=>{
 const images=[{assetId:'ga_owned',alt:'<图>',width:20,height:30},{assetId:'ga_owned',alt:'second'}],notes='备注\n'.repeat(20000);
 const graph={nodes:[{id:'a',content:{title:'测试',images,notes}}],links:[]};
 const stored=global.KGGraphPersistence.toStorageState(graph),reopened=global.KGGraphPersistence.hydrate(JSON.parse(JSON.stringify(stored)));
 assert.deepEqual(reopened.nodes[0].content.images,images);assert.equal(reopened.nodes[0].notes,notes);
 const copy=fragment.remap(fragment.capture(reopened,{nodeIds:['a']}),{idFactory:()=> 'fresh',offset:{x:10,y:20}}).fragment;
 assert.deepEqual(copy.nodes[0].content.images,images);assert.equal(copy.nodes[0].content.notes,notes);assert.equal(graph.nodes[0].id,'a');
 assert.equal(model.imageUrl(images[0],'f_a'),'/api/v1/graph-assets/ga_owned?fileId=f_a');
});
test('invalid media and oversized notes fail explicitly',()=>{
 assert.throws(()=>model.contentOf({notes:'x'.repeat(100001)}),/100000/);
 assert.throws(()=>model.contentOf({content:{images:[{assetId:'https://external/evil'}]}}),/引用无效/);
});
test('sanitizer preserves long notes/images and initial remote file context',()=>{
 const fs=require('node:fs'),vm=require('node:vm'),path=require('node:path');
 const c={console,window:{},Math,Number,String,Array,Map,Set,clamp:(v,a,b)=>Math.max(a,Math.min(b,v)),matchMedia:()=>({matches:false}),document:{getElementById:()=>null}};c.window=c;vm.createContext(c);
 for(const file of ['graph/graph-model.js','23-graph-file-editor-store-bridge.js'])vm.runInContext(fs.readFileSync(path.join(__dirname,'../src',file),'utf8'),c);
 const config=fs.readFileSync(path.join(__dirname,'../src/00-config-state.js'),'utf8');vm.runInContext(config.slice(config.indexOf('const CARD_W='),config.indexOf('const $='))+config.slice(config.indexOf('function uid('),config.indexOf('function templateState('))+config.slice(config.indexOf('function safeString('),config.indexOf('function normalizeState(')),c);
 const notes=' spaced\n'.repeat(2000),image={assetId:'ga_safe',alt:'<&'};
 const clean=c.sanitizeState({nodes:[{id:'n',content:{images:[image,image],notes}}]});assert.equal(clean.nodes[0].notes,notes);assert.deepEqual(JSON.parse(JSON.stringify(clean.nodes[0].content.images)),[image,image]);
 assert.throws(()=>c.sanitizeState({nodes:[{id:'n',notes:'x'.repeat(100001)}]}),/100000/);
 c.KGGraphFileRemoteStore={active:()=>true};c.KGGraphFileRemoteAdapter={getCurrentFileMeta:()=>({id:'f_initial',revision:1})};
 assert.equal(c.KGGraphFileEditorStoreBridge.fragmentSource().fileId,'f_initial');
});
