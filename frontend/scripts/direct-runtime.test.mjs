import assert from 'node:assert/strict'
import { existsSync, readFileSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import test from 'node:test'
import vm from 'node:vm'
import { fileURLToPath } from 'node:url'

const scriptsDir = dirname(fileURLToPath(import.meta.url))
const assets = resolve(scriptsDir, 'new-legacy-assets')

test('retired Runtime has no executable browser bootstrap', () => {
  assert.equal(existsSync(resolve(assets, 'server-state-bootstrap.js')), false)
  assert.deepEqual(JSON.parse(readFileSync(resolve(assets, 'runtime-retirement.json'), 'utf8')), {
    schemaVersion: 1,
    status: 'retired',
    runtimeRequests: 0,
  })
})

test('direct adapters retain only relational API boundaries', () => {
  for (const asset of ['canvas-workspace-adapter.js', 'course-management-adapter.js', 'question-catalog-adapter.js']) {
    assert.doesNotMatch(readFileSync(resolve(assets, asset), 'utf8'), /\/api\/v1\/runtime\/state/)
  }
})


async function workspaceHarness(requested = 'remote-existing', options = {}) {
  const memory = new Map(), requests = [], listeners = new Map()
  let username='admin', heldRead=null, heldWrite=null
  const serverEmpty=!!options.empty, failRead=!!options.failRead, sharedClient=!!options.sharedClient, allowCreate=!!options.allowCreate
  const original = {id:'pmp-pattern-workspace',title:'已有画布',schemaVersion:10,nodes:{q1:{id:'q1',questionId:'question-1',color:'#ffffff',x:100,y:200},q2:{id:'q2',questionId:'question-2',color:'#ffffff',x:600,y:200}},edges:[],groups:[],strokes:[],tables:[]}
  let saved = structuredClone(original), customRows=options.rows?structuredClone(options.rows):null
  const window = {
    location:{href:'https://example.test/question-workspace.html?workspace='+requested+'&paperId=paper-1#canvas'},
    KGAuthCore:{currentUsername:()=> username,currentUser:()=>({username,role:options.role||'admin'})},AbortController,
    KGAppStorage:{readJSON:(key,fallback)=>memory.has(key)?structuredClone(memory.get(key)):fallback,writeJSON:(key,value)=>{memory.set(key,structuredClone(value));return true},remove:key=>memory.delete(key)},
    addEventListener(type,handler){if(!listeners.has(type))listeners.set(type,new Set());listeners.get(type).add(handler)},dispatchEvent(event){for(const handler of listeners.get(event.type)||[])handler(event)},
  }
  window.history={state:{entry:1},replaceState(state,title,url){window.location.href=String(url)}}
  const fetch = async (url, options) => {
    const body=options.body ? JSON.parse(options.body) : null
    requests.push({url,method:options.method,body,principal:username})
    if(options.method==='GET') {
      if (failRead) throw new Error('Network unavailable')
      const response=new Response(JSON.stringify({workspaces:serverEmpty||username!=='admin'&&!sharedClient?[]:(customRows||[{id:username==='admin'?'remote-existing':'bob-existing',payload:saved,title:'已有画布',schemaVersion:10}])}))
      if(heldRead){const pending=heldRead;heldRead=null;return new Promise(resolve=>{pending.resume=()=>resolve(response)})}
      return response
    }
    if(options.method==='POST'){if(allowCreate){saved=structuredClone(body.payload);return new Response(JSON.stringify({workspace:{id:body.id}}))}return new Response(JSON.stringify({detail:'工作区 ID 已存在'}),{status:400})}
    if(options.method==='PUT'){saved=structuredClone(body.payload);if(customRows){const row=customRows.find(row=>url.endsWith('/'+encodeURIComponent(row.id)));if(row)row.payload=structuredClone(body.payload)}const response=new Response(JSON.stringify({workspace:{id:'remote-existing'}}));if(heldWrite){const pending=heldWrite;heldWrite=null;return new Promise(resolve=>{pending.resume=()=>resolve(response)})}return response}
    if(options.method==='DELETE') return new Response('{}')
    throw new Error('Unexpected request '+options.method)
  }
  const context=vm.createContext({window,globalThis:window,fetch,URL,setTimeout,clearTimeout,console:{error(){}},CustomEvent:class{constructor(type,options){this.type=type;this.detail=options?.detail}}})
  vm.runInContext(readFileSync(resolve(scriptsDir,'../../new-legacy/src/65-canvas-workspace-store.js'),'utf8'),context)
  if(options.cached)window.KGCanvasWorkspaceStore.write(structuredClone(original))
  vm.runInContext(readFileSync(resolve(assets,'canvas-workspace-adapter.js'),'utf8'),context)
  let hydrationError
  try { await window.KGCanvasWorkspaceAdapter.ready } catch (error) { hydrationError=error }
  return {window,requests,hydrationError,saved:()=>structuredClone(saved),serverRows:()=>structuredClone(customRows),setRows:rows=>{customRows=structuredClone(rows)},setUser(value){username=value;window.dispatchEvent({type:'kg-auth-session-change'})},holdRead(){const pending={};heldRead=pending;return ()=>pending.resume()},holdWrite(){const pending={};heldWrite=pending;return ()=>pending.resume()}}
}

test('readonly workspace hydration and local initialization never issue server writes',async()=>{
  const {window,requests}=await workspaceHarness('viewer-new',{role:'viewer'})
  const workspace=window.KGCanvasWorkspaceStore.ensure({workspaceId:'viewer-new'})
  window.KGCanvasWorkspaceStore.write(workspace)
  await window.KGCanvasWorkspaceAdapter.flush({throwOnError:true})
  assert.deepEqual(requests.map(request=>request.method),['GET'])
  assert.equal(window.KGCanvasWorkspaceAdapter.getState(workspace.id).status,'idle')
})

test('opening a server workspace ID resolves the existing client canvas before ensure can create an empty alias',async()=>{
  const {window,requests}=await workspaceHarness()
  const url=new URL(window.location.href)
  assert.equal(url.searchParams.get('workspace'),'remote-existing')
  assert.equal(url.searchParams.get('paperId'),'paper-1')
  assert.equal(url.hash,'#canvas')
  const workspace=window.KGCanvasWorkspaceStore.ensure({workspaceId:url.searchParams.get('workspace')})
  assert.deepEqual(Object.keys(workspace.nodes).sort(),['q1','q2'])
  assert.deepEqual(requests.map(r=>r.method),['GET'],'opening an existing link must never write an empty canvas')
})

test('an unhydrated workspace ID collision cannot overwrite the server canvas',async()=>{
  const {window,requests,saved}=await workspaceHarness('pmp-pattern-workspace')
  window.KGCanvasWorkspaceStore.write({id:'remote-not-hydrated',title:'空白副本',schemaVersion:10,nodes:{},edges:[]})
  await assert.rejects(window.KGCanvasWorkspaceAdapter.flush({throwOnError:true}),/尚未保存/)
  assert.equal(window.KGCanvasWorkspaceAdapter.getState('remote-not-hydrated').status,'failed')
  assert.deepEqual(Object.keys(saved().nodes).sort(),['q1','q2'])
  assert.equal(requests.filter(r=>r.method==='PUT').length,0)
})

test('hydrated workspace edits still PUT the mapped server ID and retain every existing node',async()=>{
  const {window,requests,saved}=await workspaceHarness('pmp-pattern-workspace')
  const workspace=window.KGCanvasWorkspaceStore.read({workspaceId:'remote-existing'})
  workspace.nodes.q1.color='#dbeafe'
  window.KGCanvasWorkspaceStore.write(workspace)
  await window.KGCanvasWorkspaceAdapter.flush({throwOnError:true})
  assert.equal(requests.at(-1).url,'/api/v1/workspaces/remote-existing')
  assert.equal(requests.at(-1).method,'PUT')
  assert.deepEqual(Object.keys(saved().nodes).sort(),['q1','q2'])
  assert.equal(saved().nodes.q1.color,'#dbeafe')
})


test('BFCache return keeps the workspace store subscription and later edits durable',async()=>{
  const {window,requests,saved}=await workspaceHarness('pmp-pattern-workspace')
  window.dispatchEvent({type:'pagehide',persisted:true})
  window.dispatchEvent({type:'pageshow',persisted:true})
  const workspace=window.KGCanvasWorkspaceStore.read({workspaceId:'remote-existing'})
  workspace.nodes.q1.color='#dbeafe'
  window.KGCanvasWorkspaceStore.write(workspace)
  await window.KGCanvasWorkspaceAdapter.flush({throwOnError:true})
  assert.equal(requests.filter(r=>r.method==='PUT').length,1)
  assert.equal(saved().nodes.q1.color,'#dbeafe')
})

test('refresh refuses to replace unsaved edits and clean refresh sends no write',async()=>{
  const {window,requests,saved}=await workspaceHarness('pmp-pattern-workspace')
  const workspace=window.KGCanvasWorkspaceStore.read({workspaceId:'remote-existing'})
  workspace.nodes.q1.color='#dbeafe'
  window.KGCanvasWorkspaceStore.write(workspace)
  await assert.rejects(window.KGCanvasWorkspaceAdapter.refresh(),/保存/)
  await window.KGCanvasWorkspaceAdapter.flush({throwOnError:true})
  assert.equal(saved().nodes.q1.color,'#dbeafe')
  const before=requests.length
  await window.KGCanvasWorkspaceAdapter.refresh()
  await window.KGCanvasWorkspaceAdapter.flush({throwOnError:true})
  assert.deepEqual(requests.slice(before).map(r=>r.method),['GET'])
})

test('empty server state replaces stale device data without automatically uploading summaries',async()=>{
  const {window,requests}=await workspaceHarness('pmp-pattern-workspace',{empty:true,cached:true})
  await window.KGCanvasWorkspaceAdapter.flush({throwOnError:true})
  assert.deepEqual(requests.map(r=>r.method),['GET'])
  const workspace=window.KGCanvasWorkspaceStore.ensure({workspaceId:'pmp-pattern-workspace'})
  assert.deepEqual(Object.keys(workspace.nodes),[])
})

test('account change discards an old failed create instead of retrying its data as the new owner',async()=>{
  const {window,requests,setUser}=await workspaceHarness('pmp-pattern-workspace')
  window.KGCanvasWorkspaceStore.write({id:'old-private',userId:'admin',schemaVersion:10,nodes:{secret:{id:'secret',questionId:'private'}},edges:[]})
  await assert.rejects(window.KGCanvasWorkspaceAdapter.flush({throwOnError:true}))
  setUser('bob')
  await window.KGCanvasWorkspaceAdapter.ready
  await window.KGCanvasWorkspaceAdapter.flush({throwOnError:true})
  assert.equal(requests.filter(r=>r.principal==='bob'&&r.method!=='GET').length,0)
  assert.equal(window.KGCanvasWorkspaceAdapter.getState('old-private').status,'idle')
})


test('edits made while a refresh GET is pending survive the old server response',async()=>{
  const {window,requests,saved,holdRead}=await workspaceHarness('pmp-pattern-workspace')
  const resume=holdRead(), refresh=window.KGCanvasWorkspaceAdapter.refresh()
  const workspace=window.KGCanvasWorkspaceStore.read({workspaceId:'remote-existing'})
  workspace.nodes.q1.color='#dbeafe'
  window.KGCanvasWorkspaceStore.write(workspace)
  resume()
  await assert.rejects(refresh,/修改|保存/)
  await window.KGCanvasWorkspaceAdapter.flush({throwOnError:true})
  assert.equal(saved().nodes.q1.color,'#dbeafe')
  assert.equal(requests.filter(r=>r.method==='PUT').length,1)
})

test('a late read from the previous account cannot repopulate the new account store',async()=>{
  const {window,setUser,holdRead}=await workspaceHarness('pmp-pattern-workspace')
  const resume=holdRead(), oldRefresh=window.KGCanvasWorkspaceAdapter.refresh()
  setUser('bob')
  await window.KGCanvasWorkspaceAdapter.ready
  resume();await oldRefresh
  assert.deepEqual(Object.keys(window.KGCanvasWorkspaceStore.ensure({workspaceId:'pmp-pattern-workspace'}).nodes),[])
})


test('a failed initial read never permits cached content to overwrite a server workspace',async()=>{
  const {window,requests,hydrationError}=await workspaceHarness('pmp-pattern-workspace',{cached:true,failRead:true})
  assert.match(hydrationError?.message||'',/Network unavailable/)
  assert.equal(window.KGCanvasWorkspaceAdapter.isReady(),false)
  const workspace=window.KGCanvasWorkspaceStore.read({workspaceId:'pmp-pattern-workspace'})
  workspace.nodes.q1.color='#dbeafe'
  window.KGCanvasWorkspaceStore.write(workspace)
  await assert.rejects(window.KGCanvasWorkspaceAdapter.flush({throwOnError:true}))
  assert.deepEqual(requests.map(r=>r.method),['GET'])
})


test('deleting a canvas while an old save waits cannot delete the next account canvas',async()=>{
  const {window,requests,setUser,holdWrite}=await workspaceHarness('pmp-pattern-workspace',{sharedClient:true})
  const resume=holdWrite()
  const workspace=window.KGCanvasWorkspaceStore.read({workspaceId:'remote-existing'})
  workspace.nodes.q1.color='#dbeafe'
  window.KGCanvasWorkspaceStore.write(workspace)
  const saving=window.KGCanvasWorkspaceAdapter.flush()
  await new Promise(resolve=>setImmediate(resolve))
  window.KGCanvasWorkspaceStore.deleteWorkspace('remote-existing')
  setUser('bob');await window.KGCanvasWorkspaceAdapter.ready
  resume();await saving
  await new Promise(resolve=>setImmediate(resolve))
  assert.equal(requests.filter(r=>r.principal==='bob'&&r.method==='DELETE').length,0)
})

function workspaceRow(id,questionId,alias='pmp-pattern-workspace') {
  return {id,title:questionId,schemaVersion:10,payload:{id:alias,userId:'admin',schemaVersion:10,title:questionId,nodes:{[questionId]:{id:questionId,questionId,bankId:'bank',paperId:'paper',releaseId:'release',x:100,y:200}},edges:[],groups:[],strokes:[],tables:[]}}
}

test('duplicate legacy workspace payload IDs preserve both rows and choose the owner default independent of response order',async()=>{
  const own=workspaceRow('pmp-pattern-workspace-en845w','owner-question'),old=workspaceRow('pmp-pattern-workspace-1gthaer','old-question');
  for(const rows of [[own,old],[old,own]]) {
    const {window,requests,setRows}=await workspaceHarness('pmp-pattern-workspace',{rows});
    const store=window.KGCanvasWorkspaceStore;assert.equal(new URL(window.location.href).searchParams.get('workspace'),own.id);
    assert.equal(store.getActiveWorkspaceId(),own.id);assert.deepEqual(Array.from(store.listWorkspaces(),w=>w.id).sort(),[own.id,old.id].sort());
    assert.deepEqual(Object.keys(store.read({workspaceId:own.id}).nodes),['owner-question']);assert.deepEqual(Object.keys(store.read({workspaceId:old.id}).nodes),['old-question']);
    setRows([...rows].reverse());await window.KGCanvasWorkspaceAdapter.refresh();
    assert.equal(store.getActiveWorkspaceId(),own.id);assert.deepEqual(Object.keys(store.read({workspaceId:own.id}).nodes),['owner-question']);
    assert.deepEqual(requests.map(r=>r.method),['GET','GET']);
  }
});

test('an explicit remote link selects and saves only that row even when another row shares its payload ID',async()=>{
  const own=workspaceRow('pmp-pattern-workspace-en845w','owner-question'),old=workspaceRow('pmp-pattern-workspace-1gthaer','old-question');
  const {window,requests,serverRows}=await workspaceHarness(old.id,{rows:[own,old]});const store=window.KGCanvasWorkspaceStore;
  assert.equal(new URL(window.location.href).searchParams.get('workspace'),old.id);assert.equal(store.getActiveWorkspaceId(),old.id);
  const workspace=store.ensure({workspaceId:old.id});workspace.nodes['old-question'].color='#dbeafe';const written=store.write(workspace);await window.KGCanvasWorkspaceAdapter.flush({throwOnError:true});
  assert.deepEqual(requests.filter(r=>r.method!=='GET').map(r=>[r.method,r.url]),[['PUT','/api/v1/workspaces/'+old.id]]);
  assert.deepEqual(Object.keys(serverRows().find(r=>r.id===own.id).payload.nodes),['owner-question']);
  assert.equal(serverRows().find(r=>r.id===old.id).payload.nodes['old-question'].color,'#dbeafe');
  const sent=requests.at(-1).body.payload;assert.equal(sent.id,old.payload.id);assert.deepEqual(sent,structuredClone({...written,id:old.payload.id}),'only payload.id retains the old alias; all business data matches the canonical client workspace');
});

test('a generic old payload alias resolves deterministically and still resolves after saving',async()=>{
  const first=workspaceRow('remote-a','question-a','old-link'),second=workspaceRow('remote-z','question-z','old-link');
  const {window,requests}=await workspaceHarness('old-link',{rows:[second,first]});const store=window.KGCanvasWorkspaceStore;
  assert.equal(new URL(window.location.href).searchParams.get('workspace'),first.id);assert.equal(store.getActiveWorkspaceId(),first.id);
  const workspace=store.read({workspaceId:first.id});store.write(workspace);await window.KGCanvasWorkspaceAdapter.flush({throwOnError:true});
  window.location.href='https://example.test/question-workspace.html?workspace=old-link';await window.KGCanvasWorkspaceAdapter.refresh();
  assert.equal(new URL(window.location.href).searchParams.get('workspace'),first.id);assert.equal(store.getActiveWorkspaceId(),first.id);
  assert.equal(requests.filter(r=>r.method==='POST').length,0);
});

test('a cached active legacy alias resolves to the owner row when no workspace URL is present',async()=>{
  const rows=[workspaceRow('pmp-pattern-workspace-1gthaer','old-question'),workspaceRow('pmp-pattern-workspace-en845w','owner-question')];
  const {window}=await workspaceHarness('',{rows,cached:true});assert.equal(window.KGCanvasWorkspaceStore.getActiveWorkspaceId(),'pmp-pattern-workspace-en845w');
});

test('owner default wins over a bare default row while explicit generic remote IDs win over aliases',async()=>{
  const own=workspaceRow('pmp-pattern-workspace-en845w','owner-question'),bare=workspaceRow('pmp-pattern-workspace','bare-question');
  const first=await workspaceHarness('pmp-pattern-workspace',{rows:[bare,own]});assert.equal(new URL(first.window.location.href).searchParams.get('workspace'),own.id);
  const alias=workspaceRow('remote-a','alias-question','remote-z'),exact=workspaceRow('remote-z','exact-question','legacy');
  const second=await workspaceHarness('remote-z',{rows:[alias,exact]});assert.equal(second.window.KGCanvasWorkspaceStore.getActiveWorkspaceId(),exact.id);
  assert.deepEqual(Object.keys(second.window.KGCanvasWorkspaceStore.read({workspaceId:exact.id}).nodes),['exact-question']);
});

test('default alias falls back to the bare row then stable remote ID ordering',async()=>{
  const bare=workspaceRow('pmp-pattern-workspace','bare-question'),other=workspaceRow('a-foreign','other-question');
  const first=await workspaceHarness('pmp-pattern-workspace',{rows:[other,bare]});assert.equal(first.window.KGCanvasWorkspaceStore.getActiveWorkspaceId(),bare.id);
  for(const rows of [[workspaceRow('z-foreign','z'),other],[other,workspaceRow('z-foreign','z')]]){
    const next=await workspaceHarness('pmp-pattern-workspace',{rows});assert.equal(new URL(next.window.location.href).searchParams.get('workspace'),other.id);
  }
});

test('a newly created default canvas still uses the owner hash and later saves target the same row',async()=>{
  const {window,requests}=await workspaceHarness('pmp-pattern-workspace',{empty:true,allowCreate:true}),store=window.KGCanvasWorkspaceStore;
  const workspace=store.ensure({workspaceId:'pmp-pattern-workspace'});store.write(workspace);await window.KGCanvasWorkspaceAdapter.flush({throwOnError:true});
  assert.equal(requests.at(-1).method,'POST');assert.equal(requests.at(-1).body.id,'pmp-pattern-workspace-en845w');
  store.write(workspace);await window.KGCanvasWorkspaceAdapter.flush({throwOnError:true});
  assert.equal(requests.at(-1).method,'PUT');assert.equal(requests.at(-1).url,'/api/v1/workspaces/pmp-pattern-workspace-en845w');
});
