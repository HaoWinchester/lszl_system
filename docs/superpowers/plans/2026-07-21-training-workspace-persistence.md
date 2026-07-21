# Training And Workspace Persistence Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Persist five-step learning sessions, append-only learning events, and multi-question workspaces in PostgreSQL, then connect the original `new-legacy` training/workspace engines through an in-memory bridge.

**Architecture:** Existing `training_progress` gains a versioned JSONB snapshot while preserving compatibility columns. New event and workspace models expose owner-scoped APIs. React preloads server snapshots into a per-frame memory registry; generated upstream scripts use a synchronous memory Storage adapter whose writes are translated to domain APIs.

**Tech Stack:** FastAPI, SQLAlchemy async, PostgreSQL JSONB, Alembic, React, TypeScript, postMessage.

---

### Task 1: Add failing backend persistence tests

**Files:**
- Create: `backend/tests/test_learning_workspace.py`

- [ ] **Step 1: Write failing API tests**

```python
def test_training_session_round_trip(auth_client, seeded_question):
    body = {"schemaVersion": 2, "currentStep": 3, "completedSteps": [1, 2], "viewport": {"scale": 1.2}}
    saved = auth_client.put(f"/api/v1/training/session/{seeded_question}", json=body)
    assert saved.status_code == 200
    assert auth_client.get(f"/api/v1/training/session/{seeded_question}").json()["session"] == body

def test_workspace_is_owner_isolated(user_a_client, user_b_client):
    created = user_a_client.post("/api/v1/workspaces", json={"title": "A", "payload": {"nodes": {}}}).json()["workspace"]
    assert user_b_client.get(f"/api/v1/workspaces/{created['id']}").status_code == 404
```

Also cover invalid schema versions, missing questions, update-after-delete, event pagination, unauthenticated access, and retry after a version conflict.

- [ ] **Step 2: Verify RED**

Run: `cd backend && .venv/bin/python -m pytest tests/test_learning_workspace.py -q`

Expected: FAIL with 404 for the not-yet-defined endpoints.

- [ ] **Step 3: Commit tests**

```bash
git add backend/tests/test_learning_workspace.py
git commit -m "test: define learning persistence APIs"
```

### Task 2: Add training, event, and workspace models

**Files:**
- Modify: `backend/app/models/training.py`
- Modify: `backend/app/models/__init__.py`
- Create: `backend/alembic/versions/4b91d6ec2a10_learning_sessions_events_workspaces.py`

- [ ] **Step 1: Add the minimal ORM structures**

Add `session_data: Mapped[dict] = mapped_column(JSONB, default=dict)` to `TrainingProgress`.

Add `LearningEvent` with `id`, indexed `owner_id`, indexed nullable `question_id`, `event_type`, `payload JSONB`, and `created_at`.

Add `CanvasWorkspace` with string primary key `id`, indexed `owner_id`, `title`, `schema_version`, `payload JSONB`, timestamps, and `UniqueConstraint('owner_id', 'id')`.

- [ ] **Step 2: Add the migration**

Use `down_revision = 'dac76f2151e2'` because the current workspace already contains the WeChat/payment migration. The upgrade adds `training_progress.session_data`, then creates `learning_events` and `canvas_workspaces` with owner foreign keys and indexes. The downgrade drops the new tables before dropping the column.

- [ ] **Step 3: Run model and migration checks**

Run: `cd backend && .venv/bin/python -m compileall app alembic/versions && .venv/bin/alembic upgrade head`

Expected: compile succeeds and the migration applies once without errors.

- [ ] **Step 4: Commit**

```bash
git add backend/app/models/training.py backend/app/models/__init__.py backend/alembic/versions/4b91d6ec2a10_learning_sessions_events_workspaces.py
git commit -m "feat: model learning sessions events and workspaces"
```

### Task 3: Implement owner-scoped persistence services and APIs

**Files:**
- Create: `backend/app/services/learning_service.py`
- Create: `backend/app/api/v1/learning.py`
- Modify: `backend/app/api/v1/router.py`
- Test: `backend/tests/test_learning_workspace.py`

- [ ] **Step 1: Implement session read/write compatibility**

`save_session` must verify the question belongs to the current owner, reject unsupported `schemaVersion`, update compatibility fields when supplied, commit, refresh, and return the exact `session_data`. `get_session` returns `None` when no row exists and materializes schema version 1 from compatibility columns for legacy rows.

- [ ] **Step 2: Implement events**

`append_event` creates an immutable row with `uid('le_')`; `list_events` filters by owner and optional question, orders newest-first, and caps `page_size` at 100.

- [ ] **Step 3: Implement workspace CRUD with optimistic versions**

Create returns schema version 6 and a generated `cw_` ID. Update requires the request `updatedAt` or version token to match the current value, otherwise return HTTP 409. Delete and get query by both owner and ID. Never fetch a workspace by primary key alone for user-facing methods.

- [ ] **Step 4: Add routes**

Expose:

```text
GET/PUT    /training/session/{question_id}
GET/POST   /learning/events
GET/POST   /workspaces
GET/PUT/DELETE /workspaces/{workspace_id}
```

- [ ] **Step 5: Verify GREEN**

Run: `cd backend && .venv/bin/python -m pytest tests/test_learning_workspace.py -q && .venv/bin/python -m pytest tests/ -q`

Expected: focused and full backend suites PASS.

- [ ] **Step 6: Commit**

```bash
git add backend/app/services/learning_service.py backend/app/api/v1/learning.py backend/app/api/v1/router.py backend/tests/test_learning_workspace.py
git commit -m "feat: add learning and workspace persistence APIs"
```

### Task 4: Add frontend learning APIs and frame bootstrap registry

**Files:**
- Create: `frontend/src/api/learning.ts`
- Create: `frontend/src/iframe/frameBootstrap.ts`
- Create: `frontend/scripts/frame-bootstrap.test.mjs`

- [ ] **Step 1: Write failing source-level behavior tests**

Assert that bootstrap tokens are random, single-use, page-scoped, deleted after consumption, and cleared on user changes; assert that the API exposes session, event, and workspace operations.

- [ ] **Step 2: Verify RED**

Run: `cd frontend && node --test scripts/frame-bootstrap.test.mjs`

Expected: FAIL because the modules are absent.

- [ ] **Step 3: Implement the APIs and registry**

Use `apiClient` for the exact backend endpoints. The registry stores `{page, user, state, createdAt}` under a cryptographically random token on `window.__KG_NEW_LEGACY_BOOTSTRAP__`; `consumeFrameBootstrap(token, expectedPage)` deletes and returns a matching entry, otherwise returns null.

- [ ] **Step 4: Verify GREEN**

Run: `cd frontend && node --test scripts/frame-bootstrap.test.mjs && pnpm exec tsc -b`

Expected: tests and TypeScript PASS.

- [ ] **Step 5: Commit**

```bash
git add frontend/src/api/learning.ts frontend/src/iframe/frameBootstrap.ts frontend/scripts/frame-bootstrap.test.mjs
git commit -m "feat: add learning frame bootstrap registry"
```

### Task 5: Implement the generated synchronous memory adapter

**Files:**
- Create: `frontend/scripts/new-legacy-assets/server-state-bootstrap.js`
- Modify: `frontend/scripts/sync-new-legacy.js`
- Modify: `frontend/scripts/new-legacy-sync.test.mjs`

- [ ] **Step 1: Add failing adapter tests**

Execute `server-state-bootstrap.js` in a VM with a fake parent bootstrap entry and assert Web Storage semantics, no native `localStorage` writes, page/token mismatch rejection, and emitted namespaced save messages.

- [ ] **Step 2: Verify RED**

Run: `cd frontend && node --test scripts/new-legacy-sync.test.mjs`

Expected: FAIL because `KGServerStateStorage` is absent.

- [ ] **Step 3: Implement the adapter and generated-only rewrite**

Create an in-memory ordered Map implementing `getItem`, `setItem`, `removeItem`, `clear`, `key`, and `length`. Initialize it from the single-use parent bootstrap. Emit debounced `state:changed` bridge messages with namespace, schemaVersion, and complete value. In generated JavaScript and inline page scripts only, token-safely replace `window.localStorage` and bare `localStorage` with `window.KGServerStateStorage`; do not modify upstream files or string literals.

- [ ] **Step 4: Add fail-closed storage scanning**

Compare discovered `localStorage`, `sessionStorage`, and IndexedDB sites against `new-legacy-contract.json`. Unknown sites must appear in the report and make sync exit non-zero.

- [ ] **Step 5: Verify GREEN**

Run: `cd frontend && node --test scripts/new-legacy-sync.test.mjs && pnpm sync:new-legacy`

Expected: adapter tests PASS, native business storage is absent from generated learning scripts, and upstream hashes remain unchanged.

- [ ] **Step 6: Commit**

```bash
git add frontend/scripts/new-legacy-assets/server-state-bootstrap.js frontend/scripts/sync-new-legacy.js frontend/scripts/new-legacy-sync.test.mjs frontend/public/new-legacy frontend/new-legacy-manifest.json frontend/new-legacy-sync-report.json
git commit -m "feat: bridge legacy state through memory storage"
```

### Task 6: Connect training and workspace frames to PostgreSQL

**Files:**
- Modify: `frontend/src/routes/NewLegacyFrame.tsx`
- Modify: `frontend/src/routes/QuestionWorkspace.tsx`
- Modify: `frontend/src/routes/Training.tsx`
- Create: `frontend/src/iframe/trainingFrameAdapter.ts`
- Create: `frontend/src/iframe/workspaceFrameAdapter.ts`
- Create: `frontend/scripts/training-frame-contract.test.mjs`

- [ ] **Step 1: Write failing preload/save/retry tests**

Cover published-paper preload, per-question session preload, workspace catalog preload, successful save acknowledgement, failed save retaining dirty state, retry, and user-switch teardown.

- [ ] **Step 2: Verify RED**

Run: `cd frontend && node --test scripts/training-frame-contract.test.mjs`

Expected: FAIL because the frame adapters are absent.

- [ ] **Step 3: Implement focused adapters**

The training adapter loads published papers and question details through `papersApi`, loads sessions lazily by question, and maps state changes to `learningApi.saveSession` and `appendEvent`. The workspace adapter loads the catalog and selected payload, then maps create/rename/delete/save messages to workspace APIs. Both send `save:pending`, `save:success`, and `save:error` responses using the original request ID.

- [ ] **Step 4: Replace the React training body with the original frame**

Keep the `/training` route name but render `NewLegacyFrame` for `question-training.html`; retain the old React implementation only in Git history, not as a hidden production path. Preserve `paper`, `question`, `bank`, `workspace`, and `source` query parameters.

- [ ] **Step 5: Verify GREEN**

Run: `cd frontend && node --test scripts/training-frame-contract.test.mjs && pnpm exec tsc -b && pnpm build`

Expected: contract tests, types, and build PASS.

- [ ] **Step 6: Commit**

```bash
git add frontend/src/routes/NewLegacyFrame.tsx frontend/src/routes/QuestionWorkspace.tsx frontend/src/routes/Training.tsx frontend/src/iframe/trainingFrameAdapter.ts frontend/src/iframe/workspaceFrameAdapter.ts frontend/scripts/training-frame-contract.test.mjs
git commit -m "feat: persist original training and workspace engines"
```

