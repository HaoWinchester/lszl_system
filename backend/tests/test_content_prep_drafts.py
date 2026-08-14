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


PASSWORD = "prep-draft-pass"


def _workspace_payload(
    bank_id: str,
    question_id: str,
    *,
    title: str = "仅在同步后进入正式题库",
    server_revision: int | None = None,
) -> dict:
    question = question_payload(question_id, title=title)
    question["metadata"] = {"principleIds": [], "optionPrincipleMap": {}}
    if server_revision is not None:
        question["serverRevision"] = server_revision
    return {
        "prepStudioWorkspaceVersion": 4,
        "prepStudioVersion": "0.4.0",
        "questionBank": {
            "id": "local-bank",
            "name": "共享草稿题库",
            "subject": "PMP",
            "questions": [question],
        },
        "principles": {"schemaVersion": 1, "items": []},
        "synthesisPresets": {"schemaVersion": 1, "items": []},
        "tagConfig": {"schemaVersion": 1, "names": {}},
        "recallLibrary": {"schemaVersion": 1, "nodes": [], "edges": []},
        "knowledgeTree": None,
        "server": {
            "serverBankId": bank_id,
            "clientInstanceId": "content-prep-draft-test",
        },
    }


def test_shared_content_prep_draft_is_versioned_and_sync_deletes_only_after_commit() -> None:
    suffix = uuid4().hex[:10]
    teacher = f"prep-draft-teacher-{suffix}"
    viewer = f"prep-draft-viewer-{suffix}"
    bank_id = f"prep-draft-bank-{suffix}"
    question_id = str(uuid4())

    async def seed() -> None:
        async with AsyncSessionLocal() as db:
            db.add_all(
                [
                    User(username=teacher, password_hash=hash_password(PASSWORD), role="teacher", status="active", subject="PMP"),
                    User(username=viewer, password_hash=hash_password(PASSWORD), role="viewer", status="active", subject="PMP"),
                ]
            )
            await db.flush()
            db.add(
                QuestionBank(
                    id=bank_id,
                    owner_id=teacher,
                    name="草稿同步目标题库",
                    subject="PMP",
                    created_by=teacher,
                    updated_by=teacher,
                )
            )
            await db.commit()

    async def cleanup() -> None:
        async with AsyncSessionLocal() as db:
            await db.execute(delete(ContentPrepDraft).where(ContentPrepDraft.created_by.in_([teacher, viewer])))
            await db.execute(delete(QuestionUploadBatch).where(QuestionUploadBatch.bank_id == bank_id))
            await db.execute(delete(Question).where(Question.bank_id == bank_id))
            await db.execute(delete(QuestionBank).where(QuestionBank.id == bank_id))
            await db.execute(delete(User).where(User.username.in_([teacher, viewer])))
            await db.commit()

    asyncio.run(seed())
    try:
        with TestClient(app) as client:
            assert client.post("/api/v1/auth/login", json={"username": viewer, "password": PASSWORD}).status_code == 200
            denied = client.get("/api/v1/content-prep/drafts")
            assert denied.status_code == 403
            client.post("/api/v1/auth/logout")

            assert client.post("/api/v1/auth/login", json={"username": teacher, "password": PASSWORD}).status_code == 200
            before_sync = asyncio.run(_formal_question_count(bank_id))
            created = client.post(
                "/api/v1/content-prep/drafts",
                json={"title": "共享草稿", "payload": _workspace_payload(bank_id, question_id)},
            )
            assert created.status_code == 201, created.text
            draft = created.json()["draft"]
            assert draft["revision"] == 1
            assert draft["title"] == "共享草稿"
            assert asyncio.run(_formal_question_count(bank_id)) == before_sync

            listed = client.get("/api/v1/content-prep/drafts")
            assert listed.status_code == 200
            assert [item["id"] for item in listed.json()["drafts"]] == [draft["id"]]

            updated = client.put(
                f"/api/v1/content-prep/drafts/{draft['id']}",
                json={"title": "共享草稿（已编辑）", "payload": _workspace_payload(bank_id, question_id), "revision": 1},
            )
            assert updated.status_code == 200, updated.text
            assert updated.json()["draft"]["revision"] == 2

            stale = client.put(
                f"/api/v1/content-prep/drafts/{draft['id']}",
                json={"title": "旧版本", "payload": _workspace_payload(bank_id, question_id), "revision": 1},
            )
            assert stale.status_code == 409
            assert stale.json()["detail"]["code"] == "DRAFT_REVISION_CONFLICT"

            bad_sync = client.post(
                f"/api/v1/content-prep/drafts/{draft['id']}/sync",
                json={"revision": 2, "creatorId": "not-allowed"},
            )
            assert bad_sync.status_code == 422
            assert client.get(f"/api/v1/content-prep/drafts/{draft['id']}").status_code == 200
            assert asyncio.run(_formal_question_count(bank_id)) == before_sync

            synced = client.post(
                f"/api/v1/content-prep/drafts/{draft['id']}/sync",
                json={"revision": 2, "creatorId": "creator_001"},
            )
            assert synced.status_code == 200, synced.text
            assert synced.json()["result"]["bankId"] == bank_id
            assert client.get(f"/api/v1/content-prep/drafts/{draft['id']}").status_code == 404
            assert asyncio.run(_formal_question_count(bank_id)) == before_sync + 1

            updated_draft = client.post(
                "/api/v1/content-prep/drafts",
                json={
                    "title": "已有题目的共享草稿",
                    "payload": _workspace_payload(
                        bank_id,
                        question_id,
                        title="通过共享草稿更新正式题目",
                        server_revision=1,
                    ),
                },
            )
            assert updated_draft.status_code == 201, updated_draft.text
            updated = updated_draft.json()["draft"]
            resynced = client.post(
                f"/api/v1/content-prep/drafts/{updated['id']}/sync",
                json={"revision": 1, "creatorId": "creator_001"},
            )
            assert resynced.status_code == 200, resynced.text
            assert resynced.json()["result"]["questions"][0]["status"] == "updated"
            assert client.get(f"/api/v1/content-prep/drafts/{updated['id']}").status_code == 404
            assert asyncio.run(_formal_question_title(question_id)) == "通过共享草稿更新正式题目"
    finally:
        asyncio.run(cleanup())


async def _formal_question_count(bank_id: str) -> int:
    async with AsyncSessionLocal() as db:
        return len((await db.execute(select(Question.id).where(Question.bank_id == bank_id))).scalars().all())


async def _formal_question_title(question_id: str) -> str | None:
    async with AsyncSessionLocal() as db:
        return await db.scalar(select(Question.title).where(Question.id == question_id))
