# BoardMix-Inspired Global Design Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make every React route and the iframe-hosted graph editor feel like one precise, BoardMix-inspired knowledge workspace while preserving all existing behaviors.

**Architecture:** Add one global token layer that all existing route-specific styles consume. Keep the graph engine in the derived `public/legacy` pipeline, injecting only a theme stylesheet after the bridge; React routes retain their existing data/API code and receive visual-only markup/icon corrections plus targeted CSS overrides.

**Tech Stack:** React 19, TypeScript, Vite, CSS custom properties, lucide-react, Node built-in test runner, Playwright browser checks, FastAPI backend unchanged.

---

## File structure

- Create: `frontend/src/styles/design-system.css` — shared colors, typography, elevation, controls, focus, motion and accessibility defaults.
- Create: `frontend/scripts/legacy-assets/boardmix-theme.css` — derived-workbench overrides; never copied back to `legacy/`.
- Create: `frontend/scripts/design-contract.test.mjs` — static checks for token import, legacy injection and icon migration anchors.
- Create: `frontend/scripts/capture-ui.mjs` — authenticated screenshot smoke runner for the redesigned routes.
- Modify: `frontend/src/main.tsx` — import the token layer before page styles.
- Modify: `frontend/scripts/copy-legacy.js` — copy the derived theme asset and inject its stylesheet only into `workbench.html`.
- Modify: `frontend/src/routes/Files.tsx` and `frontend/src/styles/file-manager.css` — make the file browser the non-canvas reference surface.
- Modify: `frontend/src/styles/main.css`, `frontend/src/styles/graph-file-tabs.css`, `frontend/src/styles/graph-user-preferences.css` — constrain graph outer shell and the derived workbench controls.
- Modify: `frontend/src/routes/{Login,Member,QuestionBank,Training,Recall,Settings,Users}.tsx` and their corresponding style files — migrate icon-only controls and remove visual outliers without changing route/API behavior.
- Modify: `frontend/package.json` — add `test:design` and `capture:ui` scripts only.

## Task 1: Establish the design contract and visual test entry points

**Files:**

- Create: `frontend/scripts/design-contract.test.mjs`
- Create: `frontend/scripts/capture-ui.mjs`
- Modify: `frontend/package.json`

- [ ] **Step 1: Write the failing design-contract test**

```js
import assert from 'node:assert/strict'
import test from 'node:test'
import { readFileSync } from 'node:fs'

const frontendRoot = new URL('../', import.meta.url)
const repoRoot = new URL('../../', import.meta.url)
const readFrontend = (path) => readFileSync(new URL(path, frontendRoot), 'utf8')
const readRepo = (path) => readFileSync(new URL(path, repoRoot), 'utf8')

test('global BoardMix design assets are wired into the app and workbench', () => {
  assert.match(readFrontend('src/main.tsx'), /import '\.\/styles\/design-system\.css'/)
  assert.match(readFrontend('scripts/copy-legacy.js'), /boardmix-theme\.css/)
  assert.match(readFrontend('scripts/legacy-assets/boardmix-theme.css'), /--kg-canvas/)
})
```

- [ ] **Step 2: Run the contract test to verify it fails**

Run: `cd frontend && node --test scripts/design-contract.test.mjs`

Expected: FAIL because the stylesheet and injection do not exist.

- [ ] **Step 3: Add the script entry points and an initial screenshot runner**

```json
{
  "scripts": {
    "test:design": "node --test scripts/design-contract.test.mjs",
    "capture:ui": "node scripts/capture-ui.mjs"
  }
}
```

```js
// capture-ui.mjs: use the locally installed browser automation runtime to open
// /login and the protected routes after a real login; write files under
// ../.superpowers/ui-captures/ and exit non-zero on console/page errors.
const routes = ['/login', '/', '/files', '/question-bank', '/training', '/recall', '/users', '/settings', '/member']
```

- [ ] **Step 4: Run the contract test and TypeScript check**

Run: `cd frontend && pnpm test:design && pnpm exec tsc -b`

Expected: PASS with zero TypeScript errors.

- [ ] **Step 5: Commit the contract scaffold**

```bash
git add frontend/package.json frontend/scripts/design-contract.test.mjs frontend/scripts/capture-ui.mjs
git commit -m "test: add design system contract checks"
```

## Task 2: Implement the shared BoardMix-inspired token layer

**Files:**

- Create: `frontend/src/styles/design-system.css`
- Modify: `frontend/src/main.tsx`
- Modify: `frontend/scripts/design-contract.test.mjs`

- [ ] **Step 1: Extend the contract test with required token and accessibility assertions**

```js
test('design token layer supplies workspace surfaces and keyboard focus', () => {
  const css = readFrontend('src/styles/design-system.css')
  for (const token of ['--kg-canvas', '--kg-surface', '--kg-border', '--kg-text', '--kg-primary']) {
    assert.match(css, new RegExp(token))
  }
  assert.match(css, /:focus-visible/)
  assert.match(css, /prefers-reduced-motion/)
})
```

- [ ] **Step 2: Run it to verify it fails**

Run: `cd frontend && pnpm test:design`

Expected: FAIL because `design-system.css` has not been created.

- [ ] **Step 3: Implement the token layer and import it before legacy page styles**

```css
:root {
  --kg-canvas: #f6f7f9;
  --kg-surface: #fff;
  --kg-surface-subtle: #f1f4f8;
  --kg-border: #e3e7ec;
  --kg-text: #242a33;
  --kg-muted: #737d89;
  --kg-primary: #2f6df6;
  --kg-radius-control: 8px;
  --kg-radius-panel: 12px;
  --kg-shadow-float: 0 4px 8px rgb(28 39 53 / 10%);
}

:focus-visible { outline: 2px solid var(--kg-primary); outline-offset: 2px; }
@media (prefers-reduced-motion: reduce) { *, *::before, *::after { scroll-behavior: auto !important; transition-duration: .01ms !important; animation-duration: .01ms !important; } }
```

```ts
// main.tsx — before all existing styles
import './styles/design-system.css'
```

- [ ] **Step 4: Run contract, type and build checks**

Run: `cd frontend && pnpm test:design && pnpm exec tsc -b && pnpm build`

Expected: all commands exit 0.

- [ ] **Step 5: Commit the shared design layer**

```bash
git add frontend/src/styles/design-system.css frontend/src/main.tsx frontend/scripts/design-contract.test.mjs
git commit -m "feat: add global workspace design tokens"
```

## Task 3: Theme the iframe workbench without changing `legacy/`

**Files:**

- Create: `frontend/scripts/legacy-assets/boardmix-theme.css`
- Modify: `frontend/scripts/copy-legacy.js`
- Modify: `frontend/src/styles/main.css`
- Modify: `frontend/src/styles/graph-file-tabs.css`
- Modify: `frontend/src/styles/graph-user-preferences.css`
- Modify: `frontend/scripts/design-contract.test.mjs`

- [ ] **Step 1: Add an injection-order assertion**

```js
test('only the derived workbench receives the BoardMix theme after bridge setup', () => {
  const script = readFrontend('scripts/copy-legacy.js')
  assert.match(script, /workbenchHtml[\s\S]*boardmix-theme\.css/)
  assert.doesNotMatch(readRepo('legacy/index.html'), /boardmix-theme\.css/)
})
```

- [ ] **Step 2: Run it to verify it fails**

Run: `cd frontend && pnpm test:design`

Expected: FAIL because `copy-legacy.js` does not inject the theme stylesheet.

- [ ] **Step 3: Copy and inject the derived theme, then normalize the graph shell**

```js
// copy-legacy.js
cpSync(resolve(assetsDir, 'boardmix-theme.css'), resolve(outDir, 'boardmix-theme.css'))
const themedWorkbenchHtml = workbenchHtml.replace(
  '</head>',
  '<link rel="stylesheet" href="./boardmix-theme.css"><\/head>',
)
writeFileSync(resolve(outDir, 'workbench.html'), themedWorkbenchHtml)
```

```css
/* boardmix-theme.css */
html, body, .app { background: #f6f7f9; }
.graph-file-tabbar, .canvas-toolbar, .floating-toolbox, .canvas-zoom-dock {
  background: #fff;
  border: 1px solid #e3e7ec;
  border-radius: 10px;
  box-shadow: 0 4px 8px rgb(28 39 53 / 10%);
}
.world { background-color: #f6f7f9; }
```

- [ ] **Step 4: Rebuild derived assets and exercise the graph editor**

Run: `cd frontend && pnpm copy-legacy && pnpm test:design && pnpm exec tsc -b`

Manual: log in, create/select a node, create a relationship, zoom with wheel, drag the canvas, save, reload, and verify the same graph returns.

Expected: all graph actions remain functional and only `frontend/public/legacy/` changes.

- [ ] **Step 5: Commit the workbench theme**

```bash
git add frontend/scripts/copy-legacy.js frontend/scripts/legacy-assets/boardmix-theme.css frontend/src/styles/main.css frontend/src/styles/graph-file-tabs.css frontend/src/styles/graph-user-preferences.css
git commit -m "feat: refine graph workbench visual shell"
```

## Task 4: Make file management the non-canvas reference surface

**Files:**

- Modify: `frontend/src/routes/Files.tsx`
- Modify: `frontend/src/styles/file-manager.css`
- Modify: `frontend/scripts/design-contract.test.mjs`

- [ ] **Step 1: Add a test for the required icon and workspace anchors**

```js
test('file browser uses the shared workspace shell and lucide controls', () => {
  const route = readFrontend('src/routes/Files.tsx')
  const css = readFrontend('src/styles/file-manager.css')
  assert.match(route, /from 'lucide-react'/)
  assert.match(route, /className="fm-browser"/)
  assert.match(css, /var\(--kg-surface\)/)
  assert.match(css, /var\(--kg-radius-panel\)/)
})
```

- [ ] **Step 2: Run it to verify it fails**

Run: `cd frontend && pnpm test:design`

Expected: FAIL until file-manager CSS is converted to shared tokens.

- [ ] **Step 3: Replace visual outliers while retaining actions and ARIA**

```tsx
import { Grid2X2, List, Moon, RefreshCw, Search, Sun } from 'lucide-react'
// Preserve current handlers: reload, setDisplay, setTheme and existing aria-labels.
// Replace only inline icon SVGs with the semantic Lucide equivalent.
```

```css
.fm-page, .fm-app { background: var(--kg-canvas); color: var(--kg-text); }
.fm-sidebar, .fm-topbar, .fm-browser, .fm-details-drawer {
  background: var(--kg-surface);
  border-color: var(--kg-border);
  border-radius: var(--kg-radius-panel);
  box-shadow: none;
}
.fm-icon-btn:hover, .fm-nav-item:hover { background: var(--kg-surface-subtle); }
.fm-nav-item.is-active { background: #edf3ff; color: var(--kg-primary); }
```

- [ ] **Step 4: Verify normal, empty and recovery paths**

Run: `cd frontend && pnpm test:design && pnpm exec tsc -b`

Manual: create a graph, search, switch grid/list, open and close details, select/export, move to trash, cancel a permanent delete, restore, and reload.

Expected: each action has an observable result and the visual state remains coherent.

- [ ] **Step 5: Commit the file-browser reference surface**

```bash
git add frontend/src/routes/Files.tsx frontend/src/styles/file-manager.css frontend/scripts/design-contract.test.mjs
git commit -m "feat: refine file browser workspace design"
```

## Task 5: Migrate study and recall surfaces to the shared workspace language

**Files:**

- Modify: `frontend/src/routes/QuestionBank.tsx`
- Modify: `frontend/src/routes/Training.tsx`
- Modify: `frontend/src/routes/Recall.tsx`
- Modify: `frontend/src/styles/question-bank-admin.css`
- Modify: `frontend/src/styles/question-training.css`
- Modify: `frontend/src/styles/knowledge-recall.css`

- [ ] **Step 1: Add required shared-token assertions for all three routes**

```js
for (const file of ['question-bank-admin.css', 'question-training.css', 'knowledge-recall.css']) {
  test(`${file} consumes the shared surface and border tokens`, () => {
    const css = readFrontend(`src/styles/${file}`)
    assert.match(css, /var\(--kg-(canvas|surface|border|primary)\)/)
  })
}
```

- [ ] **Step 2: Run it to verify it fails**

Run: `cd frontend && pnpm test:design`

Expected: FAIL until all three page styles consume the global token layer.

- [ ] **Step 3: Implement visual migration with existing interaction code untouched**

```css
/* shared migration pattern, applied under each page prefix */
.qb-app, .question-training-app, .kr-app { background: var(--kg-canvas); color: var(--kg-text); }
.qb-topbar, .qt-topbar, .kr-topbar { background: var(--kg-surface); border-color: var(--kg-border); box-shadow: none; }
.qb-card, .q-panel, .kr-tools { border-radius: var(--kg-radius-panel); border-color: var(--kg-border); box-shadow: none; }
```

```tsx
// Replace icon-only character controls with Lucide icons only when no business
// data changes; preserve onClick, tab role, aria-selected and labels.
```

- [ ] **Step 4: Verify critical flows**

Run: `cd frontend && pnpm test:design && pnpm exec tsc -b`

Manual: create/delete/save a question; run a training answer and check validation/retry; open recall, pan, zoom, reset and navigate back.

Expected: saved question data persists after refresh, failed/empty states remain actionable, and recall controls work on both mouse and keyboard.

- [ ] **Step 5: Commit the study surface migration**

```bash
git add frontend/src/routes/QuestionBank.tsx frontend/src/routes/Training.tsx frontend/src/routes/Recall.tsx frontend/src/styles/question-bank-admin.css frontend/src/styles/question-training.css frontend/src/styles/knowledge-recall.css frontend/scripts/design-contract.test.mjs
git commit -m "feat: unify study workspace visuals"
```

## Task 6: Migrate entry, membership and administration surfaces

**Files:**

- Modify: `frontend/src/routes/Login.tsx`
- Modify: `frontend/src/routes/Member.tsx`
- Modify: `frontend/src/routes/Settings.tsx`
- Modify: `frontend/src/routes/Users.tsx`
- Modify: `frontend/src/styles/subscription.css`
- Modify: `frontend/src/styles/user-center.css`
- Modify: `frontend/src/styles/user-management.css`
- Modify: `frontend/src/styles/system-settings.css`

- [ ] **Step 1: Add route anchor assertions**

```js
for (const route of ['Login.tsx', 'Member.tsx', 'Settings.tsx', 'Users.tsx']) {
  test(`${route} keeps its route-level behavioral anchor`, () => {
    const source = readFrontend(`src/routes/${route}`)
    assert.match(source, /useAuth|Api|Link/)
  })
}
```

- [ ] **Step 2: Run it to verify it fails where anchors are missing**

Run: `cd frontend && pnpm test:design`

Expected: FAIL only if a visual refactor accidentally removes authentication, API, or navigation integration.

- [ ] **Step 3: Apply the compact application-shell treatment**

```css
.auth-backdrop, .user-subscription-detail-backdrop { background: var(--kg-canvas); }
.auth-modal, .kg-subscription-detail-modal, .um-panel, .ss-sidebar {
  background: var(--kg-surface);
  border: 1px solid var(--kg-border);
  border-radius: var(--kg-radius-panel);
  box-shadow: var(--kg-shadow-float);
}
.um-nav-btn.primary, .primary { background: var(--kg-primary); }
```

```tsx
// Keep submit/redeem/save/delete callbacks exactly as they are; replace only
// decorative layout wrappers and use Lucide icons for controls with aria-label.
```

- [ ] **Step 4: Verify success, failure and role paths**

Run: `cd frontend && pnpm test:design && pnpm exec tsc -b`

Manual: attempt bad login then correct login; submit empty and valid card code; as admin save settings and user data; as non-admin confirm protected routes redirect or deny correctly.

Expected: all flows preserve backend-backed results and visible recovery feedback.

- [ ] **Step 5: Commit entry and administration migration**

```bash
git add frontend/src/routes/Login.tsx frontend/src/routes/Member.tsx frontend/src/routes/Settings.tsx frontend/src/routes/Users.tsx frontend/src/styles/subscription.css frontend/src/styles/user-center.css frontend/src/styles/user-management.css frontend/src/styles/system-settings.css frontend/scripts/design-contract.test.mjs
git commit -m "feat: unify account and admin workspace visuals"
```

## Task 7: Perform the full visual and interaction regression loop

**Files:**

- Modify: `frontend/scripts/capture-ui.mjs`
- Modify: `frontend/scripts/design-contract.test.mjs`
- Create: `docs/superpowers/reports/2026-07-16-boardmix-design-qa.md`

- [ ] **Step 1: Add screenshot and anti-regression assertions**

```js
test('legacy source remains unmodified by the visual migration', () => {
  assert.doesNotMatch(readRepo('legacy/index.html'), /boardmix-theme\.css/)
})
```

```js
// capture-ui.mjs: fail if any route emits a console error, then save one
// 1440×900 screenshot per route after the route's primary content is visible.
await page.setViewportSize({ width: 1440, height: 900 })
await page.screenshot({ path: outputPath, fullPage: true })
```

- [ ] **Step 2: Run the contract suite before final QA**

Run: `cd frontend && pnpm test:design && pnpm exec tsc -b && pnpm build`

Expected: all commands exit 0.

- [ ] **Step 3: Run the browser QA and inspect every capture**

Run: `cd frontend && pnpm capture:ui`

Expected: nine captures under `.superpowers/ui-captures/` and no page/console errors.

Manual: use the control matrix from the design spec for each visible button, navigation item, tab, input, modal, empty state and permission-limited action.

- [ ] **Step 4: Write the QA report**

```markdown
# BoardMix-Inspired Visual QA

## Commands
- `pnpm test:design` — pass
- `pnpm exec tsc -b` — pass
- `pnpm build` — pass
- `pnpm capture:ui` — pass

## Manual coverage
- Graph create/edge/save/reload/zoom/pan: pass
- File create/search/view/selection/trash/restore: pass
- Question, training and recall primary/empty/recovery paths: pass
- Login, membership, admin settings and role guards: pass
```

- [ ] **Step 5: Commit QA evidence and deliver**

```bash
git add frontend/scripts/capture-ui.mjs frontend/scripts/design-contract.test.mjs docs/superpowers/reports/2026-07-16-boardmix-design-qa.md
git commit -m "test: verify global visual workspace migration"
```

## Plan self-review

- Spec coverage: Tasks 2–6 cover the global token layer, graph workbench, file manager, study pages, entry/admin pages, icon consistency and all listed routes. Task 7 covers the legacy-source constraint and visual/interaction regression.
- Placeholder scan: no TBD/TODO/future implementation markers are used; every task contains file targets, a failing assertion, command, implementation content and a verification step.
- Consistency: all tasks use the same `--kg-*` token vocabulary, the same derived-workbench mechanism, and preserve the existing route/API handlers rather than introducing new data paths.
