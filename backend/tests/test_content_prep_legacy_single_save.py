import asyncio
from uuid import uuid4

from fastapi.testclient import TestClient
from sqlalchemy import delete, select

from app.db.session import AsyncSessionLocal
from app.main import app
from app.models.content_prep import QuestionAuditLog, QuestionEditLock
from app.models.question import Question, QuestionBank
from tests.test_content_prep_upload import question_payload


def test_locked_single_save_preserves_null_legacy_creator_and_audits_actor() -> None:
    suffix = uuid4().hex[:10]
    bank_id = f"legacy-save-bank-{suffix}"
    question_id = f"legacy-save-question-{suffix}"

    async def seed() -> None:
        async with AsyncSessionLocal() as db:
            db.add(
                QuestionBank(
                    id=bank_id,
                    owner_id="admin",
                    name="历史题保存测试",
                    subject="PMP",
                    created_by="admin",
                    updated_by="admin",
                )
            )
            await db.flush()
            db.add(
                Question(
                    id=question_id,
                    bank_id=bank_id,
                    title="历史题",
                    subject="PMP",
                    scope="internal",
                    revision=1,
                    creator_id=None,
                    creator_name=None,
                    created_by="admin",
                    updated_by="admin",
                )
            )
            await db.commit()

    async def verify() -> None:
        async with AsyncSessionLocal() as db:
            question = await db.get(Question, question_id)
            assert question is not None
            assert question.title == "历史题已更新"
            assert question.revision == 2
            assert question.creator_id is None
            assert question.creator_name is None
            assert question.updated_by == "admin"
            audit = (
                await db.execute(
                    select(QuestionAuditLog).where(
                        QuestionAuditLog.question_id == question_id,
                        QuestionAuditLog.action == "question_updated",
                    )
                )
            ).scalar_one()
            assert audit.actor_username == "admin"
            assert audit.actor_role == "admin"
            assert audit.creator_id is None

    async def cleanup() -> None:
        async with AsyncSessionLocal() as db:
            await db.execute(delete(QuestionEditLock).where(QuestionEditLock.question_id == question_id))
            await db.execute(delete(QuestionAuditLog).where(QuestionAuditLog.bank_id == bank_id))
            await db.execute(delete(Question).where(Question.id == question_id))
            await db.execute(delete(QuestionBank).where(QuestionBank.id == bank_id))
            await db.commit()

    asyncio.run(seed())
    try:
        with TestClient(app) as client:
            login = client.post(
                "/api/v1/auth/login",
                json={"username": "admin", "password": "admin123"},
            )
            assert login.status_code == 200
            grant_response = client.post(
                f"/api/v1/content-prep/locks/{question_id}",
                json={"clientInstanceId": "legacy-editor"},
            )
            assert grant_response.status_code == 200
            grant = grant_response.json()
            changed = question_payload(question_id, title="历史题已更新")
            response = client.put(
                f"/api/v1/content-prep/questions/{question_id}",
                json={
                    "idempotencyKey": f"legacy-save-{suffix}",
                    "clientInstanceId": "legacy-editor",
                    "prepVersion": "new-legacy",
                    "workspaceVersion": "1",
                    "question": changed,
                    "baseRevision": 1,
                    "lockToken": grant["lockToken"],
                    "principles": {},
                    "synthesisPresets": {},
                    "tagConfig": {},
                },
            )
            assert response.status_code == 200, response.text
            assert response.json()["question"]["creatorId"] is None
        asyncio.run(verify())
    finally:
        asyncio.run(cleanup())
