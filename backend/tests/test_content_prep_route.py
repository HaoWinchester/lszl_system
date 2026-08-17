from pathlib import Path

import pytest
from fastapi.testclient import TestClient

from app.main import app
from app.web import routes as web_routes
from app.web.releases import WebRelease


ROOT = Path(__file__).resolve().parents[2]


def _login(client: TestClient, username: str, password: str = "111111") -> None:
    response = client.post(
        "/api/v1/auth/login",
        json={"username": username, "password": password},
    )
    assert response.status_code == 200


@pytest.fixture
def content_prep_release(monkeypatch: pytest.MonkeyPatch) -> WebRelease:
    release = WebRelease(
        version="content-prep-route-test",
        site=ROOT / "new-legacy",
        source_hash="test",
    )
    monkeypatch.setattr(web_routes, "active_release", lambda: release)
    monkeypatch.setattr(web_routes, "preview_release", lambda _version: release)
    return release


def test_anonymous_content_prep_opens_without_login(
    content_prep_release: WebRelease,
) -> None:
    with TestClient(app) as client:
        response = client.get("/content-prep", follow_redirects=False)

    assert response.status_code == 200
    assert 'id="prepApp"' in response.text
    # 匿名进入不弹登录框；登录态由页面读取缓存 + 调 /api/v1/auth/me 判定
    assert "kg-content-prep-login-overlay" not in response.text
    assert "kg_remote_auth_session_v1" in response.text
    assert "/api/v1/auth/me" in response.text


@pytest.mark.parametrize("username", ["学生", "乔治008"])
def test_learning_roles_cannot_open_content_prep(
    content_prep_release: WebRelease,
    username: str,
) -> None:
    with TestClient(app) as client:
        _login(client, username)
        response = client.get("/content-prep")

    assert response.status_code == 403
    assert "无权访问" in response.text


@pytest.mark.parametrize(
    ("username", "password", "role"),
    [("老师", "111111", "teacher"), ("admin", "jbgsnmm~123", "admin")],
)
def test_teaching_roles_receive_the_prep_page_with_session_hydration(
    content_prep_release: WebRelease,
    username: str,
    password: str,
    role: str,
) -> None:
    with TestClient(app) as client:
        _login(client, username, password)
        response = client.get("/content-prep")

    assert response.status_code == 200
    assert 'id="prepApp"' in response.text
    # 登录态不再走 window.__KG_DIRECT_BOOTSTRAP__ 内联注入，改为缓存 + /me 接口水合
    assert "window.__KG_DIRECT_BOOTSTRAP__=" not in response.text
    assert "kg_remote_auth_session_v1" in response.text
    assert "prepRuntime.serverActorReady" in response.text


@pytest.mark.parametrize(
    "path",
    [
        "/content-prep-studio/dist/content-prep.html",
        "/__preview/content-prep-route-test/content-prep-studio/dist/content-prep.html",
    ],
)
def test_nested_and_preview_html_cannot_bypass_content_prep_permissions(
    content_prep_release: WebRelease,
    path: str,
) -> None:
    with TestClient(app) as client:
        _login(client, "学生")
        response = client.get(path)

    assert response.status_code == 403
    assert "无权访问" in response.text
