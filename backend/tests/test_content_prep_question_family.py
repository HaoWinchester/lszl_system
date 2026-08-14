"""P4.5.29 G3 · Question Family 服务器发布前硬 Gate（差异 12–20、28）。

覆盖冻结表 P0-FAMILY-01：
- Root-only 批次合法（覆盖不足不是导入错误）
- 完整 Family（root + member 按稳定 ID 绑定）合法
- 同 familyKey 多个 root → 阻断（FAMILY_DUPLICATE_ROOT）
- 成员引用不存在的母题（含跨 Bank 形态）→ 阻断（FAMILY_MEMBER_ROOT_MISSING）
- 成员关系非法 → 阻断（FAMILY_MEMBER_RELATION_INVALID）
- 外部批次 qualityConfirmed=true 强制归零，由教师人工确认（差异 16）
"""

import asyncio
from uuid import uuid4

from fastapi.testclient import TestClient
from sqlalchemy import delete

from app.db.session import AsyncSessionLocal
from app.main import app
from app.models.content_prep import QuestionAuditLog, QuestionUploadBatch
from app.models.question import Question, QuestionBank


ADMIN_PASSWORD = "jbgsnmm~123"


def family_question(
    question_id: str,
    title: str,
    *,
    role: str,
    family_key: str = "FAMILY-001",
    relation: str | None = None,
    root_question_id: str = "",
    quality_confirmed: bool = False,
) -> dict:
    family: dict = {
        "schemaVersion": 1,
        "familyKey": family_key,
        "role": role,
        "qualityConfirmed": quality_confirmed,
    }
    if role == "root":
        family.update({"relationToRoot": "root", "rootQuestionId": question_id})
    elif role == "member":
        family.update(
            {
                "relationToRoot": relation or "equivalent",
                "variantType": "scenario",
                "equivalenceGrade": "A",
                "diagnosticTarget": "application",
                "difficultyLevel": 2,
                "purposes": ["practice"],
                "rootQuestionId": root_question_id,
            }
        )
    return {
        "id": question_id,
        "title": title,
        "type": "single_choice",
        "subject": "PMP",
        "stemParts": [{"text": f"{title} 题干"}],
        "options": [
            {"id": "A", "text": "错误", "correct": False},
            {"id": "B", "text": "正确", "correct": True},
        ],
        "correctAnswer": "B",
        "analysis": "解析",
        "metadata": {"questionFamily": family},
        "status": {"contentReady": True},
        "lifecycle": {"status": "active"},
    }


def batch_payload(bank_id: str, key: str, questions: list[dict]) -> dict:
    return {
        "idempotencyKey": key,
        "clientInstanceId": "family-gate-test",
        "targetBankId": bank_id,
        "creatorId": "creator_001",
        "prepVersion": "9.0-p4.5.29",
        "workspaceVersion": "6",
        "subjectId": "PMP",
        "questions": [{"question": question} for question in questions],
        "principles": {},
        "synthesisPresets": {},
        "tagConfig": {},
    }


def test_question_family_server_gate() -> None:
    suffix = uuid4().hex[:10]
    bank_id = ""
    root_id = str(uuid4())
    member_id = str(uuid4())
    confirmed_root_id = str(uuid4())

    async def cleanup() -> None:
        async with AsyncSessionLocal() as db:
            if bank_id:
                await db.execute(
                    delete(QuestionAuditLog).where(QuestionAuditLog.bank_id == bank_id)
                )
                await db.execute(
                    delete(QuestionUploadBatch).where(
                        QuestionUploadBatch.bank_id == bank_id
                    )
                )
                await db.execute(delete(Question).where(Question.bank_id == bank_id))
                await db.execute(delete(QuestionBank).where(QuestionBank.id == bank_id))
            await db.commit()

    async def read_family(question_id: str) -> dict:
        async with AsyncSessionLocal() as db:
            row = await db.get(Question, question_id)
            assert row is not None
            return (row.content_metadata or {}).get("questionFamily") or {}

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
                    "name": f"Family Gate 题库 {suffix}",
                    "subject": "PMP",
                    "creatorId": "creator_001",
                },
            )
            assert created.status_code == 200, created.text
            bank_id = created.json()["bank"]["id"]

            # 1) Root-only 批次合法（覆盖不足不是导入错误）
            root_only = client.post(
                "/api/v1/content-prep/batches",
                json=batch_payload(
                    bank_id,
                    f"family-root-only-{suffix}",
                    [family_question(root_id, "母题", role="root")],
                ),
            )
            assert root_only.status_code == 200, root_only.text

            # 2) 完整 Family 合法：成员按稳定 ID 绑定已存在的母题
            complete = client.post(
                "/api/v1/content-prep/batches",
                json=batch_payload(
                    bank_id,
                    f"family-complete-{suffix}",
                    [
                        family_question(
                            member_id,
                            "强等价成员",
                            role="member",
                            relation="equivalent",
                            root_question_id=root_id,
                        )
                    ],
                ),
            )
            assert complete.status_code == 200, complete.text
            saved_family = asyncio.run(read_family(member_id))
            assert saved_family["rootQuestionId"] == root_id
            assert saved_family["relationToRoot"] == "equivalent"

            # 3) 同 familyKey 多个 root → 阻断
            duplicate_root = client.post(
                "/api/v1/content-prep/batches",
                json=batch_payload(
                    bank_id,
                    f"family-dup-root-{suffix}",
                    [
                        family_question(
                            str(uuid4()), "重复母题 1", role="root", family_key="FAMILY-DUP"
                        ),
                        family_question(
                            str(uuid4()), "重复母题 2", role="root", family_key="FAMILY-DUP"
                        ),
                    ],
                ),
            )
            assert duplicate_root.status_code == 422, duplicate_root.text
            assert any(
                issue["code"] == "FAMILY_DUPLICATE_ROOT"
                for issue in duplicate_root.json()["detail"]["issues"]
            )

            # 4) 成员引用不存在的母题（含跨 Bank 形态）→ 阻断
            orphan = client.post(
                "/api/v1/content-prep/batches",
                json=batch_payload(
                    bank_id,
                    f"family-orphan-{suffix}",
                    [
                        family_question(
                            str(uuid4()),
                            "孤儿成员",
                            role="member",
                            root_question_id=str(uuid4()),
                        )
                    ],
                ),
            )
            assert orphan.status_code == 422, orphan.text
            assert any(
                issue["code"] == "FAMILY_MEMBER_ROOT_MISSING"
                for issue in orphan.json()["detail"]["issues"]
            )

            # 5) 成员关系非法 → 阻断
            bad_relation = client.post(
                "/api/v1/content-prep/batches",
                json=batch_payload(
                    bank_id,
                    f"family-bad-relation-{suffix}",
                    [
                        family_question(
                            str(uuid4()),
                            "非法关系成员",
                            role="member",
                            relation="bogus",
                            root_question_id=root_id,
                        )
                    ],
                ),
            )
            assert bad_relation.status_code == 422, bad_relation.text
            assert any(
                issue["code"] == "FAMILY_MEMBER_RELATION_INVALID"
                for issue in bad_relation.json()["detail"]["issues"]
            )

            # 6) 外部批次 qualityConfirmed=true 强制归零（差异 16）
            external = client.post(
                "/api/v1/content-prep/batches",
                json=batch_payload(
                    bank_id,
                    f"family-external-{suffix}",
                    [
                        family_question(
                            confirmed_root_id,
                            "外部导入母题",
                            role="root",
                            family_key="FAMILY-EXT",
                            quality_confirmed=True,
                        )
                    ],
                ),
            )
            assert external.status_code == 200, external.text
            saved = asyncio.run(read_family(confirmed_root_id))
            assert saved["qualityConfirmed"] is False, saved
    finally:
        asyncio.run(cleanup())
