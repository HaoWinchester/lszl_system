# Question Pool Cleanup and Migration Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Retain every verified formal import, remove test questions and other non-imported question data from the shared pool, and repair live draft references without altering published historical snapshots.

**Architecture:** Add a read-only classifier/report phase and a separately authorized apply phase. Classification uses durable provenance and explicit test signatures, writes no business data, and produces a content-addressed manifest. Apply requires a fresh PostgreSQL backup plus the exact manifest hash, deletes only manifest-approved rows in one transaction, repairs current drafts, and emits an immutable audit report.

**Tech Stack:** FastAPI service layer, SQLAlchemy async, PostgreSQL, Pydantic, Alembic-managed models, Python CLI, pytest.

## Global Constraints

- Complete plan 1 before running this plan so administrators and teachers operate on one shared question pool.
- “导入题目保留，其余清空” means retain verified formal imports only.
- Explicit automated-test signatures override apparent import provenance; test fixtures uploaded through the import API must still be deleted.
- Ambiguous rows are never deleted automatically. They enter `review`; apply is refused until the review set is empty or an explicit decision file resolves every row.
- Published paper/course/task snapshots are historical records and are not rewritten. Current drafts and live foreign-key references are repaired.
- The apply operation is destructive. It requires a verified backup, an unchanged database snapshot hash, an exact report hash, and a typed confirmation token.
- Do not run the apply command against any database merely to verify code. Unit/integration tests must use the isolated test database.
- Use SQLAlchemy transactions; refresh externally serialized ORM objects after commit.
- This is plan 2 of 4. Produce and review the dry-run manifest before any production deletion.

---

## File Structure

### Backend

- Create `backend/app/schemas/question_cleanup.py`: classification, manifest, decision, apply, and audit-report schemas.
- Create `backend/app/services/question_cleanup_service.py`: provenance classifier, snapshot hashing, reference analysis, and transactional cleanup.
- Create `backend/app/services/question_cleanup_reference_service.py`: repairs current relational and shared-runtime draft references.
- Create `backend/scripts/question_pool_maintenance.py`: `report`, `apply`, and `verify` CLI commands.
- Create `backend/alembic/versions/5c84e1d3a720_add_question_cleanup_audits.py`: immutable cleanup audit table.
- Modify `backend/app/models/question.py`: cleanup audit ORM model/import.
- Modify `backend/app/models/__init__.py`: register the new model.
- Modify `backend/app/services/teaching_content_revision_service.py`: publish a single cleanup revision.

### Tests

- Create `backend/tests/test_question_pool_cleanup.py`.
- Create `backend/tests/fixtures/question_cleanup/formal-import.json`.
- Create `backend/tests/fixtures/question_cleanup/test-import.json`.
- Create `backend/tests/fixtures/question_cleanup/review-decisions.json`.

### Operations artifacts

- Generate `backend/var/question-cleanup/2026-08-10-report.json` with `report`; never hand-edit it.
- Generate `backend/var/question-cleanup/2026-08-10-apply-result.json` with `apply`; never hand-edit it.
- Store the database backup outside the repository and record its absolute path and SHA-256 in the apply result.

---

### Task 1: Define provenance and classification contracts

**Files:**
- Create: `backend/app/schemas/question_cleanup.py`
- Create: `backend/app/services/question_cleanup_service.py`
- Test: `backend/tests/test_question_pool_cleanup.py`

**Interfaces:**
- `classify_question(question, audit_rows, batch) -> QuestionCleanupDecision`
- Decision values: `keep_formal_import`, `delete_explicit_test`, `delete_non_imported`, `review`.
- Evidence values are stable machine codes, not prose.
- Priority: explicit test evidence, verified committed import, verified legacy import, known non-imported source, ambiguity.

- [ ] **Step 1: Write the failing classifier matrix**

Cover at least these rows:

```python
@pytest.mark.parametrize(
    ("origin", "audit_action", "batch_status", "title", "expected"),
    [
        ("content_prep", "question_created", "committed", "正式题目", "keep_formal_import"),
        ("content_prep", "question_created", "committed", "__e2e_fixture__", "delete_explicit_test"),
        ("legacy_import", "legacy_import_verified", None, "正式旧题", "keep_formal_import"),
        ("manual", "question_created", None, "临时录入", "delete_non_imported"),
        (None, None, None, "来源未知", "review"),
    ],
)
def test_cleanup_classifier_priority(origin, audit_action, batch_status, title, expected):
    assert classify_fixture(origin, audit_action, batch_status, title).decision == expected
```

- [ ] **Step 2: Run the test and confirm the missing module fails**

Run: `cd backend && .venv/bin/python -m pytest tests/test_question_pool_cleanup.py -k classifier -q`

Expected: FAIL because the cleanup schema/service does not exist.

- [ ] **Step 3: Implement explicit evidence rules**

Treat these as test evidence when matched exactly by normalized metadata: `environment in {"test", "e2e", "pytest"}`, `fixture == true`, title/external-id prefixes `__test__`, `__e2e__`, `pytest-`, the seeded test batch IDs defined in the fixture, or a `QuestionAuditLog` action carrying `testFixture: true`. Do not classify ordinary words such as “测试方法” or “模拟题” as test content.

Treat an import as verified only when one of these holds:

```python
VERIFIED_IMPORT_ACTIONS = frozenset({
    "question_created",
    "question_updated",
    "legacy_import_verified",
})

def is_verified_import(question, audits, batch):
    return (
        batch is not None
        and batch.status == "committed"
        and any(a.action in VERIFIED_IMPORT_ACTIONS for a in audits)
    ) or any(a.action == "legacy_import_verified" for a in audits)
```

An `origin` string by itself is insufficient evidence.

- [ ] **Step 4: Make decisions serializable and deterministic**

Sort evidence codes and affected reference IDs, use UTC ISO-8601 timestamps, and exclude generated timestamps from the per-question decision hash. Validate that every decision includes `questionId`, `decision`, `evidenceCodes`, and `sourceFingerprint`.

- [ ] **Step 5: Run the classifier suite**

Run: `cd backend && .venv/bin/python -m pytest tests/test_question_pool_cleanup.py -k classifier -q`

Expected: PASS.

- [ ] **Step 6: Commit the classifier**

```bash
git add backend/app/schemas/question_cleanup.py backend/app/services/question_cleanup_service.py backend/tests/test_question_pool_cleanup.py backend/tests/fixtures/question_cleanup
git commit -m "feat: classify shared question pool provenance"
```

### Task 2: Build a content-addressed dry-run report

**Files:**
- Modify: `backend/app/services/question_cleanup_service.py`
- Create: `backend/app/services/question_cleanup_reference_service.py`
- Modify: `backend/scripts/question_pool_maintenance.py`
- Test: `backend/tests/test_question_pool_cleanup.py`

**Interfaces:**
- `build_report(db) -> QuestionCleanupReport`
- `snapshotHash`: SHA-256 of sorted live question fingerprints and relevant draft revisions.
- `manifestHash`: SHA-256 of canonical JSON excluding `generatedAt` and `manifestHash`.
- Report sections: `summary`, `keep`, `delete`, `review`, `references`, `snapshotHash`, `manifestHash`.

- [ ] **Step 1: Write a failing report and hash-stability test**

Create the same fixture data in two insertion orders. Reports must have identical manifest hashes, and a one-character question edit must change both snapshot and manifest hashes.

```python
assert report_a.manifest_hash == report_b.manifest_hash
assert [item.question_id for item in report_a.delete] == sorted(
    item.question_id for item in report_a.delete
)
```

- [ ] **Step 2: Run and verify report construction fails**

Run: `cd backend && .venv/bin/python -m pytest tests/test_question_pool_cleanup.py -k "report or hash" -q`

Expected: FAIL because report/reference analysis is not implemented.

- [ ] **Step 3: Inventory references without mutation**

Analyze relational `PaperQuestion` rows and every current shared-runtime draft key introduced in plan 1: papers, paper categories, course drafts, active courses, learning tasks, principles/presets, association libraries, and workbench aggregates. Report each reference as:

```json
{
  "containerType": "paper_draft",
  "containerId": "paper-17",
  "questionId": "q-44",
  "repairAction": "remove_question_and_recalculate"
}
```

Label published snapshots `preserve_historical_snapshot`; they remain visible in the report but are not repair targets.

- [ ] **Step 4: Implement canonical report hashing**

Use `json.dumps(payload, ensure_ascii=False, sort_keys=True, separators=(",", ":"))`. Include the cleanup policy version `question-cleanup-v1` in the hashed body. Never use Python object hashes or database row order.

- [ ] **Step 5: Add the read-only CLI command**

Implement:

```bash
cd backend
.venv/bin/python scripts/question_pool_maintenance.py report \
  --output var/question-cleanup/2026-08-10-report.json
```

The command prints counts and hashes, writes only the report file, and exits `2` when `reviewCount > 0`. It must not call `commit`, `delete`, or runtime mutation helpers.

- [ ] **Step 6: Run report tests and a local dry run**

Run: `cd backend && .venv/bin/python -m pytest tests/test_question_pool_cleanup.py -k "report or hash or reference" -q`

Run: `cd backend && .venv/bin/python scripts/question_pool_maintenance.py report --output var/question-cleanup/2026-08-10-report.json`

Expected: tests PASS. The local dry run may exit `2`; inspect the generated review set and do not apply.

- [ ] **Step 7: Commit the report phase**

```bash
git add backend/app/services/question_cleanup_service.py backend/app/services/question_cleanup_reference_service.py backend/scripts/question_pool_maintenance.py backend/tests/test_question_pool_cleanup.py
git commit -m "feat: report question cleanup impact safely"
```

### Task 3: Resolve ambiguous rows with a separate decision file

**Files:**
- Modify: `backend/app/schemas/question_cleanup.py`
- Modify: `backend/app/services/question_cleanup_service.py`
- Modify: `backend/scripts/question_pool_maintenance.py`
- Test: `backend/tests/test_question_pool_cleanup.py`

**Interfaces:**
- Decision file schema: `{ "manifestHash": str, "decisions": [{"questionId": str, "decision": "keep_formal_import" | "delete_non_imported", "reason": str}] }`.
- `apply_review_decisions(report, decisions) -> QuestionCleanupReport` rejects stale, missing, duplicate, or extra decisions.

- [ ] **Step 1: Write failing validation tests**

Assert rejection for a mismatched manifest hash, a missing review question, duplicate IDs, IDs absent from the review set, empty reasons, and `delete_explicit_test` supplied manually. Assert the resolved report has `reviewCount == 0` and a new manifest hash.

- [ ] **Step 2: Run and confirm validation is missing**

Run: `cd backend && .venv/bin/python -m pytest tests/test_question_pool_cleanup.py -k review_decisions -q`

Expected: FAIL.

- [ ] **Step 3: Implement closed-set resolution**

Only allow `keep_formal_import` or `delete_non_imported` for human decisions. Preserve the original automated evidence and append `human-review:<reason>` to evidence codes. Recompute `summary`, sorted sections, and `manifestHash`.

- [ ] **Step 4: Add `--decisions` to report**

`report --decisions tests/fixtures/question_cleanup/review-decisions.json` resolves ambiguity and writes the final manifest. The command still performs no database mutation.

- [ ] **Step 5: Run decision and report suites**

Run: `cd backend && .venv/bin/python -m pytest tests/test_question_pool_cleanup.py -k "review_decisions or report" -q`

Expected: PASS.

- [ ] **Step 6: Commit review resolution**

```bash
git add backend/app/schemas/question_cleanup.py backend/app/services/question_cleanup_service.py backend/scripts/question_pool_maintenance.py backend/tests/test_question_pool_cleanup.py backend/tests/fixtures/question_cleanup/review-decisions.json
git commit -m "feat: require explicit cleanup review decisions"
```

### Task 4: Add immutable cleanup audits and transactional apply

**Files:**
- Modify: `backend/app/models/question.py`
- Modify: `backend/app/models/__init__.py`
- Create: `backend/alembic/versions/5c84e1d3a720_add_question_cleanup_audits.py`
- Modify: `backend/app/services/question_cleanup_service.py`
- Modify: `backend/app/services/question_cleanup_reference_service.py`
- Modify: `backend/app/services/teaching_content_revision_service.py`
- Test: `backend/tests/test_question_pool_cleanup.py`

**Interfaces:**
- `apply_cleanup(db, report, actor, backup_receipt) -> QuestionCleanupApplyResult`.
- `QuestionCleanupAudit`: manifest hash, snapshot hash, actor, backup path/hash, counts, deleted IDs, repair summary, started/completed timestamps.
- Typed confirmation token: `DELETE-QUESTION-POOL:<first 12 chars of manifestHash>`.

- [ ] **Step 1: Write failing transaction/guard tests**

Assert apply is rejected when review remains, the backup path is absent, backup SHA differs, confirmation differs, or the current snapshot hash changed. Inject a repair failure and assert no question/reference/audit/revision changes persist.

- [ ] **Step 2: Run and confirm apply is absent**

Run: `cd backend && .venv/bin/python -m pytest tests/test_question_pool_cleanup.py -k "apply or rollback" -q`

Expected: FAIL.

- [ ] **Step 3: Add the cleanup audit model and migration**

Create a non-updateable service model with JSONB `deleted_question_ids` and `repair_summary`; index `manifest_hash`, `completed_at`, and `actor_username`. The service must refuse a second successful audit with the same manifest hash.

- [ ] **Step 4: Implement current-draft repairs**

Within the same transaction:

- Delete relational `PaperQuestion` rows for deleted questions and recalculate draft paper totals/quotas.
- Remove deleted IDs from current shared paper, course-draft, active-task, association, and workbench runtime payloads.
- Preserve published snapshots byte-for-byte and record their dangling historical references in the audit.
- Delete dependent mutable audit/lock rows in foreign-key-safe order, then delete questions.
- Delete an empty question bank only when it has no retained questions and no published snapshot dependency.
- Bump teaching content revision once with one `question_pool/cleanup` change record.

- [ ] **Step 5: Implement snapshot recheck and row locking**

Acquire a transaction advisory lock for `question-pool-cleanup-v1`, rebuild `snapshotHash` after the lock, compare it with the report, then lock target question/reference rows with `FOR UPDATE`. Any mismatch aborts before deletion.

- [ ] **Step 6: Run migration and apply suites**

Run: `cd backend && .venv/bin/alembic upgrade head`

Run: `cd backend && .venv/bin/python -m pytest tests/test_question_pool_cleanup.py -k "apply or rollback or audit" -q`

Expected: PASS.

- [ ] **Step 7: Commit transactional cleanup**

```bash
git add backend/app/models/question.py backend/app/models/__init__.py backend/alembic/versions/5c84e1d3a720_add_question_cleanup_audits.py backend/app/services/question_cleanup_service.py backend/app/services/question_cleanup_reference_service.py backend/app/services/teaching_content_revision_service.py backend/tests/test_question_pool_cleanup.py
git commit -m "feat: apply audited question cleanup transaction"
```

### Task 5: Add backup-gated CLI apply and post-apply verification

**Files:**
- Modify: `backend/scripts/question_pool_maintenance.py`
- Modify: `backend/tests/test_question_pool_cleanup.py`

**Interfaces:**
- `apply --report --backup --backup-sha256 --confirm --output`.
- `verify --apply-result` returns nonzero for retained-test rows, missing retained imports, live dangling references, revision mismatch, or audit mismatch.

- [ ] **Step 1: Write failing CLI guard and verification tests**

Use subprocess tests against the isolated test database. Assert `apply` is impossible without every guard option and `verify` detects a deliberately restored test row.

- [ ] **Step 2: Run and confirm CLI coverage fails**

Run: `cd backend && .venv/bin/python -m pytest tests/test_question_pool_cleanup.py -k cli -q`

Expected: FAIL.

- [ ] **Step 3: Implement backup receipt validation**

Resolve the supplied backup to an absolute regular file, reject symlinks, hash the bytes with SHA-256, and compare using `hmac.compare_digest`. The CLI must not create the backup itself or infer a path.

- [ ] **Step 4: Implement apply output and verification**

Write the apply result with mode `0600` using an atomic temporary-file rename. Verification reruns the classifier, asserts the delete set is empty, checks every retained question ID/fingerprint, validates repaired live references, and matches the immutable audit row.

- [ ] **Step 5: Run the full cleanup test suite**

Run: `cd backend && .venv/bin/python -m pytest tests/test_question_pool_cleanup.py -q`

Expected: PASS.

- [ ] **Step 6: Commit the operations CLI**

```bash
git add backend/scripts/question_pool_maintenance.py backend/tests/test_question_pool_cleanup.py
git commit -m "feat: gate question cleanup with backup verification"
```

### Task 6: Execute the approved cleanup only after human report review

**Files:**
- Generate: `backend/var/question-cleanup/2026-08-10-report.json`
- Generate: `backend/var/question-cleanup/2026-08-10-apply-result.json`
- Do not commit either generated file; both may contain operational identifiers.

- [ ] **Step 1: Generate the final read-only report**

Run:

```bash
cd backend
.venv/bin/python scripts/question_pool_maintenance.py report \
  --output var/question-cleanup/2026-08-10-report.json
```

Expected: all counts and hashes printed. If review is nonzero, stop, resolve every item through the decision-file flow, regenerate, and obtain user approval for the exact keep/delete counts.

- [ ] **Step 2: Create and verify an external PostgreSQL backup**

Choose an explicit path outside the repository, run `pg_dump` against the configured database, calculate `shasum -a 256`, and restore the backup into a temporary database to prove it is usable. Record the absolute path and hash; do not proceed if restore validation fails.

- [ ] **Step 3: Reconfirm target counts immediately before apply**

Read `summary`, `snapshotHash`, and `manifestHash` from the generated report. The user must confirm those exact values before the destructive command is run.

- [ ] **Step 4: Apply with the exact manifest-derived token**

Run with the explicit backup path/hash and the token printed by `report`:

```bash
cd backend
.venv/bin/python scripts/question_pool_maintenance.py apply \
  --report var/question-cleanup/2026-08-10-report.json \
  --backup /absolute/verified/question-pool-before-cleanup.dump \
  --backup-sha256 64-character-sha256-from-the-verified-backup \
  --confirm DELETE-QUESTION-POOL:first-12-manifest-characters \
  --output var/question-cleanup/2026-08-10-apply-result.json
```

Replace the three descriptive command values with the exact verified values. Never script or auto-derive the confirmation value inside the apply invocation.

- [ ] **Step 5: Verify and smoke test**

Run: `cd backend && .venv/bin/python scripts/question_pool_maintenance.py verify --apply-result var/question-cleanup/2026-08-10-apply-result.json`

Then open the shared question bank as an administrator and two teachers, confirm the retained imported count matches the report, and open every repaired current draft. Confirm published historical snapshots remain readable.

- [ ] **Step 6: Record the operational result without committing sensitive artifacts**

Record the cleanup audit ID, final counts, backup location, and recovery procedure in the deployment handoff. Keep the generated report/result and backup under access control.

## Plan 2 Completion Gate

- The final report has no unresolved review rows and has explicit keep/delete counts approved by the user.
- Every retained question has verified formal-import evidence and its fingerprint remains unchanged.
- Every explicit test fixture and every non-imported question in the approved manifest is deleted.
- Current drafts contain no deleted question IDs; published historical snapshots remain byte-identical.
- Apply has one immutable audit row, one teaching-content revision bump, and a verified restorable backup.
- A second apply of the same manifest is rejected, and the post-apply verifier passes.
