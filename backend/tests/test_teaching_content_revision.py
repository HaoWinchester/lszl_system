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
from app.models.paper_release import PaperRelease, PaperReleaseQuestion
from app.models.question import ExamPaper, PaperQuestion, Question, QuestionBank
from app.models.shared_runtime_state import SharedRuntimeState
from app.models.teaching_content import (
    ContentSubject,
    RecallAssociationLibrary,
    TeachingContentAudit,
    TeachingContentRevision,
)
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
from tests.teaching_content_revision_support import (
    restore_teaching_content_revision,
    restore_teaching_content_revision_state as _restore_revision_row,
    snapshot_teaching_content_revision,
    snapshot_teaching_content_revision_state as _snapshot_revision_row,
)


PASSWORD = "revision-pass"
PRINCIPLE_PROJECTION_KEY = "kg_principle_repository_v1"
PRESET_PROJECTION_KEY = "kg_synthesis_preset_repository_v1"
RELATIONAL_REVISION_SNAPSHOT_KEY = "__relational_teaching_content_revision__"


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
            content_revision = client.get(
                "/api/v1/content-prep/principles"
            ).json()["contentRevision"]
            drafted = client.post(
                "/api/v1/content-prep/principles/status",
                json={"ids": [principle_id], "presetStatus": "draft", "contentRevision": content_revision},
            )
            assert drafted.status_code == 200
            assert drafted.json()["updatedPresetIds"] == [preset_id]
            content_revision = drafted.json()["contentRevision"]
            asyncio.run(assert_preset_draft())
            blocked = client.post(
                "/api/v1/content-prep/principles/archive",
                json={"ids": [principle_id], "contentRevision": content_revision},
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
                json={"ids": [principle_id], "contentRevision": content_revision},
            )
            assert blocked_delete.status_code == 409
            assert blocked_delete.json()["detail"] == blocked.json()["detail"]
            asyncio.run(remove_question())
            archived = client.post(
                "/api/v1/content-prep/principles/archive",
                json={"ids": [principle_id], "contentRevision": content_revision},
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
        RELATIONAL_REVISION_SNAPSHOT_KEY,
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
            await db.commit()
        return shared_snapshot

    async def verify_deleted() -> None:
        async with AsyncSessionLocal() as db:
            assert await db.get(Principle, principle_id) is None
            assert await db.get(SynthesisPreset, preset_id) is None

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
            content_revision = client.get(
                "/api/v1/content-prep/principles"
            ).json()["contentRevision"]
            response = client.post(
                "/api/v1/content-prep/principles/delete",
                json={"ids": [principle_id], "contentRevision": content_revision},
            )
        assert response.status_code == 200, response.text
        assert response.json()["deletedIds"] == [principle_id]
        asyncio.run(verify_deleted())
    finally:
        asyncio.run(cleanup(snapshot))


def test_bulk_principle_mutations_reject_stale_content_revision_atomically() -> None:
    """Archive/delete/import/status must share the optimistic revision contract."""

    suffix = uuid4().hex[:10]
    username = f"teacher-bulk-stale-{suffix}"
    principle_ids = [f"principle-bulk-stale-{index}-{suffix}" for index in range(4)]
    preset_ids = [f"preset-bulk-stale-{index}-{suffix}" for index in range(4)]
    revision_snapshot: dict | None = None

    async def seed() -> None:
        nonlocal revision_snapshot
        async with AsyncSessionLocal() as db:
            revision_snapshot = await snapshot_teaching_content_revision(db)
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
            for index, principle_id in enumerate(principle_ids):
                db.add(
                    Principle(
                        id=principle_id,
                        name=f"并发原则 {index}",
                        status="active",
                        created_by=username,
                        updated_by=username,
                    )
                )
            await db.flush()
            for index, preset_id in enumerate(preset_ids):
                db.add(
                    SynthesisPreset(
                        id=preset_id,
                        principle_id=principle_ids[index],
                        title=f"原则：并发原则 {index}",
                        content=f"并发归纳卡 {index}",
                        status="active",
                        created_by=username,
                        updated_by=username,
                    )
                )
            await db.commit()

    async def advance_revision() -> int:
        async with AsyncSessionLocal() as db:
            bumped = await revision_service.bump(
                db,
                username,
                [{"entityType": "testBarrier", "entityId": suffix, "action": "advanced"}],
            )
            await db.commit()
            return int(bumped["revision"])

    async def relation_state() -> tuple[list[tuple], list[tuple], int]:
        async with AsyncSessionLocal() as db:
            principles = list(
                (
                    await db.execute(
                        select(Principle)
                        .where(Principle.id.in_(principle_ids))
                        .order_by(Principle.id)
                    )
                ).scalars()
            )
            presets = list(
                (
                    await db.execute(
                        select(SynthesisPreset)
                        .where(SynthesisPreset.id.in_(preset_ids))
                        .order_by(SynthesisPreset.id)
                    )
                ).scalars()
            )
            return (
                [(row.id, row.name, row.status, row.revision) for row in principles],
                [(row.id, row.status, row.revision) for row in presets],
                int((await revision_service.current(db))["revision"]),
            )

    async def cleanup() -> None:
        async with AsyncSessionLocal() as db:
            await db.execute(delete(SynthesisPreset).where(SynthesisPreset.id.in_(preset_ids)))
            await db.execute(delete(Principle).where(Principle.id.in_(principle_ids)))
            await db.execute(delete(PaperRelease).where(PaperRelease.publisher_id == username))
            await db.execute(delete(User).where(User.username == username))
            await db.commit()
            await restore_teaching_content_revision(db, revision_snapshot)
            await db.commit()

    asyncio.run(seed())
    try:
        with TestClient(app) as client:
            assert client.post(
                "/api/v1/auth/login",
                json={"username": username, "password": PASSWORD},
            ).status_code == 200
            snapshot = client.get("/api/v1/content-prep/principles")
            assert snapshot.status_code == 200, snapshot.text
            stale_revision = snapshot.json()["contentRevision"]
            bundle = {
                "principleCardBundleVersion": 1,
                "format": "kg-principle-card-bundle-v1",
                "principles": deepcopy(snapshot.json()["principles"]),
                "synthesisPresets": deepcopy(snapshot.json()["synthesisPresets"]),
            }
            for item in bundle["principles"]["items"]:
                if item["id"] == principle_ids[3]:
                    item["name"] = "stale import must not win"
            current_revision = asyncio.run(advance_revision())
            before = asyncio.run(relation_state())
            assert before[2] == current_revision

            requests = [
                ("/api/v1/content-prep/principles/archive", {"ids": [principle_ids[0]]}),
                (
                    "/api/v1/content-prep/principles/status",
                    {"ids": [principle_ids[1]], "presetStatus": "draft"},
                ),
                ("/api/v1/content-prep/principles/delete", {"ids": [principle_ids[2]]}),
                ("/api/v1/content-prep/principles/import", bundle),
            ]
            for path, body in requests:
                response = client.post(
                    path,
                    json={**body, "contentRevision": stale_revision},
                )
                assert response.status_code == 409, (path, response.text)
                assert response.json()["detail"] == {
                    "code": "CONTENT_REVISION_CONFLICT",
                    "message": "服务器内容已更新，请重新载入后再保存",
                    "currentContentRevision": current_revision,
                }
                assert asyncio.run(relation_state()) == before
    finally:
        asyncio.run(cleanup())


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
            payload["contentRevision"] = client.get(
                "/api/v1/content-prep/principles"
            ).json()["contentRevision"]
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
        RELATIONAL_REVISION_SNAPSHOT_KEY,
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

def test_each_bank_question_and_paper_mutation_bumps_exactly_once() -> None:
    """Catch any relational teaching mutation omitted from the shared revision log."""

    suffix = uuid4().hex[:10]
    username = f"revision-crud-{suffix}"
    shared_keys = {RELATIONAL_REVISION_SNAPSHOT_KEY}
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
    snapshot = asyncio.run(
        _snapshot_shared_rows({RELATIONAL_REVISION_SNAPSHOT_KEY})
    )
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
        await _restore_shared_rows({RELATIONAL_REVISION_SNAPSHOT_KEY}, snapshot)

    try:
        asyncio.run(scenario())
    finally:
        asyncio.run(cleanup())


async def _snapshot_shared_rows(keys: set[str]) -> dict[str, dict]:
    async with AsyncSessionLocal() as db:
        runtime_keys = keys - {RELATIONAL_REVISION_SNAPSHOT_KEY}
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
        if RELATIONAL_REVISION_SNAPSHOT_KEY in keys:
            revision = await snapshot_teaching_content_revision(db)
            if revision is not None:
                snapshot[RELATIONAL_REVISION_SNAPSHOT_KEY] = {
                    **revision,
                }
        return snapshot


async def _restore_shared_rows(keys: set[str], snapshot: dict[str, dict]) -> None:
    async with AsyncSessionLocal() as db:
        runtime_keys = keys - {RELATIONAL_REVISION_SNAPSHOT_KEY}
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
                if key != RELATIONAL_REVISION_SNAPSHOT_KEY
            ]
        )
        if RELATIONAL_REVISION_SNAPSHOT_KEY in keys:
            revision = snapshot.get(RELATIONAL_REVISION_SNAPSHOT_KEY)
            await restore_teaching_content_revision(db, revision)
        await db.commit()


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
