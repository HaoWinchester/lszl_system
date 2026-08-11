from fastapi.testclient import TestClient
import json
import re

from app.main import app
from app.db.session import AsyncSessionLocal
from app.services import runtime_state_service
from app.services import teaching_content_revision_service as revision_service
from app.web.releases import active_release


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


def test_direct_page_serves_upstream_dom() -> None:
    with TestClient(app) as client:
        response = client.get("/question-training.html")

    assert response.status_code == 200
    assert 'class="question-training-page"' in response.text
    assert re.search(r'src="src/72-question-training-page\.js(?:\?v=[^"]+)?"', response.text)


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
