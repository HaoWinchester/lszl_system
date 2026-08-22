# 内置教学基础数据同步 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 将三份 PMP 基础 JSON 作为项目内置规范数据，服务启动时自动同步到 PostgreSQL，使新建任何试卷都无需重新上传知识树、科目级联想库、原则或归纳卡。

**Architecture:** 在 `backend/app/seed/builtin_teaching_content/` 保存原始 JSON，由新的 `builtin_teaching_content_seed_service` 校验并在教学内容全局事务锁内同步稳定 ID。数据库中的内置记录缺失或与文件不一致时创建/更新，完全一致时不写库；文件未声明的自定义记录保持不变。FastAPI 启动流程在数据库探活和默认账号初始化后调用同步服务，失败单独记录且不伪装为数据库断连。

**Tech Stack:** Python 3.12、FastAPI、SQLAlchemy async、PostgreSQL JSONB、pytest、Node/pnpm、Docker Compose、SSH/rsync

## Global Constraints

- 内置知识树必须包含 317 个节点，稳定 ID 为 `taxonomy-pmp-complete-v1`，归属 `subject-pmp`。
- 内置科目级联想库必须包含 471 个节点和 2840 条关系，稳定 ID 为 `recall-subject-pmp-builtin-v1`。
- 内置原则和归纳卡必须各 8 条，并保持一原则一卡。
- 三份项目 JSON 是内置稳定 ID 的规范来源；缺失自动恢复，文件更新自动同步。
- 只同步文件声明的稳定 ID，不删除或覆盖无关的自定义教学内容。
- 完全一致的重复启动不得新增记录、递增修订或制造重复审计。
- 业务数据只写 PostgreSQL；不得新增 `localStorage`、`sessionStorage`、IndexedDB 或前端静态持久化。
- 不修改 legacy 页面 DOM、className、CSS、文案、上传按钮或新建试卷默认配置。
- 保护当前工作区中用户的数据迁移改动；不得暂存、提交、还原或移动 `测试数据/`、`科目级联想库/`、`内置数据/`、`x1.png`、`.claude/` 和 `frontend/new-legacy-sync-report.json` 的既有变化，只有将三份源 JSON 机械复制到后端 seed 目录属于本功能。
- UAT 发布只使用 `bash deploy/update-uat.sh`，目标目录 `/home/ubuntu/lszl-kg-uat`、Compose project `lszl-kg-uat`、本机端口 `18087`；不得触碰正式项目 `lszl-kg` 或端口 `18086`。
- 发布候选 site 文件数不得少于当前 active site，并必须包含 `admin-console.html`、`practice-mode.html` 等关键页。

---

### Task 1: 固化三份内置资源并建立严格加载校验

**Files:**
- Create: `backend/app/seed/builtin_teaching_content/pmp_taxonomy_v8_6_2.json`
- Create: `backend/app/seed/builtin_teaching_content/pmp_recall_association_v9.json`
- Create: `backend/app/seed/builtin_teaching_content/pmp_principle_cards_v1.json`
- Create: `backend/app/services/builtin_teaching_content_seed_service.py`
- Create: `backend/tests/test_builtin_teaching_content_seed.py`

**Interfaces:**
- Consumes: 三份用户提供的 `内置数据/*.json`
- Produces: `load_builtin_bundle(seed_dir: Path = SEED_DIR) -> BuiltinTeachingBundle`
- Produces: `BuiltinSeedValidationError(ValueError)`

- [ ] **Step 1: 机械复制源 JSON 到后端 seed 目录**

创建目录后按以下一一映射复制，复制前后执行 SHA-256 对比；不得改写 JSON 内容：

```text
内置数据/PMPv8知识树_可导入包_v8.6.2.json
  -> backend/app/seed/builtin_teaching_content/pmp_taxonomy_v8_6_2.json
内置数据/PMP_科目级联想库_PMBOK8_6_V9.json
  -> backend/app/seed/builtin_teaching_content/pmp_recall_association_v9.json
内置数据/kg_principle_card_bundle_v1原则卡.json
  -> backend/app/seed/builtin_teaching_content/pmp_principle_cards_v1.json
```

- [ ] **Step 2: 写加载器失败测试**

在 `backend/tests/test_builtin_teaching_content_seed.py` 先写：

```python
from pathlib import Path

import pytest

from app.services import builtin_teaching_content_seed_service as seed_service


def test_real_builtin_bundle_has_the_approved_shape() -> None:
    bundle = seed_service.load_builtin_bundle()
    assert bundle.subject_id == "subject-pmp"
    assert bundle.taxonomy["id"] == "taxonomy-pmp-complete-v1"
    assert len(bundle.taxonomy["nodes"]) == 317
    assert len(bundle.recall_library["nodes"]) == 471
    assert len(bundle.recall_library["edges"]) == 2840
    assert len(bundle.principles) == 8
    assert len(bundle.synthesis_presets) == 8
    assert {row["id"] for row in bundle.principles} == {
        row["principleId"] for row in bundle.synthesis_presets
    }


def test_builtin_bundle_rejects_broken_cross_references(tmp_path: Path) -> None:
    write_test_bundle(tmp_path, broken_recall_edge=True)
    with pytest.raises(seed_service.BuiltinSeedValidationError, match="联想关系"):
        seed_service.load_builtin_bundle(tmp_path)
```

`write_test_bundle()` 只放在测试文件内作为 fixture/helper，不加入生产服务。先运行并确认因服务模块或接口不存在而失败。

Run:

```bash
cd backend && .venv/bin/python -m pytest tests/test_builtin_teaching_content_seed.py -q
```

Expected: FAIL，原因是 `builtin_teaching_content_seed_service` 或 `load_builtin_bundle` 尚不存在。

- [ ] **Step 3: 实现最小加载器和校验器**

生产接口采用以下形状：

```python
from dataclasses import dataclass
from pathlib import Path
from typing import Any

SEED_DIR = Path(__file__).parents[1] / "seed" / "builtin_teaching_content"


class BuiltinSeedValidationError(ValueError):
    pass


@dataclass(frozen=True)
class BuiltinTeachingBundle:
    subject_id: str
    taxonomy: dict[str, Any]
    recall_library: dict[str, Any]
    principles: tuple[dict[str, Any], ...]
    synthesis_presets: tuple[dict[str, Any], ...]


def load_builtin_bundle(seed_dir: Path = SEED_DIR) -> BuiltinTeachingBundle:
    """Parse all three files, validate IDs/counts/references, and return normalized data."""
```

校验必须独立检查：JSON 顶层类型、schema/format 版本、稳定 subject/taxonomy ID、唯一节点 ID、知识树父节点引用、联想边端点、8 个唯一原则 ID、8 个唯一卡片 ID、一原则一卡以及卡片引用的原则存在。期望数量使用显式常量，错误信息指出数据类别。

- [ ] **Step 4: 验证 GREEN 并做变异检查**

Run:

```bash
cd backend && .venv/bin/python -m pytest tests/test_builtin_teaching_content_seed.py -q
```

Expected: 两个测试 PASS。临时把一个联想 edge 的 `to` 改成不存在 ID 时第二个测试必须失败，恢复后重新 PASS。

- [ ] **Step 5: 提交资源与加载器**

```bash
git add backend/app/seed/builtin_teaching_content backend/app/services/builtin_teaching_content_seed_service.py backend/tests/test_builtin_teaching_content_seed.py
git commit -m "feat: package built-in PMP teaching data"
```

### Task 2: 在关系表中首次同步并保证重复执行幂等

**Files:**
- Modify: `backend/app/services/builtin_teaching_content_seed_service.py`
- Modify: `backend/tests/test_builtin_teaching_content_seed.py`

**Interfaces:**
- Consumes: `BuiltinTeachingBundle`
- Produces: `sync_builtin_teaching_content(db: AsyncSession, bundle: BuiltinTeachingBundle | None = None) -> BuiltinSeedSummary`
- Produces: `BuiltinSeedSummary(created: int, updated: int, unchanged: int, changes: tuple[dict[str, str], ...])`，三个计数只统计 taxonomy、recall、principle 和 preset 聚合记录，不把 subject 和 taxonomy node 行计入。

- [ ] **Step 1: 写首次同步与幂等失败测试**

测试先清理并快照仅属于内置稳定 ID 的记录，调用真实服务后断言：

```python
async def exercise() -> None:
    async with AsyncSessionLocal() as db:
        first = await seed_service.sync_builtin_teaching_content(db)
        assert first.created == 18  # 1 taxonomy + 1 recall + 8 principles + 8 cards
        assert first.updated == 0
        taxonomy = await db.get(ContentTaxonomy, "taxonomy-pmp-complete-v1")
        recall = await db.get(RecallAssociationLibrary, "recall-subject-pmp-builtin-v1")
        assert taxonomy is not None and taxonomy.status == "published"
        assert recall is not None and len(recall.nodes) == 471 and len(recall.edges) == 2840
        assert await db.scalar(select(func.count()).select_from(TaxonomyNode).where(
            TaxonomyNode.taxonomy_id == taxonomy.id
        )) == 317

        revision_before = await teaching_content_revision_service.current(db)
        second = await seed_service.sync_builtin_teaching_content(db)
        revision_after = await teaching_content_revision_service.current(db)
        assert second.created == 0 and second.updated == 0
        assert revision_after == revision_before
```

Run focused test and confirm FAIL because `sync_builtin_teaching_content` does not exist.

- [ ] **Step 2: 实现首次同步**

同步函数必须：

```python
async def sync_builtin_teaching_content(
    db: AsyncSession,
    bundle: BuiltinTeachingBundle | None = None,
) -> BuiltinSeedSummary:
    bundle = bundle or load_builtin_bundle()
    await teaching_content_revision_service.acquire_lock(db)
    # ensure subject-pmp
    # upsert stable taxonomy + 317 TaxonomyNode rows
    # upsert stable recall row
    # upsert 8 Principle + 8 SynthesisPreset rows
    # bump global content revision only when changes is non-empty
    # commit once; rollback and re-raise on any error
```

新建 taxonomy/recall 时先查询同科目已占用版本；源版本可用则使用源版本，否则使用 `max(version) + 1`。将源版本写入 `content_metadata["builtinSourceVersion"]`。内置 taxonomy 标题从中英文对象稳定提取中文，节点 `title` 同样使用中文字符串，完整原节点保留在 `record`。

- [ ] **Step 3: 实现无变化短路**

比较规范化后的数据库 payload 与 bundle；只有完全一致才计入 `unchanged`。taxonomy 节点按 `position` 排序比较，principle/preset 比较所有业务字段但不比较数据库时间戳和修订号。

- [ ] **Step 4: 验证 focused GREEN**

Run:

```bash
cd backend && .venv/bin/python -m pytest tests/test_builtin_teaching_content_seed.py -q
```

Expected: 首次同步和重复执行测试 PASS，第二次执行全局 revision 不变。

- [ ] **Step 5: 提交关系化同步**

```bash
git add backend/app/services/builtin_teaching_content_seed_service.py backend/tests/test_builtin_teaching_content_seed.py
git commit -m "feat: sync built-in teaching data idempotently"
```

### Task 3: 覆盖内置恢复、文件升级、冲突回滚和自定义内容保护

**Files:**
- Modify: `backend/app/services/builtin_teaching_content_seed_service.py`
- Modify: `backend/tests/test_builtin_teaching_content_seed.py`

**Interfaces:**
- Consumes: Task 2 的 `sync_builtin_teaching_content`
- Produces: 内置稳定 ID 的 canonical update/restore 行为

- [ ] **Step 1: 写 canonical 恢复失败测试**

```python
existing = await db.get(Principle, builtin_principle_id)
existing.name = "被改动的名称"
existing.revision = 7
await db.commit()
summary = await seed_service.sync_builtin_teaching_content(db)
await db.refresh(existing)
assert summary.updated >= 1
assert existing.name == expected_name_from_file
assert existing.revision == 8
```

再删除内置 recall 稳定 ID，重跑后断言同一稳定 ID 被恢复；先运行确认当前实现至少有一个断言失败。

- [ ] **Step 2: 写文件升级和自定义保护失败测试**

用 `dataclasses.replace(real_bundle, ...)` 创建只修改一条内置卡片正文的 bundle，同时创建不在 bundle 中的自定义 Principle/SynthesisPreset。同步后断言内置卡片更新且只递增一次 revision，自定义记录所有字段不变。

- [ ] **Step 3: 写版本占用和跨原则卡片冲突失败测试**

预先让自定义 taxonomy 占用版本 1，删除内置 taxonomy 后同步，断言内置 taxonomy 获得下一可用版本且自定义 taxonomy 保留。再让一个内置 preset ID 绑定错误原则，断言同步抛出 `BuiltinSeedValidationError` 或明确领域冲突，事务中其他拟更新内容全部回滚。

- [ ] **Step 4: 实现最小 canonical update 与原子回滚**

更新策略：

- taxonomy 内容不同时删除并按原顺序重建该稳定 taxonomy 的节点，不碰其他 taxonomy；
- recall 只更新稳定 ID 对应行；
- principle 内容变化时递增 `revision`；
- 同一原则已有不同 ID 卡片时复用现有主键并同步业务字段；
- preset ID 已绑定另一原则时在任何写入前报错；
- `changes` 非空时只调用一次 `teaching_content_revision_service.bump()`；
- 捕获异常后 `await db.rollback()` 并重新抛出。

- [ ] **Step 5: focused GREEN 与完整文件测试**

```bash
cd backend && .venv/bin/python -m pytest tests/test_builtin_teaching_content_seed.py -q
```

Expected: 首次、幂等、恢复、升级、自定义保护、版本冲突和回滚测试全部 PASS。

- [ ] **Step 6: 提交 canonical 行为**

```bash
git add backend/app/services/builtin_teaching_content_seed_service.py backend/tests/test_builtin_teaching_content_seed.py
git commit -m "feat: keep bundled teaching records canonical"
```

### Task 4: 接入 FastAPI 启动并验证现有 API/新建试卷读取链路

**Files:**
- Modify: `backend/app/main.py`
- Modify: `backend/tests/conftest.py`
- Modify: `backend/tests/test_builtin_teaching_content_seed.py`

**Interfaces:**
- Produces: `_seed_builtin_teaching_content() -> BuiltinSeedSummary | None`
- Consumes: `/api/v1/content-prep/shared-content?subjectId=PMP`

- [ ] **Step 1: 写启动失败隔离测试**

monkeypatch 同步服务抛出 `BuiltinSeedValidationError`，直接运行新的启动 wrapper，断言异常被记录但 `app.state.db_ok` 的数据库探活结果不被改成 false。再写正常 wrapper 测试，断言 summary 数量可记录且不会输出 JSON 正文。

- [ ] **Step 2: 写教师 API 集成失败测试**

```python
with TestClient(app) as client:
    assert client.post(
        "/api/v1/auth/login",
        json={"username": "老师", "password": "111111"},
    ).status_code == 200
    response = client.get(
        "/api/v1/content-prep/shared-content",
        params={"subjectId": "PMP"},
    )
    assert response.status_code == 200
    payload = response.json()
    assert payload["knowledgeTree"]["taxonomy"]["id"] == "taxonomy-pmp-complete-v1"
    assert len(payload["knowledgeTree"]["taxonomy"]["nodes"]) == 317
    assert len(payload["recallLibrary"]["nodes"]) == 471
    assert len(payload["recallLibrary"]["edges"]) == 2840
    assert len(payload["principles"]["items"]) >= 8
```

先运行确认失败原因是 lifespan 尚未调用内置同步。

- [ ] **Step 3: 接入独立启动 wrapper**

`backend/app/main.py` 使用独立异常边界：

```python
async def _seed_builtin_teaching_content() -> BuiltinSeedSummary | None:
    try:
        async with AsyncSessionLocal() as db:
            return await builtin_teaching_content_seed_service.sync_builtin_teaching_content(db)
    except Exception:
        logger.exception("Built-in teaching content sync failed")
        return None


# DB probe and account/guided course seeds remain in the DB connectivity try.
# Built-in content sync runs afterward in its own try/except and logs a warning on failure.
```

成功日志只记录 `created/updated/unchanged` 数量。`backend/tests/conftest.py` 在 `_seed_admin()` 后调用新 wrapper，使测试数据库基线与真实启动一致。

- [ ] **Step 4: focused GREEN**

```bash
cd backend && .venv/bin/python -m pytest tests/test_builtin_teaching_content_seed.py tests/test_content_prep_shared_content.py -q
```

Expected: 全部 PASS；若既有测试依赖空原则/空知识树，调整其 fixture 显式创建独立稳定 ID 或只断言自己创建的数据，不得删除新的产品基线断言。

- [ ] **Step 5: 提交启动与 API 集成**

```bash
git add backend/app/main.py backend/tests/conftest.py backend/tests/test_builtin_teaching_content_seed.py backend/tests/test_content_prep_shared_content.py
git commit -m "feat: load built-in teaching data at startup"
```

### Task 5: 全量验证、发布包完整性与发布提交

**Files:**
- Verify: `backend/Dockerfile`
- Verify/Generated: `new-legacy/VERSION`
- Verify/Generated: `frontend/public/new-legacy/`
- Verify/Generated: `frontend/new-legacy-releases/`
- Verify/Generated: `frontend/new-legacy-sync-report.json`

**Interfaces:**
- Consumes: Tasks 1–4 的实现提交
- Produces: 可部署且内容不回退的 UAT 候选提交

- [ ] **Step 1: 验证 Docker 会携带 seed**

确认 `backend/Dockerfile` 的 `COPY backend/ /app/backend/` 覆盖新目录；本地构建后在镜像或临时容器内检查三份文件存在并核对 SHA-256，不输出 JSON 内容。

- [ ] **Step 2: 运行后端全量测试**

```bash
cd backend && .venv/bin/python -m pytest tests/ -q
```

Expected: 记录精确通过/失败数量。任何由新基线引起的失败按 systematic debugging + TDD 修复；既有失败也必须如实列出，不能把部分通过报告为全绿。

- [ ] **Step 3: 运行前端契约、测试和类型检查**

```bash
cd frontend && pnpm test
cd frontend && pnpm exec tsc -b
```

Expected: 记录精确结果。已知基线曾为 191/194，若仍有 3 个既有失败，逐项核对与本功能无关并在部署报告中保留；不得删除或弱化测试。

- [ ] **Step 4: 核对源码没有新增浏览器业务持久化**

对本功能 diff 执行 `rg`，确认没有新增 `localStorage`、`sessionStorage`、`indexedDB`、前端 fixture 或上传动作；确认 legacy HTML/CSS/JS 零改动。

- [ ] **Step 5: 生成 release 并读取发布管理器完整性门禁**

运行 `deploy/update-uat.sh` 前先在隔离工作树生成并检查本地 release；发布管理器内部 `candidateSiteGate` 必须报告候选文件数不少于 active，且关键文件存在：

```bash
cd frontend
node scripts/sync-new-legacy.js
node scripts/manage-new-legacy.js update ../new-legacy
release_version="$(jq -r .version new-legacy-releases/current.json)"
node scripts/manage-new-legacy.js promote "$release_version"
test -f "new-legacy-releases/$release_version/site/admin-console.html"
test -f "new-legacy-releases/$release_version/site/practice-mode.html"
```

文件数异常立即停止，不 promote、不 rsync。若当前版本和内容已完全一致，允许管理器幂等复用该 release，不人为递增前端版本。

- [ ] **Step 6: 提交脚本生成的版本和 release 产物**

仅在上述命令确实生成 tracked diff 时暂存发布文件；先用 `git status --short` 排除用户原有脏文件：

```bash
release_version="$(jq -r .version frontend/new-legacy-releases/current.json)"
git add new-legacy/VERSION frontend/public/new-legacy frontend/new-legacy-releases/current.json "frontend/new-legacy-releases/$release_version" frontend/new-legacy-sync-report.json
git diff --cached --quiet || git commit -m "chore: prepare UAT release for built-in teaching data"
```

如 `frontend/new-legacy-sync-report.json` 包含用户在本功能前的修改，先审计差异并只暂存发布工具新增部分；无法安全拆分则停止并报告，不覆盖用户内容。

### Task 6: 部署 UAT 并完成数据库与浏览器验收

**Files:**
- Use: `deploy/update-uat.sh`
- Remote read-only verification: `/home/ubuntu/lszl-kg-uat`

**Interfaces:**
- Produces: UAT 端口 18087 上运行的新版本

- [ ] **Step 1: 从干净隔离工作树执行唯一部署入口**

```bash
bash deploy/update-uat.sh
```

Expected: 磁盘预检、release gate、rsync、镜像重建、Alembic、18087 健康检查、试卷目录回填和缓存清理依次成功。任何一步失败立即停止，不改用手工 rsync。

- [ ] **Step 2: 验证 UAT 数据库内置数据**

通过 UAT backend 容器执行只输出计数和稳定 ID 的查询，确认：taxonomy 317、recall 471/2840、principles/presets 8/8；再重启一次 backend，确认计数和修订号不变。不得输出题目正文、用户数据或环境变量。

- [ ] **Step 3: 验证健康与日志**

先检查服务器本机：

```bash
ssh resume-prod 'curl -fsS http://127.0.0.1:18087/api/v1/health'
```

检查 UAT backend 最近日志中没有 seed 校验、唯一约束、数据库连接或 500 错误；同时确认正式 18086 容器 ID、状态和健康未变化。

- [ ] **Step 4: 浏览器真实流程验收**

使用测试教师账号进入 UAT `paper-management.html`：新建试卷，切换“按原则配额”，确认至少显示内置 8 条原则；保存并刷新后仍可见。再进入知识树/联想库读取界面确认 317 节点基线和联想库已加载。整个流程不得点击上传三份基础数据。

- [ ] **Step 5: 负向与恢复验收**

新建一张非 PMP 或空题库试卷，确认页面仍保持既有空态/配额提示而不是报 500；重复点击新建、取消、刷新不触发重复导入请求。只测试用户可见行为，不修改 UAT 内置数据。

### Task 7: 合并、推送与清理功能分支

**Files:**
- Git history only

**Interfaces:**
- Produces: 本地/远程 `main` 与 `uat` 含同一已验证提交，功能分支和工作树移除

- [ ] **Step 1: 审计待合并历史与工作区**

确认功能分支只包含设计、计划、seed、服务、测试和 release 提交；确认用户原有数据迁移改动未进入任何提交。

- [ ] **Step 2: 将验证完成的功能历史合入 `uat` 和 `main`**

优先使用 fast-forward；若分支已变化，执行非破坏性 merge 并重新运行冲突触及范围的 focused/full tests。禁止 reset、强推或丢弃用户改动。

- [ ] **Step 3: 推送远程并核对提交**

通过已配置代理推送 `origin/uat` 和 `origin/main`，核对本地/远程两分支指向预期提交。推送不等于再次部署生产；本任务只部署 UAT。

- [ ] **Step 4: 删除功能分支和隔离工作树**

确认所有有效提交已经进入 `main` 和 `uat` 后，删除本地/远程功能分支并移除对应工作树。最终保留用户原工作区的未提交数据迁移内容，不做 stash、checkout 或清理。

- [ ] **Step 5: 最终证据汇总**

报告设计/计划/实现提交、后端和前端精确测试结果、UAT 版本、active/candidate 文件数、UAT 数据计数、浏览器验收结果、正式环境未变化证据，以及任何仍存在的既有失败。
