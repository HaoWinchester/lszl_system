# Question Import Persistence and Correct Answer Feedback Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make JSON-imported question banks persist atomically before a teacher can save or edit them, and make a correct answer selection visibly flash green in the multi-question canvas.

**Architecture:** Add a single protected `POST /api/v1/banks/import` endpoint which validates an entire normalized import request, creates new server IDs for its banks and questions in one transaction, bumps the teaching-content revision once, and returns source-to-server mappings. Expose that endpoint through the generated catalog adapter and replace the main question-bank page’s local-only JSON import with the adapter result. Add the missing green feedback style for the existing `is-correct-flash` behavior.

**Tech Stack:** FastAPI, Pydantic, SQLAlchemy async/PostgreSQL, vanilla browser JavaScript, CSS, Node `assert` tests, pytest, Playwright-compatible browser test environment.

## Global Constraints

- Do not modify `legacy/`; only `new-legacy/` source and its generated release assets may change.
- UI changes must use existing question-workspace classes and stylesheet; do not add an inline-style UI implementation.
- `QuestionBank` and `Question` IDs are always server-generated (`b_*`, `q_*`); imported IDs are source references only.
- An import is all-or-nothing: any invalid item must create no bank, question, paper, or teaching-content revision for that request.
- Preserve Prep Studio’s existing `/content-prep/batches` upload behavior and local draft retention.
- Keep locally managed imported papers local, but rewrite their `bankId`/`questionId` references with the server response mappings.
- Bump `new-legacy/VERSION` from `v9.0-p4.1.30` to `v9.0-p4.1.31` only after all source tests pass, then publish through `manage-new-legacy.js update new-legacy --skip-browser`.
- Before deployment compare candidate active-release file count with the current active release and verify key teacher/learning pages exist.

---

## File Structure

- `backend/app/schemas/question_catalog.py` — typed request and response models for the import transaction.
- `backend/app/services/question_service.py` — validates source identities, creates the bank/question graph in one SQL transaction, and produces mapping/result payloads.
- `backend/app/api/v1/questions.py` — exposes the manager-protected static import route before dynamic bank routes.
- `backend/tests/test_question_import.py` — HTTP-level success, rollback, ID mapping, permission and content-revision regression tests.
- `frontend/scripts/new-legacy-assets/question-catalog-adapter.js` — adds `importBanks()` to the generated browser adapter and publishes only committed refreshes.
- `new-legacy/src/65-question-bank-admin.js` — replaces local-only `importJson()` state mutation with async import, selection, paper-reference mapping and snapshot recovery.
- `new-legacy/tests/question-import-persistence.test.js` — VM/browser-adapter contract test for request shape, successful selection and no-clear recovery.
- `new-legacy/styles/question-workspace.css` — correct-answer flash animation and reduced-motion fallback.
- `new-legacy/tests/multi-question-correct-flash.test.js` — asserts runtime class/duration and the visible CSS/reduced-motion contract.

### Task 1: Define and prove the atomic question-bank import API

**Files:**
- Modify: `backend/app/schemas/question_catalog.py`
- Modify: `backend/app/services/question_service.py`
- Modify: `backend/app/api/v1/questions.py`
- Create: `backend/tests/test_question_import.py`

**Interfaces:**
- Consumes: normalized JSON banks `{id, name, subject, description, version, visibility, questions[]}` from the existing teacher page.
- Produces: `POST /api/v1/banks/import` response `{banks, sourceBankIdMap, sourceQuestionIdMap, contentRevision}`.
- Produces: `question_service.import_question_banks(db, user, payload) -> dict[str, object]`.

- [ ] **Step 1: Write the failing success-and-mapping test**

Create `backend/tests/test_question_import.py` with a teacher user/session and this exact assertion shape:

```python
response = client.post(
    "/api/v1/banks/import",
    json={
        "banks": [{
            "id": "source-bank-a", "name": "导入题库", "subject": "PMP",
            "questions": [{
                "id": "source-question-a", "title": "导入题", "type": "single_choice",
                "stemParts": [{"text": "题干"}],
                "options": [{"id": "A", "text": "正确", "correct": True}, {"id": "B", "text": "错误"}],
                "correctAnswer": "A",
            }],
        }],
    },
)
assert response.status_code == 200
payload = response.json()
bank = payload["banks"][0]
assert bank["id"].startswith("b_")
assert bank["questions"][0]["id"].startswith("q_")
assert payload["sourceBankIdMap"] == {"source-bank-a": bank["id"]}
assert payload["sourceQuestionIdMap"]["source-bank-a::source-question-a"] == bank["questions"][0]["id"]
assert payload["contentRevision"] >= 1
```

- [ ] **Step 2: Write failing rollback and permission tests**

Add tests which record the owner’s bank/question counts and teaching revision before a malformed import, then submit two banks where the second has a duplicate source bank ID or an empty `questions` list:

```python
failed = client.post("/api/v1/banks/import", json={"banks": [valid_bank, {**valid_bank, "questions": []}]})
assert failed.status_code == 422
assert bank_count_after == bank_count_before
assert question_count_after == question_count_before
assert revision_after == revision_before
```

Log in as a reader/student and assert `403` for the same endpoint. Include a two-bank valid request and assert its response increments the shared content revision exactly once.

- [ ] **Step 3: Run the API tests to verify failure**

Run: `cd backend && .venv/bin/python -m pytest tests/test_question_import.py -q`

Expected: FAIL because `POST /api/v1/banks/import` and the import schema/service do not exist.

- [ ] **Step 4: Add explicit request/response schemas**

In `backend/app/schemas/question_catalog.py`, add models with `populate_by_name=True` and `extra="allow"` for question extensions. Use source IDs instead of database IDs:

```python
class QuestionBankImportItem(BaseModel):
    model_config = ConfigDict(extra="allow", populate_by_name=True)
    id: str = Field(min_length=1, max_length=128)
    name: str = Field(min_length=1, max_length=200)
    subject: str = Field(default="PMP", min_length=1, max_length=32)
    description: str | None = None
    version: str = "1.0"
    visibility: str = "private"
    questions: list[QuestionPayload] = Field(min_length=1)

class QuestionBankImportRequest(BaseModel):
    model_config = ConfigDict(extra="forbid", populate_by_name=True)
    banks: list[QuestionBankImportItem] = Field(min_length=1)

class QuestionBankImportResponse(BaseModel):
    banks: list[dict[str, Any]]
    source_bank_id_map: dict[str, str] = Field(alias="sourceBankIdMap")
    source_question_id_map: dict[str, str] = Field(alias="sourceQuestionIdMap")
    content_revision: int = Field(alias="contentRevision", ge=1)
```

- [ ] **Step 5: Implement the transactional service without calling the per-record commit helpers**

Add `import_question_banks` in `backend/app/services/question_service.py`. It must resolve the actor once, reject duplicate source bank IDs and duplicate `"{bank}::{question}"` keys before any `add`, then execute in one `async with db.begin()` transaction. Generate IDs with `uid("b_")`/`uid("q_")`, call `normalize_question_payload` with each new question ID, construct `QuestionBank`/`Question` using the same field mapping as `create_bank` and `create_question`, `await db.flush()`, and call `teaching_content_revision_service.bump` once with all created change records.

The return value must use `bank_to_dict` and `question_to_dict`, while adding each saved question under its saved bank:

```python
return {
    "banks": imported_banks,
    "sourceBankIdMap": source_bank_id_map,
    "sourceQuestionIdMap": source_question_id_map,
    "contentRevision": int(revision_state["revision"]),
}
```

On `ValueError` or validation error, raise `HTTPException(status_code=422, detail={"code": "IMPORT_VALIDATION_FAILED", "message": ...})`; allow unexpected exceptions to leave the context manager and roll back. Do not call `db.commit()` inside the loop.

- [ ] **Step 6: Add the static route before parameterized bank routes**

In `backend/app/api/v1/questions.py`, import the request/response schemas and add this route immediately after `GET /banks` and before `PUT /banks/{bank_id}`:

```python
@router.post("/banks/import", response_model=QuestionBankImportResponse)
async def import_banks(
    request: QuestionBankImportRequest,
    db: DB,
    user: QuestionBankManager,
):
    return await question_service.import_question_banks(db, user, request)
```

- [ ] **Step 7: Run the focused backend tests to verify they pass**

Run: `cd backend && .venv/bin/python -m pytest tests/test_question_import.py tests/test_question_api_compatibility.py -q`

Expected: PASS; a valid import returns generated IDs/maps, invalid imports leave counts/revision unchanged, and manager permission is required.

- [ ] **Step 8: Commit the API unit**

```bash
git add backend/app/schemas/question_catalog.py backend/app/services/question_service.py backend/app/api/v1/questions.py backend/tests/test_question_import.py
git commit -m "feat: atomically persist imported question banks"
```

### Task 2: Expose committed imports through the managed catalog adapter

**Files:**
- Modify: `frontend/scripts/new-legacy-assets/question-catalog-adapter.js`
- Modify: `new-legacy/tests/content-prep-question-bank-integration.test.js`

**Interfaces:**
- Consumes: `POST /banks/import` response from Task 1.
- Produces: `KGQuestionCatalogAdapter.importBanks(input) -> Promise<ImportResult>`.
- Produces: one `kg:question-catalog-changed` event only after a successful remote refresh.

- [ ] **Step 1: Write a failing adapter contract test**

Extend `content-prep-question-bank-integration.test.js` with a `loadCatalogAdapter(fetchImpl)` VM helper. Stub `fetch` so `POST /api/v1/banks/import` returns a result with `contentRevision: 12`, then assert:

```javascript
const result = await adapter.importBanks({ banks: [sourceBank] });
assert.equal(calls[0].url, '/api/v1/banks/import');
assert.equal(calls[0].options.method, 'POST');
assert.deepEqual(JSON.parse(calls[0].options.body), { banks: [sourceBank] });
assert.equal(result.sourceBankIdMap['source-bank-a'], 'b-server-a');
assert.equal(published.at(-1).revision, 12);
```

Add a rejected-request assertion proving no content revision event is published when the import response is not OK.

- [ ] **Step 2: Run the Node test to verify failure**

Run: `node --test new-legacy/tests/content-prep-question-bank-integration.test.js`

Expected: FAIL because the adapter has no `importBanks` member.

- [ ] **Step 3: Implement `importBanks`**

Add this adapter member beside `saveBank`:

```javascript
async function importBanks(input) {
  const payload = await request('/banks/import', {
    method: 'POST', body: JSON.stringify({ banks: Array.isArray(input?.banks) ? input.banks : [] }),
  });
  publishCommit(payload, { entityType: 'question-import', entityId: payload.banks?.at(-1)?.id || '' });
  await refreshAfterCommit(payload);
  return clone(payload);
}
```

Export `importBanks` in `KGQuestionCatalogAdapter`. Keep the call order `request -> publishCommit -> refreshAfterCommit`; failures must stop before publication/refresh.

- [ ] **Step 4: Run the adapter tests to verify they pass**

Run: `node --test new-legacy/tests/content-prep-question-bank-integration.test.js`

Expected: PASS; only committed imports publish a remote content revision.

- [ ] **Step 5: Commit the adapter unit**

```bash
git add frontend/scripts/new-legacy-assets/question-catalog-adapter.js new-legacy/tests/content-prep-question-bank-integration.test.js
git commit -m "feat: expose committed question imports to teacher pages"
```

### Task 3: Replace local-only JSON import with recoverable server import

**Files:**
- Modify: `new-legacy/src/65-question-bank-admin.js`
- Create: `new-legacy/tests/question-import-persistence.test.js`

**Interfaces:**
- Consumes: `Catalog.importBanks({banks}) -> {banks, sourceBankIdMap, sourceQuestionIdMap}` from Task 2.
- Produces: `KGQuestionBankAdminAPI.importQuestionBanks(payload) -> Promise<{ok: boolean, bankId?: string, questionId?: string}>` for deterministic tests.
- Produces: `importJson(file)` as a thin `FileReader` wrapper over `importQuestionBanks`.

- [ ] **Step 1: Write a failing managed-page import test**

Create a VM fixture modeled on `loadManagedAdmin` in `content-prep-question-bank-integration.test.js`, with a `Catalog.importBanks` stub. Test a successful payload and a rejected promise:

```javascript
const success = await managed.api.importQuestionBanks({ banks: [sourceBank] });
assert.equal(success.ok, true);
assert.equal(managed.api.getCurrentBank().id, 'b-server-a');
assert.equal(managed.api.getCurrentQuestion().id, 'q-server-a');
assert.equal(managed.api.getCurrentQuestion().revision, 1);

const before = managed.api.getAllQuestions();
managed.catalog.importBanks = async () => { throw new Error('模拟网络中断'); };
const failed = await managed.api.importQuestionBanks({ banks: [sourceBank] });
assert.equal(failed.ok, false);
assert.deepEqual(managed.api.getAllQuestions(), before);
assert.match(managed.alerts.at(-1), /导入未提交/);
```

Include a paper ref fixture `{bankId:'source-bank-a', questionId:'source-question-a'}` and assert the saved local ref becomes `b-server-a`/`q-server-a`.

- [ ] **Step 2: Run the Node test to verify failure**

Run: `node --test new-legacy/tests/question-import-persistence.test.js`

Expected: FAIL because `importQuestionBanks` is not exposed and `importJson` only calls `saveBanks()`.

- [ ] **Step 3: Implement import normalization, selection and snapshot recovery**

In `65-question-bank-admin.js`, extract the JSON conversion from `importJson` into these helpers:

```javascript
function importBanksFromPayload(data) {
  const banks = Array.isArray(data) ? data : Array.isArray(data?.banks) ? data.banks : [data];
  return banks.map(normalizeBank);
}

function remapImportedPaperRefs(papers, maps) {
  return papers.map(paper => normalizePaper({ ...paper, questions: (paper.questions || []).map(ref => ({
    ...ref,
    bankId: maps.sourceBankIdMap[String(ref.bankId || '')] || ref.bankId,
    questionId: maps.sourceQuestionIdMap[`${String(ref.bankId || '')}::${String(ref.questionId || '')}`] || ref.questionId,
  })) }));
}
```

Implement `async function importQuestionBanks(data)` with a full pre-call snapshot of `state.banks`, `state.papers`, selected IDs and pagination. Call `await Catalog.importBanks({banks: incoming})`; on success, call `reloadBanksFromCatalog(result.banks.at(-1)?.id, result.banks.at(-1)?.questions?.[0]?.id)`, save only remapped local papers, set `state.dirty = false`, render and toast. On failure restore every snapshot field, render, `alert('导入未提交：' + message)`, and return `{ok:false}`. Do not call `saveBanks()` anywhere in the import success path.

Keep `importJson(file)` responsible only for `FileReader`, `JSON.parse`, `await importQuestionBanks(data)`, and clearing `#qbImportFile` in `finally`.

- [ ] **Step 4: Export the testable API and keep existing event semantics**

Add `importQuestionBanks` to `KGQuestionBankAdminAPI`. If the adapter’s refresh event arrives while the import is in flight, it must not treat the imported record as an unrelated dirty conflict; set/clear a scoped `state.importingCatalog` flag around the awaited call and let the post-success explicit reload be authoritative.

- [ ] **Step 5: Run the page import tests to verify they pass**

Run: `node --test new-legacy/tests/question-import-persistence.test.js new-legacy/tests/content-prep-question-bank-integration.test.js`

Expected: PASS; successful import selects persisted IDs and failure leaves current page data intact.

- [ ] **Step 6: Commit the teacher-page unit**

```bash
git add new-legacy/src/65-question-bank-admin.js new-legacy/tests/question-import-persistence.test.js
git commit -m "fix: keep JSON imported questions after saving"
```

### Task 4: Add the missing correct-answer green flash

**Files:**
- Modify: `new-legacy/styles/question-workspace.css`
- Create: `new-legacy/tests/multi-question-correct-flash.test.js`

**Interfaces:**
- Consumes: existing `flashOption(record, key, 'is-correct-flash', CORRECT_FLASH_DURATION)` in `77-multi-question-workspace.js`.
- Produces: `qw-option-correct-flash` animation for `.qw-card-option-key.is-correct-flash`.

- [ ] **Step 1: Write the failing visual-contract test**

Create `multi-question-correct-flash.test.js`:

```javascript
assert.match(js, /flashOption\(record,key,'is-correct-flash',CORRECT_FLASH_DURATION\)/);
assert.match(js, /const CORRECT_FLASH_DURATION\s*=\s*560/);
assert.match(css, /\.qw-card-option-key\.is-correct-flash\{animation:qw-option-correct-flash \.56s ease\}/);
assert.match(css, /@keyframes qw-option-correct-flash\{[\s\S]*?#16a34a[\s\S]*?#22c55e/);
assert.match(css, /@media\(prefers-reduced-motion:reduce\)\{[\s\S]*?\.is-correct-flash\{animation:none;background:#dcfce7;color:#166534/);
```

- [ ] **Step 2: Run the test to verify failure**

Run: `node --test new-legacy/tests/multi-question-correct-flash.test.js`

Expected: FAIL because there is no `is-correct-flash` CSS selector or keyframes.

- [ ] **Step 3: Add the scoped green animation and reduced-motion fallback**

Place the rule next to `.is-wrong-flash` in `question-workspace.css`:

```css
.qw-card-option-key.is-correct-flash{animation:qw-option-correct-flash .56s ease}
@keyframes qw-option-correct-flash{
  0%,100%{border-color:rgba(100,116,139,.18);background:#f1f5f9;color:#64748b}
  24%,74%{border-color:#16a34a;background:#22c55e;color:#fff}
}
@media(prefers-reduced-motion:reduce){
  .qw-card-option-key.is-correct-flash{animation:none;background:#dcfce7;color:#166534;border-color:#16a34a}
}
```

Do not modify the double-click persistent `is-correct-active` state or click delay.

- [ ] **Step 4: Run the feedback tests to verify they pass**

Run: `node --test new-legacy/tests/multi-question-correct-flash.test.js new-legacy/tests/question-catalog-learning-integration.test.js`

Expected: PASS; correct selection remains distinct from wrong selection and existing learning integration remains valid.

- [ ] **Step 5: Commit the feedback unit**

```bash
git add new-legacy/styles/question-workspace.css new-legacy/tests/multi-question-correct-flash.test.js
git commit -m "fix: flash correct answers green in synthesis canvas"
```

### Task 5: Verify, release and deploy without content rollback

**Files:**
- Modify: `new-legacy/VERSION`
- Generated by release tool: `frontend/new-legacy-releases/<version>/site/**`, `frontend/new-legacy-releases/current.json`, `frontend/public/new-legacy/**`, release manifests and seed data affected by the official scripts.

**Interfaces:**
- Consumes: source commits from Tasks 1–4.
- Produces: active local release `v9.0-p4.1.31`, then server release only after the user authorizes deployment.

- [ ] **Step 1: Run the focused regressions**

Run:

```bash
node --test new-legacy/tests/question-import-persistence.test.js new-legacy/tests/multi-question-correct-flash.test.js new-legacy/tests/content-prep-question-bank-integration.test.js new-legacy/tests/question-catalog-learning-integration.test.js
cd backend && .venv/bin/python -m pytest tests/test_question_import.py tests/test_question_api_compatibility.py tests/test_content_prep_upload.py -q
```

Expected: all PASS.

- [ ] **Step 2: Run repository-level validation**

Run:

```bash
cd backend && .venv/bin/python -m pytest tests/ -q
cd frontend && pnpm exec tsc -b
git diff --check
```

Expected: all PASS and no whitespace errors.

- [ ] **Step 3: Produce and verify the release candidate**

Update `new-legacy/VERSION` to `v9.0-p4.1.31`, then run:

```bash
node frontend/scripts/manage-new-legacy.js update new-legacy --skip-browser
active=$(node -p "require('./frontend/new-legacy-releases/current.json').version")
candidate='frontend/new-legacy-releases/v9.0-p4.1.31/site'
find "$candidate" -type f | wc -l
find "frontend/new-legacy-releases/$active/site" -type f | wc -l
test -f "$candidate/admin-console.html"
test -f "$candidate/question-bank.html"
test -f "$candidate/question-workspace.html"
```

Expected: candidate and prior active release have matching file counts (or an explained intentional add/remove), and all key pages exist.

- [ ] **Step 4: Commit generated release artifacts and push**

```bash
git add new-legacy/VERSION frontend/new-legacy-releases frontend/public/new-legacy frontend/scripts/new-legacy-assets
git commit -m "chore: publish v9.0-p4.1.31 import fixes"
git push origin codex/import-persistence-feedback
```

- [ ] **Step 5: Deploy only with explicit user authorization, then verify**

Run `./deploy/update.sh` only after the user asks to deploy. Verify the deployment’s remote health response, active release version, database migration head and current container creation time before reporting success.

## Self-Review

- **Spec coverage:** Task 1 implements atomic persistence, mapping, rollback and permissions; Tasks 2–3 integrate the managed UI and paper mapping; Task 4 implements the green feedback and reduced-motion behavior; Task 5 covers all required verification and guarded publication.
- **Placeholder scan:** No TBD/TODO or undefined “appropriate” behavior remains; each failing test, expected failure, implementation signature and command is specified.
- **Type consistency:** `QuestionBankImportRequest` feeds `import_question_banks`, `importBanks` returns the same camelCase response fields, and `importQuestionBanks` consumes those exact mappings.

## Execution Handoff

Plan complete and saved to `docs/superpowers/plans/2026-08-11-question-import-persistence-and-answer-feedback.md`. The plan will be executed inline in this isolated worktree, task by task with failing tests before implementation and checkpoints between the backend, adapter/UI and release stages.

### Task 6: Complete principle/card configuration controls and linked-question inspection

**Files:**
- Modify: `backend/app/api/v1/content_prep.py`, `backend/app/services/teaching_content_projection_service.py`
- Modify: `new-legacy/question-bank.html`, `new-legacy/src/teacher/training-config/principle-preset-controller.js`, `new-legacy/src/principles/*-repository.js`, `new-legacy/styles/teacher-question-workflow.css`
- Test: `backend/tests/test_teaching_content_revision.py`, `new-legacy/tests/v90-p4313-teacher-principle-config-browser.py`

- [x] Add a failing API test for hard deletion of an unused principle/card pair; implement the protected delete endpoint and canonical projection refresh.
- [x] Add a failing browser test for export/import controls, card double-click, question preview and editor deep link; implement the toolbar and two dialogs.
- [x] Run the focused API and browser regressions, including protection against deleting a principle still used by a question.
