# Guided Learning And Fidelity Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Store the v8.6 Activity Schema/course library and user progress in PostgreSQL, connect the original guided-learning pages, align retained React pages to `new-legacy`, and complete functional/visual regression.

**Architecture:** A versioned seed package is exported from the upstream Activity Schema and imported into normalized course/activity tables. Public course reads feed the iframe bootstrap while authenticated progress writes are owner-scoped. Retained React pages continue to use current APIs but consume upstream DOM/CSS contracts and are verified by screenshot comparison.

**Tech Stack:** FastAPI, SQLAlchemy async, PostgreSQL JSONB, Alembic, JSON Schema, React, Playwright/browser smoke tests.

---

### Task 1: Export and validate the canonical v8.6 course package

**Files:**
- Create: `frontend/scripts/export-guided-course.mjs`
- Create: `frontend/scripts/export-guided-course.test.mjs`
- Generate: `backend/app/seed/guided_course_v8_6_0.json`

- [ ] **Step 1: Write the failing export test**

```js
test('exports the complete v8.6 course and canonical activity library', () => {
  const pkg = exportCourse(upstreamRoot)
  assert.equal(pkg.version, 'v8.6.0')
  assert.equal(pkg.course.stages.length, 3)
  assert.equal(pkg.course.parts.length, 9)
  assert.equal(pkg.course.nodes.length, 108)
  assert.equal(pkg.activities.length, 82)
  assert.equal(pkg.activitySchemaVersion, 1)
})
```

- [ ] **Step 2: Verify RED**

Run: `cd frontend && node --test scripts/export-guided-course.test.mjs`

Expected: FAIL because the exporter is absent.

- [ ] **Step 3: Implement the deterministic exporter**

Evaluate `86-activity-schema-v1.js` and `87-guided-learning-data.js` in a locked VM, call the public data interfaces, validate every activity, remove executable values, sort stable IDs, attach a SHA-256 content hash, and write UTF-8 JSON. Do not scrape implementation-private variables.

- [ ] **Step 4: Verify GREEN and generate the seed**

Run: `cd frontend && node --test scripts/export-guided-course.test.mjs && node scripts/export-guided-course.mjs`

Expected: test PASS and seed contains 3 stages, 9 parts, 108 nodes, and 82 activities.

- [ ] **Step 5: Commit**

```bash
git add frontend/scripts/export-guided-course.mjs frontend/scripts/export-guided-course.test.mjs backend/app/seed/guided_course_v8_6_0.json
git commit -m "feat: export canonical guided course package"
```

### Task 2: Add guided-learning models and failing API tests

**Files:**
- Create: `backend/tests/test_guided_learning.py`
- Create: `backend/app/models/guided_learning.py`
- Modify: `backend/app/models/__init__.py`
- Create: `backend/alembic/versions/90fd7f6bf301_guided_courses_activities_progress.py`

- [ ] **Step 1: Write failing tests**

Cover public course read, authenticated progress round trip, unauthenticated progress denial, locked-node completion rejection, single-current-node recomputation, placement failure not unlocking, placement pass completing one part, admin preview no-write, duplicate activity ID rejection, broken node activity reference rejection, and user isolation.

- [ ] **Step 2: Verify RED**

Run: `cd backend && .venv/bin/python -m pytest tests/test_guided_learning.py -q`

Expected: FAIL with 404 for the missing API.

- [ ] **Step 3: Add normalized models**

Create `GuidedCourse`, `GuidedActivity`, `GuidedCourseActivity`, and `GuidedLearningProgress` exactly as specified in the design. Use `JSONB` for course structure/activity records/progress, stable string IDs, course/activity version fields, owner foreign keys, and unique constraints for course activity order and owner/course progress.

- [ ] **Step 4: Add the migration**

Set `down_revision = '4b91d6ec2a10'`; create tables parent-first and drop them child-first. Include indexes for published courses, activity type, and owner/course progress lookup.

- [ ] **Step 5: Apply the migration**

Run: `cd backend && .venv/bin/alembic upgrade head`

Expected: migration succeeds.

- [ ] **Step 6: Commit**

```bash
git add backend/tests/test_guided_learning.py backend/app/models/guided_learning.py backend/app/models/__init__.py backend/alembic/versions/90fd7f6bf301_guided_courses_activities_progress.py
git commit -m "test: define guided learning persistence"
```

### Task 3: Implement course import, public reads, and progress rules

**Files:**
- Create: `backend/app/services/guided_learning_service.py`
- Create: `backend/app/api/v1/guided_learning.py`
- Modify: `backend/app/api/v1/router.py`
- Modify: `backend/app/main.py`
- Test: `backend/tests/test_guided_learning.py`

- [ ] **Step 1: Implement package validation/import**

Validate schema version 1, package hash, unique IDs, stage/part/node references, node activity references, placement configs, and challenge configs before a transaction writes the course. Seed v8.6.0 idempotently during startup after the admin seed.

- [ ] **Step 2: Implement public course reads**

Expose `GET /guided-learning/courses/default` without requiring a user. Return only published course structure and activities; never include another user's progress.

- [ ] **Step 3: Implement progress endpoints**

Expose authenticated `GET/PUT /guided-learning/courses/{course_id}/progress`, `POST .../nodes/{node_id}/complete`, and `POST .../parts/{part_id}/placement-attempt`. Recompute unlocks server-side, keep exactly one current/available node, and reject attempts to complete locked nodes.

- [ ] **Step 4: Implement admin preview**

For admin users, `preview=true` returns an all-open derived view but refuses writes with a clear preview response; it never alters persisted progress.

- [ ] **Step 5: Verify GREEN**

Run: `cd backend && .venv/bin/python -m pytest tests/test_guided_learning.py -q && .venv/bin/python -m pytest tests/ -q`

Expected: focused and full backend suites PASS.

- [ ] **Step 6: Commit**

```bash
git add backend/app/services/guided_learning_service.py backend/app/api/v1/guided_learning.py backend/app/api/v1/router.py backend/app/main.py backend/tests/test_guided_learning.py
git commit -m "feat: serve guided courses and progress"
```

### Task 4: Bridge original guided-learning pages

**Files:**
- Modify: `frontend/src/api/learning.ts`
- Create: `frontend/src/iframe/guidedLearningFrameAdapter.ts`
- Create: `frontend/scripts/new-legacy-assets/guided-learning-data-bridge.js`
- Modify: `frontend/scripts/sync-new-legacy.js`
- Modify: `frontend/src/routes/LearningPath.tsx`
- Modify: `frontend/src/routes/GuidedLearningNode.tsx`
- Modify: `frontend/src/routes/GuidedLearningPlacementTest.tsx`
- Create: `frontend/scripts/guided-learning-frame.test.mjs`

- [ ] **Step 1: Write failing bridge tests**

Assert course/progress preload, public guest course load, authenticated completion, placement failure and pass, language mode preservation, admin preview no-write, and retry after save failure.

- [ ] **Step 2: Verify RED**

Run: `cd frontend && node --test scripts/guided-learning-frame.test.mjs`

Expected: FAIL because the adapter/data bridge is absent.

- [ ] **Step 3: Implement the data bridge**

Inject `guided-learning-data-bridge.js` after upstream `87-guided-learning-data.js` and before the store/app scripts. Replace the public `KGGuidedLearningData` read methods with bootstrap-backed course/activity methods while using `KGActivitySchemaV1.materialize` for `zh`, `en`, and `bilingual`. Do not change activity IDs or renderer-facing runtime shapes.

- [ ] **Step 4: Implement progress messages**

Map original store reads to preloaded server progress and map complete-node/placement actions to the guided APIs. Send the normalized server response back into the in-memory store before re-rendering, so server unlock rules remain authoritative.

- [ ] **Step 5: Verify GREEN**

Run: `cd frontend && node --test scripts/guided-learning-frame.test.mjs && pnpm sync:new-legacy && pnpm exec tsc -b && pnpm build`

Expected: guided bridge tests, sync, types, and build PASS.

- [ ] **Step 6: Commit**

```bash
git add frontend/src/api/learning.ts frontend/src/iframe/guidedLearningFrameAdapter.ts frontend/scripts/new-legacy-assets/guided-learning-data-bridge.js frontend/scripts/sync-new-legacy.js frontend/src/routes/LearningPath.tsx frontend/src/routes/GuidedLearningNode.tsx frontend/src/routes/GuidedLearningPlacementTest.tsx frontend/scripts/guided-learning-frame.test.mjs frontend/public/new-legacy frontend/new-legacy-manifest.json frontend/new-legacy-sync-report.json
git commit -m "feat: connect guided learning engine to backend"
```

### Task 5: Align retained React pages to the new upstream source

**Files:**
- Modify: `frontend/src/routes/Files.tsx`
- Modify: `frontend/src/routes/QuestionBank.tsx`
- Modify: `frontend/src/routes/Recall.tsx`
- Modify: `frontend/src/routes/Users.tsx`
- Modify: `frontend/src/routes/Settings.tsx`
- Modify: `frontend/src/styles/*.css`
- Modify: `frontend/src/main.tsx`
- Modify: `frontend/scripts/design-contract.test.mjs`

- [ ] **Step 1: Expand failing page requirement traces**

For each retained page assert the `new-legacy` DOM anchors, text, controls, responsive regions, and absence of conflicting BoardMix overrides. Add positive, negative, and recovery behavior assertions for every visible action touched by the upstream diff.

- [ ] **Step 2: Verify RED**

Run: `cd frontend && node --test scripts/design-contract.test.mjs`

Expected: FAIL on the current global overrides and any DOM/class mismatch.

- [ ] **Step 3: Apply the upstream DOM/CSS changes page by page**

Read the corresponding upstream HTML before each route edit. Preserve API calls and React state, but make element order, className, text, empty states, dialogs, buttons, responsive containers, and styles match. Remove or scope `design-system.css`/`boardmix-overrides.css` rules that alter the upstream body; do not replace upstream styles with new inline styles.

- [ ] **Step 4: Verify GREEN after each page**

Run: `cd frontend && node --test scripts/design-contract.test.mjs && pnpm exec tsc -b`

Expected: page contract and types PASS after every route.

- [ ] **Step 5: Commit**

```bash
git add frontend/src/routes/Files.tsx frontend/src/routes/QuestionBank.tsx frontend/src/routes/Recall.tsx frontend/src/routes/Users.tsx frontend/src/routes/Settings.tsx frontend/src/styles frontend/src/main.tsx frontend/scripts/design-contract.test.mjs
git commit -m "feat: align react pages with new-legacy"
```

### Task 6: Add control-matrix E2E and visual comparison

**Files:**
- Create: `frontend/e2e/new-legacy-control-matrix.spec.ts`
- Create: `frontend/e2e/new-legacy-visual.spec.ts`
- Create: `frontend/playwright.config.ts`
- Modify: `frontend/package.json`

- [ ] **Step 1: Write the failing E2E matrix**

Visit all routes; enumerate visible buttons, links, inputs, textareas, selects, radios, checkboxes, and tabs; click/fill/toggle each from a fresh state; require a real URL, state, modal, persisted API result, or specific domain error. Add named flows for five-step training, workspace grouping/undo, node wrong-answer queue, challenge completion, placement failure/pass, language modes, guest read-only, and admin preview.

- [ ] **Step 2: Verify RED**

Run: `cd frontend && pnpm exec playwright test e2e/new-legacy-control-matrix.spec.ts`

Expected: failures identify unbound or incorrectly bridged controls before fixes.

- [ ] **Step 3: Fix each product failure and rerun focused E2E**

For every failure, add or retain the test that exposed it, fix the product, and rerun the named test until green. Do not whitelist generic feedback or no-op controls.

- [ ] **Step 4: Add exact-source screenshots**

Capture upstream and integrated pages with identical viewport, role, theme, language, query parameters, seed package, and data states. Compare desktop 1440×900, tablet 1024×768, and mobile 390×844 for initial, empty, data, dialog, selected, disabled, error, and completion states.

- [ ] **Step 5: Verify GREEN**

Run: `cd frontend && pnpm exec playwright test e2e/new-legacy-control-matrix.spec.ts e2e/new-legacy-visual.spec.ts`

Expected: all control and screenshot comparisons PASS.

- [ ] **Step 6: Commit**

```bash
git add frontend/e2e frontend/playwright.config.ts frontend/package.json frontend/pnpm-lock.yaml
git commit -m "test: cover new-legacy controls and visual fidelity"
```

### Task 7: Full verification and clean delivery

**Files:**
- Modify only files required by failures found below.

- [ ] **Step 1: Run every verification layer**

```bash
cd new-legacy && node --test tests/guided-learning-v2.test.js
cd ../backend && .venv/bin/python -m pytest tests/ -q
cd ../frontend && node --test scripts/*.test.mjs
pnpm exec tsc -b
pnpm lint
pnpm build
pnpm exec playwright test
```

- [ ] **Step 2: Run source-of-truth scans**

Scan generated learning scripts and React production sources for unapproved `localStorage`, `sessionStorage`, IndexedDB, mock/demo business arrays, generic placeholder actions, and unbound controls. Any match must be removed, explicitly allowlisted as transient UI state, or backed by a regression test.

- [ ] **Step 3: Perform a curious-user browser pass**

Manually exercise primary, secondary, icon-only, modal, empty-state, repeated-item, retry, cancel, refresh, back, repeated-click, role, language, and mobile controls. Convert every discovered bug into a failing automated test before fixing it.

- [ ] **Step 4: Clean generated test artifacts**

Remove untracked Playwright reports, screenshots, videos, traces, `test-results`, and `dist` unless intentionally tracked as baselines. Do not remove user files or the generated upstream manifest/report.

- [ ] **Step 5: Confirm the worktree contains no verification-only artifacts**

Run: `git status --short`

Expected: only intentional source, migration, generated manifest, plan/spec, and pre-existing user changes remain. Any product correction discovered here returns to its owning task, adds a failing regression test, and uses that task's exact commit command.
