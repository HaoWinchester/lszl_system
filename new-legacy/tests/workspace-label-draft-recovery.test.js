'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm'),path=require('node:path');
const source=fs.readFileSync(path.join(__dirname,'../src/77-multi-question-workspace.js'),'utf8');
function section(start,end){return source.slice(source.indexOf('  function '+start),source.indexOf('  '+end,source.indexOf('  function '+start)))}
test('a paused edge label remains visible and can commit after recovery',()=>{
 let paused=true;const edge={id:'e1',label:'旧关系'},input={value:'课堂未保存关系'},editor={hidden:false,querySelector:()=>input};
 const c={state:{edgeInlineEditor:editor,activeEdgeId:'e1'},edgeById:()=>edge,canEdit:()=>!paused,hideEdgeInlineEditor:()=>{editor.hidden=true},updateEdgeStyle:(id,patch)=>{if(paused)return false;Object.assign(edge,patch);return true}};
 vm.createContext(c);vm.runInContext(section('commitEdgeInlineEditor(){','function updateEdgeStyle('),c);
 assert.equal(c.commitEdgeInlineEditor(),false);assert.equal(editor.hidden,false);assert.equal(input.value,'课堂未保存关系');assert.equal(edge.label,'旧关系');
 paused=false;assert.equal(c.commitEdgeInlineEditor(),true);assert.equal(edge.label,'课堂未保存关系');assert.equal(editor.hidden,true);
});
test('group title blur during expiry keeps the exact draft and does not mutate the old group',()=>{
 let paused=false;const handlers={},classes=new Set(),group={id:'g1',title:'旧分组'};
 const el={textContent:'',innerText:'',isContentEditable:false,classList:{add:v=>classes.add(v),remove:v=>classes.delete(v)},focus(){},addEventListener:(t,f)=>handlers[t]=f,removeEventListener:t=>delete handlers[t],removeAttribute(){this.isContentEditable=false}};
 const state={workspace:{groups:[group]},workspaceId:'w1',workspaceSession:1,groupElements:new Map([['g1',{querySelector:()=>el}]])};
 const c={state,canEdit:()=>!paused,placeCaretAtEnd(){},workspaceSnapshot:()=>state.workspace,store:()=>({currentUserId:()=> 'teacher',updateGroup:(id,patch)=>Object.assign(group,patch)}),workspaceOptions:()=>({}),pushWorkspaceHistory(){},renderCards(){},notify(){}};
 vm.createContext(c);vm.runInContext(section('beginGroupTitleEdit(groupId){','const ARRANGE_LABELS='),c);
 assert.equal(c.beginGroupTitleEdit('g1'),true);el.innerText='课堂分组草稿';paused=true;
 assert.equal(handlers.blur(),false);assert.equal(classes.has('is-inline-editing'),true);assert.equal(group.title,'旧分组');
 paused=false;assert.equal(state.groupInlineEdit.finish(true),true);assert.equal(group.title,'课堂分组草稿');assert.equal(classes.has('is-inline-editing'),false);
});
