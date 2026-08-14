from uuid import uuid4

from fastapi.testclient import TestClient

from app.main import app


def _login_admin(client: TestClient) -> None:
    response = client.post("/api/v1/auth/login", json={"username": "admin", "password": "jbgsnmm~123"})
    assert response.status_code == 200, response.text


def _question(title: str, *, stem: str, answer: str = "A") -> dict:
    return {
        "title": title,
        "stemParts": [{"text": stem}],
        "options": [{"id": "A", "text": "方案一"}, {"id": "B", "text": "方案二"}],
        "correctAnswer": answer,
    }


def test_batch_import_requires_duplicate_confirmation_and_assigns_one_number_per_question() -> None:
    client = TestClient(app)
    _login_admin(client)
    bank = client.post(
        "/api/v1/banks",
        json={"name": f"查重题库-{uuid4().hex[:8]}", "subject": "PMP"},
    ).json()["bank"]
    existing = _question("已有题", stem="风险  应对")
    seeded = client.post(f"/api/v1/banks/{bank['id']}/questions", json=existing)
    assert seeded.status_code == 200, seeded.text

    batch = [
        _question("已有题的规范化副本", stem="ＲＩＳＫ"),
        _question("新题第一次", stem="范围 变更"),
        _question("新题重复", stem="  范围   变更  "),
        _question("答案不同不是重复", stem="范围 变更", answer="B"),
    ]
    # Make the first row an NFKC/case/space equivalent of a separately seeded English row.
    english_bank = client.post(f"/api/v1/banks/{bank['id']}/questions", json=_question("英文已有题", stem="risk")).json()["question"]
    assert english_bank["id"]

    preview = client.post(
        f"/api/v1/banks/{bank['id']}/questions/import",
        json={"questions": batch, "confirmDuplicateCleanup": False},
    )
    assert preview.status_code == 409, preview.text
    detail = preview.json()["detail"]
    assert detail["code"] == "QUESTION_DUPLICATES_CONFIRMATION_REQUIRED"
    assert detail["importPlan"]["existingCount"] == 1
    assert detail["importPlan"]["batchCount"] == 1
    assert detail["importPlan"]["keepCount"] == 2
    unchanged = client.get(f"/api/v1/banks/{bank['id']}/questions", params={"page_size": 100})
    assert unchanged.status_code == 200, unchanged.text
    assert unchanged.json()["total"] == 2

    imported = client.post(
        f"/api/v1/banks/{bank['id']}/questions/import",
        json={"questions": batch, "confirmDuplicateCleanup": True},
    )
    assert imported.status_code == 200, imported.text
    rows = imported.json()["questions"]
    assert len(rows) == 2
    assert len({row["teacherNumber"] for row in rows}) == 2
    assert all(row["teacherNumber"].startswith("PMP-") for row in rows)


def test_duplicate_signature_preserves_punctuation_option_order_and_answer() -> None:
    from app.services.question_content_service import duplicate_question_signature

    base = _question("基础", stem="应该怎么做？", answer="A")
    normalized = _question("标题不参与", stem="  应该怎么做？  ", answer="A")
    punctuation = _question("标点不同", stem="应该怎么做！", answer="A")
    answer = _question("答案不同", stem="应该怎么做？", answer="B")
    reordered = {**base, "options": list(reversed(base["options"]))}
    assert duplicate_question_signature(base) == duplicate_question_signature(normalized)
    assert duplicate_question_signature(base) != duplicate_question_signature(punctuation)
    assert duplicate_question_signature(base) != duplicate_question_signature(answer)
    assert duplicate_question_signature(base) != duplicate_question_signature(reordered)
