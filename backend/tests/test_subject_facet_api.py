import asyncio
from uuid import uuid4

from fastapi.testclient import TestClient
from sqlalchemy import CheckConstraint, UniqueConstraint, delete, text

from app.core.security import hash_password
from app.db.base import Base
from app.db.session import AsyncSessionLocal
from app.main import app
from app.models.user import User


PASSWORD = "subject-facet-pass"


def _schema(suffix: str, *, schema_id: str | None = None) -> dict:
    return {
        "schemaId": schema_id or f"pmp-facet-{suffix}",
        "schemaVersion": 1,
        "subjectId": f"subject-{suffix}",
        "subjectCodes": ["PMP", " pmp "],
        "name": "PMP 科目分类",
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
                        "aliases": ["预测型", " predictive "],
                        "replacedBy": [],
                    },
                    {
                        "id": "adaptive",
                        "label": "敏捷 / 自适应",
                        "status": "active",
                        "aliases": [],
                        "replacedBy": [],
                    },
                ],
            }
        ],
    }


def test_subject_facet_schema_model_has_stable_identity_and_audit_columns() -> None:
    table = Base.metadata.tables["subject_facet_schemas"]
    assert {
        "schema_id",
        "subject_id",
        "schema_version",
        "name",
        "subject_codes",
        "dimensions",
        "status",
        "revision",
        "created_by",
        "updated_by",
        "created_at",
        "updated_at",
    } <= set(table.columns.keys())
    unique_columns = {
        tuple(column.name for column in constraint.columns)
        for constraint in table.constraints
        if isinstance(constraint, UniqueConstraint)
    }
    assert ("subject_id",) in unique_columns
    checks = {
        str(constraint.sqltext)
        for constraint in table.constraints
        if isinstance(constraint, CheckConstraint)
    }
    assert "status IN ('active', 'inactive', 'deprecated')" in checks


def test_subject_facet_schemas_are_editor_only_versioned_and_server_persistent() -> None:
    suffix = uuid4().hex[:10]
    teacher_a, teacher_b = f"facet-a-{suffix}", f"facet-b-{suffix}"
    student, viewer = f"facet-student-{suffix}", f"facet-viewer-{suffix}"
    schema_id = f"pmp-facet-{suffix}"

    async def seed() -> None:
        async with AsyncSessionLocal() as db:
            db.add_all(
                [
                    User(
                        username=teacher_a,
                        password_hash=hash_password(PASSWORD),
                        role="teacher",
                        status="active",
                        subject="PMP",
                    ),
                    User(
                        username=teacher_b,
                        password_hash=hash_password(PASSWORD),
                        role="teacher",
                        status="active",
                        subject="PMP",
                    ),
                    User(
                        username=student,
                        password_hash=hash_password(PASSWORD),
                        role="student",
                        status="active",
                        subject="PMP",
                    ),
                    User(
                        username=viewer,
                        password_hash=hash_password(PASSWORD),
                        role="viewer",
                        status="active",
                        subject="PMP",
                    ),
                ]
            )
            await db.commit()

    async def cleanup() -> None:
        async with AsyncSessionLocal() as db:
            table_exists = (
                await db.execute(
                    text("SELECT to_regclass('public.subject_facet_schemas')")
                )
            ).scalar_one()
            if table_exists:
                await db.execute(
                    text("DELETE FROM subject_facet_schemas WHERE schema_id = :schema_id"),
                    {"schema_id": schema_id},
                )
            await db.execute(
                delete(User).where(
                    User.username.in_([teacher_a, teacher_b, student, viewer])
                )
            )
            await db.commit()

    asyncio.run(seed())
    try:
        with TestClient(app) as first, TestClient(app) as second:
            assert first.post(
                "/api/v1/auth/login",
                json={"username": teacher_a, "password": PASSWORD},
            ).status_code == 200
            assert second.post(
                "/api/v1/auth/login",
                json={"username": teacher_b, "password": PASSWORD},
            ).status_code == 200

            initial = first.get("/api/v1/content-prep/subject-facets")
            assert initial.status_code == 200, initial.text
            assert initial.json()["schemas"] == []
            initial_revision = initial.json()["contentRevision"]

            created = first.put(
                "/api/v1/content-prep/subject-facets",
                json={
                    "contentRevision": initial_revision,
                    "schema": _schema(suffix),
                },
            )
            assert created.status_code == 200, created.text
            created_payload = created.json()
            assert created_payload["contentRevision"] == initial_revision + 1
            assert created_payload["schema"] == {
                **_schema(suffix),
                "subjectCodes": ["PMP"],
                "dimensions": [
                    {
                        **_schema(suffix)["dimensions"][0],
                        "values": [
                            {
                                **_schema(suffix)["dimensions"][0]["values"][0],
                                "aliases": ["predictive", "预测型"],
                            },
                            _schema(suffix)["dimensions"][0]["values"][1],
                        ],
                    }
                ],
                "revision": 1,
                "createdBy": teacher_a,
                "updatedBy": teacher_a,
                "createdAt": created_payload["schema"]["createdAt"],
                "updatedAt": created_payload["schema"]["updatedAt"],
            }

            # A fresh HTTP request/client must read the PostgreSQL snapshot, not a browser cache.
            persisted = second.get("/api/v1/content-prep/subject-facets")
            assert persisted.status_code == 200, persisted.text
            assert persisted.json()["contentRevision"] == created_payload["contentRevision"]
            assert persisted.json()["schemas"] == [created_payload["schema"]]

            stale = second.put(
                "/api/v1/content-prep/subject-facets",
                json={"contentRevision": initial_revision, "schema": _schema(suffix)},
            )
            assert stale.status_code == 409
            assert stale.json()["detail"] == {
                "code": "CONTENT_REVISION_CONFLICT",
                "message": "服务器内容已更新，请重新载入后再保存",
                "currentContentRevision": created_payload["contentRevision"],
            }

            duplicate = _schema(suffix)
            duplicate["dimensions"][0]["values"].append(
                {"id": "predictive", "label": "重复", "status": "active"}
            )
            duplicate_response = second.put(
                "/api/v1/content-prep/subject-facets",
                json={
                    "contentRevision": created_payload["contentRevision"],
                    "schema": duplicate,
                },
            )
            assert duplicate_response.status_code == 422
            assert duplicate_response.json()["detail"]["code"] == "DUPLICATE_FACET_ID"

            missing_replacement = _schema(suffix)
            missing_replacement["schemaVersion"] = 2
            missing_replacement["dimensions"][0]["values"][0].update(
                status="deprecated", replacedBy=["not-in-this-dimension"]
            )
            replacement_response = second.put(
                "/api/v1/content-prep/subject-facets",
                json={
                    "contentRevision": created_payload["contentRevision"],
                    "schema": missing_replacement,
                },
            )
            assert replacement_response.status_code == 422
            assert replacement_response.json()["detail"]["code"] == "INVALID_REPLACED_BY"

            changed_id = _schema(suffix, schema_id=f"changed-id-{suffix}")
            changed_id_response = second.put(
                "/api/v1/content-prep/subject-facets",
                json={
                    "contentRevision": created_payload["contentRevision"],
                    "schema": changed_id,
                },
            )
            assert changed_id_response.status_code == 422
            assert changed_id_response.json()["detail"]["code"] == "SCHEMA_ID_IMMUTABLE"

            removed_value = _schema(suffix)
            removed_value["schemaVersion"] = 2
            removed_value["dimensions"][0]["values"] = [
                removed_value["dimensions"][0]["values"][1]
            ]
            removed_value_response = second.put(
                "/api/v1/content-prep/subject-facets",
                json={
                    "contentRevision": created_payload["contentRevision"],
                    "schema": removed_value,
                },
            )
            assert removed_value_response.status_code == 422
            assert removed_value_response.json()["detail"]["code"] == "FACET_VALUE_REMOVAL_FORBIDDEN"

            valid_update = _schema(suffix)
            valid_update["schemaVersion"] = 2
            valid_update["dimensions"][0]["values"][0].update(
                status="deprecated", replacedBy=["adaptive"]
            )
            updated = second.put(
                "/api/v1/content-prep/subject-facets",
                json={
                    "contentRevision": created_payload["contentRevision"],
                    "schema": valid_update,
                },
            )
            assert updated.status_code == 200, updated.text
            assert updated.json()["schema"]["schemaVersion"] == 2
            assert updated.json()["schema"]["revision"] == 2
            assert updated.json()["schema"]["createdBy"] == teacher_a
            assert updated.json()["schema"]["updatedBy"] == teacher_b
            assert updated.json()["schema"]["dimensions"][0]["values"][0]["replacedBy"] == ["adaptive"]

        for username in (student, viewer):
            with TestClient(app) as denied:
                assert denied.post(
                    "/api/v1/auth/login",
                    json={"username": username, "password": PASSWORD},
                ).status_code == 200
                assert denied.get("/api/v1/content-prep/subject-facets").status_code == 403
                assert denied.put(
                    "/api/v1/content-prep/subject-facets",
                    json={"contentRevision": 0, "schema": _schema(suffix)},
                ).status_code == 403
    finally:
        asyncio.run(cleanup())
