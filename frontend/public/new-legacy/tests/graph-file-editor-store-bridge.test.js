'use strict';

const assert = require('assert');
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const root = path.resolve(__dirname, '..');

function load({ remoteActive }) {
  const calls = [];
  const local = {
    listFiles: () => [{ id: 'local-1' }],
    openFile: id => { calls.push(['local-open', id]); return { id, graphData: { nodes: [] } }; },
    createFile: input => { calls.push(['local-create', input.name]); return { id: 'local-created', graphData: input.graphData }; },
  };
  const remote = {
    active: () => remoteActive,
    initialize: async () => { calls.push(['remote-initialize']); return true; },
    listFiles: () => [{ id: 'remote-1' }],
    openFile: async id => { calls.push(['remote-open', id]); return { id, revision: 4, graphData: { nodes: [{ id: 'server-node' }] }, learningState: {} }; },
    createFile: async input => { calls.push(['remote-create', input.name]); return { id: 'remote-created', revision: 1 }; },
  };
  const adapter = {
    adoptFile: file => { calls.push(['adopt', file.id]); return file; },
  };
  const context = { console, Promise, KGGraphFileStore: local, KGGraphFileRemoteStore: remote, KGGraphFileRemoteAdapter: adapter };
  context.window = context;
  context.globalThis = context;
  vm.createContext(context);
  vm.runInContext(
    fs.readFileSync(path.join(root, 'src/23-graph-file-editor-store-bridge.js'), 'utf8'),
    context,
    { filename: '23-graph-file-editor-store-bridge.js' }
  );
  return { bridge: context.KGGraphFileEditorStoreBridge, calls, context, remote };
}

(async () => {
  const remote = load({ remoteActive: true });
  await remote.bridge.initializeCurrent();
  assert.deepStrictEqual(remote.calls, [], 'current-only initialization must select the seeded remote store without listing its catalog');
  await remote.bridge.initialize();
  assert.deepStrictEqual(remote.calls, [['remote-initialize']], 'remote mode must initialize only the Files API cache');
  assert.strictEqual(remote.bridge.current().listFiles()[0].id, 'remote-1');

  const opened = await remote.bridge.openFile('remote-1');
  assert.strictEqual(opened.graphData.nodes[0].id, 'server-node');
  assert.deepStrictEqual(remote.calls.slice(-2), [['remote-open', 'remote-1'], ['adopt', 'remote-1']], 'opening a remote tab must hydrate and adopt the same server file');

  const created = await remote.bridge.createFile({ name: '远端新图谱', graphData: { nodes: [] } });
  assert.strictEqual(created.id, 'remote-created');
  assert.deepStrictEqual(remote.calls.slice(-3), [['remote-create', '远端新图谱'], ['remote-open', 'remote-created'], ['adopt', 'remote-created']], 'remote create must never fall through to the local store');
  assert.strictEqual(remote.calls.some(call => call[0].startsWith('local-')), false);

  let listed={id:'remote-created',revision:2},acknowledged={id:'remote-created',revision:3};
  remote.remote.getCurrentFileMeta=()=>listed;
  remote.context.KGGraphFileRemoteAdapter.getCurrentFileMeta=()=>acknowledged;
  assert.strictEqual(remote.bridge.fragmentSource().revision,3,'publication and question binding must use the same file acknowledged revision after a queued save');
  acknowledged={id:'remote-created',revision:1};
  assert.strictEqual(remote.bridge.fragmentSource().revision,2,'a refreshed server index must not be replaced by an older adapter revision');
  acknowledged={id:'old-file',revision:99};
  assert.strictEqual(remote.bridge.fragmentSource().fileId,'remote-created','an adapter for another tab must not replace the selected source');

  const local = load({ remoteActive: false });
  await local.bridge.initialize();
  const localCreated = await local.bridge.createFile({ name: '访客图谱', graphData: { nodes: [] } });
  assert.strictEqual(localCreated.id, 'local-created');
  assert.deepStrictEqual(local.calls, [['local-create', '访客图谱']], 'guest mode must retain the original local store');
  console.log('graph editor store bridge contract passed');
})().catch(error => {
  console.error(error);
  process.exitCode = 1;
});

// Home JSON/ZIP import must use the same remote file bridge as tab creation.
async function homeImport({saveResult=true,createFails=false,hydrateFails=false,restoreFails=false,deleteFails=false,createGate=null,hydrateGate=null,parseGate=null,textDraft=false,inlineDraft=false,draftFails=false}={}){
  const original={id:'server-original',graphData:{nodes:[{id:'original',title:'原文件'}],links:[]}};
  const remoteFiles=new Map([[original.id,structuredClone(original)]]);
  const localFiles=new Map(),messages=[];let current=original.id;
  let textPending=textDraft,inlinePending=inlineDraft;
  const controls={importFile:{disabled:false,setAttribute(){},removeAttribute(){}},importBtn:{disabled:false,setAttribute(){},removeAttribute(){}}};
  const context={console,Promise,Event,document:{documentElement:{dataset:{}},body:{classList:{contains:()=>false}},getElementById:id=>controls[id]||null},addEventListener(){},CustomEvent:class{constructor(type,options){this.type=type;this.detail=options.detail}},
    state:structuredClone(original.graphData),lastSavedSnapshot:'',
    sanitizeState:value=>structuredClone(value),render:()=>{},dispatchEvent:()=>{},
    showStatus:text=>messages.push(text),
    KGHomeInk:{hasTextDraft:()=>textPending,commitText:async()=>{if(draftFails)return false;context.state.nodes[0].summary='已提交文本草稿';textPending=false;context.KGGraphFileAutosave.markDirty();return true}},
    ensureNodeInlineTextEditorController:()=>({isEditing:()=>inlinePending,commit:async()=>{if(draftFails)return false;context.state.nodes[0].title='已提交节点草稿';inlinePending=false;context.KGGraphFileAutosave.markDirty();return true}}),
    KGHomePackageService:{parseFile:async()=>{if(parseGate)await parseGate;return {meta:{title:'个人导入'},nodes:[{id:'imported',title:'导入内容'}],links:[]}}},
    persistCurrentGraphNow:async()=>{if(!saveResult)return false;remoteFiles.get(current).graphData=structuredClone(context.state);return true},
    KGGraphFileStore:{getCurrentFileId:()=>current,createFile:input=>{
      const file={id:'local-only',graphData:input.graphData};localFiles.set(file.id,file);return file;
    }},
    KGGraphFileRemoteStore:{active:()=>true,initialize:async()=>true,getCurrentFileId:()=>current,
      createFile:async input=>{if(createGate)await createGate;if(createFails)return null;const file={id:'server-imported',revision:1,graphData:structuredClone(input.graphData)};remoteFiles.set(file.id,file);current=file.id;return file},
      openFile:async id=>{if(hydrateGate&&id==='server-imported')await hydrateGate;return hydrateFails&&id==='server-imported'?null:structuredClone(remoteFiles.get(id))},
      setCurrentFileId:async id=>{if(restoreFails)throw new Error('恢复原文件失败');current=id||'';return current},
      deleteFile:async(id,options={})=>{
        if(deleteFails)return false;
        const file=remoteFiles.get(id);
        if(!file)return false;
        if(options.permanent)return file.status==='trashed'&&remoteFiles.delete(id);
        file.status='trashed';return true;
      }},
    KGGraphFileRemoteAdapter:{adoptFile:file=>file}};
  context.window=context;context.globalThis=context;vm.createContext(context);
  vm.runInContext(fs.readFileSync(path.join(root,'src/23-graph-file-editor-store-bridge.js'),'utf8'),context);
  await context.KGGraphFileEditorStoreBridge.initializeCurrent();
  for(const file of ['00-import-guard.js','24-graph-file-autosave.js','25-graph-file-tabs.js'])vm.runInContext(fs.readFileSync(path.join(root,'src',file),'utf8'),context);
  const editor=fs.readFileSync(path.join(root,'src/10-graph-editor.js'),'utf8');
  vm.runInContext(editor.slice(0,editor.indexOf('function currentGraphInteractionMode()')),context);
  context.KGGraphFileAutosave.markDirty();
  const source=fs.readFileSync(path.join(root,'src/20-flashcards-toolbar.js'),'utf8');
  vm.runInContext(source.slice(0,source.indexOf('function addAtCenter()')),context);
  return{context,remoteFiles,localFiles,original,messages,controls,current:()=>current,run:()=>context.importLearningPackageFile({name:'personal.json'})};
}

(async()=>{
  const success=await homeImport();const imported=await success.run();
  assert.strictEqual(imported.id,'server-imported','home import must create and adopt the remote file, not a browser-local file');
  assert.strictEqual(success.remoteFiles.get('server-imported').graphData.nodes[0].title,'导入内容');
  assert.strictEqual(success.context.state.nodes[0].id,'imported');
  assert.deepStrictEqual(success.remoteFiles.get('server-original'),success.original,'import never overwrites the previous server graph');
  assert.strictEqual(success.localFiles.size,0);
  const unsaved=await homeImport({saveResult:false});
  await assert.rejects(unsaved.run(),/当前图谱保存失败/,'an async failed pre-switch save must cancel the import');
  assert.strictEqual(unsaved.remoteFiles.size,1);assert.strictEqual(unsaved.localFiles.size,0);
  assert.strictEqual(unsaved.context.state.nodes[0].id,'original');
  const failed=await homeImport({createFails:true});
  await assert.rejects(failed.run(),/导入文件保存失败/);
  assert.strictEqual(failed.context.state.nodes[0].id,'original');
  assert.strictEqual(failed.remoteFiles.size,1);assert.strictEqual(failed.localFiles.size,0);
  const partial=await homeImport({hydrateFails:true});
  await assert.rejects(partial.run(),/导入文件保存失败/);
  assert.strictEqual(partial.current(),'server-original','failed hydration must restore server selection after create selected the new file');
  assert.strictEqual(partial.context.state.nodes[0].id,'original');
  assert.strictEqual(partial.remoteFiles.size,1,'failed hydration must remove the newly created unusable record');
  assert.deepStrictEqual(partial.remoteFiles.get('server-original'),partial.original);
  assert.strictEqual(partial.localFiles.size,0);
  assert.strictEqual(partial.messages.length,0,'partial create must never announce import success');
  const restoreFailed=await homeImport({hydrateFails:true,restoreFails:true});
  await assert.rejects(restoreFailed.run(),/恢复原文件失败/);
  assert.strictEqual(restoreFailed.context.state.nodes[0].id,'original');
  assert.strictEqual(restoreFailed.messages.length,0);
  assert.strictEqual(restoreFailed.remoteFiles.size,2,'a failed server restoration must surface failure rather than claim rollback succeeded');
  const cleanupFailed=await homeImport({hydrateFails:true,deleteFails:true});
  await assert.rejects(cleanupFailed.run(),/导入文件保存失败/);
  assert.strictEqual(cleanupFailed.current(),'server-original');
  assert.strictEqual(cleanupFailed.context.state.nodes[0].id,'original');
  assert.strictEqual(cleanupFailed.messages.length,0);
  assert.strictEqual(cleanupFailed.remoteFiles.size,2,'a failed cleanup can retain the extra file, but must not announce import success');
  console.log('home import remote persistence, failed-save and partial-create rollback contract passed');
})().catch(error=>{console.error(error);process.exitCode=1});

// Removing the shared transition must expose writable state and drop pending drafts.
(async()=>{
  let releaseCreate,releaseHydrate;
  const createGate=new Promise(resolve=>releaseCreate=resolve),hydrateGate=new Promise(resolve=>releaseHydrate=resolve);
  const item=await homeImport({createGate,hydrateGate,textDraft:true,inlineDraft:true});
  const {context,controls}=item,tabs=context.KGGraphFileTabs;
  const importing=item.run();
  for(let i=0;i<30;i++)await Promise.resolve();
  assert.strictEqual(tabs.isSwitching(),true,'remote create must hold the actual file transition lock');
  assert.strictEqual(context.canWriteGraph(),false,'actual editor write guard must block concurrent edits');
  assert.strictEqual(controls.importFile.disabled,true);
  assert.strictEqual(controls.importBtn.disabled,true);
  assert.strictEqual(await tabs.openFile('other'),false);
  assert.strictEqual(await tabs.closeFile('server-original'),false);
  assert.strictEqual(await tabs.createFile(),null);
  assert.strictEqual(item.current(),'server-original');
  const saved=item.remoteFiles.get('server-original').graphData.nodes[0];
  assert.strictEqual(saved.title,'已提交节点草稿','inline draft must be committed and saved before create');
  assert.strictEqual(saved.summary,'已提交文本草稿','text draft must be committed and saved before create');
  releaseCreate();for(let i=0;i<30;i++)await Promise.resolve();
  assert.strictEqual(tabs.isSwitching(),true,'hydration must remain inside the same transition');
  assert.strictEqual(context.canWriteGraph(),false);
  releaseHydrate();await importing;
  assert.strictEqual(context.state.nodes[0].title,'导入内容');
  assert.strictEqual(tabs.isSwitching(),false);
  assert.strictEqual(context.canWriteGraph(),true);
  assert.strictEqual(controls.importFile.disabled,false);
  assert.strictEqual(context.KGGraphFileAutosave.isDirty(),false);
  for(const options of [{saveResult:false},{createFails:true},{hydrateFails:true},{hydrateFails:true,restoreFails:true},{hydrateFails:true,deleteFails:true},{textDraft:true,draftFails:true},{inlineDraft:true,draftFails:true}]){
    const failed=await homeImport(options);
    await assert.rejects(failed.run());
    assert.strictEqual(failed.context.KGGraphFileTabs.isSwitching(),false,'every failure must release shared transition');
    assert.strictEqual(failed.context.canWriteGraph(),true);
    assert.strictEqual(failed.controls.importFile.disabled,false);
    assert.strictEqual(failed.controls.importBtn.disabled,false);
    assert.strictEqual(failed.context.state.nodes[0].id,'original');
  }
  let finishParsing;
  const parsing=await homeImport({parseGate:new Promise(resolve=>finishParsing=resolve)});
  const parsed=parsing.run();
  assert.strictEqual(parsing.context.canWriteGraph(),true,'parsing must leave original editable until transition acquisition');
  parsing.context.state.nodes[0].title='解析期间的新修改';
  parsing.context.KGGraphFileAutosave.markDirty();
  finishParsing();await parsed;
  assert.strictEqual(parsing.remoteFiles.get('server-original').graphData.nodes[0].title,'解析期间的新修改');
  let finishSwitch;
  const busy=await homeImport();
  const other=busy.context.KGGraphFileTabs.withSavedFileTransition(()=>new Promise(resolve=>finishSwitch=resolve));
  await assert.rejects(busy.run(),/正在切换/);
  assert.strictEqual(busy.context.KGGraphFileTabs.isSwitching(),true,'rejected import must not unlock another transition');
  assert.strictEqual(busy.controls.importFile.disabled,false);
  finishSwitch();await other;
  assert.strictEqual(busy.context.KGGraphFileTabs.isSwitching(),false);
  assert.strictEqual(busy.remoteFiles.size,1);
  console.log('home import actual transition/draft/save/guard lifetime contract passed');
})().catch(error=>{console.error(error);process.exitCode=1});
