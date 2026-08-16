"""内容签名覆盖：同题干+选项+答案的题以新 ID 再次同步时，覆盖已有题而不是新增重复。"""

import asyncio
from uuid import uuid4

from fastapi.testclient import TestClient
from sqlalchemy import delete, select

from app.core.security import hash_password
from app.db.session import AsyncSessionLocal
from app.main import app
from app.models.content_prep import ContentPrepDraft, QuestionUploadBatch
from app.models.question import Question, QuestionBank
from app.models.user import User
from tests.test_content_prep_upload import question_payload


PASSWORD = "prep-dupoverride-pass"


def _workspace_payload(bank_id: str, question_id: str, *, analysis: str = "原解析") -> dict:
    question = question_payload(question_id, analysis=analysis)
    question["metadata"] = {"principleIds": [], "optionPrincipleMap": {}}
    return {
        "prepStudioWorkspaceVersion": 4,
        "prepStudioVersion": "0.4.0",
        "questionBank": {
            "id": "local-bank",
            "name": "签名覆盖测试题库",
            "subject": "PMP",
            "questions": [question],
        },
        "principles": {"schemaVersion": 1, "items": []},
        "synthesisPresets": {"schemaVersion": 1, "items": []},
        "tagConfig": {"schemaVersion": 1, "names": {}},
        "recallLibrary": {"schemaVersion": 1, "nodes": [], "edges": []},
        "knowledgeTree": None,
        "server": {"serverBankId": bank_id, "clientInstanceId": "content-prep-dupoverride-test"},
    }


def test_same_content_new_id_overrides_existing_question() -> None:
    suffix = uuid4().hex[:10]
    teacher = f"prep-dupoverride-teacher-{suffix}"
    bank_id = f"prep-dupoverride-bank-{suffix}"
    first_id = str(uuid4())
    second_id = str(uuid4())  # 同内容、不同 ID 的第二次导入

    async def seed() -> None:
        async with AsyncSessionLocal() as db:
            db.add(User(username=teacher, password_hash=hash_password(PASSWORD), role="teacher", status="active", subject="PMP"))
            await db.flush()
            db.add(
                QuestionBank(
                    id=bank_id,
                    owner_id=teacher,
                    name="签名覆盖目标题库",
                    subject="PMP",
                    created_by=teacher,
                    updated_by=teacher,
                )
            )
            await db.commit()

    async def cleanup() -> None:
        async with AsyncSessionLocal() as db:
            await db.execute(delete(ContentPrepDraft).where(ContentPrepDraft.created_by == teacher))
            await db.execute(delete(QuestionUploadBatch).where(QuestionUploadBatch.bank_id == bank_id))
            await db.execute(delete(Question).where(Question.bank_id == bank_id))
            await db.execute(delete(QuestionBank).where(QuestionBank.id == bank_id))
            await db.execute(delete(User).where(User.username == teacher))
            await db.commit()

    def _sync(client: TestClient, question_id: str, *, analysis: str = "原解析") -> dict:
        created = client.post(
            "/api/v1/content-prep/drafts",
            json={"title": f"签名覆盖草稿 {question_id[:8]}", "payload": _workspace_payload(bank_id, question_id, analysis=analysis)},
        )
        assert created.status_code == 201, created.text
        draft = created.json()["draft"]
        synced = client.post(
            f"/api/v1/content-prep/drafts/{draft['id']}/sync",
            json={"revision": 1, "creatorId": "creator_001"},
        )
        assert synced.status_code == 200, synced.text
        return synced.json()["result"]

    asyncio.run(seed())
    try:
        with TestClient(app) as client:
            assert client.post("/api/v1/auth/login", json={"username": teacher, "password": PASSWORD}).status_code == 200

            first = _sync(client, first_id)
            assert [q["status"] for q in first["questions"]] == ["created"]

            # 同题干+选项+答案、不同 ID 再次同步(解析有更新)：应覆盖已有题(updated),而不是 created 出重复
            second = _sync(client, second_id, analysis="覆盖后的新解析")
            assert [q["status"] for q in second["questions"]] == ["updated"], second
            # 沿用第一题的稳定 ID
            assert second["questions"][0]["questionId"] == first["questions"][0]["questionId"]

            async def _count() -> int:
                async with AsyncSessionLocal() as db:
                    return len((await db.execute(select(Question.id).where(Question.bank_id == bank_id))).scalars().all())

            assert asyncio.run(_count()) == 1
    finally:
        asyncio.run(cleanup())
