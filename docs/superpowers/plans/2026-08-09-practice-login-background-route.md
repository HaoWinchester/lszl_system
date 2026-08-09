# Practice Login Background Route Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make `/login` open the existing login dialog over the new `practice-mode.html` page while preserving query parameters and the published-paper empty state.

**Architecture:** Keep authentication and frontend rendering unchanged. Change only the FastAPI stable alias target, then protect the behavior with route-level tests and the existing direct-runtime browser smoke test.

**Tech Stack:** FastAPI, Starlette `TestClient`, pytest, Playwright synchronous Python API, generated new-legacy direct runtime.

## Global Constraints

- `/login` redirects to `/practice-mode.html?auth=login`.
- Incoming query parameters such as `next` remain present.
- `/`, `/learning-path.html`, authentication behavior, published-paper permissions, and active release assets remain unchanged.
- Existing unrelated working-tree changes must not be modified or staged.
- Production code is changed only after the focused test has failed for the expected old target.

---

### Task 1: Point the stable login alias at the new practice page

**Files:**
- Modify: `backend/tests/test_web_runtime.py`
- Modify: `frontend/e2e/new_legacy_smoke.py`
- Modify: `backend/app/web/routes.py:170-172`

**Interfaces:**
- Consumes: `request.query_params` and `urllib.parse.urlencode`.
- Produces: `GET /login` returning status `307` with a `Location` under `/practice-mode.html` and default query parameter `auth=login`.

- [x] **Step 1: Add route tests for the target and preserved query context**

Add these tests to `backend/tests/test_web_runtime.py`:

```python
def test_login_alias_opens_the_practice_page_login_surface() -> None:
    with TestClient(app) as client:
        response = client.get("/login", follow_redirects=False)

    assert response.status_code == 307
    assert response.headers["location"] == "/practice-mode.html?auth=login"


def test_login_alias_preserves_return_context() -> None:
    with TestClient(app) as client:
        response = client.get("/login?next=%2Fcontent-prep", follow_redirects=False)

    assert response.status_code == 307
    assert response.headers["location"] == "/practice-mode.html?auth=login&next=%2Fcontent-prep"


def test_login_alias_cannot_be_overridden_by_incoming_auth_mode() -> None:
    with TestClient(app) as client:
        response = client.get("/login?auth=register&next=%2Fcontent-prep", follow_redirects=False)

    assert response.status_code == 307
    assert response.headers["location"] == "/practice-mode.html?auth=login&next=%2Fcontent-prep"
```

The production regressions these tests catch are changing the alias back to `learning-path.html`, dropping the caller's return context, or allowing an incoming `auth` value to replace the required login mode.

- [x] **Step 2: Update the browser smoke expectation before implementation**

In the `/login` section of `frontend/e2e/new_legacy_smoke.py`, require the new page and its empty state before filling the existing dialog:

```python
page.goto(BASE + "/login", wait_until="networkidle")
assert "/practice-mode.html?auth=login" in page.url
page.locator(".practice-app").wait_for(state="visible")
page.wait_for_function("""() => {
  const empty = document.getElementById('practiceEmpty')
  const hasPaper = document.querySelectorAll('#practicePaperLibrary [data-paper-id]').length > 0
  return (empty && !empty.hidden) || hasPaper
}""")
if page.locator("#practiceEmpty").is_visible():
    assert "暂时没有可练习的已发布试卷" in page.locator("#practiceEmpty").inner_text()
page.locator("#authModal.show").wait_for(state="visible")
page.locator("#authCloseBtn").click()
page.locator("#authModal").wait_for(state="hidden")
page.locator("#authStatus").click()
page.locator("#accountMenuSessionBtn").click()
page.locator("#authModal.show").wait_for(state="visible")
```

The smoke remains valid whether the test account has no published papers or already has a paper. It also proves that closing the initial dialog still leaves a working account-menu path to reopen it before logging in and verifying the authenticated bootstrap and account label.

- [x] **Step 3: Run the focused backend tests and verify RED**

Run:

```bash
cd backend
.venv/bin/python -m pytest tests/test_web_runtime.py::test_login_alias_opens_the_practice_page_login_surface tests/test_web_runtime.py::test_login_alias_preserves_return_context -q
```

Expected: both tests fail because the current locations start with `/learning-path.html`.

- [x] **Step 4: Make the minimal route change**

Change the stable alias in `backend/app/web/routes.py` to:

```python
@router.get("/login")
async def login_alias(request: Request):
    params = {"auth": "login"}
    params.update({key: value for key, value in request.query_params.items() if key != "auth"})
    return RedirectResponse(
        f"/practice-mode.html?{urlencode(params)}",
        status_code=307,
    )
```

- [x] **Step 5: Run focused and neighboring backend tests and verify GREEN**

Run:

```bash
cd backend
.venv/bin/python -m pytest tests/test_web_runtime.py tests/test_content_prep_route.py -q
```

Expected: all tests pass, including the anonymous content-prep redirect that depends on `/login?next=...`.

- [x] **Step 6: Run the browser regression against a local backend**

Start the backend on an available local port with the repository's configured virtual environment, then run the smoke with a Python runtime that has Playwright installed:

```bash
cd frontend
E2E_BASE_URL=http://127.0.0.1:8000 E2E_RELEASE_VERSION=v9.0-p4.1.20 /Library/Frameworks/Python.framework/Versions/3.11/bin/python3 e2e/new_legacy_smoke.py
```

Expected: the login section finds `.practice-app`, either the visible `#practiceEmpty` message or a real published-paper card, and the open login dialog; after closing and reopening the dialog, login completes successfully.

- [x] **Step 7: Run the focused release and backend regression suites**

Run:

```bash
cd backend
.venv/bin/python -m pytest tests/ -q
```

Run the release-contract suite from the repository root:

```bash
node --test frontend/scripts/new-legacy-release.test.mjs frontend/scripts/online-qa-regressions.test.mjs
```

Expected: both commands pass without changing generated release files.

- [x] **Step 8: Commit only the route, tests, and plan**

```bash
git add backend/app/web/routes.py backend/tests/test_web_runtime.py frontend/e2e/new_legacy_smoke.py docs/superpowers/plans/2026-08-09-practice-login-background-route.md
git commit -m "fix: open login over practice mode"
```
