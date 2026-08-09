# Content Prep Database Integration Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 将 Content Prep Studio 作为受保护的 `/content-prep` 页面纳入正式发布，使上传成功的题目在同一事务中进入 PostgreSQL 正式题库，并让教师端和学习端通过统一题目目录 API 读取。

**Architecture:** PostgreSQL 的关系表是题库、题目、原则、归纳卡和标签配置的唯一正式数据源；`/api/v1/question-catalog` 负责按 owner、协作者、公开范围和学习资格读取，`/api/v1/content-prep` 负责题库创建、单题锁、单题保存和整包幂等上传。Prep Studio 继续使用 IndexedDB 保存本地草稿，但服务器同步信息只作为本地元数据。`new-legacy` 页面通过异步目录适配层把 API 结果放入页面内存，迁移后禁止正式题库键继续写入 Runtime State。

**Tech Stack:** FastAPI、Pydantic、SQLAlchemy async、PostgreSQL、Alembic、pytest、原生 JavaScript/HTML/CSS、IndexedDB、Node.js 测试、Playwright、现有 new-legacy release manager。

## Global Constraints

- 已批准设计是 [`docs/superpowers/specs/2026-08-09-content-prep-database-integration-design.md`](../specs/2026-08-09-content-prep-database-integration-design.md)；实现不得重新引入 Runtime State/关系表双写。
- 不修改被忽略的 `enterinformation/`；它只作为 v0.4.0 来源材料和验收基线。正式源码位于 `new-legacy/content-prep-studio/`。
- 保留 Prep Studio 原布局、六位固定制作人、IndexedDB、本地自动保存、JSON 导入导出、帮助中心和离线新题制作。
- Prep 页面和 API 都必须验证登录和 `accessQuestionBank`、`importData`、`editQuestions`；题库写权限还要验证 owner/协作者，不能仅用前端按钮控制。
- 新 Prep 题目使用客户端生成的 UUID；迁移得到的历史非 UUID ID 原样保留；已存在题目 ID 不允许移动题库。
- 上传成功立即进入目标题库；同一批次中的题库、题目、原则、归纳卡、标签配置、锁释放、批次和审计必须一次提交或全部回滚。
- 同题只能由一个客户端编辑；不同题可以并行。锁心跳 30 秒、租约 5 分钟、管理员可强制释放，revision 继续作为第二道并发保护。
- 新增服务方法不得在事务内部自行 `commit`；事务边界由 API 用例服务统一控制。事务成功后需要返回 ORM 对象时先 `await db.refresh(obj)`，避免 async `MissingGreenlet`。
- 保留现有 `/api/v1/banks`、`/api/v1/questions/*`、`/api/v1/papers` 兼容路由，内部委托新服务，避免一次切换破坏现有 React/测试调用方。
- 知识树和科目联想库仍由现有管理端发布；本功能只读取当前正式内容做引用校验，不新增第二套管理表。
- 不直接编辑 `frontend/public/new-legacy/`、`frontend/new-legacy-releases/*/site` 或 active release。生成和发布只能走 sync/release manager。
- 当前工作树包含大量用户未提交改动。每个提交只暂存本任务列出的文件；禁止使用 `git add .`、`git reset --hard` 或覆盖用户文件。
- 每个行为先写失败测试并确认 RED，再写生产代码；每一阶段都运行列出的回归测试。

---

### Task 1: 建立正式题目目录数据库模型

**Files:**
- Modify: `backend/app/models/question.py`
- Create: `backend/app/models/content_prep.py`
- Modify: `backend/app/models/__init__.py`
- Create: `backend/alembic/versions/a91c4d7e2f60_content_prep_catalog.py`
- Create: `backend/tests/test_content_prep_models.py`

**Interfaces:**
- Extends: `QuestionBank.revision`, `created_by`, `updated_by`
- Extends: `Question.teacher_number`, `scope`, `content_hash`, `creator_id`, `creator_name`, `created_by`, `updated_by`, `revision`, `translations`, `metadata`, `key_path`, `lifecycle`
- Creates: `QuestionBankCollaborator`, `Principle`, `SynthesisPreset`, `QuestionTagConfig`, `QuestionEditLock`, `QuestionUploadBatch`, `QuestionAuditLog`
- Migration parent: `down_revision = "3545e387bfac"`

- [x] **Step 1: 写模型契约失败测试**

```python
def test_content_prep_tables_are_registered():
    expected = {
        "question_bank_collaborators", "principles", "synthesis_presets",
        "question_tag_configs", "question_edit_locks",
        "question_upload_batches", "question_audit_logs",
    }
    assert expected <= set(Base.metadata.tables)

def test_question_has_server_sync_columns():
    columns = set(Base.metadata.tables["questions"].columns.keys())
    assert {"scope", "content_hash", "creator_id", "creator_name", "revision",
            "translations", "metadata", "key_path", "lifecycle"} <= columns
```

- [x] **Step 2: 运行 RED 测试**

Run: `cd backend && .venv/bin/python -m pytest tests/test_content_prep_models.py -q`

Expected: FAIL，因为新表和字段尚未注册。

- [x] **Step 3: 实现 SQLAlchemy 模型**

使用以下数据库约束：

```text
question_bank_collaborators: UNIQUE(bank_id, username), permission IN ('view','edit')
questions.scope: CHECK scope IN ('public','internal'), default 'internal'
questions.revision: integer, default 1, not null
question_upload_batches: UNIQUE(actor_username, idempotency_key)
question_upload_batches.status: CHECK status IN ('pending','committed','rolled_back')
question_edit_locks.question_id: primary key and FK questions.id ON DELETE CASCADE
question_tag_configs: partial UNIQUE index WHERE active IS TRUE
```

历史行的 `content_hash` 在 schema migration 中允许为空，Task 9 的内容迁移会计算并补齐；所有新建/更新服务必须写入非空 SHA-256。`created_by`、`updated_by` 对历史数据允许为空，新写入必须设置。

- [x] **Step 4: 编写可逆 Alembic migration**

迁移中创建索引：

```text
ix_questions_bank_scope_lifecycle on (bank_id, scope)
ix_questions_content_hash on (content_hash)
ix_question_upload_batches_actor_created on (actor_username, created_at)
ix_question_audit_logs_entity_created on (entity_type, entity_id, created_at)
```

`downgrade()` 先删除外键表和索引，再删除新增列；不删除原有题库、题目和试卷数据。

- [x] **Step 5: 运行模型与 migration 检查**

Run: `cd backend && .venv/bin/python -m pytest tests/test_content_prep_models.py -q && .venv/bin/alembic heads`

Expected: PASS，且唯一 head 为 `a91c4d7e2f60`。

- [x] **Step 6: 提交本任务**

```bash
git add backend/app/models/question.py backend/app/models/content_prep.py backend/app/models/__init__.py backend/alembic/versions/a91c4d7e2f60_content_prep_catalog.py backend/tests/test_content_prep_models.py
git commit -m "feat: add content prep catalog schema"
```

### Task 2: 增加能力权限与题库 owner/协作者策略

**Files:**
- Modify: `backend/app/core/auth.py`
- Create: `backend/app/services/question_access_service.py`
- Create: `backend/tests/test_content_prep_permissions.py`

**Interfaces:**
- Produces: `require_permissions(*permission_names: str)` FastAPI dependency
- Produces: `optional_current_user(request, db) -> User | None` for public learning catalog reads
- Produces: `question_access_service.can_view_bank(db, user, bank) -> bool`
- Produces: `question_access_service.can_edit_bank(db, user, bank) -> bool`
- Produces: `question_access_service.require_bank_access(db, user, bank_id, *, edit: bool) -> QuestionBank`

- [x] **Step 1: 写权限失败测试**

覆盖：admin 可写所有题库；teacher 可写自己的题库；teacher 有 `edit` collaborator 时可写；只有 `view` 时不可写；student/viewer 拒绝；缺少三个能力中任一项时依赖返回 403。

- [x] **Step 2: 运行 RED 测试**

Run: `cd backend && .venv/bin/python -m pytest tests/test_content_prep_permissions.py -q`

Expected: FAIL，因为能力依赖和协作者服务不存在。

- [x] **Step 3: 实现能力依赖**

```python
def require_permissions(*permission_names: str) -> Callable:
    async def dependency(user: Annotated[User, Depends(get_current_user)]) -> User:
        missing = [name for name in permission_names if not can(user.role, name)]
        if missing:
            raise HTTPException(403, detail={
                "code": "PERMISSION_DENIED",
                "message": "当前账号缺少所需权限",
                "permissions": missing,
            })
        return user
    return dependency
```

- [x] **Step 4: 实现题库访问策略**

管理员绕过 owner；owner 拥有 view/edit；协作者按 `view`/`edit`；其他账号只能在学习查询中看到 `published` 题库，不获得管理权限。所有查询按 `bank_id` 精确锁定，不能先返回对象再由前端过滤。

- [x] **Step 5: 运行 GREEN 和认证回归**

Run: `cd backend && .venv/bin/python -m pytest tests/test_content_prep_permissions.py tests/test_smoke.py -q`

Expected: PASS。

- [x] **Step 6: 提交本任务**

```bash
git add backend/app/core/auth.py backend/app/services/question_access_service.py backend/tests/test_content_prep_permissions.py
git commit -m "feat: enforce content prep permissions"
```

### Task 3: 定义统一题目 DTO、规范化与服务器内容哈希

**Files:**
- Create: `backend/app/schemas/question_catalog.py`
- Create: `backend/app/schemas/content_prep.py`
- Create: `backend/app/services/question_content_service.py`
- Create: `backend/tests/test_question_content_service.py`

**Interfaces:**
- Produces: `normalize_scope(payload: dict) -> Literal['public','internal']`
- Produces: `normalize_question_payload(payload: dict, *, subject: str) -> dict`
- Produces: `canonical_question_hash(payload: dict) -> str`
- Produces: Pydantic DTOs `QuestionPayload`, `QuestionSyncItem`, `ContentPrepBatchRequest`, `ContentPrepBatchResult`, `LockGrant`, `CatalogError`

- [x] **Step 1: 写字段往返、范围映射和哈希失败测试**

测试完整 v0.4.0 题目可保留 `translations`、`metadata.knowledge`、`metadata.principleIds`、`metadata.optionPrincipleMap`、`metadata.tagPaths`、`keyPath`、`lifecycle` 及所有现有 JSONB 字段；测试“可公开”映射 public、“内部使用”映射 internal、两者同时出现时 internal、缺失时 internal。

```python
def test_hash_ignores_server_fields_but_changes_with_content():
    a = full_question_payload()
    b = {**a, "revision": 99, "contentHash": "forged"}
    assert canonical_question_hash(a) == canonical_question_hash(b)
    b["analysis"] = "changed"
    assert canonical_question_hash(a) != canonical_question_hash(b)
```

- [x] **Step 2: 运行 RED 测试**

Run: `cd backend && .venv/bin/python -m pytest tests/test_question_content_service.py -q`

Expected: FAIL，因为 DTO 和规范化函数不存在。

- [x] **Step 3: 实现 DTO 与稳定错误结构**

`ContentPrepBatchRequest` 使用 aliases：`idempotencyKey`、`clientInstanceId`、`targetBankId`、`creatorId`、`prepVersion`、`workspaceVersion`、`synthesisPresets`、`tagConfig`。`QuestionSyncItem` 包含 `question`、`baseRevision`、`lockToken`。错误统一为：

```json
{
  "code": "QUESTION_VALIDATION_FAILED",
  "message": "题目内容校验失败",
  "batchId": null,
  "issues": [{"questionId":"...","field":"options","code":"CORRECT_ANSWER_MISSING","message":"..."}]
}
```

- [x] **Step 4: 实现规范化和哈希**

哈希输入必须删除 `contentHash`、`revision`、`serverRevision`、`serverContentHash`、`lastSyncedAt`、锁字段和服务器时间；递归按键排序，用紧凑 UTF-8 JSON 计算 SHA-256。客户端提交的 `creatorName`、`contentHash` 和 actor 字段一律忽略。

- [x] **Step 5: 运行 GREEN**

Run: `cd backend && .venv/bin/python -m pytest tests/test_question_content_service.py -q`

Expected: PASS。

- [x] **Step 6: 提交本任务**

```bash
git add backend/app/schemas/question_catalog.py backend/app/schemas/content_prep.py backend/app/services/question_content_service.py backend/tests/test_question_content_service.py
git commit -m "feat: define canonical question payloads"
```

### Task 4: 实现统一读取目录和学习端可见性

**Files:**
- Create: `backend/app/services/question_catalog_service.py`
- Create: `backend/app/api/v1/question_catalog.py`
- Modify: `backend/app/api/v1/router.py`
- Create: `backend/tests/test_question_catalog.py`

**Interfaces:**
- Produces: `GET /api/v1/question-catalog/banks?mode=writable|managed`
- Produces: `GET /api/v1/question-catalog/banks/{bank_id}/questions?page=1&page_size=20`
- Produces: `GET /api/v1/question-catalog/questions/{question_id}`
- Produces: `GET /api/v1/question-catalog/bootstrap?mode=managed|learning&subject=PMP`
- Produces: `GET /api/v1/question-catalog/learning/questions?subject=&bank_id=&paper_id=&page=&page_size=`
- Produces: `question_catalog_service.question_to_payload(question) -> dict`

- [x] **Step 1: 写目录 API 失败测试**

覆盖 owner、edit collaborator、view collaborator、admin、student、viewer；分页总数；完整字段往返；私有题库优先；公开题库内 public/internal 混合；deleted lifecycle 排除。

```python
def test_learning_query_applies_both_visibility_rules(client, seeded_catalog):
    response = client.get("/api/v1/question-catalog/learning/questions?subject=PMP")
    ids = {row["id"] for row in response.json()["questions"]}
    assert ids == {seeded_catalog.published_public_active_id}
```

- [x] **Step 2: 运行 RED 测试**

Run: `cd backend && .venv/bin/python -m pytest tests/test_question_catalog.py -q`

Expected: FAIL，因为目录路由不存在。

- [x] **Step 3: 实现服务端过滤和序列化**

`mode=writable` 只返回 owner、edit collaborator 或 admin；`mode=managed` 也包含 view collaborator。学习查询使用数据库 WHERE 条件：

```python
QuestionBank.visibility == "published"
Question.scope == "public"
or_(
    Question.lifecycle == {},
    Question.lifecycle["status"].astext.is_(None),
    Question.lifecycle["status"].astext == "active",
)
```

兼容缺失 lifecycle 的历史行时以 active 处理；明确 deleted 必须排除。`paper_id` 查询通过 `PaperQuestion`/`ExamPaper` join，并继续验证试卷 status 和调用方访问策略。`bootstrap` 一次返回页面初始化所需的 banks/questions，并提供 `catalogRevision`（最大 bank/question revision 与更新时间的稳定摘要），但不得写浏览器持久化。

- [x] **Step 4: 实现路由与 OpenAPI DTO**

管理接口要求 `accessQuestionBank`；学习接口使用 `optional_current_user`，只返回公开过滤结果，保留当前匿名预览/登录后学习入口；登录用户的试卷和订阅策略继续在公开过滤结果之上裁剪。所有输出使用 camelCase。

- [x] **Step 5: 运行 GREEN 和 SQL 查询回归**

Run: `cd backend && .venv/bin/python -m pytest tests/test_question_catalog.py tests/test_smoke.py -q`

Expected: PASS。

- [x] **Step 6: 提交本任务**

```bash
git add backend/app/services/question_catalog_service.py backend/app/api/v1/question_catalog.py backend/app/api/v1/router.py backend/tests/test_question_catalog.py
git commit -m "feat: add unified question catalog api"
```

### Task 5: 实现题库创建和内容引用校验

**Files:**
- Create: `backend/app/services/content_reference_service.py`
- Create: `backend/app/services/content_prep_service.py`
- Create: `backend/app/api/v1/content_prep.py`
- Modify: `backend/app/api/v1/router.py`
- Create: `backend/tests/test_content_prep_banks_and_refs.py`

**Interfaces:**
- Produces: `POST /api/v1/content-prep/banks`
- Produces: `content_reference_service.validate_question_references(db, actor_username, subject, payload) -> list[Issue]`
- Produces: `content_prep_service.create_bank(db, actor, body) -> QuestionBank`
- Constant: `CREATORS = {'creator_001':'波塞冬', ..., 'creator_006':'女帝'}`

- [x] **Step 1: 写创建题库、制作人和引用校验失败测试**

测试未知 creatorId 返回 422；teacher 创建题库成为 owner；admin 创建时仍记录 actor；`metadata.knowledge.primaryNodeId`、`relatedNodeIds`、clue `recallNodeId` 不存在时返回定位字段的 issue；上传内容中同时 upsert 的 principle ID 可被引用。

- [x] **Step 2: 运行 RED 测试**

Run: `cd backend && .venv/bin/python -m pytest tests/test_content_prep_banks_and_refs.py -q`

Expected: FAIL。

- [x] **Step 3: 实现题库创建**

服务器生成 `b_<uuid hex>` 题库 ID，规范 visibility 为 `private|published`，写入 `created_by/updated_by/revision=1`。响应：

```json
{"bank":{"id":"b_...","name":"...","subject":"PMP","visibility":"private","revision":1}}
```

- [x] **Step 4: 实现现有正式内容引用读取**

知识树从 `SharedRuntimeState.key == 'kg_content_taxonomies_v1'` 读取当前发布项；科目联想库从当前发布者的 `RuntimeState.storage['kg_recall_association_library_v1__subject__<SUBJECT>']` 读取。校验服务只读现有数据，不更新知识树或联想库；结构损坏时返回 `REFERENCE_CATALOG_UNAVAILABLE`，不能静默放过伪造引用。

- [x] **Step 5: 运行 GREEN**

Run: `cd backend && .venv/bin/python -m pytest tests/test_content_prep_banks_and_refs.py -q`

Expected: PASS。

- [x] **Step 6: 提交本任务**

```bash
git add backend/app/services/content_reference_service.py backend/app/services/content_prep_service.py backend/app/api/v1/content_prep.py backend/app/api/v1/router.py backend/tests/test_content_prep_banks_and_refs.py
git commit -m "feat: create prep banks and validate references"
```

### Task 6: 实现数据库级单题编辑锁

**Files:**
- Create: `backend/app/services/question_lock_service.py`
- Modify: `backend/app/api/v1/content_prep.py`
- Create: `backend/tests/test_question_edit_locks.py`

**Interfaces:**
- Produces: `POST /api/v1/content-prep/locks/{question_id}`
- Produces: `PUT /api/v1/content-prep/locks/{question_id}/heartbeat`
- Produces: `DELETE /api/v1/content-prep/locks/{question_id}`
- Produces: `DELETE /api/v1/content-prep/locks/{question_id}/force`
- Produces: `acquire_lock`, `heartbeat_lock`, `release_lock`, `assert_lock_and_revision`
- Lease: 300 seconds; client heartbeat: 30 seconds

- [x] **Step 1: 写锁行为失败测试**

覆盖首次获取、同账号同 client 幂等重取、其他账号 409、同题库不同题同时成功、过期接管、错误 token、心跳续期、主动释放、非 admin 强制释放 403、admin 强制释放、旧 token 保存 409、revision 不一致 409。Prep 请求必须提交 allowlist creatorId；现有教师编辑器可沿用题目已有 creatorId，历史题为空时允许 null，但 actor 审计不能缺失。

- [x] **Step 2: 运行 RED 测试**

Run: `cd backend && .venv/bin/python -m pytest tests/test_question_edit_locks.py -q`

Expected: FAIL。

- [x] **Step 3: 实现原子获取和令牌摘要**

使用 `select(QuestionEditLock).where(...).with_for_update()` 和数据库事务串行化同一 `question_id`。生成 256-bit 随机 token，只存 `sha256(token)`；返回明文一次。锁响应固定包含：

```json
{
  "questionId":"...", "lockToken":"...", "lockedBy":"teacher",
  "creatorId":"creator_001", "creatorName":"波塞冬",
  "clientInstanceId":"...", "acquiredAt":"...", "expiresAt":"...",
  "heartbeatIntervalSeconds":30, "leaseSeconds":300
}
```

- [x] **Step 4: 实现心跳、释放和 revision 断言**

过期判断只使用服务器 UTC；强制解锁写 `question_audit_logs`；普通释放要求 token、actor 和 clientInstanceId 都匹配。任何锁冲突返回稳定 `LOCKED_BY_OTHER` 或 `LOCK_TOKEN_INVALID` 错误码。

- [x] **Step 5: 运行并发 GREEN 测试**

Run: `cd backend && .venv/bin/python -m pytest tests/test_question_edit_locks.py -q`

Expected: PASS。

- [x] **Step 6: 提交本任务**

```bash
git add backend/app/services/question_lock_service.py backend/app/api/v1/content_prep.py backend/tests/test_question_edit_locks.py
git commit -m "feat: add per-question edit leases"
```

### Task 7: 实现单题保存与整包事务化幂等上传

**Files:**
- Modify: `backend/app/services/content_prep_service.py`
- Modify: `backend/app/api/v1/content_prep.py`
- Create: `backend/tests/test_content_prep_upload.py`
- Create: `backend/tests/test_content_prep_transactions.py`

**Interfaces:**
- Produces: `PUT /api/v1/content-prep/questions/{question_id}`
- Produces: `POST /api/v1/content-prep/batches`
- Produces: `GET /api/v1/content-prep/batches/{batch_id}`
- Produces: `upload_bundle(db, actor, request) -> ContentPrepBatchResult`
- Produces: `record_failed_batch(db, actor, request, error) -> None`

- [x] **Step 1: 写新增/更新/跳过和幂等失败测试**

测试：新 UUID created；同 ID/同服务器 hash skipped；同 ID/变化内容且锁+revision 正确 updated；同 ID 位于另一题库返回 `QUESTION_BANK_MOVE_FORBIDDEN`；重复 actor+idempotencyKey+同 manifest 返回原结果；相同键不同 manifest 返回 `IDEMPOTENCY_PAYLOAD_CONFLICT`。

- [x] **Step 2: 写事务回滚失败测试**

构造两题批次，第一题合法、第二题引用不存在；断言题目、原则、归纳卡、标签配置、成功审计都未写入，原编辑锁仍存在，且独立短事务只留下 `rolled_back` 批次摘要。

- [x] **Step 3: 运行 RED 测试**

Run: `cd backend && .venv/bin/python -m pytest tests/test_content_prep_upload.py tests/test_content_prep_transactions.py -q`

Expected: FAIL。

- [x] **Step 4: 实现事务用例**

在一个 `async with db.begin()` 中按以下顺序执行：权限和幂等检查 → 对 `actor_username + idempotency_key` 获取 PostgreSQL transaction advisory lock → `SELECT ... FOR UPDATE` 题库 → 规范化并 hash 题目 → 分类 created/updated/skipped → 只对 updated 校验锁和 base revision → 校验并 upsert principle/preset/tag config → 写题目 → 审计 → 删除 updated/skipped 题目的本客户端锁 → 批次 committed。新题不需要锁，hash 未变化的 skipped 题不要求先获得锁。所有内部 helper 只 `flush()`，不得 `commit()`。

- [x] **Step 5: 实现失败批次记录和响应**

主事务异常后先 rollback，再用新事务按 actor/idempotency key 写 `rolled_back`、manifest hash 和 issues 摘要。客户端网络重试同一已提交键返回原结果；已失败键返回原失败摘要，用户修改内容后必须生成新键。

- [x] **Step 6: 验证制作人和 actor 审计**

服务器只按 `CREATORS[creatorId]` 写 creatorName；`actor_username/actor_role` 来自 Session。测试客户端伪造 `creatorName`、`actorUsername` 和 `contentHash` 均不能污染数据库。

- [x] **Step 7: 运行 GREEN 与完整字段回归**

Run: `cd backend && .venv/bin/python -m pytest tests/test_content_prep_upload.py tests/test_content_prep_transactions.py tests/test_question_content_service.py -q`

Expected: PASS。

- [x] **Step 8: 提交本任务**

```bash
git add backend/app/services/content_prep_service.py backend/app/api/v1/content_prep.py backend/tests/test_content_prep_upload.py backend/tests/test_content_prep_transactions.py
git commit -m "feat: upload prep bundles transactionally"
```

### Task 8: 将现有题库 CRUD 委托给统一目录服务

**Files:**
- Modify: `backend/app/services/question_service.py`
- Modify: `backend/app/api/v1/questions.py`
- Modify: `backend/tests/test_smoke.py`
- Create: `backend/tests/test_question_api_compatibility.py`

**Interfaces:**
- Preserves: existing `/api/v1/banks`, `/api/v1/banks/{id}/questions`, `/api/v1/questions/{id}`, `/api/v1/papers`
- Delegates: bank/question authorization, serialization, scope normalization and hash generation to new services

- [x] **Step 1: 写兼容失败测试**

旧端点必须保持现有 envelope 和状态码；旧 `POST /banks/{id}/questions` 可由服务器生成 `q_...` ID，但也要填 `scope=internal`、revision、hash、actor；旧 update 必须递增 revision，且不能丢失新增 JSONB 字段。

- [x] **Step 2: 运行 RED 测试**

Run: `cd backend && .venv/bin/python -m pytest tests/test_question_api_compatibility.py tests/test_smoke.py -q`

Expected: 新字段和访问策略断言 FAIL，原 smoke 继续反映现有兼容基线。

- [x] **Step 3: 重构为兼容包装器**

保留公开函数名，内部调用 `question_catalog_service`、`question_access_service` 和 `question_content_service`。旧 CRUD 可以保留一次请求一次 commit，但不得被 Task 7 的批处理事务调用。

- [x] **Step 4: 运行 GREEN**

Run: `cd backend && .venv/bin/python -m pytest tests/test_question_api_compatibility.py tests/test_smoke.py -q`

Expected: PASS。

- [x] **Step 5: 提交本任务**

```bash
git add backend/app/services/question_service.py backend/app/api/v1/questions.py backend/tests/test_smoke.py backend/tests/test_question_api_compatibility.py
git commit -m "refactor: route question crud through catalog"
```

### Task 9: 编写 Runtime State 到正式目录的可重复迁移

**Files:**
- Create: `backend/app/services/question_migration_service.py`
- Create: `backend/scripts/migrate_runtime_questions.py`
- Create: `backend/tests/test_question_runtime_migration.py`

**Interfaces:**
- Produces: `scan_runtime_question_sources(db) -> MigrationReport`
- Produces: `migrate_runtime_questions(db, *, apply: bool) -> MigrationReport`
- CLI: `backend/scripts/migrate_runtime_questions.py [--apply] [--report PATH]`
- Sources: current relational rows, `RuntimeState.storage['kg_question_banks_v1__*']`, `SharedRuntimeState['kg_question_banks_published_v1']`

- [x] **Step 1: 写 dry-run、冲突和重跑失败测试**

覆盖同 ID/同 hash 合并；同 ID/不同 hash 阻止 apply；私有 owner 保留；共享 published bank 保留发布状态；历史非 UUID ID 保留；重复执行不增加行；空/损坏 JSON 进入 issues 而不是跳过。

- [x] **Step 2: 运行 RED 测试**

Run: `cd backend && .venv/bin/python -m pytest tests/test_question_runtime_migration.py -q`

Expected: FAIL。

- [x] **Step 3: 实现只读快照和报告**

报告必须包含：`snapshotHash`、三类来源数量、bank/question 总数、public/internal 数、deduplicated 数、conflicts、invalidRecords、nullContentHashes、执行时间。默认不写数据库；只有 `--apply` 且 conflicts 为空时执行。

- [x] **Step 4: 实现 apply 和 hash 补齐**

迁移使用稳定 bank/question ID；关系表已有行先规范化并补 content hash；共享题库无明确 owner 时使用原 `publishedBy`，缺失时记为冲突，不能默认为当前运行账号。整个 apply 单事务，原 Runtime State 不删除。

- [x] **Step 5: 运行 GREEN 与本地 dry-run**

Run: `cd backend && .venv/bin/python -m pytest tests/test_question_runtime_migration.py -q && .venv/bin/python scripts/migrate_runtime_questions.py --report /tmp/content-prep-migration-dry-run.json`

Expected: 测试 PASS；CLI 不修改数据并生成 JSON 报告。若本地真实数据有 conflicts，只报告，不执行修复。

- [x] **Step 6: 提交本任务**

```bash
git add backend/app/services/question_migration_service.py backend/scripts/migrate_runtime_questions.py backend/tests/test_question_runtime_migration.py
git commit -m "feat: migrate runtime question catalogs"
```

### Task 10: 禁止 Runtime State 继续写正式题库主数据

**Files:**
- Modify: `backend/app/services/runtime_state_service.py`
- Modify: `backend/tests/test_runtime_shared_policy.py`
- Modify: `backend/tests/test_runtime_state.py`
- Modify: `frontend/scripts/new-legacy-contract.json`
- Modify: `frontend/scripts/sync-new-legacy.js`
- Modify: `frontend/scripts/direct-runtime.test.mjs`

**Interfaces:**
- Adds: `DEPRECATED_QUESTION_EXACT_KEYS`
- Adds: `DEPRECATED_QUESTION_PREFIXES`
- Adds: `QUESTION_CATALOG_CUTOVER_ENABLED` deployment setting, false during adapter rollout and true only after Task 18 migration verification
- Error: `RuntimeStatePermissionError('正式题库已迁移，请使用题目目录接口')`

- [x] **Step 1: 写拒绝写入失败测试**

精确拒绝 `kg_question_banks_published_v1`、`kg_principle_repository_v1`、`kg_synthesis_preset_repository_v1`、`kg_question_tag_names_v1` 及所有 `kg_question_banks_v1__*` mutation；继续允许训练进度、当前题目指针、布局和字体偏好。

- [x] **Step 2: 运行 RED 测试**

Run: `cd backend && .venv/bin/python -m pytest tests/test_runtime_shared_policy.py tests/test_runtime_state.py -q`

Expected: FAIL，因为正式题库键仍可写。

- [x] **Step 3: 实现 cutover 写保护**

在 `apply_update()` 权限判断前检查显式 mutations。实现阶段通过 `QUESTION_CATALOG_CUTOVER_ENABLED` 保护：本任务先实现并测试开启后的拒绝行为，Tasks 14–16 完成前部署配置保持 false；Task 18 迁移校验通过后设置 true，最终系统不存在双写。读取旧键暂时保留给回滚和迁移验证；`private_runtime_storage()` 不把旧题库作为目录 API 的输入。原则、归纳卡和标签配置改由专用 API 写入后，也禁止原共享键更新。

- [x] **Step 4: 更新前端存储合同**

从可写 runtime 合同中移除正式题库键/前缀，但在 `legacyReadOnlyKeys` 中登记；同步扫描器允许这些字面量只读出现，却拒绝新增写调用。合同测试应断言 catalog adapter 不调用 `localStorage.setItem()` 写这些键。

- [x] **Step 5: 运行 GREEN**

Run: `cd backend && .venv/bin/python -m pytest tests/test_runtime_shared_policy.py tests/test_runtime_state.py -q && cd ../frontend && node --test scripts/direct-runtime.test.mjs`

Expected: PASS。

- [x] **Step 6: 提交本任务**

```bash
git add backend/app/services/runtime_state_service.py backend/tests/test_runtime_shared_policy.py backend/tests/test_runtime_state.py frontend/scripts/new-legacy-contract.json frontend/scripts/sync-new-legacy.js frontend/scripts/direct-runtime.test.mjs
git commit -m "feat: make question catalog server authoritative"
```

### Task 11: 将 Prep Studio 模块化源码纳入正式 new-legacy source

**Files:**
- Create: `new-legacy/content-prep-studio/README.md`
- Create: `new-legacy/content-prep-studio/build.py`
- Create: `new-legacy/content-prep-studio/src/index.template.html`
- Create: `new-legacy/content-prep-studio/src/css/app.css`
- Create: `new-legacy/content-prep-studio/src/js/00-core-bootstrap.js`
- Create: `new-legacy/content-prep-studio/src/js/10-state-domain.js`
- Create: `new-legacy/content-prep-studio/src/js/20-page-runtime.js`
- Create: `new-legacy/content-prep-studio/src/js/30-service-layer.js`
- Create: `new-legacy/content-prep-studio/src/js/40-events-bootstrap.js`
- Create: `new-legacy/content-prep-studio/src/tag-slot-schema.json`
- Create: `new-legacy/content-prep-studio/tests/test_build.py`
- Create: `new-legacy/content-prep-studio/tests/test_services.py`
- Create: `new-legacy/content-prep-studio/tests/test_tag_migration.js`
- Create: `new-legacy/content-prep-studio/dist/content-prep.html`
- Modify: `frontend/scripts/new-legacy-contract.json`
- Modify: `frontend/scripts/new-legacy-release.test.mjs`

**Interfaces:**
- Build: `python3 new-legacy/content-prep-studio/build.py`
- Output: `new-legacy/content-prep-studio/dist/content-prep.html`
- Page marker: `<script src="/server-state-bootstrap.js"></script>` must appear in built output for backend bootstrap injection and direct nested-page loading

- [x] **Step 1: 从 source zip 原样提取模块化基线到正式目录**

只复制 `PMP_Content_Prep_Studio_v0.4.0_source.zip` 中的模块化源码、测试和 README；把默认 dist 文件名改为 `content-prep.html`。不要复制根目录单 HTML 作为新的维护源。

- [x] **Step 2: 写 release 合同失败测试**

合同必须要求 `content-prep-studio/dist/content-prep.html`、模块化源和测试存在；built output 包含 `PMPPrepServices`、六位 creator ID、IndexedDB 工作区和 bootstrap marker；构建不能修改 `enterinformation/`。

- [x] **Step 3: 运行 RED/基线测试**

Run: `python3 new-legacy/content-prep-studio/tests/test_services.py && python3 new-legacy/content-prep-studio/tests/test_build.py && node new-legacy/content-prep-studio/tests/test_tag_migration.js && cd frontend && node --test scripts/new-legacy-release.test.mjs`

Expected: Prep 原测试 PASS；release 合同先因 required file/marker 未登记而 FAIL。

- [x] **Step 4: 在模板中加入后端 bootstrap marker 并更新 build**

使用根绝对资源 `/server-state-bootstrap.js`，避免直接访问 nested HTML 时解析到不存在的 `content-prep-studio/dist/server-state-bootstrap.js`。Task 17 同步扩展后端 bootstrap 注入器识别根绝对 marker。页面其余 CSS/JS 仍自包含；IndexedDB 不改为 Runtime State。

- [x] **Step 5: 运行 GREEN 和可重复构建**

Run: `python3 new-legacy/content-prep-studio/build.py && python3 new-legacy/content-prep-studio/tests/test_build.py && cd frontend && node --test scripts/new-legacy-release.test.mjs`

Expected: PASS，连续构建的 dist 字节一致。

- [x] **Step 6: 提交本任务**

```bash
git add new-legacy/content-prep-studio frontend/scripts/new-legacy-contract.json frontend/scripts/new-legacy-release.test.mjs
git commit -m "feat: add content prep studio source"
```

### Task 12: 在 Prep Studio 增加服务器题库与上传客户端

**Files:**
- Modify: `new-legacy/content-prep-studio/src/index.template.html`
- Modify: `new-legacy/content-prep-studio/src/css/app.css`
- Modify: `new-legacy/content-prep-studio/src/js/10-state-domain.js`
- Modify: `new-legacy/content-prep-studio/src/js/30-service-layer.js`
- Create: `new-legacy/content-prep-studio/src/js/35-server-catalog-service.js`
- Create: `new-legacy/content-prep-studio/src/js/45-server-events.js`
- Modify: `new-legacy/content-prep-studio/build.py`
- Create: `new-legacy/content-prep-studio/tests/test_server_catalog.js`
- Create: `new-legacy/content-prep-studio/tests/test_server_ui_contract.py`

**Interfaces:**
- Produces: `PMPPrepServices.ServerCatalogService`
- Methods: `listWritableBanks`, `createBank`, `loadQuestion`, `uploadBundle`, `getBatch`, `syncMetadata`
- Workspace metadata: `serverBankId`, `serverBankRevision`, `clientInstanceId`, `lastIdempotencyKey`, `lastBatchId`
- Per-question metadata: `serverRevision`, `serverContentHash`, `lastSyncedAt`

- [x] **Step 1: 写客户端映射和 UI 失败测试**

测试相对 API URL、`credentials:'include'`、401/403/409/422 错误映射、相同网络重试复用 idempotency key、成功后才更新同步元数据。UI 合同要求页面显示登录账号、制作人、服务器状态、目标题库选择、新建题库、从服务器载入和“同步到题库”按钮。

- [x] **Step 2: 运行 RED 测试**

Run: `node new-legacy/content-prep-studio/tests/test_server_catalog.js && python3 new-legacy/content-prep-studio/tests/test_server_ui_contract.py`

Expected: FAIL。

- [x] **Step 3: 扩展工作区迁移**

`WorkspaceService.migrate()` 为旧 IndexedDB payload 补服务器元数据但不改变题目内容。`clientInstanceId` 首次生成后永久保存在当前本地工作区；切换制作人不能改变它。

- [x] **Step 4: 实现 API client 和服务器面板**

页面从 `window.__KG_DIRECT_BOOTSTRAP__` 显示真实 actor；未知/未登录状态禁止服务器按钮但不删除本地草稿。上传 payload 由 `ExportService.completeBundle()` 生成，再附加 target bank、base revisions、lock tokens 和 workspace 元数据。

- [x] **Step 5: 实现成功/失败状态规则**

只有 HTTP 2xx 且响应 `status == 'committed'` 才显示“已进入题库”并写 `serverRevision/serverContentHash/lastSyncedAt`。任何失败保留 IndexedDB，显示稳定错误和 issues，不清空编辑内容。

- [x] **Step 6: 更新 JS_ORDER 并运行 GREEN**

`JS_ORDER` 固定为 `00,10,20,30,35,40,45`，保证服务在事件绑定前可用。

Run: `node new-legacy/content-prep-studio/tests/test_server_catalog.js && python3 new-legacy/content-prep-studio/tests/test_server_ui_contract.py && python3 new-legacy/content-prep-studio/tests/test_build.py`

Expected: PASS。

- [x] **Step 7: 提交本任务**

```bash
git add new-legacy/content-prep-studio
git commit -m "feat: connect prep studio to question api"
```

### Task 13: 在 Prep Studio 接入单题锁和离线冲突恢复

**Files:**
- Modify: `new-legacy/content-prep-studio/src/js/35-server-catalog-service.js`
- Modify: `new-legacy/content-prep-studio/src/js/45-server-events.js`
- Modify: `new-legacy/content-prep-studio/src/js/20-page-runtime.js`
- Modify: `new-legacy/content-prep-studio/src/css/app.css`
- Create: `new-legacy/content-prep-studio/tests/test_edit_lock_client.js`

**Interfaces:**
- Methods: `acquireLock`, `heartbeatLock`, `releaseLock`, `withStableIdempotencyKey`
- Events: `prep:lock-acquired`, `prep:lock-lost`, `prep:sync-committed`
- UI modes: `local-new`, `server-editable`, `server-readonly`, `offline-unsynced`, `conflict-copy-required`

- [x] **Step 1: 写计时器、只读和冲突失败测试**

使用 fake timers/fetch 测试：打开服务器题前先获锁；30 秒心跳；切题/关闭/取消释放；其他人锁定时只读；5 分钟租约由服务器响应决定；409 后旧页面不再调用保存；断网修改保存在 IndexedDB；恢复后重新确认锁。

- [x] **Step 2: 运行 RED 测试**

Run: `node new-legacy/content-prep-studio/tests/test_edit_lock_client.js`

Expected: FAIL。

- [x] **Step 3: 实现锁生命周期**

只有通过 catalog 拉取的已有题需要锁；本地未上传新题不需要锁。心跳失败一次显示不稳定状态，连续失败或服务器 409/403 进入只读/冲突状态。`beforeunload` 使用 `sendBeacon` 不可靠且 DELETE 带 token 困难，因此只做 best-effort `fetch(...,{keepalive:true})`；正确性由租约保证。

- [x] **Step 4: 实现“复制为新题”恢复路径**

锁丢失后的本地变更不能覆盖原题。用户可调用现有 `QuestionService.duplicatePayload()` 生成新 UUID，清除 server revision/hash/lock 元数据，保留内容和 parentQuestionId 来源，然后作为新题上传。

- [x] **Step 5: 运行 GREEN 与构建回归**

Run: `node new-legacy/content-prep-studio/tests/test_edit_lock_client.js && python3 new-legacy/content-prep-studio/tests/test_build.py`

Expected: PASS。

- [x] **Step 6: 提交本任务**

```bash
git add new-legacy/content-prep-studio
git commit -m "feat: enforce prep question edit locks"
```

### Task 14: 为 new-legacy 增加只驻留内存的题目目录适配层

**Files:**
- Create: `frontend/scripts/new-legacy-assets/question-catalog-adapter.js`
- Modify: `frontend/scripts/sync-new-legacy.js`
- Create: `frontend/scripts/question-catalog-adapter.test.mjs`
- Modify: `frontend/scripts/direct-runtime.test.mjs`

**Interfaces:**
- Produces: `window.KGQuestionCatalogAdapter.ready: Promise<void>`
- Produces: `snapshot()`, `banks()`, `bank(id)`, `question(id)`, `reload()`, `saveBank()`, `saveQuestion()`
- Produces: `acquireQuestionLock()`, `heartbeatQuestionLock()`, `releaseQuestionLock()` for the teacher editor
- Emits: `kg:question-catalog-ready`, `kg:question-catalog-changed`
- Invariant: no formal catalog payload is written to localStorage/Runtime State

- [x] **Step 1: 写适配器失败测试**

测试 managed/learning 页面选择正确 bootstrap mode；请求带 cookie；缓存仅为 module-scoped object；reload 替换快照；401 触发登录提示事件；409 保留旧快照；锁方法正确传 token/client instance；源码不存在题库 key 的 `setItem`。

- [x] **Step 2: 运行 RED 测试**

Run: `cd frontend && node --test scripts/question-catalog-adapter.test.mjs scripts/direct-runtime.test.mjs`

Expected: FAIL。

- [x] **Step 3: 实现异步启动屏障**

适配器在 defer 执行时立即请求 `/api/v1/question-catalog/bootstrap`，根据 `document.body.dataset.questionCatalogMode` 选择 managed/learning；页面初始化代码必须显式 await `ready`，不得使用同步 XHR。

- [x] **Step 4: 注入相关页面**

在 `question-bank.html`、`paper-management.html`、`question-training.html`、`question-workspace.html`、`knowledge-recall.html`、`practice-mode.html` 和首页需要题目函数的页面中，把适配器注入在 `59-published-paper-repository.js`/`60-question-bank.js`/`65-question-bank-admin.js` 之前。sync 脚本对每页使用精确 marker，脚本顺序变化时 fail closed。

- [x] **Step 5: 运行 GREEN**

Run: `cd frontend && node --test scripts/question-catalog-adapter.test.mjs scripts/direct-runtime.test.mjs`

Expected: PASS。

- [x] **Step 6: 提交本任务**

```bash
git add frontend/scripts/new-legacy-assets/question-catalog-adapter.js frontend/scripts/sync-new-legacy.js frontend/scripts/question-catalog-adapter.test.mjs frontend/scripts/direct-runtime.test.mjs
git commit -m "feat: add in-memory question catalog adapter"
```

### Task 15: 切换教师题库页面到目录 API

**Files:**
- Modify: `new-legacy/question-bank.html`
- Modify: `new-legacy/paper-management.html`
- Modify: `new-legacy/src/65-question-bank-admin.js`
- Modify: `frontend/scripts/new-legacy-assets/direct-question-adapter.js`
- Create: `new-legacy/tests/content-prep-question-bank-integration.test.js`
- Create: `frontend/e2e/content_prep_question_bank.py`

**Interfaces:**
- `loadBanks()` reads `KGQuestionCatalogAdapter.banks()` after `ready`
- `saveBanks()` is replaced by explicit API operations, not bulk Runtime State writes
- Existing-question edit acquires the same server lock and saves with `lockToken + baseRevision`
- Existing DOM/class names and current Focus/Vega teacher skin remain unchanged

- [x] **Step 1: 写教师页失败测试**

断言 `init()`/`initPaperManagementPage()` await catalog ready；新增/编辑题库和题目调用 adapter；选中已有题进入编辑前获取锁并开始 30 秒心跳；保存带 token/revision；切题/关闭释放；被锁时只读；原 `banksKey()` 只用于 migration fallback read；`saveBanks()` 不写正式题库 runtime key；现有 DOM 和样式链接未变化。

- [x] **Step 2: 运行 RED 测试**

Run: `node new-legacy/tests/content-prep-question-bank-integration.test.js`

Expected: FAIL。

- [x] **Step 3: 重构初始化和显式写操作**

把 `init` 改为 async，并在渲染前 await adapter。将保存题库、保存题目、发布可见性、删除/恢复等调用映射到专用目录/现有兼容 API；已有题保存调用 content-prep 单题端点并传锁 token/revision，沿用题目已有 creatorId（迁移历史题可为空，actor 仍完整审计）。API 成功后 reload 内存快照，失败时恢复编辑前 state 并显示后端错误。不要改变题库页面 DOM 骨架和 CSS class。

- [x] **Step 4: 保留试卷发布快照边界**

试卷发布仍可生成不可变 `questionSnapshots` 作为 release artifact，但候选题和当前可编辑题从 catalog API 获取。快照不是可编辑正式题目主数据，不回写题库。

- [x] **Step 5: 编写 Prep → 题库 E2E**

用 admin 登录，在 `/content-prep` 创建私有题库、上传一题，随后打开 `/question-bank?bankId=...&questionId=...`，断言无需 JSON 导入即可看到同一 ID、标题、制作人和 revision。

- [x] **Step 6: 运行 GREEN**

Run: `node new-legacy/tests/content-prep-question-bank-integration.test.js`

Expected: PASS。浏览器测试在 Task 18 候选 release 中运行。

- [x] **Step 7: 提交本任务**

```bash
git add new-legacy/question-bank.html new-legacy/paper-management.html new-legacy/src/65-question-bank-admin.js new-legacy/tests/content-prep-question-bank-integration.test.js frontend/scripts/new-legacy-assets/direct-question-adapter.js frontend/e2e/content_prep_question_bank.py
git commit -m "feat: read teacher questions from catalog"
```

### Task 16: 切换训练、工作区、回忆和练习页到目录 API

**Files:**
- Modify: `new-legacy/src/60-question-bank.js`
- Modify: `new-legacy/src/61-question-repository.js`
- Modify: `new-legacy/src/72-question-training-page.js`
- Modify: `new-legacy/src/77-multi-question-workspace.js`
- Modify: `new-legacy/src/86-knowledge-recall.js`
- Modify: `new-legacy/src/96-recall-question-source.js`
- Modify: `new-legacy/src/100-practice-mode.js`
- Create: `new-legacy/tests/question-catalog-learning-integration.test.js`

**Interfaces:**
- `qbLoadBanks()` reads adapter snapshot; no formal bank Runtime State fallback after cutover flag
- Page initializers await `KGQuestionCatalogAdapter.ready`
- Learning visibility remains server filtered; client role checks are defense-in-depth only
- Existing published paper snapshots remain immutable release inputs

- [x] **Step 1: 写学习页失败测试**

测试 public+active 可见；internal、private、deleted 不进入 banks/repository；目录未 ready 时不渲染错误示例题；API 失败显示不可用状态；发布试卷快照仍按 release ID 固定；页面不写正式目录键。

- [x] **Step 2: 运行 RED 测试**

Run: `node new-legacy/tests/question-catalog-learning-integration.test.js`

Expected: FAIL。

- [x] **Step 3: 切换 `60-question-bank.js` 数据源**

保留 `qbNormalizeBank/qbNormalizeQuestion` 和当前全局函数契约；`qbLoadBanks()` 从适配器内存快照构建 banks。只有显式 migration preview 模式可读取旧 runtime bank keys，正式页面默认禁用。

- [x] **Step 4: 为所有入口增加 ready barrier**

逐页修改 `DOMContentLoaded` initializer，使训练、工作区、回忆和 practice library 在目录加载完成后再建立当前题目/试卷上下文。不得用 setTimeout 猜测网络完成。

- [x] **Step 5: 运行 GREEN 和现有学习回归**

Run: `node new-legacy/tests/question-catalog-learning-integration.test.js && cd frontend && pnpm test`

Expected: PASS。

- [x] **Step 6: 提交本任务**

```bash
git add new-legacy/src/60-question-bank.js new-legacy/src/61-question-repository.js new-legacy/src/72-question-training-page.js new-legacy/src/77-multi-question-workspace.js new-legacy/src/86-knowledge-recall.js new-legacy/src/96-recall-question-source.js new-legacy/src/100-practice-mode.js new-legacy/tests/question-catalog-learning-integration.test.js
git commit -m "feat: read learning questions from catalog"
```

### Task 17: 增加 `/content-prep` 页面路由和双重访问保护

**Files:**
- Modify: `backend/app/web/bootstrap.py`
- Modify: `backend/app/web/html.py`
- Modify: `backend/app/web/routes.py`
- Modify: `backend/tests/test_web_page_access.py`
- Create: `backend/tests/test_content_prep_route.py`
- Modify: `frontend/e2e/new_legacy_smoke.py`

**Interfaces:**
- Stable route: `GET /content-prep`
- Active asset: `content-prep-studio/dist/content-prep.html`
- Namespace: `PAGE_NAMESPACES['content-prep.html'] = 'content-prep'`

- [x] **Step 1: 写路由失败测试**

匿名访问重定向到 `/login` 并保留 `next=/content-prep`；student/viewer 返回项目 403；teacher/admin 返回 200；响应包含 bootstrap actor、active release version 和 Prep 根节点；`inject_bootstrap()` 支持根绝对 `/server-state-bootstrap.js` marker；直接访问 nested HTML 和 preview 也不能绕过权限。

- [x] **Step 2: 运行 RED 测试**

Run: `cd backend && .venv/bin/python -m pytest tests/test_content_prep_route.py tests/test_web_page_access.py -q`

Expected: FAIL。

- [x] **Step 3: 实现稳定路由**

先扩展 `inject_bootstrap()` 同时识别现有 `./server-state-bootstrap.js` 和 Prep 的 `/server-state-bootstrap.js`，任一 marker 缺失仍 fail closed。`/content-prep` 先解析 session；未登录 redirect；登录后用三个 permission keys 全量校验；通过后调用 `html_response(_asset_or_404(release, 'content-prep-studio/dist/content-prep.html'), bootstrap)`。把 `content-prep.html` 加入 teaching page protection，防 catch-all/preview 绕过。

- [x] **Step 4: 扩展稳定别名 smoke**

在现有 routes loop 中加入 `('/content-prep', '#prepApp')`，并分别用 teacher、student context 验证允许/拒绝。

- [x] **Step 5: 运行 GREEN**

Run: `cd backend && .venv/bin/python -m pytest tests/test_content_prep_route.py tests/test_web_page_access.py -q`

Expected: PASS。

- [x] **Step 6: 提交本任务**

```bash
git add backend/app/web/bootstrap.py backend/app/web/html.py backend/app/web/routes.py backend/tests/test_web_page_access.py backend/tests/test_content_prep_route.py frontend/e2e/new_legacy_smoke.py
git commit -m "feat: serve protected content prep route"
```

### Task 18: 全链路、迁移和候选 release 验收

**Files:**
- Create: `frontend/e2e/content_prep_concurrency.py`
- Modify: `frontend/e2e/content_prep_question_bank.py`
- Modify: `frontend/scripts/validate-new-legacy-release.sh`
- Modify: `frontend/scripts/manage-new-legacy.js`
- Modify: `frontend/scripts/new-legacy-release.test.mjs`
- Modify: `frontend/scripts/new-legacy-contract.json`
- Test: all backend, Node, Prep, Playwright and release suites

**Interfaces:**
- E2E chain: Prep upload → catalog → teacher page → learning visibility
- Concurrency: two browser contexts, same question conflict, different questions allowed
- Release command: `node frontend/scripts/manage-new-legacy.js update new-legacy`

- [x] **Step 1: 完成权限和数据 E2E**

测试 admin/teacher 页面访问、student/viewer/guest 拒绝；六位制作人选择；已有题库选择；新题库创建；上传后 teacher 页面立即可见；published+public 学习可见，internal/private 不可见；JSON 导入导出和 IndexedDB reload 继续工作。

- [x] **Step 2: 完成并发/离线 E2E**

两个登录 context 同开一题：第一个获得锁，第二个只读；两人打开同题库不同题均可编辑；管理员 force unlock 后旧 token 保存 409；断网编辑保留 IndexedDB，恢复网络后重获锁或复制新题；重复网络请求不重复新增。

- [x] **Step 3: 把新测试加入发布门禁**

`validate-new-legacy-release.sh` 在启动 integrated server 前运行 Prep 的 Python/Node 单测；启动后运行 `content_prep_question_bank.py` 和 `content_prep_concurrency.py`。发布管理器在 promote 前比较 candidate site 与当前 active site 文件数，candidate 较少或缺少 `admin-console.html`、`question-bank.html`、`content-prep-studio/dist/content-prep.html` 时 fail closed。失败时保留 active release 不变并在 validation.json 写明命令和错误。

- [x] **Step 4: 运行完整自动测试**

Run:

```bash
cd backend && .venv/bin/python -m pytest tests/ -q
cd ../frontend && pnpm test
cd .. && python3 new-legacy/content-prep-studio/tests/test_services.py
python3 new-legacy/content-prep-studio/tests/test_build.py
node new-legacy/content-prep-studio/tests/test_tag_migration.js
node new-legacy/content-prep-studio/tests/test_server_catalog.js
node new-legacy/content-prep-studio/tests/test_edit_lock_client.js
```

Expected: 全部 PASS。

- [x] **Step 5: 对真实数据先 dry-run 再 apply**

Run:

```bash
cd backend
.venv/bin/python scripts/migrate_runtime_questions.py --report /tmp/content-prep-migration-before.json
```

Expected: `conflicts == []`、`invalidRecords == []`。只有报告无冲突并已保存数据库备份/Runtime State 快照后，运行：

2026-08-09 已按用户确认的序号规则解决 10 个 `BANK_OWNER_CONFLICT`：5 个内置题库各生成 `admin / 佩奇007 / 老师` 三条稳定映射，共 15 条。迁移前报告为 `/tmp/content-prep-migration-before.json`；完整 PostgreSQL 备份为 `/tmp/kg_graph_dev-before-content-prep.dump`（831 KB），`pg_restore -l` 校验通过。

```bash
.venv/bin/python scripts/migrate_runtime_questions.py --apply --report /tmp/content-prep-migration-after.json
```

apply 报告 `/tmp/content-prep-migration-after.json` 为 `applied == true`、零冲突、零无效记录。重复验证报告 `/tmp/content-prep-migration-verify.json` 为 237 个题库、285 道题、15 条映射、`nullContentHashes == 0`；数据库内 285 道题的存储 hash 与重新计算 hash 全部一致。PMP 三库为 `admin/2`、`佩奇007/27`、`老师/19`，名称和 ID 分别保留原值、增加 `（2）/-2`、增加 `（3）/-3`。Runtime State 原数据未回写或删除。

随后在目标部署配置中设置 `QUESTION_CATALOG_CUTOVER_ENABLED=true`，重新运行 Runtime State 拒写测试和教师/学习 E2E；出现冲突时停止，不猜测覆盖哪一版，也不启用 cutover。

- [ ] **Step 6: 构建候选 release 并核对文件数**

先读取 active pointer 和源文件数作为人工证据：

```bash
ACTIVE_VERSION=$(python3 -c 'import json; print(json.load(open("frontend/new-legacy-releases/current.json"))["version"])')
find "frontend/new-legacy-releases/$ACTIVE_VERSION/site" -type f | wc -l
find new-legacy -type f | wc -l
```

source 与 site 的生成文件不做直接等量比较；正式硬门禁由修改后的 release manager 比较“候选 site vs 当前 active site”。人工确认以下源文件存在：

```text
new-legacy/admin-console.html
new-legacy/question-bank.html
new-legacy/content-prep-studio/dist/content-prep.html
```

然后使用一个未存在的新版本号更新 `new-legacy/VERSION`，执行：

```bash
node frontend/scripts/manage-new-legacy.js update new-legacy
```

不得用 `--skip-browser` 完成本功能的最终发布。

- [ ] **Step 7: 预览验收再确认 active pointer**

确认 candidate site 文件数不低于发布前 active；检查 `/content-prep`、`/question-bank`、`/training`、`/workspace`、`/recall`；读取 `frontend/new-legacy-releases/current.json` 确认只有自动验收通过后才指向新版本。

- [x] **Step 8: 提交测试和门禁**

```bash
git add frontend/e2e/content_prep_concurrency.py frontend/e2e/content_prep_question_bank.py frontend/scripts/validate-new-legacy-release.sh frontend/scripts/manage-new-legacy.js frontend/scripts/new-legacy-release.test.mjs frontend/scripts/new-legacy-contract.json new-legacy/VERSION
git commit -m "test: gate content prep catalog release"
```

## Self-Review

- Spec coverage: `/content-prep` 路由、登录/三能力权限、六位制作人、owner/协作者、立即入库、幂等 upsert、全事务、公开/internal 组合、完整字段、原则/归纳卡/标签、引用校验、IndexedDB、数据库拉取、单题锁、revision、Runtime State cutover、迁移、new-legacy 教师/学习适配和发布门禁均有对应任务。
- Error coverage: 401/403/404/409/422/503 都有稳定错误边界；失败上传保留草稿，事务失败不留下部分内容，管理员强制解锁后的旧 token 无法保存。
- Type consistency: `creatorId`、`clientInstanceId`、`targetBankId`、`baseRevision`、`lockToken`、`contentHash`、`serverRevision`、`serverContentHash`、`scope` 在 DTO、服务、API 和前端中名称一致。
- Data authority: 正式题库写路径只有专用关系表 API；页面内存缓存和纸卷 release snapshot 都不是可编辑主数据；旧 Runtime State 只读保留用于迁移/回滚验证。
- Placeholder scan: 未发现占位标记、未命名迁移或模糊的实现引用；所有新文件、接口、命令、错误规则和事务边界均已明确。
- Worktree safety: 所有提交命令均列出精确文件，没有 `git add .`，不会把当前工作树中的其他用户改动一并提交。
