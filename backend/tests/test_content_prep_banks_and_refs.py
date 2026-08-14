import asyncio
import json
from copy import deepcopy
from uuid import uuid4

from fastapi.testclient import TestClient
from sqlalchemy import delete

from app.core.security import hash_password
from app.db.session import AsyncSessionLocal
from app.main import app
from app.models.content_prep import Principle
from app.models.question import QuestionBank
from app.models.shared_runtime_state import SharedRuntimeState
from app.models.user import User
from app.services.content_reference_service import validate_question_references
from app.services.content_prep_service import CREATORS


TAXONOMY_KEY = "kg_content_taxonomies_v1"
RECALL_KEY = "kg_recall_association_library_v1__subject__subject-pmp"
PASSWORD = "prep-bank-pass"


def test_create_bank_creator_allowlist_and_reference_validation() -> None:
    suffix = uuid4().hex[:10]
    teacher_username = f"prep-bank-teacher-{suffix}"
    principle_id = f"principle-existing-{suffix}"
    created_bank_ids: set[str] = set()
    previous_taxonomy: dict | None = None
    previous_recall: dict | None = None

    async def seed() -> None:
        nonlocal previous_taxonomy, previous_recall
        async with AsyncSessionLocal() as db:
            existing = await db.get(SharedRuntimeState, TAXONOMY_KEY)
            if existing is not None:
                previous_taxonomy = {
                    "value": existing.value,
                    "schema_version": existing.schema_version,
                    "updated_by": existing.updated_by,
                }
            existing_recall = await db.get(SharedRuntimeState, RECALL_KEY)
            if existing_recall is not None:
                previous_recall = {
                    "value": existing_recall.value,
                    "schema_version": existing_recall.schema_version,
                    "updated_by": existing_recall.updated_by,
                }
            db.add(
                User(
                    username=teacher_username,
                    password_hash=hash_password(PASSWORD),
                    role="teacher",
                    status="active",
                    subject="PMP",
                )
            )
            await db.flush()
            taxonomy_value = json.dumps(
                [
                    {
                        "id": f"taxonomy-pmp-{suffix}",
                        "subjectId": "subject-pmp",
                        "status": "published",
                        "nodes": [
                            {"id": "kp-known", "status": "active"},
                            {"id": "kp-related", "status": "active"},
                        ],
                    },
                    {
                        "id": f"taxonomy-pmp-draft-{suffix}",
                        "subjectId": "subject-pmp",
                        "status": "draft",
                        "nodes": [{"id": "kp-draft-only", "status": "active"}],
                    },
                ],
                ensure_ascii=False,
            )
            if existing is None:
                db.add(
                    SharedRuntimeState(
                        key=TAXONOMY_KEY,
                        value=taxonomy_value,
                        updated_by=teacher_username,
                    )
                )
            else:
                existing.value = taxonomy_value
                existing.updated_by = teacher_username
            recall_value = json.dumps(
                {
                    "schemaVersion": 1,
                    "nodes": [{"id": "recall-known", "title": "有效节点"}],
                    "edges": [],
                },
                ensure_ascii=False,
            )
            if existing_recall is None:
                db.add(
                    SharedRuntimeState(
                        key=RECALL_KEY,
                        value=recall_value,
                        updated_by=teacher_username,
                    )
                )
            else:
                existing_recall.value = recall_value
                existing_recall.updated_by = teacher_username
            db.add(
                Principle(
                    id=principle_id,
                    name="已存在原则",
                    status="active",
                    created_by=teacher_username,
                    updated_by=teacher_username,
                )
            )
            await db.commit()

    async def verify_created_banks() -> None:
        async with AsyncSessionLocal() as db:
            banks = [await db.get(QuestionBank, bank_id) for bank_id in created_bank_ids]
            teacher_bank = next(bank for bank in banks if bank and bank.owner_id == teacher_username)
            admin_bank = next(bank for bank in banks if bank and bank.owner_id == "admin")
            assert teacher_bank.created_by == teacher_username
            assert teacher_bank.updated_by == teacher_username
            assert teacher_bank.visibility == "private"
            assert teacher_bank.revision == 1
            assert admin_bank.created_by == "admin"
            assert admin_bank.updated_by == "admin"

    async def verify_references() -> None:
        invalid_payload = {
            "metadata": {
                "knowledge": {
                    "primaryNodeId": "kp-missing-primary",
                    "relatedNodeIds": ["kp-related", "kp-missing-related"],
                },
                "stemPrincipleIds": ["principle-missing-stem"],
                "principleIds": [principle_id, "principle-incoming", "principle-missing"],
                "optionPrincipleMap": {
                    "A": [principle_id],
                    "B": ["principle-incoming"],
                },
            },
            "clues": [
                {"id": "clue-1", "recallNodeId": "recall-missing"},
                {"id": "clue-2", "recallNodeId": "recall-known"},
            ],
        }
        valid_payload = deepcopy(invalid_payload)
        valid_payload["metadata"]["knowledge"] = {
            "primaryNodeId": "kp-known",
            "relatedNodeIds": ["kp-related"],
        }
        valid_payload["metadata"]["principleIds"] = [principle_id, "principle-incoming"]
        valid_payload["metadata"]["stemPrincipleIds"] = [principle_id]
        valid_payload["clues"] = [{"id": "clue-2", "recallNodeId": "recall-known"}]

        async with AsyncSessionLocal() as db:
            issues = await validate_question_references(
                db,
                teacher_username,
                "PMP",
                invalid_payload,
                incoming_principle_ids={"principle-incoming"},
            )
            issue_fields = {issue.field for issue in issues}
            assert issue_fields == {
                "metadata.knowledge.primaryNodeId",
                "metadata.knowledge.relatedNodeIds[1]",
                "clues[0].recallNodeId",
                "metadata.stemPrincipleIds[0]",
                "metadata.principleIds[2]",
            }
            assert {issue.code for issue in issues} == {"REFERENCE_NOT_FOUND"}

            assert await validate_question_references(
                db,
                teacher_username,
                "PMP",
                valid_payload,
                incoming_principle_ids={"principle-incoming"},
            ) == []

            taxonomy = await db.get(SharedRuntimeState, TAXONOMY_KEY)
            assert taxonomy is not None
            taxonomy.value = "{broken-json"
            await db.commit()
            unavailable = await validate_question_references(
                db,
                teacher_username,
                "PMP",
                valid_payload,
                incoming_principle_ids={"principle-incoming"},
            )
            assert unavailable[0].code == "REFERENCE_CATALOG_UNAVAILABLE"

    async def cleanup() -> None:
        async with AsyncSessionLocal() as db:
            await db.execute(delete(QuestionBank).where(QuestionBank.id.in_(created_bank_ids)))
            await db.execute(delete(Principle).where(Principle.id == principle_id))
            taxonomy = await db.get(SharedRuntimeState, TAXONOMY_KEY)
            if previous_taxonomy is None:
                if taxonomy is not None:
                    await db.delete(taxonomy)
            elif taxonomy is not None:
                taxonomy.value = previous_taxonomy["value"]
                taxonomy.schema_version = previous_taxonomy["schema_version"]
                taxonomy.updated_by = previous_taxonomy["updated_by"]
            recall = await db.get(SharedRuntimeState, RECALL_KEY)
            if previous_recall is None:
                if recall is not None:
                    await db.delete(recall)
            elif recall is None:
                db.add(SharedRuntimeState(key=RECALL_KEY, **previous_recall))
            else:
                recall.value = previous_recall["value"]
                recall.schema_version = previous_recall["schema_version"]
                recall.updated_by = previous_recall["updated_by"]
            await db.execute(delete(User).where(User.username == teacher_username))
            await db.commit()

    assert CREATORS == {
        "creator_001": "波塞冬",
        "creator_002": "狗娃",
        "creator_003": "阿浩",
        "creator_004": "杰瑞",
        "creator_005": "天才",
        "creator_006": "女帝",
    }
    asyncio.run(seed())
    try:
        with TestClient(app) as client:
            login = client.post(
                "/api/v1/auth/login",
                json={"username": teacher_username, "password": PASSWORD},
            )
            assert login.status_code == 200
            before_create_revision = client.get(
                "/api/v1/question-catalog/revision"
            ).json()["revision"]
            unknown = client.post(
                "/api/v1/content-prep/banks",
                json={"name": "未知制作人题库", "subject": "PMP", "creatorId": "forged"},
            )
            assert unknown.status_code == 422
            assert unknown.json()["detail"]["code"] == "UNKNOWN_CREATOR"
            created = client.post(
                "/api/v1/content-prep/banks",
                json={
                    "name": "教师录入题库",
                    "subject": "PMP",
                    "creatorId": "creator_001",
                    "creatorName": "被篡改的名字",
                    "visibility": "private",
                },
            )
            assert created.status_code == 200
            assert created.json()["bank"]["id"].startswith("b_")
            assert created.json()["bank"]["revision"] == 1
            assert created.json()["contentRevision"] == before_create_revision + 1
            assert created.json()["contentRevision"] == client.get(
                "/api/v1/question-catalog/revision"
            ).json()["revision"]
            created_bank_ids.add(created.json()["bank"]["id"])

            client.post("/api/v1/auth/logout")
            admin_login = client.post(
                "/api/v1/auth/login",
                json={"username": "admin", "password": "jbgsnmm~123"},
            )
            assert admin_login.status_code == 200
            admin_created = client.post(
                "/api/v1/content-prep/banks",
                json={"name": "管理员录入题库", "subject": "PMP", "creatorId": "creator_006"},
            )
            assert admin_created.status_code == 200
            created_bank_ids.add(admin_created.json()["bank"]["id"])

        asyncio.run(verify_created_banks())
        asyncio.run(verify_references())
    finally:
        asyncio.run(cleanup())
