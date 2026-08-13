# 多题归纳批量选题、全局个人归纳卡与错题集 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 为多题归纳画布增加批量选题拖入、数据库级全局学生归纳卡库，以及由服务端判题驱动的错题集入口与状态闭环。

**Architecture:** 后端新增 owner-scoped `PersonalSynthesisCard` 聚合和统一画布作答命令；前端新增两个薄 API 适配器，`KGMultiQuestionWorkspace` 继续负责画布布局与题卡交互，新的学习资产控制器负责顶部抽屉、个人卡列表和错题列表。画布只保存个人卡引用与显示快照，个人卡 API 是内容事实来源；错题继续复用 `PracticeMistake` 状态机。

**Tech Stack:** FastAPI、SQLAlchemy 2 async、PostgreSQL JSONB、Alembic、Pydantic v2、原生 HTML/CSS/JavaScript、Node test runner、Playwright、pytest。

## Global Constraints

- 不直接修改 `frontend/public/new-legacy/` 或 active release site；前端源只改 `new-legacy/` 与 `frontend/scripts/new-legacy-assets/`，产物由同步脚本生成。
- 业务数据只能写数据库；不得新增个人卡、错题或批量选择的 `localStorage`/`sessionStorage`/IndexedDB 持久化。
- 服务端根据正式题目答案判定正误，不能相信客户端 `correct` 字段。
- 所有个人卡和错题记录按 session 当前用户隔离；跨账号访问表现为 404，未登录为 401。
- 保持 `.qw-canvas-shell` 现有画布布局、缩放、连线、分组、智能整理和移动端只读边界。
- 新个人卡更新使用 `revision` 乐观并发；冲突为 409，不允许静默覆盖。
- 测试严格执行 RED → GREEN；每个功能先看到针对缺失行为的失败，再写生产代码。
- 发布版本号仅在全部验证完成并明确准备发布时递增；本实施计划本身不授权生产部署。

---

### Task 1: 个人归纳卡数据库聚合与迁移

**Files:**
- Create: `backend/alembic/versions/d5e8f1a2b3c4_add_personal_synthesis_cards.py`
- Create: `backend/app/services/personal_card_service.py`
- Create: `backend/app/schemas/personal_card.py`
- Create: `backend/tests/test_personal_cards_api.py`
- Modify: `backend/app/models/training.py`
- Modify: `backend/app/models/__init__.py`
- Modify: `backend/app/api/v1/learning.py`

**Interfaces:**
- Produces model `PersonalSynthesisCard` and service methods `list_cards`, `get_card`, `create_card`, `update_card`, `set_archived`.
- Produces API routes under `/api/v1/learning/personal-cards` returning camelCase card dictionaries.
- Later tasks consume `id`, `revision`, `archivedAt`, `sourceQuestionRefs`, `synthesisType`, `status`, `tags`, `title`, and `content`.

- [ ] **Step 1: Write failing owner-isolation and CRUD tests**

Add tests with this behavioral shape:

```python
created = client_a.post("/api/v1/learning/personal-cards", json={
    "title": "我的风险原则",
    "synthesisType": "principle",
    "content": "先判断风险归属，再选择应对。",
    "tags": ["风险", "风险", "  "],
    "status": "draft",
    "sourceQuestionRefs": [{"questionId": question_id, "releaseId": "release-1"}],
})
assert created.status_code == 200
card = created.json()["card"]
assert card["revision"] == 1
assert card["tags"] == ["风险"]
assert client_b.get(f"/api/v1/learning/personal-cards/{card['id']}").status_code == 404
```

Cover list/search, update revision 1→2, stale revision 409, archive default-hidden, archived filter, restore, invalid title/type/status, other-account 404, and unauthenticated 401.

- [ ] **Step 2: Run tests and verify RED**

Run: `cd backend && .venv/bin/python -m pytest tests/test_personal_cards_api.py -q`

Expected: FAIL because routes/model do not exist.

- [ ] **Step 3: Add ORM model and Alembic migration**

Implement the exact table from the design:

```python
class PersonalSynthesisCard(Base):
    __tablename__ = "personal_synthesis_cards"
    __table_args__ = (
        CheckConstraint("synthesis_type IN ('principle','routine','trap','note')", name="ck_personal_cards_type"),
        CheckConstraint("status IN ('draft','verified','mastered')", name="ck_personal_cards_status"),
        CheckConstraint("revision >= 1", name="ck_personal_cards_revision"),
    )
    id: Mapped[str] = mapped_column(String(64), primary_key=True)
    owner_id: Mapped[str] = mapped_column(String(64), ForeignKey("users.username", ondelete="CASCADE"), index=True)
    title: Mapped[str] = mapped_column(String(200), nullable=False)
    synthesis_type: Mapped[str] = mapped_column(String(32), nullable=False)
    content: Mapped[str] = mapped_column(Text, nullable=False, default="")
    tags: Mapped[list] = mapped_column(JSONB, nullable=False, default=list)
    status: Mapped[str] = mapped_column(String(32), nullable=False, default="draft")
    source_question_refs: Mapped[list] = mapped_column(JSONB, nullable=False, default=list)
    archived_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True, index=True)
    revision: Mapped[int] = mapped_column(Integer, nullable=False, default=1)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now(), nullable=False)
    updated_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now(), onupdate=func.now(), nullable=False)
```

Migration `down_revision` must be the current single head `c44e3d4f5a6b` and must create owner/update indexes and all constraints.

- [ ] **Step 4: Add Pydantic payloads and service implementation**

Use `extra="forbid"`, aliases and bounded arrays. Service signatures:

```python
async def list_cards(db, owner, *, archived: bool, query: str = "") -> list[dict]: ...
async def get_card(db, owner, card_id) -> PersonalSynthesisCard | None: ...
async def create_card(db, owner, data: PersonalCardCreate) -> PersonalSynthesisCard: ...
async def update_card(db, owner, card_id, data: PersonalCardUpdate) -> PersonalSynthesisCard | None: ...
async def set_archived(db, owner, card_id, archived: bool) -> PersonalSynthesisCard | None: ...
```

Normalize tags by trimming, removing blanks/duplicates while preserving order, maximum 24. Normalize source refs to stable string fields only. Update with mismatched revision raises a dedicated `PersonalCardConflict` mapped to HTTP 409.

- [ ] **Step 5: Add routes and run GREEN tests**

Run: `cd backend && .venv/bin/python -m pytest tests/test_personal_cards_api.py -q`

Expected: all tests PASS.

- [ ] **Step 6: Verify migration head and autogenerate drift**

Run:

```bash
cd backend
.venv/bin/python -m alembic heads
.venv/bin/python -m alembic upgrade head
.venv/bin/python -m alembic check
```

Expected: one head `d5e8f1a2b3c4`; upgrade succeeds; no new upgrade operations.

- [ ] **Step 7: Commit**

```bash
git add backend/alembic/versions/d5e8f1a2b3c4_add_personal_synthesis_cards.py backend/app/models/training.py backend/app/models/__init__.py backend/app/schemas/personal_card.py backend/app/services/personal_card_service.py backend/app/api/v1/learning.py backend/tests/test_personal_cards_api.py
git commit -m "feat: add global personal synthesis cards"
```

---

### Task 2: 服务端判题与错题自动进出

**Files:**
- Modify: `backend/app/services/learning_service.py`
- Modify: `backend/app/api/v1/learning.py`
- Modify: `backend/tests/test_practice_learning_api.py`

**Interfaces:**
- Produces `record_practice_answer(db, owner, data) -> dict`.
- Produces `POST /api/v1/learning/practice/answers` response `{correct: bool, mistake: dict | null}`.
- Later frontend adapter calls this route and refreshes overview.

- [ ] **Step 1: Write failing server-truth transition tests**

Add tests:

```python
wrong = client.post("/api/v1/learning/practice/answers", json={
    "questionId": question_id, "bankId": bank_id,
    "releaseId": "release-1", "selectedAnswer": "B",
    "correct": True,
})
assert wrong.json()["correct"] is False
assert wrong.json()["mistake"]["status"] == "pending"

right = client.post("/api/v1/learning/practice/answers", json={
    "questionId": question_id, "bankId": bank_id,
    "releaseId": "release-1", "selectedAnswer": "A",
})
assert right.json()["correct"] is True
assert right.json()["mistake"]["status"] == "mastered"

reactivated = client.post("/api/v1/learning/practice/answers", json={
    "questionId": question_id, "bankId": bank_id,
    "releaseId": "release-1", "selectedAnswer": "B",
})
assert reactivated.json()["mistake"]["status"] == "pending"
assert reactivated.json()["mistake"]["wrongCount"] == 2
```

Also test a correct first answer produces no mistake, wrong release 1 and release 2 remain separate, invalid selected option is 422, hidden question is 404, and unauthenticated is 401.

- [ ] **Step 2: Run focused test and verify RED**

Run: `cd backend && .venv/bin/python -m pytest tests/test_practice_learning_api.py -q -k 'answer or automatic'`

Expected: FAIL with 404 on the missing route.

- [ ] **Step 3: Implement canonical answer resolution and transitions**

Add helpers that resolve the correct answer from `Question.correct_answer`, falling back to the single option with `correct=True`. Validate that `selectedAnswer` is one of the published question's option IDs. For wrong results call the existing `record_practice_mistake`; for correct results load the owner/question/release mistake and mark it `mastered`, clear `next_review_at`, set `mastered_at`, preserve historical counters, append `PRACTICE_MISTAKE_MASTERED`, commit and refresh.

- [ ] **Step 4: Add route and verify GREEN**

Run: `cd backend && .venv/bin/python -m pytest tests/test_practice_learning_api.py -q`

Expected: all practice learning tests PASS.

- [ ] **Step 5: Commit**

```bash
git add backend/app/services/learning_service.py backend/app/api/v1/learning.py backend/tests/test_practice_learning_api.py
git commit -m "feat: drive mistake status from server-graded answers"
```

---

### Task 3: 个人卡和作答前端 API 适配器

**Files:**
- Create: `frontend/scripts/new-legacy-assets/personal-card-adapter.js`
- Modify: `frontend/scripts/new-legacy-assets/practice-learning-adapter.js`
- Create: `frontend/scripts/personal-card-learning-contract.test.mjs`
- Modify: `frontend/scripts/practice-learning-contract.test.mjs`
- Modify: `frontend/scripts/sync-new-legacy.js`
- Modify: `frontend/scripts/new-legacy-sync.test.mjs`
- Modify: `frontend/scripts/new-legacy-release.test.mjs`

**Interfaces:**
- Produces `window.KGPersonalSynthesisCardApi` methods `refresh`, `snapshot`, `list`, `get`, `create`, `update`, `archive`, `restore`.
- Adds `KGPracticeLearningApi.answer(input)`.
- Both emit change events and never persist business payloads in browser storage.

- [ ] **Step 1: Write failing contract tests**

Require:

```js
assert.match(personalAdapter, /\/api\/v1\/learning\/personal-cards/)
assert.match(personalAdapter, /async function create\(input\)/)
assert.match(personalAdapter, /async function update\(cardId, input\)/)
assert.doesNotMatch(personalAdapter, /localStorage|sessionStorage|indexedDB/)
assert.match(practiceAdapter, /async function answer\(input\)/)
assert.match(sync, /kg-personal-cards:generated/)
```

Sync fixture must prove `personal-card-adapter.js` and `practice-learning-adapter.js` load before `src/77-multi-question-workspace.js` on `question-workspace.html`.

- [ ] **Step 2: Run tests and verify RED**

Run: `node --test frontend/scripts/personal-card-learning-contract.test.mjs frontend/scripts/practice-learning-contract.test.mjs`

Expected: FAIL because the personal adapter and `answer` method do not exist.

- [ ] **Step 3: Implement adapters**

Use one request helper with `credentials:'include'`, JSON detail errors and `error.status`. `refresh()` populates active and archived snapshots separately only when requested; all mutation methods refresh and emit `kg-personal-synthesis-cards-change`. `answer()` posts to `/answers`, calls practice `refresh()`, and returns cloned server data.

- [ ] **Step 4: Inject scripts and verify GREEN**

Modify sync logic near the existing practice injection:

```js
if (page === 'question-workspace.html') {
  generated = generated.replace(
    workspaceTag,
    `<script defer src="./practice-learning-adapter.js"></script><!-- kg-practice-learning:generated -->\n` +
    `<script defer src="./personal-card-adapter.js"></script><!-- kg-personal-cards:generated -->\n${workspaceTag}`,
  )
}
```

Run contract tests and `node --test frontend/scripts/new-legacy-sync.test.mjs`.

- [ ] **Step 5: Commit**

```bash
git add frontend/scripts/new-legacy-assets/personal-card-adapter.js frontend/scripts/new-legacy-assets/practice-learning-adapter.js frontend/scripts/personal-card-learning-contract.test.mjs frontend/scripts/practice-learning-contract.test.mjs frontend/scripts/sync-new-legacy.js frontend/scripts/new-legacy-sync.test.mjs frontend/scripts/new-legacy-release.test.mjs
git commit -m "feat: add personal-card and graded-answer adapters"
```

---

### Task 4: 画布个人卡引用与内容水合

**Files:**
- Modify: `new-legacy/src/65-canvas-workspace-store.js`
- Modify: `new-legacy/src/77-multi-question-workspace.js`
- Create: `new-legacy/tests/multi-question-personal-card-reference.test.js`
- Modify: `new-legacy/tests/v862-p2216-multi-question-ui-browser.py`

**Interfaces:**
- Store preserves `personalCardId`, `personalCardRevision`, and `archived` on synthesis nodes.
- Workspace exports `insertPersonalCard(card)`, `hydratePersonalCards(cards)`, `activeWorkspaceId()`, and `activeWorkspace()` for the panel controller.
- Personal card mutation is API-first; a failed API request does not create a fake global card.

- [ ] **Step 1: Write failing store/reference tests**

Test normalize/add/update round-trip for:

```js
{
  nodeType:'synthesis-card', cardType:'user',
  personalCardId:'psc_1', personalCardRevision:2, archived:false,
  title:'全局原则', content:'最新正文'
}
```

Assert hydration changes title/content/tags/status/revision but preserves x/y/width/height/color/edges/groups. Assert archived records retain snapshot and set `archived:true`.

- [ ] **Step 2: Run and verify RED**

Run: `node new-legacy/tests/multi-question-personal-card-reference.test.js`

Expected: FAIL because normalize drops personal card fields and hydration methods do not exist.

- [ ] **Step 3: Preserve fields and implement hydration**

Extend synthesis-node normalization. Add a pure `personalCardNodePatch(card)` helper and one batched workspace update that only writes when revision/content/archived state changed. Do not update geometry or relationships.

- [ ] **Step 4: Make create/edit/copy API-first**

For user card creation, build API input from the modal, await `KGPersonalSynthesisCardApi.create`, then call `addSynthesisCard` with the server ID/revision. For editing linked user cards, await API update with revision, then hydrate every current-workspace node with that ID. Copying a system card must create a personal card before inserting its node.

Legacy unlinked user cards remain readable. On authenticated load, migrate sequentially through the API and persist returned references; on failure mark the card UI `尚未同步到我的归纳卡` and expose retry rather than removing content.

- [ ] **Step 5: Run focused JS and browser tests**

Run:

```bash
node new-legacy/tests/multi-question-personal-card-reference.test.js
python3 new-legacy/tests/v862-p2216-multi-question-ui-browser.py
```

Expected: PASS and no console errors.

- [ ] **Step 6: Commit**

```bash
git add new-legacy/src/65-canvas-workspace-store.js new-legacy/src/77-multi-question-workspace.js new-legacy/tests/multi-question-personal-card-reference.test.js new-legacy/tests/v862-p2216-multi-question-ui-browser.py
git commit -m "feat: link canvas synthesis nodes to personal cards"
```

---

### Task 5: 题目库复选与批量拖入

**Files:**
- Modify: `new-legacy/question-workspace.html`
- Modify: `new-legacy/styles/question-workspace.css`
- Modify: `new-legacy/src/77-multi-question-workspace.js`
- Create: `new-legacy/tests/multi-question-batch-selection.test.js`
- Create: `new-legacy/tests/multi-question-batch-selection-browser.py`

**Interfaces:**
- Workspace maintains transient `selectedQuestionKeys: Set<string>` only in memory.
- Produces helpers `selectedQuestionItems()`, `batchDragPayload(item)`, `batchQuestionPositions(count, anchor)`, and `addQuestionItems(items, anchor)`.
- Drag payload schema is `{kind:'question-batch', items:[{questionId,bankId,paperId,releaseId}]}`.

- [ ] **Step 1: Write failing unit and browser tests**

Unit tests assert stable selection keys, selected-item drag vs unselected-item drag, paper change clearing, ordering, duplicate skipping, and deterministic non-overlapping positions.

Browser test actions:

```python
checkboxes = page.locator('#qwQuestionList input[data-qw-question-select]')
checkboxes.nth(0).check(); checkboxes.nth(1).check(); checkboxes.nth(2).check()
assert page.locator('#qwQuestionSelectionMeta').inner_text() == '已选 3 题'
source = page.locator('#qwQuestionList [data-question-index]').nth(1)
source.drag_to(page.locator('#qwCanvasViewport'), target_position={"x": 700, "y": 400})
assert page.locator('.qw-question-card').count() == 3
```

Repeat drag and assert count remains 3 with a duplicate-skip message.

- [ ] **Step 2: Run and verify RED**

Run unit test and browser test; expected failures are missing checkbox/meta and only one drag payload item.

- [ ] **Step 3: Add semantic checkbox UI**

Each row gets a native checkbox before the number. Add drawer selection bar containing `#qwQuestionSelectionMeta` and `#qwQuestionSelectionClear`. Checkbox click must not trigger add/drag. Search/filter re-render keeps selected state for the same paper; paper/release change clears it.

- [ ] **Step 4: Add one-history-operation batch placement**

Resolve all payload items against the current published paper catalog. Filter current-workspace duplicates. Compute 3-column grid positions from the drop anchor using existing `findOpenCardPosition`; create without calling `renderCards` per item, then refresh once, select the new nodes, push one history entry, mark save once, and notify exact added/skipped counts.

- [ ] **Step 5: Run focused tests**

Run:

```bash
node new-legacy/tests/multi-question-batch-selection.test.js
python3 new-legacy/tests/multi-question-batch-selection-browser.py
```

Expected: all PASS, cards do not overlap, and selected count/clear behavior is visible.

- [ ] **Step 6: Commit**

```bash
git add new-legacy/question-workspace.html new-legacy/styles/question-workspace.css new-legacy/src/77-multi-question-workspace.js new-legacy/tests/multi-question-batch-selection.test.js new-legacy/tests/multi-question-batch-selection-browser.py
git commit -m "feat: batch drag selected questions into canvas"
```

---

### Task 6: 顶部“我的归纳卡”和“错题集”真实抽屉

**Files:**
- Create: `new-legacy/src/108-multi-question-learning-assets.js`
- Modify: `new-legacy/question-workspace.html`
- Modify: `new-legacy/styles/question-workspace.css`
- Create: `new-legacy/tests/multi-question-learning-assets.test.js`
- Create: `new-legacy/tests/multi-question-learning-assets-browser.py`
- Modify: `frontend/scripts/new-legacy-contract.json`
- Modify: `frontend/scripts/new-legacy-release.test.mjs`

**Interfaces:**
- Controller consumes `KGPersonalSynthesisCardApi`, `KGPracticeLearningApi`, and `KGMultiQuestionWorkspace.insertPersonalCard/addQuestionByReference`.
- Produces top-button counts, mutually exclusive drawers, filters, search, CRUD/retry bindings, focus restoration, and `Escape` close.

- [ ] **Step 1: Write failing control contract and browser tests**

Require top controls `#qwPersonalCardsBtn`, `#qwMistakesBtn`, count badges, two labeled drawers, active/archived and active/mastered filters, search input, empty states, retry controls, close buttons, edit/archive/restore/insert actions.

The browser test must click every new visible control and assert an observable result, not a generic toast.

- [ ] **Step 2: Run tests and verify RED**

Expected: missing controls and script.

- [ ] **Step 3: Add markup and scoped styles**

Place buttons between workspace tabs and language/account controls as in the approved screenshot. Reuse Focus/Vega tokens and existing control heights. Drawers overlay the right side without changing canvas geometry. Mobile/coarse mode is read-only and hides mutation buttons.

- [ ] **Step 4: Implement controller data/recovery flows**

On authenticated init call both `refresh()` APIs and hydrate canvas personal cards. Render specific loading/empty/error states. Search filters client snapshot already fetched from API; archive/restore/edit call API then re-render. Insert calls workspace methods and closes only after success. 409 shows “重新加载最新版本” and preserves unsaved editor values until the user chooses reload.

- [ ] **Step 5: Run focused tests**

Run:

```bash
node new-legacy/tests/multi-question-learning-assets.test.js
python3 new-legacy/tests/multi-question-learning-assets-browser.py
```

Expected: all controls function; focus/escape/retry paths PASS.

- [ ] **Step 6: Commit**

```bash
git add new-legacy/src/108-multi-question-learning-assets.js new-legacy/question-workspace.html new-legacy/styles/question-workspace.css new-legacy/tests/multi-question-learning-assets.test.js new-legacy/tests/multi-question-learning-assets-browser.py frontend/scripts/new-legacy-contract.json frontend/scripts/new-legacy-release.test.mjs
git commit -m "feat: add personal-card and mistake drawers"
```

---

### Task 7: 多题画布作答持久化与重试

**Files:**
- Modify: `new-legacy/src/77-multi-question-workspace.js`
- Modify: `new-legacy/styles/question-workspace.css`
- Create: `new-legacy/tests/multi-question-mistake-sync.test.js`
- Create: `new-legacy/tests/multi-question-mistake-sync-browser.py`

**Interfaces:**
- Option handling calls `KGPracticeLearningApi.answer` once per user action.
- Per node stores only transient pending/error/retry input in memory; database response controls mistake state and badge refresh.

- [ ] **Step 1: Write failing tests**

Test wrong answer calls the adapter without a `correct` field, right answer moves an existing mistake to mastered, retry resends identical stable IDs/answer, repeated click while pending makes one request, and network failure shows card-local retry with selection retained.

- [ ] **Step 2: Run and verify RED**

Expected: current synchronous local comparison never calls the adapter.

- [ ] **Step 3: Make answer handling async and server-backed**

Construct stable payload from node/question/paper. Disable only that card's option buttons during request. Apply correct/wrong flash from `result.correct`; retain current synthesis-practice local layout update after server success. On failure set a card-local error row with retry, do not announce saved, and re-enable options.

- [ ] **Step 4: Refresh mistake drawer counts**

The adapter already refreshes overview. Listen to `kg-practice-mistakes-change` in the asset controller so counts and current filter update without page reload.

- [ ] **Step 5: Run focused tests**

Run:

```bash
node new-legacy/tests/multi-question-mistake-sync.test.js
python3 new-legacy/tests/multi-question-mistake-sync-browser.py
```

Expected: wrong→active, right→mastered, wrong again→active; failure/retry PASS.

- [ ] **Step 6: Commit**

```bash
git add new-legacy/src/77-multi-question-workspace.js new-legacy/styles/question-workspace.css new-legacy/tests/multi-question-mistake-sync.test.js new-legacy/tests/multi-question-mistake-sync-browser.py
git commit -m "feat: sync canvas answers with mistake records"
```

---

### Task 8: 跨画布、跨账号 E2E 与全量验证

**Files:**
- Create: `frontend/e2e/multi_question_learning_assets.py`
- Modify: `frontend/scripts/validate-new-legacy-release.sh`
- Modify: `frontend/scripts/new-legacy-contract.json`
- Modify: `new-legacy/VERSION` only after focused/full validation is green and a release candidate is intentionally built.

**Interfaces:**
- End-to-end proof covers API, reload, two workspaces, two users, drag/drop, personal-card update propagation, archive/restore and mistake transitions.

- [ ] **Step 1: Write the E2E scenario and verify it fails before final integration**

Scenario creates two students and a published paper fixture, then:

1. Student A selects and drags 3 questions; verifies non-overlap and duplicate skip.
2. Creates a personal card in workspace A, reloads, creates workspace B and inserts the same card.
3. Edits card in B, reopens A and sees the new title/content.
4. Archives the card, sees existing node marked archived, restores it and inserts again without duplicate.
5. Answers wrong/right/wrong and verifies default/ mastered filters and counts each time.
6. Student B sees zero cards and zero mistakes and receives 404 for A's IDs.
7. Simulated 500/409 surfaces retry/reload and leaves UI usable.

- [ ] **Step 2: Run focused cross-workflow E2E**

Run: `python3 frontend/e2e/multi_question_learning_assets.py`

Expected: PASS with one concise success line and no console/network errors.

- [ ] **Step 3: Run backend full suite**

Run: `cd backend && .venv/bin/python -m pytest tests/ -q`

Expected: 0 failures.

- [ ] **Step 4: Run frontend contracts and sync tests**

Run:

```bash
pnpm --dir frontend test
node frontend/scripts/sync-new-legacy.js
git diff --check
```

Expected: 0 failures; generated public output contains both adapters and source changes.

- [ ] **Step 5: Run all feature browser tests and exploratory control pass**

Run the four new browser tests plus `frontend/e2e/ui_geometry_audit.py`. Manually or automatically click every new top/drawer/checkbox control at 1440×900, 1366×768 and 390×844; verify no new console error, 404, unbound control or canvas geometry regression.

- [ ] **Step 6: Integrate release validation**

Add the new contract and E2E commands to `validate-new-legacy-release.sh`. If preparing a release, increment `new-legacy/VERSION` to the next unused number, then run:

```bash
node frontend/scripts/manage-new-legacy.js inspect new-legacy
node frontend/scripts/manage-new-legacy.js update new-legacy
```

Before promotion compare effective file counts excluding `__pycache__` and `*.pyc`, and assert `admin-console.html`, `question-bank.html`, `question-workspace.html`, and `content-prep-studio/dist/content-prep.html` exist.

- [ ] **Step 7: Final requirement trace review and commit**

Re-read the design requirements and record exact pass counts. Commit generated source/release files only if a release candidate was intentionally built:

```bash
git add frontend/e2e/multi_question_learning_assets.py frontend/scripts/validate-new-legacy-release.sh frontend/scripts/new-legacy-contract.json frontend/public/new-legacy frontend/new-legacy-manifest.json frontend/new-legacy-sync-report.json new-legacy/VERSION
git commit -m "test: verify multi-question learning assets end to end"
```

## Plan Self-Review

- Spec coverage: all four screenshot requests map to Tasks 4–7; persistence/isolation/error/recovery map to Tasks 1–3 and 8.
- Placeholder scan: no TBD/TODO, “similar to”, or unspecified generic error-handling steps remain.
- Type consistency: `PersonalSynthesisCard` → camelCase API → `KGPersonalSynthesisCardApi` → `personalCardId/personalCardRevision` node fields is consistent across tasks.
- Scope: no unrelated page redesign or generic learning-asset refactor is included.
