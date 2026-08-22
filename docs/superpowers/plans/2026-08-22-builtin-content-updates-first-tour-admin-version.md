# Built-in Content Updates, First Tour, and Admin Version Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make bundled teaching content the automatic initial baseline while allowing durable administrator updates, show the home tour once per account, and display the real release version across the admin header.

**Architecture:** PostgreSQL teaching-content tables remain authoritative for the current taxonomy, recall library, and principle/card bundle. `ContentSubject.content_metadata` stores explicit current taxonomy and recall IDs; the existing legacy-shaped admin UI receives a compatibility gateway that hydrates current server data and publishes existing imports without changing its DOM structure. A server-side atomic tour claim removes the startup timing race, and the shared admin UI reads the release marker injected into `<html data-release>`.

**Tech Stack:** FastAPI, async SQLAlchemy, PostgreSQL JSONB, pytest, browser JavaScript, Node test runner, new-legacy release tooling, agent-browser.

## Global Constraints

- Bundled JSON remains under `backend/app/seed/builtin_teaching_content/` and is installed without user upload.
- Startup seeding creates missing baseline records only; it must not overwrite administrator-authored values or current-version pointers.
- New papers consume current published teaching content; existing questions, exam papers, paper releases, and release-question snapshots remain unchanged.
- Knowledge-tree and recall imports retain their existing review/publish interaction; principle/card import remains an atomic immediate update after confirmation.
- The home tour auto-opens once per account across browsers and devices; Help Center manual replay remains available.
- All admin pages preserve their existing DOM/class layout and show the injected release version.
- Do not edit `legacy/`; edit `new-legacy/` sources and regenerate tracked release assets through project scripts.
- Deploy UAT only with `bash deploy/update-uat.sh`; do not restart or deploy production.
- Preserve all pre-existing dirty/untracked user files and stage only task-owned paths.

---

### Task 1: Current Teaching-Content Pointers and Seed-Only Baselines

**Files:**
- Create: `backend/app/services/teaching_content_current_service.py`
- Modify: `backend/app/services/builtin_teaching_content_seed_service.py`
- Modify: `backend/app/services/content_prep_shared_service.py`
- Test: `backend/tests/test_builtin_teaching_content_seed.py`
- Test: `backend/tests/test_content_prep_shared_content.py`

**Interfaces:**
- Produces: `current_taxonomy(db, subject_id) -> tuple[ContentTaxonomy, list[TaxonomyNode]] | None`
- Produces: `current_recall_library(db, subject_id) -> RecallAssociationLibrary | None`
- Produces: `set_current_taxonomy(subject, taxonomy_id) -> bool`
- Produces: `set_current_recall_library(subject, library_id) -> bool`
- Stores: `ContentSubject.content_metadata.currentTaxonomyId` and `currentRecallLibraryId`

- [ ] **Step 1: Replace canonical-restore expectations with failing preservation tests**

  In `test_builtin_teaching_content_seed.py`, change the existing restore test into `test_builtin_sync_preserves_admin_updates_and_custom_content`. Mutate a bundled principle name, preset content, taxonomy node record, and recall node list, run `sync_builtin_teaching_content`, and assert all manual values remain unchanged and `summary.updated == 0`. Add an assertion that first install sets the two current IDs, and repeated seed keeps manually changed pointers.

- [ ] **Step 2: Add failing current-pointer selection tests**

  In `test_content_prep_shared_content.py`, create two published taxonomies and two recall libraries whose version/update ordering conflicts with the subject pointers. Assert GET `/api/v1/content-prep/shared-content?subjectId=PMP` returns the pointer-selected records, not the latest timestamp/version. Assert a legacy subject without pointers receives a deterministic published fallback.

- [ ] **Step 3: Run the focused backend tests and verify RED**

  Run:

  ```bash
  cd backend && .venv/bin/python -m pytest tests/test_builtin_teaching_content_seed.py tests/test_content_prep_shared_content.py -q
  ```

  Expected: failures show seed restoring manual values and shared-content choosing by ordering rather than pointers.

- [ ] **Step 4: Implement the current-content service**

  Add pointer constants and helpers in `teaching_content_current_service.py`. Pointer reads must validate subject ownership and fall back to a published record deterministically; pointer writes must merge existing subject metadata rather than replacing unrelated keys.

- [ ] **Step 5: Change seed to fill missing content without overwriting existing rows**

  In `sync_builtin_teaching_content`, keep the strict packaged-file validation and missing-row creation. For an existing bundled taxonomy, recall library, principle, or preset, count it as unchanged regardless of content differences. Set a current pointer only when the subject has no valid pointer. Continue bumping the teaching revision only when rows or pointers are actually created.

- [ ] **Step 6: Make shared-content reads and writes use pointers**

  Replace `_latest_taxonomy` and `_latest_recall` selection with the current-content helpers. When `apply_auxiliary_assets` publishes a taxonomy, set `currentTaxonomyId`. When it writes recall content, update the pointer-selected recall record (or create one and set `currentRecallLibraryId`) instead of always targeting version 1.

- [ ] **Step 7: Run focused tests and verify GREEN**

  Run the command from Step 3. Expected: all focused tests pass.

- [ ] **Step 8: Commit Task 1**

  ```bash
  git add backend/app/services/teaching_content_current_service.py backend/app/services/builtin_teaching_content_seed_service.py backend/app/services/content_prep_shared_service.py backend/tests/test_builtin_teaching_content_seed.py backend/tests/test_content_prep_shared_content.py
  git commit -m "fix: preserve published teaching content updates"
  ```

---

### Task 2: Server-Authoritative Admin Knowledge Tree and Recall Publishing

**Files:**
- Create: `new-legacy/src/admin/42-teaching-content-server-gateway.js`
- Modify: `new-legacy/admin-subjects.html`
- Modify: `new-legacy/src/admin/51-admin-subjects-app.js`
- Modify: `new-legacy/src/admin/53-recall-association-management.js`
- Modify: `new-legacy/src/95-recall-association-library.js`
- Test: `new-legacy/tests/admin-teaching-content-server-gateway.test.js`
- Test: `new-legacy/tests/deep-recall-association-server-sync.test.js`
- Test: `frontend/scripts/online-qa-regressions.test.mjs`

**Interfaces:**
- Consumes: GET and PUT `/api/v1/content-prep/shared-content`
- Produces: `KGAdminTeachingContentGateway.hydrateSubject(subjectId) -> Promise<object>`
- Produces: `KGAdminTeachingContentGateway.publishTaxonomy(taxonomy) -> Promise<object>`
- Produces: `KGAdminTeachingContentGateway.publishCurrentTaxonomyFromStore(subjectId) -> Promise<object>`

- [ ] **Step 1: Write failing JavaScript gateway contract tests**

  Add a VM-based test that supplies a fake `fetch`, `KGAdminServices`, and legacy content store. Assert hydration replaces the old default `taxonomy-pmp-main` current projection with the server taxonomy and 317 nodes while preserving local non-current drafts. Assert publishing sends the selected taxonomy plus the latest `contentRevision` to shared-content and surfaces non-2xx errors.

- [ ] **Step 2: Add failing page-source regression assertions**

  Assert `admin-subjects.html` loads the gateway before `51-admin-subjects-app.js`; `51-admin-subjects-app.js` awaits initial hydration before first render and awaits server publication before reporting “当前知识树已更新”; server read failure renders a specific error instead of the 12-node fallback.

- [ ] **Step 3: Add a failing recall-current regression**

  Extend `deep-recall-association-server-sync.test.js` so `writeServer` includes the current server recall identity/revision and relies on the returned current library. The test must fail against the old version-1 write behavior.

- [ ] **Step 4: Run Node tests and verify RED**

  ```bash
  node --test new-legacy/tests/admin-teaching-content-server-gateway.test.js new-legacy/tests/deep-recall-association-server-sync.test.js frontend/scripts/online-qa-regressions.test.mjs
  ```

- [ ] **Step 5: Implement the compatibility gateway**

  Build a focused gateway that fetches server shared content, maps localized titles and node records into the existing legacy taxonomy shape, replaces only the current projection, retains local drafts/history, and exposes an error state. Use revision-aware PUT for publication and retry only after reloading on a 409 conflict.

- [ ] **Step 6: Wire knowledge-tree publication and current-tree edits to the gateway**

  Keep existing JSON parsing, draft creation, history table, confirmation copy, class names, and DOM. Convert initialization and publish handlers to async. Publish the server candidate before committing the local current switch, and do not show success until the server response confirms the pointer switch. Subscribe to taxonomy storage changes and debounce `publishCurrentTaxonomyFromStore` so direct edits in the embedded current-tree workspace update the same server record. On failure, leave the draft and previous current version intact and show a retryable error toast.

- [ ] **Step 7: Correct recall publication targeting**

  Keep “import check → add to draft → publish”. Have `writeServer` use shared-content’s current recall and let the backend update the pointer-selected record. On success, replace the local formal snapshot with the returned library; on failure keep the draft dirty and do not record a successful release.

- [ ] **Step 8: Run Node tests and verify GREEN**

  Run the command from Step 4. Expected: all tests pass.

- [ ] **Step 9: Commit Task 2**

  ```bash
  git add new-legacy/src/admin/42-teaching-content-server-gateway.js new-legacy/admin-subjects.html new-legacy/src/admin/51-admin-subjects-app.js new-legacy/src/admin/53-recall-association-management.js new-legacy/src/95-recall-association-library.js new-legacy/tests/admin-teaching-content-server-gateway.test.js new-legacy/tests/deep-recall-association-server-sync.test.js frontend/scripts/online-qa-regressions.test.mjs
  git commit -m "fix: publish admin teaching content to current server data"
  ```

---

### Task 3: Durable Principle/Card Imports and Published-Snapshot Protection

**Files:**
- Modify: `backend/tests/test_builtin_teaching_content_seed.py`
- Modify: `backend/tests/test_content_prep_shared_content.py`
- Modify: `backend/tests/test_teaching_content_revision.py`

**Interfaces:**
- Consumes: POST `/api/v1/content-prep/principles/import`
- Produces: imported principle/card bundle that survives `sync_builtin_teaching_content` and application restart

- [ ] **Step 1: Add failing import-survives-seed test**

  Import a bundle that changes one bundled principle name and paired preset content without removing referenced IDs. Run startup seed again. Assert the imported values, revisions, projection rows, and content revision remain current.

- [ ] **Step 2: Extend published-content immutability coverage**

  Create a question, exam paper, paper release, and release-question snapshot; perform taxonomy publication, recall publication, and principle bundle import; assert every stored question/paper/release payload is byte-for-byte unchanged.

- [ ] **Step 3: Run focused tests and verify RED or confirm existing import path**

  ```bash
  cd backend && .venv/bin/python -m pytest tests/test_builtin_teaching_content_seed.py tests/test_content_prep_shared_content.py tests/test_teaching_content_revision.py -q
  ```

  The import-survives-seed test must fail before Task 1 and pass after Task 1. If the HTTP import assertions already pass after Task 1, do not add unnecessary production code.

- [ ] **Step 4: Verify the existing import transaction is the retained implementation**

  Confirm `import_principle_card_bundle` still performs one transaction, rejects removal of referenced principle IDs, rewrites both runtime projections, writes audit/revision changes, and returns the canonical saved bundle. No new production path is added in this task; Task 1's seed-only change is what makes this existing import durable.

- [ ] **Step 5: Run focused tests and verify GREEN**

  Run the command from Step 3.

- [ ] **Step 6: Commit Task 3**

  Stage only files actually changed and commit:

  ```bash
  git commit -m "test: keep imported teaching content across restarts"
  ```

---

### Task 4: Atomic Once-Per-Account Home Tour

**Files:**
- Modify: `backend/app/services/runtime_state_service.py`
- Modify: `backend/app/web/routes.py`
- Modify: `frontend/scripts/new-legacy-assets/server-state-bootstrap.js`
- Modify: `new-legacy/src/40-guided-tour.js`
- Test: `backend/tests/test_runtime_state.py`
- Test: `frontend/scripts/online-qa-regressions.test.mjs`

**Interfaces:**
- Produces: POST `/api/v1/runtime/guided-tour-claim`
- Produces: `KGServerStateStorage.claimGuidedTour() -> Promise<{claimed,key,value,revision}>`
- Uses key: `通用知识点关系图谱工具_新手引导已看_v1`

- [ ] **Step 1: Write a failing atomic-claim backend test**

  Log the same account into two independent TestClients. Assert the first claim returns `claimed=true`, all later claims from either client return `false`, and a different account receives `true`. Assert the claim does not change teaching `contentRevision`.

- [ ] **Step 2: Write failing frontend source/behavior tests**

  Assert the bootstrap exposes `claimGuidedTour`; automatic startup awaits it and calls `startGuidedTour(true)` only for `claimed=true`; manual Help Center still uses forced replay; a failed claim does not auto-open the layer.

- [ ] **Step 3: Run tests and verify RED**

  ```bash
  cd backend && .venv/bin/python -m pytest tests/test_runtime_state.py -q
  cd .. && node --test frontend/scripts/online-qa-regressions.test.mjs
  ```

- [ ] **Step 4: Implement the server claim transaction**

  Under the owner runtime-state lock, check the existing key, set it to `"1"` only if absent, increment account runtime revision once, commit, and return claim metadata. Do not use login-session-scoped keys.

- [ ] **Step 5: Replace timer-before-hydration autostart with claim-based autostart**

  Add the bootstrap request helper and change the guided-tour scheduler to await the learning-entry dialog and then the atomic account claim. Retain guest suppression, forced manual replay, Escape/skip/complete behavior, and existing tour DOM/CSS.

- [ ] **Step 6: Run tests and verify GREEN**

  Run the commands from Step 3.

- [ ] **Step 7: Commit Task 4**

  ```bash
  git add backend/app/services/runtime_state_service.py backend/app/web/routes.py backend/tests/test_runtime_state.py frontend/scripts/new-legacy-assets/server-state-bootstrap.js frontend/scripts/online-qa-regressions.test.mjs new-legacy/src/40-guided-tour.js
  git commit -m "fix: show the home tour once per account"
  ```

---

### Task 5: Real Release Version in Every Admin Header

**Files:**
- Modify: `new-legacy/src/admin/49-admin-ui.js`
- Modify: `new-legacy/styles/admin-console.css`
- Test: `new-legacy/tests/admin-release-version.test.js`
- Test: `frontend/scripts/new-legacy-sync.test.mjs`

**Interfaces:**
- Consumes: `document.documentElement.dataset.release`
- Produces: one `.admin-release-version` element per `.admin-topbar`

- [ ] **Step 1: Write failing admin-version tests**

  VM-test `KGAdminUI.init()` with `<html data-release="v9.0-p4.1.999">`; assert it inserts exactly one visible badge with that value and repeated init does not duplicate it. Extend sync tests to assert generated admin HTML keeps the injected `data-release` value.

- [ ] **Step 2: Run tests and verify RED**

  ```bash
  node --test new-legacy/tests/admin-release-version.test.js frontend/scripts/new-legacy-sync.test.mjs
  ```

- [ ] **Step 3: Implement shared badge insertion and compact styling**

  Add `renderReleaseVersion()` to the shared admin UI. Insert before the account menu, use only the generated release marker, and omit the badge if no marker exists. Add responsive CSS that keeps the account control usable on narrow screens without changing topbar/nav ordering.

- [ ] **Step 4: Run tests and verify GREEN**

  Run the command from Step 2.

- [ ] **Step 5: Commit Task 5**

  ```bash
  git add new-legacy/src/admin/49-admin-ui.js new-legacy/styles/admin-console.css new-legacy/tests/admin-release-version.test.js frontend/scripts/new-legacy-sync.test.mjs
  git commit -m "feat: show release version in admin headers"
  ```

---

### Task 6: Full Verification, Release Build, UAT Deployment, and Branch Sync

**Files:**
- Modify generated tracked assets only through: `node frontend/scripts/manage-new-legacy.js update new-legacy --skip-browser`
- Preserve: `frontend/new-legacy-sync-report.json` pre-task user version unless the user explicitly asks to include it

**Interfaces:**
- Produces: active UAT release with candidate file count greater than or equal to the current active release
- Produces: identical pushed HEAD for `main` and `uat`

- [ ] **Step 1: Run focused suites**

  ```bash
  cd backend && .venv/bin/python -m pytest tests/test_builtin_teaching_content_seed.py tests/test_content_prep_shared_content.py tests/test_teaching_content_revision.py tests/test_runtime_state.py -q
  cd .. && node --test new-legacy/tests/admin-teaching-content-server-gateway.test.js new-legacy/tests/deep-recall-association-server-sync.test.js new-legacy/tests/admin-release-version.test.js frontend/scripts/online-qa-regressions.test.mjs frontend/scripts/new-legacy-sync.test.mjs
  ```

- [ ] **Step 2: Run full backend and frontend validation**

  ```bash
  cd backend && .venv/bin/python -m pytest tests/ -q
  cd ../frontend && pnpm test
  ```

  Record exact pass/fail counts. Do not hide unrelated pre-existing failures.

- [ ] **Step 3: Build and validate the release candidate**

  Run:

  ```bash
  node frontend/scripts/manage-new-legacy.js update new-legacy --skip-browser
  ```

  Compare candidate and active file counts and verify `admin-console.html`, `admin-subjects.html`, `practice-mode.html`, `question-bank.html`, and `content-prep.html` exist before promotion.

- [ ] **Step 4: Commit generated release assets**

  Stage only tracked source/generated files belonging to this feature. Confirm protected dirty paths are absent from `git diff --cached --name-only`, then commit the release preparation.

- [ ] **Step 5: Deploy UAT only**

  ```bash
  bash deploy/update-uat.sh
  ```

  Confirm UAT project `lszl-kg-uat`, remote directory `/home/ubuntu/lszl-kg-uat`, and port `18087`. Verify production container ID and port `18086` remain unchanged.

- [ ] **Step 6: Browser acceptance on UAT**

  With agent-browser and an administrator account:

  - Open `admin-subjects.html` and assert PMP displays 317 current knowledge nodes.
  - Open the association tab and assert 471 nodes and 2,840 relations; confirm knowledge links use the 317-node tree.
  - Open the principle manager and assert the eight bundled principles/cards are visible.
  - Import/publish a reversible sentinel update, refresh/relogin/restart UAT, assert it persists, then restore the original value through the same supported import path.
  - Use a fresh test account to confirm tour first-entry auto-open, refresh/relogin/second browser suppression, and Help Center manual replay.
  - Visit every admin page and assert the header badge equals the page `data-release` marker.
  - Delete any temporary draft/account created for acceptance.

- [ ] **Step 7: Verify database and immutable release snapshots**

  Query UAT for current taxonomy/recall pointers, node/edge counts, eight principles/cards, question count, and paper-release count before and after restart. Confirm published release snapshots are unchanged.

- [ ] **Step 8: Push safe fast-forwards to `uat` and `main`**

  Fetch both remote branches, verify both are ancestors of local `uat`, fast-forward local `main` without switching dirty worktrees, and push without force. Verify `origin/main`, `origin/uat`, local `main`, local `uat`, and HEAD are identical.

- [ ] **Step 9: Final workspace audit**

  Confirm the task introduced no extra worktree or feature branch and that every pre-existing dirty/untracked user file remains unchanged and unstaged.
