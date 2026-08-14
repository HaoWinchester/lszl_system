# Content Prep Recall Binding End-to-End Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 让 Content Prep 中选择的正式 Recall 节点稳定 ID 经共享草稿和数据库同步后，被主程序深度回忆正确解析并展示后续推荐。

**Architecture:** 在现有 `20-page-runtime.js` 内复用 P4.5.29 的搜索算法和交互，不引入新的前端框架或第二数据源。后端引用校验改为显式接收本次批次的 Recall library，并在未携带时读取科目级 `SharedRuntimeState`；题目和联想库继续由现有上传事务原子提交。学员端保持现有数据库快照消费路径，只增加跨程序回归测试。

**Tech Stack:** 原生 JavaScript、HTML/CSS、Node.js `node:test`/`vm`、FastAPI、SQLAlchemy async、PostgreSQL、pytest、Playwright、现有 new-legacy release manager。

## Global Constraints

- 本轮只覆盖冻结表 `Prep Studio差异` 第 1–5 项和主程序深度回忆端到端联动。
- `recallNodeId == ""` 合法；只有非空且不存在的 ID 报错。
- 搜索必须覆盖中文名、英文名、Alias 和 Recall ID，不得按自由文本自动创建或猜测正式节点。
- 关键词位置必须按题干或指定选项来源隔离，同词可在不同来源独立存在。
- PostgreSQL 和 `SharedRuntimeState` 是正式题目/联想库真源；不得新增浏览器业务持久化。
- 不直接修改 `frontend/public/new-legacy/` 或 active release site；正式发布只走 release manager。
- 发布前候选 site 文件数不得少于当前 active release，并检查 `admin-console.html`、`knowledge-recall.html`、`content-prep-studio/dist/content-prep.html`。
- 用户提供的未跟踪冻结表文件不得修改、暂存或提交。

---

## File Map

- `new-legacy/content-prep-studio/src/js/20-page-runtime.js`：关键词位置重算、Recall 搜索排序、关键词浮窗/明细卡绑定、可空校验。
- `new-legacy/content-prep-studio/src/css/app.css`：搜索行、结果列表和状态文案样式。
- `new-legacy/content-prep-studio/tests/test_recall_binding.js`：搜索、来源隔离、可空/无效 ID 与关键 DOM 契约单元测试。
- `new-legacy/content-prep-studio/build.py` 与 `dist/content-prep.html`：重建单页交付物；不改变 JS 模块顺序。
- `backend/app/services/content_reference_service.py`：从本次批次或科目共享正式库生成 Recall ID 集合。
- `backend/app/services/content_prep_service.py`：把本次批次 `recall_library` 传给题目引用校验。
- `backend/tests/test_content_prep_recall_binding.py`：同批新增节点、已发布节点、空值、坏 ID 和回滚测试。
- `new-legacy/tests/v90-p4529-content-prep-recall-link-browser.py`：真实 Prep 搜索/保存/同步到 Deep Recall 推荐的隔离浏览器测试。
- `frontend/scripts/new-legacy-release.test.mjs`、`frontend/scripts/manage-new-legacy.js`：使用现有发布 Gate，不修改发布规则。

---

### Task 1: Prep Recall 搜索、来源隔离和可空校验

**Files:**
- Create: `new-legacy/content-prep-studio/tests/test_recall_binding.js`
- Modify: `new-legacy/content-prep-studio/src/js/20-page-runtime.js`
- Modify: `new-legacy/content-prep-studio/src/css/app.css`
- Regenerate: `new-legacy/content-prep-studio/dist/content-prep.html`

**Interfaces:**
- Consumes: `state.recallLibrary.nodes`, `recallIndex()`, `countOccurrences(text, term)`,现有 `markWorkspaceDirty()` 捕获层。
- Produces: `normalizeRecallSearchText(value) -> string`、`fuzzySubsequenceMatch(needle, haystack) -> boolean`、`recallSearchNodes(term, limit=80) -> Array<{n,score,best}>`、`recallFilteredOptions(term, selectedId='') -> {html,count,rows}`；浮窗与明细卡保存 `clue.recallNodeId`/`recallEntryLabel`。

- [ ] **Step 1: 写搜索与来源隔离失败测试**

在 `test_recall_binding.js` 中读取真实 `20-page-runtime.js`，用平衡花括号提取命名函数后在 `vm` 中执行。固定数据包含：

```js
const nodes = [
  {id:'recall:load', title:'工作负荷与团队支持', titleEn:'Workload support', aliases:['不堪重负'], priority:8},
  {id:'recall:team', title:'团队协作', titleEn:'Team collaboration', aliases:['合作'], priority:3},
];
```

断言：

```js
assert.equal(search('不堪重负')[0].n.id, 'recall:load');
assert.equal(search('workload')[0].n.id, 'recall:load');
assert.equal(search('recall:load')[0].n.id, 'recall:load');
assert.equal(search('wrldspprt')[0].n.id, 'recall:load'); // Workload support 的合法子序列
```

另构造题干和 A/B 选项都含“团队”的题目，断言 `recomputeKeywordLocations` 只保留每条 clue 自己的来源，不把题干 clue 扩展到选项。

- [ ] **Step 2: 运行失败测试并确认失败原因**

Run:

```bash
node --test new-legacy/content-prep-studio/tests/test_recall_binding.js
```

Expected: FAIL，原因是 `recallSearchNodes`/搜索 DOM 尚不存在，且当前 `recomputeKeywordLocations` 会跨来源写入位置。

- [ ] **Step 3: 最小实现搜索算法与来源隔离**

在 `20-page-runtime.js` 中把 `recomputeKeywordLocations` 改为：

```js
function recomputeKeywordLocations(q){
  const stem=questionStem(q);
  q.clues.forEach(c=>{
    const locs=[],sourceType=String(c.sourceType||'stem'),sourceOptionId=String(c.sourceOptionId||'');
    if(sourceType==='option'){
      const option=q.options.find(o=>String(o.id)===sourceOptionId);
      const count=option?countOccurrences(option.text,c.text):0;
      if(count)locs.push({field:'option',optionId:sourceOptionId,count});
    }else{
      const count=countOccurrences(stem,c.text);
      if(count)locs.push({field:'stem',optionId:'',count});
    }
    c.matchLocations=locs;
  });
}
```

移植设计文档定义的 `normalizeRecallSearchText`、`fuzzySubsequenceMatch`、`recallSearchNodes` 和 `recallFilteredOptions`，完全匹配优先于前缀/包含/多词/子序列，再按 priority 和中文名排序。

- [ ] **Step 4: 为浮窗和明细卡接入真实选择状态**

浮窗新增：

```html
<input id="floatRecallSearch" placeholder="输入名称 / Alias / ID 模糊搜索">
<button id="floatRecallSearchClear" type="button">清空</button>
<select id="floatRecall"></select>
<div id="floatRecallSearchMeta"></div>
```

使用独立的 `floatRecallSelectedId` 保存选择；搜索文本永远不能直接写入 `recallNodeId`。Enter 选择第一项，Escape 清空查询，下拉变更更新名称与 ID。明细卡使用 `data-kw-recall-search`、`data-kw-recall-select`、`data-kw-recall-clear` 和 clue ID 复用相同行为。

- [ ] **Step 5: 改为 optional-existing-id-only 校验**

把现有强制绑定：

```js
if(!c.recallNodeId||!recallIndex().byId.has(c.recallNodeId)) ...
```

改为：

```js
if(c.recallNodeId&&!recallIndex().byId.has(c.recallNodeId)){
  issues.push({level:'error',message:`关键词“${c.text}”引用的联想入口不存在：${c.recallNodeId}`,suggest:'清除该引用，或重新选择一个现有联想入口。'});
}
```

并让关键词就绪状态不再要求每条 clue 都有 Recall ID。

- [ ] **Step 6: 补充 CSS 并重建 dist**

在 `app.css` 增加：

```css
.keyword-float .recall-search-row,.kw-card .recall-search-row{display:flex;gap:6px;align-items:center;margin-bottom:6px}
.recall-search-row input{flex:1}
.recall-search-meta{font-size:11px;color:var(--muted);margin-top:4px;min-height:16px}
select.recall-filtered{max-height:190px}
```

Run:

```bash
python3 new-legacy/content-prep-studio/build.py
```

- [ ] **Step 7: 运行前端聚焦验证**

Run:

```bash
node --test new-legacy/content-prep-studio/tests/test_recall_binding.js
python3 new-legacy/content-prep-studio/tests/test_build.py
python3 new-legacy/content-prep-studio/tests/test_services.py
git diff --check
```

Expected: 全部 PASS，build reproducibility 报告 `passed`。

- [ ] **Step 8: 提交 Prep 变化**

```bash
git add new-legacy/content-prep-studio/src/js/20-page-runtime.js new-legacy/content-prep-studio/src/css/app.css new-legacy/content-prep-studio/tests/test_recall_binding.js new-legacy/content-prep-studio/dist/content-prep.html
git commit -m "feat: add searchable recall binding in content prep"
```

---

### Task 2: 服务器以本次或共享 Recall library 校验稳定 ID

**Files:**
- Create: `backend/tests/test_content_prep_recall_binding.py`
- Modify: `backend/app/services/content_reference_service.py`
- Modify: `backend/app/services/content_prep_service.py`

**Interfaces:**
- Consumes: `ContentPrepBatchRequest.recall_library`、`SharedRuntimeState` 科目 key `kg_recall_association_library_v1__subject__<quoted-subject-id>`。
- Produces: `validate_question_references(..., recall_library: dict[str, Any] | None = None)`；非空引用仅对 effective library 的 active node IDs 校验。

- [ ] **Step 1: 写同批引用与可空失败测试**

新测试创建教师、公开题库和共享科目状态，向 `/api/v1/content-prep/batches` 提交：

```python
"recallLibrary": {
    "schemaVersion": 1,
    "nodes": [
        {"id": "recall:overloaded", "title": "工作负荷与团队支持", "aliases": ["不堪重负"]},
        {"id": "recall:support", "title": "支持团队"},
    ],
    "edges": [{"from": "recall:overloaded", "to": "recall:support", "priority": 1}],
},
"questions": [{"question": question_with_recall_id("recall:overloaded")}],
```

断言批次成功、数据库题目 clue 保存该 ID、共享库保存节点和边。第二题使用空 ID 也成功；第三批使用 `recall:missing` 返回 `REFERENCE_NOT_FOUND`，且该批新联想库和题目均未落库。

- [ ] **Step 2: 运行后端测试并确认 RED**

Run:

```bash
cd backend && .venv/bin/python -m pytest tests/test_content_prep_recall_binding.py -q
```

Expected: 同批新增节点测试 FAIL，因为当前校验在写入前读取旧 Runtime State/旧库。

- [ ] **Step 3: 实现 effective Recall library**

在 `content_reference_service.py`：

```python
async def validate_question_references(
    db: AsyncSession,
    actor_username: str,
    subject: str,
    payload: dict,
    *,
    incoming_principle_ids: set[str] | None = None,
    recall_library: dict[str, Any] | None = None,
) -> list[CatalogIssue]:
```

新增帮助函数，把 `PMP` 规范为 `subject-pmp`，通过 `quote(subject_id, safe="")` 构造共享 key。若 `recall_library is not None` 使用传入库；否则读取共享 row。删除发布者个人 `RuntimeState` 查找逻辑。只要存在 Recall 引用才解析联想库，空引用不要求目录存在。

- [ ] **Step 4: 从批次准备阶段传入本次库**

在 `_prepare_questions` 调用中加入：

```python
await content_reference_service.validate_question_references(
    db,
    actor.username,
    bank.subject,
    prepared_question.normalized,
    incoming_principle_ids=incoming_principle_ids,
    recall_library=request.recall_library,
)
```

保持实际写入仍发生在同一 `_execute_upload` 事务；校验失败时不执行 `apply_auxiliary_assets` 或题目 upsert。

- [ ] **Step 5: 运行聚焦与相关后端测试**

Run:

```bash
cd backend && .venv/bin/python -m pytest tests/test_content_prep_recall_binding.py tests/test_content_prep_banks_and_refs.py tests/test_content_prep_shared_content.py -q
```

Expected: 全部 PASS；旧测试更新为在 `SharedRuntimeState` 种 Recall 库，明确证明不依赖 `RuntimeState`。

- [ ] **Step 6: 提交服务器变化**

```bash
git add backend/app/services/content_reference_service.py backend/app/services/content_prep_service.py backend/tests/test_content_prep_recall_binding.py backend/tests/test_content_prep_banks_and_refs.py
git commit -m "fix: validate recall bindings against shared catalog"
```

---

### Task 3: Prep 到 Deep Recall 的隔离浏览器回归

**Files:**
- Create: `new-legacy/tests/v90-p4529-content-prep-recall-link-browser.py`
- Reference: `new-legacy/tests/v90-p4529-deep-recall-database-browser.py`

**Interfaces:**
- Consumes: `/content-prep` 页面、共享草稿 API、Content Prep batch API、`GET /api/v1/recall/session/{question_id}`、`knowledge-recall.html`。
- Produces: 可重复运行的 disposable PostgreSQL + candidate release 浏览器 Gate，不修改开发数据库或 active release。

- [ ] **Step 1: 复制现有隔离 harness 结构并改成目标流程**

测试创建临时 PostgreSQL 数据库，Alembic 升级，使用 release manager 在临时目录构建候选站点，并断言候选文件数不少于 active release。固定数据：

```python
QUESTION_TITLE = "倾听并支持不堪重负的团队成员"
KEYWORD = "不堪重负"
ENTRY_ID = "recall:overloaded"
NEXT_ID = "recall:support-team"
```

- [ ] **Step 2: 写 Prep UI 失败流程**

管理员登录后：

```python
page.goto(base + "/content-prep", wait_until="networkidle")
page.locator('[data-creator-key="peiqi"]').click()
page.once("dialog", lambda dialog: dialog.accept("Recall 联动验收草稿"))
page.locator("#btnCreateSharedDraft").click()
page.locator("#fileContentBundle").set_input_files(bundle_path)
page.locator('[data-tab="questions"]').click()
page.locator('mark[data-kwid="clue-overloaded"]').click()
page.locator("#floatRecallSearch").fill("不堪重负")
page.locator("#floatRecall").select_option(ENTRY_ID)
page.locator("#floatSave").click()
```

然后创建目标题库、保存共享草稿、同步，重新读取题目 API，断言 clue ID 未丢失。切换为学生会话打开深度回忆，揭示并点击关键词，断言第一个推荐包含“支持团队”。

- [ ] **Step 3: 运行浏览器测试并确认 RED**

Run:

```bash
backend/.venv/bin/python new-legacy/tests/v90-p4529-content-prep-recall-link-browser.py
```

Expected: 在 Task 1/2 代码临时回退时分别因搜索入口缺失或同批引用失败而 FAIL；当前实现完成后 PASS。

- [ ] **Step 4: 增加负向与恢复断言**

同一测试覆盖：Alias 搜索、清空查询后既有选择不丢失、显式选择未关联后保存、坏 ID 批次返回精确错误、修正后重试成功、页面无 `pageerror`/console error。

- [ ] **Step 5: 运行两个深度回忆浏览器 Gate**

Run:

```bash
backend/.venv/bin/python new-legacy/tests/v90-p4529-content-prep-recall-link-browser.py
backend/.venv/bin/python new-legacy/tests/v90-p4529-deep-recall-database-browser.py
```

Expected: 两个脚本均以 `-ok` 结束；测试创建的数据库和临时 release 均被清理。

- [ ] **Step 6: 提交端到端测试**

```bash
git add new-legacy/tests/v90-p4529-content-prep-recall-link-browser.py
git commit -m "test: cover prep to deep recall binding flow"
```

---

### Task 4: 全量验证、正式发布与 main 收尾

**Files:**
- Modify by release manager: `frontend/new-legacy-releases/` 下命令输出所报告的新版本 `source/**`
- Modify by release manager: `frontend/new-legacy-releases/` 下命令输出所报告的新版本 `site/**`
- Modify by release manager: `frontend/new-legacy-releases/current.json`
- Modify by release manager: `frontend/public/new-legacy/**`

**Interfaces:**
- Consumes: Task 1–3 的已提交源与测试。
- Produces: 候选文件完整、active release 指针提升、main 已推送、无遗留功能分支/工作树。

- [ ] **Step 1: 运行源级完整相关测试**

```bash
cd backend && .venv/bin/python -m pytest tests/ -q
cd ..
for test_file in new-legacy/content-prep-studio/tests/test_*.js; do node "$test_file"; done
for test_file in new-legacy/content-prep-studio/tests/test_*.py; do python3 "$test_file"; done
node --test new-legacy/tests/content-prep-question-bank-integration.test.js
node --test new-legacy/tests/v90-p4529-deep-recall-flow.test.js
node frontend/scripts/new-legacy-release.test.mjs
```

Expected: 所有命令 exit 0。

- [ ] **Step 2: 运行隔离浏览器测试**

```bash
backend/.venv/bin/python new-legacy/tests/v90-p4529-content-prep-recall-link-browser.py
backend/.venv/bin/python new-legacy/tests/v90-p4529-deep-recall-database-browser.py
```

- [ ] **Step 3: 核对 active release 文件基线**

读取 `frontend/new-legacy-releases/current.json`，记录当前 site 的 `find ... -type f | wc -l`，确认 `admin-console.html`、`knowledge-recall.html`、`content-prep-studio/dist/content-prep.html` 存在。

- [ ] **Step 4: 通过正式管理器发布**

```bash
node frontend/scripts/manage-new-legacy.js update new-legacy --skip-browser
```

不得手工复制 release site。发布输出必须显示 candidate 文件数不小于旧 active 文件数，并成功 promote。

- [ ] **Step 5: 对新 active release 重跑关键 Gate**

```bash
node frontend/scripts/new-legacy-release.test.mjs
backend/.venv/bin/python new-legacy/tests/v90-p4529-content-prep-recall-link-browser.py
git diff --check
git status --short --branch
```

- [ ] **Step 6: 提交发布产物并推送 main**

```bash
git add frontend/new-legacy-releases frontend/public/new-legacy frontend/new-legacy-sync-report.json
git commit -m "release: publish recall binding flow"
git push origin main
```

不得暂存用户提供的冻结表。

- [ ] **Step 7: 清理并核对分支/工作树**

```bash
git branch --format='%(refname:short)'
git branch -r --format='%(refname:short)'
git worktree list
git status --short --branch
```

只删除已经合入 `main` 的功能分支和对应工作树；保留托管工具创建的临时 detached 工作树以及用户未跟踪的冻结表文件。
