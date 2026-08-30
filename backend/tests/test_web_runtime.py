from fastapi.testclient import TestClient
import asyncio
import json
import re

from app.main import app
from app.db.session import AsyncSessionLocal
from app.models.runtime_state import RuntimeState
from app.models.shared_runtime_state import SharedRuntimeState
from app.models.teaching_content import TeachingContentRevision
from app.services import runtime_state_service
from app.services import teaching_content_revision_service as revision_service
from app.web import routes
from app.web.releases import WebRelease, active_release


async def _runtime_database_fingerprint() -> dict[str, object]:
    """Count and hash every Runtime row without exposing its payload in failures."""
    from hashlib import sha256
    from sqlalchemy import select

    async with AsyncSessionLocal() as db:
        runtime_rows = list(
            (await db.scalars(select(RuntimeState).order_by(RuntimeState.owner_id))).all()
        )
        shared_rows = list(
            (await db.scalars(select(SharedRuntimeState).order_by(SharedRuntimeState.key))).all()
        )
        revision_rows = list(
            (await db.scalars(select(TeachingContentRevision).order_by(TeachingContentRevision.id))).all()
        )
    return {
        "runtime": (
            len(runtime_rows),
            sha256(repr([
                (row.owner_id, row.schema_version, row.storage, row.revision, row.last_request_id)
                for row in runtime_rows
            ]).encode()).hexdigest(),
        ),
        "shared": (
            len(shared_rows),
            sha256(repr([
                (row.key, row.value, row.schema_version, row.updated_by)
                for row in shared_rows
            ]).encode()).hexdigest(),
        ),
        "teachingRevision": (
            len(revision_rows),
            sha256(repr([
                (row.id, row.revision, row.changes, row.updated_by)
                for row in revision_rows
            ]).encode()).hexdigest(),
        ),
    }


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


def test_all_retired_guided_learning_routes_redirect_without_query_context() -> None:
    with TestClient(app) as client:
        for route in (
            "/guided-learning-node.html?node=legacy-node",
            "/guided-learning-placement-test.html?part=legacy-part",
            "/learning/node?node=legacy-node",
            "/learning/placement-test?part=legacy-part",
        ):
            response = client.get(route, follow_redirects=False)
            assert response.status_code == 307, route
            assert response.headers["location"] == "/practice-mode.html", route


def test_guided_learning_api_is_retired() -> None:
    with TestClient(app) as client:
        response = client.get("/api/v1/guided-learning/courses/default")

    assert response.status_code == 404


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
        unversioned = client.get("/styles/main.css")
        retired_bootstrap = client.get("/server-state-bootstrap.js")

    assert versioned.status_code == 200
    assert versioned.headers["cache-control"] == "public, max-age=31536000, immutable"
    assert unversioned.status_code == 200
    assert unversioned.headers["cache-control"] == "no-cache"
    assert retired_bootstrap.status_code == 404


def _bootstrap(response_text: str) -> dict:
    match = re.search(r"window\.__KG_DIRECT_BOOTSTRAP__=(.*?);</script>", response_text)
    assert match, "missing direct bootstrap"
    return json.loads(match.group(1))


def test_learner_html_injects_auth_without_runtime_snapshot() -> None:
    with TestClient(app) as client:
        login = client.post("/api/v1/auth/login", json={"username": "佩奇007", "password": "111111"})
        assert login.status_code == 200
        response = client.get("/practice-mode.html")

    marker = "window.__KG_DIRECT_BOOTSTRAP__="
    assert marker in response.text
    assert response.text.index(marker) < response.text.index("kg-direct-bootstrap-anchor")
    payload = _bootstrap(response.text)
    assert payload["authUser"]["username"] == "佩奇007"
    assert payload["authUser"]["role"] == "admin"
    assert payload["authUser"]["loginSessionId"] == login.json()["loginSessionId"]
    for key in ("namespace", "revision", "contentRevision", "storage"):
        assert key not in payload


def test_learner_bootstrap_never_reads_or_seeds_runtime_state(monkeypatch) -> None:
    async def forbidden(*_args, **_kwargs):
        raise AssertionError("learner page attempted to read the retired runtime")

    monkeypatch.setattr(runtime_state_service, "get_state", forbidden)
    monkeypatch.setattr(runtime_state_service, "ensure_domain_seed", forbidden)

    with TestClient(app) as client:
        assert client.post(
            "/api/v1/auth/login",
            json={"username": "佩奇007", "password": "111111"},
        ).status_code == 200
        for page in (
            "index.html",
            "file-manager.html",
            "practice-mode.html",
            "knowledge-recall.html",
            "question-workspace.html",
            "question-training.html",
        ):
            response = client.get(f"/{page}")
            assert response.status_code == 200, page
            payload = _bootstrap(response.text)
            for key in ("namespace", "revision", "contentRevision", "storage"):
                assert key not in payload, page


def test_admin_settings_bootstrap_never_reads_or_seeds_runtime_state(monkeypatch) -> None:
    async def forbidden(*_args, **_kwargs):
        raise AssertionError("admin-settings attempted to read the retired runtime")

    monkeypatch.setattr(runtime_state_service, "get_state", forbidden)
    monkeypatch.setattr(runtime_state_service, "ensure_domain_seed", forbidden)
    with TestClient(app) as client:
        assert client.post(
            "/api/v1/auth/login",
            json={"username": "admin", "password": "jbgsnmm~123"},
        ).status_code == 200
        payload = _bootstrap(client.get("/admin-settings.html").text)

    for key in ("namespace", "revision", "contentRevision", "storage"):
        assert key not in payload


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


def test_runtime_state_read_is_gone_by_default_and_only_configuration_can_restore_it() -> None:
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
        assert client.get("/api/v1/runtime/state?mode=full").status_code == 410

        original = app_settings.RUNTIME_ROLLBACK_READ_ENABLED
        app_settings.RUNTIME_ROLLBACK_READ_ENABLED = True
        try:
            response = client.get("/api/v1/runtime/state?mode=full")
        finally:
            app_settings.RUNTIME_ROLLBACK_READ_ENABLED = original

        assert response.status_code == 200


def test_runtime_state_default_drain_never_reads_or_mutates_runtime(monkeypatch) -> None:
    async def runtime_service_forbidden(*_args, **_kwargs):
        raise AssertionError("frozen drain must not touch Runtime service")

    monkeypatch.setattr(runtime_state_service, "apply_update", runtime_service_forbidden)
    monkeypatch.setattr(runtime_state_service, "get_state", runtime_service_forbidden)
    with TestClient(app) as client:
        assert client.post(
            "/api/v1/auth/login",
            json={"username": "admin", "password": "jbgsnmm~123"},
        ).status_code == 200
        before = asyncio.run(_runtime_database_fingerprint())
        for method in (client.put, client.post):
            response = method(
                "/api/v1/runtime/state",
                json={
                    "page": "learning-path.html",
                    "namespace": "guided-learning",
                    "operation": "setItem",
                    "key": "kg_default_entry_mode_v1",
                    "value": "drain-probe",
                    "storage": {"kg_default_entry_mode_v1": "drain-probe"},
                    "requestId": f"pytest-drain-{method.__name__}",
                },
            )
            assert response.status_code == 200
            assert response.json()["revision"] == 0
            assert response.json()["contentRevision"] == 0
        after = asyncio.run(_runtime_database_fingerprint())

    assert after == before


def test_runtime_rollback_read_is_snapshot_only_without_promotion_or_seed(monkeypatch) -> None:
    from app.core.config import settings as app_settings

    marker_key = "kg_teacher_shared_runtime_promotion_v1"

    async def remove_marker() -> tuple[str, int, str | None] | None:
        async with AsyncSessionLocal() as db:
            row = await db.get(SharedRuntimeState, marker_key)
            saved = None if row is None else (row.value, row.schema_version, row.updated_by)
            if row is not None:
                await db.delete(row)
                await db.commit()
            return saved

    async def restore_marker(saved: tuple[str, int, str | None] | None) -> None:
        if saved is None:
            return
        async with AsyncSessionLocal() as db:
            db.add(SharedRuntimeState(
                key=marker_key,
                value=saved[0],
                schema_version=saved[1],
                updated_by=saved[2],
            ))
            await db.commit()

    async def runtime_service_forbidden(*_args, **_kwargs):
        raise AssertionError("rollback read must not use mutating Runtime paths")

    saved_marker = asyncio.run(remove_marker())
    monkeypatch.setattr(app_settings, "RUNTIME_ROLLBACK_READ_ENABLED", True)
    monkeypatch.setattr(runtime_state_service, "get_state", runtime_service_forbidden)
    monkeypatch.setattr(runtime_state_service, "ensure_domain_seed", runtime_service_forbidden)
    try:
        with TestClient(app) as client:
            assert client.post(
                "/api/v1/auth/login",
                json={"username": "admin", "password": "jbgsnmm~123"},
            ).status_code == 200
            before = asyncio.run(_runtime_database_fingerprint())
            for path in (
                "/api/v1/runtime/state?mode=full",
                "/api/v1/runtime/state?mode=bootstrap&page=admin-settings.html",
            ):
                response = client.get(path)
                assert response.status_code == 200, response.text
            after = asyncio.run(_runtime_database_fingerprint())

        assert after == before
    finally:
        asyncio.run(restore_marker(saved_marker))


def test_runtime_claims_default_drain_never_mutate_runtime(monkeypatch) -> None:
    async def runtime_service_forbidden(*_args, **_kwargs):
        raise AssertionError("frozen claim must not touch Runtime service")

    monkeypatch.setattr(runtime_state_service, "claim_learning_entry", runtime_service_forbidden)
    monkeypatch.setattr(runtime_state_service, "claim_guided_tour", runtime_service_forbidden)
    with TestClient(app) as client:
        assert client.post(
            "/api/v1/auth/login",
            json={"username": "admin", "password": "jbgsnmm~123"},
        ).status_code == 200
        before = asyncio.run(_runtime_database_fingerprint())
        for path in (
            "/api/v1/runtime/learning-entry-claim",
            "/api/v1/runtime/guided-tour-claim",
        ):
            response = client.post(path)
            assert response.status_code == 200, response.text
            assert response.json()["claimed"] is False
            assert response.json()["revision"] == 0
        after = asyncio.run(_runtime_database_fingerprint())

    assert after == before


def test_learner_html_bootstrap_never_inlines_runtime_storage() -> None:
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


def test_html_bootstrap_contains_no_runtime_snapshot_fields() -> None:
    with TestClient(app) as client:
        login = client.post(
            "/api/v1/auth/login",
            json={"username": "佩奇007", "password": "111111"},
        )
        assert login.status_code == 200
        response = client.get("/paper-management.html")

    payload = _bootstrap(response.text)
    assert payload["authenticated"] is True
    for key in ("namespace", "revision", "contentRevision", "storage"):
        assert key not in payload


def test_guest_html_bootstrap_has_no_runtime_snapshot() -> None:
    with TestClient(app) as client:
        payload = _bootstrap(client.get("/index.html").text)

    assert payload["authenticated"] is False
    for key in ("namespace", "revision", "contentRevision", "storage"):
        assert key not in payload


def test_runtime_full_snapshot_excludes_published_paper_bulk_keys(monkeypatch) -> None:
    """发布大键不得随 full 快照下发（2026-08-25 生产 TTFB 13~20s 事故）。

    两个大键（生产 2.5MB+）在每次快照读取时整包拉取 + 脱敏解析会占满
    单 worker 事件循环；已发布内容的读取边界是 /api/v1/paper-releases
    细粒度 API，runtime 快照（含 full 模式）一律不携带。
    """
    from app.services import runtime_state_service as service
    from app.core.config import settings as app_settings
    from sqlalchemy import select

    async def seed_shared_bulk_keys() -> None:
        from app.models.shared_runtime_state import SharedRuntimeState

        async with AsyncSessionLocal() as db:
            for key in service.RUNTIME_SNAPSHOT_EXCLUDED_KEYS:
                row = await db.get(SharedRuntimeState, key)
                if row is None:
                    db.add(SharedRuntimeState(
                        key=key,
                        value=json.dumps([{"id": "paper-bulk", "name": "bulk"}]),
                        updated_by="admin",
                    ))
                else:
                    row.value = json.dumps([{"id": "paper-bulk", "name": "bulk"}])
            await db.commit()

    monkeypatch.setattr(app_settings, "RUNTIME_ROLLBACK_READ_ENABLED", True)
    asyncio.run(seed_shared_bulk_keys())
    try:
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
            snapshot = client.get("/api/v1/runtime/state?mode=full").json()

        storage = snapshot["storage"]
        for key in service.RUNTIME_SNAPSHOT_EXCLUDED_KEYS:
            assert key not in storage
    finally:
        async def cleanup_shared_bulk_keys() -> None:
            from app.models.shared_runtime_state import SharedRuntimeState

            async with AsyncSessionLocal() as db:
                rows = (await db.execute(
                    select(SharedRuntimeState).where(
                        SharedRuntimeState.key.in_(service.RUNTIME_SNAPSHOT_EXCLUDED_KEYS)
                    )
                )).scalars().all()
                for row in rows:
                    await db.delete(row)
                await db.commit()

        asyncio.run(cleanup_shared_bulk_keys())
