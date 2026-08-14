# Deep Recall P4.5 Database Vertical Slice Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Deliver the learner-facing P4.5 Deep Recall flow with PostgreSQL as the only business source of truth, including version-safe progress, formal Recall matching, personal nodes, keyword-safe reveal, large-graph interaction, and release verification.

**Architecture:** Extend the existing FastAPI training domain with immutable question/library snapshots and revision-checked recall progress APIs. Add a focused browser adapter that keeps only the open session in memory, then selectively port the proven P4.5 learner behaviors into the current Focus/Vega page without importing the colleague build's local-storage persistence or core-keyword visual leak. Publish only through the managed active-release pipeline after backend, unit, browser, and release-content gates pass.

**Tech Stack:** Python 3.11, FastAPI, SQLAlchemy 2 async, PostgreSQL JSONB, Alembic, Pydantic, pytest, vanilla JavaScript, SVG, Node test runner, Playwright/agent-browser, managed `new-legacy` release scripts.

## Global Constraints

- PostgreSQL is authoritative for question snapshots, formal Recall snapshots, personal progress, personal nodes, graph transforms, and optimistic revisions.
- Do not write Deep Recall business data to `localStorage`, IndexedDB, `KGSharedRuntimeState`, or any other browser persistence.
- Do not modify `updata-legacy/`; it is a read-only migration source.
- Do not overwrite `new-legacy/` wholesale; port only the approved P4.5.12, P4.5.17, P4.5.19, P4.5.20, and matching-priority parts of P4.5.26.
- Core and normal keywords are hidden on entry and share the same learner-visible markup and computed style after one “揭示关键词” action.
- Personal nodes are scoped to one owner and one question and never mutate the formal Recall library.
- Question/library version mismatches never auto-merge: old graphs are read-only; resetting to the current version is explicit and confirmed.
- Preserve current permission, subscription, guest-read-only, Focus/Vega skin, and `.kr-viewport` descendant geometry contracts.
- New migrations follow the current Alembic head and must not rewrite or delete unrelated dirty-worktree changes.
- An async SQLAlchemy write must `commit` and then `await db.refresh(obj)` before returning ORM attributes.
- Official publishing uses `node frontend/scripts/manage-new-legacy.js update new-legacy --skip-browser`; never copy files directly into an active release.

---

## File Map

- `backend/app/models/training.py`: immutable recall snapshot rows and the extended per-owner recall progress row.
- `backend/alembic/versions/2d8a6c4e9f10_deep_recall_database_session.py`: additive schema migration from the current `f1c9d4e7a261` head.
- `backend/app/schemas/deep_recall.py`: request/response contracts for sessions, saves, reset, and read-only libraries.
- `backend/app/services/deep_recall_service.py`: visibility, snapshots, hashes, limits, optimistic concurrency, and transaction rules.
- `backend/app/api/v1/training.py`: `/recall/session`, `/recall/progress`, `/recall/reset`, and `/recall/libraries` endpoints.
- `backend/tests/test_deep_recall_models.py`: migration/model defaults and uniqueness contracts.
- `backend/tests/test_deep_recall_api.py`: API isolation, versioning, conflict, quota, and non-pollution tests.
- `new-legacy/src/99-deep-recall-server-adapter.js`: fetch-only async Deep Recall client and in-memory session state.
- `new-legacy/src/question-keyword/keyword-runtime-service.js`: keyword classification and overlap priority without presentation styling.
- `new-legacy/src/97-recall-storage.js`: compatibility facade redirected away from browser persistence.
- `new-legacy/src/95-recall-association-library.js`: cached formal Recall/Alias lookup bound to the server snapshot.
- `new-legacy/src/86-knowledge-recall.js`: learner state machine, version gate, reveal, flow, incremental graph, drag, search, toolbar, and save lifecycle.
- `new-legacy/knowledge-recall.html`: scripts and accessible controls for reveal, version choice, search, reset, and save state.
- `new-legacy/styles/knowledge-recall-p4529.css`: P4.5.29 learner presentation override loaded last.
- `new-legacy/tests/v90-p4529-deep-recall-database-adapter.test.js`: no-local-write and revision API contracts.
- `new-legacy/tests/v90-p4529-deep-recall-flow.test.js`: formal/manual flow, ancestor filter, version gate, and keyword safety.
- `new-legacy/tests/v90-p4529-deep-recall-large-graph.test.js`: caches, incremental paths, drag-local updates, and search.
- `new-legacy/tests/v90-p4529-deep-recall-database-browser.py`: end-to-end database recovery and learner behavior.

### Task 1: Add immutable snapshot and versioned progress storage

**Files:**
- Modify: `backend/app/models/training.py`
- Create: `backend/alembic/versions/2d8a6c4e9f10_deep_recall_database_session.py`
- Create: `backend/tests/test_deep_recall_models.py`

**Interfaces:**
- Consumes: existing `Question.id`, `Question.bank_id`, `Question.revision`, `Question.content_hash`, and `RecallProgress(owner_id, question_id)`.
- Produces: `RecallQuestionSnapshot`, `RecallLibrarySnapshot`, and the extended `RecallProgress` fields used by `deep_recall_service.py`.

- [ ] **Step 1: Write failing model tests for uniqueness, JSON defaults, and composite ownership**

```python
from app.models.training import RecallLibrarySnapshot, RecallProgress, RecallQuestionSnapshot


def test_recall_snapshot_identity_contracts():
    assert {column.name for column in RecallQuestionSnapshot.__table__.primary_key} == {"id"}
    assert {column.name for column in RecallLibrarySnapshot.__table__.primary_key} == {"id"}
    assert {column.name for column in RecallProgress.__table__.primary_key} == {"owner_id", "question_id"}
    assert "uq_recall_question_snapshot_revision" in {
        constraint.name for constraint in RecallQuestionSnapshot.__table__.constraints
    }
    assert "uq_recall_library_snapshot_hash" in {
        constraint.name for constraint in RecallLibrarySnapshot.__table__.constraints
    }


def test_recall_progress_contains_versioned_graph_columns():
    columns = RecallProgress.__table__.columns
    for name in (
        "bank_id", "source_question_revision", "source_content_hash",
        "recall_library_hash", "graph_schema_version", "choice_offsets",
        "transform", "metrics", "revision",
    ):
        assert name in columns
```

- [ ] **Step 2: Run the focused tests and confirm the missing-model failure**

Run: `cd backend && .venv/bin/python -m pytest tests/test_deep_recall_models.py -q`

Expected: collection fails because `RecallQuestionSnapshot` and `RecallLibrarySnapshot` do not exist.

- [ ] **Step 3: Add the ORM models and additive migration**

Implement these exact table identities and data shapes:

```python
class RecallQuestionSnapshot(Base):
    __tablename__ = "recall_question_snapshots"
    __table_args__ = (
        UniqueConstraint("question_id", "question_revision", name="uq_recall_question_snapshot_revision"),
    )
    id: Mapped[uuid.UUID] = mapped_column(PGUUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    question_id: Mapped[str] = mapped_column(String(100), nullable=False, index=True)
    bank_id: Mapped[str] = mapped_column(String(100), nullable=False, index=True)
    question_revision: Mapped[int] = mapped_column(Integer, nullable=False)
    content_hash: Mapped[str] = mapped_column(String(64), nullable=False)
    subject: Mapped[str] = mapped_column(String(100), nullable=False)
    payload: Mapped[dict] = mapped_column(JSONB, nullable=False, default=dict)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())


class RecallLibrarySnapshot(Base):
    __tablename__ = "recall_library_snapshots"
    __table_args__ = (
        UniqueConstraint("subject", "content_hash", name="uq_recall_library_snapshot_hash"),
    )
    id: Mapped[uuid.UUID] = mapped_column(PGUUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    subject: Mapped[str] = mapped_column(String(100), nullable=False, index=True)
    content_hash: Mapped[str] = mapped_column(String(64), nullable=False)
    payload: Mapped[dict] = mapped_column(JSONB, nullable=False, default=dict)
    source_revision: Mapped[int] = mapped_column(Integer, nullable=False, default=0)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())
```

Extend `RecallProgress` with nullable `bank_id`, `source_content_hash`, and `recall_library_hash`; integer `source_question_revision=1`, `graph_schema_version=3`, and `revision=1`; JSONB `choice_offsets={}`, `transform={"x": 0, "y": 0, "scale": 1}`, and `metrics={}`. The migration must create both tables, add the new columns with server defaults where required, add indexes/unique constraints, and provide a complete downgrade that only removes this task's additions.

- [ ] **Step 4: Run model tests and the migration smoke check**

Run: `cd backend && .venv/bin/python -m pytest tests/test_deep_recall_models.py -q`

Run: `cd backend && .venv/bin/alembic upgrade head && .venv/bin/alembic current`

Expected: tests pass and current revision is `2d8a6c4e9f10`.

- [ ] **Step 5: Commit the storage slice**

```bash
git add backend/app/models/training.py backend/alembic/versions/2d8a6c4e9f10_deep_recall_database_session.py backend/tests/test_deep_recall_models.py
git commit -m "feat: add versioned deep recall storage"
```

### Task 2: Implement snapshot-safe Deep Recall APIs

**Files:**
- Create: `backend/app/schemas/deep_recall.py`
- Create: `backend/app/services/deep_recall_service.py`
- Modify: `backend/app/api/v1/training.py`
- Create: `backend/tests/test_deep_recall_api.py`

**Interfaces:**
- Consumes: `question_catalog_service.is_learning_question_visible(db, question_id)`, `question_catalog_service.question_to_payload(question)`, `content_prep_shared_service.read_shared_content(db, subject_id)`, and Task 1 models.
- Produces: `get_session(db, owner, question_id)`, `save_progress(db, owner, question_id, request)`, `reset_progress(db, owner, question_id, request)`, and `get_library(db, owner, subject)`.

- [ ] **Step 1: Write failing API tests for isolation, snapshots, conflicts, reset, and library immutability**

```python
def test_recall_progress_isolated_and_revision_checked(client, student_headers, second_student_headers, published_question):
    session = client.get(f"/api/v1/recall/session/{published_question.id}", headers=student_headers).json()
    body = {
        "expectedRevision": session["progressRevision"],
        "questionRevision": session["currentQuestion"]["revision"],
        "libraryHash": session["library"]["contentHash"],
        "graphSchemaVersion": 3,
        "nodes": [{"id": "personal:a", "title": "我的节点", "kind": "personal"}],
        "edges": [], "customNodes": [{"id": "personal:a", "title": "我的节点"}],
        "activeKeywords": [], "choiceOffsets": {},
        "transform": {"x": 0, "y": 0, "scale": 1}, "metrics": {},
    }
    saved = client.put(f"/api/v1/recall/progress/{published_question.id}", headers=student_headers, json=body)
    assert saved.status_code == 200
    assert saved.json()["revision"] == session["progressRevision"] + 1
    assert client.put(f"/api/v1/recall/progress/{published_question.id}", headers=student_headers, json=body).status_code == 409
    other = client.get(f"/api/v1/recall/session/{published_question.id}", headers=second_student_headers).json()
    assert other["progress"]["nodes"] == []


def test_personal_node_does_not_mutate_formal_library(client, student_headers, published_question):
    before = client.get("/api/v1/recall/libraries/数学", headers=student_headers).json()
    # Save through the same payload contract used above with one personal node.
    save_one_personal_node(client, student_headers, published_question.id, "只属于我")
    after = client.get("/api/v1/recall/libraries/数学", headers=student_headers).json()
    assert after == before


def test_question_revision_change_requires_old_view_or_reset(client, student_headers, published_question, db_session):
    save_one_personal_node(client, student_headers, published_question.id, "旧图")
    bump_question_revision(db_session, published_question.id)
    session = client.get(f"/api/v1/recall/session/{published_question.id}", headers=student_headers).json()
    assert session["versionState"] == "mismatch"
    assert session["historyQuestion"]["revision"] < session["currentQuestion"]["revision"]
    reset = client.post(
        f"/api/v1/recall/progress/{published_question.id}/reset",
        headers=student_headers,
        json={"expectedRevision": session["progressRevision"], "targetQuestionRevision": session["currentQuestion"]["revision"]},
    )
    assert reset.status_code == 200
    assert reset.json()["nodes"] == []
```

Also cover unpublished/inaccessible questions (`404`), invalid library hash (`409`), malformed graph (`422`), free-student node limit (`422` with code `recall_node_limit`), and admin/teacher paid bypass.

- [ ] **Step 2: Run the API tests and confirm endpoint failures**

Run: `cd backend && .venv/bin/python -m pytest tests/test_deep_recall_api.py -q`

Expected: requests fail with `404` because the new session/reset/library endpoints are absent.

- [ ] **Step 3: Define strict camelCase request/response schemas**

Create schemas with these public fields:

```python
class RecallProgressSaveRequest(BaseModel):
    expected_revision: int = Field(alias="expectedRevision", ge=0)
    question_revision: int = Field(alias="questionRevision", ge=1)
    library_hash: str = Field(alias="libraryHash", min_length=64, max_length=64)
    graph_schema_version: int = Field(alias="graphSchemaVersion", ge=1)
    nodes: list[dict[str, Any]]
    edges: list[dict[str, Any]]
    custom_nodes: list[dict[str, Any]] = Field(alias="customNodes")
    active_keywords: list[str] = Field(alias="activeKeywords")
    choice_offsets: dict[str, Any] = Field(alias="choiceOffsets")
    transform: RecallTransform
    metrics: dict[str, Any]


class RecallProgressResetRequest(BaseModel):
    expected_revision: int = Field(alias="expectedRevision", ge=0)
    target_question_revision: int = Field(alias="targetQuestionRevision", ge=1)
```

Use `ConfigDict(populate_by_name=True, serialize_by_alias=True)`. Validate unique node IDs, edge endpoints present in nodes, personal-node IDs beginning with `personal:`, finite transform values, and `0.2 <= scale <= 4`.

- [ ] **Step 4: Implement deterministic snapshots and optimistic transactions**

Use canonical JSON hashing:

```python
def canonical_hash(payload: Any) -> str:
    encoded = json.dumps(payload, ensure_ascii=False, sort_keys=True, separators=(",", ":")).encode("utf-8")
    return hashlib.sha256(encoded).hexdigest()
```

`get_session` must:

1. Resolve an accessible, published learning question or raise `404`.
2. Ensure the current `RecallQuestionSnapshot` exists using its revision/content hash.
3. Read the published subject Recall library from server state, canonicalize it, and ensure a `RecallLibrarySnapshot` exists.
4. Read only the current owner's `RecallProgress`.
5. Return `versionState: "current" | "mismatch"`, current and historical question payloads, the progress-bound library snapshot, `progressRevision` (`0` when absent), permissions, and node limit.

`save_progress` must lock the row with `SELECT ... FOR UPDATE`, compare `expectedRevision`, current question revision, and snapshot hash, validate node limits, change only the current owner's row, increment revision once, commit, refresh, and return the stored graph. A mismatch returns `409` with stable codes `recall_revision_conflict`, `question_revision_mismatch`, or `library_snapshot_mismatch`.

`reset_progress` must lock the row, require the current question revision, replace the graph with empty arrays/default transform/current hashes, increment revision once, and preserve no personal nodes from the old version.

The read-only library endpoint returns `{subject, contentHash, sourceRevision, payload, updatedAt}` and exposes no mutation route.

- [ ] **Step 5: Register the new routes without removing old compatibility routes**

```python
@router.get("/recall/session/{question_id}")
async def get_recall_session(...): ...

@router.put("/recall/progress/{question_id}")
async def put_recall_progress(...): ...

@router.post("/recall/progress/{question_id}/reset")
async def post_recall_reset(...): ...

@router.get("/recall/libraries/{subject}")
async def get_recall_library(...): ...
```

Keep `GET /recall/question/{question_id}` temporarily for callers outside this vertical slice. Route bodies delegate to `deep_recall_service`; they do not duplicate transaction logic.

- [ ] **Step 6: Run focused and full backend tests**

Run: `cd backend && .venv/bin/python -m pytest tests/test_deep_recall_api.py tests/test_deep_recall_models.py -q`

Run: `cd backend && .venv/bin/python -m pytest tests/ -q`

Expected: all tests pass; the second run introduces no failures in auth, questions, content prep, subscriptions, or training.

- [ ] **Step 7: Commit the API slice**

```bash
git add backend/app/schemas/deep_recall.py backend/app/services/deep_recall_service.py backend/app/api/v1/training.py backend/tests/test_deep_recall_api.py
git commit -m "feat: expose database deep recall sessions"
```

### Task 3: Replace browser persistence with a revision-aware server adapter

**Files:**
- Create: `new-legacy/src/99-deep-recall-server-adapter.js`
- Modify: `new-legacy/src/97-recall-storage.js`
- Modify: `new-legacy/knowledge-recall.html`
- Create: `new-legacy/tests/v90-p4529-deep-recall-database-adapter.test.js`

**Interfaces:**
- Consumes: Task 2 HTTP JSON contracts and existing authenticated `fetch('/api/v1/...', {credentials: 'include'})` conventions.
- Produces: `window.KGDeepRecallServerAdapter.create({questionId})` with `loadSession()`, `saveGraph(graph)`, `resetToCurrent()`, `retryLastSave()`, `getState()`, and `subscribe(listener)`.

- [ ] **Step 1: Write a failing adapter contract test with a fake fetch**

```javascript
test('adapter saves with expected revision and never uses browser persistence', async () => {
  const calls = [];
  const storageWrites = [];
  const context = loadAdapter({
    fetch: async (url, init = {}) => {
      calls.push({ url, init });
      if (!init.method) return jsonResponse(sessionFixture({ progressRevision: 4 }));
      return jsonResponse({ revision: 5, nodes: [{ id: 'personal:a' }] });
    },
    localStorage: throwingStorage(storageWrites),
    indexedDB: throwingIndexedDb(storageWrites),
    KGSharedRuntimeState: throwingRuntimeState(storageWrites),
  });
  const adapter = context.KGDeepRecallServerAdapter.create({ questionId: 'q1' });
  await adapter.loadSession();
  await adapter.saveGraph(graphFixture());
  const body = JSON.parse(calls[1].init.body);
  assert.equal(body.expectedRevision, 4);
  assert.equal(adapter.getState().progressRevision, 5);
  assert.deepEqual(storageWrites, []);
});
```

Also test `409` keeps the in-memory graph and sets `saveState: "conflict"`; network failure sets `saveState: "failed"`; retry reuses the unsaved graph; and reset sends the loaded current question revision.

- [ ] **Step 2: Run the unit test and confirm the adapter is missing**

Run: `cd new-legacy && node --test tests/v90-p4529-deep-recall-database-adapter.test.js`

Expected: failure because `KGDeepRecallServerAdapter` is undefined.

- [ ] **Step 3: Implement the fetch-only adapter**

Use a closure state shaped exactly as:

```javascript
{
  session: null,
  graph: null,
  progressRevision: 0,
  saveState: 'idle', // idle | loading | saving | saved | failed | conflict
  error: null,
  lastUnsavedGraph: null
}
```

All network requests use `credentials: 'include'`, `Accept: application/json`, and JSON content type for mutations. `saveGraph` serializes only the schema fields from Task 2 and reads revision/hash values from the loaded session. It must not reference `localStorage`, `sessionStorage`, IndexedDB, Cache Storage, `KGSharedRuntimeState`, or `KGRecallStorage`.

- [ ] **Step 4: Turn the legacy storage module into a non-persistent compatibility facade**

Keep any pure key/normalization exports required by unrelated tests, but make `loadRecallState` and `saveRecallState` throw a descriptive migration error directing the controller to `KGDeepRecallServerAdapter`. Delete or bypass all Deep Recall business calls to `localStorage`; do not add a fallback write path.

- [ ] **Step 5: Load the adapter before the controller and rerun tests**

Add `<script defer src="src/99-deep-recall-server-adapter.js"></script>` after shared auth/runtime dependencies and before `src/86-knowledge-recall.js`.

Run: `cd new-legacy && node --test tests/v90-p4529-deep-recall-database-adapter.test.js tests/knowledge-recall-storage.test.js`

Expected: adapter tests pass; compatibility tests either pass unchanged or are updated to assert persistence rejection.

- [ ] **Step 6: Commit the persistence boundary**

```bash
git add new-legacy/src/99-deep-recall-server-adapter.js new-legacy/src/97-recall-storage.js new-legacy/knowledge-recall.html new-legacy/tests/v90-p4529-deep-recall-database-adapter.test.js
git commit -m "feat: move deep recall progress to server adapter"
```

### Task 4: Port continuous recall and safe keyword reveal

**Files:**
- Create: `new-legacy/src/question-keyword/keyword-runtime-service.js`
- Modify: `new-legacy/src/95-recall-association-library.js`
- Modify: `new-legacy/src/86-knowledge-recall.js`
- Modify: `new-legacy/knowledge-recall.html`
- Create: `new-legacy/styles/knowledge-recall-p4529.css`
- Create: `new-legacy/tests/v90-p4529-deep-recall-flow.test.js`

**Interfaces:**
- Consumes: `adapter.loadSession()`, session `currentQuestion/historyQuestion/library/versionState/permissions`, and formal library payload.
- Produces: a controller state machine `loading -> ready | version-choice | readonly-history | save-failed`, `revealKeywords()`, `activateKeyword(keywordId)`, `resolveAssociationNode(input)`, `createPersonalNode(input)`, and `filterAncestorCandidates(nodeId, candidates)`.

- [ ] **Step 1: Write failing behavior tests for keyword secrecy and continuous flow**

```javascript
test('normal and core keywords are indistinguishable before and after reveal', () => {
  const page = mountRecallPage(questionWithNormalAndCoreKeywords());
  assert.equal(page.querySelectorAll('[data-keyword-visible="true"]').length, 0);
  assert.equal(page.querySelectorAll('.is-core-keyword').length, 0);
  page.getByRole('button', { name: '揭示关键词' }).click();
  const tokens = [...page.querySelectorAll('.kr-keyword-token')];
  assert.equal(tokens.length, 2);
  assert.equal(tokens[0].className, tokens[1].className);
});


test('manual input resolves official aliases before creating a personal node', () => {
  const resolver = createResolver(formalLibraryFixture());
  assert.equal(resolver.resolveAssociationNode('mitochondrion').id, 'recall:mitochondria');
  assert.equal(resolver.resolveAssociationNode('线粒体').id, 'recall:mitochondria');
  assert.equal(resolver.resolveAssociationNode('动力工厂').id, 'recall:mitochondria');
  assert.equal(resolver.resolveAssociationNode('我的口诀'), null);
});


test('candidate recommendations exclude parent and every ancestor', () => {
  assert.deepEqual(filterAncestorCandidates('n3', ['root', 'n1', 'n2', 'n4']), ['n4']);
});
```

Also assert the manual input and generate button remain visible when recommendations are empty; “换一组” stays in place and is disabled with an explanation when only one group exists; history mode blocks reveal/create/drag/save; and reset requires confirmation.

- [ ] **Step 2: Run the flow test and confirm the new contracts fail**

Run: `cd new-legacy && node --test tests/v90-p4529-deep-recall-flow.test.js`

Expected: failures for missing reveal button/state, alias resolver, and history gate.

- [ ] **Step 3: Port only keyword matching/classification logic from P4.5.26**

Copy the deterministic token segmentation and overlap sorting into `keyword-runtime-service.js`. Return semantic metadata to JavaScript, but render every learner-visible token as exactly `<button class="kr-keyword-token" data-keyword-id="...">`; do not emit core classes, colors, badges, font weights, data attributes, animation differences, or earlier-load markup.

- [ ] **Step 4: Port formal Recall resolution and ancestor filtering from P4.5.12**

Build in-memory maps for formal ID, normalized Chinese title, normalized English title, and aliases. `resolveAssociationNode(input)` returns a cloned formal node without mutating the library. An unmatched normalized input creates `personal:${questionId}:${crypto.randomUUID()}` and stores title/type only in the pending personal graph. Candidate filtering walks parent edges to a visited set and rejects current, parent, and all ancestors.

- [ ] **Step 5: Make controller startup asynchronous and version-safe**

On load, resolve `questionId` from the existing route, call `adapter.loadSession()`, and render no demo/current data until it succeeds. For `versionState === 'mismatch'`, show two explicit actions:

- `查看旧图`: render `historyQuestion` plus the progress-bound library in `readonly-history`; disable every mutation.
- `按新题重置`: show a second confirmation, call `resetToCurrent()`, then render the current question and empty graph.

For current mode, start with keywords hidden on every entry. The single “揭示关键词” action renders all keywords with the same class. Clicking a revealed token activates its first graph layer. Visitor/read-only mode disables reveal and all graph mutations.

- [ ] **Step 6: Add a last-loaded presentation override without changing viewport geometry**

`knowledge-recall-p4529.css` may style `.kr-keyword-token`, save/error banners, and version dialog outside `.kr-viewport`. It must contain no `.is-core`, `[data-core]`, or core-specific selector. Load it after every existing knowledge-recall stylesheet. Do not change `.kr-viewport`, `.kr-world`, `.kr-question-card`, or `.kr-node-layer` geometry.

- [ ] **Step 7: Run flow, adapter, syntax, and static leak checks**

Run: `cd new-legacy && node --test tests/v90-p4529-deep-recall-flow.test.js tests/v90-p4529-deep-recall-database-adapter.test.js`

Run: `node --check new-legacy/src/86-knowledge-recall.js && node --check new-legacy/src/95-recall-association-library.js && node --check new-legacy/src/question-keyword/keyword-runtime-service.js`

Run: `rg -n "localStorage|indexedDB|KGSharedRuntimeState|is-core|data-core" new-legacy/src/86-knowledge-recall.js new-legacy/src/95-recall-association-library.js new-legacy/src/99-deep-recall-server-adapter.js new-legacy/styles/knowledge-recall-p4529.css`

Expected: unit/syntax tests pass; the final search returns no business persistence or core-visual matches.

- [ ] **Step 8: Commit the safe learner flow**

```bash
git add new-legacy/src/question-keyword/keyword-runtime-service.js new-legacy/src/95-recall-association-library.js new-legacy/src/86-knowledge-recall.js new-legacy/knowledge-recall.html new-legacy/styles/knowledge-recall-p4529.css new-legacy/tests/v90-p4529-deep-recall-flow.test.js
git commit -m "feat: add safe continuous deep recall flow"
```

### Task 5: Port large-graph rendering, drag, search, and connected toolbar

**Files:**
- Modify: `new-legacy/src/86-knowledge-recall.js`
- Modify: `new-legacy/src/95-recall-association-library.js`
- Modify: `new-legacy/knowledge-recall.html`
- Modify: `new-legacy/styles/knowledge-recall-p4529.css`
- Create: `new-legacy/tests/v90-p4529-deep-recall-large-graph.test.js`

**Interfaces:**
- Consumes: Task 4 graph state, formal library lookup cache, adapter save scheduling.
- Produces: `appendNodeElement(node)`, `appendEdgePath(edge)`, `updateConnectedEdges(nodeId)`, `searchCanvasNodes(query)`, `focusCanvasNode(nodeId)`, `resetZoomOnly()`, and `focusQuestionCard()`.

- [ ] **Step 1: Write failing structural performance and canvas behavior tests**

```javascript
test('adding one node appends one element and only its new paths', () => {
  const renderer = createInstrumentedRenderer(graphFixture(500, 2000));
  renderer.addNode({ id: 'n501', title: '新增' }, [{ from: 'n500', to: 'n501' }]);
  assert.equal(renderer.calls.fullRender, 0);
  assert.equal(renderer.calls.appendNode, 1);
  assert.equal(renderer.calls.appendPath, 1);
});


test('drag updates only connected paths', () => {
  const renderer = createInstrumentedRenderer(graphFixture(500, 2000));
  renderer.moveNode('n10', { x: 30, y: 40 });
  assert.deepEqual(renderer.calls.updatedEdgeIds.sort(), renderer.connectedEdgeIds('n10').sort());
});


test('canvas search matches title english and aliases without rerendering', () => {
  const renderer = createInstrumentedRenderer(aliasGraphFixture());
  assert.equal(renderer.searchCanvasNodes('mitochondrion')[0].id, 'recall:mitochondria');
  assert.equal(renderer.calls.fullRender, 0);
});
```

Also assert exactly one SVG `<path>` per relation, no `filter`/glow attributes, 420 ms search debounce, continuous search/reset toolbar DOM, stable rotate/recommendation controls, `100%` changes scale only, and “回到题目” changes translation separately.

- [ ] **Step 2: Run the large-graph tests and confirm full-render behavior fails**

Run: `cd new-legacy && node --test tests/v90-p4529-deep-recall-large-graph.test.js`

Expected: failures for missing incremental renderer, drag-local updates, or canvas search.

- [ ] **Step 3: Port P4.5.17 caches and incremental renderer**

Cache the loaded formal library and its lookup indexes once per session/library hash. Maintain `nodeElementById`, `edgePathById`, and `connectedEdgeIdsByNode`. Initial render may build the loaded graph once; all later additions append one node and only new path elements. Every relation is one light SVG path with no duplicate glow/filter path.

- [ ] **Step 4: Port node drag with local path updates and debounced persistence**

Pointer drag updates the selected node model and transform only. During drag call `updateConnectedEdges(nodeId)`; do not rebuild unrelated nodes/paths. On pointerup update `choiceOffsets`, schedule adapter save after 420 ms, and surface save conflict/failure through the existing banner.

- [ ] **Step 5: Port P4.5.19 search and P4.5.20 toolbar**

Search only nodes currently present in the canvas graph, matching normalized title, English name, and aliases. Use 420 ms debounce. Selecting a result calls `focusCanvasNode(nodeId)` and opens its guidance panel without rebuilding layers. Keep search and reset in one continuous toolbar. `resetZoomOnly()` sets scale to `1` around the current center without recentering; `focusQuestionCard()` is the only command that centers the question.

- [ ] **Step 6: Run new and migrated P4.5 contract tests**

Run: `cd new-legacy && node --test tests/v90-p4529-deep-recall-large-graph.test.js tests/v90-p4512-deep-recall-flow-continuity.test.js tests/v90-p4517-deep-recall-large-graph-performance.test.js tests/v90-p4519-deep-recall-node-search.test.js tests/v90-p4520-deep-recall-connected-toolbar.test.js`

If the four source-named tests are not yet present in `new-legacy/tests`, copy their assertions from `updata-legacy/tests`, update only fixture/bootstrap paths and the P4.5.29 keyword/database expectations, and include them in this task's commit.

- [ ] **Step 7: Commit the canvas behavior slice**

```bash
git add new-legacy/src/86-knowledge-recall.js new-legacy/src/95-recall-association-library.js new-legacy/knowledge-recall.html new-legacy/styles/knowledge-recall-p4529.css new-legacy/tests/v90-p4529-deep-recall-large-graph.test.js new-legacy/tests/v90-p4512-deep-recall-flow-continuity.test.js new-legacy/tests/v90-p4517-deep-recall-large-graph-performance.test.js new-legacy/tests/v90-p4519-deep-recall-node-search.test.js new-legacy/tests/v90-p4520-deep-recall-connected-toolbar.test.js
git commit -m "feat: complete deep recall canvas interactions"
```

### Task 6: Prove database recovery, permissions, failures, and UI behavior in a browser

**Files:**
- Create: `new-legacy/tests/v90-p4529-deep-recall-database-browser.py`
- Modify only if failures reveal a requirement defect: files owned by Tasks 2–5.

**Interfaces:**
- Consumes: running backend at port `8000`, current `new-legacy` source served through the normal frontend route, seeded users/questions, and all prior interfaces.
- Produces: executable browser evidence for cross-device recovery, isolation, keyword safety, error states, and large-graph controls.

- [ ] **Step 1: Build a deterministic browser fixture through server APIs**

Create two students, one teacher/admin, one published public question with one normal and one core keyword, one formal Recall node with Chinese/English/Alias names, and a 500-node/2,000-edge library fixture. Use API/DB setup helpers and record every created ID for cleanup; do not seed browser storage.

- [ ] **Step 2: Write the learner happy-path and secrecy scenario**

The Playwright scenario must assert:

1. Initial DOM contains no visible keyword token and no core-specific class/style.
2. “揭示关键词” reveals both tokens; their tag, class list, color, font weight, background, border, and animation properties are equal.
3. Clicking one keyword creates/opens the first layer.
4. Formal ID, Chinese, English, and Alias inputs resolve the same stable Recall ID.
5. An unmatched phrase creates one `personal:` node.
6. Parent and ancestor names never appear in the current recommendation list.
7. Search locates a canvas node; drag changes only that node and connected path coordinates; `100%` and “回到题目” have distinct results.

- [ ] **Step 3: Write database recovery and isolation scenarios**

After creating a personal node, wait for the server save indicator, close the browser context, start a fresh context with no cookies/storage, log in again, and assert the graph returns from the database. Log in as the second student and assert the first student's personal node is absent. Delete all browser storage in the first account and reload; the database graph must still return.

- [ ] **Step 4: Write conflict, failure, version, quota, and read-only scenarios**

- Two tabs load the same progress revision; tab A saves, tab B saves and receives the visible conflict state without overwriting A.
- Abort one save request; verify unsaved state and retry, with no local persistence and no success toast before the retry succeeds.
- Bump the question revision; verify version choice, read-only old graph, disabled mutations, confirmed reset, and empty current graph.
- A free student reaches the configured per-question node limit and receives a visible limit message; admin/teacher or paid entitlement bypass is unchanged.
- Guest/viewer mode cannot reveal, create, drag, reset, or save.

- [ ] **Step 5: Run browser tests and capture failure artifacts**

Run: `cd new-legacy && python3 tests/v90-p4529-deep-recall-database-browser.py`

Expected: exit `0`; on failure, the script saves a screenshot, DOM snapshot, API response log, and console errors under a task-specific temporary artifact directory.

- [ ] **Step 6: Re-run all Deep Recall unit and backend tests after browser fixes**

Run: `cd backend && .venv/bin/python -m pytest tests/test_deep_recall_models.py tests/test_deep_recall_api.py tests/test_training_api.py -q`

Run: `cd new-legacy && node --test tests/*recall*.test.js`

Run: `node --check new-legacy/src/86-knowledge-recall.js && node --check new-legacy/src/95-recall-association-library.js && node --check new-legacy/src/99-deep-recall-server-adapter.js`

Expected: all pass.

- [ ] **Step 7: Commit the browser-proof slice**

```bash
git add new-legacy/tests/v90-p4529-deep-recall-database-browser.py backend/app new-legacy/src new-legacy/knowledge-recall.html new-legacy/styles/knowledge-recall-p4529.css
git commit -m "test: verify database deep recall end to end"
```

### Task 7: Sync, validate release contents, and publish through the managed pipeline

**Files:**
- Generated by managed script: `frontend/public/new-legacy/**`
- Generated by managed script: `frontend/new-legacy-releases/<new-version>/site/**`
- Generated by managed script: `frontend/new-legacy-releases/current.json`
- Generated by managed script: `frontend/new-legacy-manifest.json`
- Generated by managed script: `frontend/new-legacy-sync-report.json`

**Interfaces:**
- Consumes: verified `new-legacy/` source and `frontend/scripts/manage-new-legacy.js`.
- Produces: a promoted active release containing every previous active file plus the Deep Recall additions.

- [ ] **Step 1: Record the current active release and content baseline**

Run:

```bash
active_version=$(python3 -c 'import json; print(json.load(open("frontend/new-legacy-releases/current.json"))["version"])')
find "frontend/new-legacy-releases/$active_version/site" -type f | sort > /tmp/deep-recall-active-files.txt
wc -l /tmp/deep-recall-active-files.txt
test -f "frontend/new-legacy-releases/$active_version/site/admin-console.html"
test -f "frontend/new-legacy-releases/$active_version/site/knowledge-recall.html"
```

Expected: both key pages exist and the baseline count is nonzero.

- [ ] **Step 2: Run the full pre-publish gate**

Run: `cd backend && .venv/bin/python -m pytest tests/ -q`

Run: `cd new-legacy && node --test tests/*.test.js content-prep-studio/tests/*.test.js`

Run: `cd frontend && pnpm exec tsc -b`

Run: `cd frontend && node scripts/new-legacy-release.test.mjs`

Expected: all exit `0`.

- [ ] **Step 3: Publish only with the managed command**

Run: `node frontend/scripts/manage-new-legacy.js update new-legacy --skip-browser`

Expected: sync, release build, validation, and promotion complete without manual copying.

- [ ] **Step 4: Compare candidate/active file counts and required files**

```bash
new_version=$(python3 -c 'import json; print(json.load(open("frontend/new-legacy-releases/current.json"))["version"])')
find "frontend/new-legacy-releases/$new_version/site" -type f | sort > /tmp/deep-recall-new-files.txt
test "$(wc -l < /tmp/deep-recall-new-files.txt)" -ge "$(wc -l < /tmp/deep-recall-active-files.txt)"
comm -23 /tmp/deep-recall-active-files.txt /tmp/deep-recall-new-files.txt | grep . && exit 1 || true
test -f "frontend/new-legacy-releases/$new_version/site/admin-console.html"
test -f "frontend/new-legacy-releases/$new_version/site/knowledge-recall.html"
test -f "frontend/new-legacy-releases/$new_version/site/src/99-deep-recall-server-adapter.js"
test -f "frontend/new-legacy-releases/$new_version/site/styles/knowledge-recall-p4529.css"
```

Expected: no baseline file is missing and all four key files exist.

- [ ] **Step 5: Run post-promotion route smoke checks**

Verify the active server serves `knowledge-recall.html`, question-bank preview entry, training entry, guest entry, admin console, and the new adapter/CSS with HTTP 200. Log in once as student and once as guest/viewer; repeat the reveal/save/read-only assertions against the promoted release.

- [ ] **Step 6: Review the final diff and ensure unrelated changes are not staged**

Run: `git status --short && git diff --check && git diff --stat`

Expected: no whitespace errors; every staged file belongs to this plan or is a generated output of the managed publish command. Existing unrelated content-prep, landing-page, payment, and imported-document changes remain unstaged.

- [ ] **Step 7: Commit managed release outputs**

```bash
git add frontend/public/new-legacy frontend/new-legacy-releases/current.json frontend/new-legacy-releases/<new-version> frontend/new-legacy-manifest.json frontend/new-legacy-sync-report.json new-legacy/VERSION
git commit -m "release: publish database-backed deep recall"
```

Replace `<new-version>` with the exact version printed in Step 3; do not use a glob that could stage older releases.

## Final Verification Checklist

- [ ] PostgreSQL contains question snapshots, library snapshots, and owner-scoped progress after browser use.
- [ ] Fresh browser state restores the graph; browser storage contains no Deep Recall business payload.
- [ ] Personal nodes do not appear in formal library reads or another account.
- [ ] Old question/library versions never mix with current data; old view is read-only and reset is explicit.
- [ ] Initial page leaks no keyword position/core status; revealed normal/core styles are identical.
- [ ] P4.5.12 flow, P4.5.17 incremental graph, P4.5.19 search, and P4.5.20 toolbar behaviors pass.
- [ ] 500-node/2,000-edge structural tests prove incremental additions and local drag updates.
- [ ] Guest, viewer, free student, paid student, teacher, and admin permission/limit boundaries pass.
- [ ] Full backend, Node, TypeScript, browser, and release validation gates pass.
- [ ] Active release file set is a superset of the prior active release and includes all Deep Recall assets.
