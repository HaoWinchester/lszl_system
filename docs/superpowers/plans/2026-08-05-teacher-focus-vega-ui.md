# Teacher Business Pages Focus Vega UI Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Apply the approved Focus / Vega PC visual system to the five teacher business pages without changing their layouts or workflows.

**Architecture:** Add one teacher-family adapter loaded after each page's existing styles and the shared typography layer. Preserve each page's native DOM and selectors; use a shared local Lucide sprite/adapter for non-frozen action icons, and validate each page at three PC widths before moving to the next family.

**Tech Stack:** Native HTML/CSS/JavaScript, shared typography tokens, local SVG sprite, Node contracts, Playwright Python.

## Global Constraints

- Target only `teacher-workbench.html`, `question-bank.html`, `paper-management.html`, `course-admin.html`, and `content-center.html`.
- Do not change business scripts, script order, IDs, `data-*`, routes, permissions, membership, or payment UI.
- Preserve `.tw-*`, `.qb-*`, `.ca-*`, and `.cc-*` DOM order and primary grid structure.
- PC only: `1440 × 900`, `1366 × 768`, `1024 × 768`.
- Use shared typography tokens; visible non-frozen text has a `0.75rem` floor.

---

### Task 1: Lock teacher-family opt-in and frozen boundaries

**Files:**
- Create: `new-legacy/tests/focus-vega-teacher-contract.test.js`
- Modify: five target HTML files.

**Interfaces:**
- Consumes: `styles/focus-vega-typography.css`.
- Produces: stable `data-ui-skin="focus-vega"` opt-in and final `styles/focus-vega-teacher.css` load order.

- [ ] **Step 1: Write the failing page contract**

Assert for each target page:

```js
assert.match(html, /data-ui-skin="focus-vega"/)
assert.deepEqual(cssLinks.slice(-2), [
  'styles/focus-vega-typography.css',
  'styles/focus-vega-teacher.css',
])
assert.equal(scriptSources, beforeScriptSources[page])
```

Also assert the adapter does not contain selectors for auth, account-menu internals, subscriptions, membership, payment, or WeChat Pay.

- [ ] **Step 2: Run and verify RED**

```bash
node --test new-legacy/tests/focus-vega-teacher-contract.test.js
```

Expected: FAIL because the opt-in and family adapter do not exist.

- [ ] **Step 3: Add opt-in and stylesheet links without touching scripts**

Add `data-ui-skin="focus-vega"` to each body and load the shared typography plus teacher adapter after existing page styles.

- [ ] **Step 4: Add a scoped adapter shell and verify GREEN**

Create `new-legacy/styles/focus-vega-teacher.css` with only a scoped token bridge:

```css
@media (min-width:901px){
  body[data-ui-skin="focus-vega"].teacher-admin-shell,
  body[data-ui-skin="focus-vega"] .cc-app{
    font-family:var(--ui-font-sans);
    color:var(--admin-foreground,#18181b);
    background:#fafafa;
  }
}
```

Run the contract and require it to pass before adding component styling.

- [ ] **Step 5: Commit the family contract and opt-in**

```bash
git add new-legacy/tests/focus-vega-teacher-contract.test.js new-legacy/styles/focus-vega-teacher.css \
  new-legacy/teacher-workbench.html new-legacy/question-bank.html new-legacy/paper-management.html \
  new-legacy/course-admin.html new-legacy/content-center.html
git commit -m "test: define teacher Focus Vega UI contract"
```

### Task 2: Build local product icon infrastructure

**Files:**
- Create: `new-legacy/assets/icons/lucide-product.svg`
- Create: `new-legacy/src/109-focus-vega-ui-icons.js`
- Modify: `new-legacy/tests/focus-vega-teacher-contract.test.js`
- Modify: five target HTML files.

**Interfaces:**
- Produces: `window.KGFocusVegaIcons.render(name, options)` and declarative `[data-ui-icon]` hydration.

- [ ] **Step 1: Extend the contract with a failing icon whitelist test**

Require a local sprite, `currentColor`, `fill="none"`, `stroke-width="2"`, an explicit whitelist, a `circle-help` fallback, and no network URLs. Freeze business script order while allowing the new visual adapter as the final script.

- [ ] **Step 2: Run and verify RED**

```bash
node --test new-legacy/tests/focus-vega-teacher-contract.test.js
```

Expected: FAIL because the product sprite and adapter are missing.

- [ ] **Step 3: Implement the minimal sprite and adapter**

Register only icons used by the teacher family, including `arrow-left`, `book-open`, `check`, `chevron-down`, `circle-help`, `download`, `edit-3`, `filter`, `folder-tree`, `plus`, `search`, `settings`, `trash-2`, `upload`, and `x`.

The adapter must hydrate only `[data-ui-icon]:not([data-ui-icon-ready])`; it must not rewrite text, IDs, data attributes, or any auth/membership descendant.

- [ ] **Step 4: Run contract and DOM-freeze checks**

Mount each page, snapshot protected/account/membership markup, hydrate icons, and assert the snapshots are identical.

- [ ] **Step 5: Commit local icon infrastructure**

```bash
git add new-legacy/assets/icons/lucide-product.svg new-legacy/src/109-focus-vega-ui-icons.js \
  new-legacy/tests/focus-vega-teacher-contract.test.js new-legacy/teacher-workbench.html \
  new-legacy/question-bank.html new-legacy/paper-management.html new-legacy/course-admin.html \
  new-legacy/content-center.html
git commit -m "feat: add shared local product icons"
```

### Task 3: Style the teacher business family

**Files:**
- Modify: `new-legacy/styles/focus-vega-teacher.css`
- Create: `new-legacy/tests/focus-vega-teacher-pc-browser.py`

**Interfaces:**
- Consumes: `.tw-*`, `.qb-*`, `.ca-*`, `.cc-*` page structures and shared typography/icon layers.
- Produces: Focus / Vega component styling with unchanged layout anchors.

- [ ] **Step 1: Write failing geometry and computed-style checks**

For each viewport and page, require exactly one native root and its primary anchors:

```python
PAGES = {
  'teacher-workbench.html': ['.tw-topbar','.tw-workflow','.tw-tabs'],
  'question-bank.html': ['.qb-app','.qb-layout','.qb-editor','.qb-inspector'],
  'paper-management.html': ['.qb-app','.paper-list'],
  'course-admin.html': ['.ca-app','.ca-layout','.ca-tree','.ca-node-editor'],
  'content-center.html': ['.cc-app','.cc-layout','.cc-tree-panel','.cc-inspector'],
}
```

Assert background `rgb(250,250,250)`, panel radius `8px—10px`, neutral borders, primary color `rgb(109,93,252)`, no body overflow, controls at least `36px` high, text role sizes, and frozen DOM equality.

- [ ] **Step 2: Run and verify RED**

```bash
python3 new-legacy/tests/focus-vega-teacher-pc-browser.py
```

Expected: FAIL on old gradients, color tokens, radius, button typography, and inconsistent panel styles.

- [ ] **Step 3: Implement the minimum teacher adapter**

Group rules by responsibility:

```css
/* shell/navigation */
/* buttons/forms/tabs */
/* teacher workbench */
/* question and paper management */
/* course administration */
/* content center */
```

Use white surfaces, `#e4e4e7` borders, `8px` controls, `10px` panels, shared typography tokens, and the approved purple states. Adjust only `gap`, `padding`, `min-width`, wrapping, truncation, and overflow where text growth requires it.

- [ ] **Step 4: Run browser and interaction regressions**

```bash
python3 new-legacy/tests/focus-vega-teacher-pc-browser.py
node --test new-legacy/tests/focus-vega-teacher-contract.test.js
node --test frontend/scripts/*.test.mjs
```

Then use the isolated local server to click teacher tabs, search, filters, question/paper/course selections, dialogs, save/cancel paths, and content-center view switches; require no new console error.

- [ ] **Step 5: Commit the teacher adapter**

```bash
git add new-legacy/styles/focus-vega-teacher.css new-legacy/tests/focus-vega-teacher-pc-browser.py
git commit -m "style: unify teacher business pages with Focus Vega"
```

### Task 4: Synchronize and checkpoint the teacher family

**Files:**
- Modify generated output through `frontend/scripts/sync-new-legacy.js`.

**Interfaces:**
- Produces: synchronized public assets and an isolated preview, not a promoted release.

- [ ] **Step 1: Synchronize source**

```bash
node frontend/scripts/sync-new-legacy.js
```

- [ ] **Step 2: Run backend and frontend regression suites**

```bash
cd backend && .venv/bin/python -m pytest tests/ -q
cd ../frontend && node --test scripts/*.test.mjs
```

- [ ] **Step 3: Build an isolated candidate**

Use `manage-new-legacy.js update new-legacy --root <temporary-root> --skip-browser`, compare candidate and active file counts, and verify the five pages plus new CSS/SVG/JS exist.

- [ ] **Step 4: Capture three-viewport evidence**

Capture each teacher page at all three approved viewports and verify no overflow, text below the approved floor, or frozen-surface change.

- [ ] **Step 5: Commit synchronized output**

```bash
git add frontend/public/new-legacy frontend/new-legacy-manifest.json frontend/new-legacy-sync-report.json
git commit -m "chore: sync teacher Focus Vega candidate"
```
