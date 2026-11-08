import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import test from 'node:test'
import vm from 'node:vm'

const sourceRoot = resolve(import.meta.dirname, '../../new-legacy/src')

function membershipCenter({ planId, status = 'active', expired = true, failFirst = false, createOrder }) {
  const user = { username: 'renewal-student', role: 'student', status: 'active' }
  const requests = []
  const messages = []
  const buttons = new Map()
  const elements = new Map()
  const classList = { add() {}, remove() {}, toggle() {}, contains() { return false } }
  const upgradeEntries = [{ hidden: false, textContent: '升级会员' }, { hidden: false, textContent: '升级会员' }]
  for (const id of ['ucUsername', 'ucDisplayName', 'ucEmail', 'ucPhone', 'ucSubject', 'ucTags', 'ucNote', 'ucNoteCount', 'ucRoleChip', 'ucStatusChip', 'ucCurrentPassword', 'ucNewPassword', 'ucConfirmPassword', 'ucPasswordHelp', 'userCenterAvatar', 'userCenterMsg']) {
    elements.set(id, { value: '', textContent: '', classList, closest() { return { hidden: false } } })
  }
  elements.set('userCenterModal', { classList })
  elements.set('ucSubscriptionBox', {
    set innerHTML(html) {
      elements.delete('ucSubscriptionRenewBtn')
      const match = html.match(/<button[^>]*id="ucSubscriptionRenewBtn"[^>]*>[\s\S]*?<\/button>/)
      if (!match) return
      const handlers = new Map()
      elements.set('ucSubscriptionRenewBtn', {
        innerHTML: match[0],
        addEventListener(type, handler) { handlers.set(type, handler) },
        async click() { handlers.get('click')?.(); await new Promise(setImmediate) },
      })
    },
  })
  const body = {
    html: '',
    set innerHTML(html) {
      this.html = html
      buttons.clear()
      for (const match of html.matchAll(/<article\b[^>]*data-plan-id="([^"]+)"[\s\S]*?<\/article>/g)) {
        const markup = match[0].match(/<button[\s\S]*?<\/button>/)[0]
        const handlers = new Map()
        buttons.set(match[1], {
          disabled: / disabled/.test(markup),
          dataset: markup.includes('data-buy-plan=') ? { buyPlan: match[1] } : {},
          innerHTML: markup,
          setAttribute() {},
          addEventListener(type, handler) { handlers.set(type, handler) },
          async click() {
            if (!this.disabled) {
              handlers.get('click')?.()
              await new Promise(setImmediate)
            }
          },
        })
      }
      elements.set('membershipCheckout', { hidden: true, innerHTML: '' })
      elements.set('nativePayStatus', { textContent: '' })
      if (html.includes('id="membershipPaymentMsg"')) elements.set('membershipPaymentMsg', { hidden: true, textContent: '' })
    },
    get innerHTML() { return this.html },
    querySelectorAll(selector) {
      if (selector === '[data-buy-plan]') return [...buttons.values()].filter(button => button.dataset.buyPlan)
      return []
    },
  }
  elements.set('userSubscriptionDetailBody', body)
  elements.set('userSubscriptionDetailModal', { classList })
  const document = {
    readyState: 'loading',
    addEventListener() {},
    querySelector() { return null },
    getElementById(id) { return elements.get(id) || null },
  }
  const window = {
    addEventListener() {},
    showStatus(message) { messages.push(message) },
    KGAuthCore: { escapeHTML: String, currentUsername: () => user.username, currentUser: () => user },
    KGRolePermissions: { currentRole: () => user.role },
    KGWechatPay: {
      async createNativeOrder(selectedPlanId) {
        requests.push(selectedPlanId)
        if (createOrder) return createOrder(selectedPlanId)
        if (failFirst && requests.length === 1) throw new Error('暂时无法下单')
        return { order: { id: 'new-renewal-order', planId: selectedPlanId, codeUrl: 'weixin://test-qr', amount: 2990 } }
      },
      nativeOrderQrCodeUrl: id => `/api/v1/subscriptions/orders/${id}/qrcode`,
      async getNativeOrderStatus() { return { payStatus: 'pending', status: 'pending' } },
    },
  }
  const context = vm.createContext({ window, document, console, setInterval: () => 1, clearInterval() {}, setTimeout: () => 1 })
  for (const name of ['37-subscription-plans', '37-subscription-orders', '37-subscription-redeem-codes', '37-subscription-core', '33-user-center']) {
    vm.runInContext(readFileSync(resolve(sourceRoot, `${name}.js`), 'utf8'), context)
  }
  window.KGSubscription.hydrateSubscriptions({ [user.username]: {
    username: user.username, planId, status,
    expiresAt: Date.now() + (expired ? -1 : 1) * 86_400_000,
  } })
  window.KGUserCenter.openSubscriptionDetail()
  return { window, user, buttons, requests, messages, upgradeEntries,
    get profileRenewButton() { return elements.get('ucSubscriptionRenewBtn') },
    get checkout() { return elements.get('membershipCheckout') },
    get paymentMessage() { return elements.get('membershipPaymentMsg') },
    decorateUpgradeEntries() {
      window.KGSubscription.decorateSubscriptionElements({
        querySelector: () => null,
        querySelectorAll: selector => selector.includes('#upgradeMemberBtn') ? upgradeEntries : [],
      })
    },
  }
}

for (const planId of ['monthly', 'quarterly', 'half_year']) {
  for (const status of ['active', 'expired']) {
    test(`expired ${planId} (${status} record) can purchase the same plan and display checkout`, async () => {
      const ui = membershipCenter({ planId, status })
      const button = ui.buttons.get(planId)
      assert.equal(button.disabled, false, 'expired membership must not disable its original plan')
      await button.click()
      assert.deepEqual(ui.requests, [planId], 'checkout must order the chosen plan')
      assert.equal(ui.checkout.hidden, false)
      assert.match(ui.checkout.innerHTML, /\/api\/v1\/subscriptions\/orders\/new-renewal-order\/qrcode/)
      assert.equal(ui.window.KGSubscription.subscriptionSummary(ui.user.username).subscription.status, 'expired', 'creating an unpaid order must not grant membership')
    })
  }

  test(`active ${planId} can renew the same plan without changing its unpaid expiry`, async () => {
    const ui = membershipCenter({ planId, expired: false })
    const before = ui.window.KGSubscription.subscriptionSummary(ui.user.username).subscription
    assert.equal(ui.buttons.get(planId).disabled, false, 'valid finite memberships must allow advance renewal')
    assert.match(ui.buttons.get(planId).innerHTML, /续费该方案/)
    await ui.buttons.get(planId).click()
    assert.deepEqual(ui.requests, [planId])
    assert.equal(ui.checkout.hidden, false)
    const after = ui.window.KGSubscription.subscriptionSummary(ui.user.username).subscription
    assert.equal(after.status, 'active')
    assert.equal(after.expiresAt, before.expiresAt, 'an unpaid renewal must preserve remaining membership time')
  })

  test(`active ${planId} can reach renewal through its user center`, async () => {
    const ui = membershipCenter({ planId, expired: false })
    ui.window.KGUserCenter.open()
    assert.ok(ui.profileRenewButton, 'valid finite membership must keep a visible user-center renewal entry')
    assert.match(ui.profileRenewButton.innerHTML, /续费会员/)
    await ui.profileRenewButton.click()
    await ui.buttons.get(planId).click()
    assert.deepEqual(ui.requests, [planId])
    assert.equal(ui.checkout.hidden, false)
  })

  test(`active ${planId} keeps toolbar and account-menu renewal entries available`, () => {
    const ui = membershipCenter({ planId, expired: false })
    ui.decorateUpgradeEntries()
    for (const entry of ui.upgradeEntries) {
      assert.equal(entry.hidden, false, 'valid finite membership must not lose its renewal navigation')
      assert.equal(entry.textContent, '续费会员')
    }
  })
}

for (const expired of [true, false]) {
test(`${expired ? 'expired' : 'active'} same-plan checkout unlocks after failure and can retry`, async () => {
  const ui = membershipCenter({ planId: 'monthly', expired, failFirst: true })
  const button = ui.buttons.get('monthly')
  await button.click()
  assert.deepEqual(ui.requests, ['monthly'])
  assert.equal(button.disabled, false)
  assert.equal(ui.checkout.hidden, true)
  assert.ok(ui.messages.includes('暂时无法下单'))
  assert.ok(ui.paymentMessage, 'payment failures must remain visible inside the membership dialog even without a page toast')
  assert.equal(ui.paymentMessage.hidden, false)
  assert.equal(ui.paymentMessage.textContent, '暂时无法下单')
  await button.click()
  assert.deepEqual(ui.requests, ['monthly', 'monthly'])
  assert.equal(ui.checkout.hidden, false)
  assert.equal(ui.paymentMessage.hidden, true, 'retry must clear the stale payment error')
})
}

for (const planId of ['free', 'lifetime']) {
  test(`${planId} membership retains its non-purchasable same-plan button`, async () => {
    const ui = membershipCenter({ planId })
    assert.equal(ui.buttons.get(planId).disabled, true)
    await ui.buttons.get(planId).click()
    assert.deepEqual(ui.requests, [])
    ui.window.KGUserCenter.open()
    assert.equal(Boolean(ui.profileRenewButton), planId === 'free')
    ui.decorateUpgradeEntries()
    assert.ok(ui.upgradeEntries.every(entry => entry.hidden === (planId === 'lifetime')))
  })
}

for (const status of ['paused', 'cancelled']) {
  test(`${status} membership preserves its unavailable current-plan button`, async () => {
    const ui = membershipCenter({ planId: 'monthly', status, expired: false })
    assert.equal(ui.buttons.get('monthly').disabled, true)
    await ui.buttons.get('monthly').click()
    assert.deepEqual(ui.requests, [])
  })
}

test('a failed request from a reopened membership dialog cannot change the new dialog', async () => {
  let rejectOrder
  const pending = new Promise((_, reject) => { rejectOrder = reject })
  const ui = membershipCenter({ planId: 'monthly', createOrder: () => pending })
  const click = ui.buttons.get('monthly').click()
  const previousMessage = ui.paymentMessage
  ui.window.KGUserCenter.closeSubscriptionDetail()
  ui.window.KGUserCenter.openSubscriptionDetail()
  rejectOrder(new Error('旧请求失败'))
  await click
  assert.equal(ui.paymentMessage.hidden, true)
  assert.equal(ui.buttons.get('monthly').disabled, false)
  assert.equal(previousMessage.hidden, true, 'ignore stale requests instead of updating detached dialog nodes')
  assert.deepEqual(ui.messages, [], 'a stale request must not report a failure in a newer dialog')
})
