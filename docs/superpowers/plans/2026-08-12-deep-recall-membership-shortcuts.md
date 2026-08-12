# Deep Recall, Membership, and Shortcut Visibility Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Restore deep-recall canvas search, make visitor membership conversion safe and useful, remove the redundant payment-confirmation step, and keep global shortcuts visible across canvas changes.

**Architecture:** Keep teaching content and payment state server-owned. The existing static `new-legacy` source supplies page structure and behavior; the direct runtime adapter remains the only browser-to-FastAPI bridge. Browser state is limited to the existing non-business shortcut layout/position preference; subscription plans and orders continue to come from PostgreSQL APIs.

**Tech Stack:** Vanilla JavaScript and CSS in `new-legacy`, FastAPI/PostgreSQL subscription APIs, Node contract tests, Playwright browser regression.

## Global Constraints

- Do not modify `legacy/` or hand-copy an active release.
- Preserve upstream DOM/class names; ship through `frontend/scripts/manage-new-legacy.js update` only.
- Plans, orders, subscriptions, and payments are API/PostgreSQL owned; no business state in browser storage.
- A visitor must authenticate before a paid order is requested.
- Homepage learning-entry, onboarding, simple/professional knowledge editing, and help-entry exclusions remain excluded.

---

### Task 1: Restore deep-recall canvas node search

**Files:**
- Modify: `new-legacy/knowledge-recall.html`
- Modify: `new-legacy/src/86-knowledge-recall.js`
- Copy/adapt: `updata-legacy/styles/knowledge-recall-p4517.css`
- Copy/adapt: `updata-legacy/styles/knowledge-recall-p4519.css`
- Copy/adapt: `updata-legacy/styles/knowledge-recall-p4520.css`
- Copy/adapt: `updata-legacy/styles/knowledge-recall-p4526.css`
- Test: `frontend/scripts/online-qa-regressions.test.mjs`

**Interfaces:**
- Consumes: recall `state.nodes`, `centerOn(x, y, animate)`, and the existing `bindNodeInteractions()` lifecycle.
- Produces: `openNodeSearch()`, `closeNodeSearch()`, `renderNodeSearchResults(query)`, and keyboard-accessible `#krNodeSearchPanel`.

- [ ] **Step 1: Write failing static/runtime contract tests**

```js
assert.match(recallPage, /id="krNodeSearchBtn"/)
assert.match(recallPage, /id="krNodeSearchInput"/)
assert.match(recallRuntime, /function renderNodeSearchResults/)
assert.match(recallRuntime, /bindNodeSearch\(\)/)
```

- [ ] **Step 2: Run focused test and verify RED**

Run: `cd frontend && node --test scripts/online-qa-regressions.test.mjs`

Expected: fail because the current page has no `krNodeSearchBtn` and the runtime has no node-search binding.

- [ ] **Step 3: Restore the audited search DOM, styles, and behavior**

```js
function renderNodeSearchResults(query = '') {
  const rows = state.nodes.map(nodeSearchRecord)
    .filter(row => row.haystack.includes(normalizeSearch(query)))
  // Selecting a row closes the panel and centers the exact node instance.
}
```

Include only the deep-recall search button/panel, source-specific CSS, and the existing update-source search behavior; do not copy unrelated onboarding, app-shell, or local-persistence modules.

- [ ] **Step 4: Run focused test and verify GREEN**

Run: `cd frontend && node --test scripts/online-qa-regressions.test.mjs`

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add new-legacy/knowledge-recall.html new-legacy/src/86-knowledge-recall.js new-legacy/styles/knowledge-recall-p4517.css new-legacy/styles/knowledge-recall-p4519.css new-legacy/styles/knowledge-recall-p4520.css new-legacy/styles/knowledge-recall-p4526.css frontend/scripts/online-qa-regressions.test.mjs
git commit -m "feat: restore deep recall canvas search"
```

### Task 2: Make visitor membership plans and authentication handoff correct

**Files:**
- Modify: `frontend/scripts/new-legacy-assets/direct-system-adapter.js`
- Modify: `new-legacy/src/33-user-center.js`
- Modify: `new-legacy/styles/subscription.css`
- Test: `frontend/scripts/direct-runtime.test.mjs`
- Test: `frontend/e2e/membership_center_visual.py`

**Interfaces:**
- Consumes: public `GET /api/v1/subscriptions/plans`, `window.authOpen(reason)`, and `window.KGUserCenter.closeSubscriptionDetail()`.
- Produces: visible plans sourced from the API for visitors and `requestAuthenticationForPlan(planId)` that closes the membership modal before opening auth.

- [ ] **Step 1: Write failing contracts for public plans and modal handoff**

```js
assert.match(adapter, /\/api\/v1\/subscriptions\/plans/)
assert.match(userCenter, /closeSubscriptionDetailModal\(\).*authOpen/s)
assert.doesNotMatch(visitorPlanRendering, /待配置/)
```

- [ ] **Step 2: Run focused tests and verify RED**

Run: `cd frontend && node --test scripts/direct-runtime.test.mjs`

Expected: fail because plans preload from the authenticated system route and paid visitor selection leaves the membership modal open.

- [ ] **Step 3: Use public plans and serialise the visitor-to-login transition**

```js
async function requestAuthenticationForPlan(plan) {
  closeSubscriptionDetailModal()
  window.authOpen(`登录后即可开通${plan.name}。`)
}
```

Use the server-returned plan fields as the display model. On an unavailable plans request, show a specific retry surface rather than inventing a price; do not call `createNativeOrder` for a visitor.

- [ ] **Step 4: Add a browser regression**

```python
page.locator('[data-buy-plan="monthly"]').click()
expect(page.locator('#userSubscriptionDetailModal')).to_be_hidden()
expect(page.locator('#authModal.show')).to_be_visible()
```

- [ ] **Step 5: Run focused contracts and browser regression**

Run: `cd frontend && node --test scripts/direct-runtime.test.mjs && python3 e2e/membership_center_visual.py`

Expected: PASS; the visitor sees database-configured display copy and one visible modal.

- [ ] **Step 6: Commit**

```bash
git add frontend/scripts/new-legacy-assets/direct-system-adapter.js new-legacy/src/33-user-center.js new-legacy/styles/subscription.css frontend/scripts/direct-runtime.test.mjs frontend/e2e/membership_center_visual.py
git commit -m "fix: route visitor membership selection to login"
```

### Task 3: Remove the redundant payment confirmation step

**Files:**
- Modify: `new-legacy/src/33-user-center.js`
- Modify: `new-legacy/styles/subscription.css`
- Test: `frontend/scripts/wechat-pay-contract.test.mjs`
- Test: `frontend/e2e/membership_center_visual.py`

**Interfaces:**
- Consumes: `window.KGWechatPay.createNativeOrder(planId)`, `getNativeOrderStatus(orderId)`, and `cancelNativeOrder(orderId)`.
- Produces: `handlePlanPick(card)` that starts the backend order immediately for an authenticated student and then calls `renderNativePayment(plan, order)`.

- [ ] **Step 1: Write failing one-step payment tests**

```js
assert.doesNotMatch(userCenter, /确认订阅申请/)
assert.match(userCenter, /await pay\.createNativeOrder\(plan\.id\)/)
assert.ok(userCenter.indexOf('createNativeOrder(plan.id)') < userCenter.indexOf('renderNativePayment(plan,result.order)'))
```

- [ ] **Step 2: Run focused test and verify RED**

Run: `cd frontend && node --test scripts/wechat-pay-contract.test.mjs`

Expected: fail because plan selection currently renders a confirmation page and requires a second click.

- [ ] **Step 3: Replace confirmation with a guarded immediate order request**

```js
async function handlePlanPick(card) {
  if (role === 'guest' || role === 'viewer') return requestAuthenticationForPlan(plan)
  setPlanCardBusy(card, true)
  const result = await pay.createNativeOrder(plan.id)
  renderNativePayment(plan, result.order)
}
```

Preserve backend order amount, QR creation, polling, cancellation, error/retry text, and paid-subscription refresh. The UI must never treat a client-side plan as paid without the server order response.

- [ ] **Step 4: Run focused contract and browser regression**

Run: `cd frontend && node --test scripts/wechat-pay-contract.test.mjs && python3 e2e/membership_center_visual.py`

Expected: PASS; a student sees the QR immediately after selecting a paid plan.

- [ ] **Step 5: Commit**

```bash
git add new-legacy/src/33-user-center.js new-legacy/styles/subscription.css frontend/scripts/wechat-pay-contract.test.mjs frontend/e2e/membership_center_visual.py
git commit -m "feat: simplify membership payment to one step"
```

### Task 4: Keep global shortcuts expanded and visible on multi-canvas changes

**Files:**
- Modify: `new-legacy/src/39-global-shortcuts.js`
- Modify: `new-legacy/styles/global-shortcuts.css`
- Test: `frontend/scripts/online-qa-regressions.test.mjs`
- Test: `frontend/e2e/new_legacy_smoke.py`

**Interfaces:**
- Consumes: existing shortcut position/layout transient preference and page `kg-role-theme-change` refresh event.
- Produces: always-expanded shortcut rendering across pages; `#kgGlobalShortcuts` with deep-slate surface and orange action toggle in desktop multi-question workspace.

- [ ] **Step 1: Write failing shortcut visibility and visual contract tests**

```js
assert.doesNotMatch(shortcuts, /shouldStartCollapsed/)
assert.doesNotMatch(shortcuts, /setCollapsed\(el,/)
assert.match(shortcutCss, /#1f2937/)
assert.match(shortcutCss, /#f97316/)
```

- [ ] **Step 2: Run focused test and verify RED**

Run: `cd frontend && node --test scripts/online-qa-regressions.test.mjs`

Expected: fail because every non-home page currently starts collapsed and the surface is translucent white.

- [ ] **Step 3: Remove automatic collapse and add high-contrast styling**

```js
document.body.appendChild(el)
applyLayout(el, layout)
applySavedPosition(el)
```

Keep manual layout choice and drag position only. Do not store a separate business preference. Desktop global shortcut container uses `#1f2937`; its layout toggle uses `#f97316` with accessible focus/hover contrast.

- [ ] **Step 4: Add browser assertions for the multi-question workspace**

```python
page.goto(BASE + '/question-workspace.html')
expect(page.locator('#kgGlobalShortcuts')).not_to_have_class(re.compile('is-collapsed'))
expect(page.locator('#kgGlobalShortcuts .kg-global-shortcuts-body')).to_be_visible()
```

- [ ] **Step 5: Run focused tests and commit**

Run: `cd frontend && node --test scripts/online-qa-regressions.test.mjs && python3 e2e/new_legacy_smoke.py`

Expected: PASS.

```bash
git add new-legacy/src/39-global-shortcuts.js new-legacy/styles/global-shortcuts.css frontend/scripts/online-qa-regressions.test.mjs frontend/e2e/new_legacy_smoke.py
git commit -m "fix: keep global shortcuts visible on canvases"
```

### Task 5: Integrated validation and managed release

**Files:**
- Modify: `new-legacy/VERSION`
- Generated: `frontend/public/new-legacy/**`, `frontend/new-legacy-manifest.json`, `frontend/new-legacy-sync-report.json`, `backend/app/seed/guided_course_v8_6_0.json`

- [ ] **Step 1: Run code and API validation**

Run:

```bash
cd backend && .venv/bin/python -m pytest tests/ -q
cd frontend && pnpm test
```

Expected: 0 failures.

- [ ] **Step 2: Run managed release validation**

Run: `node frontend/scripts/manage-new-legacy.js update new-legacy`

Expected: candidate file count is not below active release; candidate tests, smoke, payment/member, and visual checks pass before atomic promotion.

- [ ] **Step 3: Deploy only after promotion and validate production**

Run:

```bash
./deploy/update.sh
curl -fsS https://lszl.aihuanpu.com/api/v1/health
```

Expected: health response includes `"status":"ok"` and `"db":"ok"`.

- [ ] **Step 4: Commit generated deployment assets and push `main`**

```bash
git add new-legacy/VERSION frontend/public/new-legacy frontend/new-legacy-manifest.json frontend/new-legacy-sync-report.json backend/app/seed/guided_course_v8_6_0.json
git commit -m "chore: sync next release deployment assets"
git push origin main
```

## Plan Self-Review

- Coverage: Tasks 1–4 each cover one requested user-visible defect; Task 5 covers release and production verification.
- Data ownership: Tasks 2–3 use only existing FastAPI subscription plans/orders endpoints; no business browser storage is introduced.
- Exclusions: no homepage learning entries, onboarding, simple/professional knowledge edit, or help-entry migration task appears.
- Test alignment: every functional change has a RED/GREEN contract; visitor and student browser paths include modal, payment, and retry/visibility assertions.
