from app.main import app


def test_remote_engagement_routes_are_registered() -> None:
    routes={(route.path,method) for route in app.routes for method in getattr(route,"methods",set())}
    expected={
        ("/api/v1/engagement/feedback","POST"),
        ("/api/v1/engagement/feedback/mine","GET"),
        ("/api/v1/engagement/admin/feedback","GET"),
        ("/api/v1/engagement/messages","GET"),
        ("/api/v1/engagement/unread-summary","GET"),
        ("/api/v1/engagement/admin/messages","GET"),
        ("/api/v1/engagement/admin/messages","POST"),
    }
    assert expected <= routes


def test_engagement_admin_routes_reject_students() -> None:
    from fastapi.testclient import TestClient

    with TestClient(app) as client:
        assert client.post(
            "/api/v1/auth/login",
            json={"username":"学生","password":"111111"},
        ).status_code == 200
        response=client.get("/api/v1/engagement/admin/feedback")
    assert response.status_code == 403


def test_engagement_rejects_blank_feedback_without_writing() -> None:
    from fastapi.testclient import TestClient

    with TestClient(app) as client:
        assert client.post(
            "/api/v1/auth/login",
            json={"username": "学生", "password": "111111"},
        ).status_code == 200
        response = client.post(
            "/api/v1/engagement/feedback",
            json={"title": "  ", "detail": "  "},
        )

    assert response.status_code == 422
    assert "标题" in response.json()["detail"]


def test_engagement_rejects_blank_admin_message_without_writing() -> None:
    from fastapi.testclient import TestClient

    with TestClient(app) as client:
        assert client.post(
            "/api/v1/auth/login",
            json={"username": "admin", "password": "jbgsnmm~123"},
        ).status_code == 200
        response = client.post(
            "/api/v1/engagement/admin/messages",
            json={"title": "", "body": "", "audience": {"type": "all"}},
        )

    assert response.status_code == 422
    assert "标题" in response.json()["detail"]


def test_engagement_lists_return_bounded_pagination_metadata() -> None:
    from fastapi.testclient import TestClient

    with TestClient(app) as client:
        assert client.post(
            "/api/v1/auth/login",
            json={"username": "学生", "password": "111111"},
        ).status_code == 200
        response = client.get("/api/v1/engagement/feedback/mine?limit=1&offset=0")

    assert response.status_code == 200, response.text
    assert response.json()["pagination"]["limit"] == 1
    assert response.json()["pagination"]["offset"] == 0
    assert response.json()["pagination"]["total"] >= len(response.json()["items"])


def test_engagement_lists_preserve_nonzero_offset_in_service_contract() -> None:
    from fastapi.testclient import TestClient

    with TestClient(app) as client:
        assert client.post(
            "/api/v1/auth/login",
            json={"username": "学生", "password": "111111"},
        ).status_code == 200
        response = client.get("/api/v1/engagement/feedback/mine?limit=1&offset=1")

    assert response.status_code == 200, response.text
    payload = response.json()
    assert payload["pagination"]["limit"] == 1
    assert payload["pagination"]["offset"] == 1
    assert payload["pagination"]["total"] >= len(payload["items"])


    from fastapi.testclient import TestClient

    with TestClient(app) as client:
        assert client.post(
            "/api/v1/auth/login",
            json={"username": "学生", "password": "111111"},
        ).status_code == 200
        response = client.post(
            "/api/v1/engagement/feedback",
            json={"title": "x" * 121, "detail": "有效描述"},
        )

    assert response.status_code == 422
    assert "标题" in response.json()["detail"]


def test_engagement_rejects_executable_attachment_data_url() -> None:
    from fastapi.testclient import TestClient

    with TestClient(app) as client:
        assert client.post(
            "/api/v1/auth/login",
            json={"username": "学生", "password": "111111"},
        ).status_code == 200
        response = client.post(
            "/api/v1/engagement/feedback",
            json={
                "title": "截图安全测试",
                "detail": "恶意附件必须在写入前被拒绝。",
                "attachment": {
                    "name": "x.png",
                    "type": "image/png",
                    "size": 1,
                    "dataUrl": 'data:image/png;base64,"><img src=x onerror=alert(1)>',
                },
            },
        )

    assert response.status_code == 422
    assert "截图" in response.json()["detail"]
