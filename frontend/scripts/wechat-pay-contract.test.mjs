import assert from 'node:assert/strict'
import { readFileSync, readdirSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import test from 'node:test'
import { fileURLToPath } from 'node:url'

const scriptsDir = dirname(fileURLToPath(import.meta.url))
const frontendDir = resolve(scriptsDir, '..')
const repoDir = resolve(frontendDir, '..')

test('member purchase uses the server Native order flow and polls its status', () => {
  const adapter = readFileSync(resolve(scriptsDir, 'new-legacy-assets', 'direct-system-adapter.js'), 'utf8')
  const userCenter = readFileSync(resolve(repoDir, 'new-legacy/src/33-user-center.js'), 'utf8')
  const homeShell = readFileSync(resolve(frontendDir, 'public/new-legacy/bundles/home-shell.js'), 'utf8')
  const homeSecondary = readFileSync(resolve(frontendDir, 'public/new-legacy/bundles/home-secondary.js'), 'utf8')
  const bundlePlan = JSON.parse(readFileSync(resolve(scriptsDir, 'homepage-bundles.json'), 'utf8'))

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
  assert.match(homeShell, /src\/32-wechat-login\.js/)
  assert.ok(bundlePlan.groups.findIndex(group => group.name === 'home-shell') < bundlePlan.groups.findIndex(group => group.name === 'home-secondary'))
  assert.ok(homeSecondary.indexOf('direct-system-adapter.js') < homeSecondary.indexOf('src/33-user-center.js'))
})

test('practice mode loads the system adapter between wechat login and user center scripts', () => {
  const practicePage = readFileSync(resolve(frontendDir, 'public/new-legacy/practice-mode.html'), 'utf8')

  assert.ok(practicePage.indexOf('src/32-wechat-login.js') < practicePage.indexOf('direct-system-adapter.js'))
  assert.ok(practicePage.indexOf('direct-system-adapter.js') < practicePage.indexOf('src/33-user-center.js'))
})

test('every page loading user center gets the system adapter before it', () => {
  const siteDir = resolve(frontendDir, 'public/new-legacy')
  const pages = readdirSync(siteDir).filter(name => name.endsWith('.html'))
  const offenders = []
  for (const name of pages) {
    const html = readFileSync(resolve(siteDir, name), 'utf8')
    const userCenterAt = html.indexOf('src/33-user-center.js')
    if (userCenterAt < 0) continue
    const adapterAt = html.indexOf('direct-system-adapter.js')
    if (adapterAt < 0 || adapterAt > userCenterAt) offenders.push(name)
  }
  assert.deepEqual(offenders, [], `以下页面缺少 direct-system-adapter 或顺序错误：${offenders.join(', ')}`)
})

test('member purchase offers a retryable payment failure instead of local approval fallback', () => {
  const userCenter = readFileSync(resolve(repoDir, 'new-legacy/src/33-user-center.js'), 'utf8')

  assert.match(userCenter, /支付二维码生成失败/)
  assert.match(userCenter, /setPlanPickLocked\(false\);[\s\S]*card\.innerHTML=originalLabel/)
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
  assert.match(userCenter, /async function handlePlanPick\(card\)[\s\S]*?await pay\.createNativeOrder\(plan\.id\)[\s\S]*?renderNativePayment\(checkoutPlan\|\|plan,order\)/)
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

test('native payment enlarges the QR code and removes the manual later, cancel, and status controls', () => {
  const userCenter = readFileSync(resolve(repoDir, 'new-legacy/src/33-user-center.js'), 'utf8')
  const membershipStyles = readFileSync(resolve(repoDir, 'new-legacy/styles/membership-ui.css'), 'utf8')

  assert.doesNotMatch(userCenter, /nativePayRefreshBtn|nativePayCancelOrderBtn|nativePayCloseBtn/)
  assert.match(userCenter, /function setPlanPickLocked\(locked\)\{/)
  assert.match(userCenter, /setPlanPickLocked\(true\)/)
  assert.match(membershipStyles, /\.membership-ui\s+\.checkout-qr\s+\.qr-frame\{width:220px/)
  assert.match(membershipStyles, /\.membership-ui\s+\.checkout-help\{[^}]*font-size:11px/)
})

test('every plan pick orders the selected plan fresh; the server cancels stale pending orders', () => {
  const userCenter = readFileSync(resolve(repoDir, 'new-legacy/src/33-user-center.js'), 'utf8')
  const subscriptionService = readFileSync(resolve(repoDir, 'backend/app/services/subscription_service.py'), 'utf8')

  // 前端不再做“取消旧单再重试”的补救；二维码生成后解锁套餐按钮，可随时换套餐重新下单
  assert.doesNotMatch(userCenter, /pay\.cancelNativeOrder\(order\.id\)/)
  assert.match(userCenter, /if\(activeNativeOrder&&activeNativeOrder\.planId===planId\)\{renderNativePayment\(plan,activeNativeOrder\);return\}/)
  assert.match(userCenter, /const order=result\.order;/)
  // 服务端不复用待支付订单：每次请求作废旧待支付订单并按当前套餐新下单
  assert.match(subscriptionService, /已发起新的支付订单，原待支付订单自动作废/)
  assert.doesNotMatch(subscriptionService, /if pending is not None:\n        return pending/)
})

test('membership card price and payment amount use the server paymentAmountFen source', () => {
  const planModule = readFileSync(resolve(repoDir, 'new-legacy/src/37-subscription-plans.js'), 'utf8')
  const settings = readFileSync(resolve(repoDir, 'new-legacy/src/36-system-settings.js'), 'utf8')
  const subscriptionService = readFileSync(resolve(repoDir, 'backend/app/services/subscription_service.py'), 'utf8')
  const systemService = readFileSync(resolve(repoDir, 'backend/app/services/system_service.py'), 'utf8')

  assert.match(planModule, /formatPaymentAmountFen\(merged\.paymentAmountFen\)/)
  assert.match(planModule, /priceText:serverPrice \|\| autoPrice \|\| merged\.priceText/)
  assert.match(settings, /data-plan-field="paymentAmountFen"/)
  assert.match(subscriptionService, /await system_service\.get_subscription_plans\(db\)/)
  assert.match(subscriptionService, /amount_fen = p\["paymentAmountFen"\]/)
  assert.match(systemService, /merged\["priceText"\] = format_payment_amount_fen\(merged\["paymentAmountFen"\]\)/)
})
