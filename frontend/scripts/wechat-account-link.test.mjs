import test from 'node:test'
import assert from 'node:assert/strict'
import vm from 'node:vm'
import { readFileSync } from 'node:fs'
const read = path => readFileSync(new URL('../../' + path, import.meta.url), 'utf8')

test('registration is distinguished from ordinary and WeChat login at the shared event', () => {
  const core = read('new-legacy/src/29-auth-core.js')
  const register = core.slice(core.indexOf('async function register('), core.indexOf('async function logout('))
  assert.match(register, /notifyRemoteSession\(user.username,loginSessionId,previousLoginSessionId,'register'\)/)
  assert.match(core, /authenticationAction/)
})

function entryHarness() {
  const handlers = new Map(), calls = []
  let finishPrompt
  const window = {
    location: {search: ''}, document: {readyState:'loading', getElementById:()=>null},
    addEventListener: (name, fn) => handlers.set(name, fn), dispatchEvent() {},
    KGAuthCore: { currentUser: () => ({username:'a', role:'student'}) },
    KGAuthSessionBootstrap: { refresh: async () => ({user:{username:'a',role:'student'}}), load: async () => ({}) },
    KGLearningEntryChooser: { init: async () => {calls.push('chooser'); return {shown:true}} },
    KGWechatLogin: { promptBindingAfterRegister: () => {calls.push('prompt'); return new Promise(r=>{finishPrompt=r})}, waitForAccountFlow:async()=>{} },
  }
  vm.runInNewContext(read('frontend/scripts/new-legacy-assets/direct-entry.js'), {window, document:window.document, URLSearchParams, CustomEvent:class{}})
  return {handlers, calls, finish:()=>finishPrompt()}
}
const tick = () => new Promise(resolve=>setImmediate(resolve))
test('password registration waits for binding prompt before learning choice', async () => {
  const h = entryHarness()
  h.handlers.get('kg:auth-session-changed')({detail:{authenticated:true, authenticationAction:'register'}})
  await tick()
  assert.deepEqual(h.calls, ['prompt'])
  h.finish(); await tick()
  assert.deepEqual(h.calls, ['prompt','chooser'])
})
test('ordinary login does not prompt for binding', async () => {
  const h = entryHarness()
  h.handlers.get('kg:auth-session-changed')({detail:{authenticated:true}})
  await tick()
  assert.deepEqual(h.calls, ['chooser'])
})
test('shared WeChat module supplies real server account choice and recovery', () => {
  const wx=read('new-legacy/src/32-wechat-login.js')
  assert.match(wx, /\/api\/v1\/auth\/wechat\/account/)
  assert.match(wx, /promptBindingAfterRegister/)
  assert.match(wx, /绑定已有账号/)
  assert.match(wx, /我是新用户/)
  assert.match(read('new-legacy/src/33-user-center.js'), /找回原账号会员/)
})
