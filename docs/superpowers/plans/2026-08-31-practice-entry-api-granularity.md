# 做题入口接口粒度优化 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 选卷阶段只读取挑战、学霸和全局复仇摘要，点击模式时通过一次原子进入请求恢复旧会话或创建所选题量的新会话，并且只读取该实际会话的题目快照。

**Architecture:** FastAPI 新增两个轻量摘要查询和一个原子 `enter` 命令；摘要查询不复用完整 `_session_payload()`，普通试卷会话先选择轻量题目 ID，再读取命中的快照。原生前端适配器负责摘要请求合并与缓存，做题大厅只消费摘要并在点击模式时调用一次 `enter`，现有作答、保存、暂停、完成和报告接口保持不变。

**Tech Stack:** Python 3.11、FastAPI、SQLAlchemy async、PostgreSQL、原生 JavaScript、Node.js contract tests、Playwright browser tests

## Global Constraints

- 不修改作答、判题、草稿保存、暂停、放弃、交卷和报告接口。
- 不修改挑战、学霸、复仇的计分、生命、计时、多选题或错题规则。
- 不新增数据库迁移，不清理或重写历史未完成会话。
- 选卷阶段禁止返回或读取题目快照、答案、解析和完整运行状态。
- 恢复旧会话时忽略新选择的 `count` 与 `order`，保留原题量和冻结题序。
- `new-legacy/` 是前端权威源；`frontend/public/new-legacy/` 只能通过同步脚本生成。
- 本轮只交付功能分支代码与验证结果；由用户在 UAT 验收后再决定是否合入 `main`。

---

### Task 1: 后端轻量进度摘要

**Files:**
- Modify: `backend/app/services/practice_session_service.py:370-660`
- Modify: `backend/app/services/learning_service.py`
- Modify: `backend/app/api/v1/learning.py:154-198`
- Test: `backend/tests/test_practice_sessions.py`

**Interfaces:**
- Consumes: `PracticeSession` 的 owner、paper、mode、status、题量、当前索引、revision 与保存时间字段；现有错题状态表。
- Produces: `paper_progress(db, owner, paper_id, release_id=None) -> dict` 与 `revenge_summary(db, owner) -> dict`；HTTP `GET /learning/practice/papers/{paper_id}/progress` 和 `GET /learning/practice/revenge/summary`。

- [ ] **Step 1: 写试卷摘要与复仇摘要失败测试**

```python
def test_practice_paper_progress_is_lightweight_and_paper_scoped(client):
    response = client.get(f"/api/v1/learning/practice/papers/{paper_id}/progress")
    assert response.status_code == 200
    body = response.json()
    assert body["paperId"] == paper_id
    assert set(body["modes"]) == {"challenge", "scholar"}
    serialized = json.dumps(body)
    for forbidden in ("questions", "questionOrder", "answers", "analysis", "reasoningSteps", "runtimeState"):
        assert forbidden not in serialized

def test_practice_revenge_summary_omits_mistake_snapshots(client):
    response = client.get("/api/v1/learning/practice/revenge/summary")
    assert response.status_code == 200
    body = response.json()
    assert set(body) == {"stats", "resumable"}
    serialized = json.dumps(body)
    for forbidden in ("mistakes", "revengeCandidates", "questionSnapshot", "questions"):
        assert forbidden not in serialized
```

- [ ] **Step 2: 运行定向测试并确认新路由不存在**

Run: `cd backend && .venv/bin/python -m pytest tests/test_practice_sessions.py -q -k 'paper_progress or revenge_summary'`

Expected: FAIL，两个请求返回 404。

- [ ] **Step 3: 实现只投影摘要列的服务与路由**

```python
def _session_summary(session: PracticeSession) -> dict:
    return {
        "sessionId": session.id,
        "status": session.status,
        "paperId": session.paper_id,
        "releaseId": session.release_id,
        "answered": session.answered_count,
        "total": session.question_count,
        "currentIndex": session.current_index,
        "revision": session.revision,
        "lastSavedAt": _iso(session.last_saved_at),
    }

async def paper_progress(db, owner: str, paper_id: str, release_id: str | None = None) -> dict:
    sessions = await _lightweight_unfinished_sessions(db, owner, paper_id, ("challenge", "scholar"))
    return {"paperId": paper_id, "modes": {mode: _latest_summary(sessions, mode) for mode in ("challenge", "scholar")}}
```

用 SQLAlchemy `load_only(...)` 或显式列投影排除 `question_order`、`answers`、`runtime_state`、`report_snapshot`；复仇统计仅返回数值和最新全局复仇会话摘要。API 路由继续使用现有 `get_current_user` 与 owner 边界。

- [ ] **Step 4: 运行摘要测试并确认通过**

Run: `cd backend && .venv/bin/python -m pytest tests/test_practice_sessions.py -q -k 'paper_progress or revenge_summary'`

Expected: PASS，且禁止字段断言全部通过。

- [ ] **Step 5: 提交轻量摘要接口**

```bash
git add backend/app/services/practice_session_service.py backend/app/services/learning_service.py backend/app/api/v1/learning.py backend/tests/test_practice_sessions.py
git commit -m "feat: add lean practice progress summaries"
```

### Task 2: 原子进入命令与按实际题量读取

**Files:**
- Modify: `backend/app/services/practice_session_service.py:183-660`
- Modify: `backend/app/api/v1/learning.py:171-198`
- Test: `backend/tests/test_practice_sessions.py`

**Interfaces:**
- Consumes: Task 1 的 `_session_summary(session)`；现有账号级 `_session_scope_lock(...)`、会话权限和发布试卷校验。
- Produces: `enter_session(db, owner, user, payload) -> {"resumed": bool, "session": dict, "questions": list}`；HTTP `POST /learning/practice/sessions/enter`。

- [ ] **Step 1: 写新建、恢复和查询粒度失败测试**

```python
def test_enter_creates_exact_selected_count(client):
    response = client.post("/api/v1/learning/practice/sessions/enter", json={
        "paperId": paper_id, "releaseId": release_id,
        "mode": "challenge", "count": 10, "order": "paper",
    })
    assert response.status_code == 200
    body = response.json()
    assert body["resumed"] is False
    assert body["session"]["total"] == 10
    assert len(body["questions"]) == 10

def test_enter_resumes_original_count_and_ignores_new_selection(client):
    first = client.post(ENTER_URL, json={**request_body, "count": 60}).json()
    second = client.post(ENTER_URL, json={**request_body, "count": 10, "order": "random"}).json()
    assert second["resumed"] is True
    assert second["session"]["sessionId"] == first["session"]["sessionId"]
    assert second["session"]["total"] == 60
    assert len(second["questions"]) == 60
```

增加一个服务级 spy 测试，记录发布题快照查询命中的 `question_id`，断言 180 题试卷创建 10 题会话时只读取 10 份 snapshot；重复并发进入断言只产生一个未完成会话。

- [ ] **Step 2: 运行进入测试并确认新路由不存在**

Run: `cd backend && .venv/bin/python -m pytest tests/test_practice_sessions.py -q -k 'enter_'`

Expected: FAIL，`/sessions/enter` 返回 404。

- [ ] **Step 3: 拆分会话创建并实现原子 enter**

```python
async def enter_session(db, owner: str, user, data: dict) -> dict:
    async with _session_scope_lock(owner, data.get("paperId"), data["mode"]):
        existing = await _latest_unfinished_session(db, owner, data.get("paperId"), data["mode"])
        resumed = existing is not None
        session = existing or await _create_session_locked(db, owner, user, data)
        questions = await _session_question_rows(db, session)
        return {"resumed": resumed, "session": _session_summary(session), "questions": questions}
```

保留 `/sessions/start` 的 409 兼容语义，但让它和 `enter` 共用 `_create_session_locked`，避免复制会话创建逻辑。锁内必须重新查未完成会话，确保双击和多标签页返回同一个 session。

- [ ] **Step 4: 将普通试卷题目读取改为 ID 先选、快照后取**

```python
headers = await _release_question_headers(db, release_id)
selected_ids = _select_question_ids(headers, count=count, order=order, seed=seed)
rows = await _release_question_rows_by_ids(db, release_id, selected_ids)
by_id = {row.question_id: row for row in rows}
selected_rows = [by_id[question_id] for question_id in selected_ids]
```

`_session_question_rows()` 同样只以 `session.question_order` 中的 ID 查询快照，并按冻结题序重组；复仇模式继续使用会话内已有冻结快照。响应只返回一个实际会话，不包含其他 active sessions。

- [ ] **Step 5: 运行进入与现有生命周期测试**

Run: `cd backend && .venv/bin/python -m pytest tests/test_practice_sessions.py -q`

Expected: PASS；现有 start、detail、answer、pause、abandon、complete、report 与 revenge 用例无回归。

- [ ] **Step 6: 提交原子进入与选中题读取**

```bash
git add backend/app/services/practice_session_service.py backend/app/api/v1/learning.py backend/tests/test_practice_sessions.py
git commit -m "feat: enter practice sessions on demand"
```

### Task 3: 前端适配器轻量 API 与请求合并

**Files:**
- Modify: `frontend/scripts/new-legacy-assets/practice-learning-adapter.js:1-180`
- Modify: `frontend/scripts/practice-learning-contract.test.mjs`

**Interfaces:**
- Consumes: Task 1 的两个 GET 路由与 Task 2 的 `POST /sessions/enter`。
- Produces: `getPaperProgress(paperId, releaseId?)`、`getRevengeSummary()`、`enterSession(input)`、`invalidateEntrySummaries(scope?)`；保留现有 adapter 方法供非大厅页面兼容。

- [ ] **Step 1: 写 adapter 契约失败测试**

```javascript
for (const method of ['getPaperProgress', 'getRevengeSummary', 'enterSession', 'invalidateEntrySummaries']) {
  assert.match(adapterSource, new RegExp(`\\b${method}\\b`));
}
assert.match(adapterSource, /practice\/papers\/.*\/progress/);
assert.match(adapterSource, /practice\/revenge\/summary/);
assert.match(adapterSource, /practice\/sessions\/enter/);
```

补充 vm/fetch 测试：同一个 `paperId` 的两个并发调用只触发一次 fetch；两个并发复仇摘要调用只触发一次 fetch；`enterSession` 不调用 active/detail/start。

- [ ] **Step 2: 运行 adapter 契约并确认失败**

Run: `cd frontend && node --test scripts/practice-learning-contract.test.mjs`

Expected: FAIL，缺少新方法和路由。

- [ ] **Step 3: 实现页面内摘要缓存、并发合并与 enter**

```javascript
const progressCache = new Map();
const progressInflight = new Map();
let revengeSummaryCache = null;
let revengeSummaryInflight = null;

function getPaperProgress(paperId, releaseId) {
  const key = `${paperId}:${releaseId || ''}`;
  if (progressCache.has(key)) return Promise.resolve(progressCache.get(key));
  if (progressInflight.has(key)) return progressInflight.get(key);
  const request = apiGet(progressUrl(paperId, releaseId))
    .then(value => (progressCache.set(key, value), value))
    .finally(() => progressInflight.delete(key));
  progressInflight.set(key, request);
  return request;
}
```

`practice-mode.html` 初始化不再自动请求完整 `/practice/overview`；其他依赖完整 overview 的多题归纳页面保持原行为。保存、暂停、放弃、完成以及登录态变化后调用统一失效函数，不复制缓存清理逻辑。

- [ ] **Step 4: 运行 adapter 契约并确认通过**

Run: `cd frontend && node --test scripts/practice-learning-contract.test.mjs`

Expected: PASS，并发请求计数均为 1。

- [ ] **Step 5: 提交适配器 API**

```bash
git add frontend/scripts/new-legacy-assets/practice-learning-adapter.js frontend/scripts/practice-learning-contract.test.mjs
git commit -m "feat: add lean practice entry adapter APIs"
```

### Task 4: 做题大厅改用摘要与单次进入

**Files:**
- Modify: `new-legacy/src/100-practice-mode.js:930-1135`
- Modify: `new-legacy/tests/v90-p40-practice-mode.test.js`
- Modify: `new-legacy/tests/practice-challenge-health-browser.py`
- Modify: `new-legacy/tests/practice-challenge-loading-browser.py`
- Modify: `new-legacy/tests/practice-answer-sheet-browser.py`
- Modify: `new-legacy/tests/multiple-choice-practice-browser.py`

**Interfaces:**
- Consumes: Task 3 的 `getPaperProgress()`、`getRevengeSummary()`、`enterSession()`。
- Produces: 选卷仅刷新当前试卷按钮摘要；模式点击只发送一个 enter；`restoreServerSession()` 继续接收现有完整 session 形状，不修改作答状态机。

- [ ] **Step 1: 更新静态契约与浏览器 mock，先证明旧调用仍存在**

```javascript
assert(script.includes('api.getPaperProgress('));
assert(script.includes('api.getRevengeSummary('));
assert(script.includes('api.enterSession('));
assert(!script.includes('api.getActiveSessions('));
assert(!script.includes('api.startSession(input)'));
```

浏览器 mock 记录 `getPaperProgress`、`getRevengeSummary`、`enterSession` 次数和参数；新增断言：大厅稳定后每个摘要各 1 次，点击挑战只 enter 1 次；历史 60 题时即使当前选 10 题，页面恢复 60 题且不弹放弃确认。

- [ ] **Step 2: 运行前端定向测试并确认失败**

Run: `cd frontend && node --test ../new-legacy/tests/v90-p40-practice-mode.test.js scripts/practice-learning-contract.test.mjs`

Expected: FAIL，做题大厅仍包含 `getActiveSessions/startSession` 入口链路。

- [ ] **Step 3: 把选卷同步替换为轻量摘要**

```javascript
async function syncResumableButtons() {
  if (!hasAuthenticatedUser()) return;
  const release = selectedRelease();
  const [paperProgress, revengeSummary] = await Promise.all([
    practiceApi().getPaperProgress(release.paperId, release.releaseId || release.id),
    practiceApi().getRevengeSummary(),
  ]);
  applyPaperProgress(paperProgress);
  applyRevengeSummary(revengeSummary);
}
```

用递增 request token 丢弃切卷后的过期响应；事件重复触发由 adapter 合并。挑战和学霸按钮只展示当前 `paperId` 的摘要，复仇按钮只展示账号级摘要。

- [ ] **Step 4: 把模式点击替换为单次 enter**

```javascript
const entered = await api.enterSession(input);
const session = {...entered.session, questions: entered.questions};
restoreServerSession(session, catalog);
```

删除入口阶段的 `getActiveSessions -> getSession -> startSession` 串行链路和题量不匹配确认框；恢复结果由服务端 `resumed` 判定。保留答题中主动刷新当前 session、报告和全部答案接口调用。

- [ ] **Step 5: 运行静态与浏览器定向测试**

Run: `cd frontend && node --test ../new-legacy/tests/v90-p40-practice-mode.test.js scripts/practice-learning-contract.test.mjs`

Run: `cd new-legacy && python -m pytest tests/practice-challenge-health-browser.py tests/practice-challenge-loading-browser.py tests/practice-answer-sheet-browser.py tests/multiple-choice-practice-browser.py -q`

Expected: PASS；请求次数、10 题新建、60 题恢复、挑战/学霸/复仇入口和现有答题操作均通过。

- [ ] **Step 6: 提交做题大厅切换**

```bash
git add new-legacy/src/100-practice-mode.js new-legacy/tests/v90-p40-practice-mode.test.js new-legacy/tests/practice-challenge-health-browser.py new-legacy/tests/practice-challenge-loading-browser.py new-legacy/tests/practice-answer-sheet-browser.py new-legacy/tests/multiple-choice-practice-browser.py
git commit -m "perf: load practice sessions only on entry"
```

### Task 5: 同步生成产物与完整回归

**Files:**
- Modify (generated): `frontend/public/new-legacy/`
- Modify (generated): `frontend/public/new-legacy-sync-report.json`
- Modify only if produced by repository tooling: release/manifest seed metadata under `frontend/`

**Interfaces:**
- Consumes: Tasks 1–4 的后端、adapter 和大厅实现。
- Produces: 与 `new-legacy/` 权威源一致的同步产物，以及可供 UAT 发布的已验证功能分支。

- [ ] **Step 1: 运行正式同步工具生成产物**

Run: `cd frontend && pnpm sync:new-legacy`

Expected: 命令成功；生成报告显示源与 `frontend/public/new-legacy/` 同步，无手工复制文件。

- [ ] **Step 2: 运行后端完整测试**

Run: `cd backend && .venv/bin/python -m pytest tests/ -q`

Expected: PASS。

- [ ] **Step 3: 运行前端完整契约测试**

Run: `cd frontend && pnpm test`

Expected: PASS。

- [ ] **Step 4: 检查生成产物和功能分支差异**

Run: `git status --short && git diff --stat uat...HEAD && git diff --check`

Expected: 仅包含本功能的规格、计划、后端、前端源、测试和同步生成物；`git diff --check` 无错误。

- [ ] **Step 5: 提交同步产物和最终验证调整**

```bash
git add frontend/public/new-legacy frontend/public/new-legacy-sync-report.json frontend/pnpm-lock.yaml
git add -u
git commit -m "chore: sync lean practice entry release assets"
```

- [ ] **Step 6: 记录验证边界**

确认本轮自动验证只证明契约和回归测试通过，不代替用户在 UAT 上验证真实交互；在用户明确要求部署 UAT 前，不合入 `uat`、不推送、不部署正式环境。
