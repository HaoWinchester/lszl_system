from fastapi.testclient import TestClient

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
