# Bank Record Cleanup and Synthesis Fallback Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let teachers clear learning records only for the selected test bank and make multi-question synthesis fall back to a blank personal card when no usable preset exists.

**Architecture:** A bank-scoped FastAPI operation derives its question IDs from `Question.bank_id`, then deletes matching `TrainingProgress`, `RecallProgress`, and `LearningEvent` rows in one transaction. The teacher UI calls that operation after confirmation and permits deletion only for that selected bank. Bank deletion repairs mutable relational/runtime references while preserving published historical snapshots. Canvas synthesis keeps the current correct-option principle resolver, generating a read-only preset card for an active match and a source-linked editable blank card for all fallback cases.

**Tech Stack:** FastAPI, SQLAlchemy async/PostgreSQL, vanilla JavaScript, Node test runner.

## Global Constraints

- The endpoint requires `accessQuestionBank` and `manageQuestionBank`; it must enforce access to the requested bank.
- The cleanup selector is only `Question.bank_id`; records for every other bank remain untouched.
- Published historical snapshots are not deleted by the cleanup action.
- A matching active preset produces a system card; missing, mismatched, or inactive bindings produce `未命名原则卡`.
- Do not edit `legacy/`.

---

### Task 1: Bank-scoped test-record cleanup API

**Files:**

- Modify: `backend/app/services/question_service.py`
- Modify: `backend/app/api/v1/questions.py`
- Test: `backend/tests/test_question_catalog.py`

**Interfaces:**

- Produces `clear_bank_test_learning_records(db, owner, bank_id) -> dict[str, int]`.
- Produces `POST /api/v1/banks/{bank_id}/test-learning-records/clear` returning `{cleared, questionCount}`.

- [x] **Step 1: Write a failing isolation test**

```python
response = teacher.post(f"/api/v1/banks/{bank_a.id}/test-learning-records/clear")
assert response.status_code == 200
assert response.json()["cleared"] == {
    "trainingProgress": 1,
    "recallProgress": 1,
    "learningEvents": 1,
}
assert dependent_count(bank_b_question.id) == 3
```

- [x] **Step 2: Run it and observe the missing-route failure**

Run: `backend/.venv/bin/python -m pytest tests/test_question_catalog.py -q -k test_bank_scoped_test_record_cleanup`

- [x] **Step 3: Implement the access-checked transaction**

```python
question_ids = select(Question.id).where(Question.bank_id == bank.id)
training = await db.execute(delete(TrainingProgress).where(TrainingProgress.question_id.in_(question_ids)))
recall = await db.execute(delete(RecallProgress).where(RecallProgress.question_id.in_(question_ids)))
events = await db.execute(delete(LearningEvent).where(LearningEvent.question_id.in_(question_ids)))
```

- [x] **Step 4: Run the focused test**

Run: `backend/.venv/bin/python -m pytest tests/test_question_catalog.py -q -k test_bank_scoped_test_record_cleanup`

Commit: `git commit -m "feat: clear test records by question bank"`

### Task 2: Guarded teacher-bank cleanup action

**Files:**

- Modify: `new-legacy/question-bank.html`
- Modify: `new-legacy/src/65-question-bank-admin.js`
- Test: `new-legacy/tests/question-bank-test-record-cleanup.test.js`

**Interfaces:**

- Consumes `POST /api/v1/banks/{bankId}/test-learning-records/clear`.
- Produces the visible `#qbClearBankTestRecordsBtn` action.

- [x] **Step 1: Write a failing DOM/controller test**

```js
assert.match(html, /id="qbClearBankTestRecordsBtn"/)
assert.match(controller, /test-learning-records\/clear/)
assert.match(controller, /清除测试答题记录/)
```

- [x] **Step 2: Run it and observe the missing-control failure**

Run: `node --test new-legacy/tests/question-bank-test-record-cleanup.test.js`

- [x] **Step 3: Add confirmation, API request, count feedback, and handler binding**

```js
const response = await fetch(`/api/v1/banks/${encodeURIComponent(bank.id)}/test-learning-records/clear`, {
  method: 'POST', credentials: 'include'
});
```

- [x] **Step 4: Run the focused test**

Run: `node --test new-legacy/tests/question-bank-test-record-cleanup.test.js`

Commit: `git commit -m "feat: clear selected bank test records"`

### Task 3: Blank-card fallback for selection synthesis

**Files:**

- Modify: `new-legacy/src/77-multi-question-workspace.js`
- Test: `new-legacy/tests/multi-question-synthesis-fallback.test.js`

**Interfaces:**

- Consumes `PrincipleBinding.selectionPrinciple(questions)` and `Presets.getByPrincipleId(principleId, {activeOnly:true})`.
- Produces `synthesisDraftFromSelection(records)` with `cardType: 'system'` or `cardType: 'user'`.

- [x] **Step 1: Write failing tests for both output kinds**

```js
assert.equal(withActivePreset.cardType, 'system')
assert.equal(withoutPreset.cardType, 'user')
assert.equal(withoutPreset.title, '未命名原则卡')
assert.equal(withoutPreset.content, '')
```

- [x] **Step 2: Run and observe the current invalid fallback**

Run: `node --test new-legacy/tests/multi-question-synthesis-fallback.test.js`

- [x] **Step 3: Return a source-linked editable draft when no active preset can be selected**

```js
return {valid:true, synthesisType:'principle', cardType:'user', title:'未命名原则卡', content:'', sourceNodeIds:questions.map(record => String(record.id)), autoGenerated:false};
```

- [x] **Step 4: Run focused tests**

Run: `node --test new-legacy/tests/multi-question-synthesis-fallback.test.js new-legacy/tests/multi-question-correct-flash.test.js`

Commit: `git commit -m "fix: fall back to blank synthesis cards"`

### Task 4: Cross-feature verification

**Files:**

- Test: `backend/tests/test_question_catalog.py`
- Test: `new-legacy/tests/question-bank-test-record-cleanup.test.js`
- Test: `new-legacy/tests/multi-question-synthesis-fallback.test.js`

- [x] **Step 1: Run focused backend and frontend suites**

Run: `backend/.venv/bin/python -m pytest tests/test_question_catalog.py -q && node --test new-legacy/tests/question-bank-test-record-cleanup.test.js new-legacy/tests/multi-question-synthesis-fallback.test.js new-legacy/tests/multi-question-correct-flash.test.js`

- [x] **Step 2: Check syntax and whitespace**

Run: `node --check new-legacy/src/65-question-bank-admin.js && node --check new-legacy/src/77-multi-question-workspace.js && git diff --check`
