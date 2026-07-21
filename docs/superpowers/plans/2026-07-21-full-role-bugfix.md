# Full-Role Bugfix Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 修复五角色功能测试确认的 15 项缺陷，并保留只读 `new-legacy`、自动升级和失败回滚能力。

**Architecture:** 在同步生成阶段复制上游并注入职责单一的直接运行适配器；浏览器业务存储统一由 `KGServerStateStorage` 写入 FastAPI runtime state，归一化用户和系统配置继续走专用 API。只能在闭包内部修复的上游缺口由精确锚点补丁处理，锚点变化时同步失败。

**Tech Stack:** Node.js `node:test`、原生 JavaScript、FastAPI、Pydantic、SQLAlchemy async、PostgreSQL、pytest、Playwright Chromium。

---

### Task 1: 统一浏览器存储并提供可等待提交

**Files:**
- Modify: `frontend/scripts/new-legacy-assets/server-state-bootstrap.js`
- Modify: `frontend/scripts/sync-new-legacy.js`
- Modify: `frontend/scripts/direct-runtime.test.mjs`
- Modify: `frontend/scripts/new-legacy-sync.test.mjs`

- [x] **Step 1: 写存储代理失败测试**

在 `direct-runtime.test.mjs` 断言 bootstrap 通过 `Object.defineProperty(global, 'localStorage', ...)` 安装代理、公开 Promise 化 `flush`，并在 `pagehide` 的 microtask 中发送最新快照；在同步测试中断言包含正则引号和 `localStorage` 的上游脚本生成后内容不再被源码重写。

```js
assert.match(source, /Object\.defineProperty\(global,\s*['"]localStorage['"]/)
assert.match(source, /flush/)
assert.match(source, /queueMicrotask/)
assert.equal(readFileSync(generatedScript, 'utf8'), upstreamSource)
```

- [x] **Step 2: 运行测试并确认因缺少代理而失败**

Run: `cd frontend && node --test scripts/direct-runtime.test.mjs scripts/new-legacy-sync.test.mjs`  
Expected: FAIL，错误包含 `Object.defineProperty` 或“生成脚本内容不相等”。

- [x] **Step 3: 实现统一代理与 Promise flush**

删除 `rewriteStorageIdentifiers` 对 `.js` 和内联脚本的调用；在 bootstrap 创建 storage 后安装同一对象，并让 `flush()` 在保存成功、冲突重试成功或明确失败后结束。

```js
Object.defineProperty(global, 'localStorage', {
  configurable: true,
  enumerable: true,
  value: storage,
})
storage.flush = flush
global.queueMicrotask(() => sendLatestBeacon())
```

- [x] **Step 4: 运行前端测试并确认通过**

Run: `cd frontend && pnpm test`  
Expected: 全部 PASS。

- [x] **Step 5: 提交存储修复**

```bash
git add frontend/scripts/new-legacy-assets/server-state-bootstrap.js frontend/scripts/sync-new-legacy.js frontend/scripts/direct-runtime.test.mjs frontend/scripts/new-legacy-sync.test.mjs
git commit -m "fix: unify new legacy server storage"
```

### Task 2: 图谱及时保存与创建文件跳转

**Files:**
- Create: `frontend/scripts/new-legacy-assets/direct-graph-adapter.js`
- Create: `frontend/scripts/new-legacy-assets/direct-file-adapter.js`
- Modify: `frontend/scripts/sync-new-legacy.js`
- Modify: `frontend/scripts/direct-runtime.test.mjs`
- Create: `frontend/e2e/full_role_regression.py`

- [x] **Step 1: 写注入顺序与浏览器失败测试**

断言图谱适配器位于 `24-graph-file-autosave.js` 后，文件适配器位于 `27-graph-file-manager.js` 后；Playwright 新增节点后刷新应仍存在，创建文件后应成为当前文件。

```js
assert.ok(page.indexOf('src/24-graph-file-autosave.js') < page.indexOf('direct-graph-adapter.js'))
assert.ok(filePage.indexOf('src/27-graph-file-manager.js') < filePage.indexOf('direct-file-adapter.js'))
```

- [x] **Step 2: 运行测试并确认失败**

Run: `cd frontend && node --test scripts/direct-runtime.test.mjs`  
Expected: FAIL，适配器尚未注入。

- [x] **Step 3: 实现图谱短延迟保存**

包装 `markDirty`，最后一次修改 400ms 后强制调用 `saveNow`，随后等待 runtime storage flush；保留原函数返回值和原有保存状态事件。

```js
const originalMarkDirty = autosave.markDirty.bind(autosave)
autosave.markDirty = function (reason) {
  const result = originalMarkDirty(reason)
  clearTimeout(timer)
  timer = setTimeout(() => {
    autosave.saveNow({ force: true, silent: true, reason: 'server-debounce' })
    global.KGServerStateStorage?.flush?.()
  }, 400)
  return result
}
```

- [x] **Step 4: 实现文件跳转保存屏障**

捕获“创建并打开”动作，在文件创建同步完成后等待 `flush()`；提交成功才导航，失败则保持当前页并通过现有 toast/status 显示错误。

```js
await global.KGServerStateStorage.flush({ force: true })
global.location.assign('index.html')
```

- [x] **Step 5: 生成站点并运行图谱/文件测试**

Run: `cd frontend && pnpm sync:new-legacy && node --test scripts/direct-runtime.test.mjs`  
Expected: PASS，且 `new-legacy/` 的 git diff 为空。

- [x] **Step 6: 提交图谱与文件修复**

```bash
git add frontend/scripts/new-legacy-assets/direct-graph-adapter.js frontend/scripts/new-legacy-assets/direct-file-adapter.js frontend/scripts/sync-new-legacy.js frontend/scripts/direct-runtime.test.mjs frontend/e2e/full_role_regression.py frontend/public/new-legacy
git commit -m "fix: persist graph changes before navigation"
```

### Task 3: 图谱取消、摆放和重复关系

**Files:**
- Modify: `frontend/scripts/sync-new-legacy.js`
- Modify: `frontend/scripts/new-legacy-sync.test.mjs`
- Modify: `frontend/e2e/full_role_regression.py`

- [x] **Step 1: 写三个图谱行为失败测试**

测试取消新增后节点数不变；连续新增两个节点的 `(x,y)` 不相同；重复连接后关系数仍为 1。

```python
assert await page.locator('.knowledge-card').count() == before_cancel
assert first_box != second_box
assert await page.locator('[data-link-id]').count() == 1
```

- [x] **Step 2: 运行浏览器测试并确认三个断言失败**

Run: `cd frontend && python3 e2e/full_role_regression.py --group graph-interactions`  
Expected: FAIL，分别报告残留节点、相同坐标和关系数变 0。

- [x] **Step 3: 添加 fail-closed 图谱补丁**

同步器对 `10-graph-editor.js` 应用精确补丁：记录 `editingNodeIsNew`；取消时删除该 ID；创建点若与现有节点重叠则按 36px 阶梯偏移；`relationExists` 分支只提示并清除起点，不删除关系。每个原始锚点必须恰好出现一次。

```js
function replaceExactlyOnce(source, before, after, label) {
  if (source.split(before).length !== 2) throw new Error(`${label} 结构已变化`)
  return source.replace(before, after)
}
```

- [x] **Step 4: 运行同步器契约和图谱行为测试**

Run: `cd frontend && pnpm sync:new-legacy && node --test scripts/new-legacy-sync.test.mjs && python3 e2e/full_role_regression.py --group graph-interactions`  
Expected: 全部 PASS。

- [x] **Step 5: 提交图谱交互修复**

```bash
git add frontend/scripts/sync-new-legacy.js frontend/scripts/new-legacy-sync.test.mjs frontend/e2e/full_role_regression.py frontend/public/new-legacy
git commit -m "fix: preserve graph edits during node workflows"
```

### Task 4: 题库校验、跨页数据和训练遮挡

**Files:**
- Create: `frontend/scripts/new-legacy-assets/direct-question-adapter.js`
- Create: `frontend/scripts/new-legacy-assets/direct-runtime-fixes.css`
- Modify: `frontend/scripts/sync-new-legacy.js`
- Modify: `frontend/scripts/direct-runtime.test.mjs`
- Modify: `frontend/e2e/full_role_regression.py`

- [x] **Step 1: 写失败测试**

测试空题干/空选项保存被阻止；题库在新浏览器上下文仍存在；发布试卷能进入训练；深度回忆显示当前题；1440×1000 下快捷栏和主按钮边界不相交。

```python
assert await page.locator('text=未命名题目').count() == 0
assert custom_question in await page.locator('body').inner_text()
assert not boxes_intersect(shortcuts_box, action_box)
```

- [x] **Step 2: 运行测试并确认失败**

Run: `cd frontend && python3 e2e/full_role_regression.py --group questions`  
Expected: FAIL，至少包含空题保存或跨上下文数据缺失。

- [x] **Step 3: 实现题库提交前校验**

适配器在捕获阶段监听保存按钮，校验题干和至少两个非空选项；失败时 `preventDefault()`、`stopImmediatePropagation()`、聚焦首个错误字段并调用现有 toast。

```js
button.addEventListener('click', (event) => {
  const options = [...document.querySelectorAll('#qbOptionsEditor [data-option-text]')]
  if (!stem.value.trim() || options.filter(item => item.value.trim()).length < 2) {
    event.preventDefault()
    event.stopImmediatePropagation()
    global.showStatus?.('请填写题干和至少两个非空选项。')
  }
}, true)
```

- [x] **Step 4: 注入训练安全区样式**

所有页面注入项目 CSS；训练页在快捷栏可见时为其设置不覆盖主工作区的定位和响应式折叠规则，保持上游配色、圆角和控件结构。

```css
@media (max-height: 1050px) {
  .question-training-app .global-shortcuts { bottom: 16px; transform: none; }
}
```

- [x] **Step 5: 运行前端和浏览器测试**

Run: `cd frontend && pnpm sync:new-legacy && pnpm test && python3 e2e/full_role_regression.py --group questions`  
Expected: 全部 PASS。

- [x] **Step 6: 提交题库与训练修复**

```bash
git add frontend/scripts/new-legacy-assets/direct-question-adapter.js frontend/scripts/new-legacy-assets/direct-runtime-fixes.css frontend/scripts/sync-new-legacy.js frontend/scripts/direct-runtime.test.mjs frontend/e2e/full_role_regression.py frontend/public/new-legacy
git commit -m "fix: validate questions and preserve cross-page flow"
```

### Task 5: 非学生订阅入口

**Files:**
- Modify: `frontend/scripts/new-legacy-assets/direct-entry.js`
- Modify: `frontend/scripts/direct-runtime.test.mjs`
- Modify: `frontend/e2e/full_role_regression.py`

- [x] **Step 1: 写角色矩阵失败测试**

admin/teacher/viewer 访问 `/member` 不出现套餐选择，student 出现套餐选择。

```python
assert plan_cards == (role == 'student')
```

- [x] **Step 2: 运行测试并确认非学生失败**

Run: `cd frontend && python3 e2e/full_role_regression.py --group member`  
Expected: FAIL，非学生仍显示套餐卡。

- [x] **Step 3: 按角色打开会员界面**

读取 bootstrap 的 `authUser.role`；student 调用 `openSubscriptionDetail`，其余角色调用用户中心摘要并隐藏升级按钮，显示上游已有的免订阅/游客描述。

```js
if (role === 'student') global.KGUserCenter?.openSubscriptionDetail?.()
else global.KGUserCenter?.open?.()
```

- [x] **Step 4: 运行矩阵并提交**

Run: `cd frontend && pnpm test && python3 e2e/full_role_regression.py --group member`  
Expected: 四种角色断言全部 PASS。

```bash
git add frontend/scripts/new-legacy-assets/direct-entry.js frontend/scripts/direct-runtime.test.mjs frontend/e2e/full_role_regression.py frontend/public/new-legacy
git commit -m "fix: keep non-students outside subscription plans"
```

### Task 6: 用户复制与安全导入凭据

**Files:**
- Modify: `backend/app/schemas/user.py`
- Modify: `backend/app/api/v1/users.py`
- Modify: `backend/app/services/user_service.py`
- Modify: `backend/tests/test_smoke.py`
- Modify: `frontend/scripts/new-legacy-assets/direct-admin-adapter.js`
- Modify: `frontend/scripts/direct-runtime.test.mjs`

- [x] **Step 1: 写后端失败测试**

复制用户显示名必须增加“副本”；导入缺少 `initial_password` 返回 422；带初始密码导入后可以登录；导出仍不含密码或哈希。

```python
assert duplicate.json()["user"]["display_name"] == "测试用户 副本"
assert client.post("/api/v1/users/import", json={"users": records}).status_code == 422
assert client.post("/api/v1/auth/login", json={"username": name, "password": "112233"}).status_code == 200
```

- [x] **Step 2: 运行测试并确认失败**

Run: `cd backend && .venv/bin/python -m pytest tests/test_smoke.py -q`  
Expected: FAIL，显示名无后缀或导入 schema 未校验密码。

- [x] **Step 3: 实现类型化导入 schema 和服务逻辑**

新增 `UserImport`，包含 `users: list[dict]` 与 `initial_password: str = Field(min_length=4, max_length=128)`；服务使用 `hash_password(initial_password)`，导出保持无凭据。

```python
class UserImport(BaseModel):
    users: list[dict]
    initial_password: str = Field(min_length=4, max_length=128)
```

- [x] **Step 4: 实现管理员导入提示**

直接管理适配器在导入前通过原页面交互请求初始密码；取消则返回明确失败且不发请求，成功 payload 包含 `initial_password`，成功结果提示该密码用途。

```js
const initialPassword = global.prompt('请设置本次导入账号的统一初始密码（至少 4 位）：', '')
if (initialPassword == null) return { ok: false, code: 'IMPORT_CANCELLED', message: '已取消导入。' }
```

- [x] **Step 5: 运行后端和前端测试并提交**

Run: `cd backend && .venv/bin/python -m pytest tests/test_smoke.py -q && cd ../frontend && pnpm test`  
Expected: 全部 PASS。

```bash
git add backend/app/schemas/user.py backend/app/api/v1/users.py backend/app/services/user_service.py backend/tests/test_smoke.py frontend/scripts/new-legacy-assets/direct-admin-adapter.js frontend/scripts/direct-runtime.test.mjs frontend/public/new-legacy
git commit -m "fix: restore imported account login safely"
```

### Task 7: 系统设置归一化 API

**Files:**
- Create: `frontend/scripts/new-legacy-assets/direct-system-adapter.js`
- Modify: `frontend/scripts/sync-new-legacy.js`
- Modify: `frontend/scripts/direct-runtime.test.mjs`
- Modify: `backend/tests/test_smoke.py`
- Modify: `frontend/e2e/full_role_regression.py`

- [x] **Step 1: 写网络与持久化失败测试**

管理员打开设置页必须读取 themes、wechat-config、wechat-pay-config、subscription-plans；保存主题和配置必须调用对应 PUT，刷新后值一致。

```python
assert '/api/v1/system/themes' in requested_urls
assert '/api/v1/system/wechat-config' in requested_urls
assert '/api/v1/system/subscription-plans' in requested_urls
```

- [x] **Step 2: 运行测试并确认没有 system API 请求**

Run: `cd frontend && python3 e2e/full_role_regression.py --group settings`  
Expected: FAIL，网络日志只出现 runtime state。

- [x] **Step 3: 实现系统适配器**

适配器使用同步 XHR 在上游 `36-system-settings.js` 执行前加载归一化配置并写入运行时镜像；包装 `saveTheme`、`saveConfig` 和套餐保存方法，专用 API 成功后才更新原运行时对象，失败抛出并由页面原提示捕获。

```js
const response = request('PUT', `/api/v1/system/themes/${encodeURIComponent(role)}`, {
  primary_color: theme.primary,
  accent_color: theme.accent,
  soft_color: theme.soft,
})
if (!response.ok) throw new Error(response.message)
return originalSaveTheme(role, theme)
```

- [x] **Step 4: 运行 system API 和浏览器测试并提交**

Run: `cd backend && .venv/bin/python -m pytest tests/test_smoke.py -q && cd ../frontend && pnpm sync:new-legacy && python3 e2e/full_role_regression.py --group settings`  
Expected: 全部 PASS。

```bash
git add frontend/scripts/new-legacy-assets/direct-system-adapter.js frontend/scripts/sync-new-legacy.js frontend/scripts/direct-runtime.test.mjs backend/tests/test_smoke.py frontend/e2e/full_role_regression.py frontend/public/new-legacy
git commit -m "fix: normalize direct system settings persistence"
```

### Task 8: 旧架构文案与升级失败保护

**Files:**
- Modify: `frontend/scripts/sync-new-legacy.js`
- Modify: `frontend/scripts/new-legacy-sync.test.mjs`
- Modify: `frontend/scripts/design-contract.test.mjs`

- [x] **Step 1: 写文案和锚点失败测试**

生成页面不得包含“本浏览器 localStorage”“后续接入服务器”“纯前端版本暂未接入支付”；fixture 删除一个原文锚点时同步必须失败且输出文件名。

```js
for (const stale of ['本浏览器 localStorage', '后续接入服务器', '纯前端版本暂未接入支付']) {
  assert.doesNotMatch(generatedSite, new RegExp(stale))
}
```

- [x] **Step 2: 运行同步测试并确认失败**

Run: `cd frontend && node --test scripts/new-legacy-sync.test.mjs scripts/design-contract.test.mjs`  
Expected: FAIL，旧文案仍存在。

- [x] **Step 3: 实现精确文案补丁**

为指定 HTML/JS 文件登记 `{before, after}`，仅当原文恰好出现一次时替换；缺失或重复均抛出结构变化错误。新文案说明服务器同步、管理员配置支付和学习数据清理规则。

- [x] **Step 4: 运行前端测试并提交**

Run: `cd frontend && pnpm sync:new-legacy && pnpm test`  
Expected: 全部 PASS。

```bash
git add frontend/scripts/sync-new-legacy.js frontend/scripts/new-legacy-sync.test.mjs frontend/scripts/design-contract.test.mjs frontend/public/new-legacy
git commit -m "fix: align generated copy with server architecture"
```

### Task 9: 全量回归、发布重建与问题闭环

**Files:**
- Modify: `frontend/e2e/full_role_regression.py`
- Modify: `docs/功能测试问题记录-2026-07-21.md`
- Modify: `docs/new-legacy-updates.md`
- Regenerate: `frontend/public/new-legacy/**`
- Regenerate: `frontend/new-legacy-releases/v8.6.0/site/**`

- [x] **Step 1: 运行全部自动测试**

Run: `cd backend && .venv/bin/python -m pytest tests/ -q`  
Expected: 全部 PASS。

Run: `cd frontend && pnpm test && pnpm build`  
Expected: 全部 PASS，同步可重复。

- [x] **Step 2: 重建当前 v8.6.0 发布站点**

使用同步器在临时目录生成，校验后更新当前 release 的 site 和 adapterHash；不得修改 release 的上游 source 或 sourceHash。

Run: `node frontend/scripts/manage-new-legacy.js inspect new-legacy`  
Expected: 输出 `version: v8.6.0` 且 sourceHash 与当前 release 一致。

- [x] **Step 3: 运行五角色浏览器回归**

Run: `cd frontend && python3 e2e/full_role_regression.py --group all --base-url http://127.0.0.1:5173`  
Expected: 15 项缺陷用例及既有关键路径全部 PASS，无 pageerror、HTTP 5xx 和越权成功。

- [x] **Step 4: 演练更新与回滚**

在 `mktemp -d` 的隔离 release root 运行 inspect、update、同版本冲突、rollback；候选失败时 `current.json` 不变。

- [x] **Step 5: 更新问题记录和升级文档**

把 15 项标记为已修复，记录测试命令、结果、截图路径及仍受外部服务限制的范围；更新新版 `new-legacy` 导入步骤和失败回滚说明。

- [x] **Step 6: 检查工作树并提交闭环**

Run: `git diff --check && git status --short`  
Expected: 只有本计划涉及文件和用户原有 `.superpowers/` 未跟踪目录；`new-legacy/` 无差异。

```bash
git add frontend/e2e/full_role_regression.py frontend/public/new-legacy frontend/new-legacy-releases/v8.6.0/site docs/功能测试问题记录-2026-07-21.md docs/new-legacy-updates.md
git commit -m "test: close full-role regression findings"
```
