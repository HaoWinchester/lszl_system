"""CONTENT_PREP_VALIDATION_DISABLED 开关行为：默认阻断校验失败，开启后放行并留审计日志。"""

import asyncio
from uuid import uuid4

from fastapi.testclient import TestClient
from sqlalchemy import delete, select

from app.core.config import settings
from app.core.security import hash_password
from app.db.session import AsyncSessionLocal
from app.main import app
from app.models.content_prep import ContentPrepDraft, QuestionUploadBatch
from app.models.question import Question, QuestionBank
from app.models.user import User
from tests.test_content_prep_upload import question_payload


PASSWORD = "prep-valswitch-pass"


def _workspace_payload(bank_id: str, question_id: str) -> dict:
    # 引用不存在的原则 ID：默认触发"原则 ID 不存在"题目级校验失败,
    # 但能通过 Pydantic schema,从而走到 _execute_upload 的校验开关分支。
    question = question_payload(question_id)
    question["metadata"] = {"principleIds": [], "optionPrincipleMap": {"B": ["principle-does-not-exist"]}}
    return {
        "prepStudioWorkspaceVersion": 4,
        "prepStudioVersion": "0.4.0",
        "questionBank": {
            "id": "local-bank",
            "name": "校验开关测试题库",
            "subject": "PMP",
            "questions": [question],
        },
        "principles": {"schemaVersion": 1, "items": []},
        "synthesisPresets": {"schemaVersion": 1, "items": []},
        "tagConfig": {"schemaVersion": 1, "names": {}},
        "recallLibrary": {"schemaVersion": 1, "nodes": [], "edges": []},
        "knowledgeTree": None,
        "server": {"serverBankId": bank_id, "clientInstanceId": "content-prep-valswitch-test"},
    }


def test_sync_validation_blocked_by_default_and_skipped_when_disabled() -> None:
    suffix = uuid4().hex[:10]
    teacher = f"prep-valswitch-teacher-{suffix}"
    bank_id = f"prep-valswitch-bank-{suffix}"
    question_id = str(uuid4())

    async def seed() -> None:
        async with AsyncSessionLocal() as db:
            db.add(User(username=teacher, password_hash=hash_password(PASSWORD), role="teacher", status="active", subject="PMP"))
            await db.flush()
            db.add(
                QuestionBank(
                    id=bank_id,
                    owner_id=teacher,
                    name="校验开关目标题库",
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

    asyncio.run(seed())
    original = settings.CONTENT_PREP_VALIDATION_DISABLED
    settings.CONTENT_PREP_VALIDATION_DISABLED = False  # 本地 .env 可能开启开关,测试显式归位
    try:
        with TestClient(app) as client:
            assert client.post("/api/v1/auth/login", json={"username": teacher, "password": PASSWORD}).status_code == 200

            created = client.post(
                "/api/v1/content-prep/drafts",
                json={"title": "校验开关草稿", "payload": _workspace_payload(bank_id, question_id)},
            )
            assert created.status_code == 201, created.text
            draft = created.json()["draft"]

            # 默认（开关关闭）：缺 title 的题同步被校验阻断，草稿保留
            blocked = client.post(
                f"/api/v1/content-prep/drafts/{draft['id']}/sync",
                json={"revision": 1, "creatorId": "creator_001"},
            )
            assert blocked.status_code == 422, blocked.text
            assert blocked.json()["detail"]["code"] == "QUESTION_VALIDATION_FAILED"
            assert client.get(f"/api/v1/content-prep/drafts/{draft['id']}").status_code == 200

            # 开关开启：同一草稿同步成功
            settings.CONTENT_PREP_VALIDATION_DISABLED = True
            try:
                synced = client.post(
                    f"/api/v1/content-prep/drafts/{draft['id']}/sync",
                    json={"revision": 1, "creatorId": "creator_001"},
                )
                assert synced.status_code == 200, synced.text
                assert client.get(f"/api/v1/content-prep/drafts/{draft['id']}").status_code == 404

                async def _count() -> int:
                    async with AsyncSessionLocal() as db:
                        return len((await db.execute(select(Question.id).where(Question.bank_id == bank_id))).scalars().all())

                assert asyncio.run(_count()) == 1
            finally:
                settings.CONTENT_PREP_VALIDATION_DISABLED = original
    finally:
        settings.CONTENT_PREP_VALIDATION_DISABLED = original
        asyncio.run(cleanup())
