# Paper Management Demand Loading Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make `paper-management.html` render paper summaries immediately, fetch only the selected paper detail, and load questions only for the selected bank/page instead of downloading the 23.8 MB managed catalog.

**Architecture:** Keep PostgreSQL domain APIs authoritative. Extend existing paper detail rows with lightweight question summaries, extend the bank-scoped question endpoint with server-side search, and add a small shared frontend data loader that owns summary/detail/page caches and request-race protection. The legacy page consumes that loader while preserving its existing DOM and controls.

**Tech Stack:** FastAPI, SQLAlchemy async, PostgreSQL, vanilla JavaScript adapters, Node `node:test`, Python `pytest`, agent-browser.

## Global Constraints

- Do not persist paper or question business data in Runtime, `localStorage`, `sessionStorage`, or IndexedDB.
- Preserve the existing `paper-management.html` DOM, class names, Chinese copy, and visual layout except replacing the cross-bank candidate option with an explicit selected-bank workflow.
- The initial page load must not request `include_questions=true`.
- Initial paper loading must issue one list request, one category request, and at most one selected-paper detail request.
- UAT verification happens on the feature branch; do not merge to `main` before user testing and approval.
- Do not touch or commit the user-owned `测试数据/` directory.

---

### Task 1: Add lightweight question summaries to selected paper detail

**Files:**
- Modify: `backend/app/services/paper_service.py`
- Test: `backend/tests/test_paper_draft_api.py`

**Interfaces:**
- Consumes: existing `GET /api/v1/papers` and `GET /api/v1/papers/{paper_id}` routes.
- Produces: each detail-only `questions[]` reference includes `summary: {title, domain, topic, difficulty, tags}`; list rows still omit `questions`.

- [ ] **Step 1: Write the failing API test**

Add a test that creates two papers and questions, calls `/api/v1/papers`, and proves list rows have no `questions`. Then call one `/api/v1/papers/{id}` and assert the literal summary payload:

```python
assert "questions" not in list_row
assert detail["questions"] == [{
    "bankId": bank_id,
    "questionId": question_id,
    "order": 1,
    "score": 1.0,
    "summary": {
        "title": "按需加载题目",
        "domain": "人员",
        "topic": "团队",
        "difficulty": "medium",
        "tags": ["敏捷"],
    },
}]
```

- [ ] **Step 2: Run the focused test and verify RED**

Run:

```bash
cd backend && .venv/bin/python -m pytest tests/test_paper_draft_api.py -q
```

Expected: the new assertion fails because `_reference_payloads()` returns only reference fields.

- [ ] **Step 3: Add the minimal summary projection**

Update `_reference_payloads()` to select `Question` fields already joined by the query and emit only the five summary fields. Do not include stem, options, analysis, clues, concepts, reasoning, or translations.

- [ ] **Step 4: Run the focused test and verify GREEN**

Run the Task 1 command and confirm the entire file passes.

- [ ] **Step 5: Commit Task 1**

```bash
git add backend/app/services/paper_service.py backend/tests/test_paper_draft_api.py
git commit -m "perf: project question summaries in paper detail"
```

### Task 2: Support server-filtered, bank-scoped candidate pages

**Files:**
- Modify: `backend/app/api/v1/question_catalog.py`
- Modify: `backend/app/services/question_catalog_service.py`
- Test: `backend/tests/test_question_catalog.py`

**Interfaces:**
- Consumes: `GET /api/v1/question-catalog/banks/{bank_id}/questions`.
- Produces: optional `search` query parameter applied before `count`, `offset`, and `limit`; response schema remains `questions`, `total`, `page`, `pageSize`.

- [ ] **Step 1: Write the failing search-and-pagination test**

Seed one bank with three literal questions where only two match `search=风险`, then request page size one and assert:

```python
response = client.get(
    f"/api/v1/question-catalog/banks/{bank_id}/questions",
    params={"search": "风险", "page": 2, "page_size": 1},
)
assert response.status_code == 200
assert response.json()["total"] == 2
assert [row["title"] for row in response.json()["questions"]] == ["风险应对二"]
```

Also assert a teacher without bank access receives the existing permission response.

- [ ] **Step 2: Run the focused test and verify RED**

```bash
cd backend && .venv/bin/python -m pytest tests/test_question_catalog.py -q
```

Expected: the result contains the unfiltered second record because `search` is currently ignored.

- [ ] **Step 3: Implement search before pagination**

Pass `search` from the route to `list_bank_questions()`. Filter case-insensitively across `title`, `domain`, `topic`, and JSONB `tags`, while retaining the bank-access check and stable ordering.

- [ ] **Step 4: Run the focused test and verify GREEN**

Run the Task 2 command and confirm all question-catalog tests pass.

- [ ] **Step 5: Commit Task 2**

```bash
git add backend/app/api/v1/question_catalog.py backend/app/services/question_catalog_service.py backend/tests/test_question_catalog.py
git commit -m "feat: filter bank question pages on the server"
```

### Task 3: Make the catalog adapter summary-first and cache bank pages

**Files:**
- Modify: `frontend/scripts/question-catalog-adapter.test.mjs`
- Modify: `frontend/scripts/new-legacy-assets/question-catalog-adapter.js`

**Interfaces:**
- Consumes: Task 2 bank endpoint and the existing bootstrap/revision/single-question endpoints.
- Produces:
  - `ready`: summary-only bootstrap in both modes.
  - `loadBankQuestionPage(bankId, {page, pageSize, search, forceReload}) -> {questions,total,page,pageSize}`.
  - `loadQuestion(questionId, {forceReload}) -> question | null`.
  - `invalidateQuestionCache()`.

- [ ] **Step 1: Replace the obsolete managed-full-snapshot test with failing demand-load tests**

The test must prove these observable behaviors:

```javascript
await adapter.ready
assert.equal(calls[0].url, '/api/v1/question-catalog/bootstrap?mode=managed')
assert.equal(calls.some(call => call.url.includes('include_questions=true')), false)

const first = await adapter.loadBankQuestionPage('bank-1', {
  page: 1, pageSize: 12, search: '风险',
})
const again = await adapter.loadBankQuestionPage('bank-1', {
  page: 1, pageSize: 12, search: '风险',
})
assert.deepEqual(again, first)
assert.equal(bankPageCallCount, 1)
```

Add a revision event case proving cached bank pages are invalidated without another full bootstrap carrying questions.

- [ ] **Step 2: Run the adapter test and verify RED**

```bash
cd frontend && node --test scripts/question-catalog-adapter.test.mjs
```

Expected: managed bootstrap still includes `include_questions=true`, and the page-cache method is absent.

- [ ] **Step 3: Implement summary-first bootstrap and exact caches**

Use cache keys `${contentRevision}:${bankId}:${page}:${pageSize}:${search}` and an in-flight map with the same key. Preserve clone-on-read behavior. On remote revision, refresh only the summary bootstrap and clear page/single-question caches.

- [ ] **Step 4: Run the adapter test and verify GREEN**

Run the Task 3 command with no console warnings or unhandled rejections.

- [ ] **Step 5: Commit Task 3**

```bash
git add frontend/scripts/question-catalog-adapter.test.mjs frontend/scripts/new-legacy-assets/question-catalog-adapter.js
git commit -m "perf: load managed question banks on demand"
```

### Task 4: Cache paper summaries and selected detail without duplicate calls

**Files:**
- Modify: `frontend/scripts/paper-draft-adapter.test.mjs`
- Modify: `frontend/scripts/new-legacy-assets/paper-draft-adapter.js`

**Interfaces:**
- Consumes: existing paper list/detail/category/mutation endpoints.
- Produces:
  - `ready({forceReload=false}) -> {papers,categories}` using one shared first-load request.
  - `detail(paperId, {forceReload=false})` with detail and in-flight caches.
  - `invalidatePaper(paperId)` and `invalidateLists()`.
  - mutations refresh the returned paper in cache and invalidate only the necessary list/detail entries.

- [ ] **Step 1: Write failing cache, invalidation, and recovery tests**

Add real adapter tests that assert:

```javascript
await Promise.all([api.ready(), api.ready()])
assert.equal(count('/api/v1/papers'), 1)
assert.equal(count('/api/v1/paper-categories'), 1)

await Promise.all([api.detail('paper-1'), api.detail('paper-1')])
assert.equal(count('/api/v1/papers/paper-1'), 1)

api.invalidatePaper('paper-1')
await api.detail('paper-1')
assert.equal(count('/api/v1/papers/paper-1'), 2)
```

Add a 500 detail response followed by a successful retry and assert the failed promise is not cached.

- [ ] **Step 2: Run the adapter test and verify RED**

```bash
cd frontend && node --test scripts/paper-draft-adapter.test.mjs
```

Expected: concurrent `detail()` calls produce duplicate fetches and invalidation methods do not exist.

- [ ] **Step 3: Implement list/detail state inside the adapter**

Keep `summaryState`, `detailCache`, and `detailLoads` module-local. Return clones. A mutation response that contains `paper` replaces that detail; delete clears it; category mutations only invalidate categories. Do not add persistent storage.

- [ ] **Step 4: Run the adapter test and verify GREEN**

Run the Task 4 command and confirm all adapter contract tests pass.

- [ ] **Step 5: Commit Task 4**

```bash
git add frontend/scripts/paper-draft-adapter.test.mjs frontend/scripts/new-legacy-assets/paper-draft-adapter.js
git commit -m "perf: cache paper summaries and selected details"
```

### Task 5: Add a shared paper-management demand loader

**Files:**
- Create: `frontend/scripts/new-legacy-assets/paper-management-data-loader.js`
- Create: `frontend/scripts/paper-management-data-loader.test.mjs`
- Modify: `frontend/scripts/sync-new-legacy.js`

**Interfaces:**
- Consumes: `KGPaperDraftApi` and `KGQuestionCatalogAdapter` from Tasks 3–4.
- Produces `KGPaperManagementDataLoader.create({paperApi,catalogApi,onChange})` with:
  - `initialize({preferredPaperId})`.
  - `selectPaper(paperId)`.
  - `selectBank(bankId, {page,pageSize,search})`.
  - `refreshPapers({preferredPaperId})`.
  - `snapshot()`.

- [ ] **Step 1: Write failing loader behavior tests**

Use real loader code with deterministic fake API boundaries and assert:

- five summaries cause one selected-detail call, not five;
- `initialize()` publishes summaries before a deferred selected detail settles;
- rapid `selectPaper('A')`, `selectPaper('B')` keeps B selected when A resolves last;
- a failed bank page sets only `candidateError`; papers and selected detail remain present;
- revisiting a loaded paper or bank page reuses adapter caches.

The production mutation each test catches is an accidental `Promise.all(summary.map(detail))`, stale-response overwrite, or global error reset.

- [ ] **Step 2: Run the loader test and verify RED**

```bash
cd frontend && node --test scripts/paper-management-data-loader.test.mjs
```

Expected: module file or public factory is absent.

- [ ] **Step 3: Implement the focused loader**

Keep request generation counters for paper selection and bank selection. Call `onChange(snapshot())` once for the summary-ready state and again when the selected detail/candidate page completes. Do not access DOM or browser storage.

- [ ] **Step 4: Inject the loader before `65-question-bank-admin.js`**

Extend `sync-new-legacy.js` so only `paper-management.html` receives `paper-management-data-loader.js`, after both adapters and before the application script.

- [ ] **Step 5: Run the loader and sync tests and verify GREEN**

```bash
cd frontend && node --test scripts/paper-management-data-loader.test.mjs scripts/question-catalog-adapter.test.mjs scripts/paper-draft-adapter.test.mjs
```

- [ ] **Step 6: Commit Task 5**

```bash
git add frontend/scripts/new-legacy-assets/paper-management-data-loader.js frontend/scripts/paper-management-data-loader.test.mjs frontend/scripts/sync-new-legacy.js
git commit -m "feat: orchestrate paper management demand loading"
```

### Task 6: Connect the page to summary/detail and selected-bank state

**Files:**
- Modify: `new-legacy/src/65-question-bank-admin.js`
- Modify: `frontend/scripts/paper-management-data-loader.test.mjs`
- Modify: `frontend/scripts/design-contract.test.mjs`

**Interfaces:**
- Consumes: Task 5 loader snapshots and Task 1 `questions[].summary`.
- Produces: immediate list rendering, selected detail rendering, explicit bank selection, server-paged candidate rendering, and on-demand full question preview.

- [ ] **Step 1: Add failing page integration assertions**

Extend the loader harness to exercise the page-facing callbacks and assert:

- summaries render before selected detail resolves;
- only the current detail contributes question references;
- the candidate request contains the selected bank, current page, page size, and search;
- selecting another paper calls `selectPaper(id)` and does not issue detail calls for non-selected rows;
- full question lookup occurs only after preview is opened.

- [ ] **Step 2: Run focused tests and verify RED**

```bash
cd frontend && node --test scripts/paper-management-data-loader.test.mjs scripts/design-contract.test.mjs
```

Expected: the page still waits on `Catalog.ready`, reloads every detail, and keeps the `ALL` local-catalog candidate flow.

- [ ] **Step 3: Replace `reloadPaperDrafts()` all-detail loading**

Initialize state from loader summaries, then replace only the selected summary with the loaded detail. Preserve `selectedPaperId`, bulk-selection state, list filters, and all existing mutation handlers.

- [ ] **Step 4: Replace candidate filtering with selected-bank pages**

Default `paperCandidateBankId` to the first matching bank. Render an explicit “请选择题库” disabled option rather than an `ALL` option. Search and pager events call `selectBank()`; they do not scan every bank in memory.

- [ ] **Step 5: Use detail summaries and fetch full preview on demand**

`paperQuestionLookup()` returns the lightweight `ref.summary` for row rendering. `openPaperQuestionPreview()` calls `Catalog.loadQuestion(questionId)` only when the candidate/page cache does not already contain a full question payload.

- [ ] **Step 6: Gate quota-only full candidate preparation behind the explicit action**

The initial render and ordinary paper selection must never call the full bootstrap. If the legacy “按配额补充” operation needs more candidates than the selected bank page, load the relevant subject banks through bank-scoped pages only after the user clicks that action, show its existing progress/error feedback, and reuse those bank caches. Do not call `include_questions=true`.

- [ ] **Step 7: Run focused tests and verify GREEN**

Run the Task 6 test command and confirm the page contract remains visually unchanged.

- [ ] **Step 8: Commit Task 6**

```bash
git add new-legacy/src/65-question-bank-admin.js frontend/scripts/paper-management-data-loader.test.mjs frontend/scripts/design-contract.test.mjs
git commit -m "perf: render paper management from demand-loaded data"
```

### Task 7: Full regression, generated-site build, and local browser proof

**Files:**
- Modify only if tests expose a requirement regression.
- Verify: generated `frontend/public/new-legacy/paper-management.html`; the versioned UAT release remains a separate, user-authorized deployment step.

**Interfaces:**
- Consumes all prior tasks.
- Produces test evidence and a feature-branch build ready for UAT deployment after user approval.

- [ ] **Step 1: Run backend regression**

```bash
cd backend && .venv/bin/python -m pytest tests/ -q
```

- [ ] **Step 2: Run frontend regression and design checks**

```bash
cd frontend && pnpm test && pnpm test:design
```

- [ ] **Step 3: Sync generated assets through the standard command**

```bash
cd frontend && pnpm sync:new-legacy
```

Confirm the generated page contains the demand loader once, after both adapters and before `src/65-question-bank-admin.js`.

- [ ] **Step 4: Run the local browser network acceptance**

Using agent-browser with an authenticated local test account, prove:

- no request URL contains `include_questions=true`;
- `/papers` and `/paper-categories` each occur once before interaction;
- exactly one `/papers/{id}` occurs before switching papers;
- selecting another paper adds only that detail request;
- selecting another bank adds only that bank page request;
- the paper list is visible before question-page completion;
- import, composition, save, publish, archive, preview close/retry controls still produce their domain behaviors.

- [ ] **Step 5: Check repository cleanliness and commit generated release changes**

```bash
git diff --check
git status --short
```

Stage only task-owned files and standard generated release artifacts. Leave `测试数据/` untracked and untouched.

- [ ] **Step 6: Stop before `main` or UAT promotion**

Report exact pass counts and browser request evidence to the user. Deploy to UAT only after the user asks; keep the feature branch unmerged until the user completes UAT testing.
