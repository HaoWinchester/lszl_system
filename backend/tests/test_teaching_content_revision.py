import asyncio
import json
from concurrent.futures import ThreadPoolExecutor
from copy import deepcopy
from datetime import datetime
from threading import Barrier, Event, Lock
from uuid import uuid4

import pytest
from fastapi.testclient import TestClient
from sqlalchemy import delete, select
from sqlalchemy.exc import IntegrityError

from app.core.security import hash_password
from app.db.session import AsyncSessionLocal
from app.main import _seed_builtin_teaching_content, app
from app.models.content_prep import (
    Principle,
    QuestionAuditLog,
    QuestionEditLock,
    QuestionUploadBatch,
    SynthesisPreset,
)
from app.models.runtime_state import RuntimeState
from app.models.paper_release import PaperRelease, PaperReleaseQuestion
from app.models.question import ExamPaper, PaperQuestion, Question, QuestionBank
from app.models.shared_runtime_state import SharedRuntimeState
from app.models.teaching_content import TeachingContentRevision
from app.models.user import User
from app.schemas.content_prep import ContentPrepBatchResult, ContentPrepBatchRequest
from app.services import teaching_content_revision_service as revision_service
from app.services import teaching_content_projection_service
from app.services import builtin_teaching_content_seed_service
from app.services import question_service
from app.services.content_prep_service import (
    ContentPrepOperationError,
    create_bank as create_content_prep_bank,
    upload_bundle,
)
from tests.test_content_prep_upload import question_payload, request_payload


PASSWORD = "revision-pass"
PRINCIPLE_PROJECTION_KEY = "kg_principle_repository_v1"
PRESET_PROJECTION_KEY = "kg_synthesis_preset_repository_v1"


async def _snapshot_revision_row() -> dict | None:
    async with AsyncSessionLocal() as db:
        row = await db.get(TeachingContentRevision, 1)
        if row is None:
            return None
        return {
            "revision": row.revision,
            "changes": deepcopy(row.changes),
            "updated_by": row.updated_by,
            "updated_at": row.updated_at,
        }


async def _restore_revision_row(snapshot: dict | None) -> None:
    async with AsyncSessionLocal() as db:
        await db.execute(delete(TeachingContentRevision))
        if snapshot is not None:
            db.add(
                TeachingContentRevision(
                    id=1,
                    revision=int(snapshot["revision"]),
                    changes=deepcopy(snapshot["changes"]),
                    updated_by=snapshot["updated_by"],
                    updated_at=snapshot["updated_at"],
                )
            )
        await db.commit()


def test_bump_is_monotonic_deduplicated_and_capped() -> None:
    """Catch lost increments, accumulated old changes, and unbounded payload growth."""

    async def scenario() -> None:
        snapshot = await _snapshot_revision_row()
        changes = [
            {
                "entityType": "question",
                "entityId": f"q-{index}",
                "action": "updated",
            }
            for index in range(105)
        ]
        changes.insert(1, deepcopy(changes[0]))
        try:
            async with AsyncSessionLocal() as db:
                first = await revision_service.bump(db, "teacher-a", changes)
                second = await revision_service.bump(
                    db,
                    "teacher-a",
                    [
                        {
                            "entityType": "principle",
                            "entityId": "p-1",
                            "action": "created",
                        }
                    ],
                )
                await db.commit()

            assert second["revision"] == first["revision"] + 1
            assert len(first["changes"]) == 100
            assert first["changes"][0] == {
                "entityType": "question",
                "entityId": "q-0",
                "action": "updated",
            }
            assert first["changes"][-1]["entityId"] == "q-99"
            assert second["changes"] == [
                {
                    "entityType": "principle",
                    "entityId": "p-1",
                    "action": "created",
                }
            ]
            assert second["updatedBy"] == "teacher-a"
            assert isinstance(second["updatedAt"], str) and second["updatedAt"]
        finally:
            await _restore_revision_row(snapshot)

    asyncio.run(scenario())


def test_bump_flushes_without_committing_the_callers_transaction() -> None:
    """Catch a service-level commit that would break a larger atomic write."""

    async def scenario() -> None:
        snapshot = await _snapshot_revision_row()
        try:
            async with AsyncSessionLocal() as db:
                before = await revision_service.current(db)
            if snapshot is None:
                assert before == {
                    "revision": 0,
                    "changes": [],
                    "updatedAt": None,
                    "updatedBy": None,
                }

            async with AsyncSessionLocal() as db:
                bumped = await revision_service.bump(
                    db,
                    "teacher-no-commit",
                    [
                        {
                            "entityType": "question",
                            "entityId": "q-rollback",
                            "action": "updated",
                        }
                    ],
                )
                assert bumped["revision"] == before["revision"] + 1
                # Closing the session rolls back because bump must only flush.

            async with AsyncSessionLocal() as db:
                after = await revision_service.current(db)
            assert after == before
        finally:
            await _restore_revision_row(snapshot)

    asyncio.run(scenario())


def test_missing_revision_row_starts_at_zero_and_first_bump_is_one() -> None:
    """Catch deriving the initial revision from unrelated database state."""

    async def scenario() -> None:
        snapshot = await _snapshot_revision_row()
        try:
            async with AsyncSessionLocal() as db:
                await db.execute(delete(TeachingContentRevision))
                await db.commit()

            async with AsyncSessionLocal() as db:
                assert await revision_service.current(db) == {
                    "revision": 0,
                    "changes": [],
                    "updatedAt": None,
                    "updatedBy": None,
                }

            async with AsyncSessionLocal() as db:
                first = await revision_service.bump(
                    db,
                    "teacher-first",
                    [
                        {
                            "entityType": "question",
                            "entityId": "q-first",
                            "action": "created",
                        }
                    ],
                )
                await db.commit()
            assert first["revision"] == 1
        finally:
            await _restore_revision_row(snapshot)

    asyncio.run(scenario())


def test_concurrent_bumps_do_not_lose_revisions() -> None:
    """Catch a read-modify-write race when multiple managers save together."""

    async def scenario() -> None:
        snapshot = await _snapshot_revision_row()
        worker_count = 8
        try:
            async with AsyncSessionLocal() as db:
                baseline = (await revision_service.current(db))["revision"]

            async def worker(index: int) -> int:
                async with AsyncSessionLocal() as db:
                    async with db.begin():
                        payload = await revision_service.bump(
                            db,
                            f"teacher-{index}",
                            [
                                {
                                    "entityType": "question",
                                    "entityId": f"q-concurrent-{index}",
                                    "action": "updated",
                                }
                            ],
                        )
                        return int(payload["revision"])

            revisions = await asyncio.gather(
                *(worker(index) for index in range(worker_count))
            )
            assert sorted(revisions) == list(
                range(baseline + 1, baseline + worker_count + 1)
            )
            async with AsyncSessionLocal() as db:
                current = await revision_service.current(db)
            assert current["revision"] == baseline + worker_count
        finally:
            await _restore_revision_row(snapshot)

    asyncio.run(scenario())


def test_revision_endpoint_filters_non_object_changes_from_a_damaged_row() -> None:
    """Catch a malformed persisted change crashing the revision polling endpoint."""

    async def seed() -> dict | None:
        snapshot = await _snapshot_revision_row()
        async with AsyncSessionLocal() as db:
            await db.execute(delete(TeachingContentRevision))
            db.add(
                TeachingContentRevision(
                    id=1,
                    revision=7,
                    changes=[
                        None,
                        "not-an-object",
                        {
                            "entityType": "question",
                            "entityId": "q-valid",
                            "action": "updated",
                        },
                    ],
                    updated_by="admin",
                    updated_at=datetime.fromisoformat("2026-08-10T10:00:00+00:00"),
                )
            )
            await db.commit()
        return snapshot

    snapshot = asyncio.run(seed())
    try:
        with TestClient(app) as client:
            assert client.post(
                "/api/v1/auth/login",
                json={"username": "admin", "password": "jbgsnmm~123"},
            ).status_code == 200
            response = client.get("/api/v1/question-catalog/revision")
        assert response.status_code == 200, response.text
        assert response.json()["revision"] == 7
        assert response.json()["changes"] == [
            {
                "entityType": "question",
                "entityId": "q-valid",
                "action": "updated",
            }
        ]
    finally:
        asyncio.run(_restore_revision_row(snapshot))


def test_principle_archive_rejects_bound_questions_then_archives_the_pair() -> None:
    """Catch a batch archive leaving a question bound to an inactive principle."""

    suffix = uuid4().hex[:10]
    username = f"teacher-archive-{suffix}"
    principle_id = f"principle-archive-{suffix}"
    preset_id = f"preset-archive-{suffix}"
    bank_id = f"bank-archive-{suffix}"
    question_id = f"question-archive-{suffix}"
    state = {"archived": False}

    async def seed() -> None:
        async with AsyncSessionLocal() as db:
            db.add(
                User(
                    username=username,
                    password_hash=hash_password(PASSWORD),
                    role="teacher",
                    status="active",
                    subject="PMP",
                )
            )
            await db.flush()
            db.add(
                QuestionBank(
                    id=bank_id,
                    owner_id=username,
                    name="原则归档测试题库",
                    subject="PMP",
                )
            )
            db.add(
                Principle(
                    id=principle_id,
                    name="被绑定的原则",
                    status="active",
                    created_by=username,
                    updated_by=username,
                )
            )
            await db.flush()
            db.add(
                SynthesisPreset(
                    id=preset_id,
                    principle_id=principle_id,
                    title="原则：被绑定的原则",
                    content="归纳内容",
                    status="active",
                    created_by=username,
                    updated_by=username,
                )
            )
            db.add(
                Question(
                    id=question_id,
                    bank_id=bank_id,
                    title="引用原则的题目",
                    content_metadata={
                        "stemPrincipleIds": [principle_id],
                        "optionPrincipleMap": {"B": [principle_id]},
                        "principleIds": [principle_id],
                    },
                )
            )
            await db.commit()

    async def remove_question() -> None:
        async with AsyncSessionLocal() as db:
            await db.execute(delete(Question).where(Question.id == question_id))
            await db.commit()

    async def assert_preset_draft() -> None:
        async with AsyncSessionLocal() as db:
            preset = await db.get(SynthesisPreset, preset_id)
            assert preset is not None and preset.status == "draft"

    async def verify_and_cleanup() -> None:
        async with AsyncSessionLocal() as db:
            principle = await db.get(Principle, principle_id)
            preset = await db.get(SynthesisPreset, preset_id)
            if state["archived"]:
                assert principle is not None and principle.status == "inactive"
                assert preset is not None and preset.status == "inactive"
            await db.execute(delete(Question).where(Question.id == question_id))
            await db.execute(delete(SynthesisPreset).where(SynthesisPreset.id == preset_id))
            await db.execute(delete(Principle).where(Principle.id == principle_id))
            await db.execute(delete(QuestionBank).where(QuestionBank.id == bank_id))
            await db.execute(delete(PaperRelease).where(PaperRelease.publisher_id == username))
            await db.execute(delete(User).where(User.username == username))
            await db.commit()

    asyncio.run(seed())
    try:
        with TestClient(app) as client:
            assert client.post(
                "/api/v1/auth/login",
                json={"username": username, "password": PASSWORD},
            ).status_code == 200
            drafted = client.post(
                "/api/v1/content-prep/principles/status",
                json={"ids": [principle_id], "presetStatus": "draft"},
            )
            assert drafted.status_code == 200
            assert drafted.json()["updatedPresetIds"] == [preset_id]
            asyncio.run(assert_preset_draft())
            blocked = client.post(
                "/api/v1/content-prep/principles/archive",
                json={"ids": [principle_id]},
            )
            assert blocked.status_code == 409
            assert blocked.json()["detail"] == {
                "code": "PRINCIPLE_IN_USE",
                "referencedIds": [principle_id],
                "referenceCounts": {principle_id: 1},
                "referenceQuestions": {
                    principle_id: [
                        {
                            "questionId": question_id,
                            "questionTitle": "引用原则的题目",
                            "teacherNumber": None,
                            "bankId": bank_id,
                            "bankName": "原则归档测试题库",
                        }
                    ]
                },
            }
            blocked_delete = client.post(
                "/api/v1/content-prep/principles/delete",
                json={"ids": [principle_id]},
            )
            assert blocked_delete.status_code == 409
            assert blocked_delete.json()["detail"] == blocked.json()["detail"]
            asyncio.run(remove_question())
            archived = client.post(
                "/api/v1/content-prep/principles/archive",
                json={"ids": [principle_id]},
            )
            assert archived.status_code == 200
            assert archived.json()["archivedIds"] == [principle_id]
            state["archived"] = True
    finally:
        asyncio.run(verify_and_cleanup())


def test_principle_delete_removes_an_unreferenced_principle_and_its_card() -> None:
    """A configured-but-unused pair must disappear, not merely become hidden."""

    suffix = uuid4().hex[:10]
    username = f"teacher-delete-{suffix}"
    principle_id = f"principle-delete-{suffix}"
    preset_id = f"preset-delete-{suffix}"
    shared_keys = {
        revision_service.REVISION_KEY,
        PRINCIPLE_PROJECTION_KEY,
        PRESET_PROJECTION_KEY,
    }

    async def seed() -> dict[str, dict]:
        shared_snapshot = await _snapshot_shared_rows(shared_keys)
        async with AsyncSessionLocal() as db:
            db.add(
                User(
                    username=username,
                    password_hash=hash_password(PASSWORD),
                    role="teacher",
                    status="active",
                    subject="PMP",
                )
            )
            await db.flush()
            db.add(
                Principle(
                    id=principle_id,
                    name="可删除原则",
                    status="active",
                    created_by=username,
                    updated_by=username,
                )
            )
            await db.flush()
            db.add(
                SynthesisPreset(
                    id=preset_id,
                    principle_id=principle_id,
                    title="原则：可删除原则",
                    content="尚未绑定到任何题目。",
                    status="active",
                    created_by=username,
                    updated_by=username,
                )
            )
            await teaching_content_projection_service.write_principle_projection(
                db, username
            )
            await db.commit()
        return shared_snapshot

    async def verify_deleted() -> None:
        async with AsyncSessionLocal() as db:
            assert await db.get(Principle, principle_id) is None
            assert await db.get(SynthesisPreset, preset_id) is None
            principles = json.loads(
                (await db.get(SharedRuntimeState, PRINCIPLE_PROJECTION_KEY)).value
            )
            presets = json.loads(
                (await db.get(SharedRuntimeState, PRESET_PROJECTION_KEY)).value
            )
            assert principle_id not in {item["id"] for item in principles["items"]}
            assert preset_id not in {item["id"] for item in presets["items"]}

    async def cleanup(shared_snapshot: dict[str, dict]) -> None:
        async with AsyncSessionLocal() as db:
            await db.execute(delete(SynthesisPreset).where(SynthesisPreset.id == preset_id))
            await db.execute(delete(Principle).where(Principle.id == principle_id))
            await db.execute(delete(PaperRelease).where(PaperRelease.publisher_id == username))
            await db.execute(delete(User).where(User.username == username))
            await db.commit()
        await _restore_shared_rows(shared_keys, shared_snapshot)

    snapshot = asyncio.run(seed())
    try:
        with TestClient(app) as client:
            assert client.post(
                "/api/v1/auth/login",
                json={"username": username, "password": PASSWORD},
            ).status_code == 200
            response = client.post(
                "/api/v1/content-prep/principles/delete",
                json={"ids": [principle_id]},
            )
        assert response.status_code == 200, response.text
        assert response.json()["deletedIds"] == [principle_id]
        asyncio.run(verify_deleted())
    finally:
        asyncio.run(cleanup(snapshot))


def test_principle_bundle_import_replaces_unused_pairs_as_one_canonical_bundle() -> None:
    """Import must replace both sides together and normalize the card heading."""

    suffix = uuid4().hex[:10]
    username = f"teacher-bundle-{suffix}"
    old_principle_id = f"principle-old-{suffix}"
    old_preset_id = f"preset-old-{suffix}"
    new_principle_id = f"principle-new-{suffix}"
    new_preset_id = f"preset-new-{suffix}"

    async def seed() -> None:
        async with AsyncSessionLocal() as db:
            db.add(
                User(
                    username=username,
                    password_hash=hash_password(PASSWORD),
                    role="teacher",
                    status="active",
                )
            )
            await db.flush()
            db.add(
                Principle(
                    id=old_principle_id,
                    name="旧原则",
                    status="active",
                    created_by=username,
                    updated_by=username,
                )
            )
            await db.flush()
            db.add(
                SynthesisPreset(
                    id=old_preset_id,
                    principle_id=old_principle_id,
                    title="原则：旧原则",
                    content="旧归纳卡",
                    status="active",
                    created_by=username,
                    updated_by=username,
                )
            )
            await db.commit()

    async def verify() -> None:
        async with AsyncSessionLocal() as db:
            assert await db.get(Principle, old_principle_id) is None
            assert await db.get(SynthesisPreset, old_preset_id) is None
            principle = await db.get(Principle, new_principle_id)
            preset = await db.get(SynthesisPreset, new_preset_id)
            assert principle is not None and principle.name == "导入原则"
            assert preset is not None and preset.principle_id == new_principle_id
            assert preset.title == "原则：导入原则"

    async def cleanup() -> None:
        async with AsyncSessionLocal() as db:
            await db.execute(delete(SynthesisPreset).where(SynthesisPreset.id == old_preset_id))
            await db.execute(delete(SynthesisPreset).where(SynthesisPreset.id == new_preset_id))
            await db.execute(
                delete(Principle).where(
                    Principle.id.in_([old_principle_id, new_principle_id])
                )
            )
            await db.execute(delete(PaperRelease).where(PaperRelease.publisher_id == username))
            await db.execute(delete(User).where(User.username == username))
            await db.commit()

    asyncio.run(seed())
    try:
        payload = {
            "principleCardBundleVersion": 1,
            "format": "kg-principle-card-bundle-v1",
            "principles": {
                "schemaVersion": 1,
                "items": [
                    {
                        "id": new_principle_id,
                        "name": "导入原则",
                        "status": "active",
                        "confusablePrincipleIds": [],
                    }
                ],
            },
            "synthesisPresets": {
                "schemaVersion": 1,
                "items": [
                    {
                        "id": new_preset_id,
                        "principleId": new_principle_id,
                        "title": "应由原则名称覆盖",
                        "content": "导入归纳卡",
                        "status": "active",
                        "version": 1,
                    }
                ],
            },
        }
        with TestClient(app) as client:
            assert client.post(
                "/api/v1/auth/login",
                json={"username": username, "password": PASSWORD},
            ).status_code == 200
            response = client.post("/api/v1/content-prep/principles/import", json=payload)
        assert response.status_code == 200, response.text
        assert response.json()["importedPrincipleCount"] == 1
        projected_preset = response.json()["synthesisPresets"]["items"][0]
        assert {
            key: value
            for key, value in projected_preset.items()
            if key not in {"createdAt", "updatedAt"}
        } == {
            "id": new_preset_id,
            "principleId": new_principle_id,
            "title": "原则：导入原则",
            "content": "导入归纳卡",
            "status": "active",
            "version": 1,
        }
        asyncio.run(verify())
    finally:
        asyncio.run(cleanup())


def test_imported_builtin_principle_card_updates_survive_startup_seed() -> None:
    """Catch startup seeding silently restoring administrator-imported built-in IDs."""

    shared_keys = {
        revision_service.REVISION_KEY,
        PRINCIPLE_PROJECTION_KEY,
        PRESET_PROJECTION_KEY,
    }
    bundle = builtin_teaching_content_seed_service.load_builtin_bundle()
    principle_id = str(bundle.principles[0]["id"])
    preset_id = next(
        str(item["id"])
        for item in bundle.synthesis_presets
        if str(item["principleId"]) == principle_id
    )
    imported_name = "管理员导入的内置原则"
    imported_content = "这是管理员导入并需要跨重启保留的归纳卡。"

    async def prepare() -> tuple[dict[str, dict], dict[str, dict], dict[str, dict]]:
        async with AsyncSessionLocal() as db:
            await builtin_teaching_content_seed_service.sync_builtin_teaching_content(db)
        shared_snapshot = await _snapshot_shared_rows(shared_keys)
        principle_snapshot, preset_snapshot = await _snapshot_principle_relations()
        return shared_snapshot, principle_snapshot, preset_snapshot

    async def run_startup_seed_and_verify(import_revision: int) -> None:
        async with AsyncSessionLocal() as db:
            summary = await builtin_teaching_content_seed_service.sync_builtin_teaching_content(db)
            assert summary.updated == 0
            principle = await db.get(Principle, principle_id)
            preset = await db.get(SynthesisPreset, preset_id)
            assert principle is not None and principle.name == imported_name
            assert preset is not None and preset.content == imported_content
            assert int((await revision_service.current(db))["revision"]) == import_revision
            principle_projection = json.loads(
                (await db.get(SharedRuntimeState, PRINCIPLE_PROJECTION_KEY)).value
            )
            preset_projection = json.loads(
                (await db.get(SharedRuntimeState, PRESET_PROJECTION_KEY)).value
            )
            assert next(item for item in principle_projection["items"] if item["id"] == principle_id)["name"] == imported_name
            assert next(item for item in preset_projection["items"] if item["id"] == preset_id)["content"] == imported_content

    async def cleanup(
        shared_snapshot: dict[str, dict],
        principle_snapshot: dict[str, dict],
        preset_snapshot: dict[str, dict],
    ) -> None:
        await _restore_principle_relations(
            principle_snapshot,
            preset_snapshot,
            added_principle_ids=set(),
            added_preset_ids=set(),
        )
        await _restore_shared_rows(shared_keys, shared_snapshot)

    shared_snapshot, principle_snapshot, preset_snapshot = asyncio.run(prepare())
    try:
        with TestClient(app) as client:
            assert client.post(
                "/api/v1/auth/login",
                json={"username": "admin", "password": "jbgsnmm~123"},
            ).status_code == 200
            current = client.get("/api/v1/content-prep/principles")
            assert current.status_code == 200, current.text
            payload = current.json()
            payload.pop("contentRevision", None)
            for item in payload["principles"]["items"]:
                if item["id"] == principle_id:
                    item["name"] = imported_name
            for item in payload["synthesisPresets"]["items"]:
                if item["id"] == preset_id:
                    item["title"] = f"原则：{imported_name}"
                    item["content"] = imported_content
            imported = client.post("/api/v1/content-prep/principles/import", json=payload)
            assert imported.status_code == 200, imported.text
        asyncio.run(run_startup_seed_and_verify(int(imported.json()["contentRevision"])))
    finally:
        asyncio.run(cleanup(shared_snapshot, principle_snapshot, preset_snapshot))


def test_principle_bundle_validation_rejects_missing_card_collection() -> None:
    """A malformed upload must fail with a client error, never a KeyError/500."""

    with pytest.raises(ValueError, match="归纳卡必须包含 items 数组"):
        teaching_content_projection_service.validate_principle_card_bundle(
            {
                "principleCardBundleVersion": 1,
                "format": "kg-principle-card-bundle-v1",
                "principles": {"schemaVersion": 1, "items": []},
            }
        )


def test_synthesis_preset_enforces_one_card_per_principle() -> None:
    """Catch two system cards being persisted for one principle."""

    suffix = uuid4().hex[:10]
    username = f"teacher-preset-unique-{suffix}"
    principle_id = f"principle-preset-unique-{suffix}"
    preset_ids = [f"preset-primary-{suffix}", f"preset-duplicate-{suffix}"]

    async def scenario() -> None:
        async with AsyncSessionLocal() as db:
            db.add(
                User(
                    username=username,
                    password_hash=hash_password(PASSWORD),
                    role="teacher",
                    status="active",
                )
            )
            await db.flush()
            db.add(
                Principle(
                    id=principle_id,
                    name="唯一归纳卡原则",
                    created_by=username,
                    updated_by=username,
                )
            )
            await db.flush()
            db.add(
                SynthesisPreset(
                    id=preset_ids[0],
                    principle_id=principle_id,
                    title="原则：唯一归纳卡原则",
                    content="第一张卡",
                    created_by=username,
                    updated_by=username,
                )
            )
            await db.commit()
            db.add(
                SynthesisPreset(
                    id=preset_ids[1],
                    principle_id=principle_id,
                    title="原则：唯一归纳卡原则",
                    content="第二张卡",
                    created_by=username,
                    updated_by=username,
                )
            )
            with pytest.raises(IntegrityError):
                await db.commit()
            await db.rollback()
            await db.execute(
                delete(SynthesisPreset).where(SynthesisPreset.id.in_(preset_ids))
            )
            await db.execute(delete(Principle).where(Principle.id == principle_id))
            await db.execute(delete(PaperRelease).where(PaperRelease.publisher_id == username))
            await db.execute(delete(User).where(User.username == username))
            await db.commit()

    asyncio.run(scenario())


def test_revision_endpoint_and_managed_bootstrap_are_role_safe() -> None:
    """Catch accidental public/student access or omission from managed bootstrap."""

    suffix = uuid4().hex[:10]
    usernames = {
        role: f"revision-{role}-{suffix}"
        for role in ("admin", "teacher", "student", "viewer")
    }

    async def seed() -> tuple[dict | None, int]:
        await _seed_builtin_teaching_content()
        snapshot = await _snapshot_revision_row()
        async with AsyncSessionLocal() as db:
            password_hash = hash_password(PASSWORD)
            db.add_all(
                [
                    User(
                        username=username,
                        password_hash=password_hash,
                        role=role,
                        status="active",
                    )
                    for role, username in usernames.items()
                ]
            )
            await db.flush()
            payload = await revision_service.bump(
                db,
                usernames["teacher"],
                [
                    {
                        "entityType": "question",
                        "entityId": f"q-endpoint-{suffix}",
                        "action": "created",
                    }
                ],
            )
            await db.commit()
        return snapshot, int(payload["revision"])

    async def cleanup(snapshot: dict | None) -> None:
        async with AsyncSessionLocal() as db:
            await db.execute(delete(User).where(User.username.in_(usernames.values())))
            await db.commit()
        await _restore_revision_row(snapshot)

    snapshot, expected_revision = asyncio.run(seed())
    try:
        with TestClient(app) as client:
            assert client.get("/api/v1/question-catalog/revision").status_code == 401

            for role in ("admin", "teacher"):
                login = client.post(
                    "/api/v1/auth/login",
                    json={"username": usernames[role], "password": PASSWORD},
                )
                assert login.status_code == 200
                response = client.get("/api/v1/question-catalog/revision")
                assert response.status_code == 200
                assert response.json() == {
                    "revision": expected_revision,
                    "changes": [
                        {
                            "entityType": "question",
                            "entityId": f"q-endpoint-{suffix}",
                            "action": "created",
                        }
                    ],
                    "updatedAt": response.json()["updatedAt"],
                    "updatedBy": usernames["teacher"],
                }
                assert isinstance(response.json()["updatedAt"], str)

                bootstrap = client.get(
                    "/api/v1/question-catalog/bootstrap",
                    params={"mode": "managed"},
                )
                assert bootstrap.status_code == 200
                assert bootstrap.json()["contentRevision"] == expected_revision
                assert len(bootstrap.json()["catalogRevision"]) == 64
                client.post("/api/v1/auth/logout")

            for role in ("student", "viewer"):
                login = client.post(
                    "/api/v1/auth/login",
                    json={"username": usernames[role], "password": PASSWORD},
                )
                assert login.status_code == 200
                assert (
                    client.get("/api/v1/question-catalog/revision").status_code
                    == 403
                )
                client.post("/api/v1/auth/logout")
    finally:
        asyncio.run(cleanup(snapshot))


def test_runtime_get_returns_storage_and_content_revision_from_one_snapshot(
    monkeypatch,
) -> None:
    key = "kg_course_config_drafts_v1"
    marker_key = "kg_teacher_shared_runtime_promotion_v1"
    shared_keys = {key, marker_key}
    snapshot = asyncio.run(_snapshot_shared_rows(shared_keys))
    captured: dict[str, object] = {}

    async def seed() -> None:
        async with AsyncSessionLocal() as db:
            for row_key, value in (
                (key, json.dumps([{"id": "snapshot-old"}])),
                (
                    marker_key,
                    json.dumps({"schemaVersion": 1, "status": "complete"}),
                ),
            ):
                row = await db.get(SharedRuntimeState, row_key)
                if row is None:
                    db.add(
                        SharedRuntimeState(
                            key=row_key,
                            value=value,
                            updated_by="pytest",
                        )
                    )
                else:
                    row.value = value
                    row.updated_by = "pytest"
            await db.commit()

    async def competing_write() -> None:
        async with AsyncSessionLocal() as db:
            async with db.begin():
                await revision_service.acquire_lock(db)
                row = await db.get(SharedRuntimeState, key)
                assert row is not None
                row.value = json.dumps([{"id": "snapshot-new"}])
                row.updated_by = "snapshot-competitor"
                await revision_service.bump(
                    db,
                    "snapshot-competitor",
                    [{"entityType": "runtimeShared", "entityId": key, "action": "updated"}],
                )

    asyncio.run(seed())
    from app.services import runtime_state_service

    original_get_state = runtime_state_service.get_state

    async def writer_after_snapshot(*args, **kwargs):
        result = await original_get_state(*args, **kwargs)
        if not captured:
            captured["storage"] = result[0][key]
            if len(result) == 3:
                captured["contentRevision"] = result[2]
            else:
                async with AsyncSessionLocal() as db:
                    captured["contentRevision"] = int(
                        (await revision_service.current(db))["revision"]
                    )
            await competing_write()
        return result

    monkeypatch.setattr(runtime_state_service, "get_state", writer_after_snapshot)
    try:
        with TestClient(app) as client:
            assert client.post(
                "/api/v1/auth/login",
                json={"username": "admin", "password": "jbgsnmm~123"},
            ).status_code == 200
            response = client.get("/api/v1/runtime/state")

        assert response.status_code == 200, response.text
        assert response.json()["storage"][key] == captured["storage"]
        assert response.json()["contentRevision"] == captured["contentRevision"]
    finally:
        asyncio.run(_restore_shared_rows(shared_keys, snapshot))


def test_personal_runtime_put_returns_its_old_content_token_not_a_later_writer(
    monkeypatch,
) -> None:
    suffix = uuid4().hex[:10]
    username = f"personal-token-{suffix}"

    async def seed() -> None:
        async with AsyncSessionLocal() as db:
            db.add(
                User(
                    username=username,
                    password_hash=hash_password(PASSWORD),
                    role="teacher",
                    status="active",
                )
            )
            await db.commit()

    async def cleanup() -> None:
        async with AsyncSessionLocal() as db:
            await db.execute(delete(RuntimeState).where(RuntimeState.owner_id == username))
            await db.execute(delete(PaperRelease).where(PaperRelease.publisher_id == username))
            await db.execute(delete(User).where(User.username == username))
            await db.commit()

    async def competing_bump() -> None:
        async with AsyncSessionLocal() as db:
            async with db.begin():
                await revision_service.bump(
                    db,
                    "personal-token-competitor",
                    [
                        {
                            "entityType": "runtimeShared",
                            "entityId": f"personal-token-{suffix}",
                            "action": "updated",
                        }
                    ],
                )

    asyncio.run(seed())
    from app.services import runtime_state_service

    original_apply_update = runtime_state_service.apply_update
    captured: dict[str, int] = {}

    async def writer_after_commit(*args, **kwargs):
        result = await original_apply_update(*args, **kwargs)
        if len(result) == 3:
            captured["contentRevision"] = int(result[2])
        else:
            async with AsyncSessionLocal() as db:
                captured["contentRevision"] = int(
                    (await revision_service.current(db))["revision"]
                )
        await competing_bump()
        return result

    monkeypatch.setattr(runtime_state_service, "apply_update", writer_after_commit)
    try:
        with TestClient(app) as client:
            assert client.post(
                "/api/v1/auth/login",
                json={"username": username, "password": PASSWORD},
            ).status_code == 200
            state = client.get("/api/v1/runtime/state").json()
            response = client.put(
                "/api/v1/runtime/state",
                json={
                    "page": "question-bank.html",
                    "namespace": "questions",
                    "operation": "setItem",
                    "key": "kg_question_language_mode_v1",
                    "value": "zh",
                    "storage": {},
                    "requestId": f"personal-token-{suffix}",
                    "revision": state["revision"],
                    "contentRevision": state["contentRevision"],
                },
            )

        assert response.status_code == 200, response.text
        assert captured["contentRevision"] == state["contentRevision"]
        assert response.json()["contentRevision"] == captured["contentRevision"]
    finally:
        asyncio.run(cleanup())


def test_runtime_read_and_personal_snapshot_share_the_revision_lock(
    monkeypatch,
) -> None:
    """Two snapshots may overlap while an exclusive writer waits behind both."""

    from app.services import runtime_state_service
    from app.web.schemas import RuntimeStateUpdate

    key = "kg_content_subjects_v1"
    shared_keys = {key, revision_service.REVISION_KEY}
    snapshot = asyncio.run(_snapshot_shared_rows(shared_keys))
    snapshots_arrived = Event()
    release_snapshots = Event()
    writer_attempted = Event()
    writer_done = Event()
    snapshot_barrier = Barrier(2, action=snapshots_arrived.set)
    original_snapshot = runtime_state_service._read_state_snapshot_locked
    original_exclusive_lock = revision_service.acquire_lock

    async def seed() -> int:
        async with AsyncSessionLocal() as db:
            async with db.begin():
                await original_exclusive_lock(db)
                row = await db.get(SharedRuntimeState, key)
                if row is None:
                    db.add(
                        SharedRuntimeState(
                            key=key,
                            value=json.dumps({"value": "before"}),
                            updated_by="shared-read-proof",
                        )
                    )
                else:
                    row.value = json.dumps({"value": "before"})
                    row.updated_by = "shared-read-proof"
                revision = await revision_service.bump(
                    db,
                    "shared-read-proof",
                    [{"entityType": "runtimeShared", "entityId": key, "action": "updated"}],
                )
                return int(revision["revision"])

    async def gated_snapshot(*args, **kwargs):
        result = await original_snapshot(*args, **kwargs)
        await asyncio.to_thread(snapshot_barrier.wait, 5)
        assert await asyncio.to_thread(release_snapshots.wait, 10)
        return result

    async def observed_exclusive_lock(db) -> None:
        if db.info.get("shared-read-proof-writer"):
            writer_attempted.set()
        await original_exclusive_lock(db)

    base_revision = asyncio.run(seed())
    monkeypatch.setattr(
        runtime_state_service,
        "_read_state_snapshot_locked",
        gated_snapshot,
    )
    monkeypatch.setattr(revision_service, "acquire_lock", observed_exclusive_lock)

    async def read_snapshot():
        async with AsyncSessionLocal() as db:
            return await runtime_state_service.get_state(db, "学生", "student")

    async def personal_snapshot():
        update = RuntimeStateUpdate.model_validate(
            {
                "page": "learning-path.html",
                "namespace": "guided-learning",
                "operation": "setItem",
                "key": "kg_default_entry_mode_v1",
                "value": "free",
                "storage": {},
                "requestId": f"shared-read-proof-{uuid4().hex}",
                "revision": 0,
            }
        )
        async with AsyncSessionLocal() as db:
            return await runtime_state_service.apply_update(
                db,
                "乔治008",
                "viewer",
                update,
            )

    async def exclusive_writer() -> int:
        try:
            async with AsyncSessionLocal() as db:
                db.info["shared-read-proof-writer"] = True
                async with db.begin():
                    await revision_service.acquire_lock(db)
                    row = await db.get(SharedRuntimeState, key)
                    assert row is not None
                    row.value = json.dumps({"value": "after"})
                    row.updated_by = "shared-read-proof-writer"
                    revision = await revision_service.bump(
                        db,
                        "shared-read-proof-writer",
                        [
                            {
                                "entityType": "runtimeShared",
                                "entityId": key,
                                "action": "updated",
                            }
                        ],
                    )
                    return int(revision["revision"])
        finally:
            writer_done.set()

    try:
        with ThreadPoolExecutor(max_workers=3) as pool:
            read_future = pool.submit(lambda: asyncio.run(read_snapshot()))
            personal_future = pool.submit(lambda: asyncio.run(personal_snapshot()))
            assert snapshots_arrived.wait(6), "read snapshots serialized on an exclusive lock"
            writer_future = pool.submit(lambda: asyncio.run(exclusive_writer()))
            assert writer_attempted.wait(6)
            assert writer_done.is_set() is False
            release_snapshots.set()
            read_result = read_future.result(timeout=10)
            personal_result = personal_future.result(timeout=10)
            writer_revision = writer_future.result(timeout=10)

        expected_value = json.dumps({"value": "before"})
        assert read_result[0][key] == expected_value
        assert read_result[2] == base_revision
        assert personal_result[0][key] == expected_value
        assert personal_result[2] == base_revision
        assert writer_revision == base_revision + 1
    finally:
        release_snapshots.set()

        async def cleanup() -> None:
            async with AsyncSessionLocal() as db:
                await db.execute(
                    delete(RuntimeState).where(RuntimeState.owner_id == "乔治008")
                )
                await db.commit()
            await _restore_shared_rows(shared_keys, snapshot)

        asyncio.run(cleanup())


def test_content_prep_result_exposes_content_revision_in_camel_case() -> None:
    """Catch dropping the revision that clients publish after a successful save."""

    payload = ContentPrepBatchResult.model_validate(
        {
            "batchId": "batch-revision",
            "bankId": "bank-revision",
            "bankRevision": 2,
            "contentRevision": 9,
            "questions": [
                {
                    "questionId": "question-revision",
                    "status": "updated",
                    "revision": 2,
                    "contentHash": "a" * 64,
                }
            ],
        }
    ).model_dump(by_alias=True)

    assert payload["contentRevision"] == 9


@pytest.mark.parametrize(
    ("creator_id", "case_name"),
    [("creator_001", "standard"), (None, "legacy-null-creator")],
)
def test_single_question_save_returns_current_content_revision(
    creator_id: str | None,
    case_name: str,
) -> None:
    """Catch either single-save route returning success without a sync revision."""

    suffix = uuid4().hex[:10]
    bank_id = f"revision-save-bank-{suffix}"
    question_id = f"revision-save-question-{suffix}"
    client_instance_id = f"revision-save-client-{suffix}"

    async def seed() -> dict | None:
        snapshot = await _snapshot_revision_row()
        async with AsyncSessionLocal() as db:
            db.add(
                QuestionBank(
                    id=bank_id,
                    owner_id="admin",
                    name=f"revision {case_name} save bank",
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
                    title="single save before",
                    subject="PMP",
                    scope="internal",
                    revision=1,
                    creator_id=creator_id,
                    creator_name="波塞冬" if creator_id else None,
                    created_by="admin",
                    updated_by="admin",
                )
            )
            await revision_service.bump(
                db,
                "admin",
                [
                    {
                        "entityType": "question",
                        "entityId": f"pre-save-{suffix}",
                        "action": "updated",
                    }
                ],
            )
            await db.commit()
        return snapshot

    async def current_revision() -> int:
        async with AsyncSessionLocal() as db:
            return int((await revision_service.current(db))["revision"])

    async def cleanup(snapshot: dict | None) -> None:
        async with AsyncSessionLocal() as db:
            await db.execute(
                delete(QuestionEditLock).where(
                    QuestionEditLock.question_id == question_id
                )
            )
            await db.execute(
                delete(QuestionAuditLog).where(QuestionAuditLog.bank_id == bank_id)
            )
            await db.execute(
                delete(QuestionUploadBatch).where(
                    QuestionUploadBatch.bank_id == bank_id
                )
            )
            await db.execute(delete(Question).where(Question.id == question_id))
            await db.execute(delete(QuestionBank).where(QuestionBank.id == bank_id))
            await db.commit()
        await _restore_revision_row(snapshot)

    snapshot = asyncio.run(seed())
    try:
        before_save_revision = asyncio.run(current_revision())
        with TestClient(app) as client:
            assert client.post(
                "/api/v1/auth/login",
                json={"username": "admin", "password": "jbgsnmm~123"},
            ).status_code == 200
            lock = client.post(
                f"/api/v1/content-prep/locks/{question_id}",
                json={
                    "clientInstanceId": client_instance_id,
                    **({"creatorId": creator_id} if creator_id else {}),
                },
            )
            assert lock.status_code == 200, lock.text
            changed_question = question_payload(
                question_id,
                title=f"single save after {case_name}",
            )
            changed_question["metadata"]["principleIds"] = []
            changed_question["metadata"]["optionPrincipleMap"] = {}
            changed_question["metadata"]["tagPaths"] = []
            body = {
                "idempotencyKey": f"revision-save-{suffix}",
                "clientInstanceId": client_instance_id,
                "prepVersion": "0.4.0",
                "workspaceVersion": "1",
                "question": changed_question,
                "baseRevision": 1,
                "lockToken": lock.json()["lockToken"],
                "principles": {},
                "synthesisPresets": {},
                "tagConfig": {},
                **({"creatorId": creator_id} if creator_id else {}),
            }
            response = client.put(
                f"/api/v1/content-prep/questions/{question_id}",
                json=body,
            )
        assert response.status_code == 200, response.text
        assert response.json()["contentRevision"] == asyncio.run(current_revision())
        assert response.json()["contentRevision"] == before_save_revision + 1
    finally:
        asyncio.run(cleanup(snapshot))


async def _snapshot_shared_rows(keys: set[str]) -> dict[str, dict]:
    async with AsyncSessionLocal() as db:
        runtime_keys = keys - {revision_service.REVISION_KEY}
        rows = (
            await db.execute(
                select(SharedRuntimeState).where(
                    SharedRuntimeState.key.in_(runtime_keys)
                )
            )
        ).scalars().all()
        snapshot = {
            row.key: {
                "value": row.value,
                "schema_version": row.schema_version,
                "updated_by": row.updated_by,
                "created_at": row.created_at,
                "updated_at": row.updated_at,
            }
            for row in rows
        }
        if revision_service.REVISION_KEY in keys:
            revision = await db.get(TeachingContentRevision, 1)
            if revision is not None:
                snapshot[revision_service.REVISION_KEY] = {
                    "relational": True,
                    "revision": revision.revision,
                    "changes": deepcopy(revision.changes),
                    "updated_by": revision.updated_by,
                    "updated_at": revision.updated_at,
                }
        return snapshot


async def _restore_shared_rows(keys: set[str], snapshot: dict[str, dict]) -> None:
    async with AsyncSessionLocal() as db:
        runtime_keys = keys - {revision_service.REVISION_KEY}
        await db.execute(
            delete(SharedRuntimeState).where(SharedRuntimeState.key.in_(runtime_keys))
        )
        db.add_all(
            [
                SharedRuntimeState(
                    key=key,
                    value=str(row["value"]),
                    schema_version=int(row["schema_version"]),
                    updated_by=row["updated_by"],
                    created_at=row["created_at"],
                    updated_at=row["updated_at"],
                )
                for key, row in snapshot.items()
                if key != revision_service.REVISION_KEY
            ]
        )
        if revision_service.REVISION_KEY in keys:
            await db.execute(delete(TeachingContentRevision))
            revision = snapshot.get(revision_service.REVISION_KEY)
            if revision is not None:
                db.add(
                    TeachingContentRevision(
                        id=1,
                        revision=int(revision["revision"]),
                        changes=deepcopy(revision["changes"]),
                        updated_by=revision["updated_by"],
                        updated_at=revision["updated_at"],
                    )
                )
        await db.commit()


def test_content_prep_batch_projects_canonical_relations_and_bumps_once() -> None:
    """Catch a committed batch publishing stale projections or multiple revisions."""

    suffix = uuid4().hex[:10]
    username = f"revision-projection-{suffix}"
    bank_id = f"revision-projection-bank-{suffix}"
    question_id = str(uuid4())
    principle_id = f"principle-projection-{suffix}"
    preset_id = f"preset-projection-{suffix}"
    shared_keys = {
        revision_service.REVISION_KEY,
        PRINCIPLE_PROJECTION_KEY,
        PRESET_PROJECTION_KEY,
    }

    async def scenario() -> None:
        shared_snapshot = await _snapshot_shared_rows(shared_keys)
        batch_id: str | None = None
        try:
            async with AsyncSessionLocal() as db:
                db.add(
                    User(
                        username=username,
                        password_hash=hash_password(PASSWORD),
                        role="teacher",
                        status="active",
                    )
                )
                await db.flush()
                db.add(
                    QuestionBank(
                        id=bank_id,
                        owner_id=username,
                        name="原则投影批次",
                        subject="PMP",
                        revision=1,
                    )
                )
                await db.commit()

            raw_question = question_payload(question_id)
            raw_question["metadata"]["principleIds"] = [principle_id]
            raw_question["metadata"]["optionPrincipleMap"] = {
                "B": [principle_id]
            }
            raw_question["metadata"]["tagPaths"] = []
            base = request_payload(
                key=f"projection-batch-{suffix}",
                bank_id=bank_id,
                question=raw_question,
            ).model_dump(by_alias=True)
            base["principles"] = {
                "schemaVersion": 1,
                "items": [
                    {
                        "id": f"  {principle_id}  ",
                        "name": "先确认理解",
                        "status": "active",
                        "confusablePrincipleIds": ["  p-confusable  "],
                    }
                ],
            }
            base["synthesisPresets"] = {
                "schemaVersion": 1,
                "items": [
                    {
                        "id": f"  {preset_id}  ",
                        "principleId": principle_id,
                        "title": "确认理解归纳",
                        "content": "发送之后确认接收和理解。",
                        "status": "active",
                        "version": 3,
                    }
                ],
            }
            base["tagConfig"] = {}
            request = ContentPrepBatchRequest.model_validate(base)

            async with AsyncSessionLocal() as db:
                before = int((await revision_service.current(db))["revision"])
                actor = await db.get(User, username)
                assert actor is not None
                result = await upload_bundle(db, actor, request)
                batch_id = result.batch_id

            async with AsyncSessionLocal() as db:
                revision = await revision_service.current(db)
                principle_projection = json.loads(
                    (await db.get(SharedRuntimeState, PRINCIPLE_PROJECTION_KEY)).value
                )
                preset_projection = json.loads(
                    (await db.get(SharedRuntimeState, PRESET_PROJECTION_KEY)).value
                )

            assert result.content_revision == before + 1
            assert revision["revision"] == before + 1
            assert {
                (change["entityType"], change["entityId"], change["action"])
                for change in revision["changes"]
            } == {
                ("bank", bank_id, "updated"),
                ("question", question_id, "created"),
                ("principle", principle_id, "created"),
                ("synthesisPreset", preset_id, "created"),
            }
            assert principle_projection["schemaVersion"] == 1
            assert isinstance(principle_projection["updatedAt"], int)
            assert [item["id"] for item in principle_projection["items"]] == sorted(
                item["id"] for item in principle_projection["items"]
            )
            projected_principle = next(
                item for item in principle_projection["items"] if item["id"] == principle_id
            )
            assert {
                key: value
                for key, value in projected_principle.items()
                if key not in {"createdAt", "updatedAt"}
            } == {
                "id": principle_id,
                "name": "先确认理解",
                "status": "active",
                "confusablePrincipleIds": ["p-confusable"],
            }
            assert isinstance(projected_principle["createdAt"], int)
            assert projected_principle["createdAt"] > 0
            assert isinstance(projected_principle["updatedAt"], int)
            assert projected_principle["updatedAt"] > 0
            projected_preset = next(
                item for item in preset_projection["items"] if item["id"] == preset_id
            )
            assert {
                key: value
                for key, value in projected_preset.items()
                if key not in {"createdAt", "updatedAt"}
            } == {
                "id": preset_id,
                "principleId": principle_id,
                "title": "确认理解归纳",
                "content": "发送之后确认接收和理解。",
                "status": "active",
                "version": 3,
            }
            assert isinstance(projected_preset["createdAt"], int)
            assert projected_preset["createdAt"] > 0
            assert isinstance(projected_preset["updatedAt"], int)
            assert projected_preset["updatedAt"] > 0
        finally:
            async with AsyncSessionLocal() as db:
                await db.execute(
                    delete(QuestionAuditLog).where(QuestionAuditLog.bank_id == bank_id)
                )
                await db.execute(
                    delete(QuestionUploadBatch).where(
                        QuestionUploadBatch.actor_username == username
                    )
                )
                await db.execute(delete(Question).where(Question.id == question_id))
                await db.execute(
                    delete(SynthesisPreset).where(SynthesisPreset.id == preset_id)
                )
                await db.execute(delete(Principle).where(Principle.id == principle_id))
                await db.execute(delete(QuestionBank).where(QuestionBank.id == bank_id))
                await db.execute(delete(PaperReleaseQuestion).where(PaperReleaseQuestion.release_id.in_(select(PaperRelease.id).where(PaperRelease.publisher_id == username))))
                await db.execute(delete(PaperRelease).where(PaperRelease.publisher_id == username))
                await db.execute(delete(User).where(User.username == username))
                await db.commit()
            await _restore_shared_rows(shared_keys, shared_snapshot)

    asyncio.run(scenario())


def test_rejected_content_prep_batch_keeps_projection_and_revision_unchanged() -> None:
    """Catch projection/revision writes escaping a rejected upload transaction."""

    suffix = uuid4().hex[:10]
    username = f"revision-rejected-{suffix}"
    bank_id = f"revision-rejected-bank-{suffix}"
    question_id = str(uuid4())
    principle_id = f"principle-rejected-{suffix}"
    preset_id = f"preset-rejected-{suffix}"
    shared_keys = {
        revision_service.REVISION_KEY,
        PRINCIPLE_PROJECTION_KEY,
        PRESET_PROJECTION_KEY,
    }

    async def scenario() -> None:
        shared_snapshot = await _snapshot_shared_rows(shared_keys)
        try:
            async with AsyncSessionLocal() as db:
                db.add(
                    User(
                        username=username,
                        password_hash=hash_password(PASSWORD),
                        role="teacher",
                        status="active",
                    )
                )
                await db.flush()
                db.add(
                    QuestionBank(
                        id=bank_id,
                        owner_id=username,
                        name="拒绝批次",
                        subject="PMP",
                    )
                )
                await db.commit()
            before = await _snapshot_shared_rows(shared_keys)

            raw_question = question_payload(question_id)
            raw_question["correctAnswer"] = ""
            base = request_payload(
                key=f"rejected-batch-{suffix}",
                bank_id=bank_id,
                question=raw_question,
            ).model_dump(by_alias=True)
            base["principles"]["items"][0]["id"] = principle_id
            base["synthesisPresets"]["items"][0].update(
                {"id": preset_id, "principleId": principle_id}
            )
            request = ContentPrepBatchRequest.model_validate(base)

            async with AsyncSessionLocal() as db:
                actor = await db.get(User, username)
                assert actor is not None
                with pytest.raises(ContentPrepOperationError) as rejected:
                    await upload_bundle(db, actor, request)
                assert rejected.value.code == "QUESTION_VALIDATION_FAILED"

            assert await _snapshot_shared_rows(shared_keys) == before
            async with AsyncSessionLocal() as db:
                assert await db.get(Principle, principle_id) is None
                assert await db.get(SynthesisPreset, preset_id) is None
        finally:
            async with AsyncSessionLocal() as db:
                await db.execute(
                    delete(QuestionUploadBatch).where(
                        QuestionUploadBatch.actor_username == username
                    )
                )
                await db.execute(
                    delete(QuestionAuditLog).where(QuestionAuditLog.bank_id == bank_id)
                )
                await db.execute(delete(Question).where(Question.id == question_id))
                await db.execute(delete(QuestionBank).where(QuestionBank.id == bank_id))
                await db.execute(delete(PaperReleaseQuestion).where(PaperReleaseQuestion.release_id.in_(select(PaperRelease.id).where(PaperRelease.publisher_id == username))))
                await db.execute(delete(PaperRelease).where(PaperRelease.publisher_id == username))
                await db.execute(delete(User).where(User.username == username))
                await db.commit()
            await _restore_shared_rows(shared_keys, shared_snapshot)

    asyncio.run(scenario())


async def _snapshot_principle_relations() -> tuple[dict[str, dict], dict[str, dict]]:
    async with AsyncSessionLocal() as db:
        principles = (await db.execute(select(Principle))).scalars().all()
        presets = (await db.execute(select(SynthesisPreset))).scalars().all()
        return (
            {
                row.id: {
                    "name": row.name,
                    "status": row.status,
                    "confusable_principle_ids": list(row.confusable_principle_ids or []),
                    "revision": row.revision,
                    "created_by": row.created_by,
                    "updated_by": row.updated_by,
                    "created_at": row.created_at,
                    "updated_at": row.updated_at,
                }
                for row in principles
            },
            {
                row.id: {
                    "principle_id": row.principle_id,
                    "title": row.title,
                    "content": row.content,
                    "status": row.status,
                    "business_version": row.business_version,
                    "revision": row.revision,
                    "created_by": row.created_by,
                    "updated_by": row.updated_by,
                    "created_at": row.created_at,
                    "updated_at": row.updated_at,
                }
                for row in presets
            },
        )


async def _restore_principle_relations(
    principle_snapshot: dict[str, dict],
    preset_snapshot: dict[str, dict],
    *,
    added_principle_ids: set[str],
    added_preset_ids: set[str],
) -> None:
    async with AsyncSessionLocal() as db:
        await db.execute(
            delete(SynthesisPreset).where(SynthesisPreset.id.in_(added_preset_ids))
        )
        await db.execute(delete(Principle).where(Principle.id.in_(added_principle_ids)))
        for row_id, values in principle_snapshot.items():
            row = await db.get(Principle, row_id)
            assert row is not None
            for key, value in values.items():
                setattr(row, key, value)
        for row_id, values in preset_snapshot.items():
            row = await db.get(SynthesisPreset, row_id)
            assert row is not None
            for key, value in values.items():
                setattr(row, key, value)
        await db.commit()


def test_runtime_principle_projection_upserts_present_marks_missing_inactive_and_bumps_once() -> None:
    """Catch cutover rejection, hard deletion, or one revision per projection key."""

    suffix = uuid4().hex[:10]
    username = f"runtime-projection-{suffix}"
    present_principle = f"principle-runtime-present-{suffix}"
    missing_principle = f"principle-runtime-missing-{suffix}"
    present_preset = f"preset-runtime-present-{suffix}"
    missing_preset = f"preset-runtime-missing-{suffix}"
    shared_keys = {
        revision_service.REVISION_KEY,
        PRINCIPLE_PROJECTION_KEY,
        PRESET_PROJECTION_KEY,
        "kg_teacher_shared_runtime_promotion_v1",
    }

    async def seed() -> tuple[dict[str, dict], dict[str, dict], dict[str, dict]]:
        shared_snapshot = await _snapshot_shared_rows(shared_keys)
        relation_snapshot = await _snapshot_principle_relations()
        async with AsyncSessionLocal() as db:
            db.add(
                User(
                    username=username,
                    password_hash=hash_password(PASSWORD),
                    role="teacher",
                    status="active",
                )
            )
            await db.flush()
            db.add_all(
                [
                    Principle(
                        id=present_principle,
                        name="更新前原则",
                        status="active",
                        confusable_principle_ids=[],
                        created_by=username,
                        updated_by=username,
                    ),
                    Principle(
                        id=missing_principle,
                        name="应停用原则",
                        status="active",
                        confusable_principle_ids=[],
                        created_by=username,
                        updated_by=username,
                    ),
                ]
            )
            await db.flush()
            db.add_all(
                [
                    SynthesisPreset(
                        id=present_preset,
                        principle_id=present_principle,
                        title="更新前归纳",
                        content="旧内容",
                        status="active",
                        business_version=1,
                        created_by=username,
                        updated_by=username,
                    ),
                    SynthesisPreset(
                        id=missing_preset,
                        principle_id=missing_principle,
                        title="应停用归纳",
                        content="旧内容",
                        status="active",
                        business_version=1,
                        created_by=username,
                        updated_by=username,
                    ),
                ]
            )
            if await db.get(SharedRuntimeState, "kg_teacher_shared_runtime_promotion_v1") is None:
                db.add(
                    SharedRuntimeState(
                        key="kg_teacher_shared_runtime_promotion_v1",
                        value=json.dumps({"schemaVersion": 1, "status": "complete"}),
                        updated_by="pytest",
                    )
                )
            await db.commit()
        return shared_snapshot, relation_snapshot[0], relation_snapshot[1]

    async def cleanup(
        shared_snapshot: dict[str, dict],
        principle_snapshot: dict[str, dict],
        preset_snapshot: dict[str, dict],
    ) -> None:
        async with AsyncSessionLocal() as db:
            await db.execute(delete(RuntimeState).where(RuntimeState.owner_id == username))
            await db.execute(delete(PaperRelease).where(PaperRelease.publisher_id == username))
            await db.execute(delete(User).where(User.username == username))
            await db.commit()
        await _restore_principle_relations(
            principle_snapshot,
            preset_snapshot,
            added_principle_ids={present_principle, missing_principle},
            added_preset_ids={present_preset, missing_preset},
        )
        await _restore_shared_rows(shared_keys, shared_snapshot)

    shared_snapshot, principle_snapshot, preset_snapshot = asyncio.run(seed())
    try:
        with TestClient(app) as client:
            assert client.post(
                "/api/v1/auth/login",
                json={"username": username, "password": PASSWORD},
            ).status_code == 200
            state = client.get("/api/v1/runtime/state")
            assert state.status_code == 200, state.text
            before = state.json()["contentRevision"]
            principle_value = json.dumps(
                {
                    "schemaVersion": 1,
                    "items": [
                        {
                            "id": present_principle,
                            "name": "更新后原则",
                            "status": "active",
                            "confusablePrincipleIds": [missing_principle],
                        }
                    ],
                    "updatedAt": 1,
                },
                ensure_ascii=False,
            )
            preset_value = json.dumps(
                {
                    "schemaVersion": 1,
                    "items": [
                        {
                            "id": present_preset,
                            "principleId": present_principle,
                            "title": "更新后归纳",
                            "content": "新内容",
                            "status": "active",
                            "version": 2,
                        }
                    ],
                    "updatedAt": 1,
                },
                ensure_ascii=False,
            )
            response = client.put(
                "/api/v1/runtime/state",
                json={
                    "page": "question-bank.html",
                    "namespace": "questions",
                    "operation": "setItem",
                    "key": PRESET_PROJECTION_KEY,
                    "value": preset_value,
                    "storage": {},
                    "snapshotMode": "merge",
                    "mutations": [
                        {
                            "operation": "setItem",
                            "key": PRINCIPLE_PROJECTION_KEY,
                            "value": principle_value,
                        },
                        {
                            "operation": "setItem",
                            "key": PRESET_PROJECTION_KEY,
                            "value": preset_value,
                        },
                    ],
                    "requestId": f"runtime-projection-{suffix}",
                    "revision": state.json()["revision"],
                    "contentRevision": before,
                },
            )
        assert response.status_code == 200, response.text
        assert response.json()["contentRevision"] == before + 1

        async def verify() -> None:
            async with AsyncSessionLocal() as db:
                current = await revision_service.current(db)
                present = await db.get(Principle, present_principle)
                missing = await db.get(Principle, missing_principle)
                present_card = await db.get(SynthesisPreset, present_preset)
                missing_card = await db.get(SynthesisPreset, missing_preset)
                assert present is not None and present.name == "更新后原则"
                assert present.confusable_principle_ids == [missing_principle]
                assert missing is not None and missing.status == "inactive"
                assert present_card is not None and present_card.title == "更新后归纳"
                assert present_card.content == "新内容"
                assert present_card.business_version == 2
                assert missing_card is not None and missing_card.status == "inactive"
                assert current["revision"] == before + 1
                assert {
                    (item["entityType"], item["entityId"], item["action"])
                    for item in current["changes"]
                } >= {
                    ("principle", present_principle, "updated"),
                    ("principle", missing_principle, "inactivated"),
                    ("synthesisPreset", present_preset, "updated"),
                    ("synthesisPreset", missing_preset, "inactivated"),
                }

        asyncio.run(verify())
    finally:
        asyncio.run(cleanup(shared_snapshot, principle_snapshot, preset_snapshot))


@pytest.mark.parametrize(
    ("key", "item"),
    [
        (PRINCIPLE_PROJECTION_KEY, {"id": "p" * 129, "name": "原则", "confusablePrincipleIds": []}),
        (PRINCIPLE_PROJECTION_KEY, {"id": "p-1", "name": "n" * 301, "confusablePrincipleIds": []}),
        (PRINCIPLE_PROJECTION_KEY, {"id": "p-1", "name": "原则", "confusablePrincipleIds": "p-2"}),
        (PRINCIPLE_PROJECTION_KEY, {"id": "p-1", "name": "原则", "confusablePrincipleIds": ["x" * 129]}),
        (PRESET_PROJECTION_KEY, {"id": "preset-1", "principleId": "p" * 129, "title": "归纳", "version": 1}),
        (PRESET_PROJECTION_KEY, {"id": "preset-1", "principleId": "missing", "title": "t" * 501, "version": 1}),
        (PRESET_PROJECTION_KEY, {"id": "preset-1", "principleId": "missing", "title": "归纳", "version": True}),
        (PRESET_PROJECTION_KEY, {"id": "preset-1", "principleId": "missing", "title": "归纳", "version": "2"}),
        (PRESET_PROJECTION_KEY, {"id": "preset-1", "principleId": "missing", "title": "归纳", "version": 0}),
        (PRESET_PROJECTION_KEY, {"id": "preset-1", "principleId": "missing", "title": "归纳", "version": 2147483648}),
    ],
)
def test_runtime_projection_rejects_invalid_bounds_before_revision_lock(
    key: str,
    item: dict,
    monkeypatch,
) -> None:
    lock_calls = 0
    original_acquire = revision_service.acquire_lock

    async def counted_acquire(db) -> None:
        nonlocal lock_calls
        lock_calls += 1
        await original_acquire(db)

    with TestClient(app) as client:
        assert client.post(
            "/api/v1/auth/login",
            json={"username": "admin", "password": "jbgsnmm~123"},
        ).status_code == 200
        state = client.get("/api/v1/runtime/state").json()
        monkeypatch.setattr(revision_service, "acquire_lock", counted_acquire)
        value = json.dumps({"schemaVersion": 1, "items": [item]})
        response = client.put(
            "/api/v1/runtime/state",
            json={
                "page": "question-bank.html",
                "namespace": "questions",
                "operation": "setItem",
                "key": key,
                "value": value,
                "storage": {},
                "mutations": [{"operation": "setItem", "key": key, "value": value}],
                "requestId": f"runtime-invalid-{uuid4().hex}",
                "revision": state["revision"],
                "contentRevision": state["contentRevision"],
            },
        )

    assert response.status_code == 422, response.text
    assert lock_calls == 0


def test_runtime_projection_rejects_large_item_count_before_revision_lock(
    monkeypatch,
) -> None:
    lock_calls = 0
    original_acquire = revision_service.acquire_lock

    async def counted_acquire(db) -> None:
        nonlocal lock_calls
        lock_calls += 1
        await original_acquire(db)

    with TestClient(app) as client:
        assert client.post(
            "/api/v1/auth/login",
            json={"username": "admin", "password": "jbgsnmm~123"},
        ).status_code == 200
        state = client.get("/api/v1/runtime/state").json()
        monkeypatch.setattr(revision_service, "acquire_lock", counted_acquire)
        value = json.dumps(
            {
                "schemaVersion": 1,
                "items": [
                    {"id": f"p-{index}", "name": "原则", "confusablePrincipleIds": []}
                    for index in range(501)
                ],
            }
        )
        response = client.put(
            "/api/v1/runtime/state",
            json={
                "page": "question-bank.html",
                "namespace": "questions",
                "operation": "setItem",
                "key": PRINCIPLE_PROJECTION_KEY,
                "value": value,
                "storage": {},
                "mutations": [
                    {"operation": "setItem", "key": PRINCIPLE_PROJECTION_KEY, "value": value}
                ],
                "requestId": f"runtime-large-{uuid4().hex}",
                "revision": state["revision"],
                "contentRevision": state["contentRevision"],
            },
        )

    assert response.status_code == 422, response.text
    assert lock_calls == 0


@pytest.mark.parametrize(
    "key",
    [PRINCIPLE_PROJECTION_KEY, PRESET_PROJECTION_KEY],
)
def test_runtime_projection_rejects_content_prep_omission_sentinel(
    key: str,
    monkeypatch,
) -> None:
    lock_calls = 0
    original_acquire = revision_service.acquire_lock

    async def counted_acquire(db) -> None:
        nonlocal lock_calls
        lock_calls += 1
        await original_acquire(db)

    with TestClient(app) as client:
        assert client.post(
            "/api/v1/auth/login",
            json={"username": "admin", "password": "jbgsnmm~123"},
        ).status_code == 200
        state = client.get("/api/v1/runtime/state").json()
        monkeypatch.setattr(revision_service, "acquire_lock", counted_acquire)
        response = client.put(
            "/api/v1/runtime/state",
            json={
                "page": "question-bank.html",
                "namespace": "questions",
                "operation": "setItem",
                "key": key,
                "value": "{}",
                "storage": {},
                "mutations": [{"operation": "setItem", "key": key, "value": "{}"}],
                "requestId": f"runtime-omission-sentinel-{uuid4().hex}",
                "revision": state["revision"],
                "contentRevision": state["contentRevision"],
            },
        )

    assert response.status_code == 422, response.text
    assert lock_calls == 0


def test_runtime_preset_projection_rejects_missing_principle_as_422() -> None:
    with TestClient(app) as client:
        assert client.post(
            "/api/v1/auth/login",
            json={"username": "admin", "password": "jbgsnmm~123"},
        ).status_code == 200
        state = client.get("/api/v1/runtime/state").json()
        value = json.dumps(
            {
                "schemaVersion": 1,
                "items": [
                    {
                        "id": f"missing-fk-preset-{uuid4().hex}",
                        "principleId": f"missing-principle-{uuid4().hex}",
                        "title": "归纳",
                        "version": 1,
                    }
                ],
            }
        )
        response = client.put(
            "/api/v1/runtime/state",
            json={
                "page": "question-bank.html",
                "namespace": "questions",
                "operation": "setItem",
                "key": PRESET_PROJECTION_KEY,
                "value": value,
                "storage": {},
                "mutations": [
                    {"operation": "setItem", "key": PRESET_PROJECTION_KEY, "value": value}
                ],
                "requestId": f"runtime-missing-fk-{uuid4().hex}",
                "revision": state["revision"],
                "contentRevision": state["contentRevision"],
            },
        )

    assert response.status_code == 422, response.text


@pytest.mark.parametrize("invalid_revision", [True, "1"])
def test_runtime_content_revision_is_a_strict_integer(invalid_revision) -> None:
    with TestClient(app) as client:
        assert client.post(
            "/api/v1/auth/login",
            json={"username": "admin", "password": "jbgsnmm~123"},
        ).status_code == 200
        state = client.get("/api/v1/runtime/state").json()
        response = client.put(
            "/api/v1/runtime/state",
            json={
                "page": "question-bank.html",
                "namespace": "questions",
                "operation": "setItem",
                "key": "kg_question_language_mode_v1",
                "value": "zh",
                "storage": {},
                "requestId": f"strict-content-revision-{uuid4().hex}",
                "revision": state["revision"],
                "contentRevision": invalid_revision,
            },
        )

    assert response.status_code == 422, response.text


@pytest.mark.parametrize(
    "keys",
    [
        ("kg_course_config_drafts_v1", "kg_course_config_drafts_v1"),
        ("kg_course_config_drafts_v1", "kg_assessment_papers_v1"),
    ],
    ids=["same-key", "different-keys"],
)
def test_teaching_shared_runtime_cas_allows_exactly_one_writer(
    keys: tuple[str, str],
    monkeypatch,
) -> None:
    """Catch whole-value lost updates from two managers sharing one old revision."""

    suffix = uuid4().hex[:10]
    usernames = [f"runtime-cas-a-{suffix}", f"runtime-cas-b-{suffix}"]
    marker_key = "kg_teacher_shared_runtime_promotion_v1"
    shared_keys = {revision_service.REVISION_KEY, marker_key, *keys}

    async def seed() -> dict[str, dict]:
        snapshot = await _snapshot_shared_rows(shared_keys)
        async with AsyncSessionLocal() as db:
            db.add_all(
                [
                    User(
                        username=username,
                        password_hash=hash_password(PASSWORD),
                        role="teacher",
                        status="active",
                    )
                    for username in usernames
                ]
            )
            if await db.get(SharedRuntimeState, marker_key) is None:
                db.add(
                    SharedRuntimeState(
                        key=marker_key,
                        value=json.dumps({"schemaVersion": 1, "status": "complete"}),
                        updated_by="pytest",
                    )
                )
            await db.commit()
        return snapshot

    async def cleanup(snapshot: dict[str, dict]) -> None:
        async with AsyncSessionLocal() as db:
            await db.execute(
                delete(RuntimeState).where(RuntimeState.owner_id.in_(usernames))
            )
            await db.execute(delete(User).where(User.username.in_(usernames)))
            await db.commit()
        await _restore_shared_rows(shared_keys, snapshot)

    snapshot = asyncio.run(seed())
    try:
        with TestClient(app) as first, TestClient(app) as second:
            clients = [first, second]
            states = []
            for client, username in zip(clients, usernames, strict=True):
                assert client.post(
                    "/api/v1/auth/login",
                    json={"username": username, "password": PASSWORD},
                ).status_code == 200
                state = client.get("/api/v1/runtime/state")
                assert state.status_code == 200, state.text
                states.append(state.json())
            assert states[0]["contentRevision"] == states[1]["contentRevision"]
            before = states[0]["contentRevision"]
            values = [
                json.dumps([{"id": f"cas-{suffix}-a"}]),
                json.dumps([{"id": f"cas-{suffix}-b"}]),
            ]
            bodies = [
                {
                    "page": "question-bank.html",
                    "namespace": "questions",
                    "operation": "setItem",
                    "key": key,
                    "value": value,
                    "storage": {key: value},
                    "snapshotMode": "merge",
                    "mutations": [
                        {"operation": "setItem", "key": key, "value": value}
                    ],
                    "requestId": f"runtime-cas-{suffix}-{index}",
                    "revision": states[index]["revision"],
                    "contentRevision": before,
                }
                for index, (key, value) in enumerate(zip(keys, values, strict=True))
            ]
            barrier = Barrier(2)
            counter_lock = Lock()
            acquire_calls = 0
            original_acquire = revision_service.acquire_lock

            async def gated_acquire(db) -> None:
                nonlocal acquire_calls
                with counter_lock:
                    acquire_calls += 1
                    wait_here = acquire_calls <= 2
                if wait_here:
                    assert await asyncio.to_thread(barrier.wait, 10) >= 0
                await original_acquire(db)

            monkeypatch.setattr(revision_service, "acquire_lock", gated_acquire)

            def write(index: int):
                return clients[index].put("/api/v1/runtime/state", json=bodies[index])

            with ThreadPoolExecutor(max_workers=2) as executor:
                responses = list(executor.map(write, range(2)))

        assert sorted(response.status_code for response in responses) == [200, 409]
        conflict = next(response for response in responses if response.status_code == 409)
        assert conflict.json()["detail"] == {
            "code": "CONTENT_REVISION_CONFLICT",
            "message": "教学内容已更新，请重新加载后重试",
            "currentContentRevision": before + 1,
        }

        async def verify() -> None:
            async with AsyncSessionLocal() as db:
                current = await revision_service.current(db)
                assert current["revision"] == before + 1
                winner = responses.index(
                    next(response for response in responses if response.status_code == 200)
                )
                assert current["changes"] == [
                    {
                        "entityType": "runtimeShared",
                        "entityId": keys[winner],
                        "action": "updated",
                    }
                ]
                winner_row = await db.get(SharedRuntimeState, keys[winner])
                assert winner_row is not None and winner_row.value == values[winner]
                if keys[0] != keys[1]:
                    loser = 1 - winner
                    loser_row = await db.get(SharedRuntimeState, keys[loser])
                    previous = snapshot.get(keys[loser])
                    assert (loser_row.value if loser_row else None) == (
                        previous["value"] if previous else None
                    )

        asyncio.run(verify())
    finally:
        asyncio.run(cleanup(snapshot))


def test_runtime_request_id_replay_skips_content_cas_and_second_bump() -> None:
    """Catch a successful retry being rejected or publishing twice."""

    suffix = uuid4().hex[:10]
    username = f"runtime-replay-{suffix}"
    key = "kg_course_config_drafts_v1"
    marker_key = "kg_teacher_shared_runtime_promotion_v1"
    shared_keys = {revision_service.REVISION_KEY, marker_key, key}

    async def seed() -> dict[str, dict]:
        snapshot = await _snapshot_shared_rows(shared_keys)
        async with AsyncSessionLocal() as db:
            db.add(
                User(
                    username=username,
                    password_hash=hash_password(PASSWORD),
                    role="teacher",
                    status="active",
                )
            )
            if await db.get(SharedRuntimeState, marker_key) is None:
                db.add(
                    SharedRuntimeState(
                        key=marker_key,
                        value=json.dumps({"schemaVersion": 1, "status": "complete"}),
                        updated_by="pytest",
                    )
                )
            await db.commit()
        return snapshot

    async def cleanup(snapshot: dict[str, dict]) -> None:
        async with AsyncSessionLocal() as db:
            await db.execute(delete(RuntimeState).where(RuntimeState.owner_id == username))
            await db.execute(delete(PaperRelease).where(PaperRelease.publisher_id == username))
            await db.execute(delete(User).where(User.username == username))
            await db.commit()
        await _restore_shared_rows(shared_keys, snapshot)

    snapshot = asyncio.run(seed())
    try:
        with TestClient(app) as client:
            assert client.post(
                "/api/v1/auth/login",
                json={"username": username, "password": PASSWORD},
            ).status_code == 200
            state = client.get("/api/v1/runtime/state").json()
            value = json.dumps([{"id": f"replay-{suffix}"}])
            body = {
                "page": "question-bank.html",
                "namespace": "questions",
                "operation": "setItem",
                "key": key,
                "value": value,
                "storage": {key: value},
                "snapshotMode": "merge",
                "mutations": [{"operation": "setItem", "key": key, "value": value}],
                "requestId": f"runtime-replay-{suffix}",
                "revision": state["revision"],
                "contentRevision": state["contentRevision"],
            }
            first = client.put("/api/v1/runtime/state", json=body)
            assert first.status_code == 200, first.text
            retry = dict(body)
            retry.pop("contentRevision")
            second = client.put("/api/v1/runtime/state", json=retry)
        assert second.status_code == 200, second.text
        assert second.json()["contentRevision"] == first.json()["contentRevision"]
        assert first.json()["contentRevision"] == state["contentRevision"] + 1
    finally:
        asyncio.run(cleanup(snapshot))


def test_admin_settings_runtime_write_neither_requires_nor_bumps_content_revision() -> None:
    """Catch classifying non-teaching global settings as teaching content."""

    suffix = uuid4().hex[:10]
    username = f"runtime-admin-{suffix}"
    key = "kg_admin_settings_v1"
    shared_keys = {revision_service.REVISION_KEY, key}

    async def seed() -> dict[str, dict]:
        snapshot = await _snapshot_shared_rows(shared_keys)
        async with AsyncSessionLocal() as db:
            db.add(
                User(
                    username=username,
                    password_hash=hash_password(PASSWORD),
                    role="admin",
                    status="active",
                )
            )
            await db.commit()
        return snapshot

    async def cleanup(snapshot: dict[str, dict]) -> None:
        async with AsyncSessionLocal() as db:
            await db.execute(delete(RuntimeState).where(RuntimeState.owner_id == username))
            await db.execute(delete(PaperRelease).where(PaperRelease.publisher_id == username))
            await db.execute(delete(User).where(User.username == username))
            await db.commit()
        await _restore_shared_rows(shared_keys, snapshot)

    snapshot = asyncio.run(seed())
    try:
        with TestClient(app) as client:
            assert client.post(
                "/api/v1/auth/login",
                json={"username": username, "password": PASSWORD},
            ).status_code == 200
            state = client.get("/api/v1/runtime/state").json()
            value = json.dumps({"theme": f"admin-{suffix}"})
            response = client.put(
                "/api/v1/runtime/state",
                json={
                    "page": "admin-settings.html",
                    "namespace": "admin",
                    "operation": "setItem",
                    "key": key,
                    "value": value,
                    "storage": {key: value},
                    "snapshotMode": "merge",
                    "mutations": [
                        {"operation": "setItem", "key": key, "value": value}
                    ],
                    "requestId": f"runtime-admin-{suffix}",
                    "revision": state["revision"],
                },
            )
        assert response.status_code == 200, response.text
        assert response.json()["contentRevision"] == state["contentRevision"]
    finally:
        asyncio.run(cleanup(snapshot))


def test_each_bank_question_and_paper_mutation_bumps_exactly_once() -> None:
    """Catch any relational teaching mutation omitted from the shared revision log."""

    suffix = uuid4().hex[:10]
    username = f"revision-crud-{suffix}"
    shared_keys = {revision_service.REVISION_KEY}
    created_ids: dict[str, str] = {}

    async def scenario() -> None:
        snapshot = await _snapshot_shared_rows(shared_keys)
        try:
            async with AsyncSessionLocal() as db:
                db.add(
                    User(
                        username=username,
                        password_hash=hash_password(PASSWORD),
                        role="teacher",
                        status="active",
                    )
                )
                await db.commit()
                actor = await db.get(User, username)
                assert actor is not None
                previous = int((await revision_service.current(db))["revision"])

                async def assert_bump(
                    entity_type: str,
                    entity_id: str,
                    action: str,
                ) -> None:
                    nonlocal previous
                    current = await revision_service.current(db)
                    assert current["revision"] == previous + 1
                    assert current["changes"] == [
                        {
                            "entityType": entity_type,
                            "entityId": entity_id,
                            "action": action,
                        }
                    ]
                    previous += 1

                bank = await question_service.create_bank(
                    db,
                    actor,
                    {"name": "revision crud bank", "subject": "PMP"},
                )
                created_ids["bank"] = bank.id
                await assert_bump("bank", bank.id, "created")

                bank = await question_service.update_bank(
                    db,
                    actor,
                    bank.id,
                    {"description": "updated"},
                )
                assert bank is not None
                await assert_bump("bank", bank.id, "updated")

                question = await question_service.create_question(
                    db,
                    actor,
                    bank.id,
                        {
                            "title": "revision question",
                            "subject": "PMP",
                            "domain": "沟通",
                            "metadata": {
                                "subjectFacets": [
                                    {
                                        "dimensionId": "exam-domain",
                                        "valueId": "process",
                                    }
                                ]
                            },
                        },
                )
                assert question is not None
                created_ids["question"] = question.id
                await assert_bump("question", question.id, "created")

                question = await question_service.update_question(
                    db,
                    actor,
                    question.id,
                    {"title": "revision question updated"},
                )
                assert question is not None
                await assert_bump("question", question.id, "updated")

                paper = await question_service.create_paper(
                    db,
                    actor,
                    {"name": "revision paper", "subject": "PMP"},
                )
                created_ids["paper"] = paper.id
                await assert_bump("paper", paper.id, "created")

                paper = await question_service.update_paper(
                    db,
                    actor,
                    paper.id,
                    {"name": "revision paper updated", "revision": paper.revision},
                )
                assert paper is not None
                await assert_bump("paper", paper.id, "updated")

                picked = await question_service.compose_paper(
                    db,
                    actor,
                    paper.id,
                    [bank.id],
                    {"沟通": 1},
                    paper.revision,
                )
                assert picked == 1
                await assert_bump("paper", paper.id, "composed")
                await db.refresh(paper)

                paper = await question_service.set_published(
                    db,
                    actor,
                    paper.id,
                    True,
                    paper.revision,
                )
                assert paper is not None
                await assert_bump("paper", paper.id, "published")

                paper = await question_service.set_published(
                    db,
                    actor,
                    paper.id,
                    False,
                    paper.revision,
                )
                assert paper is not None
                await assert_bump("paper", paper.id, "unpublished")

                deletion = await question_service.delete_paper(
                    db,
                    actor,
                    paper.id,
                    paper.revision,
                    "revision test",
                )
                assert deletion is not None
                await assert_bump("paper", paper.id, "deleted")

                release_ids = select(PaperRelease.id).where(
                    PaperRelease.paper_id == paper.id
                )
                await db.execute(
                    delete(PaperReleaseQuestion).where(
                        PaperReleaseQuestion.release_id.in_(release_ids)
                    )
                )
                await db.execute(
                    delete(PaperRelease).where(PaperRelease.paper_id == paper.id)
                )
                await db.execute(
                    delete(PaperQuestion).where(PaperQuestion.paper_id == paper.id)
                )
                await db.commit()
                assert await question_service.delete_question(db, actor, question.id)
                await assert_bump("question", question.id, "deleted")

                second = await question_service.create_question(
                    db,
                    actor,
                    bank.id,
                    {"title": "deleted with bank", "subject": "PMP"},
                )
                assert second is not None
                created_ids["second_question"] = second.id
                await assert_bump("question", second.id, "created")
                assert await question_service.delete_bank(db, actor, bank.id)
                current = await revision_service.current(db)
                assert current["revision"] == previous + 1
                assert current["changes"] == [
                    {
                        "entityType": "question",
                        "entityId": second.id,
                        "action": "deleted",
                    },
                    {"entityType": "bank", "entityId": bank.id, "action": "deleted"},
                ]
        finally:
            async with AsyncSessionLocal() as db:
                paper_id = created_ids.get("paper")
                if paper_id:
                    await db.execute(
                        delete(PaperQuestion).where(PaperQuestion.paper_id == paper_id)
                    )
                    await db.execute(delete(ExamPaper).where(ExamPaper.id == paper_id))
                bank_id = created_ids.get("bank")
                if bank_id:
                    await db.execute(
                        delete(QuestionUploadBatch).where(
                            QuestionUploadBatch.bank_id == bank_id
                        )
                    )
                    await db.execute(delete(Question).where(Question.bank_id == bank_id))
                    await db.execute(delete(QuestionBank).where(QuestionBank.id == bank_id))
                await db.execute(delete(PaperReleaseQuestion).where(PaperReleaseQuestion.release_id.in_(select(PaperRelease.id).where(PaperRelease.publisher_id == username))))
                await db.execute(delete(PaperRelease).where(PaperRelease.publisher_id == username))
                await db.execute(delete(User).where(User.username == username))
                await db.commit()
            await _restore_shared_rows(shared_keys, snapshot)

    asyncio.run(scenario())


def test_content_prep_bank_creation_bumps_once() -> None:
    """Catch the dedicated Content Prep bank path bypassing teaching revision."""

    suffix = uuid4().hex[:10]
    username = f"revision-prep-bank-{suffix}"
    snapshot = asyncio.run(_snapshot_shared_rows({revision_service.REVISION_KEY}))
    bank_id = ""

    async def scenario() -> None:
        nonlocal bank_id
        async with AsyncSessionLocal() as db:
            db.add(
                User(
                    username=username,
                    password_hash=hash_password(PASSWORD),
                    role="teacher",
                    status="active",
                )
            )
            await db.commit()
            actor = await db.get(User, username)
            assert actor is not None
            before = int((await revision_service.current(db))["revision"])
            bank = await create_content_prep_bank(
                db,
                actor,
                {
                    "creatorId": "creator_001",
                    "name": "Content Prep revision bank",
                    "subject": "PMP",
                },
            )
            bank_id = bank.id
            current = await revision_service.current(db)
            assert current["revision"] == before + 1
            assert current["changes"] == [
                {"entityType": "bank", "entityId": bank.id, "action": "created"}
            ]

    async def cleanup() -> None:
        async with AsyncSessionLocal() as db:
            if bank_id:
                await db.execute(delete(QuestionBank).where(QuestionBank.id == bank_id))
            await db.execute(delete(PaperRelease).where(PaperRelease.publisher_id == username))
            await db.execute(delete(User).where(User.username == username))
            await db.commit()
        await _restore_shared_rows({revision_service.REVISION_KEY}, snapshot)

    try:
        asyncio.run(scenario())
    finally:
        asyncio.run(cleanup())
