import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import test from 'node:test'

const frontend = resolve(import.meta.dirname, '..')
const repo = resolve(frontend, '..')
const readSource = (path) => readFileSync(resolve(repo, path), 'utf8')

test('wechat login starts OAuth at the backend and never exchanges codes in the browser', () => {
  const source = readSource('new-legacy/src/32-wechat-login.js')

  assert.match(source, /\/api\/v1\/auth\/wechat\/auth-url/)
  assert.match(source, /credentials:\s*['"]include['"]/)
  assert.doesNotMatch(source, /backendExchangeUrl/)
  assert.doesNotMatch(source, /WECHAT_PENDING_KEY/)
  assert.doesNotMatch(source, /completeLogin\s*\(/)
  assert.match(source, /\/api\/v1\/auth\/wechat\/config/)
  assert.doesNotMatch(source, /kg_wechat_login_config_v1/)
  assert.doesNotMatch(source, /localStorage/)
})

test('system adapter keeps WeChat login and payment without the legacy runtime storage', () => {
  const source = readSource('frontend/scripts/new-legacy-assets/direct-system-adapter.js')

  assert.doesNotMatch(source, new RegExp(['KGServerState', 'Storage'].join('')))
  assert.doesNotMatch(source, /kg_wechat_login_config_v1/)
  assert.match(source, /\/api\/v1\/system\/wechat-config/)
  assert.match(source, /KGWechatPay/)
})

test('login modal embeds the official QR code below the login button', () => {
  const source = readSource('new-legacy/src/32-wechat-login.js')

  assert.match(source, /class="wechat-login-entry" type="button">微信扫码登录<\/button><div class="wechat-login-panel" hidden><\/div>/)
  assert.match(source, /new window\.WxLogin\(\{[\s\S]*?self_redirect:false/)
  assert.match(source, /entry\.onclick=\(\)=>\{[\s\S]*?requireLegalConsent[\s\S]*?setWechatLoginMode\(modal,true\);panel\.hidden=false;renderPanel\(panel\)/)
  assert.match(source, /accepted_terms_version/)
  assert.doesNotMatch(source, /模拟扫码成功/)
  assert.doesNotMatch(source, /wechat-pseudo-qr/)
})

test('wechat scan mode hides password controls and offers a return action', () => {
  const source = readSource('new-legacy/src/32-wechat-login.js')
  const styles = readSource('new-legacy/styles/main.css')

  assert.match(source, /function setWechatLoginMode\(modal,enabled\)/)
  assert.match(source, /modal\.classList\.toggle\('wechat-login-mode',!!enabled\)/)
  assert.match(source, /setWechatLoginMode\(modal,true\)/)
  assert.match(source, /使用账号密码登录/)
  assert.match(source, /setWechatLoginMode\(modal,false\)/)
  assert.match(styles, /#authModal\.wechat-login-mode \.auth-actions/)
})

test('embedded official WeChat login stays comfortably within a short viewport', () => {
  const styles = readSource('new-legacy/styles/main.css')

  assert.match(styles, /\.wechat-login-qr\{height:320px;/)
  assert.match(styles, /\.wechat-login-qr iframe\{transform:scale\(\.8\)/)
  assert.match(styles, /\.wechat-login-back\{display:inline-flex;/)
})

test('user center offers server-backed WeChat binding and unbinding', () => {
  const source = readSource('new-legacy/src/33-user-center.js')
  const login = readSource('new-legacy/src/32-wechat-login.js')

  assert.match(source, /startOfficialLogin\(['"]bind['"]\)/)
  assert.match(source, /api\.unbind\(\)/)
  assert.match(login, /\/api\/v1\/auth\/wechat\/binding/)
  assert.match(login, /method:\s*['"]DELETE['"]/)
})

test('system settings do not expose an obsolete browser code-exchange setting', () => {
  const source = readSource('new-legacy/src/36-system-settings.js')

  assert.doesNotMatch(source, /wxBackendExchangeUrl/)
  assert.doesNotMatch(source, /backendExchangeUrl/)
  assert.doesNotMatch(source, /buildOfficialAuthUrl/)
  assert.match(source, /createOfficialAuthRequest\('login',[\s\S]*?legalConsentVersion/)
})
