"""用户复制和安全导入的回归测试。"""

from uuid import uuid4

from fastapi.testclient import TestClient

from app.main import app


def login_admin(client: TestClient) -> None:
    response = client.post(
        "/api/v1/auth/login",
        json={"username": "admin", "password": "admin123"},
    )
    assert response.status_code == 200


def delete_users(client: TestClient, *usernames: str) -> None:
    client.request("DELETE", "/api/v1/users/batch", json={"usernames": list(usernames)})


def test_duplicate_user_appends_copy_suffix_to_display_name() -> None:
    token = uuid4().hex[:10]
    source = f"duplicate-source-{token}"
    copied = f"duplicate-copy-{token}"
    with TestClient(app) as client:
        login_admin(client)
        try:
            created = client.post(
                "/api/v1/users",
                json={
                    "username": source,
                    "password": "111111",
                    "role": "student",
                    "display_name": "深度测试用户",
                },
            )
            assert created.status_code == 200, created.text

            duplicate = client.post(
                f"/api/v1/users/{source}/duplicate",
                json={"new_username": copied, "new_password": "111111"},
            )

            assert duplicate.status_code == 200, duplicate.text
            assert duplicate.json()["user"]["display_name"] == "深度测试用户 副本"
        finally:
            delete_users(client, source, copied)


def test_import_requires_an_explicit_initial_password() -> None:
    username = f"import-missing-password-{uuid4().hex[:10]}"
    with TestClient(app) as client:
        login_admin(client)
        try:
            response = client.post(
                "/api/v1/users/import",
                json={"users": [{"username": username, "role": "student"}]},
            )

            assert response.status_code == 422
        finally:
            delete_users(client, username)


def test_imported_user_can_login_with_the_supplied_initial_password() -> None:
    username = f"import-login-{uuid4().hex[:10]}"
    with TestClient(app) as client:
        login_admin(client)
        try:
            imported = client.post(
                "/api/v1/users/import",
                json={
                    "initial_password": "112233",
                    "users": [
                        {
                            "username": username,
                            "role": "student",
                            "status": "active",
                            "display_name": "可登录导入用户",
                        }
                    ],
                },
            )
            assert imported.status_code == 200, imported.text
            assert imported.json()["added"] == 1

            client.post("/api/v1/auth/logout")
            login = client.post(
                "/api/v1/auth/login",
                json={"username": username, "password": "112233"},
            )
            assert login.status_code == 200, login.text
        finally:
            login_admin(client)
            delete_users(client, username)


def test_user_export_never_contains_password_material() -> None:
    with TestClient(app) as client:
        login_admin(client)
        payload = client.get("/api/v1/users/export?usernames=学生").json()

    serialized = str(payload).lower()
    assert "password" not in serialized
    assert "hash" not in serialized
    assert "salt" not in serialized
