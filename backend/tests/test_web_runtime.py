from fastapi.testclient import TestClient
import json
import re

from app.main import app


def test_root_serves_learning_path_without_iframe() -> None:
    with TestClient(app) as client:
        response = client.get("/")

    assert response.status_code == 200
    assert 'class="guided-learning-page"' in response.text
    assert "<iframe" not in response.text
    assert "react" not in response.text.lower()


def test_graph_alias_preserves_free_mode() -> None:
    with TestClient(app) as client:
        response = client.get("/graph", follow_redirects=False)

    assert response.status_code == 307
    assert response.headers["location"] == "/index.html?mode=free"


def test_direct_page_serves_upstream_dom() -> None:
    with TestClient(app) as client:
        response = client.get("/question-training.html")

    assert response.status_code == 200
    assert 'class="question-training-page"' in response.text
    assert 'id="qtOpenWorkspaceBtn"' in response.text


def test_api_routes_keep_priority_over_static_runtime() -> None:
    with TestClient(app) as client:
        response = client.get("/api/v1/health")

    assert response.status_code == 200
    assert response.json()["status"] == "ok"


def _bootstrap(response_text: str) -> dict:
    match = re.search(r"window\.__KG_DIRECT_BOOTSTRAP__=(.*?);</script>", response_text)
    assert match, "missing direct bootstrap"
    return json.loads(match.group(1))


def test_html_injects_authenticated_user_before_state_bootstrap() -> None:
    with TestClient(app) as client:
        login = client.post("/api/v1/auth/login", json={"username": "佩奇007", "password": "111111"})
        assert login.status_code == 200
        response = client.get("/learning-path.html")

    marker = "window.__KG_DIRECT_BOOTSTRAP__="
    assert marker in response.text
    assert response.text.index(marker) < response.text.index("server-state-bootstrap.js")
    payload = _bootstrap(response.text)
    assert payload["authUser"]["username"] == "佩奇007"
    assert payload["authUser"]["role"] == "admin"


def test_guest_html_injects_anonymous_bootstrap() -> None:
    with TestClient(app) as client:
        payload = _bootstrap(client.get("/learning-path.html").text)

    assert payload["authUser"] is None
    assert payload["authenticated"] is False


def test_runtime_state_requires_a_login() -> None:
    with TestClient(app) as client:
        response = client.put(
            "/api/v1/runtime/state",
            json={
                "page": "learning-path.html",
                "namespace": "guided-learning",
                "operation": "setItem",
                "key": "kg_default_entry_mode_v1",
                "value": "free",
                "storage": {"kg_default_entry_mode_v1": "free"},
                "requestId": "pytest-runtime-state",
            },
        )

    assert response.status_code == 401
