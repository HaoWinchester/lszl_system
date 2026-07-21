# Unified new-legacy Runtime Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the mixed React/iframe frontend with directly served `new-legacy` pages backed by the existing FastAPI/PostgreSQL services, plus deterministic version import, promotion, and rollback.

**Architecture:** FastAPI serves the active generated `new-legacy` release and injects a request-scoped bootstrap before upstream scripts. Project-owned plain JavaScript adapters preserve the synchronous upstream runtime shape while persisting authenticated business state through domain APIs. A Node release manager imports immutable upstream bundles, builds isolated candidates, runs compatibility checks, and atomically changes the active manifest.

**Tech Stack:** FastAPI, Starlette, SQLAlchemy async, PostgreSQL, plain JavaScript, Node.js test runner, pytest, Playwright.

---

## File map

- `manage-new-legacy` — user-facing release command.
- `frontend/scripts/manage-new-legacy.js` — release import/status/promote/rollback implementation.
- `frontend/scripts/new-legacy-release.test.mjs` — release-manager contract tests.
- `frontend/new-legacy-releases/current.json` — atomic active-release pointer; generated.
- `backend/app/web/releases.py` — validates and resolves active/candidate releases.
- `backend/app/web/bootstrap.py` — constructs request-scoped page bootstrap.
- `backend/app/web/routes.py` — direct HTML, static asset, alias, preview, and runtime-state routes.
- `backend/app/web/html.py` — safe JSON/bootstrap injection into generated HTML.
- `backend/app/web/schemas.py` — runtime state request/response schemas.
- `backend/tests/test_web_runtime.py` — direct-serving, alias, injection, preview, and traversal tests.
- `frontend/scripts/new-legacy-assets/server-state-bootstrap.js` — direct-page synchronous storage plus queued API persistence.
- `frontend/scripts/new-legacy-assets/direct-navigation.js` — stable aliases and login/member query handling without React.
- `frontend/scripts/direct-runtime.test.mjs` — plain-JS runtime contract tests.
- `backend/app/main.py` — mounts web routes after `/api/v1`.
- `frontend/package.json` — removes React runtime/build and exposes release tests.
- `frontend/src/**` — removed after cutover; recovery remains in Git history/tag.
- `frontend/e2e/direct_new_legacy_smoke.py` — role and navigation regression.
- `docs/new-legacy-updates.md` — operator update/rollback guide.

### Task 0: Preserve the current working application

**Files:**
- Snapshot: `backend/**`
- Snapshot: `frontend/**`
- Snapshot: `new-legacy/**`

- [ ] **Step 1: Run the current mixed-runtime regression gate**

Run: `cd backend && .venv/bin/python -m pytest tests/ -q && cd ../frontend && node --test scripts/*.test.mjs && pnpm exec tsc -b`  
Expected: all current backend, bridge, and TypeScript checks PASS.

- [ ] **Step 2: Commit the current implementation checkpoint**

```bash
git add backend frontend new-legacy
git commit -m "chore: checkpoint new-legacy integration before direct cutover"
```

- [ ] **Step 3: Create a recovery tag**

Run: `git tag pre-unified-new-legacy-runtime`  
Expected: `git rev-parse pre-unified-new-legacy-runtime` equals `git rev-parse HEAD`.

### Task 1: Release import, manifest, promotion, and rollback

**Files:**
- Create: `manage-new-legacy`
- Create: `frontend/scripts/manage-new-legacy.js`
- Create: `frontend/scripts/new-legacy-release.test.mjs`
- Modify: `frontend/scripts/sync-new-legacy.js`
- Modify: `.gitignore`

- [ ] **Step 1: Write failing release-manager tests**

```js
test('update builds an isolated release and atomically selects it', () => {
  const result = run('update', source)
  assert.equal(result.status, 0)
  assert.equal(readJson('current.json').version, 'v8.6.0')
  assert.ok(existsSync(releasePath('v8.6.0', 'site', 'learning-path.html')))
})

test('a conflicting version hash fails without changing current', () => {
  const before = readJson('current.json')
  assert.notEqual(run('update', conflictingSource).status, 0)
  assert.deepEqual(readJson('current.json'), before)
})

test('rollback selects the previous successful release', () => {
  run('update', v1)
  run('update', v2)
  assert.equal(run('rollback').status, 0)
  assert.equal(readJson('current.json').version, 'v1.0.0')
})
```

- [ ] **Step 2: Run the tests and verify the missing command fails**

Run: `cd frontend && node --test scripts/new-legacy-release.test.mjs`  
Expected: FAIL because `manage-new-legacy.js` does not exist.

- [ ] **Step 3: Implement the release manager**

```js
function atomicJson(path, value) {
  const temporary = `${path}.${process.pid}.tmp`
  writeFileSync(temporary, `${JSON.stringify(value, null, 2)}\n`)
  renameSync(temporary, path)
}

function promote(registry, release) {
  atomicJson(registry.currentPath, {
    schemaVersion: 1,
    version: release.version,
    previousVersion: registry.current?.version ?? null,
    site: release.site,
    sourceHash: release.sourceHash,
  })
}
```

The command must support `inspect`, `update`, `promote`, `rollback`, and `status`; acquire an exclusive lock before import; call the existing deterministic sync script into `<release>/site`; preserve immutable `<release>/source`; reject same-version/different-hash input; and only change `current.json` after build and contract tests succeed.

- [ ] **Step 4: Run release tests**

Run: `cd frontend && node --test scripts/new-legacy-release.test.mjs scripts/new-legacy-sync.test.mjs`  
Expected: all tests PASS.

- [ ] **Step 5: Import the current v8.6.0 bundle**

Run: `./manage-new-legacy update ./new-legacy --skip-browser`  
Expected: active manifest identifies `v8.6.0`; source and site hashes are recorded.

- [ ] **Step 6: Commit the release subsystem**

```bash
git add manage-new-legacy .gitignore frontend/scripts/manage-new-legacy.js frontend/scripts/new-legacy-release.test.mjs frontend/scripts/sync-new-legacy.js
git commit -m "feat: add new-legacy release manager"
```

### Task 2: Direct FastAPI page and asset serving

**Files:**
- Create: `backend/app/web/__init__.py`
- Create: `backend/app/web/releases.py`
- Create: `backend/app/web/html.py`
- Create: `backend/app/web/routes.py`
- Create: `backend/tests/test_web_runtime.py`
- Modify: `backend/app/main.py`
- Modify: `backend/app/core/config.py`

- [ ] **Step 1: Write failing direct-serving tests**

```python
def test_root_serves_learning_path_without_iframe(client):
    response = client.get("/")
    assert response.status_code == 200
    assert 'class="guided-learning-page"' in response.text
    assert "<iframe" not in response.text
    assert "react" not in response.text.lower()

def test_graph_alias_preserves_free_mode(client):
    response = client.get("/graph", follow_redirects=False)
    assert response.headers["location"] == "/index.html?mode=free"

def test_asset_traversal_is_rejected(client):
    assert client.get("/src/../../backend/app/main.py").status_code == 404
```

- [ ] **Step 2: Verify tests fail against the API-only app**

Run: `cd backend && .venv/bin/python -m pytest tests/test_web_runtime.py -q`  
Expected: FAIL because `/` and the web resolver do not exist.

- [ ] **Step 3: Implement an active release resolver and direct routes**

```python
ALIASES = {
    "/": ("learning-path.html", None),
    "/graph": ("index.html", "mode=free"),
    "/training": ("question-training.html", None),
    "/workspace": ("question-workspace.html", None),
    "/files": ("file-manager.html", None),
    "/question-bank": ("question-bank.html", None),
    "/recall": ("knowledge-recall.html", None),
    "/users": ("user-management.html", None),
    "/settings": ("system-settings.html", None),
}

def resolve_asset(root: Path, relative: str) -> Path:
    candidate = (root / relative).resolve()
    if not candidate.is_relative_to(root.resolve()) or not candidate.is_file():
        raise HTTPException(status_code=404)
    return candidate
```

Register API routes first, then the web catch-all. Return original MIME types and no-cache HTML headers; hashed/static assets may use immutable cache headers. Preview resolution must be version-scoped and must never mutate the current pointer.

- [ ] **Step 4: Run direct-serving and existing backend tests**

Run: `cd backend && .venv/bin/python -m pytest tests/test_web_runtime.py tests/test_smoke.py -q`  
Expected: PASS.

- [ ] **Step 5: Commit direct serving**

```bash
git add backend/app/web backend/app/main.py backend/app/core/config.py backend/tests/test_web_runtime.py
git commit -m "feat: serve active new-legacy release directly"
```

### Task 3: Request bootstrap and direct synchronous storage

**Files:**
- Create: `backend/app/web/bootstrap.py`
- Create: `backend/app/web/schemas.py`
- Modify: `backend/app/web/html.py`
- Modify: `backend/app/web/routes.py`
- Modify: `frontend/scripts/new-legacy-assets/server-state-bootstrap.js`
- Create: `frontend/scripts/direct-runtime.test.mjs`
- Modify: `backend/tests/test_web_runtime.py`

- [ ] **Step 1: Write failing bootstrap tests**

```python
def test_html_injects_user_before_state_bootstrap(authenticated_client):
    response = authenticated_client.get("/learning-path.html")
    marker = "window.__KG_DIRECT_BOOTSTRAP__="
    assert marker in response.text
    assert response.text.index(marker) < response.text.index("server-state-bootstrap.js")
    assert "佩奇007" in response.text

def test_runtime_state_requires_same_session(client):
    response = client.put("/api/v1/runtime/state", json={"namespace": "files", "revision": 0, "storage": {}})
    assert response.status_code == 401
```

```js
test('direct bootstrap never posts to a parent window', () => {
  assert.doesNotMatch(source, /parent\.postMessage/)
  assert.match(source, /fetch\('\/api\/v1\/runtime\/state'/)
})
```

- [ ] **Step 2: Run tests and verify they fail**

Run: `cd backend && .venv/bin/python -m pytest tests/test_web_runtime.py -q && cd ../frontend && node --test scripts/direct-runtime.test.mjs`  
Expected: FAIL because direct bootstrap and runtime-state routes are absent.

- [ ] **Step 3: Implement safe bootstrap injection**

```python
def inject_bootstrap(html: str, payload: dict[str, Any]) -> str:
    encoded = json.dumps(payload, ensure_ascii=False).replace("<", "\\u003c")
    script = f"<script>window.__KG_DIRECT_BOOTSTRAP__={encoded}</script><!-- kg-direct-bootstrap -->"
    marker = '<script src="./server-state-bootstrap.js"></script>'
    if marker not in html:
        raise RuntimeError("generated page is missing server-state-bootstrap.js")
    return html.replace(marker, f"{script}\n{marker}", 1)
```

- [ ] **Step 4: Replace parent messaging with queued same-origin persistence**

```js
const entry = global.__KG_DIRECT_BOOTSTRAP__ || { state: { storage: {} } }

async function flush() {
  const response = await fetch('/api/v1/runtime/state', {
    method: 'PUT', credentials: 'include',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ page, ...lastMutation, storage: snapshot() }),
  })
  if (!response.ok) throw new Error(`保存失败 (${response.status})`)
}
```

Use one in-flight request, trailing-edge coalescing, idempotency IDs, `pagehide` beacon fallback, visible `kg:save-state` events, and no authenticated fallback to browser persistence.

- [ ] **Step 5: Run bootstrap tests**

Run: `cd backend && .venv/bin/python -m pytest tests/test_web_runtime.py -q && cd ../frontend && node --test scripts/direct-runtime.test.mjs`  
Expected: PASS.

- [ ] **Step 6: Commit direct bootstrap**

```bash
git add backend/app/web backend/tests/test_web_runtime.py frontend/scripts/new-legacy-assets/server-state-bootstrap.js frontend/scripts/direct-runtime.test.mjs
git commit -m "feat: bootstrap new-legacy pages from FastAPI"
```

### Task 4: Domain-backed runtime state

**Files:**
- Modify: `backend/app/web/bootstrap.py`
- Modify: `backend/app/web/routes.py`
- Create: `backend/app/services/runtime_state_service.py`
- Create: `backend/tests/test_runtime_state.py`
- Create: `frontend/scripts/new-legacy-assets/direct-graph-adapter.js`
- Modify: `frontend/scripts/new-legacy-assets/guided-learning-data-bridge.js`

- [ ] **Step 1: Write failing per-domain persistence tests**

```python
@pytest.mark.parametrize("page,namespace", [
    ("index.html", "files"),
    ("learning-path.html", "guided-learning"),
    ("question-training.html", "training"),
    ("question-workspace.html", "workspace"),
    ("question-bank.html", "questions"),
    ("knowledge-recall.html", "recall"),
    ("user-management.html", "users"),
    ("system-settings.html", "system"),
])
def test_page_bootstrap_declares_server_namespace(authenticated_client, page, namespace):
    payload = extract_bootstrap(authenticated_client.get(f"/{page}").text)
    assert payload["namespace"] == namespace
```

- [ ] **Step 2: Verify the tests fail**

Run: `cd backend && .venv/bin/python -m pytest tests/test_runtime_state.py -q`  
Expected: FAIL because page/domain mapping is incomplete.

- [ ] **Step 3: Implement explicit page/domain loaders and savers**

```python
PAGE_NAMESPACES = {
    "index.html": "files",
    "learning-path.html": "guided-learning",
    "guided-learning-node.html": "guided-learning",
    "guided-learning-placement-test.html": "guided-learning",
    "question-training.html": "training",
    "question-workspace.html": "workspace",
    "question-bank.html": "questions",
    "knowledge-recall.html": "recall",
    "user-management.html": "users",
    "system-settings.html": "system",
}
```

Each loader must call the existing owner-scoped service rather than query unrelated tables. Each saver must validate a known storage-key allowlist, dispatch to existing domain service methods, refresh written ORM entities, and return the new revision. Unknown keys must return 422 and never be silently persisted as an opaque user blob.

- [ ] **Step 4: Make graph operations call files APIs directly**

```js
async function saveGraph(id, graphData) {
  const response = await fetch(`/api/v1/files/${encodeURIComponent(id)}`, {
    method: 'PUT', credentials: 'include',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ graphData }),
  })
  if (!response.ok) throw new Error(`图谱保存失败 (${response.status})`)
  return response.json()
}
```

The direct graph adapter must be injected after `src/23-graph-file-store.js` and must not reference `window.parent`, `postMessage`, or query-string user impersonation.

- [ ] **Step 5: Run all backend and adapter tests**

Run: `cd backend && .venv/bin/python -m pytest tests/ -q && cd ../frontend && node --test scripts/*.test.mjs`  
Expected: all tests PASS.

- [ ] **Step 6: Commit runtime domains**

```bash
git add backend/app/web backend/app/services/runtime_state_service.py backend/tests/test_runtime_state.py frontend/scripts/new-legacy-assets frontend/scripts/*.test.mjs
git commit -m "feat: persist direct new-legacy runtime state"
```

### Task 5: Remove React runtime and make one-address startup

**Files:**
- Modify: `frontend/package.json`
- Delete: `frontend/src/**`
- Delete: `frontend/index.html`
- Delete: `frontend/vite.config.ts`
- Delete: `frontend/tsconfig*.json`
- Delete: `frontend/scripts/new-legacy-assets/new-legacy-navigation-bridge.js`
- Modify: `frontend/scripts/sync-new-legacy.js`
- Modify: `backend/app/main.py`
- Create: `scripts/dev.sh`
- Create: `backend/tests/test_no_mixed_frontend.py`

- [ ] **Step 1: Write a failing no-mixed-runtime test**

```python
def test_production_tree_has_no_react_or_iframe_host():
    package = json.loads((ROOT / "frontend/package.json").read_text())
    assert "react" not in package.get("dependencies", {})
    assert not (ROOT / "frontend/src/App.tsx").exists()
    assert "new-legacy-navigation-bridge.js" not in generated_assets()
```

- [ ] **Step 2: Verify the test fails**

Run: `cd backend && .venv/bin/python -m pytest tests/test_no_mixed_frontend.py -q`  
Expected: FAIL because React and iframe routing are still active.

- [ ] **Step 3: Remove the React build and navigation bridge**

The remaining frontend package must only contain Node-based release/build/test tooling. `sync-new-legacy.js` must inject direct bootstrap/runtime assets, never the React navigation bridge or frame token. `scripts/dev.sh` must run migrations and then `uvicorn app.main:app --reload --port 5173` from `backend/`.

- [ ] **Step 4: Reinstall and run no-mixed tests**

Run: `cd frontend && pnpm install && node --test scripts/*.test.mjs && cd ../backend && .venv/bin/python -m pytest tests/test_no_mixed_frontend.py -q`  
Expected: PASS; lockfile contains no React runtime packages.

- [ ] **Step 5: Commit the cutover**

```bash
git add -A frontend scripts/dev.sh backend/app/main.py backend/tests/test_no_mixed_frontend.py
git commit -m "refactor: cut over to direct new-legacy frontend"
```

### Task 6: Browser, visual, update, and rollback acceptance

**Files:**
- Create: `frontend/e2e/direct_new_legacy_smoke.py`
- Create: `frontend/e2e/direct_new_legacy_visual.py`
- Modify: `frontend/scripts/manage-new-legacy.js`
- Create: `docs/new-legacy-updates.md`

- [ ] **Step 1: Add role and route browser assertions**

```python
for username, role in ACCOUNTS:
    login(page, username, "111111")
    assert current_role(page) == role
    open_and_assert(page, "/", "学习模式")
    click_in_page(page, "自由模式")
    assert "index.html" in page.url and "mode=free" in page.url
    assert page.locator("iframe").count() == 0
```

Cover all canonical pages, direct aliases, logout, file save/reload, guided completion, training state, workspace, role-restricted controls, and 401/403 behavior.

- [ ] **Step 2: Run browser smoke and fix only evidence-backed failures**

Run: `cd frontend && python3 e2e/direct_new_legacy_smoke.py --base-url http://127.0.0.1:5173`  
Expected: all roles and routes PASS.

- [ ] **Step 3: Compare integrated pages with the raw upstream version**

Run: `cd frontend && python3 e2e/direct_new_legacy_visual.py --integrated http://127.0.0.1:5173 --raw http://127.0.0.1:8010`  
Expected: no unexplained layout, typography, spacing, or control differences at desktop and mobile viewports.

- [ ] **Step 4: Prove upgrade failure and rollback safety**

Run: `./manage-new-legacy update frontend/e2e/fixtures/incompatible-new-legacy`  
Expected: non-zero status and active version unchanged.

Run: `./manage-new-legacy rollback && ./manage-new-legacy status`  
Expected: previous successful version is active and health check passes.

- [ ] **Step 5: Write the operator guide**

Document the one-address startup, `inspect`, `update`, preview, `status`, and `rollback` commands; release directories; compatibility-report fields; backup expectations; and recovery procedure.

- [ ] **Step 6: Run the final gate**

Run: `cd backend && .venv/bin/python -m pytest tests/ -q && cd ../frontend && node --test scripts/*.test.mjs && python3 e2e/direct_new_legacy_smoke.py --base-url http://127.0.0.1:5173`  
Expected: all backend, release, contract, and browser tests PASS.

- [ ] **Step 7: Commit acceptance and operations**

```bash
git add frontend/e2e frontend/scripts/manage-new-legacy.js docs/new-legacy-updates.md
git commit -m "test: verify direct frontend upgrades and rollback"
```
