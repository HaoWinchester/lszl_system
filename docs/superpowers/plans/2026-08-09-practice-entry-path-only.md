# Practice Entry Path-Only Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make `/` and `/learning-path.html` enter `practice-mode.html` through a server redirect while keeping `/login` as the only entry that automatically opens the login dialog.

**Architecture:** Change only FastAPI route selection. Update route, runtime-bootstrap, and browser-smoke tests that currently treat `learning-path.html` as the public default; keep the legacy learning assets and every active release file unchanged.

**Tech Stack:** FastAPI, Starlette `RedirectResponse` and `TestClient`, pytest, Playwright synchronous Python API.

## Global Constraints

- `/` returns exactly `307 /practice-mode.html`.
- `/learning-path.html` returns exactly `307 /practice-mode.html`.
- Query parameters from `/` and `/learning-path.html` are discarded.
- `/login` remains `307 /practice-mode.html?auth=login` and preserves its existing safe `next` behavior.
- Do not modify `new-legacy/`, `frontend/public/new-legacy/`, or any active release.
- Do not stage unrelated working-tree changes.

---

### Task 1: Replace the public learning entry with the practice path

**Files:**
- Modify: `backend/tests/test_web_runtime.py`
- Modify: `backend/tests/test_runtime_state.py`
- Modify: `frontend/e2e/new_legacy_smoke.py`
- Modify: `frontend/e2e/ui_geometry_audit.py`
- Modify: `backend/app/web/routes.py:111-117`

**Interfaces:**
- Consumes: Starlette `RedirectResponse(url: str, status_code: int)` and the existing `/practice-mode.html` catch-all HTML route.
- Produces: `GET /` and `GET /learning-path.html`, each returning a fixed `307` with `Location: /practice-mode.html`.

- [x] **Step 1: Write the failing route tests and update tests that intentionally need a real HTML page**

Replace `test_root_serves_learning_path_without_iframe` in `backend/tests/test_web_runtime.py` and add the query-discarding assertion:

```python
def test_root_redirects_to_practice_mode_without_query_context() -> None:
    with TestClient(app) as client:
        response = client.get("/?auth=login&stage=foundation", follow_redirects=False)

    assert response.status_code == 307
    assert response.headers["location"] == "/practice-mode.html"


def test_learning_path_redirects_to_practice_mode_without_query_context() -> None:
    with TestClient(app) as client:
        response = client.get(
            "/learning-path.html?auth=login&part=environment",
            follow_redirects=False,
        )

    assert response.status_code == 307
    assert response.headers["location"] == "/practice-mode.html"
```

Change the authenticated and guest bootstrap assertions in the same file to request `/practice-mode.html` directly, because those tests verify HTML bootstrap injection rather than the retired learning entry.

In `backend/tests/test_runtime_state.py`, replace calls that use `/learning-path.html` only to seed/read guided-learning state with:

```python
client.get("/guided-learning-node.html?node=awareness-keywords")
```

Use the same direct guided-node URL for the student and teacher clients. In `test_every_upstream_page_declares_the_expected_namespace`, remove `"learning-path.html": "guided-learning"` and add `"practice-mode.html": "page"`; the two remaining guided pages continue protecting the `guided-learning` namespace mapping.

These test changes separate two contracts: the public learning entry now redirects to practice mode, while the surviving guided node and placement pages still preload guided-learning data correctly.

- [x] **Step 2: Update the browser checks before implementation**

Replace the guest-entry section in `frontend/e2e/new_legacy_smoke.py` with:

```python
print("smoke: guest learning entry lands on practice mode", flush=True)
page.goto(BASE + "/learning-path.html", wait_until="networkidle")
assert page.url == BASE + "/practice-mode.html"
page.locator(".practice-app").wait_for(state="visible")
page.locator("#practiceEmpty").wait_for(state="visible")
assert "暂时没有可练习的已发布试卷" in page.locator("#practiceEmpty").inner_text()
assert page.locator(".gl-app").count() == 0
assert not page.locator("#authModal").is_visible()
assert page.locator("iframe").count() == 0
```

The later guided-node smoke must no longer discover a node from `/`. Replace that discovery with the stable first node ID already declared by `src/87-guided-learning-data.js`:

```python
page.goto(BASE + "/learning/node?node=awareness-keywords", wait_until="networkidle")
page.locator(".gln-main").wait_for(state="visible")
assert page.locator("iframe").count() == 0
```

In `frontend/e2e/ui_geometry_audit.py`, change the public learning-path case to:

```python
("practice-entry", "/learning-path.html", ".practice-app"),
```

- [x] **Step 3: Run the focused route tests and verify RED**

Run:

```bash
cd backend
.venv/bin/python -m pytest \
  tests/test_web_runtime.py::test_root_redirects_to_practice_mode_without_query_context \
  tests/test_web_runtime.py::test_learning_path_redirects_to_practice_mode_without_query_context -q
```

Expected: both tests fail because `/` currently returns `200` learning-path HTML and `/learning-path.html` currently resolves through the active asset route.

- [x] **Step 4: Implement the fixed server routes**

Replace the root handler in `backend/app/web/routes.py` and add an explicit learning-path handler before the catch-all route:

```python
@router.get("/")
async def practice_entry_page():
    return RedirectResponse("/practice-mode.html", status_code=307)


@router.get("/learning-path.html")
async def learning_path_alias():
    return RedirectResponse("/practice-mode.html", status_code=307)
```

Both handlers intentionally ignore `Request` and `DB`, so no query string or session branch can change the canonical target.

- [x] **Step 5: Run focused and neighboring backend tests and verify GREEN**

Run:

```bash
cd backend
.venv/bin/python -m pytest tests/test_web_runtime.py tests/test_runtime_state.py tests/test_content_prep_route.py -q
```

Expected: all tests pass. The `/login?next=...` content-prep flow still reaches `/practice-mode.html?auth=login&next=...`.

- [x] **Step 6: Run the real browser smoke against a local backend**

Start the backend on an available local port, then run with the active release version from `frontend/new-legacy-releases/current.json`:

```bash
cd frontend
E2E_BASE_URL=http://127.0.0.1:8011 \
E2E_RELEASE_VERSION=v9.0-p4.1.21 \
/Library/Frameworks/Python.framework/Versions/3.11/bin/python3 e2e/new_legacy_smoke.py
```

Expected: the guest learning entry lands on the practice empty state without an open login modal; `/login` still opens the modal and the remainder of the smoke passes.

- [x] **Step 7: Run full regression suites**

Run:

```bash
cd backend
.venv/bin/python -m pytest tests/ -q
```

Run from the repository root:

```bash
node --test frontend/scripts/new-legacy-release.test.mjs frontend/scripts/online-qa-regressions.test.mjs
```

Expected: both suites pass without changing generated or active release files.

- [x] **Step 8: Commit only the route, affected tests, and plan**

```bash
git add backend/app/web/routes.py backend/tests/test_web_runtime.py backend/tests/test_runtime_state.py frontend/e2e/new_legacy_smoke.py frontend/e2e/ui_geometry_audit.py
git add -f docs/superpowers/plans/2026-08-09-practice-entry-path-only.md
git commit -m "fix: route learning entry to practice mode"
```
