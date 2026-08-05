# Learning Flow Focus Vega UI Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Unify six learning-flow pages while proving that the three protected canvas roots and all login/membership surfaces remain unchanged.

**Architecture:** Use one learning-family adapter with two explicit branches: standalone guided-learning pages and non-canvas chrome around training/workspace/recall. Freeze protected DOM and computed styles before styling, and forbid selectors that can enter `.qt-canvas-shell`, `.qw-canvas-shell`, or `.kr-viewport`.

**Tech Stack:** Native HTML/CSS/JavaScript, shared typography and local icons, Node contracts, Playwright Python.

## Global Constraints

- Target `learning-path.html`, `guided-learning-node.html`, `guided-learning-placement-test.html`, `question-training.html`, `question-workspace.html`, and `knowledge-recall.html`.
- Never change `.qt-canvas-shell`, `.qw-canvas-shell`, `.kr-viewport`, or their descendants.
- Never change auth, account-menu internals, subscriptions, membership, payment, or WeChat Pay.
- Do not change learning data, question state, graph/canvas behavior, routes, or script order.
- PC only at `1440 × 900`, `1366 × 768`, and `1024 × 768`.

---

### Task 1: Establish freeze-first learning contracts

**Files:**
- Create: `new-legacy/tests/focus-vega-learning-contract.test.js`
- Create: `new-legacy/tests/focus-vega-learning-freeze-browser.py`

**Interfaces:**
- Produces: source hashes, DOM snapshots, and computed-style signatures for protected canvas roots and frozen account/auth/membership surfaces.

- [ ] **Step 1: Write failing opt-in and adapter checks**

Require all six pages to load `focus-vega-typography.css` then `focus-vega-learning.css`, declare `data-ui-skin="focus-vega"`, preserve script order, and retain their current structural anchors.

- [ ] **Step 2: Capture baseline freeze signatures before implementation**

For each canvas page, mount current source and serialize:

```python
FREEZE = {
  'question-training.html': '.qt-canvas-shell',
  'question-workspace.html': '.qw-canvas-shell',
  'knowledge-recall.html': '.kr-viewport',
}
```

Record `outerHTML` and computed values for `font-family`, `font-size`, `line-height`, `color`, `background-color`, `grid-template-columns`, `position`, `inset`, `transform`, `width`, and `height`. The later test compares the exact same fixture before and after adding only the new stylesheet.

- [ ] **Step 3: Run opt-in contract and verify RED**

```bash
node --test new-legacy/tests/focus-vega-learning-contract.test.js
```

Expected: FAIL because the family adapter and opt-in are missing.

- [ ] **Step 4: Add explicit opt-in and an empty scoped adapter**

Create `new-legacy/styles/focus-vega-learning.css`; add page links after existing styles. The stylesheet may reference the canvas roots only in exclusion guards such as `:not(.qt-canvas-shell):not(.qt-canvas-shell *)`; it must never style their descendants.

- [ ] **Step 5: Run contract and freeze tests, then commit**

```bash
node --test new-legacy/tests/focus-vega-learning-contract.test.js
python3 new-legacy/tests/focus-vega-learning-freeze-browser.py
git add new-legacy/tests/focus-vega-learning-* new-legacy/styles/focus-vega-learning.css \
  new-legacy/learning-path.html new-legacy/guided-learning-node.html \
  new-legacy/guided-learning-placement-test.html new-legacy/question-training.html \
  new-legacy/question-workspace.html new-legacy/knowledge-recall.html
git commit -m "test: define learning Focus Vega freeze contract"
```

### Task 2: Style standalone guided-learning pages

**Files:**
- Modify: `new-legacy/styles/focus-vega-learning.css`
- Create: `new-legacy/tests/focus-vega-learning-pc-browser.py`

**Interfaces:**
- Consumes: `.gl-*`, `.gln-*`, and `.glp-*` structures.
- Produces: unified path, node, and placement-test presentation.

- [ ] **Step 1: Write failing visual checks for standalone pages**

Require roots and anchors:

```python
STANDALONE = {
  'learning-path.html': ['.gl-app','.gl-topbar','.gl-main'],
  'guided-learning-node.html': ['.gln-topbar','.gln-main','.gln-action-bar'],
  'guided-learning-placement-test.html': ['.glp-topbar','.glp-main','.glp-action-bar'],
}
```

Assert the Focus / Vega palette, approved typography, `36px+` controls, `8px/10px` radii, visible focus rings, no overflow, and unchanged content order.

- [ ] **Step 2: Run and verify RED**

```bash
python3 new-legacy/tests/focus-vega-learning-pc-browser.py --group standalone
```

- [ ] **Step 3: Add standalone scoped styles**

Map topbars, progress, cards, mode selectors, action bars, feedback, results, and dialogs to shared tokens. Keep layout grids and DOM order unchanged; only repair wrapping and alignment caused by the new font scale.

- [ ] **Step 4: Run standalone visual and functional checks**

Verify stage switching, subject menu, node navigation, language switch, answer/continue flows, placement start/cancel/result paths, and console output.

- [ ] **Step 5: Commit standalone learning styling**

```bash
git add new-legacy/styles/focus-vega-learning.css new-legacy/tests/focus-vega-learning-pc-browser.py
git commit -m "style: unify guided learning pages with Focus Vega"
```

### Task 3: Style training, workspace, and recall chrome only

**Files:**
- Modify: `new-legacy/styles/focus-vega-learning.css`
- Modify: `new-legacy/tests/focus-vega-learning-pc-browser.py`
- Modify: `new-legacy/tests/focus-vega-learning-freeze-browser.py`

**Interfaces:**
- Consumes: `.qt-topbar/.qt-workflow`, `.qw-topbar/.qw-workspace-filebar`, and `.kr-topbar` outside protected roots.
- Produces: unified non-canvas chrome with exact frozen-root equality.

- [ ] **Step 1: Add failing non-canvas assertions**

Assert the following outside-canvas roots adopt shared typography and controls while the freeze signature remains byte-for-byte equal:

```python
CHROME = {
  'question-training.html': ['.qt-topbar','.qt-workflow'],
  'question-workspace.html': ['.qw-topbar','.qw-workspace-filebar'],
  'knowledge-recall.html': ['.kr-topbar'],
}
```

- [ ] **Step 2: Run and verify RED**

Run the `chrome` browser group and freeze test. Expected: chrome assertions fail; freeze baseline passes.

- [ ] **Step 3: Add explicit outside-canvas styles**

Style only named chrome selectors. Do not use broad rules such as `.qt-app *`, `.qw-app button`, or `.kr-app :where(...)`; every rule must name an allowed non-canvas component.

- [ ] **Step 4: Run visual, freeze, and interaction regressions**

```bash
python3 new-legacy/tests/focus-vega-learning-pc-browser.py
python3 new-legacy/tests/focus-vega-learning-freeze-browser.py
node --test new-legacy/tests/focus-vega-learning-contract.test.js
node --test frontend/scripts/ui-polish-contract.test.mjs frontend/scripts/online-qa-regressions.test.mjs
```

Verify navigation, question switching, search, drawers, help entry, account entry, and language controls without editing canvas behavior.

- [ ] **Step 5: Commit learning chrome styling**

```bash
git add new-legacy/styles/focus-vega-learning.css new-legacy/tests/focus-vega-learning-*
git commit -m "style: unify non-canvas learning chrome"
```

### Task 4: Synchronize and checkpoint the learning family

**Files:**
- Modify generated output through `frontend/scripts/sync-new-legacy.js`.

**Interfaces:**
- Produces: synchronized candidate and frozen-surface evidence.

- [ ] **Step 1: Synchronize source and run static suites**

```bash
node frontend/scripts/sync-new-legacy.js
node --test frontend/scripts/*.test.mjs
```

- [ ] **Step 2: Run full backend tests**

```bash
cd backend && .venv/bin/python -m pytest tests/ -q
```

- [ ] **Step 3: Build an isolated candidate and validate file counts**

Require all six pages, the shared typography file, learning adapter, icon adapter, and protected canvas assets to exist. Do not promote.

- [ ] **Step 4: Capture screenshots and freeze signatures at all viewports**

Store local evidence outside Git; compare canvas roots, auth, membership, and account-menu internals against baseline.

- [ ] **Step 5: Commit synchronized output**

```bash
git add frontend/public/new-legacy frontend/new-legacy-manifest.json frontend/new-legacy-sync-report.json
git commit -m "chore: sync learning Focus Vega candidate"
```
