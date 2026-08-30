# Teacher/Admin Runtime State Retirement Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Migrate every teacher/admin business workflow to typed domain APIs, remove all online Runtime State dependencies, drop the Runtime tables in UAT, and stop before `main`.

**Architecture:** Preserve the existing native HTML/CSS/JavaScript pages while replacing browser business persistence with shared API clients and domain adapters. Reuse the relational Users, System, Subscriptions, Questions, Papers, Engagement, and Content Prep domains; add a relational course-management domain and a relational teaching-content revision record. Cut pages over in reviewable batches, migrate legacy rows with domain-wins conflict rules, then remove Runtime infrastructure and deploy two gated UAT stages.

**Tech Stack:** FastAPI, Pydantic, async SQLAlchemy, PostgreSQL 15, Alembic, native JavaScript, Node test runner, Playwright/Python browser tests, pnpm, Bash/Docker Compose UAT deployment.

## Global Constraints

- `new-legacy/` is the only manually edited frontend source; generated `frontend/public/new-legacy/` and immutable releases are produced by repository scripts.
- Business data must persist through typed domain APIs and PostgreSQL. Browser storage is limited to explicitly registered device-only UI preferences.
- Domain rows win every source conflict. Runtime data may fill missing rows but may never overwrite existing domain rows.
- No replacement generic KV, preferences, or whole-JSON API may be introduced.
- Every production behavior change follows RED → GREEN → refactor. Do not write production code before observing the targeted test fail.
- Every async SQLAlchemy write flushes required parents, commits, and refreshes returned ORM objects before serialization.
- The final UAT release must make zero `/api/v1/runtime/*` requests on all 12 teacher/admin pages.
- UAT destructive migration requires a verified backup, zero unknown keys, zero parse errors, zero hash mismatches, and zero unresolved conflicts.
- This work may be merged and pushed only to `uat`, using `git -c http.proxy=http://127.0.0.1:7897 push ...`; do not merge or push `main`.
- Deployment target is `https://uat.aihuanpu.com`; production containers, volumes, branch, and public release must remain unchanged.

---

### Task 1: Shared Domain API Client and Device Preference Boundary

**Files:**
- Create: `frontend/scripts/new-legacy-assets/domain-api-client.js`
- Create: `new-legacy/src/28-device-preferences.js`
- Create: `new-legacy/tests/domain-api-client.test.js`
- Create: `new-legacy/tests/device-preferences.test.js`
- Modify: `frontend/scripts/sync-new-legacy.js`
- Modify: `frontend/scripts/new-legacy-sync.test.mjs`
- Modify: `frontend/scripts/runtime-removal-contract.test.mjs`

**Interfaces:**
- Produces: `window.KGDomainApi.request({ method, path, body, signal, timeoutMs, revision }): Promise<object>`.
- Produces: `window.KGDomainApi.ApiError` with `status`, `code`, `detail`, and `retryable`.
- Produces: `window.KGDevicePreferences.getJSON(key, fallback)`, `setJSON(key, value)`, `getString(key, fallback)`, `setString(key, value)`, and `remove(key)`.
- Device preferences accept only keys matching exported immutable exact-key or prefix allowlists and throw `DEVICE_PREFERENCE_KEY_FORBIDDEN` otherwise.

- [ ] **Step 1: Write failing API-client tests**

```js
test('request sends credentials and revision and exposes 409 details', async () => {
  const runtime = bootClient(async (_path, init) => response(409, {
    detail: { code: 'REVISION_CONFLICT', currentRevision: 8 },
  }))
  await assert.rejects(
    runtime.KGDomainApi.request({ method: 'PUT', path: '/api/v1/example/1', body: { name: 'x' }, revision: 7 }),
    error => error.status === 409 && error.code === 'REVISION_CONFLICT' && error.detail.currentRevision === 8,
  )
})

test('request times out without retrying a write', async () => {
  const runtime = bootClient(() => new Promise(() => {}))
  await assert.rejects(
    runtime.KGDomainApi.request({ method: 'POST', path: '/api/v1/example', body: {}, timeoutMs: 5 }),
    error => error.code === 'REQUEST_TIMEOUT' && error.retryable === true,
  )
})
```

- [ ] **Step 2: Run the tests and verify RED**

Run: `cd new-legacy && node --test tests/domain-api-client.test.js`

Expected: FAIL because `domain-api-client.js` and `KGDomainApi` do not exist.

- [ ] **Step 3: Implement the minimal shared client**

```js
class ApiError extends Error {
  constructor(message, { status = 0, code = 'API_ERROR', detail = null, retryable = false } = {}) {
    super(message)
    this.name = 'ApiError'
    Object.assign(this, { status, code, detail, retryable })
  }
}

async function request({ method = 'GET', path, body, signal, timeoutMs = 15000, revision }) {
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort('timeout'), timeoutMs)
  if (signal) signal.addEventListener('abort', () => controller.abort(signal.reason), { once: true })
  const payload = body === undefined ? undefined : { ...body, ...(revision === undefined ? {} : { revision }) }
  try {
    const response = await fetch(path, {
      method,
      credentials: 'include',
      headers: payload === undefined ? { Accept: 'application/json' } : { Accept: 'application/json', 'Content-Type': 'application/json' },
      body: payload === undefined ? undefined : JSON.stringify(payload),
      signal: controller.signal,
    })
    const result = await response.json().catch(() => ({}))
    if (!response.ok) throw fromResponse(response.status, result)
    return result
  } catch (error) {
    if (controller.signal.aborted && !signal?.aborted) throw new ApiError('请求超时，请重试', { code: 'REQUEST_TIMEOUT', retryable: true })
    throw error
  } finally {
    clearTimeout(timer)
  }
}
```

- [ ] **Step 4: Write and verify RED for device preference allowlisting**

```js
assert.throws(
  () => runtime.KGDevicePreferences.setJSON('kg_exam_papers_v1__admin', []),
  error => error.code === 'DEVICE_PREFERENCE_KEY_FORBIDDEN',
)
runtime.KGDevicePreferences.setJSON('kg_global_shortcuts_layout_v1', { collapsed: true })
assert.deepEqual(runtime.KGDevicePreferences.getJSON('kg_global_shortcuts_layout_v1', {}), { collapsed: true })
```

Run: `cd new-legacy && node --test tests/device-preferences.test.js`

Expected: FAIL because the preference module does not exist.

- [ ] **Step 5: Implement the device-only facade and sync injection**

Use frozen exact-key and prefix allowlists for global shortcuts, resizable regions, workspace layouts, font/language/theme, recent selection, and other UI-only keys already approved by the retirement ledger. Reject prefixes for users, questions, papers, courses, subscriptions, content, audits, progress, and shared data. Inject `domain-api-client.js` before domain adapters and `28-device-preferences.js` before business modules.

```js
const EXACT_KEYS = Object.freeze(new Set(['kg_global_shortcuts_layout_v1']))
const PREFIXES = Object.freeze(['kg_resizable_', 'kg_workspace_layout_', 'kg_recent_selection_'])

function assertAllowed(key) {
  if (EXACT_KEYS.has(key) || PREFIXES.some(prefix => key.startsWith(prefix))) return
  const error = new Error(`Device preference key is forbidden: ${key}`)
  error.code = 'DEVICE_PREFERENCE_KEY_FORBIDDEN'
  throw error
}
```

- [ ] **Step 6: Run focused tests and sync contracts**

Run:

```bash
cd new-legacy && node --test tests/domain-api-client.test.js tests/device-preferences.test.js
cd ../frontend && node --test scripts/new-legacy-sync.test.mjs scripts/runtime-removal-contract.test.mjs
```

Expected: PASS with no Runtime endpoint or consumer additions.

- [ ] **Step 7: Commit**

```bash
git add frontend/scripts/new-legacy-assets/domain-api-client.js frontend/scripts/sync-new-legacy.js frontend/scripts/new-legacy-sync.test.mjs frontend/scripts/runtime-removal-contract.test.mjs new-legacy/src/28-device-preferences.js new-legacy/tests/domain-api-client.test.js new-legacy/tests/device-preferences.test.js
git commit -m "feat: add typed domain client and device preferences"
```

---

### Task 2: System, Account, Role, and Subscription Pages Cutover

**Files:**
- Modify: `frontend/scripts/new-legacy-assets/direct-admin-adapter.js`
- Modify: `frontend/scripts/new-legacy-assets/direct-system-adapter.js`
- Modify: `new-legacy/src/29-auth-core.js`
- Modify: `new-legacy/src/31-admin-utils.js`
- Modify: `new-legacy/src/33-user-center.js`
- Modify: `new-legacy/src/34-role-permissions.js`
- Modify: `new-legacy/src/35-user-management.js`
- Modify: `new-legacy/src/36-system-settings.js`
- Modify: `new-legacy/src/37-subscription-core.js`
- Modify: `backend/app/web/runtime_page_policy.json`
- Modify: `frontend/scripts/runtime-page-policy.json`
- Create: `new-legacy/tests/system-account-api-cutover.test.js`
- Modify: `frontend/e2e/full_role_regression.py`
- Modify: `frontend/scripts/runtime-retirement-contract.test.mjs`

**Interfaces:**
- Consumes: `KGDomainApi` and `KGDevicePreferences` from Task 1.
- Produces: user/theme/subscription UI state held in module memory and refreshed from existing Users, System, Auth, and Subscriptions APIs.
- Removes Runtime injection for `user-management.html`, `system-settings.html`, and `admin-settings.html`.

- [ ] **Step 1: Write failing storage and page-policy tests**

```js
for (const source of [authCore, adminUtils, userCenter, rolePermissions, userManagement, systemSettings, subscriptionCore]) {
  assert.doesNotMatch(source, /localStorage\.(?:setItem|removeItem)\([^\n]*(?:kg_local_users|kg_role_themes|kg_student_subscriptions|kg_user_admin_logs)/)
}
for (const page of ['user-management.html', 'system-settings.html', 'admin-settings.html']) {
  assert.equal(policy.runtimePages.includes(page), false)
}
```

Run: `cd new-legacy && node --test tests/system-account-api-cutover.test.js`

Expected: FAIL on existing business-storage writes and current Runtime allowlist entries.

- [ ] **Step 2: Replace business storage with API-backed in-memory state**

- `direct-admin-adapter.js` remains the only mutation boundary for Users API calls.
- `direct-system-adapter.js` hydrates role themes, plan settings, subscriptions, and WeChat configuration into in-memory stores without invoking legacy persistence methods.
- Auth session continues through FastAPI session and `kg_remote_auth_session_v1` in native storage; user lists and logs do not.
- UI-only shortcut and resizable-region state goes through `KGDevicePreferences`.

```js
let roleThemes = Object.freeze([])

async function refreshRoleThemes() {
  const result = await KGDomainApi.request({ path: '/api/v1/system/themes' })
  roleThemes = Object.freeze(result.themes.map(item => Object.freeze({ ...item })))
  return roleThemes
}

function getRoleThemes() {
  return roleThemes
}
```

- [ ] **Step 3: Remove the three pages from both policies**

Keep `backend/app/web/runtime_page_policy.json` and `frontend/scripts/runtime-page-policy.json` byte-equivalent after the edit.

- [ ] **Step 4: Run focused unit and backend API tests**

Run:

```bash
cd new-legacy && node --test tests/system-account-api-cutover.test.js tests/shared-auth-dialog.test.js
cd ../backend && .venv/bin/python -m pytest tests/test_smoke.py tests/test_user_imports.py tests/test_system_settings.py tests/test_subscription_entitlements.py tests/test_subscription_order_cancellation.py tests/test_web_runtime.py -q
```

Expected: PASS.

- [ ] **Step 5: Add and run browser role/network coverage**

For all three pages, record requests and assert no URL contains `/api/v1/runtime/`; test admin success, teacher/student/viewer denial, save/reload, failed API response, login, and logout.

Run: `backend/.venv/bin/python frontend/e2e/full_role_regression.py --pages user-management.html,system-settings.html,admin-settings.html --assert-no-runtime`

Expected: PASS and zero Runtime requests.

- [ ] **Step 6: Commit**

```bash
git add backend/app/web/runtime_page_policy.json frontend/scripts/runtime-page-policy.json frontend/scripts/new-legacy-assets/direct-admin-adapter.js frontend/scripts/new-legacy-assets/direct-system-adapter.js frontend/e2e/full_role_regression.py frontend/scripts/runtime-retirement-contract.test.mjs new-legacy/src new-legacy/tests/system-account-api-cutover.test.js
git commit -m "feat: retire runtime from account and system pages"
```

---

### Task 3: Question and Paper Management Cutover

**Files:**
- Modify: `frontend/scripts/new-legacy-assets/paper-draft-adapter.js`
- Modify: `frontend/scripts/new-legacy-assets/paper-release-adapter.js`
- Modify: `frontend/scripts/new-legacy-assets/question-catalog-adapter.js`
- Modify: `new-legacy/src/60-question-bank.js`
- Modify: `new-legacy/src/65-question-bank-admin.js`
- Modify: `new-legacy/src/98-question-classification.js`
- Modify: `new-legacy/src/teacher/question-bank/safe-delete-service.js`
- Modify: `new-legacy/src/admin/30-reference-index-service.js`
- Modify: both Runtime page policy JSON files
- Create: `new-legacy/tests/question-paper-runtime-free.test.js`
- Modify: `new-legacy/tests/paper-management-api-contract.test.js`
- Modify: `frontend/scripts/paper-release-adapter.test.mjs`
- Modify: `frontend/e2e/shared_teacher_workspace.py`

**Interfaces:**
- Consumes: existing `/api/v1/banks`, `/api/v1/questions`, `/api/v1/papers`, `/api/v1/paper-categories`, and `/api/v1/paper-releases` APIs.
- Produces: no formal question/paper read or write through `localStorage`; layouts use `KGDevicePreferences`.
- Removes Runtime injection for `question-bank.html` and `paper-management.html`.

- [ ] **Step 1: Write failing formal-data boundary tests**

```js
for (const source of [questionBank, questionAdmin, safeDelete, referenceIndex]) {
  assert.doesNotMatch(source, /kg_(?:question_banks|exam_papers|exam_paper_categories|exam_papers_published|exam_paper_release_history)/)
}
assert.doesNotMatch(questionAdmin, /localStorage/)
assert.equal(policy.runtimePages.includes('question-bank.html'), false)
assert.equal(policy.runtimePages.includes('paper-management.html'), false)
```

Run: `cd new-legacy && node --test tests/question-paper-runtime-free.test.js`

Expected: FAIL on compatibility keys and policy entries.

- [ ] **Step 2: Remove Runtime fallbacks and local reference scans**

- Make PaperDraftApi and QuestionCatalogApi required dependencies; render recoverable API errors if absent.
- Replace `admin/30-reference-index-service.js` local key enumeration with Question/Paper API results supplied by the caller.
- Keep only layout/collapse state through `KGDevicePreferences`.
- Keep publish/withdraw authoritative in PaperRelease API and reload state after success.

```js
async function loadReferenceSnapshot() {
  const [banks, papers, releases] = await Promise.all([
    KGDomainApi.request({ path: '/api/v1/banks' }),
    KGDomainApi.request({ path: '/api/v1/papers' }),
    KGDomainApi.request({ path: '/api/v1/paper-releases' }),
  ])
  return { banks: banks.items, papers: papers.items, releases: releases.items }
}
```

- [ ] **Step 3: Remove both pages from Runtime policies**

Update retirement contracts to assert the generated pages have no `server-state-bootstrap.js`.

- [ ] **Step 4: Run API and frontend tests**

```bash
cd backend && .venv/bin/python -m pytest tests/test_question_api_compatibility.py tests/test_paper_draft_api.py tests/test_paper_releases.py tests/test_paper_access_entitlements.py -q
cd ../new-legacy && node --test tests/question-paper-runtime-free.test.js tests/paper-management-api-contract.test.js tests/content-prep-question-bank-integration.test.js
cd ../frontend && node --test scripts/paper-release-adapter.test.mjs scripts/runtime-retirement-contract.test.mjs
```

Expected: PASS.

- [ ] **Step 5: Run real browser CRUD and persistence tests**

Use a UAT-safe test owner to create a bank, question, category, and paper; edit, reload, publish, withdraw, delete, and confirm database/API results. Record zero Runtime requests and clean up created rows through APIs.

Run: `backend/.venv/bin/python frontend/e2e/shared_teacher_workspace.py --question-paper-only --assert-no-runtime`

Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add backend/app/web/runtime_page_policy.json frontend/scripts/runtime-page-policy.json frontend/scripts/new-legacy-assets new-legacy/src new-legacy/tests frontend/e2e/shared_teacher_workspace.py
git commit -m "feat: retire runtime from question and paper management"
```

---

### Task 4: Relational Teaching-Content Revision

**Files:**
- Modify: `backend/app/models/teaching_content.py`
- Modify: `backend/app/models/__init__.py`
- Modify: `backend/app/services/teaching_content_revision_service.py`
- Create: `backend/alembic/versions/b9d2e4f6a810_relational_teaching_content_revision.py`
- Create: `backend/tests/test_teaching_content_revision_relational.py`
- Modify: `backend/tests/test_teaching_content_revision.py`

**Interfaces:**
- Produces model `TeachingContentRevision(id: int = 1, revision: int, changes: list, updated_by: str | None, updated_at: datetime)`.
- Preserves `current(db)`, `acquire_lock(db)`, `acquire_read_lock(db)`, `acquire_cleanup_lock(db)`, `bump(db, actor_username, changes)`, and `bump_cleanup(...)` signatures.
- No revision method imports or queries `SharedRuntimeState`.

- [ ] **Step 1: Write failing relational-service tests**

```python
async def test_bump_uses_relational_revision_without_shared_runtime(db):
    first = await teaching_content_revision_service.bump(db, "admin", [{"entityType": "question", "entityId": "q1", "action": "updated"}])
    await db.commit()
    row = await db.get(TeachingContentRevision, 1)
    assert first["revision"] == row.revision == 1
    assert "SharedRuntimeState" not in inspect.getsource(teaching_content_revision_service)
```

Run: `cd backend && .venv/bin/python -m pytest tests/test_teaching_content_revision_relational.py -q`

Expected: FAIL because the relational model does not exist.

- [ ] **Step 2: Add the model and migration**

Generate the revision, then edit it so upgrade creates the singleton table and backfills from
`shared_runtime_states.key = 'kg_teaching_content_revision_v1'` only when the source parses; otherwise initialize revision 0. Downgrade recreates only the relational table removal, not Runtime data.

```python
op.create_table(
    "teaching_content_revisions",
    sa.Column("id", sa.Integer(), primary_key=True),
    sa.Column("revision", sa.Integer(), nullable=False, server_default="0"),
    sa.Column("changes", postgresql.JSONB(astext_type=sa.Text()), nullable=False, server_default="[]"),
    sa.Column("updated_by", sa.String(length=64), nullable=True),
    sa.Column("updated_at", sa.DateTime(timezone=True), nullable=False, server_default=sa.func.now()),
    sa.CheckConstraint("id = 1", name="ck_teaching_content_revision_singleton"),
)
```

- [ ] **Step 3: Move the service implementation behind the existing interface**

Use the existing PostgreSQL advisory lock key, select singleton row `FOR UPDATE`, create row 1 when absent, increment revision, normalize changes, flush, and return the existing response shape.

```python
row = await db.scalar(
    select(TeachingContentRevision)
    .where(TeachingContentRevision.id == 1)
    .with_for_update()
)
if row is None:
    row = TeachingContentRevision(id=1, revision=0, changes=[])
    db.add(row)
    await db.flush()
row.revision += 1
row.changes = normalize_changes(changes)
row.updated_by = actor_username
await db.flush()
return serialize_revision(row)
```

- [ ] **Step 4: Run focused and dependent tests**

```bash
cd backend && .venv/bin/python -m pytest tests/test_teaching_content_revision_relational.py tests/test_teaching_content_revision.py tests/test_content_prep_shared_content.py tests/test_paper_releases.py -q
```

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add backend/app/models backend/app/services/teaching_content_revision_service.py backend/alembic/versions backend/tests
git commit -m "feat: store teaching revision relationally"
```

---

### Task 5: Teaching Content, Principle, Taxonomy, and Recall API Cutover

**Files:**
- Create: `frontend/scripts/new-legacy-assets/teaching-content-adapter.js`
- Modify: `frontend/scripts/sync-new-legacy.js`
- Modify: `new-legacy/src/91-learning-content-core.js`
- Modify: `new-legacy/src/93-content-organization-core.js`
- Modify: `new-legacy/src/95-recall-association-library.js`
- Modify: `new-legacy/src/principles/principle-repository.js`
- Modify: `new-legacy/src/principles/synthesis-preset-repository.js`
- Modify: `new-legacy/src/admin/11-local-content-repository.js`
- Modify: `new-legacy/src/admin/31-subject-service.js`
- Modify: `new-legacy/src/admin/32-taxonomy-service.js`
- Modify: `new-legacy/src/admin/33-activity-service.js`
- Modify: `new-legacy/src/admin/42-teaching-content-server-gateway.js`
- Modify: `new-legacy/src/admin/53-recall-association-management.js`
- Modify: `new-legacy/content-prep-studio/src/js/45-server-events.js`
- Modify: `backend/app/services/content_prep_shared_service.py`
- Modify: `backend/app/services/teaching_content_projection_service.py`
- Modify: `backend/app/services/question_cleanup_reference_service.py`
- Modify: both Runtime page policy JSON files
- Create: `new-legacy/tests/teaching-content-api-cutover.test.js`
- Create: `backend/tests/test_teaching_content_no_runtime_projection.py`
- Modify: `frontend/e2e/shared_teacher_workspace.py`

**Interfaces:**
- Produces `window.KGTeachingContentApi` methods `bootstrap()`, `saveTaxonomy(input)`, `releaseTaxonomy(id, revision)`, `saveRecallLibrary(subjectId, input)`, `listPrinciples()`, and principle/preset mutation wrappers over existing Content Prep APIs.
- Removes SharedRuntimeState projection writes; principle validation and reference checks operate on relational rows.
- Removes Runtime injection for `admin-subjects.html`, `content-prep.html`, and `content-center.html`.

- [ ] **Step 1: Write failing backend projection boundary tests**

```python
def test_teaching_services_do_not_depend_on_shared_runtime_state():
    for module in [content_prep_shared_service, teaching_content_projection_service, question_cleanup_reference_service]:
        source = inspect.getsource(module)
        assert "SharedRuntimeState" not in source
        assert "shared_runtime_states" not in source
```

Run: `cd backend && .venv/bin/python -m pytest tests/test_teaching_content_no_runtime_projection.py -q`

Expected: FAIL on current projection and cleanup imports.

- [ ] **Step 2: Refactor backend reads/writes to relational rows**

- Return taxonomy, activities, recall libraries, principles, and presets directly from relational models.
- Keep validation/merge/reference functions but delete `_write_row`, `projection_rows_present`, and projection synchronization.
- Replace cleanup scans of shared keys with queries against ExamPaper, PaperRelease, course/task rows, Principle/SynthesisPreset, and RecallAssociationLibrary.

```python
async def shared_content(db: AsyncSession, *, owner: str) -> dict[str, object]:
    return {
        "taxonomies": await taxonomy_repository.list_for_owner(db, owner),
        "activities": await activity_repository.list_for_owner(db, owner),
        "recallLibraries": await recall_repository.list_for_owner(db, owner),
        "principles": await principle_repository.list_for_owner(db, owner),
        "presets": await synthesis_preset_repository.list_for_owner(db, owner),
        "revision": await teaching_content_revision_service.current(db),
    }
```

- [ ] **Step 3: Write failing frontend boundary tests**

```js
for (const source of teachingSources) {
  assert.doesNotMatch(source, /localStorage/)
  assert.doesNotMatch(source, /kg_(?:content_|course_config|activity_|learning_tasks|principle_repository|synthesis_preset|recall_association)/)
}
for (const page of ['admin-subjects.html', 'content-prep.html', 'content-center.html']) {
  assert.equal(policy.runtimePages.includes(page), false)
}
```

Run: `cd new-legacy && node --test tests/teaching-content-api-cutover.test.js`

Expected: FAIL.

- [ ] **Step 4: Implement adapter-backed repositories**

Keep existing public `KGLearningContent`, `KGAdminServices`, principle repository, and recall library interfaces used by page controllers, but make their data source the new adapter and in-memory snapshots. Save methods return promises and page controllers await them before success feedback.

```js
async function bootstrap() {
  snapshot = await KGDomainApi.request({ path: `/api/v1/content-prep/shared-content?subjectId=${encodeURIComponent(subjectId)}` })
  return structuredClone(snapshot)
}

async function saveTaxonomy(input) {
  const body = { ...serializeSharedContent(snapshot), knowledgeTree: input }
  snapshot = await KGDomainApi.request({ method: 'PUT', path: '/api/v1/content-prep/shared-content', body })
  return structuredClone(snapshot.knowledgeTree)
}
```

- [ ] **Step 5: Remove the three pages from policies and rebuild Content Prep**

Run: `python3 new-legacy/content-prep-studio/build.py`

- [ ] **Step 6: Run focused tests**

```bash
cd backend && .venv/bin/python -m pytest tests/test_teaching_content_no_runtime_projection.py tests/test_content_prep_shared_content.py tests/test_content_prep_banks_and_refs.py tests/test_question_pool_cleanup.py -q
cd ../new-legacy && node --test tests/teaching-content-api-cutover.test.js tests/content-prep-question-bank-integration.test.js
cd ../frontend && pnpm test:design
```

Expected: PASS.

- [ ] **Step 7: Run browser publish/reload/conflict tests**

Create and edit a taxonomy/principle/recall item, reload and re-login, force one stale revision and recover, assert the relational API result and zero Runtime requests on all three pages.

- [ ] **Step 8: Commit**

```bash
git add backend/app/services backend/tests frontend/scripts/new-legacy-assets frontend/scripts/sync-new-legacy.js frontend/scripts/runtime-page-policy.json frontend/e2e/shared_teacher_workspace.py new-legacy backend/app/web/runtime_page_policy.json
git commit -m "feat: retire runtime teaching content projections"
```

---

### Task 6: Relational Course Drafts, Releases, and Learning Tasks API

**Files:**
- Create: `backend/app/models/course_management.py`
- Modify: `backend/app/models/__init__.py`
- Create: `backend/app/schemas/course_management.py`
- Create: `backend/app/services/course_management_service.py`
- Create: `backend/app/api/v1/course_management.py`
- Modify: `backend/app/api/v1/router.py`
- Create: `backend/alembic/versions/ca3f5a7b9d20_course_management_domain.py`
- Create: `backend/tests/test_course_management.py`

**Interfaces:**
- Produces `CourseDraft`, `CourseRelease`, and `LearningTask` ORM models.
- Produces routes under `/api/v1/course-management`:
  - `GET/POST /drafts`
  - `GET/PUT/DELETE /drafts/{draft_id}`
  - `POST /drafts/{draft_id}/publish`
  - `GET /releases` and `GET /releases/{release_id}`
  - `POST /releases/{release_id}/withdraw`
  - `GET/POST /tasks`
  - `GET/PUT/DELETE /tasks/{task_id}`
- Every mutable DTO carries `revision`; stale mutation raises domain conflict mapped to HTTP 409.

- [ ] **Step 1: Write failing API tests**

```python
def test_course_draft_publish_and_task_lifecycle(client, admin_login):
    draft = client.post("/api/v1/course-management/drafts", json={"name": "PMP", "structure": {"nodes": []}}).json()["draft"]
    release = client.post(f"/api/v1/course-management/drafts/{draft['id']}/publish", json={"revision": draft["revision"]}).json()["release"]
    task = client.post("/api/v1/course-management/tasks", json={"title": "第一阶段", "releaseId": release["id"], "audience": {"roles": ["student"]}}).json()["task"]
    assert task["releaseId"] == release["id"]

def test_course_draft_rejects_stale_revision(client, admin_login):
    draft = create_draft(client)
    client.put(f"/api/v1/course-management/drafts/{draft['id']}", json={"revision": draft["revision"], "name": "v2"})
    response = client.put(f"/api/v1/course-management/drafts/{draft['id']}", json={"revision": draft["revision"], "name": "stale"})
    assert response.status_code == 409
```

Run: `cd backend && .venv/bin/python -m pytest tests/test_course_management.py -q`

Expected: FAIL with 404 because the router does not exist.

- [ ] **Step 2: Implement models and migration**

Use UUID/string IDs, owner and actor foreign keys, JSONB structure/audience, integer revision, immutable release snapshot, timestamps, and status constraints. Add models to `models/__init__.py` before autogenerate.

```python
class CourseDraft(Base):
    __tablename__ = "course_drafts"
    id: Mapped[str] = mapped_column(String(64), primary_key=True)
    owner_id: Mapped[str] = mapped_column(ForeignKey("users.username", ondelete="CASCADE"), index=True)
    name: Mapped[str] = mapped_column(String(255))
    structure: Mapped[dict] = mapped_column(JSONB, default=dict)
    revision: Mapped[int] = mapped_column(Integer, default=1)
    status: Mapped[str] = mapped_column(String(32), default="draft")
```

- [ ] **Step 3: Implement service and typed API**

Use atomic `UPDATE ... WHERE revision = :expected RETURNING id` for optimistic concurrency. Publish flushes the draft, creates an immutable release, updates active status in the same transaction, commits, and refreshes both records.

```python
statement = (
    update(CourseDraft)
    .where(CourseDraft.id == draft_id, CourseDraft.owner_id == owner, CourseDraft.revision == expected_revision)
    .values(**changes, revision=CourseDraft.revision + 1)
    .returning(CourseDraft.id)
)
if await db.scalar(statement) is None:
    raise RevisionConflict(draft_id=draft_id)
await db.commit()
draft = await db.get(CourseDraft, draft_id)
await db.refresh(draft)
return draft
```

- [ ] **Step 4: Run course tests and full migration check**

```bash
cd backend && .venv/bin/python -m pytest tests/test_course_management.py -q
.venv/bin/alembic upgrade head
.venv/bin/alembic current
```

Expected: PASS and current revision equals the new head.

- [ ] **Step 5: Commit**

```bash
git add backend/app/models backend/app/schemas backend/app/services/course_management_service.py backend/app/api/v1 backend/alembic/versions backend/tests/test_course_management.py
git commit -m "feat: add relational course management api"
```

---

### Task 7: Course, Teacher Workbench, and Admin Operations Cutover

**Files:**
- Create: `frontend/scripts/new-legacy-assets/course-management-adapter.js`
- Modify: `frontend/scripts/sync-new-legacy.js`
- Modify: `new-legacy/src/91-learning-content-core.js`
- Modify: `new-legacy/src/91-course-admin-app.js`
- Modify: `new-legacy/src/91-teacher-workbench-app.js`
- Modify: `new-legacy/src/93-content-organization-core.js`
- Modify: `new-legacy/src/admin/34-course-service.js`
- Modify: `new-legacy/src/admin/35-release-service.js`
- Modify: `new-legacy/src/admin/11-local-content-repository.js`
- Modify: `new-legacy/admin-console.html`
- Modify: `new-legacy/admin-operations.html`
- Modify: both Runtime page policy JSON files
- Create: `new-legacy/tests/course-management-api-cutover.test.js`
- Create: `frontend/e2e/admin_runtime_retirement.py`

**Interfaces:**
- Produces `window.KGCourseManagementApi` matching Task 6 routes.
- Existing `KGLearningContent` and `KGAdminServices` course/task methods delegate to the adapter and return promises.
- Removes the final Runtime policy entries: `course-admin.html`, `teacher-workbench.html`, `admin-console.html`, and `admin-operations.html`.

- [ ] **Step 1: Write failing frontend contract**

```js
for (const source of courseSources) {
  assert.doesNotMatch(source, /localStorage/)
  assert.doesNotMatch(source, /kg_(?:course_config|learning_tasks|assessment_papers)/)
}
assert.deepEqual(policy.runtimePages, [])
```

Run: `cd new-legacy && node --test tests/course-management-api-cutover.test.js`

Expected: FAIL.

- [ ] **Step 2: Implement the adapter and async controller flow**

Load list/detail from Task 6 APIs. On save/publish/withdraw/task mutation, await the server result, replace the in-memory snapshot, and render. On 409, reload latest data and show the existing explicit retry UI. Local recent subject/workspace layout uses `KGDevicePreferences` only.

```js
async function updateDraft(id, patch, revision) {
  return KGDomainApi.request({
    method: 'PUT',
    path: `/api/v1/course-management/drafts/${encodeURIComponent(id)}`,
    body: patch,
    revision,
  })
}
```

- [ ] **Step 3: Make admin console/operations consume domain summaries**

Replace local repository aggregates with existing system logs, engagement, teaching-content, question, paper, and course-management API responses. Do not create a dashboard snapshot KV.

```js
const [logs, engagement, teaching, banks, papers, courses] = await Promise.all([
  KGDomainApi.request({ path: '/api/v1/system/logs' }),
  Promise.all([
    KGDomainApi.request({ path: '/api/v1/engagement/admin/feedback' }),
    KGDomainApi.request({ path: '/api/v1/engagement/admin/messages' }),
  ]),
  KGTeachingContentApi.bootstrap(),
  KGDomainApi.request({ path: '/api/v1/banks' }),
  KGDomainApi.request({ path: '/api/v1/papers' }),
  KGDomainApi.request({ path: '/api/v1/course-management/drafts' }),
])
```

- [ ] **Step 4: Empty both Runtime policies**

Keep the files temporarily with `{ "runtimePages": [] }` so Task 9 can prove the cutover before deleting the policy mechanism.

- [ ] **Step 5: Run frontend and backend tests**

```bash
cd new-legacy && node --test tests/course-management-api-cutover.test.js
cd ../backend && .venv/bin/python -m pytest tests/test_course_management.py tests/test_system_settings.py tests/test_engagement_relational.py -q
cd ../frontend && node --test scripts/runtime-retirement-contract.test.mjs scripts/new-legacy-sync.test.mjs
```

Expected: PASS.

- [ ] **Step 6: Run 12-page browser matrix locally**

Run: `backend/.venv/bin/python frontend/e2e/admin_runtime_retirement.py --base-url http://127.0.0.1:5173 --all-pages`

The script must test role access, login/logout, one real read and write per applicable page, refresh persistence, one API failure/recovery, zero Runtime requests, zero page errors, native localStorage, and absence of `KGServerStateStorage`.

- [ ] **Step 7: Commit**

```bash
git add backend/app/web/runtime_page_policy.json frontend/scripts/runtime-page-policy.json frontend/scripts/new-legacy-assets/course-management-adapter.js frontend/scripts/sync-new-legacy.js frontend/e2e/admin_runtime_retirement.py new-legacy
git commit -m "feat: complete teacher admin api cutover"
```

---

### Task 8: Runtime Data Migration, Verification, and Drop Gate

**Files:**
- Create: `backend/app/services/runtime_retirement_service.py`
- Create: `backend/app/cli/runtime_retirement.py`
- Create: `backend/tests/test_runtime_retirement.py`
- Modify: `backend/app/services/files_runtime_migration_service.py`
- Modify: `backend/app/services/question_migration_service.py`
- Modify: `backend/app/services/runtime_domain_migration_service.py`
- Modify: `docs/UAT_DEPLOY.md`

**Interfaces:**
- Produces CLI commands:
  - `python -m app.cli.runtime_retirement scan --report-json PATH`
  - `... migrate --run-id ID --report-json PATH`
  - `... verify --run-id ID --report-json PATH`
  - `... drop-check --run-id ID --report-json PATH`
- `drop-check` exits nonzero unless `unknown == parseErrors == hashMismatches == unresolvedConflicts == 0` and both runtime page policies are empty.
- Reports contain identifiers, dispositions, counts, and hashes, never full business payloads.

- [ ] **Step 1: Write failing migration behavior tests**

```python
async def test_domain_rows_win_and_runtime_only_fills_missing(db):
    await seed_domain_course(db, id="course-1", name="domain")
    await seed_runtime_course(db, id="course-1", name="runtime")
    report = await service.migrate(db, run_id="test")
    assert (await load_course(db, "course-1")).name == "domain"
    assert report.unresolved_conflicts == 1

async def test_drop_check_rejects_unknown_and_hash_mismatch(db):
    report = await service.drop_check(db, run_id="test")
    assert report.ready is False
    assert set(report.blockers) == {"unknown", "hashMismatch"}
```

Run: `cd backend && .venv/bin/python -m pytest tests/test_runtime_retirement.py -q`

Expected: FAIL because the service does not exist.

- [ ] **Step 2: Implement canonical mapping and idempotent migration**

Compose existing files/question/paper/engagement/teaching mappers and add course/task mappings. Classify device preferences and disposable markers explicitly. Use stable source identities and canonical JSON SHA-256. Never include payload text in a report.

```python
def canonical_hash(value: object) -> str:
    payload = json.dumps(value, ensure_ascii=False, sort_keys=True, separators=(",", ":"))
    return hashlib.sha256(payload.encode("utf-8")).hexdigest()

MAPPERS = {
    "kg_course_config_v1": migrate_course_drafts,
    "kg_learning_tasks_v1": migrate_learning_tasks,
    "kg_exam_papers_v1": migrate_papers,
}
```

- [ ] **Step 3: Implement verify and drop-check**

Verify target hashes inside a repeatable-read transaction. Require empty page policies and source dispositions for every key. Return exit code 2 for blockers and 0 only when ready.

```python
ready = not any((unknown, parse_errors, hash_mismatches, unresolved_conflicts))
return DropCheck(
    ready=ready,
    blockers=[name for name, count in blockers.items() if count],
    source_count=source_count,
    verified_count=verified_count,
)
```

- [ ] **Step 4: Run migration tests and local dry run**

```bash
cd backend && .venv/bin/python -m pytest tests/test_runtime_retirement.py tests/test_files_runtime_migration.py tests/test_question_runtime_migration.py tests/test_runtime_domain_migration_ledger.py -q
.venv/bin/python -m app.cli.runtime_retirement scan --report-json /tmp/runtime-retirement-scan.json
.venv/bin/python -m app.cli.runtime_retirement migrate --run-id local-runtime-retirement-v1 --report-json /tmp/runtime-retirement-migrate.json
.venv/bin/python -m app.cli.runtime_retirement verify --run-id local-runtime-retirement-v1 --report-json /tmp/runtime-retirement-verify.json
.venv/bin/python -m app.cli.runtime_retirement drop-check --run-id local-runtime-retirement-v1 --report-json /tmp/runtime-retirement-drop-check.json
```

Expected: commands exit 0 only after all local blockers have explicit safe dispositions.

- [ ] **Step 5: Commit**

```bash
git add backend/app/services backend/app/cli backend/tests docs/UAT_DEPLOY.md
git commit -m "feat: add runtime retirement migration gate"
```

---

### Task 9: Phase-One Runtime Freeze and Runtime-Free Release

**Files:**
- Modify: `backend/app/core/config.py`
- Modify: `backend/app/web/bootstrap.py`
- Modify: `backend/app/web/routes.py`
- Modify: `backend/tests/test_web_runtime.py`
- Modify: `frontend/scripts/sync-new-legacy.js`
- Delete: `frontend/scripts/runtime-page-policy.json`
- Delete: `backend/app/web/runtime_page_policy.json`
- Delete: `backend/app/web/runtime_policy.py`
- Delete: `frontend/scripts/new-legacy-assets/server-state-bootstrap.js`
- Create: `frontend/scripts/new-legacy-assets/runtime-retirement.json`
- Modify: `frontend/scripts/runtime-retirement-contract.test.mjs`
- Modify: `frontend/scripts/new-legacy-release.test.mjs`

**Interfaces:**
- New releases never inject Runtime and `build_bootstrap` never reads Runtime.
- During phase one, Runtime PUT/POST drain without mutation and GET remains available only for explicit rollback configuration.
- `runtime-retirement.json` contains `{ "schemaVersion": 1, "status": "retired", "runtimeRequests": 0 }` and no executable code.

- [ ] **Step 1: Write failing final release contract**

```js
assert.equal(existsSync(asset('server-state-bootstrap.js')), false)
assert.deepEqual(JSON.parse(readAsset('runtime-retirement.json')), {
  schemaVersion: 1,
  status: 'retired',
  runtimeRequests: 0,
})
for (const page of allHtmlPages) assert.doesNotMatch(readGenerated(page), /server-state-bootstrap\.js/)
```

Run: `cd frontend && node --test scripts/runtime-retirement-contract.test.mjs scripts/new-legacy-release.test.mjs`

Expected: FAIL because the asset and policies still exist.

- [ ] **Step 2: Remove injection/policies and simplify bootstrap**

Delete Runtime page selection. `build_bootstrap` returns auth/release metadata only. Remove Runtime asset copy/version exceptions and add the inert retirement marker to the release asset set.

- [ ] **Step 3: Freeze backend writes by default**

Set `RUNTIME_SYNC_DISABLED = True` for phase-one compatibility and add an explicit `RUNTIME_ROLLBACK_READ_ENABLED = False`. GET returns 410 unless rollback read is enabled; no new page uses it.

- [ ] **Step 4: Run focused tests and create the immutable candidate**

```bash
cd backend && .venv/bin/python -m pytest tests/test_web_runtime.py tests/test_runtime_state.py -q
cd ../frontend && pnpm test
node scripts/manage-new-legacy.js update ../new-legacy --skip-browser
```

Expected: PASS; candidate file count is at least active; all 12 key pages exist; generated site contains no Runtime script.

- [ ] **Step 5: Run local 12-page browser matrix again**

Run: `backend/.venv/bin/python frontend/e2e/admin_runtime_retirement.py --base-url http://127.0.0.1:5173 --all-pages`

Expected: PASS with zero Runtime requests.

- [ ] **Step 6: Commit generated artifacts with source**

```bash
git add backend frontend new-legacy docs
git commit -m "feat: freeze and remove online runtime state"
```

---

### Task 10: Phase-One UAT Integration and Deployment

**Files:**
- Modify: `deploy/update-uat.sh`
- Modify: `docker-compose.uat.yml`
- Modify: `deploy/tests/update-uat-validation.test.sh`
- Create: `docs/verification/2026-08-29-runtime-retirement-uat-phase-one.md`

**Interfaces:**
- UAT deploy runs runtime retirement migrate/verify before normal health completion.
- Phase one preserves old tables but verifies no revisions change after browser traffic.

- [ ] **Step 1: Write a failing deploy-script contract**

Extend the fixture test to require phase-one commands before success:

```bash
grep -q 'runtime_retirement migrate' "$CALL_LOG"
grep -q 'runtime_retirement verify' "$CALL_LOG"
```

Run: `bash deploy/tests/update-uat-validation.test.sh`

Expected: FAIL because `update-uat.sh` does not invoke the new CLI.

- [ ] **Step 2: Add phase-one preflight and post-deploy verify**

Run migration and verify inside the backend container after startup, save reports under `/tmp`, and stop before cleanup if verify exits nonzero. Remove the obsolete paper-only Runtime backfill step.

```bash
docker compose -p "$PROJECT" -f "$COMPOSE_FILE" --env-file "$ENV_FILE" exec -T backend \
  python -m app.cli.runtime_retirement migrate --run-id "$RELEASE_VERSION" --report-json /tmp/runtime-retirement-migrate.json
docker compose -p "$PROJECT" -f "$COMPOSE_FILE" --env-file "$ENV_FILE" exec -T backend \
  python -m app.cli.runtime_retirement verify --run-id "$RELEASE_VERSION" --report-json /tmp/runtime-retirement-verify.json
```

- [ ] **Step 3: Run all deploy fixture tests**

```bash
bash deploy/tests/update-uat-validation.test.sh
bash deploy/tests/update-uat-version-bump.test.sh
```

Expected: PASS.

- [ ] **Step 4: Run fresh full local verification before integration**

```bash
cd backend && .venv/bin/python -m pytest tests/ -q
cd ../frontend && pnpm test
pnpm test:design
cd .. && git diff --check && git status --short
```

Expected: all tests pass and only expected generated/release changes are present.

- [ ] **Step 5: Create/update `uat`, merge, push through the required proxy, and verify remote**

Since no `uat` branch currently exists, create it from the verified feature branch:

```bash
git branch uat codex/runtime-retirement-api-cutover
git switch uat
git -c http.proxy=http://127.0.0.1:7897 push -u origin uat
git ls-remote --heads origin uat
```

Do not switch, merge, or push `main`.

- [ ] **Step 6: Deploy phase one to UAT**

Run: `bash deploy/update-uat.sh`

Expected: public health succeeds, UAT current release equals the local candidate, UAT Alembic head matches, and production version/container IDs remain unchanged.

- [ ] **Step 7: Run public UAT browser and database checks**

```bash
backend/.venv/bin/python frontend/e2e/admin_runtime_retirement.py --base-url https://uat.aihuanpu.com --all-pages
```

Capture before/after Runtime revisions and assert unchanged. Record public asset hashes, UAT active pointer, migration report counts, and production non-change evidence in the verification document.

- [ ] **Step 8: Commit and push the verification record to `uat`**

```bash
git add deploy docs/verification/2026-08-29-runtime-retirement-uat-phase-one.md
git commit -m "chore: verify phase one runtime retirement on uat"
git -c http.proxy=http://127.0.0.1:7897 push origin uat
git ls-remote --heads origin uat
git switch -c codex/runtime-retirement-drop
```

Continue Task 11 on `codex/runtime-retirement-drop`; this preserves the already-deployed phase-one `uat` commit as the merge base for the destructive stage.

---

### Task 11: Remove Runtime Code and Drop Runtime Tables

**Files:**
- Delete: `backend/app/models/runtime_state.py`
- Delete: `backend/app/models/shared_runtime_state.py`
- Delete: `backend/app/models/runtime_migration.py`
- Delete: `backend/app/services/runtime_state_service.py`
- Delete: `backend/app/services/files_runtime_migration_service.py`
- Delete: `backend/app/services/question_migration_service.py`
- Delete: `backend/app/services/runtime_domain_migration_service.py`
- Delete: `backend/app/services/runtime_retirement_service.py`
- Delete: `backend/app/cli/runtime_domain_migration.py`
- Delete: `backend/app/cli/files_runtime_migration.py`
- Delete: `backend/app/cli/runtime_retirement.py`
- Modify: `backend/app/models/__init__.py`
- Modify: `backend/app/api/v1/questions.py`
- Modify: `backend/app/api/v1/papers.py`
- Modify: `backend/app/services/paper_release_service.py`
- Modify: `backend/app/web/routes.py`
- Create: `backend/alembic/versions/d1a4c6e8f230_drop_retired_runtime_tables.py`
- Create: `backend/tests/test_runtime_removed.py`
- Delete or rewrite: Runtime-specific backend/frontend tests
- Modify: `frontend/scripts/runtime-removal-contract.test.mjs`
- Modify: `frontend/scripts/runtime-removal-baseline.json`

**Interfaces:**
- Produces final schema without `runtime_states`, `shared_runtime_states`, `runtime_migration_runs`, or `runtime_migration_items`.
- Produces no `/api/v1/runtime/*`, `/banks/migration/runtime*`, or `/papers/migration/runtime*` routes.
- Keeps historical Alembic migration files immutable; the final drop revision removes the tables.

- [ ] **Step 1: Write failing removal tests**

```python
def test_runtime_routes_models_and_tables_are_absent(client, db_engine):
    assert client.get('/api/v1/runtime/state').status_code == 404
    assert client.get('/api/v1/banks/migration/runtime/scan').status_code == 404
    tables = set(inspect(db_engine).get_table_names())
    assert not tables & {'runtime_states', 'shared_runtime_states', 'runtime_migration_runs', 'runtime_migration_items'}

def test_production_source_has_no_runtime_imports():
    offenders = retirement_source_scan()
    assert offenders == []
```

Run: `cd backend && .venv/bin/python -m pytest tests/test_runtime_removed.py -q`

Expected: FAIL because routes, models, and tables exist.

- [ ] **Step 2: Generate and harden the destructive Alembic revision**

Upgrade must assert the four tables exist, then drop foreign keys/dependencies and tables in dependency order. It must refuse to run unless deployment has set `RUNTIME_RETIREMENT_DROP_APPROVED=true`; tests explicitly set the flag. Downgrade recreates table structures only and documents that data restoration requires the verified dump.

```python
def upgrade() -> None:
    if os.environ.get("RUNTIME_RETIREMENT_DROP_APPROVED") != "true":
        raise RuntimeError("Runtime table drop requires RUNTIME_RETIREMENT_DROP_APPROVED=true")
    bind = op.get_bind()
    expected = {"runtime_states", "shared_runtime_states", "runtime_migration_runs", "runtime_migration_items"}
    if not expected.issubset(set(sa.inspect(bind).get_table_names())):
        raise RuntimeError("Runtime retirement schema precondition failed")
    op.drop_table("runtime_migration_items")
    op.drop_table("runtime_migration_runs")
    op.drop_table("shared_runtime_states")
    op.drop_table("runtime_states")
```

- [ ] **Step 3: Remove Runtime production code and migration endpoints**

Before deleting `runtime_domain_migration_service.py`, move `normalize_release_payload` into `paper_release_service.py` and update its local callers. Then delete Runtime imports, routes, services, CLIs, legacy migration endpoints, and obsolete test fixtures. Keep only the final no-regression scanner and historical documentation/Alembic files on its explicit allowlist.

```python
def normalize_release_payload(value: object) -> dict[str, object]:
    if not isinstance(value, dict):
        raise ValueError("paper release payload must be an object")
    return paper_release_schema.normalize(value)
```

- [ ] **Step 4: Rewrite the removal contract baseline to zero**

The final contract asserts:

```js
assert.deepEqual(inventory(), {
  endpoint: [],
  consumer: [],
  businessStorageKey: [],
  unclassifiedDynamicStorageKey: [],
})
```

Rename the former `runtimeKey` category to `businessStorageKey`, subtract the Task 1 device-preference exact/prefix allowlists, and require all dynamic storage access to pass through `KGDevicePreferences`. Apply a narrow path allowlist only to historical `docs/` and pre-drop Alembic files; production source has no exceptions.

- [ ] **Step 5: Validate upgrade on a disposable restored database**

Create a temporary database, restore the pre-drop UAT backup, run `RUNTIME_RETIREMENT_DROP_APPROVED=true alembic upgrade head`, verify domain hashes and absent tables, then destroy only the explicit temporary database.

- [ ] **Step 6: Run full tests**

```bash
cd backend && RUNTIME_RETIREMENT_DROP_APPROVED=true .venv/bin/python -m pytest tests/ -q
cd ../frontend && pnpm test
pnpm test:design
```

Expected: PASS.

- [ ] **Step 7: Commit**

```bash
git add -A backend frontend new-legacy docs
git commit -m "feat: drop retired runtime state infrastructure"
```

---

### Task 12: Destructive UAT Backup, Drop Deployment, and Final Verification

**Files:**
- Modify: `deploy/update-uat.sh`
- Modify: `deploy/tests/update-uat-validation.test.sh`
- Modify: `docs/UAT_DEPLOY.md`
- Create: `docs/verification/2026-08-29-runtime-retirement-uat-final.md`

**Interfaces:**
- `UAT_RUNTIME_RETIREMENT_DROP=1 bash deploy/update-uat.sh` performs a pre-migration dump, verifies the dump, sets the Alembic approval variable only for UAT backend startup, and verifies old tables are absent afterward.
- Backup is stored under `/home/ubuntu/lszl-kg-uat/backups/` with mode 0600 and SHA-256; no payload is printed or committed.

- [ ] **Step 1: Write failing destructive-deploy fixture tests**

Require the call order:

```text
runtime drop-check using the phase-one backend
pg_dump runtime tables
pg_restore --list backup
sha256sum backup
compose up with RUNTIME_RETIREMENT_DROP_APPROVED=true
post-deploy absent-table query
public health
```

Run: `bash deploy/tests/update-uat-validation.test.sh`

Expected: FAIL because the backup/drop mode is not implemented.

- [ ] **Step 2: Implement guarded UAT drop mode**

Before code synchronization or restart, run `runtime_retirement drop-check` through the still-running phase-one backend. Resolve the exact UAT DB container through Compose project labels. Dump only the four Runtime tables, verify archive readability, chmod 0600, compute SHA-256, and abort on any failure. Do not include Alembic version metadata in the dump, because restoring it could falsify schema state. Never address the production Compose project or volume.

```bash
backup="$REMOTE_DIR/backups/runtime-retirement-$(date +%Y%m%d%H%M%S).dump"
docker compose -p "$PROJECT" -f "$COMPOSE_FILE" --env-file "$ENV_FILE" exec -T db \
  pg_dump -U kg_uat -d kg_graph_uat -Fc \
  -t runtime_states -t shared_runtime_states -t runtime_migration_runs -t runtime_migration_items > "$backup"
pg_restore --list "$backup" >/dev/null
chmod 600 "$backup"
sha256sum "$backup" > "$backup.sha256"
```

Pass `${RUNTIME_RETIREMENT_DROP_APPROVED:-false}` only into the UAT backend service environment in `docker-compose.uat.yml`; the production Compose file remains untouched.

- [ ] **Step 3: Run deploy tests and pre-deploy full verification**

```bash
bash deploy/tests/update-uat-validation.test.sh
bash deploy/tests/update-uat-version-bump.test.sh
cd backend && RUNTIME_RETIREMENT_DROP_APPROVED=true .venv/bin/python -m pytest tests/ -q
cd ../frontend && pnpm test && pnpm test:design
```

Expected: PASS.

- [ ] **Step 4: Push final code to `uat` and verify remote**

```bash
git switch uat
git merge --ff-only codex/runtime-retirement-drop
git -c http.proxy=http://127.0.0.1:7897 push origin uat
git ls-remote --heads origin uat
```

Task 10 creates `codex/runtime-retirement-drop` from the verified `uat` head, so this fast-forward preserves a linear two-stage history. Do not touch `main`.

- [ ] **Step 5: Execute the destructive UAT deployment**

Run: `UAT_RUNTIME_RETIREMENT_DROP=1 bash deploy/update-uat.sh`

Expected: backup and checksum recorded, drop-check passes, Alembic reaches final head, four Runtime tables are absent, public health succeeds.

- [ ] **Step 6: Run final UAT browser matrix and source/hash checks**

```bash
backend/.venv/bin/python frontend/e2e/admin_runtime_retirement.py --base-url https://uat.aihuanpu.com --all-pages
```

Additionally compare UAT active site files and hashes with the local immutable candidate, confirm `/api/v1/runtime/state` returns 404, inspect logs for ERROR/Traceback/500, and record production container IDs and release unchanged.

- [ ] **Step 7: Write verification evidence, commit, and push only `uat`**

The record includes backup path/checksum (not contents), migration head, absent-table query, test counts, 12-page matrix, Runtime request count, UAT release/hash evidence, remote `uat` SHA, and production non-change evidence.

```bash
git add deploy docs/UAT_DEPLOY.md docs/verification/2026-08-29-runtime-retirement-uat-final.md
git commit -m "chore: verify complete runtime retirement on uat"
git -c http.proxy=http://127.0.0.1:7897 push origin uat
git ls-remote --heads origin uat
git status --short
git branch --show-current
```

Expected: clean `uat` branch, remote SHA matches local, `main` remains at its original SHA, and work stops for user acceptance.
