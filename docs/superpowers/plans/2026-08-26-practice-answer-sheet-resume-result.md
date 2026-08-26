# 做题模式答题卡、断点续做与模拟成绩报告实施计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 为挑战、学霸、复仇三种做题模式提供服务端持久化会话、自由跳题答题卡、保存恢复、只读答案回看和幻谱 PMP 风格模拟成绩报告。

**Architecture:** PostgreSQL 中新增 `practice_sessions` 作为可恢复进度和冻结报告的唯一业务事实源；`practice_session_service` 负责会话生命周期、乐观并发、领域配额和报告生成，现有公共判题入口通过无提交内部路径与会话答案保持同一事务。前端把 API 适配、会话状态、答题卡和报告渲染拆为独立模块，`100-practice-mode.js` 只编排挑战、学霸、复仇规则与页面切换。

**Tech Stack:** FastAPI、SQLAlchemy async、PostgreSQL JSONB、Alembic、原生 HTML/CSS/JavaScript、Node `node:test`、pytest、Playwright。

## Global Constraints

- 当前领域默认配比固定为人员 42%、过程 50%、商业环境 8%；33% / 41% / 26% 不进入本轮实现。
- PASS/FAIL 必须标注为“模拟考试结果”，不得声称是 PMI 官方及格线或认证成绩。
- 已提交答案不可修改，只允许回看本人答案、正确答案和解析。
- 练习会话、答案、成绩和报告不得使用 `localStorage`、`sessionStorage` 或 IndexedDB 持久化。
- `new-legacy/` 是前端权威源；不得手工修改 `frontend/public/new-legacy/` 或 active release。
- 所有服务端写入按登录账号隔离；客户端提交的 owner、correct、score、PASS/FAIL 和领域等级一律不可信。
- SQLAlchemy async 写操作在 `commit` 后访问 ORM 属性前必须 `await db.refresh(obj)`。
- 每项生产行为先写失败测试并确认按预期失败，再写最小实现。
- 正式发布只能运行 `node frontend/scripts/manage-new-legacy.js update new-legacy --skip-browser`，并核对候选与 active release 文件数量和关键页面。

---

## 文件职责映射

- `backend/app/models/training.py`：新增 `PracticeSession` ORM；不把生命周期塞回 `LearningEvent`。
- `backend/alembic/versions/f7a2c4e6b810_practice_sessions.py`：创建会话表、状态约束、owner/release 外键和单一可恢复会话部分唯一索引。
- `backend/app/services/practice_session_service.py`：领域选题、会话序列化、并发写入、暂停/放弃/完成和报告快照。
- `backend/app/services/learning_service.py`：把现有判题事务拆出可复用的无提交路径，保留旧 API 行为。
- `backend/app/api/v1/learning.py`：注册会话生命周期和报告路由，仅做参数/异常映射。
- `backend/tests/test_practice_sessions.py`：模型、owner 隔离、并发、幂等、恢复、报告和旧接口兼容的 API 测试。
- `frontend/scripts/new-legacy-assets/practice-learning-adapter.js`：浏览器与会话 API 的唯一远程网关。
- `frontend/scripts/practice-learning-contract.test.mjs`：适配器、数据库事实源和同步注入契约。
- `new-legacy/src/111-practice-session-core.js`：纯状态归一、题号状态、统计和可恢复运行状态，不操作 DOM。
- `new-legacy/src/112-practice-answer-sheet.js`：桌面侧栏/移动抽屉的共享答题卡组件。
- `new-legacy/src/113-practice-result-report.js`：冻结报告的 PMP 风格视图和 SVG 领域饼图。
- `new-legacy/src/100-practice-mode.js`：三模式编排、API 调用、计时暂停和失败恢复。
- `new-legacy/practice-mode.html`：答题卡、提交确认、保存退出和成绩报告语义结构。
- `new-legacy/styles/practice-mode.css`：桌面/窄屏布局、题号状态、报告和打印样式。
- `new-legacy/tests/practice-session-core.test.js`：纯状态模块单元测试。
- `new-legacy/tests/practice-answer-sheet-browser.py`：答题卡、跳题、锁定、保存恢复与失败恢复。
- `new-legacy/tests/practice-result-report-browser.py`：Logo、模拟声明、领域饼图和错题复盘入口。
- `frontend/e2e/practice_resumable_report.py`：同源真实 API 下的跨刷新、跨登录、跨账号完整流程。

### Task 1: 新增可恢复练习会话模型与迁移

**Files:**
- Modify: `backend/app/models/training.py`
- Modify: `backend/app/models/__init__.py`
- Create: `backend/alembic/versions/f7a2c4e6b810_practice_sessions.py`
- Create: `backend/tests/test_practice_sessions.py`

**Interfaces:**
- Produces: `PracticeSession` ORM，字段 `id/owner_id/paper_id/release_id/mode/status/question_order/answers/runtime_state/stats/scoring_snapshot/report_snapshot/revision/*_at`。
- Produces: 部分唯一索引 `uq_practice_sessions_one_resumable`，仅约束 `status IN ('active','paused')`。

- [ ] **Step 1: 写模型失败测试**

```python
def test_practice_session_model_has_resumable_and_frozen_report_fields():
    columns = PracticeSession.__table__.columns
    assert set((
        "owner_id", "release_id", "mode", "status", "question_order",
        "answers", "runtime_state", "stats", "scoring_snapshot",
        "report_snapshot", "revision", "paused_at", "completed_at",
    )).issubset(columns.keys())
```

- [ ] **Step 2: 运行测试确认因模型缺失失败**

Run: `cd backend && .venv/bin/python -m pytest tests/test_practice_sessions.py::test_practice_session_model_has_resumable_and_frozen_report_fields -q`

Expected: FAIL，`ImportError: cannot import name 'PracticeSession'`。

- [ ] **Step 3: 实现 ORM 与 Alembic 迁移**

```python
class PracticeSession(Base):
    __tablename__ = "practice_sessions"
    __table_args__ = (
        CheckConstraint("mode IN ('challenge','scholar','revenge')", name="ck_practice_sessions_mode"),
        CheckConstraint("status IN ('active','paused','completed','abandoned')", name="ck_practice_sessions_status"),
        CheckConstraint("revision >= 1", name="ck_practice_sessions_revision"),
        Index(
            "uq_practice_sessions_one_resumable",
            "owner_id", "paper_id", "release_id", "mode",
            unique=True,
            postgresql_where=text("status IN ('active','paused')"),
        ),
    )
```

迁移的 `down_revision` 必须是当前 head `d4f8a1b2c3e4`；`release_id` 使用 `ON DELETE RESTRICT`，`owner_id` 使用 `ON DELETE CASCADE`。

- [ ] **Step 4: 验证迁移可升级、可降级、可再次升级**

Run: `cd backend && .venv/bin/alembic upgrade head && .venv/bin/alembic downgrade d4f8a1b2c3e4 && .venv/bin/alembic upgrade head`

Expected: 三条命令退出码均为 0。

- [ ] **Step 5: 运行模型测试并提交**

Run: `cd backend && .venv/bin/python -m pytest tests/test_practice_sessions.py -q`

Expected: PASS。

```bash
git add backend/app/models/training.py backend/app/models/__init__.py backend/alembic/versions/f7a2c4e6b810_practice_sessions.py backend/tests/test_practice_sessions.py
git commit -m "feat: add persistent practice sessions"
```

### Task 2: 实现领域配额、开始、读取与恢复会话

**Files:**
- Create: `backend/app/services/practice_session_service.py`
- Modify: `backend/app/api/v1/learning.py`
- Modify: `backend/tests/test_practice_sessions.py`
- Modify: `backend/app/services/paper_release_service.py`
- Modify: `backend/tests/test_paper_releases.py`

**Interfaces:**
- Consumes: `PracticeSession`、`PaperRelease`、`PaperReleaseQuestion`、`paper_composition_service.allocate_counts/facet_values`。
- Produces: `start_session(db, owner, user, data) -> dict`。
- Produces: `get_session(db, owner, session_id) -> dict | None`。
- Produces: `list_active_sessions(db, owner, release_id=None, mode=None) -> list[dict]`。
- Produces routes: `POST /learning/practice/sessions/start`、`GET /learning/practice/sessions/active`、`GET /learning/practice/sessions/{session_id}`。

- [ ] **Step 1: 写领域配额与开始会话失败测试**

```python
def test_start_session_freezes_42_50_8_order_and_returns_existing_conflict(client, released_pmp_paper):
    start_payload = {
        "paperId": released_pmp_paper["paperId"],
        "releaseId": released_pmp_paper["releaseId"],
        "mode": "challenge", "count": 60, "order": "paper",
    }
    response = client.post("/api/v1/learning/practice/sessions/start", json=start_payload)
    assert response.status_code == 200
    session = response.json()["session"]
    assert session["domainTargets"] == {"people": 25, "process": 30, "business-environment": 5}
    assert len(session["questions"]) == 60
    assert client.post("/api/v1/learning/practice/sessions/start", json=start_payload).status_code == 409
```

补充用例：10/20/60/180 最大余数准确、领域不足返回结构化 422、未分类题不被静默补位、随机种子稳定、owner B 看不到 owner A 会话、未登录 401、已撤回但已绑定的会话仍可读取。

- [ ] **Step 2: 运行测试确认路由不存在或行为缺失**

Run: `cd backend && .venv/bin/python -m pytest tests/test_practice_sessions.py -k 'start_session or active_session or domain' -q`

Expected: FAIL，路由 404 或服务函数不存在。

- [ ] **Step 3: 实现默认冻结配置和选题**

```python
DEFAULT_DOMAIN_WEIGHTS = {"people": 42, "process": 50, "business-environment": 8}
DEFAULT_SIMULATION_SCORING = {
    "version": 1,
    "label": "幻谱模拟判定",
    "passPercent": 60,
    "bands": {"needs_improvement": 50, "below_target": 60, "target": 80},
}

def domain_targets(total: int) -> dict[str, int]:
    return allocate_counts(DEFAULT_DOMAIN_WEIGHTS, total)
```

`paper_release_service.publish` 和 `publish_from_payload` 对新发布版本自动冻结 `domainWeights` 与 `simulationScoring`；教师无需逐卷配置。已有 release 缺少这两个键时，开始会话冻结同一版本默认值，但不得回写或篡改旧 release。

- [ ] **Step 4: 实现 owner-scoped 开始/读取/active API**

开始会话必须：校验 access entitlement；锁定同 owner/paper/release/mode 的可恢复会话；按领域目标选择快照；随机模式使用服务端 seed；写入 refs、运行状态和计分快照；`commit` 后 `refresh`。

- [ ] **Step 5: 运行定向后端测试并提交**

Run: `cd backend && .venv/bin/python -m pytest tests/test_practice_sessions.py tests/test_paper_releases.py -q`

Expected: PASS。

```bash
git add backend/app/services/practice_session_service.py backend/app/services/paper_release_service.py backend/app/api/v1/learning.py backend/tests/test_practice_sessions.py backend/tests/test_paper_releases.py
git commit -m "feat: start and resume scoped practice sessions"
```

### Task 3: 原子判题、题目锁定与运行状态并发控制

**Files:**
- Modify: `backend/app/services/learning_service.py`
- Modify: `backend/app/services/practice_session_service.py`
- Modify: `backend/app/api/v1/learning.py`
- Modify: `backend/tests/test_practice_learning_api.py`
- Modify: `backend/tests/test_practice_sessions.py`

**Interfaces:**
- Produces: `learning_service.record_practice_answer(..., commit: bool = True) -> dict`，`commit=False` 时不提交事务。
- Produces: `answer_session_question(db, owner, user, session_id, data) -> dict`。
- Produces: `update_runtime_state(db, owner, session_id, data) -> dict`。
- Produces routes: `POST .../{session_id}/answers`、`PATCH .../{session_id}/state`。

- [ ] **Step 1: 写原子判题与并发失败测试**

```python
def test_session_answer_uses_server_truth_locks_answer_and_increments_revision(client, active_session):
    response = client.post(f"/api/v1/learning/practice/sessions/{active_session['id']}/answers", json={
        "revision": 1,
        "questionId": active_session["questions"][0]["questionId"],
        "selectedAnswer": "B",
    })
    assert response.status_code == 200
    body = response.json()
    assert body["answer"]["correct"] is False
    assert body["session"]["revision"] == 2
    assert body["session"]["stats"]["wrong"] == 1
```

补充用例：伪造 `correct=True` 无效；不同答案重复提交 409；相同答案重试幂等且错题次数不重复；过期 revision 更新状态返回 409；terminal 会话拒绝写入；状态 patch 仅接受当前索引、生命、连胜、经验、剩余毫秒、累计用时和显示偏好白名单。

- [ ] **Step 2: 运行测试确认按缺失行为失败**

Run: `cd backend && .venv/bin/python -m pytest tests/test_practice_sessions.py -k 'answer or revision or runtime' -q`

Expected: FAIL，路由 404 或 revision/锁定断言不满足。

- [ ] **Step 3: 拆出无提交判题路径并保持旧 API 兼容**

```python
async def record_practice_answer(db, owner, data, current_user=None, *, commit=True):
    result = await _apply_practice_answer(db, owner, data, current_user=current_user)
    if commit:
        await db.commit()
        if result.mistake is not None:
            await db.refresh(result.mistake)
    return result.to_payload()
```

旧 `/practice/answers` 的状态码、返回字段、错题状态机和现有测试必须保持不变。

- [ ] **Step 4: 在一个事务内写会话答案、错题、统计与事件**

先 `SELECT ... FOR UPDATE` 会话；校验 owner/status/revision/question membership；若未答则调用无提交判题路径，写 `answers[questionId]`、重算 stats、revision + 1 后一次 commit。不要依赖客户端 `correct`、`score` 或当前题序号。

- [ ] **Step 5: 运行新旧判题测试并提交**

Run: `cd backend && .venv/bin/python -m pytest tests/test_practice_sessions.py tests/test_practice_learning_api.py -q`

Expected: PASS。

```bash
git add backend/app/services/learning_service.py backend/app/services/practice_session_service.py backend/app/api/v1/learning.py backend/tests/test_practice_learning_api.py backend/tests/test_practice_sessions.py
git commit -m "feat: persist atomic practice session answers"
```

### Task 4: 暂停、放弃、完成与冻结报告

**Files:**
- Modify: `backend/app/services/practice_session_service.py`
- Modify: `backend/app/api/v1/learning.py`
- Modify: `backend/tests/test_practice_sessions.py`
- Modify: `backend/app/services/learning_service.py`

**Interfaces:**
- Produces: `pause_session`、`abandon_session`、`complete_session`、`get_report`。
- Produces routes: `POST .../pause`、`POST .../abandon`、`POST .../complete`、`GET .../report`。
- Produces immutable `reportSnapshot`：overall、counts、domains、wrongQuestionIds、duration、disclaimer。

- [ ] **Step 1: 写生命周期和报告失败测试**

```python
def test_complete_freezes_simulation_report_and_unanswered_as_zero(client, partially_answered_session):
    response = client.post(
        f"/api/v1/learning/practice/sessions/{partially_answered_session['id']}/complete",
        json={"revision": partially_answered_session["revision"]},
    )
    assert response.status_code == 200
    report = response.json()["report"]
    assert report["resultLabel"].startswith("模拟考试结果：")
    assert report["counts"]["unanswered"] > 0
    assert report["domainWeights"] == {"people": 42, "process": 50, "business-environment": 8}
    assert report["official"] is False
```

补充用例：pause 冻结学霸 `remainingMs`；resume 不扣离线时间；abandon/complete 终态不可逆；重复 complete 幂等且只追加一个 `PRACTICE_SESSION_COMPLETED`；报告错题只含当前会话；报告读取 owner 隔离；完成后修改题目/release metadata 不改变快照；报告生成异常回滚为可重试 active。

- [ ] **Step 2: 运行测试确认生命周期缺失**

Run: `cd backend && .venv/bin/python -m pytest tests/test_practice_sessions.py -k 'pause or abandon or complete or report' -q`

Expected: FAIL。

- [ ] **Step 3: 实现模拟分数与领域等级纯函数**

```python
def performance_band(percent: float, scoring: dict) -> str:
    bands = scoring["bands"]
    if percent < bands["needs_improvement"]: return "needs_improvement"
    if percent < bands["below_target"]: return "below_target"
    if percent < bands["target"]: return "target"
    return "above_target"
```

报告必须从冻结答案和发布题目快照重新计算；未答计 0；overall PASS 条件为冻结 `passPercent`；文案明确“幻谱模拟判定，不代表 PMI 官方考试成绩”。

- [ ] **Step 4: 实现终态事务和兼容历史事件**

完成事务写 `report_snapshot`、status/completed_at/revision，并追加现有 `PRACTICE_SESSION_COMPLETED` 事件供经验汇总；浏览器不再单独上报可伪造完成摘要。列表 API 合并新版会话与旧事件摘要，但新版记录不得重复显示。

- [ ] **Step 5: 运行后端完整相关测试并提交**

Run: `cd backend && .venv/bin/python -m pytest tests/test_practice_sessions.py tests/test_practice_learning_api.py tests/test_paper_releases.py -q`

Expected: PASS。

```bash
git add backend/app/services/practice_session_service.py backend/app/services/learning_service.py backend/app/api/v1/learning.py backend/tests/test_practice_sessions.py
git commit -m "feat: freeze practice completion reports"
```

### Task 5: 扩展浏览器会话适配器与纯状态核心

**Files:**
- Modify: `frontend/scripts/new-legacy-assets/practice-learning-adapter.js`
- Modify: `frontend/scripts/practice-learning-contract.test.mjs`
- Create: `new-legacy/src/111-practice-session-core.js`
- Create: `new-legacy/tests/practice-session-core.test.js`

**Interfaces:**
- Produces adapter methods: `startSession/getActiveSessions/getSession/updateState/answerSession/pauseSession/completeSession/abandonSession/getReport`。
- Produces `KGPracticeSessionCore.normalizeSession(session)`、`questionStatus(session, questionId)`、`answerSheetStats(session)`、`resumableRuntime(session)`。

- [ ] **Step 1: 写适配器和核心失败测试**

```javascript
test('questionStatus keeps submitted answers read-only', () => {
  const session = Core.normalizeSession({
    questions: [{ questionId: 'q1' }, { questionId: 'q2' }],
    answers: { q1: { selectedAnswer: 'B', correct: false } },
    runtimeState: { currentIndex: 0 },
  })
  assert.equal(Core.questionStatus(session, 'q1'), 'wrong')
  assert.deepEqual(Core.answerSheetStats(session), { total: 2, answered: 1, correct: 0, wrong: 1, unanswered: 1 })
})
```

适配器契约测试应断言每条新路由、credentials、JSON 错误、401 auth 事件和 409 detail 保留，同时扫描生产做题代码不存在浏览器存储业务键。

- [ ] **Step 2: 运行测试确认模块/API 缺失**

Run: `node --test new-legacy/tests/practice-session-core.test.js frontend/scripts/practice-learning-contract.test.mjs`

Expected: FAIL，模块不存在或方法缺失。

- [ ] **Step 3: 实现适配器与无 DOM 状态核心**

状态核心只接受/返回可克隆对象；不得读写 fetch、DOM 或浏览器存储。409 错误保留 `status` 和服务端 `detail`，供模式层显示“另一页面已更新”。

- [ ] **Step 4: 运行测试并提交**

Run: `node --test new-legacy/tests/practice-session-core.test.js frontend/scripts/practice-learning-contract.test.mjs`

Expected: PASS。

```bash
git add frontend/scripts/new-legacy-assets/practice-learning-adapter.js frontend/scripts/practice-learning-contract.test.mjs new-legacy/src/111-practice-session-core.js new-legacy/tests/practice-session-core.test.js
git commit -m "feat: add browser practice session client"
```

### Task 6: 实现共享答题卡与三模式会话编排

**Files:**
- Create: `new-legacy/src/112-practice-answer-sheet.js`
- Modify: `new-legacy/practice-mode.html`
- Modify: `new-legacy/styles/practice-mode.css`
- Modify: `new-legacy/src/100-practice-mode.js`
- Create: `new-legacy/tests/practice-answer-sheet-browser.py`
- Modify: `new-legacy/tests/v90-p40-practice-mode.test.js`

**Interfaces:**
- Consumes: `KGPracticeSessionCore`、`KGPracticeLearningApi`。
- Produces: `KGPracticeAnswerSheet.mount(root, {onNavigate,onSubmit})`，以及 `render(session, currentQuestionId, filter)`。
- Produces visible controls: 桌面答题概览、移动答题卡入口/抽屉、未答/错题筛选、交卷。

- [ ] **Step 1: 写答题卡正向、反向和恢复浏览器测试**

测试行为必须包括：挑战/学霸/复仇都显示答题卡；点击 7 号切到第 7 题；已答题选项 disabled 且显示本人答案/正确答案/解析；判题失败保留选择并可重试；409 停止计时并提供“加载最新进度”；未答交卷能返回定位；窄屏打开底部抽屉；所有题号包含状态 `aria-label`。

- [ ] **Step 2: 运行测试确认 UI 缺失**

Run: `python new-legacy/tests/practice-answer-sheet-browser.py`

Expected: FAIL，找不到 `#practiceAnswerSheet` 或跳题行为不存在。

- [ ] **Step 3: 添加语义 DOM 与响应式样式**

```html
<aside id="practiceAnswerSheet" class="practice-answer-sheet" aria-label="答题概览"></aside>
<button id="practiceAnswerSheetMobileBtn" type="button" aria-controls="practiceAnswerSheetDrawer">答题卡 <span>0/0</span></button>
<section id="practiceSubmitConfirm" role="dialog" aria-modal="true" hidden></section>
```

桌面 `min-width: 1024px` 使用题目区 + 320px 常驻侧栏；窄屏题卡保持全宽，答题卡从底部抽屉打开。状态除颜色外必须有图标/文字/aria-label。

- [ ] **Step 4: 把 `100-practice-mode.js` 接入服务端会话**

开始模式先调用 `startSession` 或加载 active session；作答只调用 `answerSession`；导航更新 runtime currentIndex；成功答案更新 session snapshot；已答题渲染只读；全部已答自动 complete；提前交卷显示未答数量。挑战/学霸/复仇只改变 runtime 规则，不拥有第二套答案事实。

- [ ] **Step 5: 实现保存退出、放弃和恢复入口**

退出弹窗提供“继续做题 / 保存并退出 / 放弃本次练习”。保存失败留在当前页；pause 成功才停止计时并返回大厅；大厅对应试卷/模式显示“继续上次练习 已答/总数”；学霸恢复使用服务端 `remainingMs`，不扣离线时间。

- [ ] **Step 6: 运行静态与浏览器测试并提交**

Run: `node new-legacy/tests/v90-p40-practice-mode.test.js && node --test new-legacy/tests/practice-session-core.test.js && python new-legacy/tests/practice-answer-sheet-browser.py`

Expected: PASS。

```bash
git add new-legacy/practice-mode.html new-legacy/styles/practice-mode.css new-legacy/src/100-practice-mode.js new-legacy/src/112-practice-answer-sheet.js new-legacy/tests/practice-answer-sheet-browser.py new-legacy/tests/v90-p40-practice-mode.test.js
git commit -m "feat: add resumable practice answer sheet"
```

### Task 7: 实现幻谱 PMP 风格成绩报告和本次错题复盘

**Files:**
- Create: `new-legacy/src/113-practice-result-report.js`
- Modify: `new-legacy/practice-mode.html`
- Modify: `new-legacy/styles/practice-mode.css`
- Modify: `new-legacy/src/100-practice-mode.js`
- Add: `new-legacy/assets/logo.jpg`
- Create: `new-legacy/tests/practice-result-report-browser.py`

**Interfaces:**
- Consumes: completed session `reportSnapshot`。
- Produces: `KGPracticeResultReport.render(root, report)`。
- Produces: SVG 饼图，扇区大小取冻结 `domainWeights`，颜色取每领域 `performanceBand`，外侧引导线显示领域与比例。

- [ ] **Step 1: 写视觉结构和交互失败测试**

测试断言：正式 Logo 为 `/assets/logo.jpg`；标题明确“幻谱 PMP 模拟成绩分析报告”；PASS/FAIL 前含“模拟考试结果”；数值分数、总体区间、42/50/8 饼图、四档图例、三个领域表、错题题号和非官方声明可见；暂停/放弃会话不显示报告；错题入口只打开本次会话错题且不可提交。

- [ ] **Step 2: 运行测试确认报告缺失**

Run: `python new-legacy/tests/practice-result-report-browser.py`

Expected: FAIL，报告结构或图表不存在。

- [ ] **Step 3: 实现报告模块和 SVG 饼图**

```javascript
const BAND_COLORS = Object.freeze({
  needs_improvement: '#e83b68',
  below_target: '#f7bd2f',
  target: '#74c3b8',
  above_target: '#15958f',
})
```

图表扇区角度由 `42/50/8` 冻结权重计算；外侧 label 不得被移动端裁切；颜色不能表示答对/答错。统计区单独显示总题、答对、答错、未答、正确率和累计用时。

- [ ] **Step 4: 实现当前会话错题复盘**

成绩页题号进入 `review` 只读状态；答题卡过滤为 `wrongQuestionIds`；题目显示本人答案、正确答案和解析；隐藏提交、生命、计时和修改控件；返回报告不重新计算或写数据库。

- [ ] **Step 5: 运行报告与答题卡浏览器测试并提交**

Run: `python new-legacy/tests/practice-result-report-browser.py && python new-legacy/tests/practice-answer-sheet-browser.py`

Expected: PASS。

```bash
git add new-legacy/assets/logo.jpg new-legacy/practice-mode.html new-legacy/styles/practice-mode.css new-legacy/src/100-practice-mode.js new-legacy/src/113-practice-result-report.js new-legacy/tests/practice-result-report-browser.py
git commit -m "feat: add Huanpu practice result report"
```

### Task 8: 完整需求矩阵、真实 API E2E 与回归修复

**Files:**
- Create: `frontend/e2e/practice_resumable_report.py`
- Modify: `frontend/scripts/design-contract.test.mjs`
- Modify: `frontend/scripts/practice-learning-contract.test.mjs`
- Modify: any files with a test-proven defect found in this task

**Interfaces:**
- Produces: 真实 FastAPI/PostgreSQL 下的正向、反向、恢复、权限和持久化证据。

- [ ] **Step 1: 写真实 API 端到端测试并确认失败**

控制矩阵至少覆盖：三模式开始；所有可见按钮/链接绑定；自由跳题；正确/错误锁定；判题网络失败重试；保存失败不退出；暂停后刷新/重新登录恢复；学霸暂停时间不减少；未答取消/仍交卷；结果报告；错题复盘；owner A/B 隔离；重复点击；完成后历史重开。

Run: `cd frontend && pnpm dev`，另一个终端运行 `cd frontend && .venv/bin/python e2e/practice_resumable_report.py`

Expected: 首次运行至少因未实现的完整流程或发现的交互缺陷失败。

- [ ] **Step 2: 修复每个失败，逐项重跑直到通过**

每个浏览器发现的缺陷先保留最小复现断言，再改产品。不得把断言降级为只检查元素存在、toast 或路由变化。

- [ ] **Step 3: 扫描业务数据浏览器存储和无效控件**

Run: `rg -n "localStorage|sessionStorage|indexedDB|操作已触发|功能已触发|coming soon" new-legacy/src/100-practice-mode.js new-legacy/src/111-practice-session-core.js new-legacy/src/112-practice-answer-sheet.js new-legacy/src/113-practice-result-report.js frontend/scripts/new-legacy-assets/practice-learning-adapter.js`

Expected: 无业务持久化或占位反馈命中。

- [ ] **Step 4: 运行后端、前端和浏览器相关测试并提交**

Run:

```bash
cd backend && .venv/bin/python -m pytest tests/test_practice_sessions.py tests/test_practice_learning_api.py tests/test_paper_releases.py -q
cd frontend && pnpm test
node new-legacy/tests/v90-p40-practice-mode.test.js
python new-legacy/tests/practice-answer-sheet-browser.py
python new-legacy/tests/practice-result-report-browser.py
cd frontend && .venv/bin/python e2e/practice_resumable_report.py
```

Expected: 全部 PASS，浏览器控制台无未处理异常。

```bash
git add backend frontend new-legacy
git commit -m "test: cover resumable practice report workflows"
```

### Task 9: 正式同步、发布校验、合入 main 与远程核验

**Files:**
- Generated/Modify: `frontend/public/new-legacy/**`
- Generated/Modify: `frontend/new-legacy-releases/**`
- Generated/Modify: release manifest、sync report、`current.json` 和 seed version files

**Interfaces:**
- Produces: active release 同源提供完成后的做题页、Logo、适配器、答题卡和报告模块。

- [ ] **Step 1: 记录发布前 active release 文件数和关键文件**

```bash
active_version=$(node -e "const x=require('./frontend/new-legacy-releases/current.json');process.stdout.write(x.version)")
find "frontend/new-legacy-releases/$active_version/site" -type f | wc -l
test -f "frontend/new-legacy-releases/$active_version/site/admin-console.html"
```

- [ ] **Step 2: 运行唯一允许的更新发布命令**

Run: `node frontend/scripts/manage-new-legacy.js update new-legacy --skip-browser`

Expected: sync、构建、关键页面、API、视觉校验全部通过并 promote；候选文件数不少于发布前 active 文件数。

- [ ] **Step 3: 对 active release 重新运行同源 E2E 和全量测试**

Run: `cd backend && .venv/bin/python -m pytest tests/ -q && cd ../frontend && pnpm test`

Run: `cd frontend && .venv/bin/python e2e/practice_resumable_report.py`

Expected: 全部 PASS；active 页面存在 `assets/logo.jpg`、`src/111-practice-session-core.js`、`src/112-practice-answer-sheet.js`、`src/113-practice-result-report.js`。

- [ ] **Step 4: 提交生成产物并核对工作树**

```bash
git add frontend/public/new-legacy frontend/new-legacy-releases frontend/scripts new-legacy backend
git commit -m "release: publish resumable practice reports"
git status --short
```

Expected: 除已明确保留的用户文件外工作树干净。

- [ ] **Step 5: 按项目纪律合入 main、删除功能分支并推送**

在通过 `finishing-a-development-branch` 自检后，将 `codex/practice-result-experience` 合入 `main`。推送必须使用：

```bash
git -c http.proxy=http://127.0.0.1:7897 push origin main
git ls-remote origin refs/heads/main
```

Expected: 远程 main 指向本地最终提交；完成后删除本地/远程功能分支和工作树，仓库只保留 `main`。

## 计划自检

- 设计规格 1–18 节均有对应任务：会话/恢复在 Task 1–4，答题卡/跳题在 Task 5–6，报告/错题在 Task 4/7，失败并发在 Task 3–4/8，发布约束在 Task 9。
- 新增函数、路由、DOM 模块和测试文件的名字在生产者与消费者之间一致。
- 没有 TBD、TODO、“类似前文”或未定义的后续实现占位。
- 当前 42/50/8 和未来 33/41/26 已分开；当前报告不会误标为 2026 年 7 月版 PMI 官方配比。
- 模拟 PASS/FAIL 使用冻结的幻谱内部规则，页面与 API 都带非官方声明；数值阈值不会由客户端决定。
- 持久化事实全部在 PostgreSQL；前端存储只允许本次渲染所需的内存状态。
