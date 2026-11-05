'use strict';
const {test}=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm'),path=require('node:path');
const source=file=>fs.readFileSync(path.join(__dirname,'../src',file),'utf8');
function setup({readonly=false,dirty=false,draft=false,fileId='file-one',inline=false}={}){
 const listeners=new Map(),calls=[],model={strokes:[],viewport:{},meta:{title:'test'}};
 const c={state:model,stage:{},world:{},console,CustomEvent:function(type,init={}){this.type=type;this.detail=init.detail},
 document:{readyState:'complete',body:{classList:{contains:()=>readonly}},documentElement:{dataset:{}},getElementById:()=>null},
 KGAuthCore:{currentUsername:()=>c.owner},owner:'teacher',fileId,KGRolePermissions:{can:()=>!readonly},KGGraphFileRemoteAdapter:{getCurrentFileMeta:()=>c.fileId?{id:c.fileId}:null},
 KGGraphFileEditorStoreBridge:{fragmentSource:()=>({fileId:c.fileId})},KGAuthRecovery:{isPaused:()=>false,register:(key,participant)=>c.participant=participant},
 KGCanvasInk:{create:options=>{c.options=options;return {render(){},refreshControls(){},cancel(){},reset(){calls.push('reset')},setOpen(){calls.push('close')},hasTextDraft:()=>draft,commitText:async()=>{calls.push('commit');return !readonly}}}},
 ensureGraphHistoryController:()=>({run:(_,fn)=>fn()}),ensureNodeInlineTextEditorController:()=>({isEditing:()=>inline,commit:async()=>calls.push('inline')}),save(){},showStatus(){},setGraphPointerMode(){},clearSelection(){},graphModeAllows:()=>true,
 addEventListener:(type,fn)=>{if(!listeners.has(type))listeners.set(type,[]);listeners.get(type).push(fn)},dispatchEvent:event=>{for(const fn of listeners.get(event.type)||[])fn(event)},
 persistCurrentGraphNow:async()=>{calls.push('write');return !readonly},setInterval,clearInterval};c.window=c;
 vm.createContext(c);vm.runInContext(source('24-graph-file-autosave.js'),c);if(dirty)c.KGGraphFileAutosave.markDirty();
 vm.runInContext(source('canvas/95-home-canvas-tools.js'),c);calls.length=0;return {c,calls};
}
test('clean readonly graph may leave or recover without a forbidden persistence request',async()=>{
 const {c,calls}=setup({readonly:true});assert.equal(c.participant.hasUnsavedChanges(),false);
 assert.equal(await c.participant.prepareLeave(),true);assert.deepEqual(calls,[]);
 assert.equal(await c.participant.onRecovered(),true);assert.deepEqual(calls,[]);
});
test('readonly graph preserves dirty canvas text and inline drafts and blocks leaving',async()=>{
 for(const options of [{dirty:true},{draft:true},{inline:true}]){
  const {c,calls}=setup({readonly:true,...options});assert.equal(c.participant.hasUnsavedChanges(),true);
  assert.equal(await c.participant.prepareLeave(),false);assert.deepEqual(calls,[]);
  assert.equal(c.participant.hasUnsavedChanges(),true);
 }
});
test('first file creation retains the logical text context and acknowledges without resetting its editor',async()=>{
 const {c,calls}=setup({fileId:'',dirty:true,draft:true});const context=c.options.getTextContext();
 c.persistCurrentGraphNow=async()=>{calls.push('write');c.fileId='first-created';c.dispatchEvent(new c.CustomEvent('kg-graph-current-file-change',{detail:{id:c.fileId}}));return true};
 assert.equal(await c.options.persistText(),true);
 assert.equal(c.options.getTextContext(),context);assert.equal(c.KGGraphFileAutosave.isDirty(),false);
 assert.deepEqual(calls,['write']);
});
test('same-file undo or normalization does not change text context; replacing file or owner does',async()=>{
 const {c,calls}=setup({draft:true});const original=c.options.getTextContext();
 c.state.strokes=[];c.KGHomeInk.sync();assert.equal(c.options.getTextContext(),original);
 c.state={...c.state,strokes:[]};assert.equal(c.options.getTextContext(),original);
 c.fileId='file-two';c.dispatchEvent(new c.CustomEvent('kg-graph-current-file-change',{detail:{id:c.fileId}}));
 const switched=c.options.getTextContext();assert.notEqual(switched,original);assert.ok(calls.includes('reset'));
 c.owner='other';c.dispatchEvent(new c.CustomEvent('kg-auth-session-change'));assert.notEqual(c.options.getTextContext(),switched);
});
test('file or account switches cannot acknowledge a pending first-file text save',async()=>{
 for(const change of ['file','owner']){
  const {c}=setup({fileId:'',dirty:true});let finish;
  c.persistCurrentGraphNow=()=>new Promise(resolve=>finish=resolve);
  const result=c.options.persistText();
  if(change==='file'){c.fileId='unrelated';c.state={...c.state};c.dispatchEvent(new c.CustomEvent('kg-graph-current-file-change',{detail:{id:c.fileId}}))}
  else{c.owner='other';c.dispatchEvent(new c.CustomEvent('kg-auth-session-change'))}
  finish(true);assert.equal(await result,false);
 }
});

test('clean writable graph leaves without touching server revisions; dirty graphs still await save',async()=>{
 const clean=setup();assert.equal(await clean.c.participant.prepareLeave(),true);assert.deepEqual(clean.calls,[]);
 const dirty=setup({dirty:true});assert.equal(await dirty.c.participant.prepareLeave(),true);assert.deepEqual(dirty.calls,['write']);assert.equal(dirty.c.KGGraphFileAutosave.isDirty(),false);
});
test('acknowledged text commit is not followed by another forced graph write',async()=>{
 const {c,calls}=setup({draft:true});assert.equal(await c.participant.prepareLeave(),true);assert.deepEqual(calls,['commit']);
});
