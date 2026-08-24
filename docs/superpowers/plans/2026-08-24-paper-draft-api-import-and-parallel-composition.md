# Paper Draft API, Import, and Parallel Composition Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace paper-management runtime persistence with relational APIs, provide separate question-bank and `kg-paper-package-v1` paper imports, and create non-overlapping A/B/C papers with configurable counts and Paper Studio quota rules.

**Architecture:** Keep `exam_papers` and `paper_questions` as the paper draft aggregate, add focused relational tables for categories and idempotent operations, and move paper behavior from `question_service` into a dedicated paper domain service. `new-legacy/` remains the only frontend source; shared injected adapters own all API calls, a shared question-bank import controller serves both management pages, and page modules own only their DOM interactions.

**Tech Stack:** Python 3.11, FastAPI, Pydantic v2, SQLAlchemy async, PostgreSQL/Alembic, native HTML/CSS/JavaScript, Node test runner, pytest, Playwright.

## Global Constraints

- `new-legacy/` is the only authoritative frontend source; never edit `frontend/public/new-legacy/` or an active release site by hand.
- Paper drafts, categories, imports, and composition results must be database-backed and accessed through `/api/v1`.
- The imported paper stores references only; it never copies question bodies.
- The question-bank and paper JSON formats use separate visible entry points; known wrong-format uploads show a specific redirect message and never reach the wrong API.
- Question-bank imports reuse `POST /api/v1/banks/import`, including replacement confirmation, duplicate cleanup confirmation, transaction rollback, and database refresh.
- Package references resolve external `bankId/questionId` through `source_id`, with internal ID fallback only for legacy compatibility.
- A/B/C counts are independently configurable and one composition batch cannot reuse a question.
- `exam-domain` is hard quota; `performance-domain` is best-effort and cannot break the hard quota.
- Inventory shortage is detected before business writes; confirmed creation is all-or-nothing for the selected variants.
- Admin and teacher share paper management visibility while every mutation records owner/actor and requires revision where applicable.
- Do not add `primaryNodeId` as a third composition dimension.
- Preserve current DOM/class behavior unless this feature needs a new control or dialog.
- Use `apply_patch` for source edits and write a failing test before each production behavior.
- Do not add or commit files from `测试数据/`.
- Do not merge or push this feature to `main` until the user has completed UAT and explicitly approved the merge.
- Publish only with `node frontend/scripts/manage-new-legacy.js update new-legacy --skip-browser` after candidate/active file-count checks.

## Requirement Trace

| Area | Positive path | Negative path | Recovery/persistence evidence |
| --- | --- | --- | --- |
| Draft CRUD | teacher creates, edits, reorders, refreshes | stale revision returns 409 | reload current revision and retry |
| Categories | create, rename, move papers | referenced category cannot be destructively removed | archive/move then retry; refresh retains data |
| Paper import | 99 ordered refs preflight and import | missing/ambiguous ref, duplicate order, conflicting ID | show exact rows; choose copy or valid draft replacement |
| Question-bank import | Prep Studio top-level bank, bank array, or `{banks: [...]}` imports through the catalog API | paper package or malformed bank blocks before API | use the correct entry, correct JSON, cancel, or retry; refresh shows database data |
| Parallel compose | A/B/C with independent counts and no duplicates | hard quota or total inventory shortage | cancel all or re-preflight feasible subset |
| Batch commit | one transaction creates selected papers | concurrent delete or plan hash change | all selected writes roll back; re-preflight |
| Permissions | admin/teacher manage shared papers | student/viewer receive 403 | UI hides management actions and remains usable |
| Runtime cutover | API data survives refresh/login | API failure cannot fall back to runtime | specific retry message; no browser business persistence |

---

### Task 1: Freeze quota and deterministic composition behavior

**Files:**
- Create: `backend/app/services/paper_composition_service.py`
- Create: `backend/tests/test_paper_composition_service.py`

**Interfaces:**
- Produces: `allocate_counts(weights: Mapping[str, float], total: int) -> dict[str, int]`
- Produces: `facet_values(metadata: Mapping[str, Any]) -> dict[str, str]`
- Produces: `build_plan(request: CompositionRequest, candidates: Sequence[CompositionCandidate]) -> CompositionPlan`
- Produces dataclasses: `CompositionCandidate`, `CompositionVariant`, `CompositionRequest`, `CompositionPlan`

- [x] **Step 1: Write failing maximum-remainder tests**

```python
def test_allocate_counts_uses_largest_remainder_and_exact_total() -> None:
    assert allocate_counts({"people": 42, "process": 50, "business-environment": 8}, 60) == {
        "people": 25,
        "process": 30,
        "business-environment": 5,
    }
    assert sum(allocate_counts({"a": 1, "b": 1, "c": 1}, 5).values()) == 5
```

- [x] **Step 2: Run the focused test and verify RED**

Run: `cd backend && .venv/bin/python -m pytest tests/test_paper_composition_service.py -q`

Expected: collection fails because `paper_composition_service` does not exist.

- [x] **Step 3: Implement weights and facet normalization**

Implement exact validation: total must be positive; weights must be finite and non-negative; at least one weight must be positive. Normalize `exam-domain:environment` to `business-environment` and performance aliases `financial/resources/stakeholders` to `finance/resource/stakeholder` while reading `metadata.subjectFacets`.

- [x] **Step 4: Add failing plan tests for unequal variants and zero duplicates**

```python
def test_build_plan_supports_unequal_variants_without_cross_paper_duplicates() -> None:
    plan = build_plan(make_request([60, 50, 40]), make_balanced_candidates(240))
    assert [len(item.question_ids) for item in plan.variants] == [60, 50, 40]
    all_ids = [question_id for item in plan.variants for question_id in item.question_ids]
    assert len(all_ids) == len(set(all_ids))
    assert all(item.hard_shortages == {} for item in plan.variants)
```

- [x] **Step 5: Run the new tests and verify expected failures**

Run: `cd backend && .venv/bin/python -m pytest tests/test_paper_composition_service.py -q`

Expected: allocation tests pass and plan tests fail because `build_plan` is not implemented.

- [x] **Step 6: Implement deterministic planning**

Use `sha256(f"{seed}\0{bank_id}\0{question_id}")` as the stable candidate order. Process variants in request order, satisfy hard deficits first, use soft deficit as the secondary score, and remove selected IDs from the batch pool. Return per-variant targets, actual counts, shortages, exclusions, and a canonical SHA-256 plan hash.

- [x] **Step 7: Add and pass shortage, alias, unclassified, seed, and soft-target tests**

Run: `cd backend && .venv/bin/python -m pytest tests/test_paper_composition_service.py -q`

Expected: all composition unit tests pass.

- [x] **Step 8: Commit the independently green algorithm**

```bash
git add backend/app/services/paper_composition_service.py backend/tests/test_paper_composition_service.py
git commit -m "feat: add deterministic parallel paper composition"
```

### Task 2: Add relational paper draft fields and operation tables

**Files:**
- Create: `backend/app/services/idempotency_service.py`
- Modify: `backend/app/services/content_prep_service.py`
- Modify: `backend/app/models/question.py`
- Create: `backend/app/models/paper.py`
- Modify: `backend/app/models/__init__.py`
- Create: `backend/alembic/versions/d4f8a1b2c3e4_paper_draft_import_composition.py`
- Create: `backend/tests/test_idempotency_service.py`
- Create: `backend/tests/test_paper_models.py`

**Interfaces:**
- Produces models: `PaperCategory`, `PaperGenerationBatch`, `PaperImportOperation`
- Extends `ExamPaper` with category/config/import/batch fields
- Extends `PaperQuestion` with `score`
- Produces: `idempotency_service.lock(db, actor_username: str, key: str) -> None`

- [x] **Step 1: Write a failing common idempotency service test**

```python
def test_idempotency_advisory_key_is_actor_scoped_and_stable() -> None:
    assert advisory_key("teacher-a", "submit-1") == advisory_key("teacher-a", "submit-1")
    assert advisory_key("teacher-a", "submit-1") != advisory_key("teacher-b", "submit-1")
```

- [x] **Step 2: Run the idempotency test and verify RED**

Run: `cd backend && .venv/bin/python -m pytest tests/test_idempotency_service.py -q`

Expected: `idempotency_service` does not exist.

- [x] **Step 3: Extract the existing advisory-lock implementation**

Move the hash-to-signed-bigint calculation and `pg_advisory_xact_lock` call from `content_prep_service.py` into `idempotency_service.py`. Update every existing content-prep caller to use the public service and keep its current upload tests green.

- [x] **Step 4: Write failing metadata tests**

```python
def test_paper_models_expose_relational_draft_and_batch_fields() -> None:
    assert {"category_id", "access_policy", "enabled_modes", "generation_batch_id", "import_metadata"} <= set(ExamPaper.__table__.columns.keys())
    assert "score" in PaperQuestion.__table__.columns
    assert PaperCategory.__tablename__ == "paper_categories"
    assert PaperGenerationBatch.__tablename__ == "paper_generation_batches"
    assert PaperImportOperation.__tablename__ == "paper_import_operations"
```

- [x] **Step 5: Run and verify model RED**

Run: `cd backend && .venv/bin/python -m pytest tests/test_paper_models.py -q`

Expected: missing model/column assertions fail.

- [x] **Step 6: Implement model fields and constraints**

Add these `ExamPaper` columns: `category_id`, `access_policy`, `enabled_modes`, `mode_config_version`, `purpose`, `archived_at`, `restored_at`, `withdrawn_at`, `published_release_id`, `published_version`, `generation_batch_id`, `variant_code`, `generation_config`, and `import_metadata`. Add `score Numeric(8, 2)` plus unique `(paper_id, order_index)` to `PaperQuestion`; keep existing zero-based `order_index` internally.

`PaperCategory` contains `id`, `owner_id`, name/description/order, revision, archive time, actor fields, and timestamps. `PaperGenerationBatch` contains owner/actor, idempotency key, subject, internal bank IDs, filters, quota config, seed, requested variants, created paper IDs, status, and timestamps. `PaperImportOperation` contains actor, idempotency key, request hash, conflict action, result paper ID/payload, and completion time. Use `SET NULL` for paper category/batch links and actor-scoped idempotency uniqueness.

- [x] **Step 7: Write the explicit Alembic migration**

Set `down_revision = "9a4e7c2b1d80"`. Add nullable/default-compatible columns, new tables, indexes, and constraints. Downgrade removes only the added schema in reverse FK order.

- [x] **Step 8: Run migration/model and existing idempotency checks**

Run: `cd backend && .venv/bin/alembic upgrade head && .venv/bin/python -m pytest tests/test_idempotency_service.py tests/test_paper_models.py tests/test_content_prep_upload.py -q`

Expected: migration succeeds and model tests pass.

- [x] **Step 9: Commit schema and shared idempotency changes**

```bash
git add backend/app/services/idempotency_service.py backend/app/services/content_prep_service.py backend/app/models backend/alembic/versions/d4f8a1b2c3e4_paper_draft_import_composition.py backend/tests/test_idempotency_service.py backend/tests/test_paper_models.py
git commit -m "feat: extend relational paper draft schema"
```

### Task 3: Close paper draft and category CRUD through typed APIs

**Files:**
- Create: `backend/app/schemas/paper.py`
- Create: `backend/app/services/paper_service.py`
- Create: `backend/app/api/v1/papers.py`
- Modify: `backend/app/api/v1/router.py`
- Modify: `backend/app/api/v1/questions.py`
- Modify: `backend/app/services/question_service.py`
- Modify: `backend/app/services/paper_release_service.py`
- Create: `backend/tests/test_paper_draft_api.py`

**Interfaces:**
- `GET/POST /api/v1/papers`
- `GET/PUT/DELETE /api/v1/papers/{paper_id}`
- `PUT /api/v1/papers/{paper_id}/questions`
- `GET/POST/PUT/DELETE /api/v1/paper-categories`
- Pydantic types `PaperCreateRequest`, `PaperUpdateRequest`, `PaperQuestionReplaceRequest`, `PaperReference`

- [x] **Step 1: Write API tests for create, detail, ordered replacement, refresh, and role denial**

```python
created = teacher.post("/api/v1/papers", json={"name": "API 草稿", "subject": "PMP", "questions": refs})
assert created.status_code == 200
paper_id = created.json()["paper"]["id"]
detail = teacher.get(f"/api/v1/papers/{paper_id}").json()["paper"]
assert [item["order"] for item in detail["questions"]] == [1, 2]
assert student.post("/api/v1/papers", json={"name": "禁止"}).status_code == 403
```

- [x] **Step 2: Run and verify RED at the typed contract boundary**

Run: `cd backend && .venv/bin/python -m pytest tests/test_paper_draft_api.py -q`

Expected: question replacement/category endpoints are missing and create payload does not persist refs.

- [x] **Step 3: Implement Pydantic schemas and shared reference validation**

Validate internal bank/question IDs, lifecycle, bank ownership match, continuous public order `1..N`, unique question/order, score range, total count, access policy, and enabled modes. Return structured 400/404/409/422 errors.

- [x] **Step 4: Extract paper service without duplicate implementations**

Move the canonical paper mutation logic from `question_service.py` to `paper_service.py`. Keep thin compatibility imports/wrappers for existing internal callers, update `paper_release_service.py` to use paper revision helpers, and remove paper routes from `questions.py` after registering `papers.py`.

- [x] **Step 5: Implement CRUD, CAS, categories, and atomic question replacement**

Each mutation acquires the teaching-content lock, checks permissions/revision, records actor fields, bumps teaching revision, commits, and refreshes before serialization. Category deletion returns 409 when referenced; archived categories remain readable for existing papers.

- [x] **Step 6: Add stale revision, invalid reference, duplicate order, shared teacher/admin, and refresh tests**

Run: `cd backend && .venv/bin/python -m pytest tests/test_paper_draft_api.py tests/test_question_api_compatibility.py tests/test_paper_releases.py -q`

Expected: all focused tests pass and release compatibility remains green.

- [x] **Step 7: Commit CRUD closure**

```bash
git add backend/app/schemas/paper.py backend/app/services/paper_service.py backend/app/api/v1/papers.py backend/app/api/v1/router.py backend/app/api/v1/questions.py backend/app/services/question_service.py backend/app/services/paper_release_service.py backend/tests/test_paper_draft_api.py
git commit -m "feat: close paper drafts through typed APIs"
```

### Task 4: Implement paper package preflight and transactional import

**Files:**
- Create: `backend/app/services/paper_import_service.py`
- Modify: `backend/app/schemas/paper.py`
- Modify: `backend/app/api/v1/papers.py`
- Create: `backend/tests/fixtures/papers/paper-package-v1.json`
- Create: `backend/tests/test_paper_import_api.py`

**Interfaces:**
- `POST /api/v1/papers/import/preflight`
- `POST /api/v1/papers/import`
- `preflight_package(db, actor, envelope) -> PaperImportPreflightResponse`
- `import_package(db, actor, request) -> dict`

- [x] **Step 1: Create a three-reference committed fixture and failing preflight tests**

The fixture uses schema `kg-paper-package-v1`, version `1`, continuous orders, scores, and external source IDs. Tests seed corresponding internal banks/questions whose `source_id` values match the fixture.

- [x] **Step 2: Run and verify RED**

Run: `cd backend && .venv/bin/python -m pytest tests/test_paper_import_api.py -q`

Expected: import endpoints are missing.

- [x] **Step 3: Implement pure package validation and external identity resolution**

Resolve bank by `source_id` then compatible internal ID; resolve question within that bank by `source_id` then internal ID. Report missing, ambiguous, wrong-bank, deleted, duplicate, order, total-count, filename/name, compatibility, category, and paper-ID findings without writing.

- [x] **Step 4: Add conflict-action tests**

Cover `create`, `copy`, `replace_draft`, published replacement denial, stale revision, stale preflight hash, and an idempotency key reused with a different request hash.

- [x] **Step 5: Implement all-or-nothing import and persisted idempotency**

Within one transaction lock the idempotency key, re-run preflight, insert/update the draft, flush the parent, replace ordered refs, record `PaperImportOperation`, bump teaching revision, and commit. Force imported status to `draft`; store external timestamps and missing category source value in `import_metadata`.

- [x] **Step 6: Add a forced mid-reference failure rollback test and run focused suite**

Run: `cd backend && .venv/bin/python -m pytest tests/test_paper_import_api.py tests/test_paper_draft_api.py -q`

Expected: no paper or operation row remains after forced failure; all tests pass.

- [x] **Step 7: Commit import behavior**

```bash
git add backend/app/services/paper_import_service.py backend/app/schemas/paper.py backend/app/api/v1/papers.py backend/tests/fixtures/papers backend/tests/test_paper_import_api.py
git commit -m "feat: import ordered paper reference packages"
```

### Task 5: Add composition preflight and atomic batch creation APIs

**Files:**
- Modify: `backend/app/services/paper_composition_service.py`
- Modify: `backend/app/services/paper_service.py`
- Modify: `backend/app/schemas/paper.py`
- Modify: `backend/app/api/v1/papers.py`
- Create: `backend/tests/test_paper_composition_api.py`

**Interfaces:**
- `POST /api/v1/papers/composition/preflight`
- `POST /api/v1/papers/composition/batches`
- `preflight_composition(db, actor, request) -> CompositionPreflightResponse`
- `create_composition_batch(db, actor, request) -> dict`

- [x] **Step 1: Write failing API tests for A60/B50/C40 and no duplicate IDs**

Seed candidates across the three exam domains and seven performance domains. Assert exact per-variant counts, hard targets, shared plan hash, and zero overlap.

- [x] **Step 2: Run and verify RED**

Run: `cd backend && .venv/bin/python -m pytest tests/test_paper_composition_api.py -q`

Expected: composition endpoints are missing.

- [x] **Step 3: Implement database candidate loading and preflight serialization**

Load only selected managed bank IDs, exclude lifecycle-deleted questions, normalize facets from JSONB, call the pure planner, and return inventory/unclassified/target/actual/shortage details. Preflight performs no inserts or updates.

- [x] **Step 4: Add shortage and feasible-subset re-preflight tests**

Assert an infeasible full request writes nothing. Remove the infeasible variant, re-preflight, and assert the resulting hash and allocation belong to the reduced request rather than the original allocation.

- [x] **Step 5: Implement transactional batch creation and idempotency**

Recompute under the same seed, verify plan hash, create `PaperGenerationBatch`, flush it, create every selected `ExamPaper`, flush parents, insert all `PaperQuestion` rows, store resulting paper IDs, bump teaching revision once, and commit once.

- [x] **Step 6: Add concurrent change, double-submit, and forced rollback tests**

Run: `cd backend && .venv/bin/python -m pytest tests/test_paper_composition_api.py tests/test_paper_composition_service.py -q`

Expected: same-key retries return the same batch; plan changes return 409; forced failure leaves zero batch/paper/reference rows.

- [x] **Step 7: Commit composition APIs**

```bash
git add backend/app/services/paper_composition_service.py backend/app/services/paper_service.py backend/app/schemas/paper.py backend/app/api/v1/papers.py backend/tests/test_paper_composition_api.py
git commit -m "feat: create atomic parallel paper batches"
```

### Task 6: Extend one-time runtime paper migration

**Files:**
- Modify: `backend/app/services/question_migration_service.py`
- Modify: `backend/app/api/v1/papers.py`
- Modify: `backend/tests/test_question_runtime_migration.py`

**Interfaces:**
- Keeps `GET /api/v1/papers/migration/runtime/scan`
- Keeps `POST /api/v1/papers/migration/runtime?apply=false|true`
- Extends `PaperMigrationReport` with category/field/reference counts and conflicts

- [x] **Step 1: Write failing migration tests for categories and full paper fields**

Seed runtime category and paper keys with category, access policy, modes, purpose, archive/publish timestamps, scores, and ordered refs. Assert dry-run counts and zero relational writes.

- [x] **Step 2: Run and verify RED**

Run: `cd backend && .venv/bin/python -m pytest tests/test_question_runtime_migration.py -q`

Expected: new fields/categories are absent from the report and rows.

- [x] **Step 3: Extend candidate normalization, hash, report, and apply transaction**

Preserve IDs and order, resolve category/reference conflicts explicitly, never overwrite a higher relational revision with runtime data, and keep reruns idempotent.

- [x] **Step 4: Run dry-run/apply/rerun and existing migration tests**

Run: `cd backend && .venv/bin/python -m pytest tests/test_question_runtime_migration.py tests/test_runtime_domain_migration_ledger.py -q`

Expected: all migration tests pass and the second apply changes no counts.

- [x] **Step 5: Commit migration completion**

```bash
git add backend/app/services/question_migration_service.py backend/app/api/v1/papers.py backend/tests/test_question_runtime_migration.py
git commit -m "feat: migrate complete paper draft state"
```

### Task 7: Add the shared paper draft frontend adapter

**Files:**
- Create: `frontend/scripts/new-legacy-assets/paper-draft-adapter.js`
- Create: `frontend/scripts/paper-draft-adapter.test.mjs`
- Modify: `frontend/scripts/sync-new-legacy.js`
- Modify: `frontend/scripts/new-legacy-contract.json`

**Interfaces:**
- Exposes `global.KGPaperDraftApi`
- Methods: `ready`, `list`, `detail`, `create`, `update`, `replaceQuestions`, `remove`, category CRUD, `importPreflight`, `importPaper`, `compositionPreflight`, `createCompositionBatch`
- Emits `kg:paper-drafts-changed` after successful mutations

- [x] **Step 1: Write failing Node contract and VM behavior tests**

Assert credentials, JSON headers, exact endpoints/payloads, 401/403/409/422 error normalization, mutation events, and absence of `localStorage`, `sessionStorage`, or IndexedDB writes.

- [x] **Step 2: Run and verify RED**

Run: `cd frontend && node --test scripts/paper-draft-adapter.test.mjs`

Expected: adapter file/injection is missing.

- [x] **Step 3: Implement one request helper and all adapter methods**

Return cloned API data, keep only current-page in-memory request state, attach `status/code/detail/currentRevision` to errors, and never synthesize successful paper rows after a failed request.

- [x] **Step 4: Inject the adapter before paper management code and test generated output**

Run: `cd frontend && pnpm sync:new-legacy && node --test scripts/paper-draft-adapter.test.mjs scripts/paper-release-adapter.test.mjs`

Expected: generated `paper-management.html` contains exactly one adapter before `src/65-question-bank-admin.js`; tests pass.

- [x] **Step 5: Commit the shared adapter**

```bash
git add frontend/scripts/new-legacy-assets/paper-draft-adapter.js frontend/scripts/paper-draft-adapter.test.mjs frontend/scripts/sync-new-legacy.js frontend/scripts/new-legacy-contract.json frontend/public/new-legacy
git commit -m "feat: add paper draft API adapter"
```

### Task 8: Build import and parallel composition interactions in the authoritative frontend

**Files:**
- Modify: `new-legacy/paper-management.html`
- Modify: `new-legacy/styles/paper-management.css`
- Create: `new-legacy/src/teacher/paper-management/paper-import-controller.js`
- Create: `new-legacy/src/teacher/paper-management/paper-composition-controller.js`
- Modify: `new-legacy/src/65-question-bank-admin.js`
- Modify: `new-legacy/tests/v90-p35-paper-management.test.js`
- Modify: `new-legacy/tests/v90-p35-paper-management-browser.py`
- Create: `new-legacy/tests/paper-management-api-contract.test.js`

**Interfaces:**
- Buttons: `qbImportPaperBtn`, `qbComposePapersBtn`
- Dialogs: `qbPaperImportDialog`, `qbPaperCompositionDialog`
- Controllers consume `KGPaperDraftApi`; `65-question-bank-admin.js` consumes controller results and refreshes API data

- [x] **Step 1: Update static/control-matrix tests before HTML changes**

Require both buttons, both dialogs, file input, conflict selector, A/B/C enable/name/count controls, bank selector, preflight results, cancel/retry/confirm controls, and controller script order. Remove stale hard-coded version assertions.

- [x] **Step 2: Run static tests and verify RED**

Run: `node new-legacy/tests/v90-p35-paper-management.test.js && node new-legacy/tests/paper-management-api-contract.test.js`

Expected: new controls/modules are missing.

- [x] **Step 3: Add compatible HTML and CSS surfaces**

Use existing `qb-*`/`pm-*` classes and dialog/button patterns. Add specific Chinese copy for missing refs, name mismatch, ID conflict, shortage, partial choice, technical rollback, and retry; do not use generic “操作已触发”.

- [x] **Step 4: Write controller tests for success, failure, cancel, retry, and double click**

The import controller must parse JSON, call preflight, block invalid confirmation, select copy/replace, and reload after success. The composition controller must maintain independent A/B/C counts, re-preflight a feasible subset, disable confirm during submission, and render actual hard/soft results.

- [x] **Step 5: Implement controllers against the shared adapter**

Keep dialog form values in memory only. Use API results as the sole paper/category state. On 409 expose reload; on 422 keep the dialog open; on 500 state that no selected paper was retained and enable retry.

- [x] **Step 6: Replace paper/category runtime load/save in the admin application**

Make initialization await `KGPaperDraftApi.ready()`, load list/categories from API, route create/update/question replacement/delete through API, and reload after mutation. Remove paper/category runtime key reads, writes, release-merge fallback, and synchronous fake success.

- [x] **Step 7: Rewrite browser coverage around an API stub and real durable outcomes**

Cover create/save/refresh simulation, import warning and retry, A/B/C independent counts, shortage subset re-preflight, repeated submit, permission denial, and every newly visible control. Existing picker/layout/preview assertions remain.

- [x] **Step 8: Run source and browser tests**

Run: `node new-legacy/tests/v90-p35-paper-management.test.js && node new-legacy/tests/paper-management-api-contract.test.js && python3 new-legacy/tests/v90-p35-paper-management-browser.py`

Expected: all pass with no page errors and no paper business writes to browser storage.

- [x] **Step 9: Sync and commit authoritative frontend plus generated artifacts**

```bash
cd frontend && pnpm sync:new-legacy
cd ..
git add new-legacy frontend/public/new-legacy frontend/scripts/new-legacy-contract.json
git commit -m "feat: add paper import and parallel composition UI"
```

### Task 9: Full verification, sample inspection, and active release promotion

**Files:**
- Modify generated version/manifest/sync report files only through release tooling
- Update: `docs/superpowers/plans/2026-08-24-paper-draft-api-import-and-parallel-composition.md` checkboxes

**Interfaces:**
- No new production interfaces; this task proves the feature and promotes the source safely.

- [x] **Step 1: Run forbidden persistence and source scans**

Run: `rg -n "PAPER_PREFIX|PAPER_CATEGORY_PREFIX|loadPapers\(|savePapers\(|loadPaperCategories\(|savePaperCategories\(" new-legacy/src/65-question-bank-admin.js new-legacy/src/teacher/paper-management frontend/scripts/new-legacy-assets/paper-draft-adapter.js`

Expected: no paper/category business persistence remains; any matching function name belongs only to API methods and is reviewed explicitly.

- [x] **Step 2: Run focused backend suites**

Run: `cd backend && .venv/bin/python -m pytest tests/test_paper_composition_service.py tests/test_paper_models.py tests/test_paper_draft_api.py tests/test_paper_import_api.py tests/test_paper_composition_api.py tests/test_question_runtime_migration.py tests/test_paper_releases.py tests/test_question_api_compatibility.py -q`

Expected: all focused tests pass.

- [x] **Step 3: Run full backend and frontend suites**

Run: `cd backend && .venv/bin/python -m pytest tests/ -q`

Run: `cd frontend && pnpm test && pnpm test:design`

Expected: all suites pass without warnings introduced by this feature.

- [x] **Step 4: Inspect the supplied 99-reference sample through preflight**

Use `测试数据/PMP 模拟卷 05_PAPER_V9.0-P4.5.29.json` without adding it to Git. Before the user imports all banks, expected behavior is a valid package with 99 continuous unique refs plus explicit missing-reference findings; after banks are present, expected behavior is `canImport=true`.

- [x] **Step 5: Perform the browser exploratory matrix**

As teacher/admin: open, create, edit, import, compose, cancel, retry, refresh, publish, and withdraw. As student/viewer: verify management denial. Capture console/network and assert paper drafts never call `/api/v1/runtime/state`.

- [x] **Step 6: Verify candidate versus active release file counts before promotion**

Read `frontend/new-legacy-releases/current.json`, count current active site files, run the release tool, then count the new site and verify `paper-management.html` and `admin-console.html` exist. Abort promotion if the candidate count regresses.

- [x] **Step 7: Promote only through the managed release command**

Run: `node frontend/scripts/manage-new-legacy.js update new-legacy --skip-browser`

Expected: sync, validation, release construction, and promote complete successfully.

- [x] **Step 8: Re-run active release smoke checks and commit generated release state**

Run API/browser smoke against the FastAPI-served active page, then commit source, generated artifacts, current release pointer, manifests, and completed plan checkboxes.

```bash
git add docs/superpowers/plans frontend new-legacy backend
git commit -m "chore: verify and publish paper management APIs"
```

- [x] **Step 9: Stop at the user acceptance gate instead of merging to main**

Push only the feature and `uat` branches, run the local/UAT page for the user, and keep `main` at `ccb51e3` until explicit user approval.

### Task 10: Separate question-bank and paper import entry points

**Files:**
- Create: `new-legacy/src/teacher/question-bank-import-controller.js`
- Modify: `new-legacy/src/teacher/paper-management/paper-import-controller.js`
- Modify: `new-legacy/paper-management.html`
- Modify: `new-legacy/src/65-question-bank-admin.js`
- Modify: `new-legacy/tests/paper-management-api-contract.test.js`
- Modify: `new-legacy/tests/v90-p35-paper-management.test.js`
- Modify: `new-legacy/tests/v90-p35-paper-management-browser.py`
- Modify generated files only through: `frontend/scripts/sync-new-legacy.js`

**Interfaces:**
- `KGTeacherDomains.QuestionBankImportController.classify(payload)` returns `question-bank`, `paper-package`, or `unknown`.
- `KGTeacherDomains.QuestionBankImportController.normalizeBanks(payload)` returns source-bank objects accepted by `KGQuestionCatalog.importBanks({banks, ...confirmations})`.
- `KGTeacherDomains.QuestionBankImportController.create({api,onChange,onReload,confirm})` owns JSON parsing, conflict confirmation, duplicate cleanup confirmation, cancellation, retry, and single-submit behavior.
- `PaperImportController.load()` rejects a recognized question-bank payload before calling `/papers/import/preflight` and reports `检测到题库 JSON，请使用“导入题库”`.

- [ ] **Step 1: Write failing controller tests from the real Prep Studio shape**

Add literal fixtures for a top-level bank with `id/name/subject/version/questions`, a bank array, `{banks:[...]}`, and a `kg-paper-package-v1` payload. Assert all three bank inputs normalize to one catalog request, the paper package is rejected without an API call, and the paper controller rejects the bank fixture without a paper-preflight call.

- [ ] **Step 2: Run the focused test and verify RED**

Run: `node new-legacy/tests/paper-management-api-contract.test.js`

Expected: FAIL because `QuestionBankImportController` does not exist and paper import does not classify bank JSON.

- [ ] **Step 3: Implement the shared controller and paper wrong-format guard**

Create the shared controller with no browser persistence. It must call the existing catalog adapter, preserve the full question objects, confirm `IMPORT_REPLACEMENT_CONFIRMATION_REQUIRED` and `QUESTION_DUPLICATES_CONFIRMATION_REQUIRED` in the same sequence as the existing question-bank page, restore usable state after cancel/error, and block repeated submits.

- [ ] **Step 4: Run focused controller tests and verify GREEN**

Run: `node new-legacy/tests/paper-management-api-contract.test.js`

Expected: PASS with exact API payloads and no storage writes.

- [ ] **Step 5: Add the two visible import entry points and bind real interactions**

Keep `qbImportPaperBtn` labeled `导入试卷`; add `qbImportBankBtn` labeled `导入题库` and a dedicated dialog/file input/results/cancel/retry/confirm surface. Bind it to the shared controller and `KGQuestionCatalog.importBanks`. After success, reload the API catalog and repopulate composition bank choices. Update the question-bank page import path to use the same controller rather than duplicating normalization and conflict sequencing.

- [ ] **Step 6: Add static and browser success/failure/recovery coverage**

Assert both buttons and dialogs exist, upload a generated 60-question Prep Studio-shaped bank, confirm the catalog request retains 60 question IDs, refresh the catalog, reject a paper package in the bank dialog, reject a bank in the paper dialog, cancel a replacement, retry after an API failure, and verify no question/paper business payload reaches localStorage/runtime state.

- [ ] **Step 7: Run source/browser tests and sync authoritative output**

Run: `node new-legacy/tests/v90-p35-paper-management.test.js && node new-legacy/tests/paper-management-api-contract.test.js && python3 new-legacy/tests/v90-p35-paper-management-browser.py`

Run: `cd frontend && pnpm sync:new-legacy`

Expected: all focused tests pass; generated assets include the shared controller before `65-question-bank-admin.js`.

- [ ] **Step 8: Commit the dual-import implementation**

```bash
git add new-legacy frontend/public/new-legacy frontend/scripts docs/superpowers/plans/2026-08-24-paper-draft-api-import-and-parallel-composition.md
git commit -m "fix: separate question bank and paper imports"
```

### Task 11: Verify locally and return to user acceptance

**Files:**
- Modify: `new-legacy/VERSION` and generated manifests only if managed release requires a new version
- Update: `docs/superpowers/plans/2026-08-24-paper-draft-api-import-and-parallel-composition.md`

**Interfaces:**
- No new interface; this task validates source, generated site, API behavior, and the user-visible local flow.

- [ ] **Step 1: Validate the supplied untracked 60-question file without committing it**

Run the shared normalizer against `测试数据/PMP_第二批第1套_人-相关方-01_60题_PrepStudio (1).json` and assert one bank, 60 unique question IDs, source bank ID `bank_9ee70c56-89de-433e-bf90-813b2ef17b10`, and no paper-package validation messages.

- [ ] **Step 2: Run focused backend and full frontend tests**

Run: `cd backend && .venv/bin/python -m pytest tests/test_question_api_compatibility.py tests/test_paper_import_api.py -q`

Run: `cd frontend && pnpm test && pnpm test:design`

Expected: all pass without a new warning.

- [ ] **Step 3: Build/promote the local managed release after file-count checks**

Compare candidate and active release file counts, bump `new-legacy/VERSION` only if required, then run `node frontend/scripts/manage-new-legacy.js update new-legacy --skip-browser`. Verify `paper-management.html`, `admin-console.html`, the shared controller, and equal active/public counts.

- [ ] **Step 4: Start the local UAT server and perform the curious-user pass**

As admin, open both dialogs; upload the real 60-question bank through `导入题库`; verify the result/confirmation UI, cancel before any destructive replacement if data already exists, verify `导入试卷` still accepts the 99-reference paper package, and verify wrong-entry recovery messages. Keep `main` unchanged.

- [ ] **Step 5: Commit/push only the feature and UAT branches, then wait**

Push through `http://127.0.0.1:7897`, verify remote `main` remains `ccb51e3`, give the user the local URL, and do not merge to `main` until the user explicitly approves.
