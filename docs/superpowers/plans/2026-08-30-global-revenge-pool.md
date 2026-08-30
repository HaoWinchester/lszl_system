# Global Revenge Mistake Pool Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make revenge mode create one resumable, account-wide session from valid mistakes across papers and releases, including legacy versionless mistakes, while deduplicating by `question_id` without deleting history.

**Architecture:** Add a global-mistake grouping service that produces stable representative records and deduplicated stats. Global revenge sessions store server-owned question snapshots directly in `question_order`; a shared session-question abstraction lets validation, pause, restore, grading, and reporting consume either embedded revenge snapshots or ordinary published-release rows. Existing paper-bound revenge sessions remain readable and resumable.

**Tech Stack:** FastAPI, SQLAlchemy async, PostgreSQL/JSONB, Alembic, pytest/TestClient, native JavaScript, Node contract tests, Playwright browser tests.

## Global Constraints

- `new-legacy/` is the authoritative frontend source; generated `frontend/public/new-legacy/` and active releases are never edited by hand.
- Business state remains PostgreSQL-backed and owner-isolated; browser storage is not a source of truth.
- Duplicate mistakes are logically grouped by `question_id`; no `practice_mistakes` row is deleted or rewritten merely for deduplication.
- Challenge, scholar, and practice sessions remain bound to non-null `paper_id` and `release_id` values.
- Long-term mistake state advances only through server-authoritative grading at whole-paper completion.
- Every production behavior is introduced by a failing test first.
- The final frontend release must use `node frontend/scripts/manage-new-legacy.js update new-legacy --skip-browser` and pass its file-count, critical-page, API, and visual gates before promotion.

---

## File Map

- `backend/app/models/training.py`: allow global revenge sessions to have nullable paper/release references.
- `backend/alembic/versions/c9f2e6a1b430_global_revenge_sessions.py`: compatible nullable-column migration and downgrade guard.
- `backend/app/services/learning_service.py`: global eligibility, snapshot validation, logical grouping, representative selection, and deduplicated revenge statistics.
- `backend/app/services/practice_session_service.py`: global session creation/resume plus embedded-snapshot validation, persistence, grading, and reporting.
- `backend/tests/test_practice_learning_api.py`: deduplicated overview and owner-isolation API contracts.
- `backend/tests/test_practice_sessions.py`: cross-paper, versionless, deduplicated, resumable, transactional global revenge contracts.
- `frontend/scripts/new-legacy-assets/practice-learning-adapter.js`: expose server-provided deduplicated revenge stats and deduplicate the local active-list fallback.
- `new-legacy/src/100-practice-mode.js`: start/resume revenge independently of current paper and render global empty/error copy.
- `frontend/scripts/practice-learning-contract.test.mjs`: static adapter/request contract.
- `new-legacy/tests/practice-answer-sheet-browser.py`: real-button global revenge start, paper-switch invariance, pause/resume, and empty/error recovery.

---

### Task 1: Permit Explicit Global Revenge Sessions in the Data Model

**Files:**
- Create: `backend/alembic/versions/c9f2e6a1b430_global_revenge_sessions.py`
- Modify: `backend/app/models/training.py:147-190`
- Test: `backend/tests/test_practice_sessions.py:301-334`

**Interfaces:**
- Produces: `PracticeSession.paper_id: str | None` and `PracticeSession.release_id: str | None`.
- Preserves: ordinary session service validation still rejects missing paper/release identifiers.

- [ ] **Step 1: Write the failing model and migration contract**

Add assertions that both ORM columns are nullable and that the new Alembic revision alters only `practice_sessions.paper_id` and `practice_sessions.release_id` nullability:

```python
def test_practice_session_model_allows_global_revenge_scope() -> None:
    table = PracticeSession.__table__
    assert table.c.paper_id.nullable is True
    assert table.c.release_id.nullable is True

    migration = Path("alembic/versions/c9f2e6a1b430_global_revenge_sessions.py").read_text()
    assert 'op.alter_column("practice_sessions", "paper_id", nullable=True)' in migration
    assert 'op.alter_column("practice_sessions", "release_id", nullable=True)' in migration
```

- [ ] **Step 2: Run the focused test and verify RED**

Run: `cd backend && .venv/bin/python -m pytest tests/test_practice_sessions.py::test_practice_session_model_allows_global_revenge_scope -q`

Expected: FAIL because both columns are currently non-null and the migration does not exist.

- [ ] **Step 3: Implement the compatible migration and ORM types**

Create revision `c9f2e6a1b430` with `down_revision = "a8c1d4e7f920"`:

```python
def upgrade() -> None:
    op.alter_column("practice_sessions", "paper_id", nullable=True)
    op.alter_column("practice_sessions", "release_id", nullable=True)


def downgrade() -> None:
    bind = op.get_bind()
    global_count = bind.execute(
        sa.text(
            "SELECT count(*) FROM practice_sessions "
            "WHERE paper_id IS NULL OR release_id IS NULL"
        )
    ).scalar_one()
    if global_count:
        raise RuntimeError(
            "cannot restore non-null practice session scope while global revenge sessions exist"
        )
    op.alter_column("practice_sessions", "release_id", nullable=False)
    op.alter_column("practice_sessions", "paper_id", nullable=False)
```

Update the ORM annotations to `Mapped[str | None]` with `nullable=True`. Do not relax `start_session` validation for non-revenge modes in this task.

- [ ] **Step 4: Run migration/model tests and verify GREEN**

Run: `cd backend && .venv/bin/python -m pytest tests/test_practice_sessions.py -k 'model_has_resumable or model_allows_global' -q`

Expected: both model tests PASS.

- [ ] **Step 5: Apply and inspect the migration**

Run:

```bash
cd backend
.venv/bin/alembic upgrade head
psql -d kg_graph_dev -Atqc "SELECT column_name,is_nullable FROM information_schema.columns WHERE table_name='practice_sessions' AND column_name IN ('paper_id','release_id') ORDER BY column_name"
```

Expected: both columns report `YES`; existing sessions remain present.

- [ ] **Step 6: Commit the independently testable schema change**

```bash
git add backend/app/models/training.py backend/alembic/versions/c9f2e6a1b430_global_revenge_sessions.py backend/tests/test_practice_sessions.py
git commit -m "feat: allow global revenge sessions"
```

---

### Task 2: Build the Global Eligible and Deduplicated Mistake Pool

**Files:**
- Modify: `backend/app/services/learning_service.py:270-300,842-914`
- Test: `backend/tests/test_practice_learning_api.py`

**Interfaces:**
- Produces: `global_revenge_candidates(db, owner, *, now=None) -> list[dict]`.
- Candidate shape: `{mistakeId, mistakeIds, questionId, bankId, paperId, paperName, releaseId, paperVersion, status, wrongCount, revengeWrongCount, questionSnapshot}`.
- Produces: `global_revenge_stats(candidates, grouped_all) -> dict` with `active`, `pending`, `needsRemediation`, `verificationDue`, `verificationWaiting`, and `mastered`.
- Consumed by: Task 3 session creation and the overview API.

- [ ] **Step 1: Write failing grouping and overview tests**

Seed, for one owner, two active rows with the same `question_id` but different releases, one versionless row for a different question, one future `verification_due`, and one mastered row. Assert:

```python
overview = client.get("/api/v1/learning/practice/overview").json()
assert overview["revengeStats"] == {
    "active": 2,
    "pending": 2,
    "needsRemediation": 0,
    "verificationDue": 0,
    "verificationWaiting": 1,
    "mastered": 1,
}
assert len(overview["revengeCandidates"]) == 2
duplicate = next(row for row in overview["revengeCandidates"] if len(row["mistakeIds"]) == 2)
assert duplicate["mistakeId"] == expected_representative_id
```

Add an owner-B assertion that its overview contains none of owner A's IDs.

- [ ] **Step 2: Run the focused overview tests and verify RED**

Run: `cd backend && .venv/bin/python -m pytest tests/test_practice_learning_api.py -k 'global_revenge or deduplicat' -q`

Expected: FAIL because `revengeStats` and `revengeCandidates` are absent.

- [ ] **Step 3: Implement pure eligibility, snapshot, and ranking helpers**

Add pure functions with these exact responsibilities:

```python
def _revenge_snapshot_usable(snapshot: dict) -> bool:
    options = snapshot.get("options") if isinstance(snapshot, dict) else None
    option_ids = {str(item.get("id") or "") for item in options or [] if isinstance(item, dict)}
    correct = str(snapshot.get("correctAnswer") or "") if isinstance(snapshot, dict) else ""
    stem = str(snapshot.get("stem") or snapshot.get("title") or "") if isinstance(snapshot, dict) else ""
    return bool(stem and len(option_ids - {""}) >= 2 and correct in option_ids)


def _revenge_status_rank(row: PracticeMistake, now) -> int:
    if row.status == "needs_remediation": return 0
    if row.status == "pending": return 1
    if row.status == "verification_due" and (row.next_review_at is None or row.next_review_at <= now): return 2
    if row.status == "verification_due": return 3
    if row.status == "mastered": return 4
    return 9
```

Group only rows with a non-empty `question_id`; sort every group by status rank, descending revenge-wrong count, descending wrong count, descending `updated_at`, and stable ID. Include only usable ranks 0-2 in `global_revenge_candidates`; retain ranks 3-4 when computing deduplicated display stats.

- [ ] **Step 4: Implement the database-backed global query and overview fields**

Query all `PracticeMistake` rows by `owner_id` once. Build grouped representatives and return safe serialized candidates with redacted public snapshots from `practice_overview`; keep full snapshots inside the internal `global_revenge_candidates` result used by session creation.

Keep existing raw `stats` and `mistakes` fields for compatibility. Add `revengeStats` and `revengeCandidates`, and build the recommendation plan from `revengeStats` so the suggested action is executable.

- [ ] **Step 5: Run focused tests and verify GREEN**

Run: `cd backend && .venv/bin/python -m pytest tests/test_practice_learning_api.py -k 'practice_mistake or global_revenge or deduplicat' -q`

Expected: all selected tests PASS; raw historical records remain in `mistakes`.

- [ ] **Step 6: Commit the global-pool service**

```bash
git add backend/app/services/learning_service.py backend/tests/test_practice_learning_api.py
git commit -m "feat: deduplicate global revenge mistakes"
```

---

### Task 3: Create and Restore Snapshot-Backed Global Revenge Sessions

**Files:**
- Modify: `backend/app/services/practice_session_service.py:165-220,308-530,580-610`
- Test: `backend/tests/test_practice_sessions.py`

**Interfaces:**
- Consumes: `learning_service.global_revenge_candidates` from Task 2.
- Produces: `_session_question_rows(db, session) -> dict[str, SessionQuestion]`.
- `SessionQuestion` fields: `question_id`, `bank_id`, `snapshot`, `order_index`, `release_id`.
- Global revenge start input: `{mode: "revenge", count: int, order: "paper"}`; paper/release fields are ignored rather than trusted.

- [ ] **Step 1: Write the failing cross-paper/versionless start test**

Seed three eligible mistake records: two different questions from two releases and one versionless historical record. Start without paper/release IDs and assert:

```python
response = client.post("/api/v1/learning/practice/sessions/start", json={
    "mode": "revenge", "count": 10, "order": "paper",
})
assert response.status_code == 200, response.text
session = response.json()["session"]
assert session["paperId"] is None
assert session["releaseId"] is None
assert session["stats"]["total"] == 3
assert {item["sourceReleaseId"] for item in session["questionOrder"]} == {release_a, release_b, ""}
assert len(session["questions"]) == 3
```

Add a duplicate row for the first question and assert its question appears once with both IDs in `mistakeIds`.

- [ ] **Step 2: Run the start test and verify RED**

Run: `cd backend && .venv/bin/python -m pytest tests/test_practice_sessions.py -k 'global_revenge_session_crosses' -q`

Expected: FAIL with `PRACTICE_RELEASE_REQUIRED`.

- [ ] **Step 3: Add the shared session-question abstraction**

Define:

```python
@dataclass(frozen=True)
class SessionQuestion:
    question_id: str
    bank_id: str
    snapshot: dict
    order_index: int
    release_id: str
```

`_session_question_rows` must read embedded `questionSnapshot` from revenge refs when present; otherwise it loads `PaperReleaseQuestion` rows and converts them to `SessionQuestion`. Replace `_validated_draft_answers` and `_session_payload` reads with this helper.

- [ ] **Step 4: Split start validation by mode and freeze global refs**

For revenge mode:

```python
scope = "practice-session:global:revenge"
existing_query = select(PracticeSession).where(
    PracticeSession.owner_id == owner,
    PracticeSession.mode == "revenge",
    PracticeSession.status.in_(["active", "paused"]),
).order_by(PracticeSession.last_saved_at.desc(), PracticeSession.id)
```

Return `RESUMABLE_SESSION_EXISTS` with the most recently saved legacy or global revenge session. If none exists, select up to `count` global candidates and create refs containing `mistakeId`, `mistakeIds`, source metadata, and a deep-copied `questionSnapshot`. Create the session with `paper_id=None`, `release_id=None`, default scoring, and generic report identity `全局复仇错题`.

For all non-revenge modes, retain existing required paper/release validation and paper-level advisory lock unchanged.

- [ ] **Step 5: Run start, payload, and resume tests and verify GREEN**

Run: `cd backend && .venv/bin/python -m pytest tests/test_practice_sessions.py -k 'revenge and (global or resumable or cross)' -q`

Expected: global start passes; existing single-release revenge resume test remains green after updating only its start payload expectation.

- [ ] **Step 6: Commit global session creation**

```bash
git add backend/app/services/practice_session_service.py backend/tests/test_practice_sessions.py
git commit -m "feat: start global revenge sessions"
```

---

### Task 4: Make Pause, Completion, Grading, and Reports Snapshot-Aware

**Files:**
- Modify: `backend/app/services/practice_session_service.py:670-755,1040-1110,1230-1665`
- Test: `backend/tests/test_practice_sessions.py`

**Interfaces:**
- Consumes: `_session_question_rows` and embedded representative `mistakeId` from Task 3.
- Preserves: whole-paper request shape `{revision, answers, runtimeState}` and idempotent completion response.

- [ ] **Step 1: Write failing pause/restore/complete tests**

For a global session containing cross-paper and versionless refs:

```python
paused = client.post(f"/api/v1/learning/practice/sessions/{session_id}/pause", json={
    "revision": revision,
    "answers": {question_id: {"selectedAnswer": "A", "selectionIndex": 1}},
    "runtimeState": {"currentIndex": 1},
})
assert paused.status_code == 200
restored = client.get(f"/api/v1/learning/practice/sessions/{session_id}").json()["session"]
assert restored["questions"][0]["question"]["correctAnswer"]
```

Complete the full session and assert only each representative mistake advances once; duplicate history rows remain unchanged and still exist. Add a forced invalid-snapshot completion case and assert the transaction leaves every mistake counter and session revision unchanged.

- [ ] **Step 2: Run the focused lifecycle tests and verify RED**

Run: `cd backend && .venv/bin/python -m pytest tests/test_practice_sessions.py -k 'global_revenge and (pause or complete or rollback)' -q`

Expected: FAIL where pause/completion still calls `_release_question_rows` with a null release.

- [ ] **Step 3: Replace remaining release-row assumptions**

Use `_session_question_rows` in answer validation, saved-draft stats, legacy per-answer grading, complete-session grading, and report building. Change missing-row copy to `题目不存在于当前练习快照` for global revenge while retaining the existing error code.

In `_build_report`, use `全局复仇错题` when `session.mode == "revenge" and session.release_id is None`; otherwise retain the published release name.

- [ ] **Step 4: Keep grading authoritative and representative-only**

Continue calling:

```python
learning_service.record_revenge_answer(
    db,
    owner,
    str(ref.get("mistakeId") or ""),
    {"selectedAnswer": selected},
    commit=False,
    allow_concurrent=True,
    record=record,
)
```

Do not loop over `mistakeIds`. Verify the representative still belongs to the owner and matches `ref.questionId` before mutation; return `PRACTICE_MISTAKE_NOT_FOUND` on mismatch.

- [ ] **Step 5: Run lifecycle and full practice-session tests and verify GREEN**

Run:

```bash
cd backend
.venv/bin/python -m pytest tests/test_practice_sessions.py -k 'global_revenge or revenge_mode or complete_whole_paper' -q
.venv/bin/python -m pytest tests/test_practice_sessions.py -q
```

Expected: focused and full file PASS with no partial mutation failures.

- [ ] **Step 6: Commit the snapshot lifecycle**

```bash
git add backend/app/services/practice_session_service.py backend/tests/test_practice_sessions.py
git commit -m "feat: complete snapshot-backed revenge sessions"
```

---

### Task 5: Detach the Frontend Revenge Entry from the Selected Paper

**Files:**
- Modify: `frontend/scripts/new-legacy-assets/practice-learning-adapter.js:40-80,120-135`
- Modify: `new-legacy/src/100-practice-mode.js:255-266,849-972,1020-1045,1090-1107`
- Test: `frontend/scripts/practice-learning-contract.test.mjs`
- Test: `new-legacy/tests/practice-answer-sheet-browser.py`

**Interfaces:**
- Consumes: overview `revengeStats` and session start response from Tasks 2-4.
- Produces: revenge start body `{mode: "revenge", count, order: "paper"}`.
- Preserves: challenge/scholar/practice start body with paper and release IDs.

- [ ] **Step 1: Write failing static and browser contracts**

Static assertions:

```javascript
assert.match(practice, /mode==='revenge'\?\{mode,count,order\}:\{paperId,releaseId,mode,count,order\}/)
assert.match(adapter, /revengeStats/)
assert.doesNotMatch(practice, /resumable\?await api\.getSession\(resumable\.id\).*paperId.*revenge/s)
```

Browser flow: seed global deduplicated stats and a cross-paper session, switch the visible paper, click `[data-practice-start="revenge"]`, and assert the recorded start body has no paper/release IDs and the restored questions are unchanged. Add an empty response/error case and assert the button/loader recover for retry.

- [ ] **Step 2: Run frontend contracts and verify RED**

Run:

```bash
cd frontend
node --test scripts/practice-learning-contract.test.mjs
cd ..
python3 new-legacy/tests/practice-answer-sheet-browser.py
```

Expected: start-body and paper-switch assertions FAIL against the current selected-paper implementation.

- [ ] **Step 3: Expose deduplicated stats in the shared adapter**

Store both raw `stats` and `revengeStats` in the overview. Make `stats()` return `overview.revengeStats` when present, falling back to raw stats for compatibility. Deduplicate `active()` by `questionId` using the same status/count ordering for unauthenticated/local fallback behavior.

- [ ] **Step 4: Implement paper-independent start and resume**

In `startPractice`, branch input construction:

```javascript
const input = mode === 'revenge'
  ? {mode, count, order: 'paper'}
  : {paperId, releaseId, mode, count, order};
```

For revenge, find the first active session by `mode` only. Do not require `selectedRelease()` or paper access before the revenge branch. Update `syncResumableButtons` to label the revenge button from any active revenge session, while other modes remain matched by paper ID.

Replace the error copy with `当前没有可用的全局复仇错题。` and keep the button usable after a failed request.

- [ ] **Step 5: Run focused frontend tests and verify GREEN**

Run:

```bash
cd frontend
node --test scripts/practice-learning-contract.test.mjs
cd ..
python3 new-legacy/tests/practice-answer-sheet-browser.py
```

Expected: both pass, including positive, empty, failed-request, retry, paper-switch, and resume paths.

- [ ] **Step 6: Commit the frontend entry**

```bash
git add frontend/scripts/new-legacy-assets/practice-learning-adapter.js new-legacy/src/100-practice-mode.js frontend/scripts/practice-learning-contract.test.mjs new-legacy/tests/practice-answer-sheet-browser.py
git commit -m "feat: open revenge from the global pool"
```

---

### Task 6: Full Verification, Release Promotion, and Branch Integration

**Files:**
- Generated by release tooling: `frontend/public/new-legacy/**`
- Generated by release tooling: `frontend/new-legacy-releases/**`
- Verify: repository status, migrations, backend/frontend suites, active release manifest.

**Interfaces:**
- Consumes: all prior tasks.
- Produces: promoted active release and a clean `main` containing the feature.

- [ ] **Step 1: Run migration and backend verification**

```bash
cd backend
.venv/bin/alembic upgrade head
.venv/bin/python -m pytest tests/test_practice_learning_api.py tests/test_practice_sessions.py -q
.venv/bin/python -m pytest tests/ -q
```

Expected: all tests PASS; report any pre-existing warning separately rather than hiding it.

- [ ] **Step 2: Run frontend contracts and browser coverage**

```bash
cd frontend
pnpm test
pnpm test:design
cd ..
python3 new-legacy/tests/practice-answer-sheet-browser.py
```

Expected: all tests PASS; global revenge remains usable after switching papers and after refresh/login recovery.

- [ ] **Step 3: Perform the required release update**

```bash
node frontend/scripts/manage-new-legacy.js update new-legacy --skip-browser
```

Expected: sync, build, file-count, critical-page, API, and visual gates pass and the new release is promoted.

- [ ] **Step 4: Verify active release contents and working tree**

Resolve the new version from `frontend/new-legacy-releases/current.json`; compare candidate/active file counts and confirm the active `site/src/100-practice-mode.js` contains the global revenge start branch. Run `git diff --check` and inspect `git status --short` so only intended generated artifacts remain.

- [ ] **Step 5: Commit generated release artifacts**

```bash
git add frontend/public/new-legacy frontend/new-legacy-releases frontend/new-legacy-release frontend/scripts/new-legacy-seed-version.js
git commit -m "build: publish global revenge pool"
```

Only add paths that the release command actually changed; omit nonexistent or unchanged paths.

- [ ] **Step 6: Merge into main and push through the required proxy**

```bash
git switch main
git merge --no-ff codex/global-revenge-pool
git -c http.proxy=http://127.0.0.1:7897 push origin main
git ls-remote origin refs/heads/main
```

Expected: remote `main` resolves to the local merge commit.

- [ ] **Step 7: Remove the finished feature branch**

```bash
git branch -d codex/global-revenge-pool
git -c http.proxy=http://127.0.0.1:7897 push origin --delete codex/global-revenge-pool
git branch --list
git branch -r
```

Delete the remote branch only if it was pushed during implementation. Preserve unrelated branches/worktrees and report them rather than deleting them.
