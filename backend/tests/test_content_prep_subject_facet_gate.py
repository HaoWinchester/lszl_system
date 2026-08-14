import asyncio
from uuid import uuid4

from fastapi.testclient import TestClient
from sqlalchemy import delete

from app.db.session import AsyncSessionLocal
from app.main import app
from app.models.content_prep import QuestionAuditLog, QuestionUploadBatch
from app.models.question import Question, QuestionBank
from app.models.subject_facet import SubjectFacetSchema


ADMIN_PASSWORD = "jbgsnmm~123"


def _question(question_id: str, subject: str, facet_id: str) -> dict:
    return {
        "id": question_id,
        "title": "Facet Gate",
        "type": "single_choice",
        "subject": subject,
        "stemParts": [{"text": "题干"}],
        "options": [
            {"id": "A", "text": "错误", "correct": False},
            {"id": "B", "text": "正确", "correct": True},
        ],
        "correctAnswer": "B",
        "analysis": "解析",
        "metadata": {"subjectFacets": [{"facetId": facet_id}]},
        "status": {"contentReady": True},
        "lifecycle": {"status": "active"},
    }


def _batch(bank_id: str, key: str, subject: str, question: dict) -> dict:
    return {
        "idempotencyKey": key,
        "clientInstanceId": "subject-facet-gate-test",
        "targetBankId": bank_id,
        "creatorId": "creator_001",
        "prepVersion": "9.0-p4.5.29",
        "workspaceVersion": "6",
        "subjectId": subject,
        "questions": [{"question": question}],
        "principles": {},
        "synthesisPresets": {},
        "tagConfig": {},
    }


def test_subject_facet_references_are_a_server_publish_gate() -> None:
    suffix = uuid4().hex[:10]
    subject = f"subject-{suffix}"
    schema_id = f"facet-gate-{suffix}"
    bank_id = ""

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
            await db.execute(
                delete(SubjectFacetSchema).where(
                    SubjectFacetSchema.schema_id == schema_id
                )
            )
            await db.commit()

    try:
        with TestClient(app) as client:
            login = client.post(
                "/api/v1/auth/login",
                json={"username": "admin", "password": ADMIN_PASSWORD},
            )
            assert login.status_code == 200, login.text

            revision = client.get(
                "/api/v1/content-prep/subject-facets"
            ).json()["contentRevision"]
            schema = client.put(
                "/api/v1/content-prep/subject-facets",
                json={
                    "contentRevision": revision,
                    "schema": {
                        "schemaId": schema_id,
                        "schemaVersion": 1,
                        "subjectId": subject,
                        "subjectCodes": [],
                        "name": "测试科目分类",
                        "status": "active",
                        "dimensions": [
                            {
                                "id": "delivery",
                                "label": "交付方式",
                                "selection": "multi",
                                "status": "active",
                                "values": [
                                    {
                                        "id": "predictive",
                                        "label": "预测型",
                                        "status": "active",
                                    }
                                ],
                            }
                        ],
                    },
                },
            )
            assert schema.status_code == 200, schema.text

            created = client.post(
                "/api/v1/content-prep/banks",
                json={
                    "name": f"Facet Gate {suffix}",
                    "subject": subject,
                    "creatorId": "creator_001",
                },
            )
            assert created.status_code == 200, created.text
            bank_id = created.json()["bank"]["id"]

            unknown = client.post(
                "/api/v1/content-prep/batches",
                json=_batch(
                    bank_id,
                    f"facet-invalid-{suffix}",
                    subject,
                    _question(
                        str(uuid4()),
                        subject,
                        f"subject/{suffix}/delivery/missing",
                    ),
                ),
            )
            assert unknown.status_code == 422, unknown.text
            assert {
                key: unknown.json()["detail"]["issues"][0][key]
                for key in ("field", "code")
            } == {
                "field": "metadata.subjectFacets[0]",
                "code": "SUBJECT_FACET_REFERENCE_NOT_FOUND",
            }

            valid = client.post(
                "/api/v1/content-prep/batches",
                json=_batch(
                    bank_id,
                    f"facet-valid-{suffix}",
                    subject,
                    _question(
                        str(uuid4()),
                        subject,
                        f"subject/{suffix}/delivery/predictive",
                    ),
                ),
            )
            assert valid.status_code == 200, valid.text
    finally:
        asyncio.run(cleanup())
