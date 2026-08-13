from fastapi.testclient import TestClient
import json
import re

from app.main import app
from app.db.session import AsyncSessionLocal
from app.services import runtime_state_service
from app.services import teaching_content_revision_service as revision_service
from app.web import routes
from app.web.releases import WebRelease, active_release


def test_root_serves_public_landing_page_without_business_bootstrap(monkeypatch, tmp_path) -> None:
    site = tmp_path / "site"
    site.mkdir()
    (site / "landing.html").write_text(
        "<!doctype html><html><head><title>幻谱｜PMP 知识图谱学习平台</title></head>"
        '<body><a href="/graph">进入知识图谱</a></body></html>',
        encoding="utf-8",
    )
    release = WebRelease(version="landing-test", site=site, source_hash="test-hash")
    monkeypatch.setattr(routes, "_release_or_503", lambda: release)

    with TestClient(app) as client:
        response = client.get("/?auth=login&stage=foundation", follow_redirects=False)

    assert response.status_code == 200
    assert "幻谱｜PMP 知识图谱学习平台" in response.text
    assert 'href="/graph"' in response.text
    assert "__KG_DIRECT_BOOTSTRAP__" not in response.text
    assert response.headers["cache-control"] == "no-cache"
    assert response.headers["x-content-type-options"] == "nosniff"


def test_root_returns_503_when_active_release_has_no_landing_page(monkeypatch, tmp_path) -> None:
    site = tmp_path / "site"
    site.mkdir()
    release = WebRelease(version="missing-landing", site=site, source_hash="test-hash")
    monkeypatch.setattr(routes, "_release_or_503", lambda: release)

    with TestClient(app) as client:
        response = client.get("/", follow_redirects=False)

    assert response.status_code == 503
    assert response.json()["detail"] == "当前版本缺少官网首页"


def test_explicit_landing_asset_stays_public_and_unmodified(monkeypatch, tmp_path) -> None:
    site = tmp_path / "site"
    site.mkdir()
    (site / "landing.html").write_text(
        '<!doctype html><link rel="stylesheet" href="styles/landing.css"><h1>公开官网</h1>',
        encoding="utf-8",
    )
    release = WebRelease(version="landing-test", site=site, source_hash="test-hash")
    monkeypatch.setattr(routes, "_release_or_503", lambda: release)

    with TestClient(app) as client:
        response = client.get("/landing.html", follow_redirects=False)

    assert response.status_code == 200
    assert "公开官网" in response.text
    assert 'href="styles/landing.css"' in response.text
    assert "__KG_DIRECT_BOOTSTRAP__" not in response.text


def test_preview_landing_uses_canonical_directory_and_no_business_bootstrap(monkeypatch, tmp_path) -> None:
    site = tmp_path / "site"
    site.mkdir()
    (site / "landing.html").write_text(
        '<!doctype html><link rel="stylesheet" href="styles/landing.css"><h1>候选官网</h1>',
        encoding="utf-8",
    )
    release = WebRelease(version="preview-test", site=site, source_hash="test-hash")
    monkeypatch.setattr(routes, "preview_release", lambda version: release)

    with TestClient(app) as client:
        canonical = client.get("/__preview/preview-test", follow_redirects=False)
        root = client.get("/__preview/preview-test/", follow_redirects=False)
        explicit = client.get("/__preview/preview-test/landing.html", follow_redirects=False)

    assert canonical.status_code == 307
    assert canonical.headers["location"] == "/__preview/preview-test/"
    for response in (root, explicit):
        assert response.status_code == 200
        assert "候选官网" in response.text
        assert 'href="styles/landing.css"' in response.text
        assert "__KG_DIRECT_BOOTSTRAP__" not in response.text


def test_learning_path_redirects_to_practice_mode_without_query_context() -> None:
    with TestClient(app) as client:
        response = client.get(
            "/learning-path.html?auth=login&part=environment",
            follow_redirects=False,
        )

    assert response.status_code == 307
    assert response.headers["location"] == "/practice-mode.html"


def test_graph_alias_preserves_free_mode() -> None:
    with TestClient(app) as client:
        response = client.get("/graph", follow_redirects=False)

    assert response.status_code == 307
    assert response.headers["location"] == "/index.html?mode=free"


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


def test_retired_training_page_serves_practice_redirect_document() -> None:
    with TestClient(app) as client:
        response = client.get("/question-training.html")

    assert response.status_code == 200
    assert "单题深学已停用，正在为你切换到刷题。" in response.text
    assert 'id="practiceRedirectFallback"' in response.text
    assert "retiredMode" in response.text
    assert "location.replace(target.toString())" in response.text


def test_api_routes_keep_priority_over_static_runtime() -> None:
    with TestClient(app) as client:
        response = client.get("/api/v1/health")

    assert response.status_code == 200
    assert response.json()["status"] == "ok"


def test_versioned_static_assets_are_immutable_and_cacheable() -> None:
    version = active_release().version
    with TestClient(app) as client:
        versioned = client.get(f"/styles/main.css?v={version}")
        unversioned = client.get("/server-state-bootstrap.js")

    assert versioned.status_code == 200
    assert versioned.headers["cache-control"] == "public, max-age=31536000, immutable"
    assert unversioned.status_code == 200
    assert unversioned.headers["cache-control"] == "no-cache"


def _bootstrap(response_text: str) -> dict:
    match = re.search(r"window\.__KG_DIRECT_BOOTSTRAP__=(.*?);</script>", response_text)
    assert match, "missing direct bootstrap"
    return json.loads(match.group(1))


def test_html_injects_authenticated_user_before_state_bootstrap() -> None:
    with TestClient(app) as client:
        login = client.post("/api/v1/auth/login", json={"username": "佩奇007", "password": "111111"})
        assert login.status_code == 200
        response = client.get("/practice-mode.html")
        revision = client.get("/api/v1/question-catalog/revision")

    marker = "window.__KG_DIRECT_BOOTSTRAP__="
    assert marker in response.text
    assert response.text.index(marker) < response.text.index("server-state-bootstrap.js")
    payload = _bootstrap(response.text)
    assert payload["authUser"]["username"] == "佩奇007"
    assert payload["authUser"]["role"] == "admin"
    assert payload["authUser"]["loginSessionId"] == login.json()["loginSessionId"]
    assert revision.status_code == 200
    assert payload["contentRevision"] == revision.json()["revision"]


def test_html_bootstrap_does_not_pair_old_state_with_a_later_content_token(
    monkeypatch,
) -> None:
    original_ensure = runtime_state_service.ensure_domain_seed
    captured: dict[str, int] = {}

    async def competing_bump() -> None:
        async with AsyncSessionLocal() as db:
            async with db.begin():
                await revision_service.bump(
                    db,
                    "bootstrap-competitor",
                    [
                        {
                            "entityType": "runtimeShared",
                            "entityId": "bootstrap-competitor",
                            "action": "updated",
                        }
                    ],
                )

    async def writer_after_snapshot(*args, **kwargs):
        result = await original_ensure(*args, **kwargs)
        if not captured:
            if len(result) == 3:
                captured["contentRevision"] = int(result[2])
            else:
                async with AsyncSessionLocal() as db:
                    captured["contentRevision"] = int(
                        (await revision_service.current(db))["revision"]
                    )
            await competing_bump()
        return result

    monkeypatch.setattr(
        runtime_state_service,
        "ensure_domain_seed",
        writer_after_snapshot,
    )
    with TestClient(app) as client:
        assert client.post(
            "/api/v1/auth/login",
            json={"username": "admin", "password": "admin123"},
        ).status_code == 200
        payload = _bootstrap(client.get("/practice-mode.html").text)

    assert payload["contentRevision"] == captured["contentRevision"]


def test_guest_html_injects_anonymous_bootstrap() -> None:
    with TestClient(app) as client:
        payload = _bootstrap(client.get("/practice-mode.html").text)

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
