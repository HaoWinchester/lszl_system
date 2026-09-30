'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm'),path=require('node:path');
const root=path.join(__dirname,'..'),source=fs.readFileSync(path.join(root,'src/teacher/teacher-assistant.js'),'utf8');
function setup(){
 let choice='stay',actions=0;const nodes={'assistant-message':{value:''},'assistant-files':{value:''},'session-history':{value:'s1'},'new-session':{},'refresh-session':{}};
 const context={global:null,addEventListener(){},KGUnsavedGuard:null,choice:()=>choice};context.global=context;vm.createContext(context);
 vm.runInContext(fs.readFileSync(path.join(root,'src/shared/unsaved-guard.js'),'utf8'),context);const create=context.KGUnsavedGuard.create;context.KGUnsavedGuard.create=options=>create({...options,choose:async()=>choice});
 Object.assign(context,{nodes,action:async fn=>{actions++;await fn()},client:{session:{id:'s1'},async create(){return {id:'new'}},async load(){}},activate:async id=>{context.client.session={id}},disconnect(){},panel(){},sidebar(){},renderPending(){},showError(){},sourceViews:new Map(),innerWidth:1280});
 vm.runInContext("const $=id=>nodes[id];let pendingFiles=[],busy=false,authorized=true,epoch=0,tools=[],targetSession=null;"+source.slice(source.indexOf('    const draftGuard ='),source.indexOf('    function reconcilePending()'))+source.split('\n').filter(line=>line.includes("$('new-session').onclick =")||line.includes("$('refresh-session').onclick =")).join('\n')+'\nglobal.testApi={switchSession,hasDraft:()=>draftGuard.isDirty(),setFiles:files=>pendingFiles=files,getFiles:()=>pendingFiles};',context);
 return {nodes,api:context.testApi,client:context.client,choose:value=>choice=value,actions:()=>actions};
}
test('new and switch keep unsent text and files on stay without sending or uploading',async()=>{
 const {nodes,api,actions}=setup();nodes['assistant-message'].value='draft';api.setFiles([{file:{name:'lesson.pdf',size:10}}]);
 await nodes['new-session'].onclick();await api.switchSession('s2');assert.equal(actions(),0);assert.equal(nodes['assistant-message'].value,'draft');assert.equal(api.getFiles().length,1);assert.equal(api.hasDraft(),true);
});
test('discard permits explicit switch and clears pending input; same session is a no-op',async()=>{
 const {nodes,api,actions,choose,client}=setup();nodes['assistant-message'].value='draft';await api.switchSession('s1');assert.equal(actions(),0);choose('discard');await api.switchSession('s2');assert.equal(client.session.id,'s2');assert.equal(nodes['assistant-message'].value,'');assert.equal(api.hasDraft(),false);
});
test('status refresh preserves text and pending files without posting a message',async()=>{
 const {nodes,api}=setup();nodes['assistant-message'].value='draft';api.setFiles([{file:{name:'lesson.pdf',size:10}}]);await nodes['refresh-session'].onclick();assert.equal(nodes['assistant-message'].value,'draft');assert.equal(api.getFiles().length,1);assert.equal(api.hasDraft(),true);
});
