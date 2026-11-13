"""财务管理 API 测试：角色矩阵、发票上传/下载、校验与按月汇总。"""

import io

from PIL import Image


def _png_bytes() -> bytes:
    buffer = io.BytesIO()
    Image.new("RGB", (4, 4), color=(200, 30, 30)).save(buffer, format="PNG")
    return buffer.getvalue()


def _login(client, username: str, password: str) -> None:
    assert client.post(
        "/api/v1/auth/login",
        json={"username": username, "password": password},
    ).status_code == 200


def _create(client, **overrides):
    data = {
        "amount": "128.50",
        "purpose": "办公耗材采购",
        "spent_on": "2026-11-05",
        "note": "测试备注",
    }
    data.update(overrides)
    return client.post("/api/v1/finance/records", data=data)


def test_finance_routes_are_registered() -> None:
    from app.main import app

    routes = {(route.path, method) for route in app.routes for method in getattr(route, "methods", set())}
    expected = {
        ("/api/v1/finance/records", "GET"),
        ("/api/v1/finance/records", "POST"),
        ("/api/v1/finance/records/{record_id}", "GET"),
        ("/api/v1/finance/records/{record_id}", "PUT"),
        ("/api/v1/finance/records/{record_id}", "DELETE"),
        ("/api/v1/finance/records/{record_id}/invoice", "GET"),
    }
    assert expected <= routes


def test_finance_page_and_api_reject_students() -> None:
    from fastapi.testclient import TestClient
    from app.main import app

    with TestClient(app) as client:
        _login(client, "学生", "111111")
        api = client.get("/api/v1/finance/records")
        page = client.get("/finance-management.html")
    assert api.status_code == 403
    assert page.status_code == 403


def test_teacher_can_write_but_not_delete() -> None:
    from fastapi.testclient import TestClient
    from app.main import app

    with TestClient(app) as client:
        _login(client, "老师", "111111")
        created = _create(client)
        assert created.status_code == 201, created.text
        record_id = created.json()["id"]
        updated = client.put(
            f"/api/v1/finance/records/{record_id}",
            json={"purpose": "软件订阅续费"},
        )
        assert updated.status_code == 200
        assert updated.json()["purpose"] == "软件订阅续费"
        deleted = client.delete(f"/api/v1/finance/records/{record_id}")
        assert deleted.status_code == 403
        listed = client.get("/api/v1/finance/records")
        assert listed.status_code == 200
        assert any(item["id"] == record_id for item in listed.json()["items"])


def test_admin_full_lifecycle_with_invoice() -> None:
    import shutil

    from fastapi.testclient import TestClient
    from app.core.config import settings
    from app.main import app

    record_id = None
    try:
        with TestClient(app) as client:
            _login(client, "admin", "jbgsnmm~123")
            created = client.post(
                "/api/v1/finance/records",
                data={
                    "amount": "320.00",
                    "purpose": "域名年费",
                    "spent_on": "2026-11-08",
                    "note": "",
                },
                files={"invoice": ("发票.png", _png_bytes(), "image/png")},
            )
            assert created.status_code == 201, created.text
            body = created.json()
            record_id = body["id"]
            assert body["invoice"]["name"] == "发票.png"
            assert body["invoice"]["mime"] == "image/png"
            assert body["invoice"]["url"].endswith(f"/records/{record_id}/invoice")

            downloaded = client.get(body["invoice"]["url"])
            assert downloaded.status_code == 200
            assert downloaded.headers["content-type"].startswith("image/png")
            assert "attachment" in downloaded.headers.get("content-disposition", "")

            # 无发票记录的发票端点 → 404
            created_plain = _create(client)
            assert created_plain.status_code == 201
            plain_id = created_plain.json()["id"]
            assert created_plain.json()["invoice"] is None
            missing = client.get(f"/api/v1/finance/records/{plain_id}/invoice")
            assert missing.status_code == 404

            deleted = client.delete(f"/api/v1/finance/records/{record_id}")
            assert deleted.status_code == 200
            record_id = None
            assert client.get(f"/api/v1/finance/records/{plain_id}/invoice").status_code == 404
            client.delete(f"/api/v1/finance/records/{plain_id}")
    finally:
        shutil.rmtree(f"{settings.FINANCE_INVOICE_STORAGE}/{record_id}" if record_id else settings.FINANCE_INVOICE_STORAGE, ignore_errors=True)


def test_finance_rejects_bad_invoice_and_invalid_fields() -> None:
    from fastapi.testclient import TestClient
    from app.main import app

    with TestClient(app) as client:
        _login(client, "admin", "jbgsnmm~123")
        bad_suffix = client.post(
            "/api/v1/finance/records",
            data={"amount": "10", "purpose": "测试", "spent_on": "2026-11-01"},
            files={"invoice": ("木马.exe", b"MZ...", "application/octet-stream")},
        )
        assert bad_suffix.status_code == 422
        zero_amount = _create(client, amount="0")
        assert zero_amount.status_code == 422
        negative_amount = _create(client, amount="-5")
        assert negative_amount.status_code == 422
        blank_purpose = _create(client, purpose="  ")
        assert blank_purpose.status_code == 422
        not_found = client.get("/api/v1/finance/records/fin_missing/invoice")
        assert not_found.status_code == 404


def test_finance_month_filter_and_summary() -> None:
    from fastapi.testclient import TestClient
    from app.main import app

    created_ids = []
    try:
        with TestClient(app) as client:
            _login(client, "admin", "jbgsnmm~123")
            nov = _create(client, amount="100.00", spent_on="2026-11-02")
            dec = _create(client, amount="250.00", spent_on="2026-12-09")
            assert nov.status_code == 201 and dec.status_code == 201
            created_ids = [nov.json()["id"], dec.json()["id"]]

            listed = client.get("/api/v1/finance/records?month=2026-11")
            assert listed.status_code == 200
            payload = listed.json()
            returned_ids = {item["id"] for item in payload["items"]}
            assert nov.json()["id"] in returned_ids
            assert dec.json()["id"] not in returned_ids
            assert payload["pagination"]["total"] >= 1
            nov_summary = [m for m in payload["monthly"] if m["month"] == "2026-11"]
            assert nov_summary and nov_summary[0]["count"] >= 1

            bad_month = client.get("/api/v1/finance/records?month=202611")
            assert bad_month.status_code == 422
    finally:
        from fastapi.testclient import TestClient
        from app.main import app

        with TestClient(app) as client:
            _login(client, "admin", "jbgsnmm~123")
            for record_id in created_ids:
                client.delete(f"/api/v1/finance/records/{record_id}")
