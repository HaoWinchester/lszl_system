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
  const serverEmpty=!!options.empty, failRead=!!options.failRead, sharedClient=!!options.sharedClient
  const original = {id:'pmp-pattern-workspace',title:'已有画布',schemaVersion:10,nodes:{q1:{id:'q1',questionId:'question-1',color:'#ffffff',x:100,y:200},q2:{id:'q2',questionId:'question-2',color:'#ffffff',x:600,y:200}},edges:[],groups:[],strokes:[],tables:[]}
  let saved = structuredClone(original)
  const window = {
    location:{href:'https://example.test/question-workspace.html?workspace='+requested+'&paperId=paper-1#canvas'},
    KGAuthCore:{currentUsername:()=> username},AbortController,
    KGAppStorage:{readJSON:(key,fallback)=>memory.has(key)?structuredClone(memory.get(key)):fallback,writeJSON:(key,value)=>{memory.set(key,structuredClone(value));return true},remove:key=>memory.delete(key)},
    addEventListener(type,handler){if(!listeners.has(type))listeners.set(type,new Set());listeners.get(type).add(handler)},dispatchEvent(event){for(const handler of listeners.get(event.type)||[])handler(event)},
  }
  window.history={state:{entry:1},replaceState(state,title,url){window.location.href=String(url)}}
  const fetch = async (url, options) => {
    const body=options.body ? JSON.parse(options.body) : null
    requests.push({url,method:options.method,body,principal:username})
    if(options.method==='GET') {
      if (failRead) throw new Error('Network unavailable')
      const response=new Response(JSON.stringify({workspaces:serverEmpty||username!=='admin'&&!sharedClient?[]:[{id:username==='admin'?'remote-existing':'bob-existing',payload:saved,title:'已有画布',schemaVersion:10}]}))
      if(heldRead){const pending=heldRead;heldRead=null;return new Promise(resolve=>{pending.resume=()=>resolve(response)})}
      return response
    }
    if(options.method==='POST') return new Response(JSON.stringify({detail:'工作区 ID 已存在'}),{status:400})
    if(options.method==='PUT'){saved=structuredClone(body.payload);const response=new Response(JSON.stringify({workspace:{id:'remote-existing'}}));if(heldWrite){const pending=heldWrite;heldWrite=null;return new Promise(resolve=>{pending.resume=()=>resolve(response)})}return response}
    if(options.method==='DELETE') return new Response('{}')
    throw new Error('Unexpected request '+options.method)
  }
  const context=vm.createContext({window,globalThis:window,fetch,URL,setTimeout,clearTimeout,console:{error(){}},CustomEvent:class{constructor(type,options){this.type=type;this.detail=options?.detail}}})
  vm.runInContext(readFileSync(resolve(scriptsDir,'../../new-legacy/src/65-canvas-workspace-store.js'),'utf8'),context)
  if(options.cached)window.KGCanvasWorkspaceStore.write(structuredClone(original))
  vm.runInContext(readFileSync(resolve(assets,'canvas-workspace-adapter.js'),'utf8'),context)
  let hydrationError
  try { await window.KGCanvasWorkspaceAdapter.ready } catch (error) { hydrationError=error }
  return {window,requests,hydrationError,saved:()=>structuredClone(saved),setUser(value){username=value;window.dispatchEvent({type:'kg-auth-session-change'})},holdRead(){const pending={};heldRead=pending;return ()=>pending.resume()},holdWrite(){const pending={};heldWrite=pending;return ()=>pending.resume()}}
}

test('opening a server workspace ID resolves the existing client canvas before ensure can create an empty alias',async()=>{
  const {window,requests}=await workspaceHarness()
  const url=new URL(window.location.href)
  assert.equal(url.searchParams.get('workspace'),'pmp-pattern-workspace')
  assert.equal(url.searchParams.get('paperId'),'paper-1')
  assert.equal(url.hash,'#canvas')
  const workspace=window.KGCanvasWorkspaceStore.ensure({workspaceId:url.searchParams.get('workspace')})
  assert.deepEqual(Object.keys(workspace.nodes).sort(),['q1','q2'])
  assert.deepEqual(requests.map(r=>r.method),['GET'],'opening an existing link must never write an empty canvas')
})

test('an unhydrated workspace ID collision cannot overwrite the server canvas',async()=>{
  const {window,requests,saved}=await workspaceHarness('pmp-pattern-workspace')
  window.KGCanvasWorkspaceStore.write({id:'remote-existing',title:'空白副本',schemaVersion:10,nodes:{},edges:[]})
  await assert.rejects(window.KGCanvasWorkspaceAdapter.flush({throwOnError:true}),/尚未保存/)
  assert.equal(window.KGCanvasWorkspaceAdapter.getState('remote-existing').status,'failed')
  assert.deepEqual(Object.keys(saved().nodes).sort(),['q1','q2'])
  assert.equal(requests.filter(r=>r.method==='PUT').length,0)
})

test('hydrated workspace edits still PUT the mapped server ID and retain every existing node',async()=>{
  const {window,requests,saved}=await workspaceHarness('pmp-pattern-workspace')
  const workspace=window.KGCanvasWorkspaceStore.read({workspaceId:'pmp-pattern-workspace'})
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
  const workspace=window.KGCanvasWorkspaceStore.read({workspaceId:'pmp-pattern-workspace'})
  workspace.nodes.q1.color='#dbeafe'
  window.KGCanvasWorkspaceStore.write(workspace)
  await window.KGCanvasWorkspaceAdapter.flush({throwOnError:true})
  assert.equal(requests.filter(r=>r.method==='PUT').length,1)
  assert.equal(saved().nodes.q1.color,'#dbeafe')
})

test('refresh refuses to replace unsaved edits and clean refresh sends no write',async()=>{
  const {window,requests,saved}=await workspaceHarness('pmp-pattern-workspace')
  const workspace=window.KGCanvasWorkspaceStore.read({workspaceId:'pmp-pattern-workspace'})
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
  const workspace=window.KGCanvasWorkspaceStore.read({workspaceId:'pmp-pattern-workspace'})
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
  const workspace=window.KGCanvasWorkspaceStore.read({workspaceId:'pmp-pattern-workspace'})
  workspace.nodes.q1.color='#dbeafe'
  window.KGCanvasWorkspaceStore.write(workspace)
  const saving=window.KGCanvasWorkspaceAdapter.flush()
  await new Promise(resolve=>setImmediate(resolve))
  window.KGCanvasWorkspaceStore.deleteWorkspace('pmp-pattern-workspace')
  setUser('bob');await window.KGCanvasWorkspaceAdapter.ready
  resume();await saving
  await new Promise(resolve=>setImmediate(resolve))
  assert.equal(requests.filter(r=>r.principal==='bob'&&r.method==='DELETE').length,0)
})
