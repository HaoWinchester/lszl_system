# Multiple-Choice Paper Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add an end-to-end multiple-choice paper type with import, immutable release snapshots, resumable multi-select practice, exact-set scoring, and revenge remediation.

**Architecture:** Extend the existing question, paper, release, practice-session, and mistake paths. Store canonical option-ID arrays, reuse the current JSONB session/mistake records, and add one small shared answer-set helper per runtime instead of a parallel exam system.

**Tech Stack:** FastAPI, Pydantic v2, SQLAlchemy async, PostgreSQL JSONB, Alembic, native HTML/CSS/JavaScript, Node test runner, pytest.

## Global Constraints

- Work only on `codex/multiple-choice-paper`, based on `uat`.
- `new-legacy/` is the only hand-edited frontend source; generated sync and release artifacts are produced by project scripts.
- Do not add dependencies.
- Multi-choice questions have 3–8 unique options, at least 2 correct options, and at least 1 distractor.
- Exact set match is the only passing answer; missing, extra, wrong, unconfirmed, and timed-out answers score zero.
- `analysis` may be absent on a draft but is mandatory for release; `trap` remains optional.
- `standard` papers reject `multiple_choice`; `multiple_choice` papers reject every other question type.
- Historical single-choice questions, releases, sessions, results, and mistakes remain readable without bulk rewriting.
- Server snapshots are the grading authority; client truth fields are ignored.
- Keep the smallest working diff and reuse existing services before creating new layers.

---

### Task 1: Canonical answer-set persistence and helper

**Files:**
- Create: `backend/app/services/question_answer_service.py`
- Create: `backend/tests/test_question_answer_service.py`
- Create: `backend/alembic/versions/e7b4c2d8a910_multiple_choice_papers.py`
- Modify: `backend/app/models/question.py`
- Modify: `backend/app/models/paper_release.py`
- Modify: `backend/app/models/training.py`
- Modify: `backend/app/schemas/question_catalog.py`

**Interfaces:**
- Produces: `normalize_option_ids(values, option_ids) -> list[str]`
- Produces: `correct_option_ids(payload) -> list[str]`
- Produces: `validate_multiple_choice(payload, require_analysis=False) -> list[dict]`
- Produces: `grade_selection(snapshot, selected_option_ids, timed_out=False) -> dict`
- Persists: `Question.correct_answer_ids`, `ExamPaper.paper_type`, `PaperRelease.paper_type`, `PracticeVerification.selected_answer_ids`

- [ ] **Step 1: Write answer-set unit tests**

```python
def test_grade_selection_requires_exact_set() -> None:
    snapshot = {
        "type": "multiple_choice",
        "options": [{"id": value} for value in "ABCD"],
        "correctOptionIds": ["A", "C"],
    }
    assert grade_selection(snapshot, ["C", "A"])["correct"] is True
    assert grade_selection(snapshot, ["A"])["missedCorrectIds"] == ["C"]
    assert grade_selection(snapshot, ["A", "B", "C"])["wrongSelectedIds"] == ["B"]


def test_legacy_joined_answer_is_only_read_when_unambiguous() -> None:
    assert correct_option_ids({
        "type": "multiple_choice",
        "options": [{"id": value} for value in "ABC"],
        "correctAnswer": "AC",
    }) == ["A", "C"]
    assert correct_option_ids({
        "type": "multiple_choice",
        "options": [{"id": "AA"}, {"id": "C"}],
        "correctAnswer": "AAC",
    }) == []
```

- [ ] **Step 2: Run the focused tests and verify failure**

Run: `cd backend && .venv/bin/python -m pytest tests/test_question_answer_service.py -q`

Expected: FAIL because `app.services.question_answer_service` does not exist.

- [ ] **Step 3: Implement the minimal shared helper**

```python
def normalize_option_ids(values, option_ids):
    order = {value: index for index, value in enumerate(option_ids)}
    normalized = [str(value).strip() for value in values or []]
    if any(not value or value not in order for value in normalized):
        return []
    return sorted(set(normalized), key=order.__getitem__)


def grade_selection(snapshot, selected_option_ids, timed_out=False):
    expected = correct_option_ids(snapshot)
    selected = [] if timed_out else normalize_option_ids(
        selected_option_ids,
        [str(option.get("id") or "") for option in snapshot.get("options") or []],
    )
    return {
        "correct": bool(expected) and selected == expected and not timed_out,
        "correctOptionIds": expected,
        "selectedOptionIds": selected,
        "missedCorrectIds": [value for value in expected if value not in selected],
        "wrongSelectedIds": [value for value in selected if value not in expected],
    }
```

Reject duplicate IDs at request validation before normalization; internal canonicalization remains idempotent.

- [ ] **Step 4: Add model fields and migration**

The migration uses `down_revision = "d3f7a9c2e510"` and adds:

```python
op.add_column("questions", sa.Column("correct_answer_ids", postgresql.JSONB(), nullable=False, server_default=sa.text("'[]'::jsonb")))
op.add_column("exam_papers", sa.Column("paper_type", sa.String(32), nullable=False, server_default="standard"))
op.create_check_constraint("ck_exam_papers_paper_type", "exam_papers", "paper_type IN ('standard', 'multiple_choice')")
op.add_column("paper_releases", sa.Column("paper_type", sa.String(32), nullable=False, server_default="standard"))
op.add_column("practice_verifications", sa.Column("selected_answer_ids", postgresql.JSONB(), nullable=False, server_default=sa.text("'[]'::jsonb")))
```

Map the same fields in SQLAlchemy. Add `correct_option_ids: list[str]` with alias `correctOptionIds` to `QuestionPayload`.

- [ ] **Step 5: Run unit and migration checks**

Run:

```bash
cd backend
.venv/bin/python -m pytest tests/test_question_answer_service.py tests/test_paper_models.py -q
.venv/bin/alembic upgrade head
.venv/bin/alembic current
```

Expected: tests PASS and current revision is `e7b4c2d8a910`.

- [ ] **Step 6: Commit**

```bash
git add backend/app/services/question_answer_service.py backend/tests/test_question_answer_service.py backend/alembic/versions/e7b4c2d8a910_multiple_choice_papers.py backend/app/models/question.py backend/app/models/paper_release.py backend/app/models/training.py backend/app/schemas/question_catalog.py
git commit -m "feat: add canonical multiple-choice answers"
```

### Task 2: Question save and JSON import

**Files:**
- Modify: `backend/app/services/question_content_service.py`
- Modify: `backend/app/services/content_prep_service.py`
- Modify: `backend/app/services/question_catalog_service.py`
- Modify: `backend/app/services/question_service.py`
- Modify: `backend/tests/test_question_content_service.py`
- Modify: `backend/tests/test_question_import.py`
- Modify: `backend/tests/test_question_catalog.py`

**Interfaces:**
- Consumes: `correct_option_ids()` and `validate_multiple_choice()` from Task 1
- Produces: catalog payloads with `correctOptionIds`
- Produces: structural import errors while allowing missing `analysis` as a draft-readiness warning

- [ ] **Step 1: Add failing service and import tests**

```python
def test_multiple_choice_payload_preserves_answer_array() -> None:
    raw = complete_question()
    raw.update({
        "type": "multiple_choice",
        "options": [{"id": value, "text": value} for value in "ABCD"],
        "correctOptionIds": ["A", "C"],
        "correctAnswer": None,
    })
    normalized = normalize_question_payload(raw, subject="PMP")
    assert normalized["correctOptionIds"] == ["A", "C"]


def test_question_bank_import_rejects_one_correct_multi_choice(client, teacher_headers):
    payload = multiple_choice_bank_payload(correct_ids=["A"])
    response = client.post("/api/v1/question-catalog/import", json={"banks": [payload]}, headers=teacher_headers)
    assert response.status_code == 422
```

- [ ] **Step 2: Run focused tests and verify failure**

Run: `cd backend && .venv/bin/python -m pytest tests/test_question_content_service.py tests/test_question_import.py tests/test_question_catalog.py -q`

Expected: at least the new array-preservation and invalid-multi tests FAIL.

- [ ] **Step 3: Wire canonical arrays through normalization and persistence**

In both content services:

```python
normalized["correctOptionIds"] = question_answer_service.correct_option_ids(normalized)
issues.extend(question_answer_service.validate_multiple_choice(normalized))
```

Persist with:

```python
question.correct_answer_ids = normalized.get("correctOptionIds") or []
question.correct_answer = (
    str(normalized.get("correctAnswer") or "")[:20] or None
    if question.type != "multiple_choice"
    else None
)
```

Serialize `correctOptionIds` from `question.correct_answer_ids`. Missing `analysis` leaves `status.contentReady=false` but does not reject a structurally valid draft import.

- [ ] **Step 4: Make duplicate signatures order-independent**

Change question hashing to include canonical arrays:

```python
canonical["correctOptionIds"] = question_answer_service.correct_option_ids(canonical)
canonical.pop("correctAnswer", None) if canonical.get("type") == "multiple_choice" else None
```

- [ ] **Step 5: Run focused tests**

Run: `cd backend && .venv/bin/python -m pytest tests/test_question_content_service.py tests/test_question_import.py tests/test_question_catalog.py -q`

Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add backend/app/services/question_content_service.py backend/app/services/content_prep_service.py backend/app/services/question_catalog_service.py backend/app/services/question_service.py backend/tests/test_question_content_service.py backend/tests/test_question_import.py backend/tests/test_question_catalog.py
git commit -m "feat: preserve imported multiple-choice answers"
```

### Task 3: Paper type, composition, and release enforcement

**Files:**
- Modify: `backend/app/schemas/paper.py`
- Modify: `backend/app/services/paper_service.py`
- Modify: `backend/app/services/paper_import_service.py`
- Modify: `backend/app/services/paper_composition_service.py`
- Modify: `backend/app/services/paper_release_service.py`
- Modify: `backend/tests/test_paper_draft_api.py`
- Modify: `backend/tests/test_paper_import_api.py`
- Modify: `backend/tests/test_paper_composition_api.py`
- Modify: `backend/tests/test_paper_releases.py`

**Interfaces:**
- Produces: `paperType: Literal["standard", "multiple_choice"]` in paper/release payloads
- Enforces: `PAPER_TYPE_QUESTION_MISMATCH` and `PAPER_TYPE_LOCKED`
- Consumes: Task 1 multi-choice validator before release snapshots are written

- [ ] **Step 1: Add failing paper-type tests**

```python
def test_multiple_choice_paper_rejects_single_choice_reference(client, teacher_headers, single_question):
    paper = create_paper(client, teacher_headers, paperType="multiple_choice")
    response = replace_questions(client, teacher_headers, paper, [single_question])
    assert response.status_code == 422
    assert response.json()["detail"]["code"] == "PAPER_TYPE_QUESTION_MISMATCH"


def test_published_release_freezes_paper_type(client, teacher_headers, multi_question):
    paper = create_multi_paper_with_question(client, teacher_headers, multi_question)
    release = publish(client, teacher_headers, paper)
    assert release["paperType"] == "multiple_choice"
    assert release["questions"][0]["question"]["correctOptionIds"] == ["A", "C"]
```

- [ ] **Step 2: Run focused paper tests and verify failure**

Run: `cd backend && .venv/bin/python -m pytest tests/test_paper_draft_api.py tests/test_paper_import_api.py tests/test_paper_composition_api.py tests/test_paper_releases.py -q`

Expected: new tests FAIL because `paperType` is not accepted or enforced.

- [ ] **Step 3: Add paper type to schemas and serialization**

```python
paper_type: Literal["standard", "multiple_choice"] = Field(default="standard", alias="paperType")
```

Create with `paper_type=request.paper_type`; serialize as `paperType`. Updates may change type only when the paper has no questions and `published_version == 0`, otherwise return `PAPER_TYPE_LOCKED`.

- [ ] **Step 4: Enforce type at reference, composition, import, and publish boundaries**

Use one predicate in `paper_service.py`:

```python
def question_matches_paper_type(paper_type: str, question_type: str) -> bool:
    return question_type == "multiple_choice" if paper_type == "multiple_choice" else question_type != "multiple_choice"
```

Call it from reference replacement, imported-paper creation, composition candidate filtering, and release validation. For legacy import packages, infer `multiple_choice` only when every resolved question is multi; infer `standard` only when none are multi; reject mixed packages.

- [ ] **Step 5: Require analysis and valid arrays at release**

Before snapshot creation:

```python
issues = question_answer_service.validate_multiple_choice(
    question_catalog_service.question_to_payload(question),
    require_analysis=True,
)
if issues:
    raise _error(422, issues[0]["code"], issues[0]["message"], questionId=question.id, order=order_index + 1)
```

Copy `paper_type` into `PaperRelease`, catalog serialization, and release responses.

- [ ] **Step 6: Run focused tests**

Run: `cd backend && .venv/bin/python -m pytest tests/test_paper_draft_api.py tests/test_paper_import_api.py tests/test_paper_composition_api.py tests/test_paper_releases.py -q`

Expected: PASS.

- [ ] **Step 7: Commit**

```bash
git add backend/app/schemas/paper.py backend/app/services/paper_service.py backend/app/services/paper_import_service.py backend/app/services/paper_composition_service.py backend/app/services/paper_release_service.py backend/tests/test_paper_draft_api.py backend/tests/test_paper_import_api.py backend/tests/test_paper_composition_api.py backend/tests/test_paper_releases.py
git commit -m "feat: enforce multiple-choice paper type"
```

### Task 4: Teacher editor, text import, JSON import, and paper management UI

**Files:**
- Create: `new-legacy/src/117-question-answer-set.js`
- Create: `new-legacy/tests/multiple-choice-answer-set.test.js`
- Modify: `new-legacy/question-bank.html`
- Modify: `new-legacy/paper-management.html`
- Modify: `new-legacy/src/65-question-bank-admin.js`
- Modify: `new-legacy/src/97-teacher-question-workflow.js`
- Modify: `new-legacy/src/98-teacher-workflow-p2-services.js`
- Modify: `new-legacy/styles/question-bank-admin.css`
- Modify: `new-legacy/styles/paper-management.css`
- Modify: `new-legacy/tests/question-import-persistence.test.js`
- Modify: `new-legacy/tests/v90-p35-paper-management.test.js`

**Interfaces:**
- Produces: `KGQuestionAnswerSet.normalize(question, values)` and `.grade(question, values)`
- Produces: multi-choice editor payloads with `correctOptionIds`
- Consumes: backend `paperType` and `correctOptionIds`

- [ ] **Step 1: Write the failing pure-JS helper test**

```javascript
test('normalizes and grades option-id sets in question order', () => {
  const question={options:[{id:'A'},{id:'B'},{id:'C'}],correctOptionIds:['A','C']}
  assert.deepEqual(plain(Core.normalize(question,['C','A'])),['A','C'])
  assert.equal(Core.grade(question,['C','A']).correct,true)
  assert.deepEqual(plain(Core.grade(question,['A','B']).missedCorrectIds),['C'])
})
```

- [ ] **Step 2: Run helper test and verify failure**

Run: `cd new-legacy && node --test tests/multiple-choice-answer-set.test.js`

Expected: FAIL because the module is absent.

- [ ] **Step 3: Implement the small shared browser helper**

Expose only `optionIds`, `correctIds`, `normalize`, and `grade` from `KGQuestionAnswerSet`. Keep it DOM-free and dependency-free. Load it before question-bank and practice scripts.

- [ ] **Step 4: Convert the question editor to type-aware correct controls**

Render `checkbox` for `multiple_choice` and `radio` otherwise:

```javascript
const multiple=q.type==='multiple_choice',correct=new Set(AnswerSet.correctIds(q));
const inputType=multiple?'checkbox':'radio';
```

Collect all checked values for multi, store `draft.correctOptionIds`, and keep `draft.correctAnswer` only for non-multi. Set `contentReady` from structural validity plus non-empty `analysis`.

- [ ] **Step 5: Extend text and JSON import**

Parse `【题型】多选题` and split `【答案】A,C` with `/[,，\s]+/`; accept joined `AC` only when all option IDs are single characters. Build imported questions with `type:'multiple_choice'`, `correctOptionIds`, correct flags derived for display, and `analysis` preserved.

- [ ] **Step 6: Add paper type controls and filtering**

Add a `paperTypeInput` select to the existing editor. Include `paperType` in create/update payloads, lock it when questions or releases exist, and filter candidate rows by the selected type before rendering. Keep backend rejection visible as the final guard.

- [ ] **Step 7: Run frontend focused tests**

Run:

```bash
cd new-legacy
node --test tests/multiple-choice-answer-set.test.js tests/question-import-persistence.test.js tests/v90-p35-paper-management.test.js
```

Expected: PASS.

- [ ] **Step 8: Commit**

```bash
git add new-legacy/src/117-question-answer-set.js new-legacy/tests/multiple-choice-answer-set.test.js new-legacy/question-bank.html new-legacy/paper-management.html new-legacy/src/65-question-bank-admin.js new-legacy/src/97-teacher-question-workflow.js new-legacy/src/98-teacher-workflow-p2-services.js new-legacy/styles/question-bank-admin.css new-legacy/styles/paper-management.css new-legacy/tests/question-import-persistence.test.js new-legacy/tests/v90-p35-paper-management.test.js
git commit -m "feat: add multiple-choice authoring and papers"
```

### Task 5: Resumable server-side multi-select practice

**Files:**
- Modify: `backend/app/services/practice_session_service.py`
- Modify: `backend/app/services/learning_service.py`
- Modify: `backend/tests/test_practice_sessions.py`
- Modify: `backend/tests/test_practice_learning_api.py`

**Interfaces:**
- Consumes: `grade_selection()` from Task 1
- Accepts: locked answers with `selectedOptionIds`
- Accepts: bounded `runtimeState.pendingSelections`
- Preserves: legacy `selectedAnswer` entries for single-choice sessions

- [ ] **Step 1: Add failing practice-session tests**

```python
def test_saved_multi_choice_requires_exact_set(client, student_headers, multi_session):
    response = save_session(client, student_headers, multi_session, answers={
        multi_session.question_id: {"selectedOptionIds": ["C", "A"], "selectionIndex": 1},
    })
    assert response.status_code == 200
    completed = complete_session(client, student_headers, response.json())
    assert completed["session"]["answers"][multi_session.question_id]["correct"] is True


def test_pending_multi_selection_never_counts_as_answered(client, student_headers, multi_session):
    saved = save_runtime(client, student_headers, multi_session, {
        "pendingSelections": {multi_session.question_id: ["A", "C"]},
    })
    assert saved["stats"]["answered"] == 0
```

- [ ] **Step 2: Run focused tests and verify failure**

Run: `cd backend && .venv/bin/python -m pytest tests/test_practice_sessions.py tests/test_practice_learning_api.py -q`

Expected: new multi-select payload tests FAIL.

- [ ] **Step 3: Extend draft validation and lock comparison**

For each session question, accept exactly one shape based on snapshot type. Multi-choice requires a list in `selectedOptionIds`; single-choice keeps `selectedAnswer`. Whitelist persisted fields and add `selectedOptionIds` to immutable-answer comparison.

- [ ] **Step 4: Validate and persist pending selections**

Allow `runtimeState.pendingSelections` only for session question IDs. Each value must be a unique subset of frozen option IDs with at most eight entries. Remove a pending entry when its locked answer is accepted.

- [ ] **Step 5: Grade with the shared helper at settlement**

Replace scalar comparison only for multi snapshots:

```python
graded = question_answer_service.grade_selection(
    snapshot,
    draft.get("selectedOptionIds") or [],
    timed_out=draft.get("timedOut") is True,
)
```

Continue existing scalar code for historical single-choice answers.

- [ ] **Step 6: Run focused tests**

Run: `cd backend && .venv/bin/python -m pytest tests/test_practice_sessions.py tests/test_practice_learning_api.py -q`

Expected: PASS.

- [ ] **Step 7: Commit**

```bash
git add backend/app/services/practice_session_service.py backend/app/services/learning_service.py backend/tests/test_practice_sessions.py backend/tests/test_practice_learning_api.py
git commit -m "feat: grade resumable multiple-choice sessions"
```

### Task 6: Multi-select practice UI across normal, challenge, and scholar modes

**Files:**
- Modify: `new-legacy/practice-mode.html`
- Modify: `new-legacy/src/100-practice-mode.js`
- Modify: `new-legacy/src/114-practice-draft-state.js`
- Modify: `new-legacy/src/112-practice-answer-sheet.js`
- Modify: `new-legacy/styles/practice-mode.css`
- Modify: `new-legacy/tests/practice-draft-state.test.js`
- Modify: `new-legacy/tests/v90-p40-practice-mode.test.js`
- Modify: `new-legacy/tests/practice-answer-sheet-browser.py`

**Interfaces:**
- Consumes: `KGQuestionAnswerSet` from Task 4
- Produces: pending selection methods `toggle(questionId, optionId)`, `pending(questionId)`, and `confirm(questionId)` on `KGPracticeDraftState`
- Produces: `selectedOptionIds` submission payloads

- [ ] **Step 1: Add failing draft-state tests**

```javascript
test('multi choice stays pending until confirm and then locks',()=>{
  const draft=Core.create({questions:[{questionId:'q1',question:{
    type:'multiple_choice',options:[{id:'A'},{id:'B'},{id:'C'}],correctOptionIds:['A','C']
  }}]})
  draft.toggle('q1','C');draft.toggle('q1','A')
  assert.deepEqual(plain(draft.pending('q1')),['A','C'])
  assert.equal(draft.stats().answered,0)
  assert.equal(draft.confirm('q1').answer.correct,true)
  assert.deepEqual(plain(draft.submission().q1.selectedOptionIds),['A','C'])
})
```

- [ ] **Step 2: Run focused UI tests and verify failure**

Run: `cd new-legacy && node --test tests/practice-draft-state.test.js tests/v90-p40-practice-mode.test.js`

Expected: new `toggle`, `pending`, and `confirm` assertions FAIL.

- [ ] **Step 3: Extend the pure draft state minimally**

Keep existing `select()` for single-choice. Add one `pending` map and the three multi methods. Include pending selections in `runtimeState` on save; remove them after confirmation. `submission()` emits only locked answers.

- [ ] **Step 4: Render type-aware options and confirm button**

For multi questions, option buttons toggle `aria-pressed` and `.is-selected`; they do not call the existing immediate `answer()` path. Add one confirm button below options, disabled when pending is empty. Confirmation calls the same post-answer feedback and mode-policy path used by single choice.

- [ ] **Step 5: Render exact-set feedback and answer-sheet state**

Use helper output to apply `.is-correct`, `.is-wrong`, and `.is-missed`. Add an answer-sheet `pending` state that is not included in answered totals. Before final submit, count pending questions with unanswered questions.

- [ ] **Step 6: Preserve mode behavior**

Normal practice shows `analysis` and relevant `trap` after confirmation. Challenge updates health and streak once. Scholar timeout confirms an empty timed-out multi answer. Navigation and save/restore preserve pending selections.

- [ ] **Step 7: Run focused tests**

Run:

```bash
cd new-legacy
node --test tests/practice-draft-state.test.js tests/v90-p40-practice-mode.test.js
python3 tests/practice-answer-sheet-browser.py
```

Expected: PASS.

- [ ] **Step 8: Commit**

```bash
git add new-legacy/practice-mode.html new-legacy/src/100-practice-mode.js new-legacy/src/114-practice-draft-state.js new-legacy/src/112-practice-answer-sheet.js new-legacy/styles/practice-mode.css new-legacy/tests/practice-draft-state.test.js new-legacy/tests/v90-p40-practice-mode.test.js new-legacy/tests/practice-answer-sheet-browser.py
git commit -m "feat: add multi-select practice interaction"
```

### Task 7: Revenge mistake sets, remediation, and verification

**Files:**
- Modify: `backend/app/services/learning_service.py`
- Modify: `backend/app/services/practice_session_service.py`
- Modify: `backend/tests/test_practice_sessions.py`
- Modify: `new-legacy/src/100-practice-mode.js`
- Modify: `new-legacy/styles/practice-mode.css`
- Modify: `new-legacy/tests/v90-p40-practice-mode.test.js`

**Interfaces:**
- Produces: mistake payload field `previousWrongOptionIds`
- Stores: latest wrong multi-choice set in `PracticeMistake.selected_answers`
- Requires: verification question type `multiple_choice` for a multi-choice mistake

- [ ] **Step 1: Add failing revenge tests**

```python
def test_multi_revenge_keeps_latest_wrong_set_and_multi_verification(client, student_headers, multi_session):
    completed = complete_wrong_multi_session(client, student_headers, multi_session, ["A", "B"])
    pool = client.get("/api/v1/learning/practice/revenge-pool", headers=student_headers).json()
    candidate = next(item for item in pool["candidates"] if item["questionId"] == multi_session.question_id)
    assert candidate["previousWrongOptionIds"] == ["A", "B"]
    assert candidate["questionSnapshot"]["type"] == "multiple_choice"
```

- [ ] **Step 2: Run revenge tests and verify failure**

Run: `cd backend && .venv/bin/python -m pytest tests/test_practice_sessions.py -q -k revenge`

Expected: new array assertion FAILS because the pool returns a scalar prior answer.

- [ ] **Step 3: Make revenge helpers type-aware**

Replace the single-option-only helpers with Task 1 array normalization for multi snapshots. Keep scalar compatibility for single mistakes. Return `previousWrongOptionIds`; retain `previousWrongAnswer` only when the set has one item.

- [ ] **Step 4: Constrain verification candidates**

When the source mistake snapshot is multi-choice, filter family verification candidates to `type == "multiple_choice"`. If none exists, reuse the original immutable snapshot after the existing delay; never substitute a single-choice question or mark mastery without a passing verification.

- [ ] **Step 5: Render multi revenge feedback**

Show “上次选择：A、C” from `previousWrongOptionIds`, retain the existing visibility toggle, and after confirmation render selected-correct, wrong-selected, and missed-correct styles. Append `analysis` and only the `trap` entries for wrong-selected options.

- [ ] **Step 6: Run backend and frontend revenge tests**

Run:

```bash
cd backend && .venv/bin/python -m pytest tests/test_practice_sessions.py tests/test_practice_learning_api.py -q -k 'revenge or mistake or verification'
cd ../new-legacy && node --test tests/v90-p40-practice-mode.test.js
```

Expected: PASS.

- [ ] **Step 7: Commit**

```bash
git add backend/app/services/learning_service.py backend/app/services/practice_session_service.py backend/tests/test_practice_sessions.py new-legacy/src/100-practice-mode.js new-legacy/styles/practice-mode.css new-legacy/tests/v90-p40-practice-mode.test.js
git commit -m "feat: support multiple-choice revenge flow"
```

### Task 8: Full verification, immutable release build, and branch completion

**Files:**
- Modify generated files only through: `frontend/scripts/manage-new-legacy.js`
- Verify: `frontend/public/new-legacy/`
- Verify: `frontend/new-legacy-releases/current.json`
- Verify: `frontend/new-legacy-releases/<new-version>/site/`

**Interfaces:**
- Consumes: Tasks 1–7
- Produces: tested source, synchronized generated assets, and a promoted local active release

- [ ] **Step 1: Run full backend tests**

Run: `cd backend && .venv/bin/python -m pytest tests/ -q`

Expected: PASS.

- [ ] **Step 2: Run source frontend tests and targeted browser checks**

Run:

```bash
cd new-legacy
node --test tests/multiple-choice-answer-set.test.js tests/question-import-persistence.test.js tests/v90-p35-paper-management.test.js tests/practice-draft-state.test.js tests/v90-p40-practice-mode.test.js
python3 tests/v90-p353-question-bank-workspace-browser.py
python3 tests/v90-p35-paper-management-browser.py
python3 tests/practice-answer-sheet-browser.py
```

Expected: PASS.

- [ ] **Step 3: Build and promote through the required release script**

Run from repository root:

```bash
node frontend/scripts/manage-new-legacy.js update new-legacy --skip-browser
```

Expected: sync, validation, build, and promote complete without file-count or critical-page failure.

- [ ] **Step 4: Run generated-contract tests**

Run:

```bash
cd frontend
pnpm test
pnpm test:design
```

Expected: PASS.

- [ ] **Step 5: Verify release parity**

Run from repository root:

```bash
version=$(node -p "require('./frontend/new-legacy-releases/current.json').version")
test -f "frontend/new-legacy-releases/$version/site/question-bank.html"
test -f "frontend/new-legacy-releases/$version/site/practice-mode.html"
grep -RInE "multiple_choice|correctOptionIds|selectedOptionIds" \
  --include='*.js' --include='*.html' \
  "frontend/new-legacy-releases/$version/site"
git diff --check
```

Expected: both pages exist, new contracts are present, and `git diff --check` is silent.

- [ ] **Step 6: Commit generated artifacts and verification evidence**

```bash
git add frontend/public/new-legacy frontend/new-legacy-releases frontend/new-legacy-sync-report.json frontend/new-legacy-manifest.json
git commit -m "build: publish multiple-choice paper release"
```

Use the exact generated paths reported by `git status` if the sync report path differs; do not hand-edit generated files.

- [ ] **Step 7: Complete the feature branch discipline**

After all checks pass, merge the feature into `main`, push with the mandated one-command proxy, verify the remote ref, delete the merged local/remote feature branch, and confirm both `main` and `uat` remain:

```bash
git switch main
git merge --no-ff codex/multiple-choice-paper
git -c http.proxy=http://127.0.0.1:7897 push origin main
git ls-remote --heads origin main
git branch -d codex/multiple-choice-paper
git -c http.proxy=http://127.0.0.1:7897 push origin --delete codex/multiple-choice-paper
git branch --list main uat
```

If the feature branch was never pushed, skip only the remote-delete command after confirming the remote branch is absent.
