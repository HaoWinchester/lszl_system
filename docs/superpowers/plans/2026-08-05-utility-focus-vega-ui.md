# Utility Pages Focus Vega UI Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Complete Focus / Vega UI coverage for file management and help surfaces, with readable metadata and unchanged file/help behavior.

**Architecture:** Add one utility-family adapter after existing styles. Treat file manager as the high-density primary target and the two help pages as content surfaces; reuse the shared typography and product icon layers without changing file operations or help navigation.

**Tech Stack:** Native HTML/CSS/JavaScript, shared typography and SVG icons, Node contracts, Playwright Python.

## Global Constraints

- Target only `file-manager.html`, `help-center.html`, and `multi-question-help.html`.
- Do not modify `index.html`, file business APIs, storage behavior, auth/account internals, support submission behavior, or routes.
- Preserve file-manager sidebar/topbar/grid/inspector structure and help-center sidebar/content structure.
- PC only at `1440 × 900`, `1366 × 768`, and `1024 × 768`.
- Visible metadata floor is `0.75rem`; controls are `0.875rem`; long help prose is `1rem` with `1.65—1.75` line-height.

---

### Task 1: Define utility opt-in and structure contracts

**Files:**
- Create: `new-legacy/tests/focus-vega-utility-contract.test.js`
- Create: `new-legacy/styles/focus-vega-utility.css`
- Modify: `new-legacy/file-manager.html`
- Modify: `new-legacy/help-center.html`
- Modify: `new-legacy/multi-question-help.html`

**Interfaces:**
- Consumes: shared typography and product icon layers.
- Produces: stable utility opt-in, stylesheet load order, and protected structure checks.

- [ ] **Step 1: Write the failing static contract**

Require `data-ui-skin="focus-vega"`, shared typography, final utility adapter, preserved scripts, and these anchors:

```js
const REQUIRED = {
  'file-manager.html': ['fm-app','fm-sidebar','fm-main','fm-file-grid','fm-inspector'],
  'help-center.html': ['help-shell','help-topbar','help-layout','help-sidebar','help-content'],
  'multi-question-help.html': ['multi-question-help-page'],
}
```

Assert utility CSS contains no graph, canvas, auth, account-menu, membership, payment, or subscription selectors.

- [ ] **Step 2: Run and verify RED**

```bash
node --test new-legacy/tests/focus-vega-utility-contract.test.js
```

- [ ] **Step 3: Add opt-in, stable root class, and empty adapter**

Add only a body class to `multi-question-help.html`; keep its content order. Load typography and utility styles after current styles/inline style. Do not change scripts.

- [ ] **Step 4: Run and verify GREEN**

The structural contract must pass before adding visual rules.

- [ ] **Step 5: Commit utility contracts**

```bash
git add new-legacy/tests/focus-vega-utility-contract.test.js new-legacy/styles/focus-vega-utility.css \
  new-legacy/file-manager.html new-legacy/help-center.html new-legacy/multi-question-help.html
git commit -m "test: define utility Focus Vega UI contract"
```

### Task 2: Normalize file-manager typography and components

**Files:**
- Modify: `new-legacy/styles/focus-vega-utility.css`
- Create: `new-legacy/tests/focus-vega-utility-pc-browser.py`

**Interfaces:**
- Consumes: `.fm-*` structure and file-manager behavior.
- Produces: readable file metadata and Focus / Vega file controls.

- [ ] **Step 1: Write failing file-manager browser checks**

At all three viewports assert:

- `.fm-app`, `.fm-sidebar`, `.fm-main`, `.fm-file-grid`, `.fm-inspector` are visible and inside the viewport.
- visible `.fm-file-date`, `.fm-file-stats`, `.fm-tag`, `.fm-info-body`, `.fm-nav-item`, buttons, menu items, modal copy, and footer text are at least `12px`.
- buttons/inputs/selects use approved typography, radii, borders, and focus states.
- long filenames truncate or wrap without changing card width.
- grid/list mode, inspector, dialogs, context menus, and toast containers do not overflow.

- [ ] **Step 2: Run and verify RED**

```bash
python3 new-legacy/tests/focus-vega-utility-pc-browser.py --page file-manager.html
```

Expected: FAIL on the current `9px—11px` metadata and old surface/control vocabulary.

- [ ] **Step 3: Add scoped file-manager mappings**

Map the shell, navigation, toolbar, file cards, metadata, inspector, dialogs, context menus, tags, empty states, and toasts to shared tokens. Keep file card dimensions and the existing sidebar/main/inspector arrangement; adjust only wrapping, truncation, gaps, and minimum widths.

- [ ] **Step 4: Run visual and functional file-manager checks**

Verify search, filters, grid/list switch, folder navigation, selection, favorite/tag controls, rename, move, trash, restore, cancel, empty state, and failed-operation recovery on the isolated local server.

- [ ] **Step 5: Commit file-manager styling**

```bash
git add new-legacy/styles/focus-vega-utility.css new-legacy/tests/focus-vega-utility-pc-browser.py
git commit -m "style: improve file manager readability and consistency"
```

### Task 3: Style help-center and multi-question help

**Files:**
- Modify: `new-legacy/styles/focus-vega-utility.css`
- Modify: `new-legacy/tests/focus-vega-utility-pc-browser.py`

**Interfaces:**
- Consumes: `.help-*` and `.multi-question-help-page` content structures.
- Produces: consistent readable help navigation and prose.

- [ ] **Step 1: Add failing help-page assertions**

Require page titles `28px`, section titles `20px`, navigation/controls `14px`, prose `16px`, metadata `12px`, prose width at most `65ch`, and no content overflow. Verify `#helpSearch`, `#helpNav`, `#helpContent`, `#helpBack`, and the multi-question return link still exist.

- [ ] **Step 2: Run and verify RED**

```bash
python3 new-legacy/tests/focus-vega-utility-pc-browser.py --pages help-center.html multi-question-help.html
```

Expected: FAIL because existing prose is `13px`, section titles are `15px/17px`, and surfaces use different radii/colors.

- [ ] **Step 3: Add scoped help typography and surfaces**

Style headers, sidebar navigation, search, content sections, notes, links, and empty states with shared tokens. Preserve text and section order; do not convert the content into a different layout.

- [ ] **Step 4: Run browser and help interaction checks**

Verify search with results, zero results and recovery, navigation between topics, caller-preserving back behavior, multi-question return link, keyboard focus, and 200% zoom.

- [ ] **Step 5: Commit help styling**

```bash
git add new-legacy/styles/focus-vega-utility.css new-legacy/tests/focus-vega-utility-pc-browser.py
git commit -m "style: unify help surfaces with Focus Vega"
```

### Task 4: Final system regression and isolated candidate

**Files:**
- Modify generated output through `frontend/scripts/sync-new-legacy.js`.

**Interfaces:**
- Consumes: typography, teacher, learning, and utility plans.
- Produces: the complete local candidate ready for user review, not production.

- [ ] **Step 1: Synchronize all source changes**

```bash
node frontend/scripts/sync-new-legacy.js
```

- [ ] **Step 2: Run all automated suites**

```bash
cd backend && .venv/bin/python -m pytest tests/ -q
cd ../frontend && node --test scripts/*.test.mjs
cd .. && node --test new-legacy/tests/*contract*.test.js
python3 new-legacy/tests/focus-vega-typography-pc-browser.py
python3 new-legacy/tests/focus-vega-teacher-pc-browser.py
python3 new-legacy/tests/focus-vega-learning-pc-browser.py
python3 new-legacy/tests/focus-vega-learning-freeze-browser.py
python3 new-legacy/tests/focus-vega-utility-pc-browser.py
```

- [ ] **Step 3: Build and validate an isolated release**

Use a new temporary release root. Compare candidate and active file counts, verify all target pages and new assets exist, and explicitly verify `index.html` remains unchanged from the checkpoint. Do not promote.

- [ ] **Step 4: Perform role and curious-user passes**

With admin, teacher, student, and unauthenticated sessions, traverse all target pages. Click primary/secondary/icon controls, tabs, filters, forms, dialogs, cancel/retry paths, empty states, and repeated items; verify no frozen visual or functionality changed.

- [ ] **Step 5: Commit synchronized output and stop for user review**

```bash
git add frontend/public/new-legacy frontend/new-legacy-manifest.json frontend/new-legacy-sync-report.json
git commit -m "chore: prepare complete Focus Vega local candidate"
```

Report the local preview URL and exact test counts. Do not publish until the user explicitly approves the candidate.
