# Shared Teacher Data and Live Sync Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make all administrator and teacher teaching data server-authoritative and mutually editable, then propagate successful Content Prep changes to open teacher pages without manual refresh.

**Architecture:** Keep relational question/catalog data in PostgreSQL and preserve the synchronous `new-legacy` runtime through canonical shared keys in `SharedRuntimeState`. Add one monotonic teaching-content revision service; relational writes and shared-runtime writes bump it inside their transaction, while a same-origin channel plus revision polling refreshes open pages.

**Tech Stack:** FastAPI, SQLAlchemy async, PostgreSQL, Pydantic, Alembic, native JavaScript, BroadcastChannel, Node contract tests, Playwright.

## Global Constraints

- All `admin` and `teacher` accounts can view, create, edit, delete, publish, and withdraw public teaching-workspace data.
- `student` and `viewer` cannot read teaching drafts or call management write APIs.
- Personal graphs, learning progress, practice history, layout, and preferences remain account-scoped.
- User management and system settings remain administrator-only.
- `new-legacy/` is the upstream source; never modify `legacy/` or an active release site directly.
- Content Prep “保存工作区到本机” remains local-only and must not emit a formal data-change notification.
- SQLAlchemy async writes must `commit` and `await db.refresh(obj)` before serializers access refreshed ORM fields.
- Use TDD for every behavior change and preserve the approved Focus / Vega DOM and canvas boundaries.
- This is plan 1 of 4. Complete it before question cleanup, paper/principle work, or navigation work.

---

## File Structure

### Backend

- Create `backend/app/services/teaching_content_revision_service.py`: monotonic revision and compact change summaries stored under one locked shared-state row.
- Modify `backend/app/services/question_access_service.py`: role-wide administrator/teacher bank access.
- Modify `backend/app/services/question_catalog_service.py`: shared managed catalog and revision payload.
- Modify `backend/app/services/question_service.py`: role-wide paper access and revision bumps.
- Modify `backend/app/services/content_prep_service.py`: bump revisions and refresh principle/preset shared projections in the upload transaction.
- Create `backend/app/services/teaching_content_projection_service.py`: project relational principles/presets to shared runtime and apply shared edits back to relational rows.
- Modify `backend/app/services/runtime_state_service.py`: canonical shared draft keys, role-aware aliases, projections, and revision bumps.
- Modify `backend/app/api/v1/question_catalog.py`: expose the current teaching revision.
- Modify `backend/app/api/v1/questions.py`: require teacher-management permissions for paper CRUD.
- Modify `backend/app/schemas/question_catalog.py` and `backend/app/schemas/content_prep.py`: stable revision response fields.

### Direct-runtime assets

- Create `frontend/scripts/new-legacy-assets/teaching-content-sync.js`: shared channel and revision polling API.
- Modify `frontend/scripts/new-legacy-assets/server-state-bootstrap.js`: refresh server storage on teaching-content messages.
- Modify `frontend/scripts/new-legacy-assets/question-catalog-adapter.js`: publish local commits and reload on remote commits.
- Modify `frontend/scripts/sync-new-legacy.js`: inject the sync asset before catalog/runtime consumers.
- Modify `new-legacy/content-prep-studio/src/index.template.html`: load the shared sync asset when served by the main application.
- Modify `new-legacy/content-prep-studio/src/js/35-server-catalog-service.js` and `45-server-events.js`: publish only after server success.
- Modify `new-legacy/src/91-teacher-workbench-app.js`: read shared catalog and shared paper state.

### Tests

- Modify `backend/tests/test_question_catalog.py`.
- Modify `backend/tests/test_runtime_shared_policy.py`.
- Create `backend/tests/test_teaching_content_revision.py`.
- Modify `backend/tests/test_question_api_compatibility.py`.
- Create `new-legacy/tests/teaching-content-live-sync.test.js`.
- Modify `new-legacy/tests/content-prep-question-bank-integration.test.js`.
- Create `frontend/e2e/shared_teacher_workspace.py`.

---

### Task 1: Make managed question banks role-shared

**Files:**
- Modify: `backend/app/services/question_access_service.py:17-58`
- Modify: `backend/app/services/question_catalog_service.py:101-151`
- Test: `backend/tests/test_question_catalog.py`

**Interfaces:**
- Consumes: `User.role`, `QuestionBank.owner_id`, existing collaborator rows.
- Produces: `can_view_bank(db, user, bank) -> bool`, `can_edit_bank(db, user, bank) -> bool`, and managed catalog rows with `accessMode` equal to `admin` or `teacher` for organization-wide access.

- [ ] **Step 1: Write failing cross-teacher catalog tests**

Add a test that creates a bank owned by teacher A, logs in as teacher B, and asserts managed list/read access plus writable mode access:

```python
def test_teacher_can_manage_another_teachers_bank(client, seeded_teacher_pair):
    owner, collaborator = seeded_teacher_pair
    _login(client, owner.username)
    created = client.post("/api/v1/banks", json={"name": "共享题库", "subject": "PMP"})
    bank_id = created.json()["bank"]["id"]

    _login(client, collaborator.username)
    managed = client.get("/api/v1/question-catalog/banks?mode=managed")
    writable = client.get("/api/v1/question-catalog/banks?mode=writable")

    assert bank_id in {row["id"] for row in managed.json()["banks"]}
    assert bank_id in {row["id"] for row in writable.json()["banks"]}
```

Also assert a student receives 403 from managed catalog routes.

- [ ] **Step 2: Run the focused test and confirm the owner filter fails it**

Run: `cd backend && .venv/bin/python -m pytest tests/test_question_catalog.py -k "another_teachers_bank" -q`

Expected: FAIL because teacher B cannot see teacher A's bank.

- [ ] **Step 3: Change bank access to the confirmed role rule**

Implement this policy before collaborator fallback:

```python
TEACHING_MANAGER_ROLES = frozenset({"admin", "teacher"})

async def can_view_bank(db, user, bank):
    if user.role in TEACHING_MANAGER_ROLES:
        return True
    if bank.owner_id == user.username:
        return True
    return await _collaborator_permission(db, user.username, bank.id) in {"view", "edit"}

async def can_edit_bank(db, user, bank):
    if user.role in TEACHING_MANAGER_ROLES:
        return True
    if bank.owner_id == user.username:
        return True
    return await _collaborator_permission(db, user.username, bank.id) == "edit"
```

In `list_catalog_banks`, do not add an owner/collaborator filter for either teaching-manager role. Return `accessMode: "teacher"` for a teacher who is not the original owner.

- [ ] **Step 4: Run catalog and lock regressions**

Run: `cd backend && .venv/bin/python -m pytest tests/test_question_catalog.py tests/test_question_edit_locks.py -q`

Expected: PASS; question edit locks still serialize two teachers editing the same question.

- [ ] **Step 5: Commit the policy unit**

```bash
git add backend/app/services/question_access_service.py backend/app/services/question_catalog_service.py backend/tests/test_question_catalog.py
git commit -m "feat: share managed question banks across teachers"
```

### Task 2: Canonicalize teacher draft runtime keys

**Files:**
- Modify: `backend/app/services/runtime_state_service.py:117-191,268-306,405-431,628-725`
- Modify: `backend/app/web/bootstrap.py:28-78`
- Modify: `backend/app/web/routes.py:263-294`
- Test: `backend/tests/test_runtime_shared_policy.py`

**Interfaces:**
- Produces: `canonical_teacher_shared_key(key: str, role: str) -> str | None` and `teacher_shared_aliases(owner: str, role: str) -> dict[str, str]`.
- Canonical exact keys: `kg_course_config_drafts_v1`, `kg_assessment_papers_v1`.
- Canonical dynamic keys: current user's `kg_exam_papers_v1__user__<encoded username>` and `kg_exam_paper_categories_v1__user__<encoded username>` map to `...__teacher_shared`; `kg_recall_association_library_v1__subject__<subject>` remains the same canonical key.

- [ ] **Step 1: Add failing alias/read/write tests**

Write tests with admin, teacher A, teacher B, and student. Teacher A writes a scoped paper key and a course draft; teacher B must receive the same values under teacher B's own scoped paper key. Student storage must not contain either draft.

```python
teacher_a_key = f"kg_exam_papers_v1__user__{quote(teacher_a.username, safe='')}"
teacher_b_key = f"kg_exam_papers_v1__user__{quote(teacher_b.username, safe='')}"
await runtime_state_service.apply_update(db, teacher_a.username, "teacher", update_for(teacher_a_key, "[]"))
storage, _ = await runtime_state_service.get_state(db, teacher_b.username, "teacher")
assert storage[teacher_b_key] == "[]"
```

In the same matrix, verify identical administrator/teacher reads and writes for subjects, current and historical taxonomies, training configurations, principles, synthesis cards/presets, recall associations, paper drafts/categories/releases, course drafts/releases, learning tasks, tags, and collections. Assert personal graph, learning-progress, attempt-history, layout, and preference keys remain different per account.

- [ ] **Step 2: Verify the current account-scoped behavior fails**

Run: `cd backend && .venv/bin/python -m pytest tests/test_runtime_shared_policy.py -k "teacher_draft" -q`

Expected: FAIL because the second teacher sees no first-teacher paper draft.

- [ ] **Step 3: Implement role-aware canonical keys**

Add constants and pure helpers:

```python
TEACHER_SHARED_EXACT_KEYS = frozenset({
    "kg_course_config_drafts_v1",
    "kg_assessment_papers_v1",
})
TEACHER_SHARED_SCOPED_PREFIXES = {
    "kg_exam_papers_v1__": "kg_exam_papers_v1__teacher_shared",
    "kg_exam_paper_categories_v1__": "kg_exam_paper_categories_v1__teacher_shared",
}
TEACHER_SHARED_GLOBAL_PREFIXES = ("kg_recall_association_library_v1__subject__",)
```

Change `get_state` to accept `role`, merge canonical shared rows, and expose scoped canonical rows through the requesting user's expected alias. Change mutation routing to store the canonical key in `shared_runtime_states`. Do not canonicalize for students/viewers.

- [ ] **Step 4: Pass role from every bootstrap/state route call**

Use `get_state(db, user.username, user.role)` in `build_bootstrap`, the runtime GET route, and any seed refresh that reloads storage. Keep personal runtime revision separate from shared-row schema versions.

- [ ] **Step 5: Run runtime policy and web runtime suites**

Run: `cd backend && .venv/bin/python -m pytest tests/test_runtime_shared_policy.py tests/test_runtime_state.py tests/test_web_runtime.py -q`

Expected: PASS, including 403/conflict behavior for forbidden roles.

- [ ] **Step 6: Commit the shared runtime namespace**

```bash
git add backend/app/services/runtime_state_service.py backend/app/web/bootstrap.py backend/app/web/routes.py backend/tests/test_runtime_shared_policy.py
git commit -m "feat: share teacher draft runtime data"
```

### Task 3: Make relational paper APIs role-shared

**Files:**
- Modify: `backend/app/api/v1/questions.py:104-166`
- Modify: `backend/app/services/question_service.py:291-390`
- Modify: `backend/app/models/question.py:84-101`
- Create: `backend/alembic/versions/1f4c2a9d7e10_add_shared_paper_audit_fields.py`
- Test: `backend/tests/test_question_api_compatibility.py`

**Interfaces:**
- Paper service functions accept `actor: User`, not a username string.
- `ExamPaper` gains `revision`, `created_by`, and `updated_by`; `owner_id` remains the original creator for audit only.
- Paper list/get/update/delete/compose/publish accepts any `admin` or `teacher` and rejects other roles through `managePapers`/`publishPapers` dependencies.

- [ ] **Step 1: Write failing cross-role paper tests**

```python
def test_teacher_can_edit_another_teachers_paper(client, teacher_a, teacher_b):
    login(client, teacher_a)
    paper = client.post("/api/v1/papers", json={"name": "公共试卷", "subject": "PMP"}).json()["paper"]
    login(client, teacher_b)
    response = client.put(f"/api/v1/papers/{paper['id']}", json={"name": "共同维护试卷", "revision": paper["revision"]})
    assert response.status_code == 200
    assert response.json()["paper"]["updatedBy"] == teacher_b.username
```

Add a student case expecting 403.

- [ ] **Step 2: Run the paper API test and confirm owner isolation fails it**

Run: `cd backend && .venv/bin/python -m pytest tests/test_question_api_compatibility.py -k "another_teachers_paper" -q`

Expected: FAIL with 404/owner mismatch.

- [ ] **Step 3: Add audit fields and migration**

Add non-null `revision` with server/default `1`, nullable `created_by`/`updated_by` FKs with `SET NULL`, and backfill both actor fields from `owner_id` in the migration. Implement downgrade by dropping the three columns and related indexes/constraints.

- [ ] **Step 4: Replace username checks with permission-scoped actor operations**

Use `PaperManager = require_permissions("managePapers")` and `PaperPublisher = require_permissions("managePapers", "publishPapers")`. List all non-deleted papers, set original `owner_id` only at creation, increment `revision`, and set `updated_by` on every mutation. Compose from all managed banks rather than `QuestionBank.owner_id == actor.username`.

- [ ] **Step 5: Run migration and paper tests**

Run: `cd backend && .venv/bin/alembic upgrade head`

Run: `cd backend && .venv/bin/python -m pytest tests/test_question_api_compatibility.py tests/test_question_catalog.py -q`

Expected: PASS.

- [ ] **Step 6: Commit paper access**

```bash
git add backend/app/api/v1/questions.py backend/app/services/question_service.py backend/app/models/question.py backend/alembic/versions/1f4c2a9d7e10_add_shared_paper_audit_fields.py backend/tests/test_question_api_compatibility.py
git commit -m "feat: share paper APIs across teachers"
```

### Task 4: Add a monotonic teaching-content revision

**Files:**
- Create: `backend/app/services/teaching_content_revision_service.py`
- Modify: `backend/app/services/__init__.py`
- Modify: `backend/app/schemas/question_catalog.py`
- Modify: `backend/app/schemas/content_prep.py`
- Modify: `backend/app/api/v1/question_catalog.py`
- Create: `backend/tests/test_teaching_content_revision.py`

**Interfaces:**
- Produces: `bump(db, actor_username: str, changes: list[dict[str, str]]) -> dict` and `current(db) -> dict`.
- Shared row key: `kg_teaching_content_revision_v1`.
- Payload: `{ "revision": int, "changes": [{"entityType": str, "entityId": str, "action": str}], "updatedAt": str, "updatedBy": str }`.
- API: `GET /api/v1/question-catalog/revision` for `accessQuestionBank` roles.

- [ ] **Step 1: Write failing service and endpoint tests**

```python
async def test_bump_is_monotonic_and_compact(db, teacher):
    first = await revision_service.bump(db, teacher.username, [{"entityType": "question", "entityId": "q1", "action": "updated"}])
    second = await revision_service.bump(db, teacher.username, [{"entityType": "principle", "entityId": "p1", "action": "created"}])
    assert second["revision"] == first["revision"] + 1
    assert second["changes"] == [{"entityType": "principle", "entityId": "p1", "action": "created"}]
```

- [ ] **Step 2: Run and verify the missing service fails**

Run: `cd backend && .venv/bin/python -m pytest tests/test_teaching_content_revision.py -q`

Expected: FAIL because the module and endpoint do not exist.

- [ ] **Step 3: Implement the locked shared-row revision**

Acquire `pg_advisory_xact_lock(hashtextextended(:key, 0))`, select the shared row with `FOR UPDATE`, parse an absent row as revision `0`, write revision `+1`, and `flush` without committing. Normalize changes by unique `(entityType, entityId, action)` and cap the list at 100 entries.

- [ ] **Step 4: Add response fields**

Add `contentRevision` to managed bootstrap and Content Prep batch/question-save results. Keep `catalogRevision` as the question snapshot hash for backward compatibility.

- [ ] **Step 5: Run revision and schema suites**

Run: `cd backend && .venv/bin/python -m pytest tests/test_teaching_content_revision.py tests/test_question_catalog.py tests/test_question_content_service.py -q`

Expected: PASS.

- [ ] **Step 6: Commit the revision protocol**

```bash
git add backend/app/services/teaching_content_revision_service.py backend/app/services/__init__.py backend/app/schemas/question_catalog.py backend/app/schemas/content_prep.py backend/app/api/v1/question_catalog.py backend/tests/test_teaching_content_revision.py
git commit -m "feat: add teaching content revision protocol"
```

### Task 5: Bump revisions and keep principle projections consistent

**Files:**
- Create: `backend/app/services/teaching_content_projection_service.py`
- Modify: `backend/app/services/question_service.py`
- Modify: `backend/app/services/content_prep_service.py:592-675,952-1095`
- Modify: `backend/app/services/runtime_state_service.py:628-725`
- Test: `backend/tests/test_teaching_content_revision.py`
- Test: `backend/tests/test_question_content_service.py`

**Interfaces:**
- Produces: `write_principle_projection(db, actor_username) -> None` and `apply_principle_projection(db, actor_username, key, value) -> list[dict]`.
- Relational principle/preset tables are canonical; shared keys `kg_principle_repository_v1` and `kg_synthesis_preset_repository_v1` are synchronous runtime projections.

- [ ] **Step 1: Write failing transaction/projection tests**

Assert a Content Prep batch creates a principle row, updates the shared projection, and increments content revision exactly once. Assert a shared-runtime principle edit updates the relational row and increments exactly once. Assert a rejected batch changes neither projection nor revision.

- [ ] **Step 2: Run and verify the projection tests fail**

Run: `cd backend && .venv/bin/python -m pytest tests/test_teaching_content_revision.py tests/test_question_content_service.py -k "projection or revision" -q`

Expected: FAIL because current writes do not share a revision/projection transaction.

- [ ] **Step 3: Implement deterministic projection serialization**

Serialize principles as `{schemaVersion: 1, items: [...], updatedAt: <ms>}` and presets with the same top-level shape. Map snake_case ORM fields to the existing browser camelCase contract. On shared edits, upsert present rows and mark missing rows inactive; do not hard-delete referenced principles.

- [ ] **Step 4: Hook all teaching mutations before commit**

Call `bump` once per bank/question/paper mutation, once per Content Prep batch, and once per runtime request that contains one or more teaching-shared mutations. Use a single change list for the whole transaction. Write the principle projection after `_upsert_principles` and `_upsert_presets`, before the upload transaction commits.

- [ ] **Step 5: Run backend regression suites**

Run: `cd backend && .venv/bin/python -m pytest tests/test_teaching_content_revision.py tests/test_question_catalog.py tests/test_question_content_service.py tests/test_runtime_shared_policy.py -q`

Expected: PASS, including rollback assertions.

- [ ] **Step 6: Commit projection and mutation hooks**

```bash
git add backend/app/services/teaching_content_projection_service.py backend/app/services/question_service.py backend/app/services/content_prep_service.py backend/app/services/runtime_state_service.py backend/tests/test_teaching_content_revision.py backend/tests/test_question_content_service.py
git commit -m "feat: publish teaching content changes atomically"
```

### Task 6: Add same-browser broadcast and remote revision polling

**Files:**
- Create: `frontend/scripts/new-legacy-assets/teaching-content-sync.js`
- Modify: `frontend/scripts/new-legacy-assets/question-catalog-adapter.js:1-151`
- Modify: `frontend/scripts/new-legacy-assets/server-state-bootstrap.js:1-289`
- Modify: `frontend/scripts/sync-new-legacy.js:630-690`
- Modify: `new-legacy/content-prep-studio/src/index.template.html`
- Modify: `new-legacy/content-prep-studio/src/js/35-server-catalog-service.js:200-230`
- Modify: `new-legacy/content-prep-studio/src/js/45-server-events.js:100-135`
- Create: `new-legacy/tests/teaching-content-live-sync.test.js`

**Interfaces:**
- Produces global `KGTeachingContentSync` with `publish(detail)`, `subscribe(listener)`, `startPolling({getRevision, onAdvance, intervalMs})`, and `stopPolling()`.
- Channel name: `kg-teaching-content-v1`.
- Poll interval: 10 seconds while visible; immediate check on `focus` and `visibilitychange` to visible.

- [ ] **Step 1: Write a failing Node contract test**

The test must assert injection order and public API names, and simulate two VM windows sharing a fake channel. Publishing revision `2` in window A must call window B's reload once; publishing revision `2` again must not reload twice.

```javascript
assert.match(syncAsset, /kg-teaching-content-v1/)
for (const name of ['publish','subscribe','startPolling','stopPolling']) {
  assert.match(syncAsset, new RegExp(`\\b${name}\\b`))
}
```

- [ ] **Step 2: Run and confirm the missing asset fails**

Run: `node new-legacy/tests/teaching-content-live-sync.test.js`

Expected: FAIL because `teaching-content-sync.js` is absent.

- [ ] **Step 3: Implement the sync asset**

Use `BroadcastChannel` when available and a `storage`-event fallback otherwise. Keep `lastSeenRevision` in memory, debounce listeners by 80 ms, ignore messages at or below the current revision, and close timers/channel on `pagehide`.

- [ ] **Step 4: Wire catalog and runtime refreshes**

After a successful bank/question/content-prep mutation, publish the returned `contentRevision`. Managed catalog pages subscribe and call `reload()`. Server-state bootstrap subscribes, calls `reloadServerState()`, and emits `kg:server-state-reloaded`. Do not overwrite pending local mutations; `reloadServerState()` must reapply them after the server snapshot. When a question/principle/preset editor is dirty, refresh read-only lists and statistics but leave form fields untouched, mark the form “服务器有新版本”, and require an explicit reload/merge action.

- [ ] **Step 5: Inject the asset in source and generated pages**

Copy the asset through the existing release asset map, inject it before `server-state-bootstrap.js` and `question-catalog-adapter.js`, and add the absolute application-served script to the Content Prep template. Offline Content Prep must continue when the global is absent.

- [ ] **Step 6: Run contract and sync-pipeline tests**

Run: `node new-legacy/tests/teaching-content-live-sync.test.js`

Run: `node new-legacy/tests/content-prep-question-bank-integration.test.js`

Run: `node --test frontend/scripts/new-legacy-release.test.mjs frontend/scripts/online-qa-regressions.test.mjs`

Expected: PASS.

- [ ] **Step 7: Commit live sync**

```bash
git add frontend/scripts/new-legacy-assets/teaching-content-sync.js frontend/scripts/new-legacy-assets/question-catalog-adapter.js frontend/scripts/new-legacy-assets/server-state-bootstrap.js frontend/scripts/sync-new-legacy.js new-legacy/content-prep-studio/src/index.template.html new-legacy/content-prep-studio/src/js/35-server-catalog-service.js new-legacy/content-prep-studio/src/js/45-server-events.js new-legacy/tests/teaching-content-live-sync.test.js new-legacy/tests/content-prep-question-bank-integration.test.js
git commit -m "feat: refresh teacher pages after content saves"
```

### Task 7: Move teacher workbench metrics to shared data and run cross-account E2E

**Files:**
- Modify: `new-legacy/teacher-workbench.html:120-145`
- Modify: `new-legacy/src/91-teacher-workbench-app.js:1-73`
- Modify: `frontend/scripts/sync-new-legacy.js:666-689`
- Modify: `new-legacy/tests/v90-p358-teacher-workbench-navigation.test.js`
- Create: `frontend/e2e/shared_teacher_workspace.py`

**Interfaces:**
- Teacher workbench consumes `KGQuestionCatalogAdapter.snapshot()` for banks/questions and canonical shared runtime paper/course/task keys for counts.
- It rerenders on `kg:question-catalog-changed` and `kg:server-state-reloaded`.

- [ ] **Step 1: Write failing workbench contract and browser assertions**

Assert `teacher-workbench.html` receives managed catalog injection, the app no longer reads `kg_question_banks_v1__<user>`, and two contexts see the same question/paper/course counts after teacher A writes.

- [ ] **Step 2: Run the focused tests and verify account-local reads fail**

Run: `node new-legacy/tests/v90-p358-teacher-workbench-navigation.test.js`

Run: `cd frontend && E2E_BASE_URL=http://127.0.0.1:8000 python e2e/shared_teacher_workspace.py`

Expected: static or E2E failure before workbench migration.

- [ ] **Step 3: Replace account-local workbench reads**

Wait for `KGQuestionCatalogAdapter.ready`, derive complete/pending question counts from the managed snapshot, read canonical shared paper/course/task data from `KGAppStorage`, and rerender on both change events. Keep personal workbench subject/filter preferences account-scoped.

- [ ] **Step 4: Complete the role matrix E2E**

The script must cover admin, teacher A, teacher B, student, and viewer. It must create, edit, and delete a question from different manager accounts; verify student/viewer management denial; save in Content Prep; and assert the already-open teacher page updates without `page.reload()`.

- [ ] **Step 5: Run all plan-1 verification**

Run: `cd backend && .venv/bin/python -m pytest tests/ -q`

Run: `node new-legacy/tests/teaching-content-live-sync.test.js && node new-legacy/tests/content-prep-question-bank-integration.test.js && node new-legacy/tests/v90-p358-teacher-workbench-navigation.test.js`

Run: `cd frontend && E2E_BASE_URL=http://127.0.0.1:8000 python e2e/shared_teacher_workspace.py`

Expected: PASS.

- [ ] **Step 6: Commit the workbench/E2E unit**

```bash
git add new-legacy/teacher-workbench.html new-legacy/src/91-teacher-workbench-app.js frontend/scripts/sync-new-legacy.js new-legacy/tests/v90-p358-teacher-workbench-navigation.test.js frontend/e2e/shared_teacher_workspace.py
git commit -m "test: verify shared teacher workspace end to end"
```

## Plan 1 Completion Gate

- Administrator and two teacher accounts pass the full CRUD matrix.
- Student/viewer cannot access drafts or management writes.
- Shared papers, categories, course drafts, tasks, principles, and association libraries resolve identically for all managers.
- Content Prep success refreshes an open teacher page without manual reload.
- A failed or conflicted save emits no success notification.
- A remote revision never overwrites a dirty editor form; it refreshes lists/statistics and shows the conflict notice.
- Backend, Node contracts, Playwright E2E, and release-generation tests pass before plan 2 begins.
