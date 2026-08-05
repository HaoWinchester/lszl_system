# Global Typography Foundation Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Establish one fixed-rem typography system for the current Focus / Vega pages before any remaining page-family UI work begins.

**Architecture:** Add a token-only typography stylesheet that is safe to load on explicitly opted-in pages. Existing admin and practice-mode adapters consume the tokens through scoped selectors; no global element rule is allowed to reach the graph page, authentication, account-menu internals, membership surfaces, or protected canvases.

**Tech Stack:** Native HTML/CSS/JavaScript, Node test runner, Playwright Python, local static release pipeline.

## Global Constraints

- Do not modify `new-legacy/index.html` or any graph-page asset.
- Do not modify `#authModal`, account-menu internals, `.subscription-*`, `.membership-*`, `.payment-*`, or `.wechat-pay-*`.
- Do not change routes, business scripts, API calls, storage, permissions, or DOM order.
- Use fixed `rem` values and weights `400 / 500 / 600 / 700`; visible non-frozen text must not be below `0.75rem`.
- Verify `1440 × 900`, `1366 × 768`, `1024 × 768`, and browser zoom at `200%`.
- Source changes belong in `new-legacy/`; synchronize generated output with `frontend/scripts/sync-new-legacy.js`; do not publish or promote.

---

### Task 1: Lock the typography contract

**Files:**
- Create: `new-legacy/tests/focus-vega-typography-contract.test.js`
- Test: `new-legacy/tests/focus-vega-typography-contract.test.js`

**Interfaces:**
- Consumes: approved tokens and frozen selectors from `docs/superpowers/specs/2026-08-05-global-typography-and-remaining-focus-vega-ui-design.md`.
- Produces: static checks for stylesheet loading, token values, weight limits, graph exclusion, and frozen-surface isolation.

- [ ] **Step 1: Write the failing static contract**

Create a Node test that reads source files directly. The core assertions are:

```js
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import test from 'node:test'

const ROOT = resolve(import.meta.dirname, '..')
const source = (path) => readFileSync(resolve(ROOT, path), 'utf8')
const compact = (value) => value.replace(/\s+/g, '')
const escapeRegExp = (value) => value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')

const CURRENT_PAGES = [
  'admin-console.html','admin-operations.html','admin-settings.html',
  'admin-subjects.html','feedback-management.html','message-management.html',
  'user-management.html','system-settings.html','practice-mode.html',
]

test('current Focus Vega pages load the shared typography layer', () => {
  for (const page of CURRENT_PAGES) {
    assert.match(source(page), /styles\/focus-vega-typography\.css/)
  }
  assert.doesNotMatch(source('index.html'), /focus-vega-typography|data-ui-skin/)
})

test('the fixed typography ramp and four weights are declared', () => {
  const css = source('styles/focus-vega-typography.css')
  for (const token of [
    '--ui-text-meta:.75rem','--ui-text-control:.875rem','--ui-text-body:1rem',
    '--ui-text-card-title:1.125rem','--ui-text-section-title:1.25rem',
    '--ui-text-shell-title:1.5rem','--ui-text-page-title:1.75rem',
  ]) assert.ok(compact(css).includes(token))
  assert.doesNotMatch(css, /font-weight:\s*(550|650|680|7[5-9]0|8\d\d|9\d\d|1000)/)
})

test('typography rules do not target frozen descendants', () => {
  const css = source('styles/focus-vega-typography.css')
  for (const frozen of ['#authModal','.account-menu','.subscription-','.membership-','.payment-','.wechat-pay-','.qt-canvas-shell','.qw-canvas-shell','.kr-viewport']) {
    assert.doesNotMatch(css, new RegExp(escapeRegExp(frozen)))
  }
})
```

- [ ] **Step 2: Run the contract and verify RED**

Run:

```bash
node --test new-legacy/tests/focus-vega-typography-contract.test.js
```

Expected: FAIL because `focus-vega-typography.css` and its page links do not exist.

- [ ] **Step 3: Add the token-only stylesheet and page links**

Create `new-legacy/styles/focus-vega-typography.css` with compact three-layer variables:

```css
:where(
  body[data-ui-skin="focus-vega"],
  body[data-admin-skin="focus-vega"],
  body[data-learning-skin="focus-vega"]
){
  --ui-font-sans:"PingFang SC","Microsoft YaHei",system-ui,-apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif;
  --ui-text-meta:.75rem;
  --ui-text-control:.875rem;
  --ui-text-body:1rem;
  --ui-text-card-title:1.125rem;
  --ui-text-section-title:1.25rem;
  --ui-text-shell-title:1.5rem;
  --ui-text-page-title:1.75rem;
  --ui-text-kpi:1.5rem;
  --ui-text-kpi-lg:1.75rem;
  --ui-weight-regular:400;
  --ui-weight-medium:500;
  --ui-weight-semibold:600;
  --ui-weight-bold:700;
  --ui-leading-control:1.35;
  --ui-leading-heading:1.24;
  --ui-leading-body:1.65;
}
```

Load it before `admin-focus-vega.css` on the eight admin pages and before `learning-skin.css` on `practice-mode.html`. Do not touch script order.

- [ ] **Step 4: Run the static contract and verify GREEN**

Run:

```bash
node --test new-legacy/tests/focus-vega-typography-contract.test.js
```

Expected: all typography contract tests pass.

- [ ] **Step 5: Commit the contract and shared layer**

```bash
git add new-legacy/styles/focus-vega-typography.css new-legacy/tests/focus-vega-typography-contract.test.js \
  new-legacy/admin-console.html new-legacy/admin-operations.html new-legacy/admin-settings.html \
  new-legacy/admin-subjects.html new-legacy/feedback-management.html new-legacy/message-management.html \
  new-legacy/user-management.html new-legacy/system-settings.html new-legacy/practice-mode.html
git commit -m "feat: add shared Focus Vega typography tokens"
```

### Task 2: Map current Focus / Vega pages to the ramp

**Files:**
- Modify: `new-legacy/styles/admin-focus-vega.css`
- Modify: `new-legacy/styles/admin-focus-vega-common.css`
- Modify: `new-legacy/styles/admin-focus-vega-users.css`
- Modify: `new-legacy/styles/admin-focus-vega-settings.css`
- Modify: `new-legacy/styles/learning-skin.css`
- Modify: `new-legacy/styles/practice-mode.css`
- Create: `new-legacy/tests/focus-vega-typography-pc-browser.py`

**Interfaces:**
- Consumes: the `--ui-*` typography variables from Task 1.
- Produces: computed typography guarantees for admin and practice-mode surfaces.

- [ ] **Step 1: Write the failing Playwright typography assertions**

Mount the nine pages with scripts removed, load their declared CSS, and inspect visible non-frozen elements. Use page-role selectors rather than every text node:

```python
ROLE_SELECTORS = {
    'page_title': ('.admin-page-head h1,.um-topbar h1,.ss-topbar h1,.practice-lobby-head h1', 28),
    'card_title': ('.admin-panel h2,.um-card-head h2,.practice-mode-card h2', 18),
    'control': ('button:not(#authModal *),select:not(#authModal *),.admin-context-nav a', 14),
    'meta': ('.um-kicker,.admin-page-head>p,.practice-kicker', 12),
}
```

For each matched visible element, assert computed size within `1px` of its role, weight in `{400,500,600,700}`, no horizontal overflow, and the approved system font stack. At `200%` zoom, assert primary actions and headings remain visible.

- [ ] **Step 2: Run the browser test and verify RED**

```bash
python3 new-legacy/tests/focus-vega-typography-pc-browser.py
```

Expected: FAIL on current `10px/11px/13px` metadata, uncontrolled Inter-first font stacks, and non-approved weights.

- [ ] **Step 3: Replace literal typography with semantic tokens**

Make only scoped substitutions, for example:

```css
body[data-admin-skin="focus-vega"]{
  font-family:var(--ui-font-sans);
  font-size:var(--ui-text-control);
  line-height:var(--ui-leading-body);
}
body[data-admin-skin="focus-vega"] .admin-page-head h1{
  font-size:var(--ui-text-page-title);
  font-weight:var(--ui-weight-bold);
}
body[data-admin-skin="focus-vega"] :where(.admin-page-head p,.um-kicker,.ss-topbar .um-kicker){
  font-size:var(--ui-text-meta);
  font-weight:var(--ui-weight-semibold);
  letter-spacing:.05em;
}
```

Map controls to `--ui-text-control`, learning prose and inputs to `--ui-text-body`, card titles to `--ui-text-card-title`, and KPIs to the numeric tokens with `tabular-nums`. Do not add selectors for frozen regions.

- [ ] **Step 4: Run focused and existing regressions**

```bash
python3 new-legacy/tests/focus-vega-typography-pc-browser.py
node --test new-legacy/tests/focus-vega-typography-contract.test.js
node --test new-legacy/tests/admin-focus-vega-skin-contract.test.js
python3 new-legacy/tests/admin-focus-vega-pc-browser.py
```

Expected: new typography checks pass; existing contracts pass `7/7`; admin browser checks pass `24/24`.

- [ ] **Step 5: Commit the current-page mapping**

```bash
git add new-legacy/styles/admin-focus-vega*.css new-legacy/styles/learning-skin.css \
  new-legacy/styles/practice-mode.css new-legacy/tests/focus-vega-typography-pc-browser.py
git commit -m "style: normalize current Focus Vega typography"
```

### Task 3: Synchronize and preview the typography baseline

**Files:**
- Modify generated output through: `frontend/scripts/sync-new-legacy.js`
- Verify: `frontend/public/new-legacy/`

**Interfaces:**
- Consumes: completed typography source.
- Produces: a synchronized, isolated preview candidate for the next page-family plans.

- [ ] **Step 1: Run source and generated-tree contracts before synchronization**

```bash
node --test frontend/scripts/new-legacy-sync.test.mjs
node --test frontend/scripts/design-contract.test.mjs
```

Expected: source contracts pass; generated-tree equality may fail until synchronization.

- [ ] **Step 2: Synchronize through the project script**

```bash
node frontend/scripts/sync-new-legacy.js
```

- [ ] **Step 3: Run the complete static suite**

```bash
node --test frontend/scripts/*.test.mjs
```

Expected: all frontend script contracts pass.

- [ ] **Step 4: Build an isolated candidate and inspect it locally**

```bash
preview_root=$(mktemp -d /tmp/kg-typography-preview.XXXXXX)
node frontend/scripts/manage-new-legacy.js update new-legacy --root "$preview_root/releases" --skip-browser
```

Validate file counts and the presence of `index.html`, all nine current Focus pages, and `styles/focus-vega-typography.css`; then serve the temporary release without promoting it.

- [ ] **Step 5: Commit synchronized generated output**

```bash
git add frontend/public/new-legacy frontend/new-legacy-manifest.json frontend/new-legacy-sync-report.json
git commit -m "chore: sync typography foundation candidate"
```
