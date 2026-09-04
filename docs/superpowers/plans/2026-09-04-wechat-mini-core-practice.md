# WeChat Mini Program Core Practice Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Deliver a complete mobile practice loop from paper selection through answering, pausing, resuming, submitting, and viewing results.

**Architecture:** Reuse the existing paper-release and practice-session APIs as the system of record. Add a Bearer-client projection at the API boundary so normal practice receives answer details only after submission and competitive modes never leak them before completion; keep all Cookie responses byte-compatible with the current web frontend.

**Tech Stack:** FastAPI, existing practice services, native WeChat WXML/WXSS/TypeScript, local draft storage, Node.js contract/unit tests, pytest.

## Global Constraints

- The backend remains authoritative for question order, scoring, session status, revisions, and completion.
- Preserve all existing browser Cookie response shapes and practice behavior.
- Do not copy practice business rules into page scripts; place shared client logic in `miniprogram/domain/` and API calls in `miniprogram/services/`.
- Support single choice, multiple choice, bilingual stems/options, and question images.
- Use 17–18px question text, approximately 16px options/analysis, options at least 61px high, and controls at least 48px high.
- Keep the question as the visual priority; answer sheet, progress, timing, and game state remain secondary.
- Save local drafts by session id and revision; never overwrite a newer server revision silently.

---

## File Structure

- `backend/app/services/practice_client_view_service.py`: transport- and mode-aware redaction.
- `backend/app/api/v1/learning.py`: applies the projection at existing route boundaries.
- `miniprogram/domain/`: deterministic question normalization, answer state, navigation, and draft reconciliation.
- `miniprogram/services/`: paper and practice API adapters.
- `miniprogram/components/`: reusable native question, option, save-state, and empty-state views.
- `miniprogram/pages/`: paper library, setup, practice, answer sheet, result, and history.

### Task 1: Prevent answer leakage for mini-program Bearer clients

**Files:**
- Create: `backend/app/services/practice_client_view_service.py`
- Modify: `backend/app/api/v1/learning.py`
- Test: `backend/tests/test_practice_mini_client_view.py`

**Interfaces:**
- Consumes: `request.state.auth_transport`, practice mode, route result dictionaries.
- Produces: `project_practice_payload(payload: Any, *, transport: str, mode: str | None, completed: bool) -> Any`.
- Rule: Cookie returns the original payload object; Bearer recursively removes `correctAnswer`, `correctOptionIds`, option-level `correct`, and analysis fields until the allowed reveal point.

- [x] **Step 1: Write failing projection tests**

```python
def test_bearer_challenge_payload_has_no_answer_markers():
    source = {"correctAnswer": "A", "options": [{"id": "A", "correct": True}], "analysis": "why"}
    result = project_practice_payload(source, transport="bearer", mode="challenge", completed=False)
    assert result == {"options": [{"id": "A"}]}

def test_cookie_payload_is_unchanged():
    source = {"correctAnswer": "A"}
    assert project_practice_payload(source, transport="cookie", mode="normal", completed=False) is source
```

- [x] **Step 2: Run to verify failure**

Run: `cd backend && .venv/bin/python -m pytest tests/test_practice_mini_client_view.py -q`
Expected: FAIL because the projection module is absent.

- [x] **Step 3: Implement recursive projection and apply it to session routes**

```python
HIDDEN_KEYS = {"correctAnswer", "correct_answer", "correctOptionIds", "correct_answer_ids", "analysis", "explanation"}

def _strip(value):
    if isinstance(value, list):
        return [_strip(item) for item in value]
    if isinstance(value, dict):
        return {key: _strip(item) for key, item in value.items() if key not in HIDDEN_KEYS and key != "correct"}
    return value
```

Normal mode permits answer/analysis only in the answer-submission response for that question or after completion. Challenge and scholar modes permit them only after session completion. Apply the projection to start, enter, active, answer, complete, report, and detail responses when the authenticated transport is Bearer.

- [x] **Step 4: Run focused and browser regression tests**

Run: `cd backend && .venv/bin/python -m pytest tests/test_practice_mini_client_view.py tests/test_practice_sessions.py tests/test_practice_learning_api.py -q`
Expected: PASS, including explicit Cookie response assertions.

- [x] **Step 5: Commit**

```bash
git add backend/app/services/practice_client_view_service.py backend/app/api/v1/learning.py backend/tests/test_practice_mini_client_view.py
git commit -m "fix: protect practice answers for mini clients"
```

### Task 2: Implement typed API adapters and deterministic practice state

**Files:**
- Create: `miniprogram/types/api.ts`
- Create: `miniprogram/services/papers.ts`
- Create: `miniprogram/services/practice.ts`
- Create: `miniprogram/domain/question.ts`
- Create: `miniprogram/domain/rich-text.ts`
- Create: `miniprogram/domain/practice-state.ts`
- Create: `miniprogram/domain/draft-store.ts`
- Test: `miniprogram/tests/practice-domain.test.mjs`

**Interfaces:**
- Produces: `listPublishedPapers()`, `startSession(input)`, `enterSession(id)`, `submitAnswer(id, input)`, `saveState(id, input)`, `pauseSession(id, input)`, `completeSession(id, input)`, `getReport(id)`.
- Produces: `toggleAnswer(state, optionId)`, `moveQuestion(state, direction)`, `sanitizeRichText(nodes)`, `mergeDraft(server, local) -> {state, conflict}`.

- [x] **Step 1: Write failing domain tests**

```javascript
test('multiple choice toggles without duplicates', () => {
  assert.deepEqual(toggleAnswer(['A'], 'B', true), ['A', 'B']);
  assert.deepEqual(toggleAnswer(['A', 'B'], 'A', true), ['B']);
});

test('newer server revision wins and reports conflict', () => {
  const result = mergeDraft({ revision: 5, answers: {} }, { revision: 4, answers: { q1: ['A'] } });
  assert.equal(result.conflict, true);
  assert.equal(result.state.revision, 5);
});

test('rich text removes event handlers and unsupported nodes', () => {
  assert.deepEqual(sanitizeRichText([{ name: 'script' }, { name: 'p', attrs: { onclick: 'bad' }, children: [{ type: 'text', text: '题干' }] }]), [
    { name: 'p', attrs: {}, children: [{ type: 'text', text: '题干' }] },
  ]);
});
```

- [x] **Step 2: Run to verify failure**

Run: `node --test miniprogram/tests/practice-domain.test.mjs`
Expected: FAIL because the domain modules are absent.

- [x] **Step 3: Implement API mappings and pure state functions**

```typescript
export interface PracticeDraft {
  sessionId: string;
  revision: number;
  currentIndex: number;
  answers: Record<string, string[]>;
  savedAt: number;
}

export function mergeDraft(server: PracticeDraft, local?: PracticeDraft) {
  if (!local) return { state: server, conflict: false };
  if (server.revision >= local.revision) return { state: server, conflict: server.revision > local.revision };
  return { state: local, conflict: false };
}
```

Normalize API snake/camel variants only once in adapters. Allow only `p`, `br`, `strong`, `em`, `span`, `ul`, `ol`, `li`, and HTTPS `img` rich-text nodes, removing event attributes. Use `wx.setStorageSync('practice-draft:' + username + ':' + sessionId, draft)` and delete the local draft only after the server confirms completion or abandonment.

- [x] **Step 4: Run domain contracts**

Run: `node --test miniprogram/tests/practice-domain.test.mjs miniprogram/tests/foundation-contract.test.mjs`
Expected: PASS.

- [x] **Step 5: Commit**

```bash
git add miniprogram/types miniprogram/services miniprogram/domain miniprogram/tests/practice-domain.test.mjs
git commit -m "feat: add mini practice client domain"
```

### Task 3: Build paper library and session setup

**Files:**
- Create: `miniprogram/components/paper-list-item/index.{json,wxml,wxss,ts}`
- Create: `miniprogram/components/empty-state/index.{json,wxml,wxss,ts}`
- Create: `miniprogram/pages/papers/index.{json,wxml,wxss,ts}`
- Create: `miniprogram/pages/practice-setup/index.{json,wxml,wxss,ts}`
- Modify: `miniprogram/app.json`
- Modify: `miniprogram/pages/home/index.{wxml,wxss,ts}`
- Test: `miniprogram/tests/catalog-pages-contract.test.mjs`

**Interfaces:**
- Consumes: `listPublishedPapers()`, `startSession({paperReleaseId, mode})`.
- Produces: navigation query `pages/practice/index?sessionId=<encoded id>`.

- [x] **Step 1: Write the failing page contract**

```javascript
test('catalog and setup expose mobile-native empty/loading/error states', () => {
  assert.match(read('pages/papers/index.wxml'), /wx:if=.*loading/);
  assert.match(read('pages/papers/index.wxml'), /empty-state/);
  assert.match(read('pages/practice-setup/index.wxml'), /普通练习/);
});
```

- [x] **Step 2: Run to verify failure**

Run: `node --test miniprogram/tests/catalog-pages-contract.test.mjs`
Expected: FAIL because pages are absent.

- [x] **Step 3: Implement catalogue, filters, and setup**

On authenticated home load, request the paper catalog, practice overview, experience summary, revenge summary, and active sessions in parallel, while rendering each section independently if one request fails. Create a one-column mobile list with subject chips, free/member access state, paper title, question count, estimated duration, progress, and resume/new action. Setup presents question count, sequential/random order, and the available modes as compact rows, defaults to normal practice, handles `RESUMABLE_SESSION_EXISTS` with explicit continue/abandon choices, and blocks double submission while creating a session.

```typescript
async start() {
  if (this.data.starting) return;
  this.setData({ starting: true, error: '' });
  try {
    const session = await startSession({ paperReleaseId: this.data.releaseId, mode: this.data.mode });
    await wx.redirectTo({ url: `/pages/practice/index?sessionId=${encodeURIComponent(session.id)}` });
  } catch (error) { this.setData({ error: messageOf(error), starting: false }); }
}
```

- [x] **Step 4: Run page contracts**

Run: `node --test miniprogram/tests/catalog-pages-contract.test.mjs`
Expected: PASS.

- [x] **Step 5: Commit**

```bash
git add miniprogram/app.json miniprogram/components miniprogram/pages/home miniprogram/pages/papers miniprogram/pages/practice-setup miniprogram/tests/catalog-pages-contract.test.mjs
git commit -m "feat: add paper discovery and practice setup"
```

### Task 4: Build the answer screen and answer sheet

**Files:**
- Create: `miniprogram/components/question-view/index.{json,wxml,wxss,ts}`
- Create: `miniprogram/components/answer-sheet/index.{json,wxml,wxss,ts}`
- Create: `miniprogram/components/save-status/index.{json,wxml,wxss,ts}`
- Create: `miniprogram/pages/practice/index.{json,wxml,wxss,ts}`
- Modify: `miniprogram/app.json`
- Test: `miniprogram/tests/practice-page-contract.test.mjs`

**Interfaces:**
- Consumes: Task 2 domain/API functions.
- Emits from `question-view`: `change` with `{questionId, selectedOptionIds}`.
- Emits from `answer-sheet`: `select` with `{index}` and `close`.

- [x] **Step 1: Write failing answer-screen contracts**

```javascript
test('question screen is native, accessible, and has no answer leakage', () => {
  const wxml = read('pages/practice/index.wxml');
  assert.match(wxml, /question-view/);
  assert.match(wxml, /answer-sheet/);
  assert.match(read('components/question-view/index.wxml'), /aria-label/);
  assert.doesNotMatch(wxml, /correctAnswer|correctOptionIds/);
});
```

- [x] **Step 2: Run to verify failure**

Run: `node --test miniprogram/tests/practice-page-contract.test.mjs`
Expected: FAIL because practice components are absent.

- [x] **Step 3: Implement mobile answering and resilient saving**

Render one question per screen with a compact top progress bar, bilingual blocks without side-by-side columns, image preview via `wx.previewImage`, option buttons at least 61px high, bookmark, previous/next, and a bottom safe-area action bar. Debounce state persistence by 400ms, show `正在保存/已保存/离线草稿`, and on revision conflict reload server state before offering “使用服务器进度” or “保留本机草稿并重试”.

```typescript
async persistDraft() {
  const draft = buildDraft(this.data);
  saveLocalDraft(draft);
  const saved = await saveState(draft.sessionId, { revision: draft.revision, ...draft });
  this.setData({ revision: saved.revision, saveState: 'saved' });
}
```

- [x] **Step 4: Run contracts; retain 390×844 Developer Tools inspection in the release gate**

Run: `node --test miniprogram/tests/practice-page-contract.test.mjs miniprogram/tests/practice-domain.test.mjs`
Expected: PASS. Automated size and source checks pass; the unavailable WeChat Developer Tools inspection remains in Advanced Delivery Task 5 and is not claimed as completed.

- [x] **Step 5: Commit**

```bash
git add miniprogram/app.json miniprogram/components miniprogram/pages/practice miniprogram/tests/practice-page-contract.test.mjs
git commit -m "feat: build native mobile answer flow"
```

### Task 5: Complete, report, and history loop

**Files:**
- Create: `miniprogram/pages/result/index.{json,wxml,wxss,ts}`
- Create: `miniprogram/pages/history/index.{json,wxml,wxss,ts}`
- Modify: `miniprogram/app.json`
- Modify: `miniprogram/pages/practice/index.ts`
- Modify: `miniprogram/pages/home/index.{wxml,ts}`
- Test: `miniprogram/tests/result-history-contract.test.mjs`

**Interfaces:**
- Consumes: `completeSession`, `getReport`, existing session list/overview endpoints.
- Produces: result sections `summary`, `wrongQuestions`, `weakConcepts`, and retry/review navigation.

- [ ] **Step 1: Write failing completion contracts**

```javascript
test('result includes actionable learning feedback', () => {
  const page = read('pages/result/index.wxml');
  for (const label of ['正确率', '错题', '薄弱知识点', '再练一次']) assert.match(page, new RegExp(label));
});
```

- [ ] **Step 2: Run to verify failure**

Run: `node --test miniprogram/tests/result-history-contract.test.mjs`
Expected: FAIL because result/history pages are absent.

- [ ] **Step 3: Implement submission confirmation, result, and history**

Before completion show answered/unanswered counts; after confirmation call the existing complete endpoint once with revision and idempotency key. Result uses plain typographic hierarchy instead of dashboard cards, supports reviewing each question, and links wrong questions into the revenge flow. History groups attempts by date and resumes active sessions.

- [ ] **Step 4: Run core frontend and backend gates**

Run: `node --test miniprogram/tests/*.test.mjs`
Expected: PASS.

Run: `cd backend && .venv/bin/python -m pytest tests/test_practice_mini_client_view.py tests/test_practice_sessions.py tests/test_practice_learning_api.py tests/test_paper_releases.py -q`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add miniprogram/app.json miniprogram/pages/home miniprogram/pages/practice miniprogram/pages/result miniprogram/pages/history miniprogram/tests/result-history-contract.test.mjs
git commit -m "feat: complete mini program practice loop"
```
