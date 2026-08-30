import asyncio
import json
from copy import deepcopy
from uuid import uuid4

from fastapi.testclient import TestClient
from sqlalchemy import delete, select

from app.core.security import hash_password
from app.db.session import AsyncSessionLocal
from app.main import app
from app.models.content_prep import Principle, QuestionTagConfig, QuestionUploadBatch, SynthesisPreset
from app.models.course_management import CourseDraft
from app.models.question import Question, QuestionBank
from app.models.shared_runtime_state import SharedRuntimeState
from app.models.teaching_content import ActivityCollection, ActivityOverride, ActivityTag, ContentSubject, ContentTaxonomy, RecallAssociationLibrary, TaxonomyNode, TeachingContentAudit
from app.models.user import User
from app.services import teaching_content_revision_service, teaching_content_service
from tests.teaching_content_revision_support import (
    restore_teaching_content_revision,
    snapshot_teaching_content_revision,
)


PASSWORD = "shared-prep-pass"
TAXONOMY_KEY = "kg_content_taxonomies_v1"
TAG_KEY = "kg_question_tag_names_v1"
ACTIVITY_KEY = "kg_content_activity_overrides_v1"
RECALL_KEY = "kg_recall_association_library_v1__subject__subject-pmp"
PROJECTION_KEYS = {"kg_principle_repository_v1", "kg_synthesis_preset_repository_v1"}
RETIRED_CATALOG_RUNTIME_KEYS = (
    "kg_content_subjects_v1",
    "kg_content_taxonomies_v1",
    "kg_content_activity_overrides_v1",
    "kg_activity_tags_v1",
    "kg_activity_collections_v1",
)


def test_catalog_snapshot_round_trips_all_five_lifecycle_resources_with_one_revision() -> None:
    suffix = uuid4().hex[:10]
    subject_id = f"subject-catalog-{suffix}"
    taxonomy_id = f"taxonomy-catalog-{suffix}"
    collection_id = f"collection-catalog-{suffix}"
    tag_id = f"tag-catalog-{suffix}"
    activity_id = f"activity-catalog-{suffix}"
    revision_snapshot: dict | None = None

    async def snapshot_revision() -> None:
        nonlocal revision_snapshot
        async with AsyncSessionLocal() as db:
            revision_snapshot = await snapshot_teaching_content_revision(db)

    async def cleanup() -> None:
        async with AsyncSessionLocal() as db:
            await db.execute(delete(ActivityOverride).where(ActivityOverride.activity_id == activity_id))
            await db.execute(delete(ActivityTag).where(ActivityTag.id == tag_id))
            await db.execute(delete(ActivityCollection).where(ActivityCollection.subject_id == subject_id))
            await db.execute(delete(TaxonomyNode).where(TaxonomyNode.taxonomy_id == taxonomy_id))
            await db.execute(delete(ContentTaxonomy).where(ContentTaxonomy.id == taxonomy_id))
            await db.execute(delete(ContentSubject).where(ContentSubject.id == subject_id))
            await db.commit()
            await restore_teaching_content_revision(db, revision_snapshot)
            await db.commit()

    async def write_markers() -> tuple[int, int]:
        async with AsyncSessionLocal() as db:
            override = (
                await db.execute(
                    select(ActivityOverride).where(ActivityOverride.activity_id == activity_id)
                )
            ).scalar_one()
            audits = len(
                list(
                    (
                        await db.scalars(
                            select(TeachingContentAudit).where(
                                TeachingContentAudit.entity_type == "teachingCatalog"
                            )
                        )
                    ).all()
                )
            )
            return override.revision, audits

    asyncio.run(snapshot_revision())
    try:
        with TestClient(app) as client:
            assert client.post(
                "/api/v1/auth/login",
                json={"username": "admin", "password": "jbgsnmm~123"},
            ).status_code == 200
            before = client.get(
                "/api/v1/content-prep/shared-content",
                params={"subjectId": "subject-pmp"},
            ).json()
            body = {
                "subjectId": "subject-pmp",
                "contentRevision": before["contentRevision"],
                "subjects": [
                    *before["subjects"],
                    {
                        "id": subject_id,
                        "code": f"CAT-{suffix}",
                        "name": {"zh": "目录科目", "en": "Catalog"},
                        "status": "active",
                        "sortOrder": 91,
                    },
                ],
                "taxonomies": [
                    *before["taxonomies"],
                    {
                        "id": taxonomy_id,
                        "subjectId": subject_id,
                        "version": 1,
                        "status": "draft",
                        "name": {"zh": "目录知识树"},
                        "nodes": [
                            {
                                "id": "root",
                                "title": {"zh": "根节点"},
                                "parentId": None,
                                "status": "active",
                                "sortOrder": 10,
                            }
                        ],
                    },
                ],
                "activityCollections": [
                    *before["activityCollections"],
                    {
                        "id": collection_id,
                        "subjectId": subject_id,
                        "title": "目录题集",
                        "description": "完整元数据",
                        "type": "collection",
                        "visibility": "shared",
                        "status": "archived",
                        "activityIds": [activity_id],
                        "sortOrder": 7,
                        "authorship": {"createdByUserId": "admin"},
                    },
                ],
                "activityTags": [
                    *before["activityTags"],
                    {
                        "id": tag_id,
                        "name": "红色标签",
                        "subjectId": subject_id,
                        "description": "标签描述",
                        "color": "#f00",
                        "status": "archived",
                        "sortOrder": 3,
                        "authorship": {"createdByUserId": "admin"},
                    },
                ],
                "activityOverrides": [
                    *before["activityOverrides"],
                    {
                        "id": activity_id,
                        "metadata": {
                            "subjectId": subject_id,
                            "collectionId": collection_id,
                            "knowledge": {
                                "taxonomyId": taxonomy_id,
                                "primaryNodeId": "root",
                            },
                        },
                    },
                ],
            }
            saved = client.put("/api/v1/content-prep/shared-content", json=body)
            assert saved.status_code == 200, saved.text
            payload = saved.json()
            assert payload["contentRevision"] == before["contentRevision"] + 1
            assert next(row for row in payload["subjects"] if row["id"] == subject_id)["sortOrder"] == 91
            assert next(row for row in payload["taxonomies"] if row["id"] == taxonomy_id)["nodes"][0]["title"] == {"zh": "根节点"}
            assert next(row for row in payload["activityCollections"] if row["id"] == collection_id)["activityIds"] == [activity_id]
            assert next(row for row in payload["activityTags"] if row["id"] == tag_id)["description"] == "标签描述"
            assert next(row for row in payload["activityOverrides"] if row["id"] == activity_id)["metadata"]["collectionId"] == collection_id

            before_noop = asyncio.run(write_markers())
            identical = client.put(
                "/api/v1/content-prep/shared-content",
                json={
                    "subjectId": subject_id,
                    "contentRevision": payload["contentRevision"],
                    "subjects": payload["subjects"],
                    "taxonomies": payload["taxonomies"],
                    "activityCollections": payload["activityCollections"],
                    "activityTags": payload["activityTags"],
                    "activityOverrides": payload["activityOverrides"],
                },
            )
            assert identical.status_code == 200, identical.text
            assert identical.json()["contentRevision"] == payload["contentRevision"]
            assert asyncio.run(write_markers()) == before_noop

            stale = client.put("/api/v1/content-prep/shared-content", json=body)
            assert stale.status_code == 409, stale.text
            current = client.get(
                "/api/v1/content-prep/shared-content",
                params={"subjectId": subject_id},
            ).json()
            assert current["contentRevision"] == payload["contentRevision"]
            assert len([row for row in current["activityTags"] if row["id"] == tag_id]) == 1
    finally:
        asyncio.run(cleanup())


def test_runtime_cannot_mutate_any_retired_catalog_resource_or_bump_content_revision() -> None:
    previous: dict[str, tuple[str, str] | None] = {}

    async def seed_historical_rows() -> None:
        async with AsyncSessionLocal() as db:
            for key in RETIRED_CATALOG_RUNTIME_KEYS:
                row = await db.get(SharedRuntimeState, key)
                previous[key] = (row.value, row.updated_by) if row else None
                if row is None:
                    db.add(SharedRuntimeState(key=key, value='[{"legacy":true}]', updated_by="pytest"))
                else:
                    row.value, row.updated_by = '[{"legacy":true}]', "pytest"
            await db.commit()

    async def cleanup() -> None:
        async with AsyncSessionLocal() as db:
            for key, value in previous.items():
                row = await db.get(SharedRuntimeState, key)
                if value is None:
                    if row is not None:
                        await db.delete(row)
                elif row is not None:
                    row.value, row.updated_by = value
            await db.commit()

    asyncio.run(seed_historical_rows())
    try:
        with TestClient(app) as client:
            assert client.post("/api/v1/auth/login", json={"username": "admin", "password": "jbgsnmm~123"}).status_code == 200
            before = client.get("/api/v1/content-prep/shared-content", params={"subjectId": "subject-pmp"}).json()
            runtime = client.get("/api/v1/runtime/state").json()
            for key in RETIRED_CATALOG_RUNTIME_KEYS:
                assert key not in runtime["storage"]
            mutations = [
                {"operation": "setItem", "key": key, "value": "[]"}
                for key in RETIRED_CATALOG_RUNTIME_KEYS
            ]
            response = client.put(
                "/api/v1/runtime/state",
                json={
                    "page": "admin-subjects.html",
                    "namespace": "teaching-catalog",
                    "operation": "setItem",
                    "key": RETIRED_CATALOG_RUNTIME_KEYS[0],
                    "value": "[]",
                    "storage": {},
                    "mutations": mutations,
                    "requestId": f"retired-catalog-{uuid4().hex}",
                    "revision": runtime["revision"],
                    "contentRevision": runtime["contentRevision"],
                },
            )
            assert response.status_code == 403, response.text
            after = client.get("/api/v1/content-prep/shared-content", params={"subjectId": "subject-pmp"}).json()
            assert after["contentRevision"] == before["contentRevision"]
            for field in ("subjects", "taxonomies", "activityOverrides", "activityTags", "activityCollections"):
                assert after[field] == before[field]
    finally:
        asyncio.run(cleanup())


def test_catalog_subject_delete_fails_closed_when_relational_course_still_references_it() -> None:
    suffix = uuid4().hex[:10]
    subject_id = f"subject-delete-ref-{suffix}"
    course_id = f"course-delete-ref-{suffix}"
    revision_snapshot: dict | None = None

    async def seed() -> None:
        nonlocal revision_snapshot
        async with AsyncSessionLocal() as db:
            revision_snapshot = await snapshot_teaching_content_revision(db)
            db.add(ContentSubject(id=subject_id, code=f"DEL-{suffix}", name="待删科目", content_metadata={}))
            db.add(CourseDraft(id=course_id, owner_id="admin", name="引用课程", structure={"id": course_id, "subjectId": subject_id}, revision=1, status="draft", created_by="admin", updated_by="admin"))
            await db.commit()

    async def persisted() -> bool:
        async with AsyncSessionLocal() as db:
            return await db.get(ContentSubject, subject_id) is not None

    async def cleanup() -> None:
        async with AsyncSessionLocal() as db:
            await db.execute(delete(CourseDraft).where(CourseDraft.id == course_id))
            await db.execute(delete(ContentSubject).where(ContentSubject.id == subject_id))
            await db.commit()
            await restore_teaching_content_revision(db, revision_snapshot)
            await db.commit()

    asyncio.run(seed())
    try:
        with TestClient(app) as client:
            assert client.post("/api/v1/auth/login", json={"username": "admin", "password": "jbgsnmm~123"}).status_code == 200
            before = client.get("/api/v1/content-prep/shared-content", params={"subjectId": "subject-pmp"}).json()
            response = client.put(
                "/api/v1/content-prep/shared-content",
                json={
                    "subjectId": "subject-pmp",
                    "contentRevision": before["contentRevision"],
                    "subjects": [row for row in before["subjects"] if row["id"] != subject_id],
                },
            )
            assert response.status_code == 422, response.text
            assert "引用" in response.json()["detail"]["message"]
            assert asyncio.run(persisted())
    finally:
        asyncio.run(cleanup())


def test_legacy_catalog_mutation_routes_are_retired_without_side_effects() -> None:
    suffix = uuid4().hex[:10]
    subject_id = f"subject-retired-route-{suffix}"

    async def state() -> tuple[bool, int]:
        async with AsyncSessionLocal() as db:
            return (
                await db.get(ContentSubject, subject_id) is None,
                int((await teaching_content_revision_service.current(db))["revision"]),
            )

    with TestClient(app) as client:
        assert client.post("/api/v1/auth/login", json={"username": "admin", "password": "jbgsnmm~123"}).status_code == 200
        revision = client.get("/api/v1/content-prep/shared-content", params={"subjectId": "subject-pmp"}).json()["contentRevision"]
        requests = [
            client.post("/api/v1/content-prep/subjects", json={"id": subject_id, "code": "RETIRED", "name": "不应创建", "contentRevision": revision}),
            client.post(f"/api/v1/content-prep/taxonomies/taxonomy-{suffix}/release", json={"subjectId": "subject-pmp", "version": 1, "title": "不应发布", "nodes": [], "contentRevision": revision}),
            client.put(f"/api/v1/content-prep/activity-overrides/collection-{suffix}/activity-{suffix}", json={"record": {"title": "不应保存"}, "contentRevision": revision}),
            client.delete(f"/api/v1/content-prep/taxonomies/taxonomy-{suffix}", params={"subjectId": "subject-pmp", "contentRevision": revision}),
            client.delete(f"/api/v1/content-prep/activity-overrides/collection-{suffix}/activity-{suffix}", params={"contentRevision": revision}),
        ]
        for response in requests:
            assert response.status_code == 410, response.text
            assert response.json()["detail"]["code"] == "LEGACY_TEACHING_MUTATION_RETIRED"
        assert asyncio.run(state()) == (True, revision)
    paths = app.openapi()["paths"]
    for path, method in (
        ("/api/v1/content-prep/subjects", "post"),
        ("/api/v1/content-prep/taxonomies/{taxonomy_id}/release", "post"),
        ("/api/v1/content-prep/activity-overrides/{collection_id}/{activity_id}", "put"),
        ("/api/v1/content-prep/taxonomies/{taxonomy_id}", "delete"),
        ("/api/v1/content-prep/activity-overrides/{collection_id}/{activity_id}", "delete"),
    ):
        operation = paths[path][method]
        assert operation["deprecated"] is True
        assert "410" in operation["responses"]
        assert "200" not in operation["responses"]
        assert "201" not in operation["responses"]
    for symbol in (
        "upsert_subject",
        "release_taxonomy",
        "delete_taxonomy",
        "apply_activity_override",
        "delete_activity_override",
    ):
        assert not hasattr(teaching_content_service, symbol)


def test_catalog_rejects_dangling_or_cross_subject_relationships_without_side_effects() -> None:
    suffix = uuid4().hex[:10]
    collection_id = f"collection-invalid-{suffix}"
    tag_id = f"tag-invalid-{suffix}"
    activity_id = f"activity-invalid-{suffix}"
    revision_snapshot: dict | None = None

    async def snapshot_revision() -> None:
        nonlocal revision_snapshot
        async with AsyncSessionLocal() as db:
            revision_snapshot = await snapshot_teaching_content_revision(db)

    async def absent_and_revision() -> tuple[bool, int]:
        async with AsyncSessionLocal() as db:
            absent = all(
                row is None
                for row in (
                    await db.get(ActivityCollection, collection_id),
                    await db.get(ActivityTag, tag_id),
                    (
                        await db.execute(
                            select(ActivityOverride).where(ActivityOverride.activity_id == activity_id)
                        )
                    ).scalar_one_or_none(),
                )
            )
            return absent, int((await teaching_content_revision_service.current(db))["revision"])

    async def cleanup() -> None:
        async with AsyncSessionLocal() as db:
            await db.execute(delete(ActivityOverride).where(ActivityOverride.activity_id == activity_id))
            await db.execute(delete(ActivityTag).where(ActivityTag.id == tag_id))
            await db.execute(delete(ActivityCollection).where(ActivityCollection.id == collection_id))
            await db.commit()
            await restore_teaching_content_revision(db, revision_snapshot)
            await db.commit()

    asyncio.run(snapshot_revision())
    try:
        with TestClient(app) as client:
            assert client.post("/api/v1/auth/login", json={"username": "admin", "password": "jbgsnmm~123"}).status_code == 200
            before = client.get("/api/v1/content-prep/shared-content", params={"subjectId": "subject-pmp"}).json()
            revision = before["contentRevision"]
            invalid_payloads = [
                {
                    "activityCollections": [
                        *before["activityCollections"],
                        {"id": collection_id, "subjectId": "subject-pmp", "title": "悬空活动", "activityIds": [activity_id]},
                    ]
                },
                {
                    "activityTags": [
                        *before["activityTags"],
                        {"id": tag_id, "name": "悬空题集", "subjectId": "subject-pmp", "collectionId": collection_id},
                    ]
                },
                {
                    "activityOverrides": [
                        *before["activityOverrides"],
                        {
                            "id": activity_id,
                            "metadata": {
                                "subjectId": "subject-pmp",
                                "knowledge": {"taxonomyId": "taxonomy-pmp-complete-v1", "primaryNodeId": "missing-node"},
                                "organization": {"tagIds": [tag_id]},
                            },
                        },
                    ]
                },
            ]
            for partial in invalid_payloads:
                response = client.put(
                    "/api/v1/content-prep/shared-content",
                    json={"subjectId": "subject-pmp", "contentRevision": revision, **partial},
                )
                assert response.status_code == 422, response.text
                assert asyncio.run(absent_and_revision()) == (True, revision)
    finally:
        asyncio.run(cleanup())


def test_catalog_cleans_empty_system_namespaces_before_deleting_subject() -> None:
    suffix = uuid4().hex[:10]
    subject_id = f"subject-system-namespace-{suffix}"
    tag_id = f"tag-system-namespace-{suffix}"
    activity_id = f"activity-system-namespace-{suffix}"
    revision_snapshot: dict | None = None

    async def snapshot_revision() -> None:
        nonlocal revision_snapshot
        async with AsyncSessionLocal() as db:
            revision_snapshot = await snapshot_teaching_content_revision(db)

    async def deleted() -> bool:
        async with AsyncSessionLocal() as db:
            return all(
                row is None
                for row in (
                    await db.get(ContentSubject, subject_id),
                    await db.get(ActivityCollection, f"__tags__:{subject_id}"),
                    await db.get(ActivityCollection, f"__activities__:{subject_id}"),
                )
            )

    async def cleanup() -> None:
        async with AsyncSessionLocal() as db:
            await db.execute(delete(ActivityOverride).where(ActivityOverride.activity_id == activity_id))
            await db.execute(delete(ActivityTag).where(ActivityTag.id == tag_id))
            await db.execute(delete(ActivityCollection).where(ActivityCollection.subject_id == subject_id))
            await db.execute(delete(ContentSubject).where(ContentSubject.id == subject_id))
            await db.commit()
            await restore_teaching_content_revision(db, revision_snapshot)
            await db.commit()

    asyncio.run(snapshot_revision())
    try:
        with TestClient(app) as client:
            assert client.post("/api/v1/auth/login", json={"username": "admin", "password": "jbgsnmm~123"}).status_code == 200
            before = client.get("/api/v1/content-prep/shared-content", params={"subjectId": "subject-pmp"}).json()
            created = client.put(
                "/api/v1/content-prep/shared-content",
                json={
                    "subjectId": "subject-pmp",
                    "contentRevision": before["contentRevision"],
                    "subjects": [*before["subjects"], {"id": subject_id, "code": f"SYS-{suffix}", "name": {"zh": "系统命名空间科目"}}],
                    "activityTags": [*before["activityTags"], {"id": tag_id, "name": "临时标签", "subjectId": subject_id}],
                    "activityOverrides": [*before["activityOverrides"], {"id": activity_id, "metadata": {"subjectId": subject_id}}],
                },
            )
            assert created.status_code == 200, created.text
            snapshot = created.json()
            removed = client.put(
                "/api/v1/content-prep/shared-content",
                json={
                    "subjectId": "subject-pmp",
                    "contentRevision": snapshot["contentRevision"],
                    "subjects": [row for row in snapshot["subjects"] if row["id"] != subject_id],
                    "activityTags": [row for row in snapshot["activityTags"] if row["id"] != tag_id],
                    "activityOverrides": [row for row in snapshot["activityOverrides"] if row["id"] != activity_id],
                    "activityCollections": snapshot["activityCollections"],
                },
            )
            assert removed.status_code == 200, removed.text
            assert removed.json()["contentRevision"] == snapshot["contentRevision"] + 1
            assert asyncio.run(deleted())
    finally:
        asyncio.run(cleanup())


def test_catalog_only_increments_revision_for_the_changed_activity_override() -> None:
    suffix = uuid4().hex[:10]
    activity_ids = [f"activity-row-revision-a-{suffix}", f"activity-row-revision-b-{suffix}"]
    revision_snapshot: dict | None = None

    async def snapshot_revision() -> None:
        nonlocal revision_snapshot
        async with AsyncSessionLocal() as db:
            revision_snapshot = await snapshot_teaching_content_revision(db)

    async def row_revisions() -> dict[str, int]:
        async with AsyncSessionLocal() as db:
            rows = list(
                (
                    await db.scalars(
                        select(ActivityOverride).where(
                            ActivityOverride.activity_id.in_(activity_ids)
                        )
                    )
                ).all()
            )
            return {row.activity_id: row.revision for row in rows}

    async def cleanup() -> None:
        async with AsyncSessionLocal() as db:
            await db.execute(delete(ActivityOverride).where(ActivityOverride.activity_id.in_(activity_ids)))
            await db.commit()
            await restore_teaching_content_revision(db, revision_snapshot)
            await db.commit()

    asyncio.run(snapshot_revision())
    try:
        with TestClient(app) as client:
            assert client.post("/api/v1/auth/login", json={"username": "admin", "password": "jbgsnmm~123"}).status_code == 200
            before = client.get("/api/v1/content-prep/shared-content", params={"subjectId": "subject-pmp"}).json()
            created = client.put(
                "/api/v1/content-prep/shared-content",
                json={
                    "subjectId": "subject-pmp",
                    "contentRevision": before["contentRevision"],
                    "activityOverrides": [
                        *before["activityOverrides"],
                        {"id": activity_ids[0], "title": "A", "metadata": {"subjectId": "subject-pmp"}},
                        {"id": activity_ids[1], "title": "B", "metadata": {"subjectId": "subject-pmp"}},
                    ],
                },
            )
            assert created.status_code == 200, created.text
            initial_rows = row_revisions()
            initial = asyncio.run(initial_rows)
            changed_rows = [
                {**row, "title": "A2"} if row["id"] == activity_ids[0] else row
                for row in created.json()["activityOverrides"]
            ]
            changed = client.put(
                "/api/v1/content-prep/shared-content",
                json={
                    "subjectId": "subject-pmp",
                    "contentRevision": created.json()["contentRevision"],
                    "activityOverrides": changed_rows,
                },
            )
            assert changed.status_code == 200, changed.text
            after = asyncio.run(row_revisions())
            assert after[activity_ids[0]] == initial[activity_ids[0]] + 1
            assert after[activity_ids[1]] == initial[activity_ids[1]]
    finally:
        asyncio.run(cleanup())


def test_two_teachers_cannot_overwrite_a_stale_recall_library_snapshot() -> None:
    """A second editor must refetch after the first editor advances contentRevision."""

    suffix = uuid4().hex[:10]
    subject_id = f"subject-recall-race-{suffix}"
    teachers = [f"recall-race-a-{suffix}", f"recall-race-b-{suffix}"]
    revision_snapshot: dict | None = None

    async def seed() -> None:
        nonlocal revision_snapshot
        async with AsyncSessionLocal() as db:
            revision_snapshot = await snapshot_teaching_content_revision(db)
            db.add(
                ContentSubject(
                    id=subject_id,
                    code=f"RACE-{suffix}",
                    name="联想库并发测试",
                    content_metadata={},
                )
            )
            db.add_all(
                User(
                    username=username,
                    password_hash=hash_password(PASSWORD),
                    role="teacher",
                    status="active",
                    subject="PMP",
                )
                for username in teachers
            )
            await db.commit()

    async def persisted() -> tuple[list[dict], int]:
        async with AsyncSessionLocal() as db:
            subject = await db.get(ContentSubject, subject_id)
            recall_id = str((subject.content_metadata or {}).get("currentRecallLibraryId") or "")
            recall = await db.get(RecallAssociationLibrary, recall_id)
            revision = int((await teaching_content_revision_service.current(db))["revision"])
            return list(recall.nodes or []), revision

    async def cleanup() -> None:
        async with AsyncSessionLocal() as db:
            await db.execute(
                delete(TeachingContentAudit).where(
                    TeachingContentAudit.actor_username.in_(teachers)
                )
            )
            await db.execute(
                delete(RecallAssociationLibrary).where(
                    RecallAssociationLibrary.subject_id == subject_id
                )
            )
            await db.execute(delete(ContentSubject).where(ContentSubject.id == subject_id))
            await db.execute(delete(User).where(User.username.in_(teachers)))
            await db.commit()
            await restore_teaching_content_revision(db, revision_snapshot)
            await db.commit()

    asyncio.run(seed())
    try:
        with TestClient(app) as first, TestClient(app) as second:
            for client, username in ((first, teachers[0]), (second, teachers[1])):
                assert client.post(
                    "/api/v1/auth/login",
                    json={"username": username, "password": PASSWORD},
                ).status_code == 200
            first_snapshot = first.get(
                "/api/v1/content-prep/shared-content",
                params={"subjectId": subject_id},
            ).json()
            second_snapshot = second.get(
                "/api/v1/content-prep/shared-content",
                params={"subjectId": subject_id},
            ).json()
            assert first_snapshot["contentRevision"] == second_snapshot["contentRevision"]

            first_save = first.put(
                "/api/v1/content-prep/shared-content",
                json={
                    "subjectId": subject_id,
                    "contentRevision": first_snapshot["contentRevision"],
                    "recallLibrary": {"nodes": [{"id": "teacher-a"}], "edges": []},
                },
            )
            assert first_save.status_code == 200, first_save.text
            nodes_after_first, revision_after_first = asyncio.run(persisted())

            stale_save = second.put(
                "/api/v1/content-prep/shared-content",
                json={
                    "subjectId": subject_id,
                    "contentRevision": second_snapshot["contentRevision"],
                    "recallLibrary": {"nodes": [{"id": "teacher-b"}], "edges": []},
                },
            )
            assert stale_save.status_code == 409, stale_save.text
            assert stale_save.json()["detail"]["currentContentRevision"] == revision_after_first
            assert asyncio.run(persisted()) == (nodes_after_first, revision_after_first)

            legacy_stale_save = second.put(
                f"/api/v1/content-prep/recall-libraries/{subject_id}",
                json={
                    "contentRevision": second_snapshot["contentRevision"],
                    "version": 1,
                    "nodes": [{"id": "teacher-b-legacy-route"}],
                    "edges": [],
                    "metadata": {},
                },
            )
            assert legacy_stale_save.status_code == 409, legacy_stale_save.text
            assert legacy_stale_save.json()["detail"] == stale_save.json()["detail"]
            assert asyncio.run(persisted()) == (nodes_after_first, revision_after_first)
    finally:
        asyncio.run(cleanup())


def test_shared_content_uses_explicit_current_pointers_with_published_fallback() -> None:
    suffix = uuid4().hex[:10]
    pointed_subject_id = f"subject-pointed-{suffix}"
    fallback_subject_id = f"subject-fallback-{suffix}"
    pointed_taxonomy_ids = [f"tax-pointed-old-{suffix}", f"tax-pointed-new-{suffix}"]
    pointed_recall_ids = [f"recall-pointed-old-{suffix}", f"recall-pointed-new-{suffix}"]
    fallback_taxonomy_ids = [f"tax-fallback-v1-{suffix}", f"tax-fallback-v2-{suffix}"]
    fallback_recall_ids = [f"recall-fallback-v1-{suffix}", f"recall-fallback-v2-{suffix}"]
    all_taxonomy_ids = pointed_taxonomy_ids + fallback_taxonomy_ids
    all_recall_ids = pointed_recall_ids + fallback_recall_ids

    async def seed() -> None:
        async with AsyncSessionLocal() as db:
            db.add_all(
                [
                    ContentSubject(
                        id=pointed_subject_id,
                        code=f"POINTED-{suffix}",
                        name="指针科目",
                        content_metadata={
                            "currentTaxonomyId": pointed_taxonomy_ids[0],
                            "currentRecallLibraryId": pointed_recall_ids[0],
                        },
                    ),
                    ContentSubject(
                        id=fallback_subject_id,
                        code=f"FALLBACK-{suffix}",
                        name="兼容科目",
                        content_metadata={},
                    ),
                ]
            )
            await db.flush()
            db.add_all(
                [
                    ContentTaxonomy(id=pointed_taxonomy_ids[0], subject_id=pointed_subject_id, version=1, status="published", title="指针选中的知识树", content_metadata={}),
                    ContentTaxonomy(id=pointed_taxonomy_ids[1], subject_id=pointed_subject_id, version=2, status="published", title="版本更新但未选中", content_metadata={}),
                    ContentTaxonomy(id=fallback_taxonomy_ids[0], subject_id=fallback_subject_id, version=1, status="published", title="兼容旧版", content_metadata={}),
                    ContentTaxonomy(id=fallback_taxonomy_ids[1], subject_id=fallback_subject_id, version=2, status="published", title="兼容最新已发布版", content_metadata={}),
                    RecallAssociationLibrary(id=pointed_recall_ids[0], subject_id=pointed_subject_id, version=1, status="published", nodes=[{"id": "pointed-recall"}], edges=[], content_metadata={}),
                    RecallAssociationLibrary(id=pointed_recall_ids[1], subject_id=pointed_subject_id, version=2, status="published", nodes=[{"id": "newer-unselected-recall"}], edges=[], content_metadata={}),
                    RecallAssociationLibrary(id=fallback_recall_ids[0], subject_id=fallback_subject_id, version=1, status="published", nodes=[{"id": "fallback-v1"}], edges=[], content_metadata={}),
                    RecallAssociationLibrary(id=fallback_recall_ids[1], subject_id=fallback_subject_id, version=2, status="published", nodes=[{"id": "fallback-v2"}], edges=[], content_metadata={}),
                ]
            )
            await db.flush()
            for taxonomy_id in all_taxonomy_ids:
                db.add(
                    TaxonomyNode(
                        id=f"{taxonomy_id}:root",
                        taxonomy_id=taxonomy_id,
                        node_id="root",
                        title=taxonomy_id,
                        record={"id": "root", "title": taxonomy_id},
                        position=0,
                    )
                )
            await db.commit()

    async def cleanup() -> None:
        async with AsyncSessionLocal() as db:
            await db.execute(delete(TaxonomyNode).where(TaxonomyNode.taxonomy_id.in_(all_taxonomy_ids)))
            await db.execute(delete(ContentTaxonomy).where(ContentTaxonomy.id.in_(all_taxonomy_ids)))
            await db.execute(delete(RecallAssociationLibrary).where(RecallAssociationLibrary.id.in_(all_recall_ids)))
            await db.execute(delete(ContentSubject).where(ContentSubject.id.in_([pointed_subject_id, fallback_subject_id])))
            await db.commit()

    try:
        asyncio.run(seed())
        with TestClient(app) as client:
            assert client.post(
                "/api/v1/auth/login",
                json={"username": "admin", "password": "jbgsnmm~123"},
            ).status_code == 200
            pointed = client.get(
                "/api/v1/content-prep/shared-content",
                params={"subjectId": pointed_subject_id},
            )
            assert pointed.status_code == 200, pointed.text
            assert pointed.json()["knowledgeTree"]["taxonomy"]["id"] == pointed_taxonomy_ids[0]
            assert pointed.json()["recallLibrary"]["nodes"] == [{"id": "pointed-recall"}]

            fallback = client.get(
                "/api/v1/content-prep/shared-content",
                params={"subjectId": fallback_subject_id},
            )
            assert fallback.status_code == 200, fallback.text
            assert fallback.json()["knowledgeTree"]["taxonomy"]["id"] == fallback_taxonomy_ids[1]
            assert fallback.json()["recallLibrary"]["nodes"] == [{"id": "fallback-v2"}]
    finally:
        asyncio.run(cleanup())


def test_content_prep_assets_principles_and_activities_are_shared_server_data() -> None:
    suffix = uuid4().hex[:10]
    teacher_a, teacher_b = f"prep-a-{suffix}", f"prep-b-{suffix}"
    student, viewer = f"prep-student-{suffix}", f"prep-viewer-{suffix}"
    principle_id, preset_id = f"principle-{suffix}", f"preset-{suffix}"
    tag_sentinel = json.dumps({"legacyTagProjection": suffix}, ensure_ascii=False, separators=(",", ":"))
    snapshots: dict[str, dict | None] = {}
    created_bank_ids: set[str] = set()
    created_batch_ids: set[str] = set()
    previous_active_tag_id: str | None = None
    subject_metadata_snapshot: dict | None = None
    recall_snapshot: dict | None = None
    revision_snapshot: dict | None = None
    keys = {
        TAXONOMY_KEY,
        TAG_KEY,
        ACTIVITY_KEY,
        RECALL_KEY,
        *PROJECTION_KEYS,
    }

    async def seed() -> None:
        nonlocal previous_active_tag_id, subject_metadata_snapshot, recall_snapshot, revision_snapshot
        async with AsyncSessionLocal() as db:
            revision_snapshot = await snapshot_teaching_content_revision(db)
            subject = await db.get(ContentSubject, "subject-pmp")
            subject_metadata_snapshot = None if subject is None else dict(subject.content_metadata or {})
            recall_id = str((subject_metadata_snapshot or {}).get("currentRecallLibraryId") or "")
            recall = await db.get(RecallAssociationLibrary, recall_id) if recall_id else None
            recall_snapshot = None if recall is None else {
                "id": recall.id,
                "nodes": deepcopy(recall.nodes),
                "edges": deepcopy(recall.edges),
                "content_metadata": deepcopy(recall.content_metadata),
                "status": recall.status,
                "updated_by": recall.updated_by,
            }
            for key in keys:
                row = await db.get(SharedRuntimeState, key)
                snapshots[key] = None if row is None else {
                    "value": row.value,
                    "schema_version": row.schema_version,
                    "updated_by": row.updated_by,
                    "created_at": row.created_at,
                    "updated_at": row.updated_at,
                }
            previous_active_tag_id = (
                await db.execute(
                    select(QuestionTagConfig.id).where(QuestionTagConfig.active.is_(True))
                )
            ).scalar_one_or_none()
            legacy_tag = await db.get(SharedRuntimeState, TAG_KEY)
            if legacy_tag is None:
                db.add(SharedRuntimeState(key=TAG_KEY, value=tag_sentinel))
            else:
                legacy_tag.value = tag_sentinel
                legacy_tag.updated_by = None
            db.add_all([
                User(username=teacher_a, password_hash=hash_password(PASSWORD), role="teacher", status="active", subject="PMP"),
                User(username=teacher_b, password_hash=hash_password(PASSWORD), role="teacher", status="active", subject="PMP"),
                User(username=student, password_hash=hash_password(PASSWORD), role="student", status="active", subject="PMP"),
                User(username=viewer, password_hash=hash_password(PASSWORD), role="viewer", status="active", subject="PMP"),
            ])
            await db.commit()

    async def cleanup() -> None:
        async with AsyncSessionLocal() as db:
            if created_batch_ids:
                await db.execute(
                    delete(QuestionUploadBatch).where(QuestionUploadBatch.id.in_(created_batch_ids))
                )
            if created_bank_ids:
                await db.execute(delete(QuestionBank).where(QuestionBank.id.in_(created_bank_ids)))
            await db.execute(delete(SynthesisPreset).where(SynthesisPreset.id == preset_id))
            await db.execute(delete(Principle).where(Principle.id == principle_id))
            await db.execute(
                delete(QuestionTagConfig).where(
                    QuestionTagConfig.created_by.in_([teacher_a, teacher_b])
                )
            )
            if previous_active_tag_id:
                previous = await db.get(QuestionTagConfig, previous_active_tag_id)
                if previous is not None:
                    previous.active = True
            subject = await db.get(ContentSubject, "subject-pmp")
            if subject is not None and subject_metadata_snapshot is not None:
                subject.content_metadata = subject_metadata_snapshot
            taxonomy_ids = [f"tax-{suffix}", f"empty-tax-{suffix}"]
            await db.execute(delete(TaxonomyNode).where(TaxonomyNode.taxonomy_id.in_(taxonomy_ids)))
            await db.execute(delete(ContentTaxonomy).where(ContentTaxonomy.id.in_(taxonomy_ids)))
            if recall_snapshot is not None:
                recall = await db.get(RecallAssociationLibrary, recall_snapshot["id"])
                if recall is not None:
                    recall.nodes = recall_snapshot["nodes"]
                    recall.edges = recall_snapshot["edges"]
                    recall.content_metadata = recall_snapshot["content_metadata"]
                    recall.status = recall_snapshot["status"]
                    recall.updated_by = recall_snapshot["updated_by"]
            for key, snapshot in snapshots.items():
                await db.execute(delete(SharedRuntimeState).where(SharedRuntimeState.key == key))
                if snapshot is not None:
                    db.add(SharedRuntimeState(key=key, **snapshot))
            await restore_teaching_content_revision(db, revision_snapshot)
            await db.execute(delete(User).where(User.username.in_([teacher_a, teacher_b, student, viewer])))
            await db.commit()

    try:
        asyncio.run(seed())
        with TestClient(app) as first, TestClient(app) as second, TestClient(app) as admin:
            assert first.post("/api/v1/auth/login", json={"username": teacher_a, "password": PASSWORD}).status_code == 200
            assert second.post("/api/v1/auth/login", json={"username": teacher_b, "password": PASSWORD}).status_code == 200
            assert admin.post("/api/v1/auth/login", json={"username": "admin", "password": "jbgsnmm~123"}).status_code == 200

            revision = first.get("/api/v1/question-catalog/revision").json()["revision"]
            saved = first.put(
                "/api/v1/content-prep/shared-content",
                json={
                    "subjectId": "subject-pmp",
                    "contentRevision": revision,
                    "knowledgeTree": {"taxonomy": {"id": f"tax-{suffix}", "subjectId": "subject-pmp", "name": {"zh": "共享知识树"}, "version": 1, "status": "published", "nodes": []}},
                    "recallLibrary": {"schemaVersion": 1, "nodes": [{"id": f"recall-{suffix}", "title": "共享联想"}], "edges": []},
                    "principles": {},
                    "synthesisPresets": {},
                    "tagConfig": {"schemaVersion": 2, "names": {"stage": "阶段"}, "groupNames": {}, "categoryNames": {}, "aliases": {}},
                },
            )
            assert saved.status_code == 200, saved.text

            async def tag_projection() -> str | None:
                async with AsyncSessionLocal() as db:
                    row = await db.get(SharedRuntimeState, TAG_KEY)
                    return None if row is None else row.value

            assert asyncio.run(tag_projection()) == tag_sentinel
            shared = second.get("/api/v1/content-prep/shared-content", params={"subjectId": "PMP"})
            assert shared.status_code == 200, shared.text
            assert shared.json()["knowledgeTree"]["taxonomy"]["id"] == f"tax-{suffix}"
            assert shared.json()["recallLibrary"]["nodes"][0]["title"] == "共享联想"
            assert shared.json()["tagConfig"]["names"]["stage"] == "阶段"

            created = first.post(
                "/api/v1/content-prep/principles",
                json={
                    "contentRevision": shared.json()["contentRevision"],
                    "principle": {"id": principle_id, "name": "先分析再行动", "status": "active", "confusablePrincipleIds": []},
                    "preset": {"id": preset_id, "principleId": principle_id, "title": "原则：先分析再行动", "content": "先确认根因。", "status": "active", "version": 1},
                },
            )
            assert created.status_code == 200, created.text
            updated = admin.put(
                f"/api/v1/content-prep/principles/{principle_id}",
                json={
                    "contentRevision": created.json()["contentRevision"],
                    "principle": {"id": principle_id, "name": "先澄清再行动", "status": "active", "confusablePrincipleIds": []},
                    "preset": {"id": preset_id, "principleId": principle_id, "title": "原则：先澄清再行动", "content": "先澄清问题。", "status": "active", "version": 2},
                },
            )
            assert updated.status_code == 200, updated.text
            repeated = second.put(
                f"/api/v1/content-prep/principles/{principle_id}",
                json={
                    "contentRevision": updated.json()["contentRevision"],
                    "principle": {"id": principle_id, "name": "先澄清再行动", "status": "active", "confusablePrincipleIds": []},
                    "preset": {"id": preset_id, "principleId": principle_id, "title": "原则：先澄清再行动", "content": "先澄清问题。", "status": "active", "version": 2},
                },
            )
            assert repeated.status_code == 200
            assert repeated.json()["contentRevision"] == updated.json()["contentRevision"]
            deleted = first.request(
                "DELETE",
                f"/api/v1/content-prep/principles/{principle_id}",
                json={"contentRevision": repeated.json()["contentRevision"]},
            )
            assert deleted.status_code == 200, deleted.text

            bank = first.post(
                "/api/v1/content-prep/banks",
                json={"name": f"零题目工作区-{suffix}", "subject": "PMP", "visibility": "private", "creatorId": "creator_001"},
            )
            assert bank.status_code == 200, bank.text
            bank_id = bank.json()["bank"]["id"]
            created_bank_ids.add(bank_id)
            batch = first.post(
                "/api/v1/content-prep/batches",
                json={
                    "idempotencyKey": f"assets-{suffix}",
                    "clientInstanceId": f"client-{suffix}",
                    "targetBankId": bank_id,
                    "creatorId": "creator_001",
                    "prepVersion": "0.4.0",
                    "workspaceVersion": "4",
                    "questions": [],
                    "subjectId": "subject-pmp",
                    "knowledgeTree": {"taxonomy": {"id": f"empty-tax-{suffix}", "subjectId": "subject-pmp", "name": {"zh": "零题目知识树"}, "version": 1, "status": "published", "nodes": []}},
                    "recallLibrary": {"schemaVersion": 1, "nodes": [{"id": f"empty-recall-{suffix}", "title": "零题目联想"}], "edges": []},
                    "principles": {}, "synthesisPresets": {},
                    "tagConfig": {"schemaVersion": 2, "names": {"stage": "零题目阶段"}, "groupNames": {}, "categoryNames": {}, "aliases": {}},
                },
            )
            assert batch.status_code == 200, batch.text
            assert batch.json()["questions"] == []
            created_batch_ids.add(batch.json()["batchId"])

            current_revision = second.get("/api/v1/question-catalog/revision").json()["revision"]
            activity_id = f"activity-{suffix}"
            imported = second.post(
                "/api/v1/content-prep/activities/import",
                json={"contentRevision": current_revision, "activities": [{"id": activity_id, "title": "共享活动", "type": "practice", "metadata": {}}]},
            )
            assert imported.status_code == 200, imported.text
            assert imported.json()["summary"]["created"] == 1

            shared_after_batch = second.get(
                "/api/v1/content-prep/shared-content",
                params={"subjectId": "PMP"},
            )
            assert shared_after_batch.status_code == 200, shared_after_batch.text
            assert shared_after_batch.json()["knowledgeTree"]["taxonomy"]["id"] == f"empty-tax-{suffix}"
            assert shared_after_batch.json()["recallLibrary"]["nodes"][0]["title"] == "零题目联想"
            assert shared_after_batch.json()["tagConfig"]["names"]["stage"] == "零题目阶段"
            async def relational_assets():
                async with AsyncSessionLocal() as db:
                    taxonomy = (await db.execute(select(ContentTaxonomy).where(ContentTaxonomy.id == f"empty-tax-{suffix}"))).scalar_one()
                    subject = await db.get(ContentSubject, "subject-pmp")
                    recall = await db.get(RecallAssociationLibrary, subject.content_metadata["currentRecallLibraryId"])
                    activity = (await db.execute(select(ActivityOverride).where(ActivityOverride.activity_id == activity_id))).scalar_one()
                    return taxonomy, recall, activity
            taxonomy, recall, activity = asyncio.run(relational_assets())
            assert taxonomy.id == f"empty-tax-{suffix}"
            assert recall.nodes[0]["title"] == "零题目联想"
            assert activity.record["title"] == "共享活动"
            assert activity.record["metadata"]["authorship"]["createdByUserId"] == teacher_b

        for username in (student, viewer):
            with TestClient(app) as denied:
                assert denied.post(
                    "/api/v1/auth/login",
                    json={"username": username, "password": PASSWORD},
                ).status_code == 200
                assert denied.get(
                    "/api/v1/content-prep/shared-content",
                    params={"subjectId": "PMP"},
                ).status_code == 403
                assert denied.post(
                    "/api/v1/content-prep/activities/import",
                    json={"contentRevision": 0, "activities": [{"id": "forbidden"}]},
                ).status_code == 403
    finally:
        asyncio.run(cleanup())


def test_principle_delete_conflict_lists_exact_referencing_questions() -> None:
    suffix = uuid4().hex[:10]
    teacher = f"ref-teacher-{suffix}"
    student = f"ref-student-{suffix}"
    viewer = f"ref-viewer-{suffix}"
    principle_id = f"principle-ref-{suffix}"
    preset_id = f"preset-ref-{suffix}"
    bank_a_id = f"bank-ref-a-{suffix}"
    bank_b_id = f"bank-ref-b-{suffix}"
    question_a_id = f"question-ref-a-{suffix}"
    question_b_id = f"question-ref-b-{suffix}"

    async def seed() -> None:
        async with AsyncSessionLocal() as db:
            db.add_all(
                [
                    User(
                        username=teacher,
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
            await db.flush()
            db.add_all(
                [
                    QuestionBank(
                        id=bank_a_id,
                        owner_id=teacher,
                        name="A 题库",
                        subject="PMP",
                        created_by=teacher,
                        updated_by=teacher,
                    ),
                    QuestionBank(
                        id=bank_b_id,
                        owner_id=teacher,
                        name="B 题库",
                        subject="PMP",
                        created_by=teacher,
                        updated_by=teacher,
                    ),
                    Principle(
                        id=principle_id,
                        name="先识别引用",
                        status="active",
                        created_by=teacher,
                        updated_by=teacher,
                    ),
                ]
            )
            await db.flush()
            db.add(
                SynthesisPreset(
                    id=preset_id,
                    principle_id=principle_id,
                    title="原则：先识别引用",
                    content="列出具体题目。",
                    status="active",
                    created_by=teacher,
                    updated_by=teacher,
                )
            )
            db.add_all(
                [
                    Question(
                        id=question_a_id,
                        bank_id=bank_a_id,
                        title="A 题",
                        teacher_number="T-002",
                        scope="internal",
                        created_by=teacher,
                        updated_by=teacher,
                        content_metadata={
                            "stemPrincipleIds": [principle_id, principle_id],
                            "principleIds": [principle_id],
                            "optionPrincipleMap": {
                                "A": [principle_id],
                                "B": [principle_id],
                            },
                        },
                    ),
                    Question(
                        id=question_b_id,
                        bank_id=bank_b_id,
                        title="B 题",
                        teacher_number="T-001",
                        scope="internal",
                        created_by=teacher,
                        updated_by=teacher,
                        content_metadata={
                            "optionPrincipleMap": {"D": [principle_id]},
                        },
                    ),
                ]
            )
            await db.commit()

    async def cleanup() -> None:
        async with AsyncSessionLocal() as db:
            await db.execute(
                delete(Question).where(Question.id.in_([question_a_id, question_b_id]))
            )
            await db.execute(delete(SynthesisPreset).where(SynthesisPreset.id == preset_id))
            await db.execute(delete(Principle).where(Principle.id == principle_id))
            await db.execute(
                delete(QuestionBank).where(QuestionBank.id.in_([bank_a_id, bank_b_id]))
            )
            await db.execute(
                delete(User).where(User.username.in_([teacher, student, viewer]))
            )
            await db.commit()

    asyncio.run(seed())
    try:
        for username in (student, viewer):
            with TestClient(app) as denied:
                assert denied.post(
                    "/api/v1/auth/login",
                    json={"username": username, "password": PASSWORD},
                ).status_code == 200
                response = denied.post(
                    "/api/v1/content-prep/principles/delete",
                    json={"ids": [principle_id]},
                )
                assert response.status_code == 403

        with TestClient(app) as client:
            assert client.post(
                "/api/v1/auth/login",
                json={"username": teacher, "password": PASSWORD},
            ).status_code == 200
            content_revision = client.get(
                "/api/v1/content-prep/principles"
            ).json()["contentRevision"]
            response = client.post(
                "/api/v1/content-prep/principles/delete",
                json={"ids": [principle_id], "contentRevision": content_revision},
            )
            assert response.status_code == 409, response.text
            assert response.json()["detail"] == {
                "code": "PRINCIPLE_IN_USE",
                "referencedIds": [principle_id],
                "referenceCounts": {principle_id: 2},
                "referenceQuestions": {
                    principle_id: [
                        {
                            "questionId": question_a_id,
                            "questionTitle": "A 题",
                            "teacherNumber": "T-002",
                            "bankId": bank_a_id,
                            "bankName": "A 题库",
                        },
                        {
                            "questionId": question_b_id,
                            "questionTitle": "B 题",
                            "teacherNumber": "T-001",
                            "bankId": bank_b_id,
                            "bankName": "B 题库",
                        },
                    ]
                },
            }
    finally:
        asyncio.run(cleanup())
