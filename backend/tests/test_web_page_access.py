from fastapi.testclient import TestClient

from app.main import app
from app.web.routes import TEACHING_PAGES


def _login(client: TestClient, username: str, password: str = "111111") -> None:
    response = client.post("/api/v1/auth/login", json={"username": username, "password": password})
    assert response.status_code == 200


def test_student_cannot_download_privileged_page_html() -> None:
    with TestClient(app) as client:
        _login(client, "学生")
        for page in (
            "admin-console.html",
            "admin-operations.html",
            "admin-settings.html",
            "admin-subjects.html",
            "teacher-workbench.html",
            "course-admin.html",
        ):
            response = client.get(f"/{page}")
            assert response.status_code == 403, page
            assert "无权访问" in response.text


def test_student_cannot_download_privileged_preview_html() -> None:
    from app.web.releases import active_release

    with TestClient(app) as client:
        _login(client, "学生")
        version = active_release().version
        response = client.get(f"/__preview/{version}/admin-console.html")
    assert response.status_code == 403
    assert "无权访问" in response.text


def test_anonymous_cannot_download_privileged_page_html() -> None:
    with TestClient(app) as client:
        response = client.get("/admin-console.html")
    assert response.status_code == 403


def test_admin_can_download_privileged_page_html() -> None:
    with TestClient(app) as client:
        _login(client, "admin", "jbgsnmm~123")
        response = client.get("/admin-console.html")
    assert response.status_code == 200
    assert "管理后台" in response.text


def test_content_prep_html_is_registered_as_a_teaching_page() -> None:
    assert "content-prep.html" in TEACHING_PAGES
