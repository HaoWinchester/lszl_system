import asyncio
import json
from uuid import uuid4

from fastapi.testclient import TestClient
from sqlalchemy import delete

from app.db.session import AsyncSessionLocal
from app.main import app
from app.models.content_prep import QuestionAuditLog, QuestionUploadBatch
from app.models.question import Question, QuestionBank
from app.models.shared_runtime_state import SharedRuntimeState


ADMIN_PASSWORD = "jbgsnmm~123"
RECALL_KEY = "kg_recall_association_library_v1__subject__subject-pmp"


def question_payload(question_id: str, recall_node_id: str) -> dict:
    return {
        "id": question_id,
        "title": f"Recall 联动题 {question_id[:8]}",
        "type": "single_choice",
        "subject": "PMP",
        "stemParts": [{"text": "团队成员不堪重负，项目经理应该怎么办？"}],
        "options": [
            {"id": "A", "text": "继续追加任务", "correct": False},
            {"id": "B", "text": "识别工作负荷并提供支持", "correct": True},
        ],
        "correctAnswer": "B",
        "analysis": "先识别负荷，再提供支持。",
        "clues": [
            {
                "id": f"clue-{question_id[:8]}",
                "text": "不堪重负",
                "sourceType": "stem",
                "sourceOptionId": "",
                "matchLocations": [{"field": "stem", "optionId": "", "count": 1}],
                "recallNodeId": recall_node_id,
            }
        ],
        "metadata": {"knowledge": {"primaryNodeId": "", "relatedNodeIds": []}},
        "status": {"contentReady": True, "keywordsReady": True},
        "lifecycle": {"status": "active"},
    }


def batch_payload(bank_id: str, key: str, questions: list[dict], recall_library: dict) -> dict:
    return {
        "idempotencyKey": key,
        "clientInstanceId": "recall-binding-test",
        "targetBankId": bank_id,
        "creatorId": "creator_001",
        "prepVersion": "9.0-p4.5.29",
        "workspaceVersion": "6",
        "subjectId": "PMP",
        "questions": [{"question": question} for question in questions],
        "recallLibrary": recall_library,
        "principles": {},
        "synthesisPresets": {},
        "tagConfig": {},
    }


def test_batch_uses_incoming_recall_library_and_rolls_back_invalid_references() -> None:
    suffix = uuid4().hex[:10]
    bank_id = ""
    valid_question_id = str(uuid4())
    blank_question_id = str(uuid4())
    invalid_question_id = str(uuid4())
    previous_recall: dict | None = None

    async def snapshot() -> None:
        nonlocal previous_recall
        async with AsyncSessionLocal() as db:
            row = await db.get(SharedRuntimeState, RECALL_KEY)
            if row is not None:
                previous_recall = {
                    "value": row.value,
                    "schema_version": row.schema_version,
                    "updated_by": row.updated_by,
                }

    async def verify_success() -> None:
        async with AsyncSessionLocal() as db:
            bound = await db.get(Question, valid_question_id)
            blank = await db.get(Question, blank_question_id)
            assert bound is not None
            assert bound.clues[0]["recallNodeId"] == "recall:overloaded"
            assert blank is not None
            assert blank.clues[0]["recallNodeId"] == ""
            row = await db.get(SharedRuntimeState, RECALL_KEY)
            assert row is not None
            library = json.loads(row.value)
            assert [node["id"] for node in library["nodes"]] == [
                "recall:overloaded",
                "recall:support",
            ]
            assert library["edges"] == [
                {"from": "recall:overloaded", "to": "recall:support", "priority": 1}
            ]

    async def verify_rollback() -> None:
        async with AsyncSessionLocal() as db:
            assert await db.get(Question, invalid_question_id) is None
            row = await db.get(SharedRuntimeState, RECALL_KEY)
            assert row is not None
            library = json.loads(row.value)
            assert all(node["id"] != "recall:rollback-only" for node in library["nodes"])

    async def cleanup() -> None:
        async with AsyncSessionLocal() as db:
            if bank_id:
                await db.execute(delete(QuestionAuditLog).where(QuestionAuditLog.bank_id == bank_id))
                await db.execute(delete(QuestionUploadBatch).where(QuestionUploadBatch.bank_id == bank_id))
                await db.execute(delete(Question).where(Question.bank_id == bank_id))
                await db.execute(delete(QuestionBank).where(QuestionBank.id == bank_id))
            row = await db.get(SharedRuntimeState, RECALL_KEY)
            if previous_recall is None:
                if row is not None:
                    await db.delete(row)
            elif row is None:
                db.add(SharedRuntimeState(key=RECALL_KEY, **previous_recall))
            else:
                row.value = previous_recall["value"]
                row.schema_version = previous_recall["schema_version"]
                row.updated_by = previous_recall["updated_by"]
            await db.commit()

    incoming_library = {
        "schemaVersion": 1,
        "nodes": [
            {
                "id": "recall:overloaded",
                "title": "工作负荷与团队支持",
                "titleEn": "Workload support",
                "aliases": ["不堪重负"],
            },
            {"id": "recall:support", "title": "支持团队"},
        ],
        "edges": [{"from": "recall:overloaded", "to": "recall:support", "priority": 1}],
    }

    asyncio.run(snapshot())
    try:
        with TestClient(app) as client:
            login = client.post(
                "/api/v1/auth/login",
                json={"username": "admin", "password": ADMIN_PASSWORD},
            )
            assert login.status_code == 200, login.text
            created = client.post(
                "/api/v1/content-prep/banks",
                json={
                    "name": f"Recall 联动测试题库 {suffix}",
                    "subject": "PMP",
                    "creatorId": "creator_001",
                },
            )
            assert created.status_code == 200, created.text
            bank_id = created.json()["bank"]["id"]

            success = client.post(
                "/api/v1/content-prep/batches",
                json=batch_payload(
                    bank_id,
                    f"recall-valid-{suffix}",
                    [
                        question_payload(valid_question_id, "recall:overloaded"),
                        question_payload(blank_question_id, ""),
                    ],
                    incoming_library,
                ),
            )
            assert success.status_code == 200, success.text
            assert [item["status"] for item in success.json()["questions"]] == [
                "created",
                "created",
            ]
            asyncio.run(verify_success())

            invalid_library = {
                "schemaVersion": 1,
                "nodes": [{"id": "recall:rollback-only", "title": "不得落库"}],
                "edges": [],
            }
            invalid = client.post(
                "/api/v1/content-prep/batches",
                json=batch_payload(
                    bank_id,
                    f"recall-invalid-{suffix}",
                    [question_payload(invalid_question_id, "recall:missing")],
                    invalid_library,
                ),
            )
            assert invalid.status_code == 422, invalid.text
            detail = invalid.json()["detail"]
            assert detail["code"] == "QUESTION_VALIDATION_FAILED"
            assert any(
                issue["field"] == "clues[0].recallNodeId"
                and issue["code"] == "REFERENCE_NOT_FOUND"
                for issue in detail["issues"]
            )
            asyncio.run(verify_rollback())
    finally:
        asyncio.run(cleanup())
