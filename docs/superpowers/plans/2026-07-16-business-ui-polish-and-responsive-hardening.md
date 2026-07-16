# Business UI Polish and Responsive Hardening Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Turn all non-graph React routes into one refined, accessible and mobile-usable professional workspace without changing business behavior.

**Architecture:** Extend the existing design contract first, then fix each route in four independently testable batches. Shared semantic tokens and input-state rules live in `design-system.css`; route layout remains in route-specific styles; `boardmix-overrides.css` is reduced to compatibility concerns. The graph iframe and `legacy/` remain untouched.

**Tech Stack:** React 19, TypeScript, Vite, CSS custom properties, Lucide through `AppIcon`, Node test runner, Python Playwright, FastAPI backend unchanged.

---

## Task 1: Freeze the approved UI contract

**Files:**

- Modify: `frontend/scripts/design-contract.test.mjs`
- Test: `frontend/scripts/design-contract.test.mjs`

- [ ] **Step 1: Add failing contract tests**

Add assertions that require an AA-safe muted token, shared touch-target token, no global button lift, a mobile file-sidebar height reset, one QuestionBank primary navigation, compact mobile user summary, settings mobile tabs and guided recall empty state.

- [ ] **Step 2: Verify the tests fail for the intended missing contracts**

Run: `cd frontend && pnpm test:design`

Expected: FAIL on the new responsive, contrast, navigation and empty-state assertions while all prior icon contracts remain green.

- [ ] **Step 3: Commit only after each implementation batch turns its matching assertions green**

Use one concrete commit for each batch so responsive, information-architecture and cleanup changes can be reviewed independently.

## Task 2: Repair mobile files and shared accessibility tokens

**Files:**

- Modify: `frontend/src/styles/design-system.css`
- Modify: `frontend/src/routes/Files.tsx`
- Modify: `frontend/src/styles/file-manager.css`
- Modify: `frontend/src/styles/boardmix-overrides.css`
- Modify: `frontend/scripts/design-contract.test.mjs`

- [ ] **Step 1: Make the shared-token tests fail**

Require `--kg-muted: #626d78`, `--kg-control-touch: 44px`, a coarse-pointer rule and absence of `translateY(-1px)` in the global button hover selector.

- [ ] **Step 2: Implement the shared tokens and mobile file cascade fix**

Set `.fm-sidebar { height:auto; min-height:0 }` inside the final mobile rule, expose the read-only notice from React on mobile, preserve file opening/search/sort/display controls, and enlarge mobile hit areas without enlarging their icons.

- [ ] **Step 3: Verify focused behavior**

Run: `cd frontend && pnpm test:design && pnpm exec tsc -b`

Playwright: at 390×844 assert `.fm-main` begins above the viewport bottom, at least one `.fm-file-card` or the real empty state is visible, and no horizontal overflow exists.

- [ ] **Step 4: Commit**

```bash
git add frontend/scripts/design-contract.test.mjs frontend/src/styles/design-system.css frontend/src/routes/Files.tsx frontend/src/styles/file-manager.css frontend/src/styles/boardmix-overrides.css
git commit -m "fix: restore mobile file workspace usability"
```

## Task 3: Simplify study and admin information architecture

**Files:**

- Modify: `frontend/src/routes/QuestionBank.tsx`
- Modify: `frontend/src/styles/question-bank-admin.css`
- Modify: `frontend/src/routes/Users.tsx`
- Modify: `frontend/src/styles/user-management.css`
- Modify: `frontend/src/routes/Training.tsx`
- Modify: `frontend/src/styles/question-training.css`
- Modify: `frontend/src/routes/Recall.tsx`
- Modify: `frontend/src/styles/knowledge-recall.css`
- Modify: `frontend/scripts/design-contract.test.mjs`

- [ ] **Step 1: Make the structure tests fail**

Assert that `QuestionBank.tsx` renders only one `qb-main-tabs`/primary-nav contract, the status context is inside the workspace header, Users applies a mobile list-first layout, and Training/Recall expose a collapsible management navigation.

- [ ] **Step 2: Remove duplicate navigation and reorder mobile tasks**

Keep one QuestionBank navigation source, integrate current-bank context into the workspace head, set mobile Users layout ordering so the list precedes summary cards, and collapse secondary admin links on the two learning routes.

- [ ] **Step 3: Verify focused behavior**

Run: `cd frontend && pnpm test:design && pnpm exec tsc -b`

Playwright: switch every QuestionBank primary tab, expand/collapse both management menus, and confirm the Users list heading is visible in the initial 390×844 viewport.

- [ ] **Step 4: Commit**

```bash
git add frontend/scripts/design-contract.test.mjs frontend/src/routes/QuestionBank.tsx frontend/src/styles/question-bank-admin.css frontend/src/routes/Users.tsx frontend/src/styles/user-management.css frontend/src/routes/Training.tsx frontend/src/styles/question-training.css frontend/src/routes/Recall.tsx frontend/src/styles/knowledge-recall.css
git commit -m "refactor: clarify mobile task hierarchy"
```

## Task 4: Refine settings, membership and empty states

**Files:**

- Modify: `frontend/src/routes/Settings.tsx`
- Modify: `frontend/src/styles/system-settings.css`
- Modify: `frontend/src/routes/Member.tsx`
- Modify: `frontend/src/styles/subscription.css`
- Modify: `frontend/src/routes/Training.tsx`
- Modify: `frontend/src/routes/Recall.tsx`
- Modify: `frontend/scripts/design-contract.test.mjs`

- [ ] **Step 1: Make the refinement tests fail**

Require semantic settings tab roles/selection, labeled theme swatches, a fixed modal header contract, 44px mobile member controls and guided empty-state actions.

- [ ] **Step 2: Implement the refined structures**

Make settings navigation horizontally scrollable on mobile, pair color swatches with their HEX values, keep the member header visible while its plan region scrolls, and add real navigation actions to study empty states.

- [ ] **Step 3: Verify interactions**

Run: `cd frontend && pnpm test:design && pnpm exec tsc -b`

Playwright: switch all settings tabs, close/reopen the membership modal, click a plan CTA, and exercise both empty-state recovery actions.

- [ ] **Step 4: Commit**

```bash
git add frontend/scripts/design-contract.test.mjs frontend/src/routes/Settings.tsx frontend/src/styles/system-settings.css frontend/src/routes/Member.tsx frontend/src/styles/subscription.css frontend/src/routes/Training.tsx frontend/src/routes/Recall.tsx
git commit -m "feat: refine settings and membership workflows"
```

## Task 5: Remove style drift and run full regression

**Files:**

- Modify: `frontend/src/styles/boardmix-overrides.css`
- Modify: route-specific styles touched by Tasks 2–4
- Modify: `frontend/scripts/design-contract.test.mjs`
- Create: `.superpowers/ui-polish-regression.py` (untracked verification artifact)

- [ ] **Step 1: Add drift assertions**

Require no global decorative button transform, no new gradient in the shared override, and route-specific responsive selectors to live outside `boardmix-overrides.css`.

- [ ] **Step 2: Consolidate styles**

Remove obsolete duplicate selectors and move page layout rules into their owning stylesheet while preserving existing class names and API logic.

- [ ] **Step 3: Run automated and visual regression**

Run:

```bash
cd frontend && pnpm test:design && pnpm lint && pnpm exec tsc -b && pnpm build
cd ../backend && .venv/bin/python -m pytest tests/ -q
```

Playwright viewports: 390×844, 768×900, 1024×768 and 1440×900 across `/files`, `/question-bank`, `/training`, `/recall`, `/users`, `/settings` and `/member`. Assert no horizontal overflow, no unnamed controls, no console/page errors and visible primary task content.

- [ ] **Step 4: Commit**

```bash
git add frontend/scripts/design-contract.test.mjs frontend/src/styles frontend/src/routes
git commit -m "refactor: finish business UI polish pass"
```
