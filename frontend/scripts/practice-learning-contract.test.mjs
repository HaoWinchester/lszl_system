import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import test from 'node:test'

const root = resolve(import.meta.dirname, '..', '..')
const source = (path) => readFileSync(resolve(root, path), 'utf8')

test('P4.5 practice workflow renders revenge, remediation and verification controls', () => {
  const page = source('new-legacy/practice-mode.html')
  assert.match(page, /data-practice-start="revenge"/)
  assert.match(page, /id="practiceRemediationPanel"/)
  assert.match(page, /id="practiceVerificationBanner"/)
})

test('P4.5 practice workflow uses a database API adapter instead of a local mistake/history store', () => {
  const adapter = source('frontend/scripts/new-legacy-assets/practice-learning-adapter.js')
  const practice = source('new-legacy/src/100-practice-mode.js')
  assert.match(adapter, /\/api\/v1\/learning\/practice/)
  assert.match(adapter, /request\('\/sessions'/)
  assert.match(adapter, /async function answer\(input[^)]*\)/)
  assert.match(adapter, /request\('\/answers'/)
  assert.match(adapter, /async function verify\(mistakeId, input\)/)
  assert.match(practice, /KGPracticeLearningApi/)
  // Task 5：正常作答一律走本地草稿判题，不再逐题调用数据库答案路由
  assert.doesNotMatch(practice, /api\.answerSession\(/)
  assert.doesNotMatch(practice, /await api\.answer\(standardAnswerPayload\(question,optionId\)\)/)
  assert.doesNotMatch(practice, /kg_practice_mistakes_v1/)
  assert.doesNotMatch(practice, /kg_practice_history_v1/)
  assert.doesNotMatch(practice, /sessionStorage/)
  assert.doesNotMatch(practice, /localStorage/)
})

test('the release synchronizer injects the practice database adapter before the page behavior', () => {
  const sync = source('frontend/scripts/sync-new-legacy.js')
  assert.match(sync, /practice-learning-adapter\.js/)
  assert.match(sync, /kg-practice-learning:generated/)
})

test('practice adapter exposes the complete resumable session lifecycle', () => {
  const adapter = source('frontend/scripts/new-legacy-assets/practice-learning-adapter.js')
  for (const method of [
    'startSession', 'getActiveSessions', 'getSession', 'updateState',
    'answerSession', 'pauseSession', 'completeSession', 'abandonSession', 'getReport',
  ]) {
    assert.match(adapter, new RegExp(`async function ${method}\\(`), method)
  }
  for (const route of [
    "request('/sessions/start'",
    "request('/sessions/active'",
    "request(`/sessions/${encodeURIComponent(sessionId)}`",
    "request(`/sessions/${encodeURIComponent(sessionId)}/state`",
    "request(`/sessions/${encodeURIComponent(sessionId)}/answers`",
    "request(`/sessions/${encodeURIComponent(sessionId)}/pause`",
    "request(`/sessions/${encodeURIComponent(sessionId)}/complete`",
    "request(`/sessions/${encodeURIComponent(sessionId)}/abandon`",
    "request(`/sessions/${encodeURIComponent(sessionId)}/report`",
  ]) assert.ok(adapter.includes(route), route)
  assert.match(adapter, /credentials: 'include'/)
  assert.match(adapter, /error\.status = response\.status/)
  assert.match(adapter, /error\.detail = payload\?\.detail \|\| payload/)
  assert.match(adapter, /kg:auth-required/)
})

test('practice mode grades locally and only writes whole-paper payloads on explicit save or submit', () => {
  const practice = source('new-legacy/src/100-practice-mode.js')
  // 统一草稿控制器
  assert.match(practice, /KGPracticeDraftState\?\.create\(|KGPracticeDraftState\.create\(/)
  assert.match(practice, /state\.draft\.select\(/)
  // 正常作答/导航零写请求：删除逐题与索引写路由、autosave 与导航持久化
  assert.doesNotMatch(practice, /answerSession\(/)
  assert.doesNotMatch(practice, /persistCurrentIndex/)
  assert.doesNotMatch(practice, /startAutosave/)
  assert.doesNotMatch(practice, /\.updateState\(/)
  assert.doesNotMatch(practice, /recordMistake\(/)
  assert.doesNotMatch(practice, /\.answerRevenge\(/)
  // 显式保存与交卷都带整卷 answers + runtimeState
  assert.match(practice, /function submissionPayload\(\)/)
  assert.match(practice, /submissionPayload\(\)/)
  assert.match(practice, /\.\.\.payload/)
  // dirty 才提醒离开；成功保存/交卷 markSaved 清除
  assert.match(practice, /beforeunload/)
  assert.match(practice, /isDirty\?\.?\(\)/)
  assert.match(practice, /markSaved\(\)/)
})

test('session lifecycle sends keepalive only when explicitly requested', async () => {
  const { runInNewContext } = await import('node:vm')
  const calls=[]
  const window={addEventListener(){},fetch:async(url,options)=>{
    calls.push({url,options})
    return {ok:true,json:async()=>({session:{id:'s1'},report:{}})}
  }}
  runInNewContext(source('frontend/scripts/new-legacy-assets/practice-learning-adapter.js'),{window,URLSearchParams})
  for(const name of ['pauseSession','abandonSession','completeSession']){
    await window.KGPracticeLearningApi[name]('s1',{revision:1})
    await window.KGPracticeLearningApi[name]('s1',{revision:1},{keepalive:true})
  }
  assert.deepEqual(calls.map(call=>call.options.keepalive===true),[false,true,false,true,false,true])
  assert(calls.every(call=>call.options.credentials==='include'))
})

test('practice adapter exposes the server-deduplicated global revenge pool', async () => {
  const { runInNewContext } = await import('node:vm')
  const overview = {
    mistakes: [
      { id: 'release-copy', questionId: 'q1', status: 'pending', wrongCount: 4 },
      { id: 'history-copy', questionId: 'q1', status: 'needs_remediation', wrongCount: 2 },
    ],
    stats: { active: 2, pending: 1, needsRemediation: 1 },
    revengeStats: { active: 1, pending: 0, needsRemediation: 1, mastered: 0 },
    revengeCandidates: [
      { id: 'history-copy', mistakeId: 'history-copy', mistakeIds: ['history-copy', 'release-copy'], questionId: 'q1', status: 'needs_remediation' },
    ],
  }
  const window = {
    addEventListener() {},
    dispatchEvent() {},
    KGAuthCore: { currentUser: () => ({ username: 'student-1' }) },
    fetch: async () => ({ ok: true, json: async () => overview }),
  }
  runInNewContext(
    source('frontend/scripts/new-legacy-assets/practice-learning-adapter.js'),
    { window, URLSearchParams, CustomEvent: class CustomEvent {} },
  )
  await window.KGPracticeLearningApi.refresh()

  assert.equal(window.KGPracticeLearningApi.stats().active, 1)
  assert.deepEqual(
    JSON.parse(JSON.stringify(window.KGPracticeLearningApi.active())),
    overview.revengeCandidates,
  )
})
