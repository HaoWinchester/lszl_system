from fastapi.testclient import TestClient

from app.main import app


def test_authenticated_user_can_update_and_restore_own_profile() -> None:
    with TestClient(app) as client:
        assert client.post(
            "/api/v1/auth/login",
            json={"username": "学生", "password": "111111"},
        ).status_code == 200
        original = client.get("/api/v1/auth/me").json()["user"]
        try:
            updated = client.put(
                "/api/v1/auth/me",
                json={
                    "display_name": "学生资料回归测试",
                    "email": "student-profile@example.com",
                    "phone": "13800000000",
                    "subject": "PMP",
                    "tags": ["自动化"],
                    "note": "保存后刷新仍应存在",
                },
            )
            assert updated.status_code == 200, updated.text
            refreshed = client.get("/api/v1/auth/me").json()["user"]
            assert refreshed["display_name"] == "学生资料回归测试"
            assert refreshed["email"] == "student-profile@example.com"
            assert refreshed["tags"] == ["自动化"]
        finally:
            client.put(
                "/api/v1/auth/me",
                json={
                    "display_name": original["display_name"] or original["username"],
                    "email": original["email"] or "",
                    "phone": original["phone"] or "",
                    "subject": original["subject"] or "PMP",
                    "tags": original["tags"],
                    "note": original["note"] or "",
                },
            )


def test_self_profile_cannot_change_role_or_status() -> None:
    with TestClient(app) as client:
        assert client.post(
            "/api/v1/auth/login",
            json={"username": "学生", "password": "111111"},
        ).status_code == 200
        response = client.put("/api/v1/auth/me", json={"role": "admin"})

    assert response.status_code == 422
