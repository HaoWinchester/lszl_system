# Non-Graph Workspace Redesign Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace every non-graph page with a shared navy-and-blue professional workspace while preserving the graph iframe and all existing business behavior.

**Architecture:** Add a nested React Router layout that renders a shared `WorkspaceShell` around the seven non-graph authenticated routes. Keep route state and API handlers intact, then apply a last-loaded workspace stylesheet that reshapes existing route DOM into the approved visual system; login receives a separate branded treatment. Contract tests guard shell coverage, graph isolation, tokens, and responsive behavior.

**Tech Stack:** React 19, React Router 7, TypeScript 6, Zustand, Lucide via `AppIcon`, CSS, Node test runner, Vite.

---

## File map

- Create `frontend/src/components/WorkspaceShell.tsx`: shared role-aware navigation, account controls, collapse state, mobile drawer, and nested route outlet.
- Create `frontend/src/styles/workspace-shell.css`: shell layout plus final non-graph route visual overrides.
- Modify `frontend/src/App.tsx`: nest non-graph routes under the shell while leaving `/` and `/login` outside it.
- Modify `frontend/src/components/AppIcon.tsx`: add the navigation icons needed by the shell through the one approved Lucide entry point.
- Modify `frontend/src/styles/design-system.css`: replace the neutral legacy tokens with the approved navy, blue, teal, and fog palette.
- Modify `frontend/src/styles/boardmix-overrides.css`: remove obsolete page-canvas assumptions that conflict with the shell.
- Modify `frontend/src/styles/file-manager.css`: allow file manager content to occupy the shell and turn its old global sidebar into local file context.
- Modify `frontend/src/routes/Login.tsx`: add the branded split-layout structure without changing authentication behavior.
- Modify `frontend/src/routes/Member.tsx`: mark the member content as a normal workspace page rather than a modal-only surface.
- Modify `frontend/src/main.tsx`: load `workspace-shell.css` last so the approved design wins over legacy-derived CSS.
- Modify `frontend/scripts/design-contract.test.mjs`: protect the shell, route scope, tokens, role navigation, responsive drawer, and graph isolation.

### Task 1: Lock the shell and graph-isolation contract

**Files:**
- Modify: `frontend/scripts/design-contract.test.mjs`

- [ ] **Step 1: Add failing shell contract tests**

Append tests that assert the new component and stylesheet exist, `App.tsx` imports `WorkspaceShell`, non-graph routes are nested under it, and `GraphEditor` is not passed to the shell:

```js
test('authenticated non-graph routes use the shared workspace shell', () => {
  const app = readFrontend('src/App.tsx')
  const shell = readFrontend('src/components/WorkspaceShell.tsx')

  assert.match(app, /import WorkspaceShell from '\.\/components\/WorkspaceShell'/)
  assert.match(app, /<Route element=\{<WorkspaceShell \/>\}>/)
  for (const path of ['files', 'question-bank', 'training', 'recall', 'users', 'settings', 'member']) {
    assert.match(app, new RegExp(`path="/${path}"`))
  }
  assert.doesNotMatch(app, /WorkspaceShell[^]*GraphEditor/)
  assert.match(shell, /<Outlet\s*\/>/)
  assert.match(shell, /role === 'admin'/)
})

test('workspace shell theme is loaded last and defines responsive navigation', () => {
  const main = readFrontend('src/main.tsx')
  const css = readFrontend('src/styles/workspace-shell.css')
  assert.match(main, /boardmix-overrides\.css'[\s\S]*workspace-shell\.css'/)
  assert.match(css, /\.ws-shell/)
  assert.match(css, /\.ws-sidebar/)
  assert.match(css, /@media \(max-width: 800px\)/)
  assert.match(css, /\.ws-mobile-bar/)
})
```

- [ ] **Step 2: Run the design test and confirm failure**

Run: `cd frontend && pnpm test:design`

Expected: FAIL because `WorkspaceShell.tsx` and `workspace-shell.css` do not exist.

### Task 2: Build the role-aware workspace shell

**Files:**
- Create: `frontend/src/components/WorkspaceShell.tsx`
- Modify: `frontend/src/components/AppIcon.tsx`
- Modify: `frontend/src/App.tsx`
- Modify: `frontend/src/main.tsx`

- [ ] **Step 1: Extend the shared icon map**

Import `BookOpen`, `Brain`, `CreditCard`, `GraduationCap`, `Menu`, and `Users` in `AppIcon.tsx`, then add these mappings:

```ts
questionBank: BookOpen,
training: GraduationCap,
recall: Brain,
member: CreditCard,
menu: Menu,
users: Users,
```

- [ ] **Step 2: Implement `WorkspaceShell`**

Create a component with `useLocation`, `useState`, `Outlet`, `NavLink`, and the auth store. Define stable navigation groups for workspace, learning, and admin; render admin items only when `me?.role === 'admin'`; call `logout()` and close mobile navigation after route changes. The outer contract is:

```tsx
return (
  <div className={`ws-shell${collapsed ? ' is-collapsed' : ''}${mobileOpen ? ' is-mobile-open' : ''}`}>
    <button className="ws-scrim" type="button" aria-label="关闭导航" onClick={() => setMobileOpen(false)} />
    <aside className="ws-sidebar" aria-label="主导航">{/* brand, groups, membership, account */}</aside>
    <div className="ws-stage">
      <header className="ws-mobile-bar">
        <button type="button" aria-label="打开导航" onClick={() => setMobileOpen(true)}><AppIcon name="menu" /></button>
        <strong>{currentTitle}</strong>
        <span className="ws-mobile-avatar">{initial}</span>
      </header>
      <main className="ws-route"><Outlet /></main>
    </div>
  </div>
)
```

- [ ] **Step 3: Nest authenticated non-graph routes**

Keep `/login` and `/` as top-level routes. Add a parent `<Route element={<WorkspaceShell />}>` around `/files`, `/question-bank`, `/training`, `/recall`, `/users`, `/settings`, and `/member`; retain each route's existing `RequireAuth` and role restrictions.

- [ ] **Step 4: Load the shell stylesheet last**

Add this after `boardmix-overrides.css` in `main.tsx`:

```ts
import './styles/workspace-shell.css'
```

- [ ] **Step 5: Run type checking to catch shell API errors**

Run: `cd frontend && pnpm exec tsc -b`

Expected: PASS with no TypeScript diagnostics.

### Task 3: Establish the approved design tokens and shell CSS

**Files:**
- Modify: `frontend/src/styles/design-system.css`
- Create: `frontend/src/styles/workspace-shell.css`

- [ ] **Step 1: Replace shared tokens with the approved palette**

Set the token values below while retaining existing token names consumed by route CSS:

```css
--kg-canvas: #f4f7fa;
--kg-surface: #ffffff;
--kg-surface-subtle: #edf2f7;
--kg-surface-hover: #e7eef8;
--kg-border: #dce3eb;
--kg-border-strong: #c7d1de;
--kg-text: #182230;
--kg-muted: #5f6b7a;
--kg-disabled: #8b97a6;
--kg-primary: #356dff;
--kg-primary-strong: #2557d6;
--kg-primary-soft: #edf3ff;
--kg-success: #18a78c;
--kg-warning: #c98018;
--kg-danger: #c33f4a;
--kg-navy: #10233f;
--kg-navy-raised: #183253;
--kg-teal-soft: #e8f7f3;
```

- [ ] **Step 2: Add desktop shell geometry**

In `workspace-shell.css`, define a fixed 232px navy sidebar, a 72px collapsed state, fog canvas stage, high-contrast nav states, grouped labels, membership panel, account footer, and a scrollable route area. Use `min-width: 0` and `min-height: 0` throughout so existing workspaces do not overflow.

- [ ] **Step 3: Add responsive shell behavior**

At `max-width: 800px`, move the sidebar off-canvas, display a 56px mobile bar, expose the scrim only when open, and keep all touch targets at least 44px. At `801–1180px`, default visual width to the compact 72px treatment without changing component state.

- [ ] **Step 4: Run the design contract**

Run: `cd frontend && pnpm test:design`

Expected: the two new shell tests PASS; any older token-value assertions remain PASS because token names are unchanged.

- [ ] **Step 5: Commit the shell foundation**

```bash
git add frontend/src/App.tsx frontend/src/main.tsx frontend/src/components/AppIcon.tsx frontend/src/components/WorkspaceShell.tsx frontend/src/styles/design-system.css frontend/src/styles/workspace-shell.css frontend/scripts/design-contract.test.mjs
git commit -m "feat: add professional workspace shell"
```

### Task 4: Transform login, files, and member pages

**Files:**
- Modify: `frontend/src/routes/Login.tsx`
- Modify: `frontend/src/routes/Member.tsx`
- Modify: `frontend/src/styles/workspace-shell.css`
- Modify: `frontend/src/styles/file-manager.css`

- [ ] **Step 1: Add failing route structure assertions**

Extend `design-contract.test.mjs`:

```js
test('login and member routes expose the redesigned page structure', () => {
  assert.match(readFrontend('src/routes/Login.tsx'), /className="auth-brand-panel"/)
  assert.match(readFrontend('src/routes/Login.tsx'), /className="auth-login-panel"/)
  assert.match(readFrontend('src/routes/Member.tsx'), /className="member-workspace"/)
})
```

Run: `cd frontend && pnpm test:design`

Expected: FAIL on the three missing class names.

- [ ] **Step 2: Restructure login without touching submit behavior**

Inside `.auth-backdrop`, add `.auth-brand-panel` containing the product name, a concise value statement, three capability lines, and decorative knowledge nodes with `aria-hidden="true"`. Wrap the existing form modal in `.auth-login-panel`; preserve `username`, `password`, `busy`, `err`, and `submit` exactly.

- [ ] **Step 3: Mark member content as a workspace page**

Add `member-workspace` to the root backdrop and change the close link label/title from closing a modal to returning to the knowledge graph. Do not change plan loading, purchase, or redeem handlers.

- [ ] **Step 4: Restyle file manager as shell content**

Override `.fm-app` to use a 214px local context panel plus main area, remove its fixed viewport assumptions, hide `.fm-sidebar-brand-row`, `.fm-nav`, and duplicate global account controls, retain folders/storage/trash, and move primary create/search controls into the visible content header. Keep mobile read-only selectors intact.

- [ ] **Step 5: Style login and member surfaces**

Use a navy-to-blue brand panel only on login, a white form surface, a membership hero with a restrained blue-to-teal gradient, white plan articles, a clear current-plan badge, and a single strong CTA per plan.

- [ ] **Step 6: Run design, type, and lint checks**

Run:

```bash
cd frontend
pnpm test:design
pnpm exec tsc -b
pnpm lint
```

Expected: all commands PASS.

### Task 5: Transform question bank and study workspaces

**Files:**
- Modify: `frontend/src/styles/workspace-shell.css`
- Modify: `frontend/src/routes/Training.tsx`
- Modify: `frontend/src/routes/Recall.tsx`

- [ ] **Step 1: Add study-workspace contract assertions**

Add tests that require `.qb-app`, `.question-training-app`, and `.kr-app` selectors in `workspace-shell.css`, plus `q-reasoning-step-number`, `q-reasoning-tags`, and `q-reasoning-answer` classes in `Training.tsx`. Run `pnpm test:design` and expect failure on the new training classes.

- [ ] **Step 2: Apply the professional three-column question-bank layout**

In `workspace-shell.css`, style `.qb-topbar` as the local 64px page header, hide duplicate global management links, turn `.qb-sidebar` into the dark-on-light contextual navigation, keep `.qb-editor` as the primary white work surface, and give `.qb-inspector` a quiet completion panel with teal success indicators. Remove decorative gradients inherited from legacy CSS.

- [ ] **Step 3: Replace Training inline visual styles with semantic classes**

Keep all data expressions and handlers, but replace the four inline-styled reasoning steps with:

```tsx
<div className="q-reasoning-step">
  <div className="q-reasoning-step-head">
    <span className="q-reasoning-step-number">1</span>
    <strong>关键词线索</strong>
  </div>
  <div className="q-reasoning-tags">{/* existing clues map */}</div>
</div>
```

Use modifier classes `is-concept`, `is-rule`, and `is-answer` for steps two through four, and `q-reasoning-answer` for the answer badge.

- [ ] **Step 4: Style training as a focused task page**

Make `.question-modal` a bounded white workspace, convert its top bar to progress/context, keep tabs compact, emphasize question copy and options, use teal/red semantic answer states with icon confirmation, and keep evidence in a quiet right rail. On narrow screens, stack evidence below the question.

- [ ] **Step 5: Style recall as an immersive workspace**

Keep `.kr-viewport`, world transforms, edge SVG, drag, and zoom logic untouched. Restyle the local header, question card, keyword controls, nodes, zoom dock, and hint pill with the approved tokens; use teal only for active recall state.

- [ ] **Step 6: Run tests and commit the user-facing core pages**

```bash
cd frontend
pnpm test:design
pnpm exec tsc -b
pnpm lint
cd ..
git add frontend/src/routes/Login.tsx frontend/src/routes/Member.tsx frontend/src/routes/Training.tsx frontend/src/routes/Recall.tsx frontend/src/styles/file-manager.css frontend/src/styles/workspace-shell.css frontend/scripts/design-contract.test.mjs
git commit -m "feat: redesign knowledge and study workspaces"
```

Expected: all checks PASS and the commit contains no graph editor or legacy changes.

### Task 6: Transform admin and settings pages

**Files:**
- Modify: `frontend/src/styles/workspace-shell.css`
- Modify: `frontend/src/styles/boardmix-overrides.css`

- [ ] **Step 1: Add admin-layout contract assertions**

Add a test requiring `.ws-route > .um-app`, `.um-layout`, `.ss-layout`, `.um-tag`, and `.ss-sidebar` selectors in `workspace-shell.css`. Run `pnpm test:design` and expect failure before adding them.

- [ ] **Step 2: Apply the list-workbench treatment to users**

Style the summary as four compact metric cells, the user list and editor as the two dominant columns, and the right detail tabs as a contextual rail. Normalize role/status tags, filters, pagination, form fields, logs, and dangerous actions. Hide duplicate global navigation links in `.um-top-actions` while retaining page-level import/export/new-user operations.

- [ ] **Step 3: Apply the settings-editor treatment**

Style `.ss-sidebar` as a quiet settings category rail, `.ss-content` as the primary form surface, permission matrices and subscription plan editors as structured sections, and save buttons as consistent primary actions. Preserve all existing tab, save, and API handlers.

- [ ] **Step 4: Remove conflicting obsolete overrides**

Delete only the `body:has(.um-app)` and fixed-width `.um-app, .ss-app` assumptions from `boardmix-overrides.css` that fight the shell. Leave graph-related and legacy-derived route normalization untouched.

- [ ] **Step 5: Run checks and commit admin pages**

```bash
cd frontend
pnpm test:design
pnpm exec tsc -b
pnpm lint
cd ..
git add frontend/src/styles/workspace-shell.css frontend/src/styles/boardmix-overrides.css frontend/scripts/design-contract.test.mjs
git commit -m "feat: redesign administration workspaces"
```

Expected: all checks PASS.

### Task 7: Browser validation and final hardening

**Files:**
- Modify if required by discovered regressions: `frontend/src/styles/workspace-shell.css`
- Modify if required by discovered regressions: route files already listed above

- [ ] **Step 1: Build production assets**

Run: `cd frontend && pnpm build`

Expected: TypeScript and Vite production build PASS.

- [ ] **Step 2: Start backend and frontend development servers**

Run backend on port 8000 and Vite on 5173 using the documented project commands. Confirm `/api/v1/health` responds and `/login` loads.

- [ ] **Step 3: Capture desktop routes**

At 1440×900, sign in as `admin / admin123` and capture `/files`, `/question-bank`, `/training`, `/recall`, `/users`, `/settings`, and `/member`. Verify the navy shell, stable active navigation, unclipped content, visible primary action, and no duplicate global navigation.

- [ ] **Step 4: Capture compact and mobile routes**

At 1024×768 and 390×844, verify compact/off-canvas navigation, 44px touch targets, single-column fallback, file mobile-readonly notice, and absence of horizontal page scrolling.

- [ ] **Step 5: Verify graph isolation**

Open `/`, compare against the pre-change editor capture, and confirm the iframe remains full-screen with identical graph tools, nodes, and canvas. Confirm neither `GraphEditor.tsx` nor `legacy/` appears in `git diff`.

- [ ] **Step 6: Run the complete frontend gate**

```bash
cd frontend
pnpm test:design
pnpm exec tsc -b
pnpm lint
pnpm build
```

Expected: every command PASS.

- [ ] **Step 7: Commit any visual hardening fixes**

```bash
git add frontend/src frontend/scripts/design-contract.test.mjs
git commit -m "fix: harden responsive workspace layout"
```

Only create this commit when browser validation required additional changes.
