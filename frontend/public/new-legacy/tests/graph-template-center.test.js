const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs');
const controller=require('../src/graph/template-center-controller.js');
const preview=require('../src/graph/template-preview.js');
test('template drawing bounds include complete cards and provide an empty fallback',()=>{assert.deepEqual(preview.bounds([]),{x:0,y:0,width:800,height:500});assert.deepEqual(preview.bounds([{x:-20,y:10,width:100,height:80},{x:400,y:200,width:160,height:100}]),{x:-60,y:-30,width:660,height:370})});
test('template publication is visible only for teaching managers',()=>{for(const role of ['admin','teacher'])assert.equal(controller.canPublish(role),true);for(const role of ['student','viewer',null])assert.equal(controller.canPublish(role),false)});
test('source homepage and bundled homepage register shared template center',()=>{const index=fs.readFileSync(require('node:path').join(__dirname,'../index.html'),'utf8');const bundles=fs.readFileSync(require('node:path').join(__dirname,'../../frontend/scripts/homepage-bundles.json'),'utf8');for(const file of ['src/graph/template-center-controller.js','styles/graph-template-center.css']){assert.ok(index.includes(file));assert.ok(bundles.includes(file))}const toolbar=fs.readFileSync(require('node:path').join(__dirname,'../src/20-flashcards-toolbar.js'),'utf8');assert.ok(toolbar.includes('openTemplate:()=>window.KGGraphTemplateCenter.open()'));assert.ok(!toolbar.includes('使用模板会替换当前图谱'))});


// Exercise the actual publication form, including persistence and request ordering.
function publicationHarness({openForm=true,templates=[]}={}){
  const vm=require('node:vm'),calls=[];
  function element(tag){return{tag,children:[],dataset:{},classList:{add(){}},setAttribute(key,value){this[key]=value},append(...nodes){for(const node of nodes){node.parent=this;this.children.push(node)}},prepend(node){node.parent=this;this.children.unshift(node)},insertBefore(node,before){node.parent=this;this.children.splice(this.children.indexOf(before),0,node)},replaceChildren(...nodes){this.children=[];this.append(...nodes)},remove(){this.parent.children=this.parent.children.filter(node=>node!==this)},focus(){},addEventListener(){},showModal(){},close(){}}}
  const body=element('body'),capabilities={serverFiles:true},state={fileId:'source',revision:1},actor={username:'teacher',role:'teacher'};
  const context={console,AbortController,document:{body,createElement:element},KGAuthCore:{currentUser:()=>actor},KGTemplatePreview:{mount(){}},KGGraphFileEditorStoreBridge:{fragmentSource:()=>({...state}),isRemote:()=>capabilities.serverFiles},KGGraphFileRemoteAdapter:{flush:async()=>{calls.push('flush')}},KGGraphFileAutosave:{saveAcknowledged:async(options,isCurrent)=>{calls.push('save');assert.equal(options.force,true);assert.equal(isCurrent(),true);state.revision=2;return true}},fetch:async(url,options)=>{calls.push({url,options});return{ok:true,json:async()=>options.method==='POST'?{template:{id:'created'}}:{templates}}}};
  context.window=context;vm.runInNewContext(fs.readFileSync(require('node:path').join(__dirname,'../src/graph/template-center-controller.js'),'utf8'),context);
  const find=(root,predicate)=>predicate(root)?root:root.children.map(node=>find(node,predicate)).find(Boolean);
  context.KGGraphTemplateCenter.open();const dialog=body.children[0];if(openForm)find(dialog,node=>node.dataset.templatePublish!==undefined).onclick();
  const form=find(dialog,node=>node.tag==='form'),submit=form?find(form,node=>node.type==='submit'):null;
  return{context,calls,capabilities,state,actor,dialog,form,submit,status:find(dialog,node=>node.role==='status'),find,send:async()=>{await new Promise(resolve=>setImmediate(resolve));form.onsubmit({preventDefault(){}});await new Promise(resolve=>setImmediate(resolve));}};
}
test('publication saves the current dirty graph before using its acknowledged revision',async()=>{
  const h=publicationHarness();await h.send();
  assert.deepEqual(h.calls.filter(call=>typeof call==='string'),['save','flush']);
  const publication=h.calls.find(call=>call.options?.method==='POST');assert.ok(publication);assert.equal(JSON.parse(publication.options.body).expectedFileRevision,2);
  assert.equal(h.dialog.children.includes(h.form),false);assert.match(h.status.textContent,/已.*发布/);
});
test('publication keeps the form and blocks POST after a failed save, then supports retry',async()=>{
  const h=publicationHarness();h.context.KGGraphFileAutosave.saveAcknowledged=async()=>false;await h.send();
  assert.equal(h.calls.some(call=>call.options?.method==='POST'),false);assert.equal(h.dialog.children.includes(h.form),true);assert.equal(h.submit.disabled,false);assert.match(h.status.textContent,/保存失败/);
  h.context.KGGraphFileAutosave.saveAcknowledged=async()=>true;await h.send();assert.ok(h.calls.some(call=>call.options?.method==='POST'));
});
test('publication rejects a changed source or signed-in actor during save',async()=>{
  for(const change of [h=>h.state.fileId='other',h=>h.actor.username='other']){
    const h=publicationHarness();h.context.KGGraphFileAutosave.saveAcknowledged=async()=>{change(h);return true};await h.send();
    assert.equal(h.calls.some(call=>call.options?.method==='POST'),false);assert.equal(h.dialog.children.includes(h.form),true);assert.match(h.status.textContent,/变化|切换/);
  }
});
test('successful publication remains explicit when the following catalog refresh fails',async()=>{
  const h=publicationHarness();const fetch=h.context.fetch;let posted=false;
  h.context.fetch=async(url,options)=>{if(options.method==='POST')posted=true;else if(posted)throw new Error('catalog offline');return fetch(url,options)};
  await h.send();assert.equal(h.dialog.children.includes(h.form),false);assert.match(h.status.textContent,/已.*发布/);assert.match(h.status.textContent,/刷新失败/);
});
test('publication waits for save acknowledgement and commits active text drafts first',async()=>{
  const h=publicationHarness();let resolveSave;
  h.context.KGHomeInk={hasTextDraft:()=>true,commitText:async()=>{h.calls.push('ink');return true}};
  let editing=true;h.context.ensureNodeInlineTextEditorController=()=>({isEditing:()=>editing,commit:async()=>{h.calls.push('inline');editing=false}});
  h.context.KGGraphFileAutosave.saveAcknowledged=()=>new Promise(resolve=>{resolveSave=resolve});
  const sending=h.send();await new Promise(resolve=>setImmediate(resolve));await new Promise(resolve=>setImmediate(resolve));
  assert.equal(h.calls.some(call=>call.options?.method==='POST'),false);assert.equal(h.submit.disabled,true);assert.equal(h.find(h.form,node=>node.type==='button').disabled,true);assert.deepEqual(h.calls.filter(call=>typeof call==='string'),['ink','inline']);
  resolveSave(true);await sending;await new Promise(resolve=>setImmediate(resolve));assert.ok(h.calls.some(call=>call.options?.method==='POST'));
});
test('publication preserves input when draft persistence or revision validation fails',async()=>{
  for(const kind of ['ink','inline','revision']){
    const h=publicationHarness();
    if(kind==='ink')h.context.KGHomeInk={hasTextDraft:()=>true,commitText:async()=>false};
    if(kind==='inline')h.context.ensureNodeInlineTextEditorController=()=>({isEditing:()=>true,commit:async()=>false});
    if(kind==='revision'){const fetch=h.context.fetch;h.context.fetch=(url,options)=>options.method==='POST'?Promise.resolve({ok:false,json:async()=>({detail:{code:'GRAPH_FILE_REVISION_CONFLICT'}})}):fetch(url,options)}
    await h.send();assert.equal(h.dialog.children.includes(h.form),true);assert.equal(h.submit.disabled,false);assert.match(h.status.textContent,kind==='revision'?/源图谱已改变/:/文字保存失败/);
    if(kind!=='revision')assert.equal(h.calls.some(call=>call.options?.method==='POST'),false);
  }
});
test('publication errors identify missing sources and non-JSON service failures without blaming login',async()=>{
  for(const [failure,expected] of [
    [{ok:false,status:404,json:async()=>({detail:{code:'GRAPH_FILE_NOT_FOUND'}})},/源图谱.*不存在/],
    [{ok:false,status:503,json:async()=>{throw new SyntaxError('Unexpected token <')}},/503/],
    [{ok:false,status:502,json:async()=>null},/502/],
    [{ok:false,status:422,json:async()=>({detail:{code:'TEMPLATE_GRAPH_INVALID'}})},/图谱.*结构/],
  ]){
    const h=publicationHarness(),fetch=h.context.fetch;h.context.fetch=(url,options)=>options.method==='POST'?Promise.resolve(failure):fetch(url,options);
    await h.send();assert.match(h.status.textContent,expected);assert.doesNotMatch(h.status.textContent,/检查登录|Unexpected token/);assert.equal(h.dialog.children.includes(h.form),true);
  }
});
test('legacy temporary graphs are blocked before saving or publishing and explain content recovery',async()=>{
  const h=publicationHarness();h.capabilities.serverFiles=false;await h.send();
  assert.equal(h.calls.some(call=>call.options?.method==='POST'),false);assert.equal(h.calls.includes('save'),false);assert.match(h.status.textContent,/导出学习包/);assert.doesNotMatch(h.status.textContent,/GRAPH_FILES|cutover|登录/);
  h.form.remove();h.find(h.dialog,node=>node.dataset.templatePublish!==undefined).onclick();assert.equal(h.find(h.dialog,node=>node.tag==='form'),undefined);assert.match(h.status.textContent,/在线图谱/);
});
test('legacy mode allows previews but prevents fake template loading into an incompatible file store',async()=>{
  const h=publicationHarness({openForm:false,templates:[{id:'template',name:'可预览模板',listed:true,version:1}]});h.capabilities.serverFiles=false;
  await new Promise(resolve=>setImmediate(resolve));
  const load=h.find(h.dialog,node=>node.dataset.templateLoad!==undefined);assert.ok(load);await load.onclick();
  assert.equal(h.calls.some(call=>call.options?.method==='POST'),false);assert.match(h.status.textContent,/在线图谱/);assert.match(h.status.textContent,/导出学习包/);
});

test('dragging and resizing keep the complete preview and its footer inside the viewport',()=>{
  const position=controller.previewWindowPosition;
  assert.deepEqual(position(1400,880,1120,760,1440,900),{left:320,top:140});
  assert.deepEqual(position(320,140,390,564,390,600),{left:0,top:36});
  assert.deepEqual(position(-40,-20,800,600,800,600),{left:0,top:0});
});
