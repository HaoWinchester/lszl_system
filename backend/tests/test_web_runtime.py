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
            json={"username": "admin", "password": "jbgsnmm~123"},
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


def test_runtime_state_drain_mode_accepts_and_ignores_writes() -> None:
    """退役 drain（设计 §11）：RUNTIME_SYNC_DISABLED 时 PUT 返回成功与当前版本号，不落库。"""
    from app.core.config import settings as app_settings

    with TestClient(app) as client:
        login = client.post(
            "/api/v1/auth/login",
            json={
                "username": "admin",
                "password": "jbgsnmm~123",
                "acceptedTermsVersion": "2026-08-13-v1",
            },
        )
        assert login.status_code == 200
        before = client.get("/api/v1/runtime/state?mode=full").json()

        original = app_settings.RUNTIME_SYNC_DISABLED
        app_settings.RUNTIME_SYNC_DISABLED = True
        try:
            response = client.put(
                "/api/v1/runtime/state",
                json={
                    "page": "learning-path.html",
                    "namespace": "guided-learning",
                    "operation": "setItem",
                    "key": "kg_default_entry_mode_v1",
                    "value": "drain-probe",
                    "storage": {"kg_default_entry_mode_v1": "drain-probe"},
                    "requestId": "pytest-drain",
                },
            )
        finally:
            app_settings.RUNTIME_SYNC_DISABLED = original

        assert response.status_code == 200
        body = response.json()
        assert body["ok"] is True
        assert body["requestId"] == "pytest-drain"
        after = client.get("/api/v1/runtime/state?mode=full").json()
        assert after["revision"] == body["revision"]
        assert after["storage"].get("kg_default_entry_mode_v1") != "drain-probe"
        assert before["revision"] == after["revision"]


def test_html_bootstrap_inlines_filtered_storage_for_files_page() -> None:
    """登录用户打开首页时，files 域的小体积快照必须内联进首包。

    回归背景（2026-08-23 生产事故）：水合异步完成后业务脚本才能读到索引，
    竞态窗口内文件存储误建初始图谱并覆盖服务器索引。内联快照消除该窗口。
    """
    with TestClient(app) as client:
        login = client.post(
            "/api/v1/auth/login",
            json={"username": "佩奇007", "password": "111111"},
        )
        assert login.status_code == 200
        response = client.get("/index.html")

    payload = _bootstrap(response.text)
    assert payload["authenticated"] is True
    storage = payload.get("storage")
    assert isinstance(storage, dict)
    # files 域白名单内的图谱文件索引必须随首包下发（这是竞态修复的核心）
    assert "kg_graph_file_index_v2" in storage
    # 非本页白名单的大键不得混入首包
    assert "kg_exam_papers_published_v1" not in storage


def test_html_bootstrap_omits_storage_entirely_when_over_limit(monkeypatch) -> None:
    """快照超限时必须整体放弃内联（原子性），不能只内联一部分。"""
    from app.web import bootstrap as bootstrap_module

    monkeypatch.setattr(bootstrap_module, "INLINE_STORAGE_MAX_BYTES", 1)
    with TestClient(app) as client:
        login = client.post(
            "/api/v1/auth/login",
            json={"username": "佩奇007", "password": "111111"},
        )
        assert login.status_code == 200
        response = client.get("/index.html")

    payload = _bootstrap(response.text)
    assert payload["authenticated"] is True
    assert payload.get("storage") is None


def test_guest_html_bootstrap_has_no_inline_storage() -> None:
    """未登录没有服务器状态可内联，storage 必须为 None（不能是空 dict）。"""
    with TestClient(app) as client:
        payload = _bootstrap(client.get("/index.html").text)

    assert payload["authenticated"] is False
    assert payload.get("storage") is None
