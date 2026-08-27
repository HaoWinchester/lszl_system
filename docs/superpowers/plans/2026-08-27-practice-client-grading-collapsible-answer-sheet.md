# 做题模式前端即时判题、显式保存与折叠答题卡实施计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 把挑战、学霸、复仇三种模式改为前端即时判题且选择答案零写请求，只在保存退出或明确交卷时整卷写入服务器，同时将答题概览折叠到右上角并统一所有点击请求的加载反馈。

**Architecture:** `practice_sessions` 继续作为 PostgreSQL 业务事实源，但 active/paused 状态中的 `answers` 改为未判题草稿，completed 状态中的 `answers` 才保存服务端重算结果；不新增表或 Alembic 迁移。前端新增纯内存草稿模块，使用会话开始时一次下发的冻结答案完成游戏反馈，`100-practice-mode.js` 只在开始、显式保存、交卷、放弃、恢复和历史成绩加载时调用 API。答题卡只保留一个共享实例，桌面右侧抽屉、移动端底部抽屉复用同一 DOM 和状态。

**Tech Stack:** FastAPI、SQLAlchemy async、PostgreSQL JSONB、原生 HTML/CSS/JavaScript、Node `node:test`、pytest、Playwright、现有 `KGLearningLoading` 公共加载组件。

## Global Constraints

- 本产品用于练习，不以隐藏正确答案作为防作弊边界；会话开始或恢复可以下发冻结正确答案和解析。
- 选择答案、点击题号、上一题和下一题不得产生 `/answers`、`/state` 或其他写请求。
- 不做 30 秒或其他固定间隔自动保存，也不在 `beforeunload` 中发送请求。
- 只有“保存并退出”和用户明确点击“交卷并查看成绩”才提交整卷答案；答完最后一题不得自动交卷。
- 交卷前答案选择后锁定；服务器交卷时忽略客户端 `correct/correctAnswer/score/PASS/FAIL` 并从冻结发布快照重算。
- 答案、草稿、成绩和报告不得持久化到 `localStorage`、`sessionStorage` 或 IndexedDB。
- 答题卡默认关闭，右上角入口始终可再次打开；桌面不再为答题卡永久预留 324px。
- 退出弹窗三个操作按“继续做题 / 保存并退出 / 放弃本次练习”纵向等宽排列。
- 点击触发的开始、保存、交卷、放弃、恢复和历史成绩加载必须复用 `KGLearningLoading`，异常路径也必须关闭。
- 当前领域配比继续固定为 42% / 50% / 8%，成绩报告和模拟判定规则不在本轮改动。
- `new-legacy/` 是前端权威源；不得手工编辑 `frontend/public/new-legacy/` 或 active release site。
- SQLAlchemy async 写操作 `commit` 后访问 ORM 属性前必须 `await db.refresh(obj)`。
- 每个生产改动先运行新增测试并确认失败，再实现最小代码使其通过。
- 本轮留在 `uat`；不得部署 UAT 或合并 `main`，除非用户再次明确授权。

---

## 文件职责映射

- `backend/app/services/practice_session_service.py`：完整题目会话载荷、整卷草稿校验、显式暂停保存、交卷时逐题重算和终态幂等。
- `backend/app/services/learning_service.py`：继续提供无提交判题/错题公共入口；不把整卷逻辑复制进 API 路由。
- `backend/app/api/v1/learning.py`：保留现有路由，只负责把整卷 body 传给 service 和映射结构化异常。
- `backend/tests/test_practice_sessions.py`：正确答案下发、显式草稿保存、整卷权威交卷、复仇状态、并发与账号隔离。
- `backend/tests/test_practice_learning_api.py`：旧逐题接口兼容，防止其他调用方回归。
- `new-legacy/src/114-practice-draft-state.js`：纯内存答题草稿、前端正误派生、锁定、dirty 和提交载荷；不访问 DOM、fetch 或浏览器存储。
- `new-legacy/tests/practice-draft-state.test.js`：草稿纯函数单元测试。
- `frontend/scripts/new-legacy-assets/practice-learning-adapter.js`：继续作为唯一会话 API 网关，pause/complete 接收整卷 body。
- `frontend/scripts/practice-learning-contract.test.mjs`：适配器请求方法、body 和禁用浏览器业务持久化契约。
- `new-legacy/src/100-practice-mode.js`：三模式即时反馈、显式持久化、离开提醒、点击请求加载框和页面状态编排。
- `new-legacy/src/112-practice-answer-sheet.js`：单实例答题卡渲染、筛选、跳题和交卷事件。
- `new-legacy/practice-mode.html`：右上答题卡入口、单一抽屉、提交确认和退出弹窗语义结构。
- `new-legacy/styles/practice-mode.css`：右侧/底部抽屉、题目全宽、加载期间交互和退出三按钮几何。
- `new-legacy/tests/practice-server-answer-browser.py`：改为“前端判题且选择零请求”浏览器证明。
- `new-legacy/tests/practice-answer-sheet-browser.py`：单实例折叠答题卡、显式保存、失败恢复和布局。
- `new-legacy/tests/practice-challenge-loading-browser.py`：扩展为全部点击请求的公共加载框生命周期测试。
- `new-legacy/tests/practice-mode-close-buttons.test.js`：退出弹窗结构与固定列布局契约。
- `frontend/e2e/practice_resumable_report.py`：真实 FastAPI/PostgreSQL 下请求矩阵、跨登录恢复、整卷交卷和报告闭环。

### Task 1: 服务端完整题目载荷与整卷草稿校验

**Files:**
- Modify: `backend/app/services/practice_session_service.py:201-334`
- Modify: `backend/tests/test_practice_sessions.py`

**Interfaces:**
- Produces: `async _validated_draft_answers(db: AsyncSession, session: PracticeSession, data: dict) -> dict[str, dict]`。
- Produces: `_draft_stats(refs: list[dict], rows: dict[str, PaperReleaseQuestion], answers: dict[str, dict], previous: dict) -> dict`。
- Changes: `_session_payload(db, session)` 对当前会话全部题目返回冻结 `correctAnswer/analysis/reasoningSteps`。
- Preserves: owner、release entitlement、题目顺序和 report snapshot 隔离。

- [ ] **Step 1: 写开始/恢复载荷和草稿校验失败测试**

```python
def test_active_session_reveals_frozen_answer_key_for_client_grading(client, active_session):
    session = client.get(
        f"/api/v1/learning/practice/sessions/{active_session['id']}"
    ).json()["session"]
    first = session["questions"][0]["question"]
    assert first["correctAnswer"] == "A"
    assert first["analysis"]


def test_pause_rejects_answer_outside_frozen_question_options(client, active_session):
    first_id = active_session["questions"][0]["questionId"]
    response = client.post(
        f"/api/v1/learning/practice/sessions/{active_session['id']}/pause",
        json={
            "revision": active_session["revision"],
            "answers": {first_id: {"selectedAnswer": "Z", "selectionIndex": 1}},
            "runtimeState": {"currentIndex": 0, "durationMs": 1000},
        },
    )
    assert response.status_code == 422
    assert response.json()["detail"]["code"] == "PRACTICE_DRAFT_ANSWER_INVALID"
```

再增加：非会话题号、非对象 answers、重复/负数 `selectionIndex`、非学霸模式 `timedOut`、超过题目总数、客户端注入 `correct/correctAnswer/score` 被拒绝或剥离。

- [ ] **Step 2: 运行定向测试确认旧脱敏行为与校验缺失**

Run: `cd backend && .venv/bin/python -m pytest tests/test_practice_sessions.py -k 'reveals_frozen_answer_key or draft_answer_invalid' -q`

Expected: FAIL；未答题载荷没有 `correctAnswer`，pause 也尚未校验 `answers`。

- [ ] **Step 3: 实现完整题目载荷与草稿白名单**

```python
async def _validated_draft_answers(
    db: AsyncSession, session: PracticeSession, data: dict
) -> dict[str, dict]:
    raw = data.get("answers")
    if not isinstance(raw, dict):
        raise _error(422, "INVALID_PRACTICE_DRAFT", "answers 必须是对象")
    refs = {str(item.get("questionId") or ""): item for item in session.question_order if isinstance(item, dict)}
    normalized = {}
    seen_indexes = set()
    for question_id, value in raw.items():
        if question_id not in refs or not isinstance(value, dict):
            raise _error(422, "PRACTICE_DRAFT_ANSWER_INVALID", "草稿包含非法题目")
        selected = str(value.get("selectedAnswer") or "").strip()
        selection_index = value.get("selectionIndex")
        if not selected or isinstance(selection_index, bool) or not isinstance(selection_index, int) or selection_index < 1:
            raise _error(422, "PRACTICE_DRAFT_ANSWER_INVALID", "草稿答案或顺序无效")
        if selection_index in seen_indexes:
            raise _error(422, "PRACTICE_DRAFT_ANSWER_INVALID", "草稿选择顺序重复")
        seen_indexes.add(selection_index)
        normalized[question_id] = {
            "selectedAnswer": selected,
            "selectionIndex": selection_index,
            **({"timedOut": True} if value.get("timedOut") is True else {}),
        }
    return normalized
```

选项合法性必须从 `PaperReleaseQuestion.snapshot.options` 校验，不能只校验 A/B/C/D 字符串。`_session_payload` 将 `reveal_answer` 固定为 `True`；不能改动 paper release 本身。

- [ ] **Step 4: 实现未完成草稿统计派生**

`_draft_stats` 从冻结快照临时重算 `answered/correct/wrong/unanswered/experience`，但不写 `PracticeMistake`、`TrainingProgress` 或完成事件。它只服务恢复按钮和前端运行状态；`answers` 本身仍不保存 `correct`。

- [ ] **Step 5: 运行测试并提交**

Run: `cd backend && .venv/bin/python -m pytest tests/test_practice_sessions.py -k 'answer_key or draft' -q`

Expected: PASS。

```bash
git add backend/app/services/practice_session_service.py backend/tests/test_practice_sessions.py
git commit -m "feat: accept validated practice answer drafts"
```

### Task 2: 显式保存整卷草稿且不推进长期错题

**Files:**
- Modify: `backend/app/services/practice_session_service.py:955-1025`
- Modify: `backend/tests/test_practice_sessions.py`

**Interfaces:**
- Consumes: `_validated_draft_answers`、`_draft_stats`。
- Changes: `pause_session(db, owner, session_id, data) -> dict` 原子写入 `answers + runtime_state + stats + paused`。
- Preserves: `revision` 冲突、重复 pause 幂等、owner 隔离和终态不可逆。

- [ ] **Step 1: 写显式保存正向、失败和副作用失败测试**

```python
def test_pause_saves_whole_ungraded_draft_once_without_mistakes(client, active_session):
    first_id = active_session["questions"][0]["questionId"]
    response = client.post(
        f"/api/v1/learning/practice/sessions/{active_session['id']}/pause",
        json={
            "revision": active_session["revision"],
            "answers": {first_id: {"selectedAnswer": "B", "selectionIndex": 1}},
            "runtimeState": {"currentIndex": 0, "health": 2, "durationMs": 1200},
        },
    )
    assert response.status_code == 200
    saved = response.json()["session"]
    assert saved["status"] == "paused"
    assert saved["answers"][first_id] == {"selectedAnswer": "B", "selectionIndex": 1}
    assert saved["stats"]["answered"] == 1
    assert _mistake_count(active_session["id"]) == 0
```

补充：保存失败事务回滚、旧 revision 409、不允许减少或改写已保存锁定答案、相同请求重试幂等、学霸 `remainingMs` 恢复不扣离线时间、保存后另一账号 404。

- [ ] **Step 2: 运行测试确认 pause 只保存 runtime**

Run: `cd backend && .venv/bin/python -m pytest tests/test_practice_sessions.py -k 'pause_saves_whole or pause_conflict or pause_idempotent' -q`

Expected: FAIL；返回会话没有整卷草稿或出现提前错题副作用。

- [ ] **Step 3: 在 pause 的一次事务中保存草稿和运行状态**

```python
draft = await _validated_draft_answers(db, session, data)
_assert_existing_selections_unchanged(session.answers or {}, draft)
session.answers = draft
_apply_runtime_patch(session, data)
session.stats = _draft_stats(session.question_order, rows, draft, session.stats or {})
session.status = "paused"
session.paused_at = saved_at
session.revision += 1
await db.commit()
await db.refresh(session)
```

如果现有 active session 含旧版已判题答案，比较时只取 `selectedAnswer/timedOut/selectionIndex`，保证升级前草稿可以继续而不重复累计错题。

- [ ] **Step 4: 运行生命周期相关测试并提交**

Run: `cd backend && .venv/bin/python -m pytest tests/test_practice_sessions.py -k 'pause or resume or owner' -q`

Expected: PASS。

```bash
git add backend/app/services/practice_session_service.py backend/tests/test_practice_sessions.py
git commit -m "feat: save practice drafts only on explicit pause"
```

### Task 3: 交卷时整卷权威重算和终态幂等

**Files:**
- Modify: `backend/app/services/practice_session_service.py:547-720,1040-1215`
- Modify: `backend/app/services/learning_service.py`
- Modify: `backend/tests/test_practice_sessions.py`
- Modify: `backend/tests/test_practice_learning_api.py`

**Interfaces:**
- Produces: `_grade_session_selection(db, owner, user, session, ref, row, draft, submission_index) -> dict`。
- Changes: `complete_session(db, owner, user, session_id, data) -> tuple[dict, dict]` 接收整卷 `answers`。
- Changes: `backend/app/api/v1/learning.py` 的 complete 路由把 `user` 传入 service。
- Preserves: 旧 `/answers` 路由使用同一单题判题 helper，兼容旧前端但新前端不调用。

- [ ] **Step 1: 写权威整卷交卷失败测试**

```python
def test_complete_regrades_whole_submission_and_ignores_client_truth(client, active_session):
    first_id = active_session["questions"][0]["questionId"]
    response = client.post(
        f"/api/v1/learning/practice/sessions/{active_session['id']}/complete",
        json={
            "revision": active_session["revision"],
            "answers": {
                first_id: {
                    "selectedAnswer": "B",
                    "selectionIndex": 1,
                    "correct": True,
                    "correctAnswer": "B",
                    "score": 999,
                }
            },
            "runtimeState": {"currentIndex": 0, "durationMs": 1800},
        },
    )
    assert response.status_code == 200
    body = response.json()
    assert body["session"]["answers"][first_id]["correct"] is False
    assert body["report"]["counts"]["wrong"] == 1
    assert body["report"]["passed"] is False
```

增加：pause 后不产生错题、complete 后才产生；未答计 0；重复 complete 返回同一报告且不重复经验/错题；交卷失败整笔回滚；submissionIndex 顺序决定连胜经验；复仇模式只有 complete 才推进长期状态；旧 `/answers` 仍通过原测试。

- [ ] **Step 2: 运行整卷和旧接口测试确认失败**

Run: `cd backend && .venv/bin/python -m pytest tests/test_practice_sessions.py tests/test_practice_learning_api.py -k 'complete or answer' -q`

Expected: 新整卷用例 FAIL；旧逐题用例仍记录为兼容基线。

- [ ] **Step 3: 抽取单题权威判题 helper**

```python
async def _grade_session_selection(db, owner, user, session, ref, row, draft, submission_index):
    selected = draft["selectedAnswer"]
    correct_answer = str((row.snapshot or {}).get("correctAnswer") or "")
    if session.mode == "revenge":
        mistake = await learning_service.record_revenge_answer(
            db, owner, str(ref.get("mistakeId") or ""),
            {"selectedAnswer": selected}, commit=False,
        )
    else:
        await learning_service.record_practice_answer(
            db, owner,
            {"questionId": ref["questionId"], "bankId": ref.get("bankId", ""),
             "paperId": session.paper_id, "releaseId": session.release_id,
             "sourceMode": session.mode, "selectedAnswer": selected,
             "timedOut": draft.get("timedOut") is True},
            current_user=user, commit=False,
        )
    return {
        "questionId": ref["questionId"], "selectedAnswer": selected,
        "correctAnswer": correct_answer, "correct": selected == correct_answer,
        "submissionIndex": submission_index,
    }
```

旧逐题 endpoint 调用同一 helper 后按原响应结构提交；不得复制第二套错题逻辑。

- [ ] **Step 4: 改 complete 为一次锁定、一次重算、一次提交**

完成前 `SELECT ... FOR UPDATE`，校验 revision 后按 `selectionIndex` 遍历草稿，调用 helper，
写完成态 `answers/stats/report_snapshot/LearningEvent`，最后一次 commit。`session.status == completed`
时在解析新 body 前直接返回冻结报告，保证重试幂等。

- [ ] **Step 5: 运行后端相关测试并提交**

Run: `cd backend && .venv/bin/python -m pytest tests/test_practice_sessions.py tests/test_practice_learning_api.py -q`

Expected: PASS。

```bash
git add backend/app/services/practice_session_service.py backend/app/services/learning_service.py backend/app/api/v1/learning.py backend/tests/test_practice_sessions.py backend/tests/test_practice_learning_api.py
git commit -m "feat: grade whole practice papers on submission"
```

### Task 4: 新增纯内存答题草稿模块

**Files:**
- Create: `new-legacy/src/114-practice-draft-state.js`
- Create: `new-legacy/tests/practice-draft-state.test.js`
- Modify: `new-legacy/practice-mode.html`

**Interfaces:**
- Produces: `KGPracticeDraftState.create({questions, answers}) -> DraftController`。
- Produces methods: `select(questionId, selectedAnswer, {timedOut})`、`answer(questionId)`、`viewAnswers()`、`submission()`、`stats()`、`isDirty()`、`markSaved()`。
- Guarantees: `viewAnswers()` 含本地派生 `correct/correctAnswer` 供 UI；`submission()` 只含 `selectedAnswer/timedOut/selectionIndex`。

- [ ] **Step 1: 写纯状态模块失败测试**

```javascript
test('draft selects and locks locally while stripping client truth from submission', () => {
  const draft = Core.create({
    questions: [{questionId:'q1', question:{correctAnswer:'A', options:[{id:'A'},{id:'B'}]}}],
    answers: {},
  })
  assert.equal(draft.select('q1', 'B').answer.correct, false)
  assert.equal(draft.select('q1', 'A').accepted, false)
  assert.deepEqual(draft.submission(), {
    q1: {selectedAnswer:'B', selectionIndex:1},
  })
  assert.equal(draft.isDirty(), true)
  draft.markSaved()
  assert.equal(draft.isDirty(), false)
})
```

增加：恢复服务器草稿后重新派生正误；超时；非法题号/选项；统计；selectionIndex 稳定；输入对象不被修改；模块不访问 fetch/DOM/storage。

- [ ] **Step 2: 运行测试确认模块不存在**

Run: `node --test new-legacy/tests/practice-draft-state.test.js`

Expected: FAIL，`KGPracticeDraftState` 未定义。

- [ ] **Step 3: 实现最小纯内存控制器**

```javascript
function create({questions=[],answers={}}={}){
  const byId=new Map(questions.map(item=>[text(item.questionId),item.question||{}]));
  const draft=hydrate(byId,answers);
  let dirty=false;
  function select(questionId,selectedAnswer,{timedOut=false}={}){
    const id=text(questionId),question=byId.get(id);
    if(!question||draft[id])return {accepted:false,answer:draft[id]||null};
    const optionIds=new Set((question.options||[]).map(item=>text(item.id)));
    if(!timedOut&&!optionIds.has(text(selectedAnswer)))return {accepted:false,answer:null};
    draft[id]=gradeLocal(question,selectedAnswer,{timedOut,selectionIndex:Object.keys(draft).length+1});
    dirty=true;
    return {accepted:true,answer:clone(draft[id])};
  }
  return Object.freeze({select,answer,viewAnswers,submission,stats,isDirty:()=>dirty,markSaved:()=>{dirty=false}});
}
```

- [ ] **Step 4: 在 HTML 中于 `100-practice-mode.js` 前加载模块并运行测试**

Run: `node --test new-legacy/tests/practice-draft-state.test.js new-legacy/tests/practice-session-core.test.js`

Expected: PASS。

- [ ] **Step 5: 提交**

```bash
git add new-legacy/src/114-practice-draft-state.js new-legacy/tests/practice-draft-state.test.js new-legacy/practice-mode.html
git commit -m "feat: add in-memory practice draft state"
```

### Task 5: 三模式改为本地判题与显式持久化

**Files:**
- Modify: `new-legacy/src/100-practice-mode.js:130-210,540-810,795-840,858-990`
- Modify: `frontend/scripts/new-legacy-assets/practice-learning-adapter.js`
- Modify: `frontend/scripts/practice-learning-contract.test.mjs`
- Modify: `new-legacy/tests/practice-server-answer-browser.py`
- Modify: `new-legacy/tests/practice-answer-sheet-browser.py`
- Modify: `new-legacy/tests/v90-p40-practice-mode.test.js`

**Interfaces:**
- Consumes: `KGPracticeDraftState`、现有 `pauseSession/completeSession`。
- Removes from normal answering: `answerSession()`、`updateState()`、5 秒 autosave 和导航持久化。
- Produces: `submissionPayload() -> {answers, runtimeState}`、未保存离开提醒、显式保存/交卷。

- [ ] **Step 1: 改浏览器测试先断言选择与导航零写请求**

```python
page.evaluate("window.__practiceWrites=[]")
page.locator('[data-option-id="B"]').click()
page.locator('#practiceNextBtn').click()
writes = page.evaluate("window.__practiceWrites")
assert writes == []
assert "is-wrong" in (page.locator('[data-option-id="B"]').get_attribute("class") or "")
```

测试需分别覆盖 challenge、scholar、revenge；学霸本地超时不得调用 `/answers`；最后一题答完仍停留 game，直到点击交卷。保存退出必须恰好一次 pause 请求且 body 含全部选择；交卷必须恰好一次 complete 请求。

- [ ] **Step 2: 运行浏览器/契约测试确认现有逐题请求失败**

Run:

```bash
python new-legacy/tests/practice-server-answer-browser.py
python new-legacy/tests/practice-answer-sheet-browser.py
node new-legacy/tests/v90-p40-practice-mode.test.js
```

Expected: FAIL；当前每次选择调用 `/answers`，导航/定时器调用 `/state`，最后一题会自动交卷。

- [ ] **Step 3: 用一个 draft controller 统一 session 与非 session 作答**

开始/恢复后执行：

```javascript
state.draft=global.KGPracticeDraftState.create({
  questions:state.session.questions,
  answers:state.session.answers,
});
```

`answer()` 只调用 `state.draft.select(...)`，把返回的本地 `correct` 交给现有挑战/学霸/复仇反馈分支；删除正常题目上的 `api.answerSession`、`api.answer` 和 `persistCurrentIndex`。`answerSheetSession()` 用 `state.draft.viewAnswers()` 覆盖渲染答案。

- [ ] **Step 4: 删除短间隔 autosave 与导航保存**

移除 `startAutosave/stopAutosave` 调用和 5 秒 interval；`navigateToQuestionId`、`switchQuestion`、`advanceAfterAnswer`、`handleTimeout` 不再写服务器。保留 revision 只用于显式生命周期请求。

- [ ] **Step 5: 实现显式保存和交卷载荷**

```javascript
function submissionPayload(){
  return {
    answers:state.draft?.submission?.()||{},
    runtimeState:runtimeState(),
  };
}

async function saveAndExit(){
  const payload=submissionPayload();
  const saved=await api.pauseSession(state.session.id,{revision:state.session.revision,...payload});
  state.session=normalizedSession(saved);
  state.draft.markSaved();
  showLobby();
}
```

`finishPractice` 只有答题卡交卷按钮或未答确认按钮调用；complete body 同样包含整卷 answers。全部答完后只更新按钮/提示，不调用 finish。

- [ ] **Step 6: 增加仅 dirty 时的原生离开提醒**

```javascript
global.addEventListener('beforeunload',event=>{
  if(!state.active||!state.draft?.isDirty?.())return;
  event.preventDefault();
  event.returnValue='';
});
```

保存成功、交卷成功和明确放弃后清除 dirty；保存/交卷失败保持 dirty 和页面内存答案。

- [ ] **Step 7: 运行前端相关测试并提交**

Run:

```bash
node --test new-legacy/tests/practice-draft-state.test.js new-legacy/tests/practice-session-core.test.js
node new-legacy/tests/v90-p40-practice-mode.test.js
python new-legacy/tests/practice-server-answer-browser.py
python new-legacy/tests/practice-answer-sheet-browser.py
cd frontend && pnpm test
```

Expected: PASS。

```bash
git add new-legacy/src/100-practice-mode.js frontend/scripts/new-legacy-assets/practice-learning-adapter.js frontend/scripts/practice-learning-contract.test.mjs new-legacy/tests/practice-server-answer-browser.py new-legacy/tests/practice-answer-sheet-browser.py new-legacy/tests/v90-p40-practice-mode.test.js
git commit -m "feat: grade practice answers locally until submission"
```

### Task 6: 折叠单实例答题卡与退出弹窗布局

**Files:**
- Modify: `new-legacy/practice-mode.html:145-200,271-278,292-298`
- Modify: `new-legacy/styles/practice-mode.css:43-46,261-275`
- Modify: `new-legacy/src/100-practice-mode.js:940-970,1140-1160,1200-1215`
- Modify: `new-legacy/src/112-practice-answer-sheet.js`
- Modify: `new-legacy/tests/practice-answer-sheet-browser.py`
- Modify: `new-legacy/tests/practice-mode-close-buttons.test.js`

**Interfaces:**
- Produces one toggle: `#practiceAnswerSheetMobileBtn`（保留 ID 兼容既有绑定，所有宽度可见）。
- Produces one render root: `#practiceAnswerSheet`，位于 `#practiceAnswerSheetDrawer` 内。
- Removes: `#practiceAnswerSheetMobile` 和游戏区常驻 `<aside>`。

- [ ] **Step 1: 写 DOM 单实例和几何失败测试**

浏览器断言：页面只有一个 `[aria-label="答题概览"]`；1280px 初始题目卡不预留 324px；右上按钮打开右侧抽屉、点击题号切题并关闭；390px 打开底部抽屉；关闭/遮罩/Escape 后焦点回到入口；反复打开不出现重复组件。

退出弹窗在 1280、1024、768、390px 下断言：三个可见按钮 `x >= content.x`、`right <= content.right`、宽度差小于 1px、y 顺序递增且不重叠。

- [ ] **Step 2: 运行测试确认常驻侧栏和三按钮溢出**

Run: `python new-legacy/tests/practice-answer-sheet-browser.py && node --test new-legacy/tests/practice-mode-close-buttons.test.js`

Expected: FAIL；桌面仍有常驻侧栏，1280px 第一个退出按钮向弹窗左侧溢出约 40px。

- [ ] **Step 3: 合并为一个答题卡 DOM 和一个 mount**

把答题卡入口移到 topbar 最右侧；抽屉 body 内只保留 `#practiceAnswerSheet`。`cacheDom/init`
只 mount 一次，删除 `mobileAnswerSheet`。`navigateToQuestionId` 成功后统一关闭抽屉。

- [ ] **Step 4: 改桌面右抽屉和移动端底部抽屉样式**

删除：

```css
@media (min-width:1024px){.practice-game{padding-right:324px}.practice-answer-sheet{display:block}}
```

默认抽屉从右侧进入；`max-width:760px` 改为底部圆角抽屉。题目区保持 `width:min(860px,100%)`，入口按钮所有宽度 `display:inline-flex`。

- [ ] **Step 5: 固定退出按钮纵向等宽**

```css
#practiceExitConfirm .practice-exit-dialog>div{
  display:grid;
  grid-template-columns:1fr;
  gap:9px;
}
#practiceExitConfirm .practice-exit-dialog>div>button:not([hidden]){
  width:100%;
  min-width:0;
}
```

移除会把退出按钮改为 `flex:1 1 140px` 的宽屏/窄屏通用规则；挑战失败和未答交卷弹窗保持各自布局。

- [ ] **Step 6: 运行布局测试并提交**

Run:

```bash
python new-legacy/tests/practice-answer-sheet-browser.py
node --test new-legacy/tests/practice-mode-close-buttons.test.js
node new-legacy/tests/v90-p40-practice-mode.test.js
```

Expected: PASS。

```bash
git add new-legacy/practice-mode.html new-legacy/styles/practice-mode.css new-legacy/src/100-practice-mode.js new-legacy/src/112-practice-answer-sheet.js new-legacy/tests/practice-answer-sheet-browser.py new-legacy/tests/practice-mode-close-buttons.test.js
git commit -m "fix: collapse practice answer sheet and exit actions"
```

### Task 7: 所有点击请求统一公共加载框

**Files:**
- Modify: `new-legacy/src/100-practice-mode.js:190-220,430-510,795-840,880-990`
- Modify: `new-legacy/tests/practice-challenge-loading-browser.py`
- Modify: `new-legacy/tests/practice-answer-sheet-browser.py`

**Interfaces:**
- Produces: `runClickedRequest({key, button, title, message}, operation) -> Promise<any>`。
- Consumes: `KGLearningLoading.show({title,message})`、`KGLearningLoading.hide()`。
- Covers keys: `start/save/complete/abandon/reload/report`。

- [ ] **Step 1: 写延迟响应、失败和重复点击失败测试**

为每个 key 注入可控 Promise，点击后断言：

```python
assert page.locator('[data-learning-loading="true"]').is_visible()
assert page.locator('[data-learning-loading-title]').inner_text() == "正在保存进度"
page.locator('#practiceSaveExitBtn').click(force=True)
assert page.evaluate("window.__pauseCalls") == 1
page.evaluate("window.__resolvePause()")
assert page.locator('[data-learning-loading="true"]').is_hidden()
```

500、网络异常和 409 都必须关闭加载框并恢复按钮；选择答案、题号和前后题切换必须断言加载框始终隐藏。

- [ ] **Step 2: 运行加载测试确认只有开始流程覆盖**

Run: `python new-legacy/tests/practice-challenge-loading-browser.py && python new-legacy/tests/practice-answer-sheet-browser.py`

Expected: FAIL；当前保存、交卷、放弃、恢复和历史报告没有统一加载框或可被双击。

- [ ] **Step 3: 实现统一请求包装器**

```javascript
async function runClickedRequest({key,button,title,message},operation){
  if(state.pendingRequestKey)return {skipped:true};
  state.pendingRequestKey=key;
  if(button)button.disabled=true;
  global.KGLearningLoading?.show?.({title,message});
  try{return await operation()}
  finally{
    global.KGLearningLoading?.hide?.();
    if(button)button.disabled=false;
    state.pendingRequestKey='';
  }
}
```

开始/继续、saveAndExit、finishPractice、abandonPractice、reloadLatestSession、学习记录报告读取统一使用该入口。业务函数自身继续负责成功后的页面切换和失败文案，包装器只管等待 UI 与重复请求。

- [ ] **Step 4: 运行加载和主流程测试并提交**

Run:

```bash
python new-legacy/tests/practice-challenge-loading-browser.py
python new-legacy/tests/practice-answer-sheet-browser.py
python new-legacy/tests/practice-result-report-browser.py
```

Expected: PASS，页面无未处理 Promise 错误。

```bash
git add new-legacy/src/100-practice-mode.js new-legacy/tests/practice-challenge-loading-browser.py new-legacy/tests/practice-answer-sheet-browser.py
git commit -m "fix: show shared loading for practice requests"
```

### Task 8: 真实 API 请求矩阵、同步发布和本地验收

**Files:**
- Modify: `frontend/e2e/practice_resumable_report.py`
- Modify: `frontend/scripts/design-contract.test.mjs`
- Modify: `frontend/scripts/practice-learning-contract.test.mjs`
- Modify: `new-legacy/VERSION`
- Generated/Modify: `frontend/public/new-legacy/**`
- Generated/Modify: `frontend/new-legacy-manifest.json`
- Generated/Modify: `frontend/new-legacy-sync-report.json`
- Generated/Modify: `frontend/new-legacy-releases/**`

**Interfaces:**
- Produces: active local release 中可供用户在 `http://127.0.0.1:5173/` 验收的新做题流程。
- Does not produce: UAT 部署或 `main` 合并。

- [ ] **Step 1: 把真实 E2E 改为新请求矩阵并确认失败**

在 `frontend/e2e/practice_resumable_report.py` 记录所有
`/api/v1/learning/practice/sessions/` 请求，真实完成：

1. challenge 选择 3 题、跳题，断言没有 answers/state 写请求；
2. 保存退出，断言恰好一个 pause 且 body 含 3 个答案；
3. 重新登录恢复，断言选择、题号、生命和正误一致；
4. 再答 1 题并明确点击交卷，断言恰好一个 complete；
5. 报告错题与数据库重算一致；
6. scholar 本地超时、保存恢复；
7. revenge 未交卷不推进长期错题，交卷后推进；
8. owner B 无法读取 owner A 会话；
9. 延迟响应时公共加载框可见且重复点击只发一次；
10. 1280/1024/768/390px 答题卡和退出按钮几何通过。

Run: `cd frontend && .venv/bin/python e2e/practice_resumable_report.py`

Expected: 初次 FAIL，证明旧逐题请求和常驻侧栏仍不满足契约。

- [ ] **Step 2: 运行后端、前端和浏览器完整相关测试**

Run:

```bash
cd backend && .venv/bin/python -m pytest tests/test_practice_sessions.py tests/test_practice_learning_api.py tests/test_paper_releases.py -q
cd frontend && pnpm test && pnpm test:design
node --test new-legacy/tests/practice-draft-state.test.js new-legacy/tests/practice-session-core.test.js new-legacy/tests/practice-mode-close-buttons.test.js
node new-legacy/tests/v90-p40-practice-mode.test.js
python new-legacy/tests/practice-server-answer-browser.py
python new-legacy/tests/practice-answer-sheet-browser.py
python new-legacy/tests/practice-challenge-loading-browser.py
python new-legacy/tests/practice-result-report-browser.py
cd frontend && .venv/bin/python e2e/practice_resumable_report.py
```

Expected: 全部 PASS；最终交付记录每条命令的通过数量。

- [ ] **Step 3: 执行业务存储和逐题写请求源码扫描**

Run:

```bash
rg -n "localStorage|sessionStorage|indexedDB" new-legacy/src/100-practice-mode.js new-legacy/src/114-practice-draft-state.js frontend/scripts/new-legacy-assets/practice-learning-adapter.js
rg -n "answerSession|updateState|startAutosave|setInterval.*persist" new-legacy/src/100-practice-mode.js
```

Expected: 第一条无业务答案/会话持久化命中；第二条只允许旧兼容定义或明确非正常作答流程，不允许选择/导航/超时调用。

- [ ] **Step 4: 记录当前 active 文件数并生成本地不可变 release**

先把 `new-legacy/VERSION` 从 `v9.0-p4.1.179` 增加到下一个未使用版本；若仓库中已存在该版本，则继续递增，不覆盖旧 release。

```bash
active_version=$(node -e "const x=require('./frontend/new-legacy-releases/current.json');process.stdout.write(x.version)")
find "frontend/new-legacy-releases/$active_version/site" -type f | wc -l
test -f "frontend/new-legacy-releases/$active_version/site/admin-console.html"
node frontend/scripts/manage-new-legacy.js update new-legacy --skip-browser
```

Expected: 候选文件数不少于原 active；关键页面、`src/114-practice-draft-state.js`、Logo、答题卡和报告模块全部存在；脚本完成本地 promote。

- [ ] **Step 5: 在 active local release 做“好奇用户”验收**

使用命名 browser session 打开 `http://127.0.0.1:5173/practice-mode.html`，登录测试账号后逐项点击：开始、三模式选题、题号跳转、答题卡开关、保存失败重试、保存恢复、未答交卷取消、正式交卷、报告错题、退出三个按钮、重复点击。桌面与 390px 各保留截图和请求计数证据；完成后关闭 browser session。

- [ ] **Step 6: 提交生成产物并保持在 uat**

```bash
git add backend frontend new-legacy docs/superpowers
git commit -m "release: publish explicit-save practice flow"
git status --short --branch
```

Expected: 工作树干净，分支为 `uat`，相对 `origin/uat` ahead；不执行 push、不运行 `deploy/update-uat.sh`、不切换或合并 `main`。

## 计划自检

- 规格的正确答案下发、前端即时判题、显式保存、整卷交卷、复仇状态和服务端权威重算分别由 Task 1–5 覆盖。
- 规格的右上角折叠入口、桌面右抽屉、移动底部抽屉、单一 DOM 和退出三按钮几何由 Task 6 覆盖。
- 公共加载框的开始、保存、交卷、放弃、恢复、历史报告、成功、500、超时和 409 路径由 Task 7 覆盖。
- 请求次数、跨登录恢复、账号隔离、四个视口、业务存储扫描、active release 和手动好奇用户遍历由 Task 8 覆盖。
- 后端函数名 `_validated_draft_answers/_draft_stats/_grade_session_selection` 与后续任务消费名称一致；前端统一使用 `KGPracticeDraftState.create` 和 `runClickedRequest`。
- 本轮复用 `practice_sessions.answers`，没有数据表变化，因此计划没有虚构 Alembic 迁移。
- 没有定时保存、逐题保存、卸载网络请求、桌面常驻答题卡、自动交卷或客户端成绩事实。
- 没有 TBD、TODO、“类似前文”或未定义的实现占位。
