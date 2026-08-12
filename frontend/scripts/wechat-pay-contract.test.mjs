import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import test from 'node:test'
import { fileURLToPath } from 'node:url'

const scriptsDir = dirname(fileURLToPath(import.meta.url))
const frontendDir = resolve(scriptsDir, '..')
const repoDir = resolve(frontendDir, '..')

test('member purchase uses the server Native order flow and polls its status', () => {
  const adapter = readFileSync(resolve(scriptsDir, 'new-legacy-assets', 'direct-system-adapter.js'), 'utf8')
  const userCenter = readFileSync(resolve(repoDir, 'new-legacy/src/33-user-center.js'), 'utf8')
  const homePage = readFileSync(resolve(frontendDir, 'public/new-legacy/index.html'), 'utf8')

  assert.match(adapter, /\/api\/v1\/subscriptions\/orders/)
  assert.match(adapter, /createNativeOrder/)
  assert.match(adapter, /getNativeOrderStatus/)
  assert.match(adapter, /\/api\/v1\/subscriptions\/me/)
  assert.match(adapter, /syncSubscription/)
  assert.match(adapter, /function preloadPlans\(\)/)
  assert.match(adapter, /preloadPlans\(\)/)
  assert.match(adapter, /function isAuthenticated\(\)/)
  assert.match(adapter, /function isAdmin\(\)/)
  assert.match(userCenter, /await\s+pay\.createNativeOrder\(/)
  assert.match(userCenter, /nativeOrderQrCodeUrl/)
  assert.match(userCenter, /membershipCheckout/)
  assert.match(userCenter, /getNativeOrderStatus/)
  assert.match(userCenter, /pay\.syncSubscription\(latest\.subscription\)/)
  assert.match(userCenter, /renderOrderSubmitted\(plan,\s*\{order\}\)/)
  assert.match(userCenter, /window\.location\.href\s*=\s*['"]index\.html\?mode=free['"]/) 
  assert.ok(homePage.indexOf('src/32-wechat-login.js') < homePage.indexOf('direct-system-adapter.js'))
  assert.ok(homePage.indexOf('direct-system-adapter.js') < homePage.indexOf('src/33-user-center.js'))
})

test('member purchase offers a retryable payment failure instead of local approval fallback', () => {
  const userCenter = readFileSync(resolve(repoDir, 'new-legacy/src/33-user-center.js'), 'utf8')

  assert.match(userCenter, /支付二维码生成失败/)
  assert.match(userCenter, /card\.disabled=false;[\s\S]*card\.innerHTML=originalLabel/)
  assert.doesNotMatch(userCenter, /管理员确认后会自动生效/)
})

test('member purchase keeps the supplied membership-center visual structure around the real flow', () => {
  const userCenter = readFileSync(resolve(repoDir, 'new-legacy/src/33-user-center.js'), 'utf8')
  const membershipStyles = readFileSync(resolve(repoDir, 'new-legacy/styles/membership-ui.css'), 'utf8')

  assert.match(userCenter, /membership-ui/)
  assert.match(userCenter, /plans-grid/)
  assert.match(userCenter, /membership-checkout/)
  assert.match(userCenter, /qr-frame/)
  assert.match(userCenter, /nativeOrderQrCodeUrl/)
  assert.match(userCenter, /subscriptionRedeemCodeBtn/)
  assert.match(membershipStyles, /\.membership-ui\s+\.plans-grid/)
  assert.match(membershipStyles, /\.membership-ui\s+\.membership-checkout/)
  assert.match(membershipStyles, /\.membership-ui\s+\.membership-checkout\[hidden\]\{display:none/)
})

test('visitor plans are public, hand off to login cleanly, and create a Native order in one step', () => {
  const adapter = readFileSync(resolve(scriptsDir, 'new-legacy-assets', 'direct-system-adapter.js'), 'utf8')
  const userCenter = readFileSync(resolve(repoDir, 'new-legacy/src/33-user-center.js'), 'utf8')
  const membershipStyles = readFileSync(resolve(repoDir, 'new-legacy/styles/membership-ui.css'), 'utf8')

  assert.match(adapter, /\/api\/v1\/subscriptions\/plans/)
  assert.doesNotMatch(adapter, /request\('GET', '\/api\/v1\/system\/subscription-plans'\)/)
  assert.match(userCenter, /function requestAuthenticationForPlan\(plan\)[\s\S]*?closeSubscriptionDetailModal\(\)[\s\S]*?window\.authOpen/)
  assert.doesNotMatch(userCenter, /function renderPlanConfirm\(/)
  assert.match(userCenter, /async function handlePlanPick\(card\)[\s\S]*?await pay\.createNativeOrder\(plan\.id\)[\s\S]*?renderNativePayment\(plan,result\.order\)/)
  assert.match(membershipStyles, /\.membership-ui\s+\.plans-grid\{display:flex/)
  assert.match(membershipStyles, /overflow-x:auto/)
  assert.match(membershipStyles, /\.membership-ui\s+\.plan-card\{[^}]*flex:0 0/)
})

test('native payment keeps the membership plan carousel visible and expands a linked checkout below it', () => {
  const userCenter = readFileSync(resolve(repoDir, 'new-legacy/src/33-user-center.js'), 'utf8')
  const membershipStyles = readFileSync(resolve(repoDir, 'new-legacy/styles/membership-ui.css'), 'utf8')

  assert.match(userCenter, /class=["']membership-checkout["']/)
  assert.match(userCenter, /checkout-selected/)
  assert.match(userCenter, /membershipCheckout/)
  assert.match(membershipStyles, /\.membership-ui\s+\.membership-checkout\{/)
  assert.match(membershipStyles, /\.membership-ui\s+\.plan-card\.checkout-selected/)
})
