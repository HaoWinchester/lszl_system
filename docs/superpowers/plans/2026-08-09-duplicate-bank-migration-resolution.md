# Duplicate Question Bank Migration Resolution Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 将真实 Runtime State 中同一题库 ID 的跨 owner 冲突确定性映射为带序号的题库名称和新题库 ID，完成无损迁移、cutover 与正式候选版本验收。

**Architecture:** 迁移服务先把同一 `(owner, old_bank_id)` 的多来源记录归并为一个逻辑题库，再对同一 `old_bank_id` 的跨 owner 组规划稳定映射。关系表中已经存在的版本优先保留原 ID，其他版本使用 `-2`、`-3`；同名时名称同步加 `（2）`、`（3）`。映射只作用于迁移快照和关系表目标，不改 Runtime State；重复运行通过识别已生成的关系表目标复用同一映射。

**Tech Stack:** Python 3.11、FastAPI、SQLAlchemy async、PostgreSQL、Pydantic、pytest、Node.js、Playwright、现有 new-legacy release manager。

## Global Constraints

- 只处理同一原题库 ID 的跨 owner 冲突；已经拥有不同 ID 的普通同名题库不重命名。
- 当前数据排序结果固定为 `admin`、`佩奇007`、`老师`；第一份保留原 ID，后续使用 `-2`、`-3`。
- 题库同名比较使用去除首尾空白后的精确文本；同名后缀使用全角括号 `（N）`。
- 题目 ID 原样保留，只更新题目的 `bank_id`；发现题目 ID 内容冲突时继续 fail closed。
- 新题库 ID 最长 64 字符，直接后缀冲突或超长时使用确定性短哈希回退。
- 迁移不回写或删除 Runtime State；apply 前必须保存 PostgreSQL 完整备份。
- 未达到 `conflicts == []`、`invalidRecords == []`、`nullContentHashes == 0` 且重复 dry-run 数量稳定前，不启用 cutover、不切换 active release。
- 工作区存在其他用户改动；每次只精确暂存本计划列出的文件，禁止 `git add .`。

---

### Task 1: 为跨 owner 题库映射建立失败测试

**Files:**
- Modify: `backend/tests/test_question_runtime_migration.py`

**Interfaces:**
- Consumes: `scan_runtime_question_sources(db, owner_ids=None, bank_ids=None) -> MigrationReport`
- Consumes: `migrate_runtime_questions(db, apply: bool, owner_ids=None, bank_ids=None) -> MigrationReport`
- Produces: 关于 `MigrationReport.bank_mappings`、题库名称/ID、题目 `bank_id` 和重复执行的回归约束

- [x] **Step 1: 新增三 owner 同 ID、同名称的迁移测试**

测试创建三个用户；关系表已有 `shared-bank` 属于第一个用户，另两个用户的 Runtime State 各保存同 ID、同名称、不同题目 ID。断言 dry-run：

```python
assert report.conflicts == []
assert [item.new_bank_id for item in report.bank_mappings] == [
    shared_bank_id,
    f"{shared_bank_id}-2",
    f"{shared_bank_id}-3",
]
assert [item.new_name for item in report.bank_mappings] == [
    "同名题库",
    "同名题库（2）",
    "同名题库（3）",
]
```

apply 后断言三个题库均存在、owner 正确，三个题目的 `bank_id` 分别指向映射 ID。再次 dry-run/apply，断言映射不变、题库数和题目数不增长。

- [x] **Step 2: 新增不同名称与 ID 回退测试**

同一原 ID 的两个 owner 使用不同名称，断言第二个只改 ID、不改名称。另预占 `shared-bank-2`，断言映射使用不超过 64 字符且包含序号与确定性哈希的备用 ID；两次 dry-run 结果完全相同。

- [x] **Step 3: 新增普通同名题库不重映射测试**

两个 owner 的题库名称相同但原 ID 不同，断言名称和 ID 均保持不变，避免把现有 `pytest题库` 等普通同名数据纳入本次冲突修复。

- [x] **Step 4: 运行 RED 测试**

Run: `cd backend && .venv/bin/python -m pytest tests/test_question_runtime_migration.py -q`

Expected: FAIL，原因是 `MigrationReport` 尚无 `bankMappings`，现有逻辑仍返回 `BANK_OWNER_CONFLICT`。

### Task 2: 实现确定性题库映射与报告

**Files:**
- Modify: `backend/app/services/question_migration_service.py`
- Test: `backend/tests/test_question_runtime_migration.py`

**Interfaces:**
- Produces: `BankMigrationMapping(BaseModel)`，别名字段 `ownerId/oldBankId/newBankId/oldName/newName/ordinal`
- Produces: `MigrationReport.bank_mappings: list[BankMigrationMapping]`，JSON 别名 `bankMappings`
- Produces: `_plan_bank_mappings(records, user_ids) -> _BankMappingPlan`
- Produces: `_mapped_bank_id(old_id, owner_id, ordinal, occupied_ids) -> str`

- [x] **Step 1: 增加映射 DTO 和内部结构**

新增：

```python
class BankMigrationMapping(BaseModel):
    model_config = ConfigDict(populate_by_name=True)
    owner_id: str = Field(alias="ownerId")
    old_bank_id: str = Field(alias="oldBankId")
    new_bank_id: str = Field(alias="newBankId")
    old_name: str = Field(alias="oldName")
    new_name: str = Field(alias="newName")
    ordinal: int

class MigrationReport(BaseModel):
    bank_mappings: list[BankMigrationMapping] = Field(default_factory=list, alias="bankMappings")
```

内部 plan 保存 `(owner_id, old_bank_id)` 到映射的查找表、需要吸收的已迁移关系表目标，以及报告顺序。

- [x] **Step 2: 实现稳定 ID 分配**

优先尝试 `f"{old_id}-{ordinal}"`。若超过 64 字符或已被其他逻辑题库占用，计算：

```python
digest = hashlib.sha256(f"{old_id}\0{owner_id}\0{ordinal}".encode()).hexdigest()[:8]
suffix = f"-{ordinal}-{digest}"
candidate = f"{old_id[:64 - len(suffix)]}{suffix}"
```

若短哈希候选仍被占用，按 12、16、20 位哈希扩展后重试；不得覆盖不同 owner 的已有题库。

- [x] **Step 3: 实现跨 owner 冲突组规划**

先把记录按 `(owner_id, old_bank_id)` 归并，名称优先级为 `relational > runtimeState > sharedPublished`。只对同一 `old_bank_id` 出现多个 owner 的组排序；关系表记录优先，其余按 `(owner_id, source, old_bank_id)`。第一项 ordinal 为 1，保留 ID；后续分配新 ID。同名比较用 `name.strip()`，同名项生成 `f"{base_name}（{ordinal}）"`。

- [x] **Step 4: 识别已迁移目标保证幂等**

若关系表已存在预期的 `new_bank_id`，且 owner、预期名称均匹配，则把该关系表记录吸收到原 `(owner, old_bank_id)` 映射，不把它视为新逻辑题库；若 ID 已存在但 owner 或名称不匹配，则走哈希备用 ID。这样保留 Runtime State 快照的同时，apply 后再次扫描仍产生相同映射。

- [x] **Step 5: 在快照构建中应用映射**

构造 `_BankCandidate` 时使用 `mapping.new_bank_id/new_name`，构造 `_QuestionCandidate` 时使用相同 `new_bank_id`。删除同名 owner 冲突产生 `BANK_OWNER_CONFLICT` 的旧分支，但保留 `OWNER_NOT_FOUND`、`PUBLISHED_OWNER_MISSING`、题目内容冲突及所有结构校验。

- [x] **Step 6: 完善 apply 的元数据更新**

新建题库使用映射后的名称和 ID；已存在且 owner 相同的目标题库同步 `name/subject/description/version/visibility/revision`，owner 不匹配则在快照阶段阻止 apply。题目继续通过 `_assign_migrated_question()` 更新 `bank_id`，不改变题目 ID。

- [x] **Step 7: 运行 GREEN 与全后端回归**

Run: `cd backend && .venv/bin/python -m pytest tests/test_question_runtime_migration.py -q && .venv/bin/python -m pytest tests/ -q`

Expected: 全部 PASS。

- [x] **Step 8: 提交迁移实现**

```bash
git add backend/app/services/question_migration_service.py backend/tests/test_question_runtime_migration.py
git commit -m "fix: resolve duplicate bank migration identities"
```

### Task 3: 对真实数据执行 dry-run、备份和 apply

**Files:**
- Modify: `docs/superpowers/plans/2026-08-09-content-prep-database-integration.md`
- Output: `/tmp/content-prep-migration-before.json`
- Output: `/tmp/content-prep-migration-after.json`
- Output: `/tmp/kg_graph_dev-before-content-prep.dump`

**Interfaces:**
- Consumes: `backend/scripts/migrate_runtime_questions.py`
- Produces: 零冲突真实迁移报告、可恢复 PostgreSQL 备份和已补齐的题目 content hash

- [ ] **Step 1: 执行新的真实 dry-run**

Run: `cd backend && .venv/bin/python scripts/migrate_runtime_questions.py --report /tmp/content-prep-migration-before.json`

Expected: `conflicts == []`、`invalidRecords == []`；报告包含五组 `admin / 佩奇007 / 老师` 的稳定映射，PMP 映射为 `bank-pmp-demo`、`bank-pmp-demo-2`、`bank-pmp-demo-3`。

- [ ] **Step 2: 保存完整数据库备份**

Run: `pg_dump -h /tmp -d kg_graph_dev -Fc -f /tmp/kg_graph_dev-before-content-prep.dump`

随后运行 `pg_restore -l /tmp/kg_graph_dev-before-content-prep.dump >/dev/null`，Expected: 退出码 0。备份包含 Runtime State 原始快照，不另行改写源键。

- [ ] **Step 3: 执行 apply**

Run: `cd backend && .venv/bin/python scripts/migrate_runtime_questions.py --apply --report /tmp/content-prep-migration-after.json`

Expected: `applied == true`、`conflicts == []`、`invalidRecords == []`。

- [ ] **Step 4: 重复 dry-run 验证幂等和数据完整性**

再次 dry-run，核对 `bankMappings` 不变、正式题库与题目数量不增长、全部正式题目 `content_hash` 非空。用 SQL 抽查三个 PMP 题库 owner、名称、题目数分别为 `admin/2`、`佩奇007/27`、`老师/19`。

- [ ] **Step 5: 标记主计划迁移步骤完成**

在主计划 Task 18 Step 5 记录备份路径、报告路径、映射数量和验证结果，并把复选框改为完成。若任何预期不满足，停止，不设置 cutover、不发布。

### Task 4: 启用 cutover 并完成正式候选发布

**Files:**
- Modify: `new-legacy/VERSION`
- Modify: `docs/superpowers/plans/2026-08-09-content-prep-database-integration.md`

**Interfaces:**
- Consumes: `QUESTION_CATALOG_CUTOVER_ENABLED=true`
- Consumes: `node frontend/scripts/manage-new-legacy.js update new-legacy`
- Produces: 通过全量验证的新 active release

- [ ] **Step 1: 在 cutover 模式重跑拒写与端到端测试**

使用临时集成服务设置 `QUESTION_CATALOG_CUTOVER_ENABLED=true`，运行 Runtime State 正式题库拒写测试、教师题库 E2E、学习端 E2E 和 Content Prep 并发 E2E。Expected: 全部 PASS。

- [ ] **Step 2: 选择未使用的新版本号并核对发布输入**

读取 `frontend/new-legacy-releases/current.json` 和 `new-legacy/VERSION`，生成高于两者且未存在的补丁版本号。核对当前 active site 文件数、source 文件数及以下关键文件：

```text
new-legacy/admin-console.html
new-legacy/question-bank.html
new-legacy/content-prep-studio/dist/content-prep.html
```

- [ ] **Step 3: 使用正式发布管理器构建、验证并切换**

更新 `new-legacy/VERSION` 后运行：

```bash
node frontend/scripts/manage-new-legacy.js update new-legacy
```

不得使用 `--skip-browser`。Expected: 候选 site 文件数不低于发布前 active，完整验证脚本退出码 0，`current.json` 自动指向新版本。

- [ ] **Step 4: 发布后核验**

读取 active pointer 和 validation.json，验证 `/content-prep`、`/question-bank`、`/training`、`/workspace`、`/recall`；确认匿名、student/viewer、teacher/admin 权限矩阵保持正确，上传题目立即出现在教师目录，只有 published+public 进入学习端。

- [ ] **Step 5: 更新主计划并提交发布记录**

把主计划 Task 18 Steps 6–7 改为完成，精确提交 `new-legacy/VERSION` 与计划文档：

```bash
git add new-legacy/VERSION
git add -f docs/superpowers/plans/2026-08-09-content-prep-database-integration.md docs/superpowers/plans/2026-08-09-duplicate-bank-migration-resolution.md
git commit -m "release: activate content prep catalog integration"
```

## Self-Review

- Spec coverage: 覆盖跨 owner 同 ID、同名序号、ID 重映射、题目关联更新、普通同名不改、哈希回退、迁移报告、幂等复跑、备份、apply、cutover 和发布。
- Error coverage: owner/名称不匹配的已占 ID、题目 ID 内容冲突、无效记录、备份校验失败、候选文件回退和 E2E 失败均 fail closed。
- Type consistency: `bankMappings` 的 `ownerId/oldBankId/newBankId/oldName/newName/ordinal` 在 DTO、报告、测试和真实核对中一致。
- Placeholder scan: 无 TBD、TODO、模糊实现步骤或未定义接口。
- Scope: 不处理已经拥有不同 ID 的普通同名题库，不修改 Runtime State，不自动重编号题目。
- Worktree safety: 所有提交命令均精确列出文件，不包含其他用户改动。
