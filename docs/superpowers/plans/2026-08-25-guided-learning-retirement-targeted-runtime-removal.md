# Guided Learning Retirement and Targeted Runtime Removal Implementation Plan

> **For Codex:** Execute this plan inline in the current isolated worktree. Follow TDD: add each contract first, observe the intended failure, implement the minimum change, then rerun the focused test before continuing.

**Goal:** Retire the obsolete guided-learning learner flow and remove `/api/v1/runtime/*` traffic from graph, file manager, practice, recall, multi-question workspace, retired training, and their login flows while preserving password login, WeChat OAuth/binding/configuration/payment, teacher/admin draft compatibility, and database-backed learner data.

**Architecture:** A shared backend JSON policy defines the only pages still allowed to receive the runtime shim. FastAPI always injects lightweight auth/release metadata through an inert HTML anchor, but reads runtime state only for allowlisted teacher/admin pages. Learner pages use existing domain adapters; the canvas workspace store gains a shared server hydration boundary and a coalescing `/api/v1/workspaces` adapter before runtime is disabled. Obsolete guided-learning URLs become inert redirect shells and the API/seed entry points are disabled without dropping historical tables.

**Tech Stack:** FastAPI, SQLAlchemy async, PostgreSQL, native HTML/CSS/JavaScript, Node test runner, Python pytest/TestClient, Playwright browser checks, immutable new-legacy release manager.

---

## Task 1: Freeze the page policy and retirement contracts

**Files:**

- Create: `backend/app/web/runtime_page_policy.json`
- Create: `frontend/scripts/runtime-retirement-contract.test.mjs`
- Modify: `frontend/scripts/design-contract.test.mjs`
- Modify: `frontend/scripts/new-legacy-sync.test.mjs`
- Modify: `backend/tests/test_web_runtime.py`

**Step 1: Write failing contracts**

- Define the intended teacher/admin runtime allowlist in the test fixture.
- Assert learner targets and guided-learning redirect shells are absent from the allowlist.
- Assert generated learner pages contain `kg-direct-bootstrap-anchor` but no `server-state-bootstrap.js`.
- Assert an allowlisted teacher page contains both the anchor and runtime script.
- Assert FastAPI learner page bootstrap does not call `runtime_state_service.get_state` or `ensure_domain_seed`.

**Step 2: Run RED**

Run:

```bash
cd frontend && node --test scripts/runtime-retirement-contract.test.mjs scripts/design-contract.test.mjs scripts/new-legacy-sync.test.mjs
cd backend && .venv/bin/python -m pytest tests/test_web_runtime.py -q
```

Expected: failures show all non-landing pages still receive the runtime shim and FastAPI still reads runtime for learner pages.

**Step 3: Add the shared policy file**

- Store `schemaVersion` and explicit `runtimePages` only.
- Include current teacher/admin authoring pages that still have unmigrated draft/runtime consumers.
- Exclude graph, learner pages, help/legal/engagement pages, all guided-learning learner pages, and `workbench.html`.

**Step 4: Keep focused tests failing only on missing implementation**

Run the same focused commands and confirm the policy-shape assertions pass while injection/bootstrap assertions remain red.

## Task 2: Split auth bootstrap from runtime bootstrap

**Files:**

- Modify: `backend/app/web/bootstrap.py`
- Modify: `backend/app/web/html.py`
- Modify: `backend/app/web/routes.py`
- Modify: `backend/tests/test_web_runtime.py`
- Modify: `backend/tests/test_runtime_state.py`

**Step 1: Implement policy loading once**

- Load and validate `runtime_page_policy.json` from `backend/app/web/` at module import.
- Expose `runtime_enabled_for_page(page)` as the single backend decision.
- Keep namespace data only for runtime-enabled pages plus harmless response metadata.

**Step 2: Skip runtime state for non-allowlisted pages**

- Always resolve the optional user and inject auth metadata.
- Only call `get_state`, `ensure_domain_seed`, and inline storage for allowlisted pages.
- For learner pages return revision/contentRevision `0` and storage `null`.

**Step 3: Make HTML injection anchor-based**

- Insert `window.__KG_DIRECT_BOOTSTRAP__` at `<!-- kg-direct-bootstrap-anchor -->`.
- Retain the old runtime-script marker only as a compatibility fallback for allowlisted/older releases.
- Never require a runtime script on a learner page.

**Step 4: Update obsolete runtime tests**

- Remove guided-learning and learner-page expectations that require runtime storage.
- Keep full coverage for allowlisted teacher/admin runtime behavior and generic runtime routes.

**Step 5: Run GREEN**

Run:

```bash
cd backend && .venv/bin/python -m pytest tests/test_web_runtime.py tests/test_runtime_state.py -q
```

Expected: all pass; learner HTML contains auth bootstrap but no runtime state load.

## Task 3: Make sync injection policy-driven

**Files:**

- Modify: `frontend/scripts/sync-new-legacy.js`
- Modify: `frontend/scripts/new-legacy-sync.test.mjs`
- Modify: `frontend/scripts/design-contract.test.mjs`
- Modify: `frontend/scripts/new-legacy-release.test.mjs`
- Modify: `frontend/scripts/runtime-retirement-contract.test.mjs`

**Step 1: Read the backend policy in the synchronizer**

- Parse the shared JSON from `backend/app/web/runtime_page_policy.json`.
- Fail closed on invalid schema, duplicate names, missing `.html`, or learner targets in the allowlist.

**Step 2: Inject an anchor into every business page**

- Keep landing free of business adapters.
- Add `kg-direct-bootstrap-anchor`, runtime config, direct entry, teaching-content sync, and analytics as appropriate.
- Add `server-state-bootstrap.js` only when `runtimePages` contains the page.

**Step 3: Preserve ordering and versioning**

- Keep the bootstrap anchor before deferred auth/system/domain adapters.
- Do not add a version query to `server-state-bootstrap.js` on allowlisted pages.
- Keep `workbench.html` identical to the no-runtime graph output.

**Step 4: Run GREEN**

Run:

```bash
cd frontend && node --test scripts/runtime-retirement-contract.test.mjs scripts/design-contract.test.mjs scripts/new-legacy-sync.test.mjs scripts/new-legacy-release.test.mjs
```

## Task 4: Retire the guided-learning learner flow

**Files:**

- Modify: `new-legacy/learning-path.html`
- Modify: `new-legacy/guided-learning-node.html`
- Modify: `new-legacy/guided-learning-placement-test.html`
- Modify: `new-legacy/file-manager.html`
- Modify: exclusive guided-learning JS/CSS files only after reference audit
- Modify: `frontend/scripts/new-legacy-contract.json`
- Modify: guided-learning-specific frontend tests into retirement contracts
- Modify: `backend/app/web/routes.py`
- Modify: `backend/app/api/v1/router.py`
- Modify: `backend/app/main.py`
- Modify: guided-learning backend route tests

**Step 1: Write redirect and no-entry tests**

- Assert all five old URL forms return 307 to `/practice-mode.html` without forwarding `node` or `part`.
- Assert file manager and active product pages contain no `learning-path.html` navigation.
- Assert the three source pages are minimal script-free redirect shells.
- Assert `/api/v1/guided-learning/*` is no longer registered.

**Step 2: Run RED**

Run focused backend and frontend retirement tests and observe node/placement routes, product entry, seed/API registration, and page bodies fail.

**Step 3: Implement retirement**

- Replace the three page bodies with accessible noscript/meta-refresh links to practice mode and no business JavaScript.
- Redirect exact `.html` paths and aliases in FastAPI.
- Stop startup seed and API router inclusion.
- Preserve ORM definitions/tables and shared teacher content modules.
- Convert only truly exclusive assets to inert same-name tombstones so release file count cannot regress.

**Step 4: Run GREEN**

Run the focused retirement contracts and guided API retirement tests.

## Task 5: Preserve WeChat and system capabilities without runtime storage

**Files:**

- Modify: `new-legacy/src/32-wechat-login.js`
- Modify: `frontend/scripts/new-legacy-assets/direct-system-adapter.js`
- Modify: `frontend/scripts/wechat-login-contract.test.mjs`
- Modify: `frontend/scripts/wechat-pay-contract.test.mjs`
- Modify: `frontend/scripts/direct-runtime.test.mjs`
- Modify: `backend/tests/test_wechat_auth.py` only if redirect expectations require the retired route mapping

**Step 1: Write failing contracts**

- Assert public WeChat availability comes from `/api/v1/auth/wechat/config`.
- Assert OAuth still starts at `/api/v1/auth/wechat/auth-url` and callback/binding APIs remain.
- Assert neither WeChat module nor direct system adapter reads/writes `kg_wechat_login_config_v1` through `KGServerStateStorage`.
- Assert direct-system adapter initializes plan prices, entitlements, themes, and WeChat pay even when `KGServerStateStorage` is undefined.

**Step 2: Implement a runtime-independent system adapter**

- Remove the `!storage` early-return dependency.
- Use API/in-memory values for remote plan settings and WeChat admin settings.
- Keep role theme compatibility on native browser storage only where the legacy synchronous role UI requires it; never send those writes to runtime.
- Keep all payment methods and server endpoints unchanged.

**Step 3: Implement async public WeChat configuration**

- Add a cached `loadConfig()` promise backed by `/api/v1/auth/wechat/config`.
- Render/enable the QR entry from the server result and retain password-login fallback on failure.
- Keep AppSecret/token/code outside browser persistence.

**Step 4: Run GREEN**

Run:

```bash
cd frontend && node --test scripts/wechat-login-contract.test.mjs scripts/wechat-pay-contract.test.mjs scripts/direct-runtime.test.mjs
cd backend && .venv/bin/python -m pytest tests/test_wechat_auth.py -q
```

## Task 6: Cut CanvasWorkspace over to `/api/v1/workspaces`

**Files:**

- Modify: `backend/app/services/learning_service.py`
- Modify: `backend/tests/test_learning_api.py` or the existing workspace API test module
- Modify: `new-legacy/src/65-canvas-workspace-store.js`
- Modify: `new-legacy/src/77-multi-question-workspace.js`
- Modify: `new-legacy/src/80-file-manager-workspace-library.js`
- Create: `frontend/scripts/new-legacy-assets/canvas-workspace-adapter.js`
- Create: `frontend/scripts/canvas-workspace-adapter.test.mjs`
- Modify: `frontend/scripts/sync-new-legacy.js`
- Modify: `frontend/scripts/new-legacy-release.test.mjs`

**Step 1: Write backend schema RED**

- Assert create/update accepts the current workspace schema v10, preserves payload, and remains owner-isolated.
- Assert list/get return v10 payload and delete cannot affect another owner.

**Step 2: Expand the existing domain boundary**

- Extend allowed workspace schema versions through v10 without weakening payload/type validation.
- Run focused backend workspace tests to GREEN.

**Step 3: Write frontend adapter RED**

- Assert one initial `GET /api/v1/workspaces` hydrates the store before page initialization.
- Assert store writes coalesce to at most one pending PUT per workspace.
- Assert first save POSTs a missing workspace, later saves PUT it, and delete calls DELETE.
- Assert 401 stays read-only/local without synthesizing server success; retryable failures keep the latest dirty snapshot.
- Assert no call touches `/api/v1/runtime/*`.

**Step 4: Add a shared store hydration primitive**

- Add `replaceAllFromServer(workspaces, options)` to the common workspace store.
- Replace the authenticated user catalog atomically, preserve only device-level active selection when still valid, and avoid emitting persistence writes during hydration.

**Step 5: Implement the coalescing adapter**

- Hydrate from the list endpoint before consumers initialize.
- Subscribe once to workspace change events.
- Debounce and serialize writes per workspace; POST unknown IDs, PUT known IDs, DELETE retired IDs.
- Flush the newest pending payload with `keepalive` on pagehide.
- Expose `ready`, `flush`, `refresh`, and save-state events.

**Step 6: Gate the two consumers**

- Await adapter readiness at the start of multi-question workspace initialization.
- Initialize the file-manager workspace library only after readiness.
- Inject the adapter immediately after `65-canvas-workspace-store.js` on the two learner consumers, not on teacher course admin.

**Step 7: Run GREEN**

Run adapter, sync, release, and focused workspace source tests.

## Task 7: Regenerate artifacts and prove zero runtime traffic

**Files:**

- Modify generated `frontend/public/new-legacy/**` only through sync
- Modify generated manifests and sync report through sync
- Create or modify a Playwright browser regression under `new-legacy/tests/`
- Modify `frontend/scripts/runtime-removal-baseline.json` only through the documented inventory updater if occurrences decrease

**Step 1: Run canonical sync**

```bash
cd frontend && pnpm sync:new-legacy
```

**Step 2: Static request audit**

- Assert target generated HTML has no runtime bootstrap.
- Assert target source/adapters have no direct `/api/v1/runtime/*` call.
- Assert teacher allowlist pages still retain their compatibility shim.

**Step 3: Browser request audit**

- Start FastAPI against the test database/release.
- Visit graph/workbench, file manager, practice, recall, multi-question workspace, retired training, and all three retired guided URLs.
- Exercise password login, refresh, account menu, logout, workspace create/update/delete, and domain reads/writes.
- Stub only the external WeChat provider/SDK boundary; exercise server config, QR container, retry, and callback-result UI.
- Capture requests and assert zero `/api/v1/runtime/` requests on target pages.

**Step 4: Run focused suites**

```bash
cd backend && .venv/bin/python -m pytest tests/test_web_runtime.py tests/test_runtime_state.py tests/test_wechat_auth.py -q
cd frontend && pnpm test
```

## Task 8: Build, verify, merge, push, and deploy UAT

**Files:**

- Modify: `new-legacy/VERSION`
- Generated: `frontend/new-legacy-releases/<version>/site/**`
- Generated: `frontend/new-legacy-releases/current.json`

**Step 1: Full verification**

```bash
cd backend && .venv/bin/python -m pytest tests/ -q
cd frontend && pnpm test
cd frontend && pnpm test:design
```

**Step 2: Build immutable release**

```bash
node frontend/scripts/manage-new-legacy.js update new-legacy --skip-browser
```

- Confirm candidate and active site file counts are aligned.
- Confirm `admin-console.html`, `index.html`, `practice-mode.html`, `src/32-wechat-login.js`, and runtime policy behavior.

**Step 3: Commit feature changes**

- Stage only this feature and generated release artifacts.
- Commit with a focused message.

**Step 4: Integrate to UAT**

- Fast-forward or merge `codex/runtime-retirement` into `uat` without discarding unrelated work.
- Push with `git -c http.proxy=http://127.0.0.1:7897 push origin uat`.
- Verify the remote hash with `git ls-remote`.

**Step 5: Deploy UAT without backup**

- Use the existing `deploy/update-uat.sh` path only.
- Verify health, release version, redirects, password login, WeChat UI/config boundary, domain writes, and zero target runtime traffic.
- Do not run `deploy/update.sh` and do not deploy production.

