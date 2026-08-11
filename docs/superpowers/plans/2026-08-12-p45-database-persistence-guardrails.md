# P4.5 数据库持久化护栏实施计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 在迁移 P4.2–P4.5 页面能力之前，让每一项新增持久化业务状态都有 PostgreSQL 落点、可验证的白名单和发布阻断，杜绝回退到浏览器本地持久化。

**Architecture:** 继续使用现有 `server-state-bootstrap.js` 作为兼容页面的同步 API：浏览器中的 `localStorage` 名称仅是同步接口，真值在 `runtime_states` 或 `shared_runtime_states` 的 PostgreSQL JSONB 中。题库、原则、归纳卡、标签和内容包不进入该兼容层，而是由既有 Question Catalog / Content Prep API 维护关系型真值。新增清单作为单一数据契约，同时被前端同步校验和后端写入验证测试覆盖。

**Tech Stack:** Python 3.11、FastAPI、SQLAlchemy async、PostgreSQL JSONB、Alembic、Node.js built-in test runner。

## Global Constraints

- 不迁移首页四学习入口、新手引导、简易/专业知识点编辑或帮助入口改版。
- 业务持久化只能写 PostgreSQL；不得增加 localStorage 或 IndexedDB 业务写入。
- `sessionStorage` 只可保存短期导航/预览令牌，不能承载恢复型业务数据。
- 不手改 `frontend/public/new-legacy/` 或 `frontend/new-legacy-releases/*/site`；必须通过 sync/release manager 生成。
- 新增业务行为先写失败测试并确认 RED，再写生产代码。
- 本批不将 P4.5.28 源码整包覆盖到 `new-legacy/`；后续每个功能批次按来源模块名单迁移。

---

## File Structure

| 文件 | 责任 |
| --- | --- |
| `frontend/scripts/p45-persistence-contract.json` | P4.2–P4.5 所需的兼容型键、专用 API 数据域、排除能力与来源版本的单一清单 |
| `frontend/scripts/new-legacy-contract.json` | 构建期允许的兼容存储键；从 P4.5 清单派生合并，不允许遗漏 |
| `frontend/scripts/sync-new-legacy.js` | 构建时校验页面未写未登记 key，也不允许新业务 IndexedDB |
| `frontend/scripts/p45-persistence-contract.test.mjs` | 前端清单、构建契约和更新源码审计回归 |
| `backend/app/services/runtime_state_service.py` | 运行态 PostgreSQL 写入白名单、共享域路由与字节限制 |
| `backend/tests/test_runtime_state_p45_contract.py` | 后端白名单、权限和数据库读写回归 |
| `docs/superpowers/specs/2026-08-12-db-backed-p45-migration-design.md` | 已确认的整体迁移设计 |

## Task 1: 建立 P4.2–P4.5 持久化清单和构建期 RED 测试

**Files:**

- Create: `frontend/scripts/p45-persistence-contract.json`
- Create: `frontend/scripts/p45-persistence-contract.test.mjs`
- Modify: `frontend/package.json`

**Interfaces:**

- Produces: `p45-persistence-contract.json` with `runtime.exactKeys`, `runtime.prefixes`, `shared.exactKeys`, `shared.prefixes`, `domainApi`, `sessionOnlyPrefixes`, and `excludedHomeFeatures`.
- Consumes: the read-only update source at `resolve(process.cwd(), '../../updata-legacy')` when it exists from the linked worktree's `frontend/` directory.
- Produces: `pnpm test:p45-persistence`.

- [x] **Step 1: Write the failing persistence-contract test**

Create a Node test that loads `p45-persistence-contract.json` and asserts all of the following:

```js
test('P4.5 persistence manifest assigns every state domain', () => {
  const p45 = readJson(p45Path)
  assert.deepEqual(
    Object.keys(p45.domainApi).sort(),
    ['contentPrep', 'learning', 'questionCatalog', 'training']
  )
  assert.deepEqual(p45.excludedHomeFeatures, [
    'learning-entry', 'new-user-onboarding', 'simple-professional-node-editor', 'help-entry-refresh'
  ])
})
```

When the source directory exists, also assert it contains known P4.5 persistence identifiers `kg_practice_mistakes_v1__user__`, `kg_recall_association_management_v1__subject__`, `kg_recall_association_library_v1__subject__`, and `kg_canvas_view_preferences_v1`. Task 3 adds the build-time prohibition on selected modules using IndexedDB.

- [x] **Step 2: Run the test to verify RED**

Run: `cd frontend && node --test scripts/p45-persistence-contract.test.mjs`

Expected: FAIL with `ENOENT` for `p45-persistence-contract.json`.

- [x] **Step 3: Add the minimal contract**

Create the JSON contract with these compatibility entries:

```json
{
  "sourceVersion": "v9.0-p4.5.28",
  "runtime": {
    "exactKeys": [
      "kg_canvas_view_preferences_v1",
      "kg_home_interaction_mode_v1",
      "kg_graph_recent_colors_v1"
    ],
    "prefixes": [
      "kg_practice_mistakes_v1__user__",
      "kg_recall_association_management_v1__subject__",
      "kg_recall_association_library_v1__subject__",
      "kg_canvas_workspace_v1__",
      "kg_canvas_workspace_catalog_v2__",
      "kg_deep_recall_progress_v2__"
    ]
  },
  "shared": {
    "exactKeys": [],
    "prefixes": ["kg_recall_association_library_v1__subject__"]
  },
  "domainApi": {
    "contentPrep": ["question-banks", "questions", "principles", "synthesis-presets", "tag-config", "prep-workspace"],
    "learning": ["diagnosis", "recommendation", "content-consumption", "effect-attribution"],
    "questionCatalog": ["question-family", "keyword-system-v2", "subject-facets", "semantic-tags", "import-policy"],
    "training": ["attempts", "mistakes", "verification", "workspace", "recall-progress"]
  },
  "sessionOnlyPrefixes": ["kg_teacher_preview_", "kg_learning_route_context_"],
  "excludedHomeFeatures": [
    "learning-entry", "new-user-onboarding", "simple-professional-node-editor", "help-entry-refresh"
  ]
}
```

The contract must not list any formal business payload under `sessionOnlyPrefixes`.

- [x] **Step 4: Add the package script and verify GREEN**

Add this script to `frontend/package.json`:

```json
"test:p45-persistence": "node --test scripts/p45-persistence-contract.test.mjs"
```

Run: `cd frontend && node --test scripts/p45-persistence-contract.test.mjs`

Expected: PASS.

- [x] **Step 5: Commit**

```bash
git add frontend/package.json frontend/scripts/p45-persistence-contract.json frontend/scripts/p45-persistence-contract.test.mjs
git commit -m "test: define P4.5 persistence contract"
```

## Task 2: Align the frontend build contract and backend database validator

**Files:**

- Modify: `frontend/scripts/new-legacy-contract.json`
- Modify: `backend/app/services/runtime_state_service.py`
- Create: `backend/tests/test_runtime_state_p45_contract.py`

**Interfaces:**

- Extends: `runtime_state_service.EXACT_KEYS` and `PREFIXES` with every entry in `p45-persistence-contract.json.runtime`.
- Extends: `runtime_state_service.TEACHER_SHARED_GLOBAL_PREFIXES` with the shared recall-library prefix already designated in the P4.5 contract.
- Produces: `runtime_state_service.key_allowed(key: str) -> bool` acceptance for each P4.5 compatibility key and rejection for unknown keys.

- [x] **Step 1: Write backend RED tests**

Create tests that call the real validation boundary:

```python
@pytest.mark.parametrize("key", [
    "kg_practice_mistakes_v1__user__learner",
    "kg_recall_association_management_v1__subject__PMP",
    "kg_recall_association_library_v1__subject__PMP",
])
def test_p45_runtime_key_is_accepted(key: str):
    assert runtime_state_service.key_allowed(key)

def test_unknown_p45_key_is_rejected():
    assert not runtime_state_service.key_allowed("kg_p45_unregistered_payload_v1")

def test_p45_recall_library_uses_shared_teacher_storage():
    key = "kg_recall_association_library_v1__subject__PMP"
    assert runtime_state_service.canonical_teacher_shared_key(key, "teacher", "teacher") == key
```

In the existing frontend contract test, replace the single relative source lookup with a helper that returns the first existing directory from `../updata-legacy` (normal checkout) and `../../../updata-legacy` (linked worktree). Add a test that asserts the helper resolves the known `updata-legacy/` directory in this repository, so the source identifier audit cannot be silently skipped.

- [x] **Step 2: Run RED**

Run: `cd backend && /Users/menghao/Documents/幻谱/佩奇老师/最新/backend/.venv/bin/python -m pytest tests/test_runtime_state_p45_contract.py -q`

Expected: FAIL because the mistake and management prefixes are not registered.

- [x] **Step 3: Implement the minimal validator changes**

Add exactly the missing P4.5 compatibility prefixes to `PREFIXES`; do not add broad `kg_` wildcard acceptance. Add the management prefix as owner-scoped PostgreSQL runtime data and retain recall library as teacher-shared PostgreSQL data. Keep value and total-size validation unchanged.

Mirror the exact/prefix entries into `frontend/scripts/new-legacy-contract.json.runtimeStorage` so the frontend build and backend write boundary agree.

Extend `p45-persistence-contract.test.mjs` with the cross-contract assertion only after this change:

```js
for (const key of p45.runtime.exactKeys) assert.ok(contract.runtimeStorage.exactKeys.includes(key), key)
for (const prefix of p45.runtime.prefixes) assert.ok(contract.runtimeStorage.prefixes.includes(prefix), prefix)
```

- [x] **Step 4: Run GREEN and contract regression**

Run:

```bash
cd backend && /Users/menghao/Documents/幻谱/佩奇老师/最新/backend/.venv/bin/python -m pytest tests/test_runtime_state_p45_contract.py -q
cd ../frontend && node --test scripts/p45-persistence-contract.test.mjs scripts/new-legacy-sync.test.mjs
```

Expected: all PASS.

- [x] **Step 5: Commit**

```bash
git add backend/app/services/runtime_state_service.py backend/tests/test_runtime_state_p45_contract.py frontend/scripts/new-legacy-contract.json
git commit -m "feat: persist P4.5 compatibility state in PostgreSQL"
```

## Task 3: Enforce that future updater modules do not introduce browser-persistent business data

**Files:**

- Modify: `frontend/scripts/sync-new-legacy.js`
- Modify: `frontend/scripts/p45-persistence-contract.test.mjs`
- Modify: `frontend/scripts/new-legacy-sync.test.mjs`

**Interfaces:**

- Produces: build failure `P4.5 persistent state is not registered: <key>`.
- Produces: build failure `IndexedDB business persistence is forbidden in migrated module: <path>` for a selected, migrated business module.
- Allows: `sessionStorage` only for the listed token prefixes.

- [x] **Step 1: Write a RED fixture test**

Add a temporary source fixture in `new-legacy-sync.test.mjs` containing:

```js
writeFileSync(join(source, 'src', 'p45-fixture.js'),
  "localStorage.setItem('kg_p45_unregistered_payload_v1', '{}')")
assert.throws(() => runSync(source), /P4\.5 persistent state is not registered/)
```

Add a second fixture with `indexedDB.open('business-workspace')` and assert it fails when the fixture is included in the migration manifest.

- [x] **Step 2: Run RED**

Run: `cd frontend && node --test scripts/new-legacy-sync.test.mjs`

Expected: FAIL because the P4.5-specific error paths do not exist.

- [x] **Step 3: Implement manifest-driven validation**

Load `p45-persistence-contract.json` in `sync-new-legacy.js`. Reuse the existing storage-key parser; compare each detected persistent key with the union of the base and P4.5 contracts. Emit the P4.5-specific diagnostic for unknown keys. For a source file explicitly registered as a migrated business module, reject `indexedDB.open` and writes unless the module is marked `offlineExportOnly`.

Do not reject read-only source material under `updata-legacy/`; the rule applies only to files selected for `new-legacy/` migration.

- [x] **Step 4: Run GREEN**

Run: `cd frontend && node --test scripts/new-legacy-sync.test.mjs scripts/p45-persistence-contract.test.mjs`

Expected: PASS, including existing compatibility/read-only-key tests.

- [x] **Step 5: Commit**

```bash
git add frontend/scripts/sync-new-legacy.js frontend/scripts/new-legacy-sync.test.mjs frontend/scripts/p45-persistence-contract.test.mjs
git commit -m "feat: block local persistence in migrated P4.5 modules"
```

## Task 4: Produce the source-to-database migration matrix and verify release discipline

**Files:**

- Create: `docs/p45-migration-matrix.md`
- Modify: `frontend/scripts/p45-persistence-contract.test.mjs`

**Interfaces:**

- Produces one row per P4.2–P4.5 feature group with `source modules`, `target page`, `PostgreSQL owner`, `API`, `excluded?`, and `verification`.
- Produces a static test that rejects absent ownership/API for a migrated group.

- [x] **Step 1: Write the RED matrix test**

Add a test that parses the Markdown table and requires these rows: `图谱画布`, `题库与训练`, `做题与验证`, `深度回忆`, `学习诊断与推荐`, `Prep Studio`.

For each non-excluded row, assert a non-empty PostgreSQL owner and API route. Assert all four excluded homepage capabilities are represented only as `excluded` and have no source-copy task.

- [x] **Step 2: Run RED**

Run: `cd frontend && node --test scripts/p45-persistence-contract.test.mjs`

Expected: FAIL because the migration matrix does not exist.

- [x] **Step 3: Write the matrix**

Document the seven batches from the design, naming these initial mappings:

```text
图谱画布 -> graph_files/file_contents -> /api/v1/files
题库与训练 -> question_banks/questions/principles/synthesis_presets -> /api/v1/question-catalog, /api/v1/content-prep
做题与验证 -> learning_events + planned practice_mistakes/practice_verifications -> /api/v1/learning
深度回忆 -> recall_progress/shared_runtime_states + planned recall_association_libraries -> /api/v1/training, /api/v1/content-prep
学习诊断与推荐 -> planned learning_evidence/learning_diagnoses/recommendation_records 等具体表 -> /api/v1/learning
Prep Studio -> question_upload_batches/question_audit_logs + planned prep_workspaces -> /api/v1/content-prep
```

State that the listed home features are excluded and must not be copied from `updata-legacy/`.

- [x] **Step 4: Run the first-batch verification suite**

Run:

```bash
cd backend && /Users/menghao/Documents/幻谱/佩奇老师/最新/backend/.venv/bin/python -m pytest tests/test_runtime_state_p45_contract.py tests/test_content_prep_models.py tests/test_question_catalog.py -q
cd ../frontend && node --test scripts/p45-persistence-contract.test.mjs scripts/new-legacy-sync.test.mjs scripts/direct-runtime.test.mjs
```

Expected: PASS. The known `new-legacy-release.test.mjs` failure caused by the ignored external `enterinformation/` directory is not part of this batch; record it in the handoff rather than masking it.

- [x] **Step 5: Commit**

```bash
git add docs/p45-migration-matrix.md frontend/scripts/p45-persistence-contract.test.mjs
git commit -m "docs: map P4.5 features to database migrations"
```

## Task 5: Fail closed for every IndexedDB-bearing module

**Files:**

- Create: `new-legacy/p45-migration-manifest.json`
- Modify: `frontend/scripts/sync-new-legacy.js`
- Modify: `frontend/scripts/new-legacy-sync.test.mjs`

**Interfaces:**

- Requires a source-root `p45-migration-manifest.json` with `migratedBusinessModules` and the finite, audited `legacyUnmigratedIndexedDbModules` debt list.
- Produces build failure `P4.5 migration manifest is required` when the manifest is absent.
- Scans every JavaScript/HTML module in the selected `new-legacy/` source for IndexedDB persistence, rather than only opt-in manifest entries.
- Allows IndexedDB only for the audited pre-P4.5 debt paths or a module explicitly marked `offlineExportOnly: true`; no unlisted module may bypass the check.

- [x] **Step 1: Write RED regression fixtures**

Make the test fixture create the required empty manifest by default. Add fixtures proving that a missing manifest fails, an unlisted module containing `indexedDB?.open()` fails, and modules using both dot and bracket optional chaining (`db?.transaction()` / `store?.put()` and `db?.['transaction']()` / `store?.['put']()`) fail. Preserve the strict-boolean export-only exception test.

- [x] **Step 2: Run RED**

Run: `cd frontend && node --test scripts/new-legacy-sync.test.mjs`

Expected: the new fixtures fail because the current implementation treats a missing manifest as an empty allowlist and does not recognize optional chaining.

- [x] **Step 3: Implement the fail-closed manifest and scan**

Require and parse the source manifest. Add only the two existing Prep Studio IndexedDB files to `legacyUnmigratedIndexedDbModules`; they are explicitly transitional technical debt for Batch 7 and are not `offlineExportOnly`. Reject an unlisted IndexedDB-bearing module even when it is absent from `migratedBusinessModules`. Extend all IndexedDB-open, transaction, object-store and write recognition to accept JavaScript optional chaining in both dot and bracket-property form while retaining false-positive protection for ordinary collection methods.

- [x] **Step 4: Run GREEN and real-source regression**

Run:

```bash
cd frontend && node --test scripts/new-legacy-sync.test.mjs scripts/p45-persistence-contract.test.mjs
node scripts/sync-new-legacy.js ../new-legacy --out "$(mktemp -d)/site"
```

The actual source may pass only through the two explicitly named pre-migration Prep Studio debt paths; it must not add a release output.

- [x] **Step 5: Commit and re-review**

```bash
git add new-legacy/p45-migration-manifest.json frontend/scripts/sync-new-legacy.js frontend/scripts/new-legacy-sync.test.mjs
git commit -m "fix: fail closed for P4.5 IndexedDB persistence"
```

## Plan Self-Review

- Coverage: protects all later P4.2–P4.5 migrations with a server-backed persistence contract, explicit feature ownership, exclusions and release checks.
- Scope: this plan intentionally implements only Batch 1; Batches 2–7 are independent implementation plans because they each introduce separate data models and user workflows.
- Consistency: every runtime key is declared in the frontend contract and validated by backend tests; relational domains are prohibited from the compatibility store.
- No placeholders: each task names its files, expected test command, required behavior and commit boundary.
