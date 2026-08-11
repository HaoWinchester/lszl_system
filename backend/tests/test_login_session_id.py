"""Authentication lifecycle coverage for server-issued login session IDs."""

from base64 import b64decode, b64encode
import json
import re
from uuid import uuid4

from fastapi.testclient import TestClient
from itsdangerous import TimestampSigner

from app.core.config import settings
from app.main import app


def login(client: TestClient, username: str, password: str):
    return client.post(
        "/api/v1/auth/login",
        json={"username": username, "password": password},
    )


def decoded_session(client: TestClient) -> dict:
    cookie = client.cookies.get("kg_session")
    if not cookie:
        return {}
    signed = TimestampSigner(settings.SECRET_KEY).unsign(cookie.encode("utf-8"))
    return json.loads(b64decode(signed))


def extract_bootstrap(response) -> dict:
    match = re.search(r"window\.__KG_DIRECT_BOOTSTRAP__=(.*?);</script>", response.text)
    assert match, "missing direct bootstrap"
    return json.loads(match.group(1))


def test_login_session_id_rotates_only_on_successful_login() -> None:
    with TestClient(app) as client:
        failed_before_login = login(client, "老师", "wrong")
        assert failed_before_login.status_code == 401
        assert "username" not in decoded_session(client)
        assert "login_session_id" not in decoded_session(client)

        first = login(client, "老师", "111111").json()["loginSessionId"]
        assert client.get("/api/v1/auth/me").json()["loginSessionId"] == first
        assert extract_bootstrap(client.get("/index.html"))["authUser"]["loginSessionId"] == first

        failed = login(client, "老师", "wrong")
        assert failed.status_code == 401
        assert client.get("/api/v1/auth/me").json()["loginSessionId"] == first

        second = login(client, "老师", "111111").json()["loginSessionId"]
        assert second != first

        client.post("/api/v1/auth/logout")
        assert "username" not in decoded_session(client)
        assert "login_session_id" not in decoded_session(client)


def test_registration_auto_login_issues_a_stable_login_session_id() -> None:
    username = f"session_register_{uuid4().hex[:16]}"
    with TestClient(app) as client:
        registered = client.post(
            "/api/v1/auth/register",
            json={"username": username, "password": "test-password"},
        )
        assert registered.status_code == 200, registered.text
        login_session_id = registered.json()["loginSessionId"]
        assert client.get("/api/v1/auth/me").json()["loginSessionId"] == login_session_id
        assert extract_bootstrap(client.get("/index.html"))["authUser"]["loginSessionId"] == login_session_id
        assert decoded_session(client)["login_session_id"] == login_session_id


def test_old_valid_username_session_is_lazily_assigned_once() -> None:
    old_session = b64encode(json.dumps({"username": "admin"}).encode("utf-8"))
    cookie = TimestampSigner(settings.SECRET_KEY).sign(old_session).decode("utf-8")
    with TestClient(app) as client:
        client.cookies.set("kg_session", cookie)
        first = client.get("/api/v1/auth/me").json()["loginSessionId"]
        second = client.get("/api/v1/auth/me").json()["loginSessionId"]

    assert first == second
