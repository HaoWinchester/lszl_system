'use strict';
const {test}=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm');
function setup(){
 const data=new Map(),ctx={console,localStorage:{getItem:k=>data.get(k)||null,setItem:(k,v)=>data.set(k,v),removeItem:k=>data.delete(k)},CustomEvent:function(){},dispatchEvent(){},addEventListener(){}};ctx.window=ctx;
 vm.runInNewContext(fs.readFileSync(require('node:path').join(__dirname,'../src/65-canvas-workspace-store.js'),'utf8'),ctx);
 return ctx.KGCanvasWorkspaceStore;
}
test('legacy workspace leaves background unset for first effective surface capture',()=>{
 const store=setup();assert.equal(store.ensure().background,null);
});
test('workspace background keeps gradient and independent grid preferences through write/read',()=>{
 const store=setup(),ws=store.ensure();
 const background={appearance:{theme:'light',pattern:'grid',backgroundColor:'#fff8dc',lightColor:'#fff8dc',darkColor:'#20242b',minimapExpanded:true},layer:{color:'rgb(255, 248, 220)',image:'linear-gradient(135deg, rgb(255, 255, 255), rgb(240, 240, 240))',repeat:'no-repeat'}};
 store.write({...ws,background});assert.deepEqual(JSON.parse(JSON.stringify(store.read().background)),background);
 const next=store.createWorkspace('second',{activate:false});assert.equal(next.background,null);
});
test('invalid background cannot replace a valid CSS capture with a primitive',()=>{
 const store=setup(),ws=store.ensure();assert.equal(store.write({...ws,background:'neon'}).background,null);
});

function themes(seed={}){
 const data=new Map(Object.entries(seed)),handlers={};
 const ctx={console,localStorage:{getItem:k=>data.get(k)||null,setItem:(k,v)=>data.set(k,v)},document:{body:{dataset:{}}},CustomEvent:class{constructor(type,options){this.type=type;this.detail=options.detail}},dispatchEvent(){},addEventListener:(type,fn)=>(handlers[type]??=[]).push(fn)};ctx.window=ctx;
 vm.runInNewContext(fs.readFileSync(require('node:path').join(__dirname,'../src/canvas/97-learning-theme.js'),'utf8'),ctx);
 const recall={dataset:{}},workspace={dataset:{}};
 return {ctx,data,handlers,recall,workspace,r:ctx.KGLearningTheme.create({scope:'recall',roots:[recall]}),w:ctx.KGLearningTheme.create({scope:'workspace',roots:[workspace]})};
}
test('recall and workspace scene preferences remain independent through reload and storage events',()=>{
 const t=themes();t.r.init();t.w.init();t.r.apply('sakura');t.w.apply('ocean');
 assert.equal(t.r.saved(),'sakura');assert.equal(t.w.saved(),'ocean');
 assert.equal(t.recall.dataset.theme,'sakura');assert.equal(t.workspace.dataset.theme,'ocean');
 for(const fn of t.handlers.storage)fn({key:t.r.key,newValue:'neon',storageArea:t.ctx.localStorage});
 assert.equal(t.recall.dataset.theme,'neon');assert.equal(t.workspace.dataset.theme,'ocean');
 const reload=themes(Object.fromEntries(t.data));assert.equal(reload.r.saved(),'sakura');assert.equal(reload.w.saved(),'ocean');
});
test('workspace copies the former shared theme only once without overwriting recall preference',()=>{
 const t=themes({kg_deep_recall_theme_v1:'ocean',kg_deep_recall_theme_platform_migrated_v1:'1'});
 t.w.init();assert.equal(t.w.saved(),'ocean');t.r.apply('latte');assert.equal(t.w.saved(),'ocean');
 t.w.apply('aurora');assert.equal(t.r.saved(),'latte');
});

test('return navigation restores the target mode question and workspace without taking the current mode context',()=>{
 const data=new Map(),ctx={console,URL,URLSearchParams,location:{href:'http://localhost/knowledge-recall.html'},sessionStorage:{getItem:k=>data.get(k)||null,setItem:(k,v)=>data.set(k,v),removeItem:k=>data.delete(k)}};ctx.window=ctx;
 vm.runInNewContext(fs.readFileSync(require('node:path').join(__dirname,'../src/59b-learning-route-context.js'),'utf8'),ctx);const route=ctx.KGLearningRouteContext;
 route.remember({paperId:'paper-a',releaseId:'rel-2',questionId:'q-2',bankId:'bank-a',workspaceId:'workspace-b',mode:'multi_question_canvas'});
 route.remember({paperId:'paper-b',releaseId:'rel-3',questionId:'q-8',mode:'deep_recall'});
 const href=route.resumeHref('question-workspace.html','multi_question_canvas');assert.match(href,/questionId=q-2/);assert.match(href,/workspace=workspace-b/);assert.match(href,/releaseId=rel-2/);
 route.clear('multi_question_canvas');assert.equal(route.resumeHref('question-workspace.html','multi_question_canvas'),'question-workspace.html');
});
