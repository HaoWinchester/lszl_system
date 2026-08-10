# Admin Navigation and Login Entry Chooser Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make the four administrator dashboard metrics navigate to their corresponding management pages and show a four-choice learning-entry dialog exactly once on the first knowledge-graph visit after every successful login.

**Architecture:** Issue a new opaque login-session ID for every successful authentication and expose it through existing auth/bootstrap responses. The graph entry compares that ID with a same-origin consumed marker and atomically claims the one-time dialog across tabs. Dashboard KPI cards become semantic links while retaining the existing DOM classes and visual layout.

**Tech Stack:** FastAPI signed sessions, Pydantic, native JavaScript, existing `new-legacy` HTML/CSS, localStorage, BroadcastChannel, Navigator Locks API with deterministic fallback, Node contract tests, Playwright.

## Global Constraints

- Every successful password login, registration auto-login, demo login, and WeChat login receives a fresh unpredictable login-session ID.
- Page refresh, `/me`, and server bootstrap preserve the same ID until logout or the next successful login.
- The chooser is shown to every role on the first knowledge-graph visit after login, including administrator, teacher, student, and viewer.
- The chooser appears at most once per login across multiple same-origin tabs.
- The dialog has no cancel/close affordance; Escape and backdrop clicks do not dismiss it. A choice navigates immediately.
- Four choices and destinations are fixed: 知识图谱 → current graph; 知识回忆 → 深度回忆; 知识归纳 → 归纳; 知识巩固 → 刷题.
- The current graph remains usable after choosing 知识图谱; the other three choices use same-origin application routes.
- Dashboard mappings are fixed: 科目总数 → subject management; 当前科目 → current-subject view; 题目总数 → question list; 试卷/学习任务 → two explicit links.
- Preserve the legacy visual DOM/class contract; additions reuse existing modal/card/link classes or narrowly scoped new classes.
- Modify `new-legacy/` source, not `legacy/` or the active release site.
- Cross-page authentication behavior must be tested on every relevant learning/management page before release.
- This is plan 4 of 4.

---

## File Structure

### Backend authentication

- Modify `backend/app/core/auth.py`: create/read/clear signed-session `login_session_id`.
- Modify `backend/app/api/v1/auth.py`: issue the ID for every successful auth flow and include it in auth responses.
- Modify `backend/app/schemas/auth.py`: add `loginSessionId` to the authenticated-session contract.
- Modify `backend/app/web/bootstrap.py`: include the current ID in direct-page bootstrap.
- Modify `backend/app/web/routes.py`: ensure web login flows use the same issuer.

### Browser authentication and chooser

- Modify `new-legacy/src/29-auth-core.js`: retain `loginSessionId` from login/register/bootstrap/me without regenerating it locally.
- Create `new-legacy/src/31-learning-entry-chooser.js`: atomic once-per-login claim, accessible modal, and destination mapping.
- Modify `new-legacy/index.html`: add chooser mount markup and load the chooser after auth core.
- Modify `new-legacy/styles/main.css`: chooser-only visual rules alongside the existing graph/auth modal styles.
- Modify `frontend/scripts/new-legacy-assets/direct-entry.js`: preserve login session information when direct entry/bootstrap initializes auth.
- Modify `frontend/scripts/sync-new-legacy.js`: copy/inject the chooser asset in the generated graph page.

### Dashboard navigation

- Modify `new-legacy/admin-console.html`: semantic KPI anchors and two actions in the fourth metric.
- Modify `new-legacy/src/admin/50-admin-shell-app.js`: update only metric values, never replace anchor destinations.
- Modify `new-legacy/styles/admin-console.css` and `admin-focus-vega-common.css`: link focus/hover styles without layout changes.

### Tests

- Create `backend/tests/test_login_session_id.py`.
- Modify `backend/tests/test_wechat_auth.py`.
- Modify `backend/tests/test_web_runtime.py`.
- Create `new-legacy/tests/learning-entry-chooser.test.js`.
- Modify `new-legacy/tests/v90-p31-admin-ia.test.js`.
- Create `frontend/e2e/login_entry_chooser.py`.
- Create `frontend/e2e/admin_dashboard_navigation.py`.
- Create `frontend/e2e/auth_cross_page_matrix.py`.

---

### Task 1: Issue a stable ID for each successful login session

**Files:**
- Modify: `backend/app/core/auth.py`
- Modify: `backend/app/api/v1/auth.py`
- Modify: `backend/app/schemas/auth.py`
- Modify: `backend/app/web/bootstrap.py`
- Modify: `backend/app/web/routes.py`
- Create: `backend/tests/test_login_session_id.py`
- Modify: `backend/tests/test_wechat_auth.py`
- Modify: `backend/tests/test_web_runtime.py`

**Interfaces:**
- Signed session key: `login_session_id`.
- Generator: `secrets.token_urlsafe(24)`; generated server-side only.
- Authenticated response field: `loginSessionId: str`.
- Logout clears both `username` and `login_session_id`.

- [ ] **Step 1: Write failing authentication lifecycle tests**

```python
def test_login_session_id_rotates_only_on_successful_login(client):
    first = login(client, "teacher_a", "teacher-pass").json()["loginSessionId"]
    assert client.get("/api/v1/auth/me").json()["loginSessionId"] == first
    assert extract_bootstrap(client.get("/index.html"))["authUser"]["loginSessionId"] == first

    second = login(client, "teacher_a", "teacher-pass").json()["loginSessionId"]
    assert second != first

    client.post("/api/v1/auth/logout")
    assert "login_session_id" not in decoded_session(client)
```

Add equivalent assertions for registration auto-login, demo login, and WeChat login. A failed login must neither create nor rotate the ID.

- [ ] **Step 2: Run and confirm the field is absent**

Run: `cd backend && .venv/bin/python -m pytest tests/test_login_session_id.py tests/test_wechat_auth.py tests/test_web_runtime.py -k login_session -q`

Expected: FAIL.

- [ ] **Step 3: Centralize session issuance**

Implement one helper called by all successful auth paths:

```python
def establish_authenticated_session(request: Request, username: str) -> str:
    login_session_id = secrets.token_urlsafe(24)
    request.session.clear()
    request.session["username"] = username
    request.session["login_session_id"] = login_session_id
    return login_session_id
```

Do not derive the identifier from username, timestamp, cookies, or JWT/token text.

- [ ] **Step 4: Expose the existing ID on session reads**

`/me` and web bootstrap read the signed session value and never rotate it. If an old valid username session lacks the field, lazily issue one once and persist it so upgraded existing sessions receive the chooser without logging out.

- [ ] **Step 5: Run auth regressions**

Run: `cd backend && .venv/bin/python -m pytest tests/test_login_session_id.py tests/test_wechat_auth.py tests/test_web_runtime.py tests/test_smoke.py -q`

Expected: PASS; login audit rows and role checks remain unchanged.

- [ ] **Step 6: Commit login-session identity**

```bash
git add backend/app/core/auth.py backend/app/api/v1/auth.py backend/app/schemas/auth.py backend/app/web/bootstrap.py backend/app/web/routes.py backend/tests/test_login_session_id.py backend/tests/test_wechat_auth.py backend/tests/test_web_runtime.py
git commit -m "feat: identify each successful login session"
```

### Task 2: Implement an atomic once-per-login chooser state machine

**Files:**
- Create: `new-legacy/src/31-learning-entry-chooser.js`
- Create: `new-legacy/tests/learning-entry-chooser.test.js`

**Interfaces:**
- Global: `KGLearningEntryChooser`.
- `init({auth, document, location, storage}) -> Promise<{shown: boolean}>`.
- Storage key: `kg_learning_entry_chooser_consumed_v1`.
- Channel: `kg-learning-entry-chooser-v1`.
- Claim lock: `kg-learning-entry-chooser:<loginSessionId>`.

- [ ] **Step 1: Write failing VM tests for the state machine**

Cover no authenticated user, missing ID, first visit, refresh, second tab race, new login ID, logout, corrupt marker, unavailable BroadcastChannel, and unavailable `navigator.locks`.

```javascript
const [a, b] = await Promise.all([tabA.init(), tabB.init()])
assert.equal(Number(a.shown) + Number(b.shown), 1)
assert.equal((await tabA.init()).shown, false)
auth.loginSessionId = 'new-login-id'
assert.equal((await tabA.init()).shown, true)
```

- [ ] **Step 2: Run and confirm the asset is missing**

Run: `node --test new-legacy/tests/learning-entry-chooser.test.js`

Expected: FAIL.

- [ ] **Step 3: Implement the consumed-marker contract**

Store only a SHA-256 digest of the opaque login-session ID when `crypto.subtle` is available; use the opaque value only as an in-memory comparison input. The marker shape is `{schemaVersion: 1, consumedDigest, consumedAt}`. Malformed markers are ignored and overwritten after a successful claim.

- [ ] **Step 4: Implement the atomic claim**

Use `navigator.locks.request(lockName, {mode: 'exclusive'}, claim)` where supported. Within the lock, re-read storage, write the consumed marker before rendering, and broadcast `{type: 'consumed', digest}`. Fallback uses a localStorage claim record with a random tab nonce, immediate read-back verification, and two `storage` event turns before rendering. Exactly one winning tab returns `shown: true`.

- [ ] **Step 5: Keep auth ownership server-derived**

Read the ID only from `KGAuthCore.getCurrentSession()`/bootstrap. Never synthesize a fallback ID from username. When authenticated state exists but the server field is temporarily unavailable, wait for `kg:auth-ready` or a resolved `/me` call before deciding.

- [ ] **Step 6: Run state-machine tests**

Run: `node --test new-legacy/tests/learning-entry-chooser.test.js`

Expected: PASS.

- [ ] **Step 7: Commit chooser state**

```bash
git add new-legacy/src/31-learning-entry-chooser.js new-legacy/tests/learning-entry-chooser.test.js
git commit -m "feat: claim learning chooser once per login"
```

### Task 3: Build the accessible four-choice graph dialog

**Files:**
- Modify: `new-legacy/index.html`
- Modify: `new-legacy/src/29-auth-core.js`
- Modify: `new-legacy/src/31-learning-entry-chooser.js`
- Modify: `new-legacy/styles/main.css`
- Modify: `frontend/scripts/new-legacy-assets/direct-entry.js`
- Modify: `frontend/scripts/sync-new-legacy.js`
- Modify: `new-legacy/tests/learning-entry-chooser.test.js`

**Interfaces:**
- Dialog title: `选择学习方式`.
- Choices:

| Visible choice | Supporting text | Destination |
|---|---|---|
| 知识图谱 | 进入知识图谱 | remain on `index.html` |
| 知识回忆 | 深度回忆 | `knowledge-recall.html` |
| 知识归纳 | 归纳 | `question-workspace.html` |
| 知识巩固 | 刷题 | `practice-mode.html` |

- [ ] **Step 1: Extend failing DOM/accessibility contracts**

Assert `role="dialog"`, `aria-modal="true"`, labelled title, four buttons in confirmed order, no close button, no cancel action, and all fixed destinations. Assert chooser script loads after auth core and before graph application initialization.

- [ ] **Step 2: Run and confirm markup/injection is absent**

Run: `node --test new-legacy/tests/learning-entry-chooser.test.js`

Expected: FAIL.

- [ ] **Step 3: Add modal markup using graph visual language**

Reuse the current auth-dialog backdrop, panel radius, typography, focus ring, and responsive spacing. Add a four-item choice grid that collapses to one column on narrow screens. Do not alter `.world`, `.knowledge-card`, canvas toolbar, zoom dock, or graph node descendants.

- [ ] **Step 4: Implement modal behavior**

On the winning claim, make the rest of the page inert, focus the first option, trap Tab/Shift+Tab, and ignore Escape/backdrop clicks. Choosing 知识图谱 closes the dialog and restores focus to the graph. For another choice, first fetch the fixed same-origin target with credentials; navigate only after an OK HTML response. On failure, keep the dialog open, restore the chosen button, and show “该学习页面暂时不可用，请稍后重试”. Record no second browser marker on selection because consumption happened atomically before rendering.

- [ ] **Step 5: Preserve `loginSessionId` through auth core/direct entry**

Normalize the field from login/register/me/bootstrap into the authenticated-session object, clear it on logout, and emit `kg:auth-session-changed` when it rotates. Never place it into application URLs or logs.

- [ ] **Step 6: Inject and verify generated ordering**

Update the source asset list so `31-learning-entry-chooser.js` is copied and loaded after `29-auth-core.js`. Add a release contract asserting exactly one chooser script tag.

- [ ] **Step 7: Run chooser and release contracts**

Run: `node --test new-legacy/tests/learning-entry-chooser.test.js frontend/scripts/new-legacy-release.test.mjs`

Expected: PASS.

- [ ] **Step 8: Commit the visible chooser**

```bash
git add new-legacy/index.html new-legacy/src/29-auth-core.js new-legacy/src/31-learning-entry-chooser.js new-legacy/styles/main.css frontend/scripts/new-legacy-assets/direct-entry.js frontend/scripts/sync-new-legacy.js new-legacy/tests/learning-entry-chooser.test.js frontend/scripts/new-legacy-release.test.mjs
git commit -m "feat: show four learning entries after login"
```

### Task 4: Make administrator KPI cards navigable

**Files:**
- Modify: `new-legacy/admin-console.html:42-54`
- Modify: `new-legacy/src/admin/50-admin-shell-app.js`
- Modify: `new-legacy/styles/admin-console.css`
- Modify: `new-legacy/styles/admin-focus-vega-common.css`
- Modify: `new-legacy/tests/v90-p31-admin-ia.test.js`

**Interfaces:**
- Subject count: `admin-subjects.html`.
- Current subject: `admin-subjects.html?tab=current`.
- Question count: `question-bank.html?mode=simple&step=questions`.
- Paper/task card: separate `paper-management.html` and `course-admin.html?view=tasks` anchors.

- [ ] **Step 1: Write failing semantic-link tests**

Assert the first three KPI cards contain one full-card anchor each with the exact `href`; the fourth contains two explicit text links. Assert the runtime app updates values by stable value IDs and never replaces `innerHTML` of a linked card.

- [ ] **Step 2: Run and confirm articles are not navigable**

Run: `node --test new-legacy/tests/v90-p31-admin-ia.test.js`

Expected: FAIL before semantic links are added.

- [ ] **Step 3: Convert cards without visual drift**

Keep each existing metric `<article>` and class. Wrap the content of the first three in an anchor using a new narrowly scoped full-card link class. In the fourth, retain the combined value but add two visible actions “试卷” and “学习任务”; both are keyboard focusable.

- [ ] **Step 4: Protect link structure during metric updates**

Give numeric spans stable IDs/data attributes and update `textContent` only. Do not attach JavaScript click navigation to an article; native anchors must support copy/open-in-new-tab and keyboard activation.

- [ ] **Step 5: Add hover/focus-visible styles**

Inherit color and text decoration at rest, use the current card hover elevation, and display the existing focus-ring token on `:focus-visible`. Do not change grid size, card padding, metric typography, or responsive breakpoints.

- [ ] **Step 6: Run dashboard contracts**

Run: `node --test new-legacy/tests/v90-p31-admin-ia.test.js frontend/scripts/new-legacy-release.test.mjs`

Expected: PASS.

- [ ] **Step 7: Commit dashboard navigation**

```bash
git add new-legacy/admin-console.html new-legacy/src/admin/50-admin-shell-app.js new-legacy/styles/admin-console.css new-legacy/styles/admin-focus-vega-common.css new-legacy/tests/v90-p31-admin-ia.test.js
git commit -m "feat: link admin metrics to management pages"
```

### Task 5: Verify once-per-login behavior for every role and tab pattern

**Files:**
- Create: `frontend/e2e/login_entry_chooser.py`
- Create: `frontend/e2e/admin_dashboard_navigation.py`

- [ ] **Step 1: Implement the chooser browser matrix**

For admin, teacher, student, and viewer:

- Log in, navigate to a non-graph page, then open the graph and assert the chooser appears.
- Refresh the graph and assert it does not reappear.
- Log out, log in again as the same account, and assert it appears again.
- Exercise each of the four choices and assert its exact destination/behavior.
- Stub one target as unavailable and assert the user remains on the graph with the visible error.
- Open two graph tabs concurrently after a fresh login and assert only one tab displays the chooser.
- Assert Escape/backdrop cannot dismiss; assert focus remains trapped until a choice.

- [ ] **Step 2: Implement dashboard navigation E2E**

Log in as an administrator, click each of the first three cards and both fourth-card actions in isolated pages, and assert destination pathname/query. Verify Enter-key activation and visible focus. Log in as a teacher and assert admin console remains forbidden.

- [ ] **Step 3: Run focused E2E**

Run: `cd frontend && E2E_BASE_URL=http://127.0.0.1:8000 python e2e/login_entry_chooser.py`

Run: `cd frontend && E2E_BASE_URL=http://127.0.0.1:8000 python e2e/admin_dashboard_navigation.py`

Expected: PASS.

- [ ] **Step 4: Commit focused E2E**

```bash
git add frontend/e2e/login_entry_chooser.py frontend/e2e/admin_dashboard_navigation.py
git commit -m "test: verify dashboard links and login chooser"
```

### Task 6: Traverse every auth-enabled page and validate the release candidate

**Files:**
- Create: `frontend/e2e/auth_cross_page_matrix.py`
- Modify: `frontend/scripts/new-legacy-release.test.mjs`

- [ ] **Step 1: Enumerate pages from source instead of a handwritten subset**

Build the matrix from the release page manifest plus an explicit allow-list of pages that contain account controls or load auth core. Include graph, practice, workspace, recall, question bank, paper management, teacher workbench, course admin, subject admin, user admin, settings, files, and member pages.

- [ ] **Step 2: Test login and logout on every page**

For each page, start signed out, assert the login control/dialog works, complete login, assert account state, perform logout, and assert signed-out state. Separately assert authenticated direct entry does not create a new `loginSessionId` merely by navigating.

- [ ] **Step 3: Generate and inspect the candidate release**

Before promotion, compare candidate site file count with the active release and abort on a lower count. Assert critical pages `admin-console.html`, `index.html`, `knowledge-recall.html`, `question-workspace.html`, `practice-mode.html`, `paper-management.html`, and `course-admin.html` exist. Inspect generated script ordering for auth core, chooser, direct entry, and graph app.

- [ ] **Step 4: Run the complete verification set**

Run: `cd backend && .venv/bin/python -m pytest tests/ -q`

Run: `node --test new-legacy/tests/learning-entry-chooser.test.js`

Run: `node --test frontend/scripts/new-legacy-release.test.mjs frontend/scripts/online-qa-regressions.test.mjs`

Run: `cd frontend && E2E_BASE_URL=http://127.0.0.1:8000 python e2e/auth_cross_page_matrix.py`

Run the two focused E2E scripts from Task 5 again against the candidate release.

Expected: PASS.

- [ ] **Step 5: Promote only through the managed release command**

After every check passes and candidate/active file counts align, run:

```bash
node frontend/scripts/manage-new-legacy.js update new-legacy --skip-browser
```

Then rerun the critical graph, dashboard, login/logout, and direct old-link smoke tests against the promoted active release.

- [ ] **Step 6: Commit the cross-page verification**

```bash
git add frontend/e2e/auth_cross_page_matrix.py frontend/scripts/new-legacy-release.test.mjs
git commit -m "test: cover authentication across released pages"
```

## Plan 4 Completion Gate

- Each successful login flow has a new server-generated session ID; refresh/navigation preserve it and logout clears it.
- The chooser appears exactly once on the first graph visit per login across same-origin tabs for every role.
- The dialog cannot be dismissed without choosing and all four choices map to the confirmed learning pages.
- The four administrator KPI areas are keyboard-accessible semantic links with the confirmed destinations.
- Every auth-enabled page passes login and logout traversal; direct navigation does not rotate the session ID.
- Candidate file count/critical pages are validated before managed promotion, and post-promotion smoke tests pass.
