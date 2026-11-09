import assert from 'node:assert/strict'
import test from 'node:test'
import { existsSync, readFileSync } from 'node:fs'
import { runInNewContext } from 'node:vm'
const read = path => readFileSync(new URL(path, import.meta.url), 'utf8')
const plain = value => JSON.parse(JSON.stringify(value))
const row = id => ({sessionId: id, paperId: 'paper', paperName: '测试卷', status: 'completed', createdAt: '2026-11-01T00:00:00Z'})
const deferred = () => { let resolve, reject; const promise = new Promise((yes, no) => { resolve=yes; reject=no }); return {promise, resolve, reject} }
function history(options={}) {
  const path = new URL('../../new-legacy/src/practice/history-controller.js', import.meta.url)
  const window = {}
  if (existsSync(path)) runInNewContext(readFileSync(path, 'utf8'), {window})
  assert.equal(typeof window.KGPracticeHistory?.createLoader, 'function', 'history must expose a paginated loader')
  return window.KGPracticeHistory.createLoader({getUser: () => 'student', loadPage: async () => ({sessions: [], total: 0, nextCursor: null}), onChange() {}, ...options})
}
test('adapter reads one bounded page, retains total/cursor and keeps the array compatibility API', async () => {
  const calls=[]; let user={username:'student'}
  const window={location:{pathname:'/practice-mode.html'},addEventListener(){},KGAuthCore:{currentUser:()=>user},fetch:async url=>{calls.push(url);return {ok:true,json:async()=>({sessions:[row('one')],total:125,nextCursor:'opaque/+ ?'})}}}
  runInNewContext(read('./new-legacy-assets/practice-learning-adapter.js'),{window,URLSearchParams,CustomEvent:class{}})
  const api=window.KGPracticeLearningApi
  assert.equal(typeof api.listSessionsPage,'function','paginated API must expose the server total and cursor')
  assert.deepEqual(plain(await api.listSessionsPage()),{sessions:[row('one')],total:125,nextCursor:'opaque/+ ?'})
  assert.equal(calls.length,1,'opening a page must not walk all cursors')
  assert.equal(calls[0],'/api/v1/learning/practice/sessions?limit=20')
  await api.listSessionsPage({limit:20,cursor:'opaque/+ ?'})
  assert.equal(new URL(calls[1],'http://local').searchParams.get('cursor'),'opaque/+ ?')
  assert.deepEqual(plain(await api.listSessions({limit:5})),[row('one')])
  assert.equal(new URL(calls[2],'http://local').searchParams.get('limit'),'5')
  user=null
  assert.deepEqual(plain(await api.listSessionsPage()),{sessions:[],total:0,nextCursor:null})
  assert.equal(calls.length,3,'guest history must not request data')
})
test('history loads beyond 100 only on demand and merges duplicate session identities', async () => {
  const calls=[], pages=[{sessions:Array.from({length:20},(_,i)=>row('r'+i)),total:125,nextCursor:'p2'},
    {sessions:[row('r19'),...Array.from({length:19},(_,i)=>row('r'+(20+i)))],total:125,nextCursor:'p3'},
    {sessions:Array.from({length:86},(_,i)=>row('r'+(39+i))),total:125,nextCursor:null}]
  let state
  const controller=history({loadPage:async options=>{calls.push(plain(options));return pages.shift()},onChange:value=>{state=value}})
  await controller.refresh()
  assert.deepEqual(calls,[{limit:20,cursor:null}]);assert.equal(state.records.length,20);assert.equal(state.total,125)
  await controller.loadMore();assert.equal(state.records.length,39)
  await controller.loadMore();assert.equal(state.records.length,125);assert.equal(state.nextCursor,null)
  await controller.loadMore();assert.equal(calls.length,3,'exhausted page must not be requested again')
})
test('page failure retains loaded records and retries the same cursor; concurrent clicks coalesce', async () => {
  let state,attempt=0;const pending=deferred(),calls=[]
  const controller=history({loadPage:async options=>{calls.push(plain(options));attempt++;if(attempt===1)return {sessions:[row('first')],total:3,nextCursor:'p2'};if(attempt===2)return pending.promise;return {sessions:[row('last')],total:2,nextCursor:null}},onChange:value=>{state=value}})
  await controller.refresh();const first=controller.loadMore();controller.loadMore()
  assert.equal(calls.length,2);assert.equal(state.loading,true)
  pending.reject(Error('offline'));await first
  assert.equal(state.records.length,1);assert.equal(state.nextCursor,'p2');assert.equal(state.status,'error');assert.equal(state.loading,false)
  await controller.loadMore();assert.equal(calls[2].cursor,'p2');assert.equal(state.records.length,2);assert.equal(state.status,'ready')
})
test('first-page failures have a retry path and refresh starts from the first page', async () => {
  let state,count=0;const calls=[]
  const controller=history({loadPage:async options=>{calls.push(plain(options));if(++count===1)throw Error('offline');return {sessions:[row('fresh')],total:1,nextCursor:null}},onChange:value=>{state=value}})
  await controller.refresh();assert.equal(state.status,'error');assert.equal(state.records.length,0)
  await controller.loadMore();assert.equal(state.records[0].sessionId,'fresh')
  await controller.refresh();assert.equal(calls[2].cursor,null)
})
test('account reset and newer refresh discard late success and errors from older requests', async () => {
  let owner='alice',state;const pending=[]
  const controller=history({getUser:()=>owner,loadPage:()=>{const d=deferred();pending.push(d);return d.promise},onChange:value=>{state=value}})
  const alice=controller.refresh();owner='bob';controller.reset();assert.equal(state.records.length,0);assert.equal(state.total,0)
  const bob=controller.refresh();pending[1].resolve({sessions:[row('bob')],total:1,nextCursor:null});await bob
  pending[0].resolve({sessions:[row('alice')],total:90,nextCursor:'old'});await alice
  assert.equal(state.records[0].sessionId,'bob');assert.equal(state.total,1)
  const old=controller.refresh(),fresh=controller.refresh();pending[3].resolve({sessions:[row('newer')],total:1,nextCursor:null});await fresh;pending[2].reject(Error('old failure'));await old
  assert.equal(state.records[0].sessionId,'newer');assert.equal(state.status,'ready')
  owner='';controller.reset();assert.equal(state.status,'guest');assert.equal(state.records.length,0);assert.equal(state.total,0)
})
test('clear invalidates a pending page, sets total to zero and removes the old cursor', async () => {
  let state,calls=0;const pending=deferred()
  const controller=history({loadPage:async()=>++calls===1?{sessions:[row('first')],total:40,nextCursor:'p2'}:pending.promise,onChange:value=>{state=value}})
  await controller.refresh();const oldPage=controller.loadMore()
  assert.equal(await controller.clear(async()=>{}),true)
  assert.equal(state.total,0);assert.equal(state.records.length,0);assert.equal(state.nextCursor,null)
  pending.resolve({sessions:[row('stale')],total:40,nextCursor:'p3'});await oldPage
  assert.equal(state.records.length,0);await controller.loadMore();assert.equal(calls,2)
})
test('failed clear preserves records and allows another delete attempt', async () => {
  let state
  const controller=history({loadPage:async()=>({sessions:[row('first')],total:1,nextCursor:null}),onChange:value=>{state=value}})
  await controller.refresh();assert.equal(await controller.clear(async()=>{throw Error('offline')}),false)
  assert.equal(state.records.length,1);assert.equal(state.total,1);assert.equal(state.loading,false)
  assert.equal(await controller.clear(async()=>{}),true);assert.equal(state.records.length,0)
})
test('the lobby preview asks the real practice adapter for only five recent summaries', async () => {
  const calls=[],stop=Error('dashboard captured')
  const document={getElementById:id=>id==='practiceRecentBody'?{}:null,querySelector:()=>null,querySelectorAll:()=>[],addEventListener(){}}
  const window={KGAuthCore:{currentUser:()=>({username:'student'})},KGPracticeFeatures:{},KGPracticeLearningApi:{listSessions:async options=>{calls.push(options);return []}},KGPracticeLobbyDashboard:{create(options){options.getHistory();throw stop}}}
  runInNewContext(read('../../new-legacy/src/100-practice-mode.js'),{window,document})
  await assert.rejects(window.KGPracticeMode.init(),error=>error===stop)
  assert.deepEqual(plain(calls),[{limit:5}])
})
test('distinct legacy event identities survive even when paper, time and status match', async () => {
  let state
  const controller=history({loadPage:async()=>({sessions:[{...row(''),eventId:'legacy-one'},{...row(''),eventId:'legacy-two'}],total:2,nextCursor:null}),onChange:value=>{state=value}})
  await controller.refresh()
  assert.equal(state.records.length,2)
})
test('reopening history waits for the current owner deletion before reading a fresh first page', async () => {
  let state,deleted=false,reads=0;const removal=deferred()
  const controller=history({loadPage:async()=>{reads++;return {sessions:deleted?[]:[row('before-delete')],total:deleted?0:1,nextCursor:null}},onChange:value=>{state=value}})
  await controller.refresh()
  const clearing=controller.clear(async()=>{await removal.promise;deleted=true})
  const reopened=controller.refresh()
  assert.equal(reads,1,'a reopened drawer must wait for the current delete transaction')
  removal.resolve();assert.equal(await clearing,true);await reopened
  assert.equal(reads,2);assert.equal(state.total,0);assert.equal(state.records.length,0)
})
test('another account can open history while the prior account deletion is pending', async () => {
  let owner='alice',state;const removal=deferred(),owners=[]
  const controller=history({getUser:()=>owner,loadPage:async()=>{owners.push(owner);return {sessions:[row(owner)],total:1,nextCursor:null}},onChange:value=>{state=value}})
  await controller.refresh();const clearing=controller.clear(()=>removal.promise)
  owner='bob';controller.reset();await controller.refresh()
  assert.deepEqual(owners,['alice','bob']);assert.equal(state.records[0].sessionId,'bob')
  removal.resolve();await clearing;assert.equal(state.records[0].sessionId,'bob')
})
