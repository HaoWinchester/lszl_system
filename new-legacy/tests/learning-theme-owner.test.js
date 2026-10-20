'use strict';
const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const vm=require('node:vm');
function harness(initial={}){
  const values=new Map(Object.entries(initial)),listeners=new Map();let owner='A';
  const window={localStorage:{getItem:k=>values.get(k)??null,setItem:(k,v)=>values.set(k,v),removeItem:k=>values.delete(k)},KGAuthCore:{currentUser:()=>owner?{username:owner}:null},addEventListener:(k,f)=>{if(!listeners.has(k))listeners.set(k,[]);listeners.get(k).push(f)},dispatchEvent(){}};
  const document={body:{dataset:{}}};const context={window,document,CustomEvent:class{constructor(type,options){this.type=type;this.detail=options?.detail}}};
  for(const file of ['28-device-preferences.js','canvas/97-learning-theme.js'])vm.runInNewContext(fs.readFileSync(path.join(__dirname,'../src',file),'utf8'),context);
  return {api:window.KGLearningTheme,values,root:()=>({dataset:{}}),switchOwner(value){owner=value;for(const fn of listeners.get('kg-auth-session-change')||[])fn()}};
}
test('themes stay isolated by mode and account, including returning to the first account',()=>{
  const h=harness(),workspaceRoot=h.root(),recallRoot=h.root();
  const workspace=h.api.create({scope:'workspace',roots:[workspaceRoot]}),recall=h.api.create({scope:'recall',roots:[recallRoot]});
  workspace.init();recall.init();workspace.apply('neon');recall.apply('ocean');
  h.switchOwner('B');assert.equal(workspaceRoot.dataset.theme,'platform');assert.equal(recallRoot.dataset.theme,'platform');
  workspace.apply('latte');h.switchOwner('A');assert.equal(workspaceRoot.dataset.theme,'neon');assert.equal(recallRoot.dataset.theme,'ocean');
});
test('each legacy mode migrates only to the first authenticated owner',()=>{
  const h=harness({kg_multi_question_theme_v1:'neon',kg_deep_recall_theme_v1:'ocean',kg_deep_recall_theme_platform_migrated_v1:'1'});
  const w=h.api.create({scope:'workspace'}),r=h.api.create({scope:'recall'});assert.equal(w.init(),'neon');assert.equal(r.init(),'ocean');
  h.switchOwner('B');assert.equal(w.saved(),'platform');assert.equal(r.saved(),'platform');
});
test('preview can be cancelled without replacing the saved theme',()=>{
  const h=harness(),root=h.root(),theme=h.api.create({scope:'workspace',roots:[root]});theme.init();theme.apply('ocean');
  theme.preview('neon');assert.equal(root.dataset.theme,'neon');assert.equal(theme.saved(),'ocean');theme.preview(theme.saved());assert.equal(root.dataset.theme,'ocean');
});
