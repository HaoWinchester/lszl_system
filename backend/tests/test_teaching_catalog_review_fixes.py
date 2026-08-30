from __future__ import annotations

import asyncio
from copy import deepcopy
from types import SimpleNamespace
from uuid import uuid4

import pytest
from fastapi.testclient import TestClient
from sqlalchemy import delete, func, select

from app.core.security import hash_password
from app.db.session import AsyncSessionLocal
from app.main import app
from app.models.course_management import CourseDraft
from app.models.teaching_content import (
    ActivityCollection,
    ActivityOverride,
    ActivityTag,
    ContentSubject,
    ContentTaxonomy,
    RecallAssociationLibrary,
    TaxonomyNode,
    TeachingContentAudit,
)
from app.models.user import User
from app.services import teaching_content_revision_service
from app.services import content_prep_shared_service
from tests.teaching_content_revision_support import (
    restore_teaching_content_revision,
    snapshot_teaching_content_revision,
)


PASSWORD = "teaching-review-pass"


def _login(client: TestClient, username: str, password: str = PASSWORD) -> None:
    response = client.post(
        "/api/v1/auth/login", json={"username": username, "password": password}
    )
    assert response.status_code == 200, response.text


def _shared(client: TestClient, subject_id: str = "subject-pmp") -> dict:
    response = client.get(
        "/api/v1/content-prep/shared-content", params={"subjectId": subject_id}
    )
    assert response.status_code == 200, response.text
    return response.json()


def test_private_collection_authority_is_server_owned_and_full_put_preserves_other_users() -> None:
    suffix = uuid4().hex[:10]
    teacher_a = f"catalog-owner-a-{suffix}"
    teacher_b = f"catalog-owner-b-{suffix}"
    private_a = f"collection-private-a-{suffix}"
    shared_a = f"collection-shared-a-{suffix}"
    private_b = f"collection-private-b-{suffix}"
    revision_snapshot: dict | None = None

    async def seed() -> None:
        nonlocal revision_snapshot
        async with AsyncSessionLocal() as db:
            revision_snapshot = await snapshot_teaching_content_revision(db)
            db.add_all(
                [
                    User(username=teacher_a, password_hash=hash_password(PASSWORD), role="teacher", status="active"),
                    User(username=teacher_b, password_hash=hash_password(PASSWORD), role="teacher", status="active"),
                ]
            )
            await db.commit()

    async def cleanup() -> None:
        async with AsyncSessionLocal() as db:
            await db.execute(
                delete(ActivityCollection).where(
                    ActivityCollection.id.in_([private_a, shared_a, private_b])
                )
            )
            await db.execute(delete(User).where(User.username.in_([teacher_a, teacher_b])))
            await db.commit()
            await restore_teaching_content_revision(db, revision_snapshot)
            await db.commit()

    asyncio.run(seed())
    try:
        with TestClient(app) as first, TestClient(app) as second:
            _login(first, teacher_a)
            _login(second, teacher_b)
            before_a = _shared(first)
            created = first.put(
                "/api/v1/content-prep/shared-content",
                json={
                    "subjectId": "subject-pmp",
                    "contentRevision": before_a["contentRevision"],
                    "activityCollections": [
                        *before_a["activityCollections"],
                        {
                            "id": private_a,
                            "subjectId": "subject-pmp",
                            "title": "A 私有",
                            "type": "favorites",
                            "visibility": "private",
                            "activityIds": [],
                            "authorship": {"createdByUserId": teacher_b},
                        },
                        {
                            "id": shared_a,
                            "subjectId": "subject-pmp",
                            "title": "A 共享",
                            "type": "collection",
                            "visibility": "shared",
                            "activityIds": [],
                            "authorship": {"createdByUserId": teacher_b},
                        },
                    ],
                },
            )
            assert created.status_code == 200, created.text
            a_rows = {row["id"]: row for row in created.json()["activityCollections"]}
            assert a_rows[private_a]["authorship"]["createdByUserId"] == teacher_a
            assert a_rows[shared_a]["authorship"]["createdByUserId"] == teacher_a

            before_b = _shared(second)
            b_ids = {row["id"] for row in before_b["activityCollections"]}
            assert private_a not in b_ids
            assert shared_a in b_ids

            tampered = deepcopy(before_b["activityCollections"])
            for row in tampered:
                if row["id"] == shared_a:
                    row["title"] = "B 不得篡改"
            collision = second.put(
                "/api/v1/content-prep/shared-content",
                json={
                    "subjectId": "subject-pmp",
                    "contentRevision": before_b["contentRevision"],
                    "activityCollections": tampered,
                },
            )
            assert collision.status_code == 422, collision.text
            detail = collision.json()["detail"]
            assert detail["code"] == "RESOURCE_NOT_MODIFIABLE"
            assert private_a not in str(detail) and shared_a not in str(detail)

            refreshed_b = _shared(second)
            own_b = second.put(
                "/api/v1/content-prep/shared-content",
                json={
                    "subjectId": "subject-pmp",
                    "contentRevision": refreshed_b["contentRevision"],
                    "activityCollections": [
                        *[
                            row
                            for row in refreshed_b["activityCollections"]
                            if row["id"] != shared_a
                        ],
                        {
                            "id": private_b,
                            "subjectId": "subject-pmp",
                            "title": "B 私有",
                            "visibility": "private",
                            "activityIds": [],
                        },
                    ],
                },
            )
            assert own_b.status_code == 200, own_b.text
            after_a = _shared(first)
            after_a_ids = {row["id"] for row in after_a["activityCollections"]}
            assert {private_a, shared_a} <= after_a_ids
            assert private_b not in after_a_ids
    finally:
        asyncio.run(cleanup())


def test_admin_and_teacher_share_the_same_private_boundary_and_collection_children_inherit_owner() -> None:
    suffix = uuid4().hex[:10]
    teacher = f"catalog-matrix-teacher-{suffix}"
    admin_private = f"collection-admin-private-{suffix}"
    admin_shared = f"collection-admin-shared-{suffix}"
    teacher_private = f"collection-teacher-private-{suffix}"
    private_tag = f"tag-admin-private-{suffix}"
    shared_tag = f"tag-admin-shared-{suffix}"
    private_activity = f"activity-admin-private-{suffix}"
    revision_snapshot: dict | None = None

    async def seed() -> None:
        nonlocal revision_snapshot
        async with AsyncSessionLocal() as db:
            revision_snapshot = await snapshot_teaching_content_revision(db)
            db.add(User(username=teacher, password_hash=hash_password(PASSWORD), role="teacher", status="active"))
            await db.commit()

    async def cleanup() -> None:
        async with AsyncSessionLocal() as db:
            await db.execute(delete(ActivityTag).where(ActivityTag.id.in_([private_tag, shared_tag])))
            await db.execute(delete(ActivityOverride).where(ActivityOverride.activity_id == private_activity))
            await db.execute(delete(ActivityCollection).where(ActivityCollection.id.in_([admin_private, admin_shared, teacher_private])))
            await db.execute(delete(User).where(User.username == teacher))
            await db.commit()
            await restore_teaching_content_revision(db, revision_snapshot)
            await db.commit()

    asyncio.run(seed())
    try:
        with TestClient(app) as admin, TestClient(app) as teacher_client:
            _login(admin, "admin", "jbgsnmm~123")
            _login(teacher_client, teacher)
            before = _shared(admin)
            created = admin.put(
                "/api/v1/content-prep/shared-content",
                json={
                    "subjectId": "subject-pmp",
                    "contentRevision": before["contentRevision"],
                    "activityCollections": [
                        *before["activityCollections"],
                        {"id": admin_private, "subjectId": "subject-pmp", "title": "admin private", "visibility": "private", "activityIds": [private_activity]},
                        {"id": admin_shared, "subjectId": "subject-pmp", "title": "admin shared", "visibility": "shared", "activityIds": []},
                    ],
                    "activityTags": [
                        *before["activityTags"],
                        {"id": private_tag, "subjectId": "subject-pmp", "collectionId": admin_private, "name": "private tag"},
                        {"id": shared_tag, "subjectId": "subject-pmp", "collectionId": admin_shared, "name": "shared tag"},
                    ],
                    "activityOverrides": [
                        *before["activityOverrides"],
                        {"id": private_activity, "metadata": {"subjectId": "subject-pmp", "collectionId": admin_private}},
                    ],
                },
            )
            assert created.status_code == 200, created.text
            visible = _shared(teacher_client)
            assert admin_private not in {row["id"] for row in visible["activityCollections"]}
            assert private_tag not in {row["id"] for row in visible["activityTags"]}
            assert private_activity not in {row["id"] for row in visible["activityOverrides"]}
            assert {admin_shared, shared_tag} <= {
                *(row["id"] for row in visible["activityCollections"]),
                *(row["id"] for row in visible["activityTags"]),
            }

            tampered_tags = deepcopy(visible["activityTags"])
            next(row for row in tampered_tags if row["id"] == shared_tag)["name"] = "tampered"
            tampered = teacher_client.put(
                "/api/v1/content-prep/shared-content",
                json={"subjectId": "subject-pmp", "contentRevision": visible["contentRevision"], "activityTags": tampered_tags},
            )
            assert tampered.status_code == 422, tampered.text
            assert tampered.json()["detail"]["code"] == "RESOURCE_NOT_MODIFIABLE"
            assert shared_tag not in str(tampered.json()["detail"])

            refreshed = _shared(teacher_client)
            omitted = teacher_client.put(
                "/api/v1/content-prep/shared-content",
                json={
                    "subjectId": "subject-pmp",
                    "contentRevision": refreshed["contentRevision"],
                    "activityCollections": [
                        *[row for row in refreshed["activityCollections"] if row["id"] != admin_shared],
                        {"id": teacher_private, "subjectId": "subject-pmp", "title": "teacher private", "visibility": "private", "activityIds": []},
                    ],
                    "activityTags": [row for row in refreshed["activityTags"] if row["id"] != shared_tag],
                    "activityOverrides": refreshed["activityOverrides"],
                },
            )
            assert omitted.status_code == 200, omitted.text
            admin_after = _shared(admin)
            assert {admin_private, admin_shared} <= {row["id"] for row in admin_after["activityCollections"]}
            assert {private_tag, shared_tag} <= {row["id"] for row in admin_after["activityTags"]}
            assert private_activity in {row["id"] for row in admin_after["activityOverrides"]}
            assert teacher_private not in {row["id"] for row in admin_after["activityCollections"]}
    finally:
        asyncio.run(cleanup())


def test_taxonomy_graph_and_recursive_fields_are_rejected_before_any_write() -> None:
    suffix = uuid4().hex[:10]
    taxonomy_id = f"taxonomy-invalid-graph-{suffix}"

    async def persisted() -> tuple[bool, int, int]:
        async with AsyncSessionLocal() as db:
            return (
                await db.get(ContentTaxonomy, taxonomy_id) is not None,
                int((await teaching_content_revision_service.current(db))["revision"]),
                int(
                    await db.scalar(
                        select(func.count(TeachingContentAudit.id)).where(
                            TeachingContentAudit.entity_type == "teachingCatalog"
                        )
                    )
                    or 0
                ),
            )

    async def cleanup() -> None:
        async with AsyncSessionLocal() as db:
            await db.execute(delete(ContentTaxonomy).where(ContentTaxonomy.id == taxonomy_id))
            await db.commit()

    invalid_nodes = [
        {},
        [42],
        [{"title": {"zh": "missing"}, "level": 1}],
        [{"id": "self", "parentId": "self", "level": 1}],
        [
            {"id": "a", "parentId": "b", "level": 2},
            {"id": "b", "parentId": "a", "level": 2},
        ],
        [{"id": "root", "level": 0}],
        [
            {"id": "root", "level": 1},
            {"id": "child", "parentId": "root", "level": 3},
        ],
        [{"id": "root", "taxonomyId": "another-taxonomy", "level": 1}],
    ]
    try:
        with TestClient(app) as client:
            _login(client, "admin", "jbgsnmm~123")
            before = _shared(client)
            initial = asyncio.run(persisted())
            for nodes in invalid_nodes:
                response = client.put(
                    "/api/v1/content-prep/shared-content",
                    json={
                        "subjectId": "subject-pmp",
                        "contentRevision": before["contentRevision"],
                        "taxonomies": [
                            *before["taxonomies"],
                            {
                                "id": taxonomy_id,
                                "subjectId": "subject-pmp",
                                "version": 900000,
                                "status": "draft",
                                "name": {"zh": "非法知识树"},
                                "nodes": nodes,
                            },
                        ],
                    },
                )
                assert response.status_code == 422, (nodes, response.text)
                assert asyncio.run(persisted()) == initial

            malformed = [
                {
                    "knowledgeTree": {
                        "taxonomy": {
                            "id": taxonomy_id,
                            "subjectId": "subject-pmp",
                            "nodes": [
                                {"id": "direct-a", "parentId": "direct-b", "level": 2},
                                {"id": "direct-b", "parentId": "direct-a", "level": 2},
                            ],
                        }
                    }
                },
                {
                    "activityOverrides": [
                        *before["activityOverrides"],
                        {
                            "id": f"activity-bad-related-{suffix}",
                            "metadata": {
                                "subjectId": "subject-pmp",
                                "knowledge": {"relatedNodeIds": 3},
                            },
                        },
                    ]
                },
                {
                    "activityOverrides": [
                        *before["activityOverrides"],
                        {
                            "id": f"activity-bad-tags-{suffix}",
                            "metadata": {
                                "subjectId": "subject-pmp",
                                "organization": {"tagIds": 3},
                            },
                        },
                    ]
                },
                {
                    "activityCollections": [
                        *before["activityCollections"],
                        {
                            "id": f"collection-bad-activities-{suffix}",
                            "subjectId": "subject-pmp",
                            "title": "坏题集",
                            "activityIds": 3,
                        },
                    ]
                },
            ]
            for partial in malformed:
                response = client.put(
                    "/api/v1/content-prep/shared-content",
                    json={
                        "subjectId": "subject-pmp",
                        "contentRevision": before["contentRevision"],
                        **partial,
                    },
                )
                assert response.status_code == 422, response.text
                assert "Traceback" not in response.text
                assert asyncio.run(persisted()) == initial
    finally:
        asyncio.run(cleanup())


def test_catalog_preflights_unique_business_keys_without_sql_details_or_revision_bump() -> None:
    suffix = uuid4().hex[:10]
    subject_a = f"subject-unique-a-{suffix}"
    subject_b = f"subject-unique-b-{suffix}"
    taxonomy_a = f"taxonomy-unique-a-{suffix}"
    taxonomy_b = f"taxonomy-unique-b-{suffix}"
    collection_id = f"collection-unique-{suffix}"

    async def cleanup() -> None:
        async with AsyncSessionLocal() as db:
            await db.execute(delete(ActivityTag).where(ActivityTag.id.like(f"tag-unique-%-{suffix}")))
            await db.execute(delete(ActivityCollection).where(ActivityCollection.id == collection_id))
            await db.execute(delete(ContentTaxonomy).where(ContentTaxonomy.id.in_([taxonomy_a, taxonomy_b])))
            await db.execute(delete(ContentSubject).where(ContentSubject.id.in_([subject_a, subject_b])))
            await db.commit()

    try:
        with TestClient(app) as client:
            _login(client, "admin", "jbgsnmm~123")
            before = _shared(client)
            revision = before["contentRevision"]
            payloads = [
                {
                    "subjects": [
                        *before["subjects"],
                        {"id": subject_a, "code": f"DUP-{suffix}", "name": "A"},
                        {"id": subject_b, "code": f"DUP-{suffix}", "name": "B"},
                    ]
                },
                {
                    "taxonomies": [
                        *before["taxonomies"],
                        {"id": taxonomy_a, "subjectId": "subject-pmp", "version": 800000, "nodes": []},
                        {"id": taxonomy_b, "subjectId": "subject-pmp", "version": 800000, "nodes": []},
                    ]
                },
                {
                    "activityCollections": [
                        *before["activityCollections"],
                        {"id": collection_id, "subjectId": "subject-pmp", "title": "唯一题集", "visibility": "shared", "activityIds": []},
                    ],
                    "activityTags": [
                        *before["activityTags"],
                        {"id": f"tag-unique-a-{suffix}", "name": "重复标签", "subjectId": "subject-pmp", "collectionId": collection_id},
                        {"id": f"tag-unique-b-{suffix}", "name": "重复标签", "subjectId": "subject-pmp", "collectionId": collection_id},
                    ],
                },
            ]
            for partial in payloads:
                response = client.put(
                    "/api/v1/content-prep/shared-content",
                    json={"subjectId": "subject-pmp", "contentRevision": revision, **partial},
                )
                assert response.status_code == 422, response.text
                detail = response.json()["detail"]
                assert detail["code"] == "INVALID_SHARED_CONTENT"
                assert not any(token in str(detail).lower() for token in ("uniqueconstraint", "uq_", "integrityerror", "sql"))
                assert _shared(client)["contentRevision"] == revision
    finally:
        asyncio.run(cleanup())


def test_subject_delete_reports_recall_reference_without_cross_owner_identifier_leak() -> None:
    suffix = uuid4().hex[:10]
    teacher = f"subject-delete-teacher-{suffix}"
    other = f"subject-delete-other-{suffix}"
    subject_id = f"subject-delete-recall-{suffix}"
    recall_id = f"recall-delete-{suffix}"
    draft_id = f"secret-draft-{suffix}"
    revision_snapshot: dict | None = None

    async def seed() -> None:
        nonlocal revision_snapshot
        async with AsyncSessionLocal() as db:
            revision_snapshot = await snapshot_teaching_content_revision(db)
            db.add_all(
                [
                    User(username=teacher, password_hash=hash_password(PASSWORD), role="teacher", status="active"),
                    User(username=other, password_hash=hash_password(PASSWORD), role="teacher", status="active"),
                    ContentSubject(id=subject_id, code=f"DEL-{suffix}", name="删除引用", content_metadata={}),
                ]
            )
            await db.flush()
            db.add(
                RecallAssociationLibrary(
                    id=recall_id,
                    subject_id=subject_id,
                    version=1,
                    status="published",
                    nodes=[],
                    edges=[],
                    content_metadata={},
                    updated_by=other,
                )
            )
            db.add(
                CourseDraft(
                    id=draft_id,
                    owner_id=other,
                    name="不可泄露草稿",
                    structure={"nested": {"subjectId": subject_id}},
                    created_by=other,
                    updated_by=other,
                )
            )
            await db.commit()

    async def cleanup() -> None:
        async with AsyncSessionLocal() as db:
            await db.execute(delete(CourseDraft).where(CourseDraft.id == draft_id))
            await db.execute(delete(RecallAssociationLibrary).where(RecallAssociationLibrary.id == recall_id))
            await db.execute(delete(ContentSubject).where(ContentSubject.id == subject_id))
            await db.execute(delete(User).where(User.username.in_([teacher, other])))
            await db.commit()
            await restore_teaching_content_revision(db, revision_snapshot)
            await db.commit()

    asyncio.run(seed())
    try:
        with TestClient(app) as client:
            _login(client, teacher)
            before = _shared(client)
            response = client.put(
                "/api/v1/content-prep/shared-content",
                json={
                    "subjectId": "subject-pmp",
                    "contentRevision": before["contentRevision"],
                    "subjects": [row for row in before["subjects"] if row["id"] != subject_id],
                },
            )
            assert response.status_code == 422, response.text
            detail = response.json()["detail"]
            assert detail["code"] == "INVALID_SHARED_CONTENT"
            assert "联想库" in detail["message"] or "课程草稿" in detail["message"]
            assert draft_id not in str(detail)
            assert other not in str(detail)
            assert _shared(client)["contentRevision"] == before["contentRevision"]
    finally:
        asyncio.run(cleanup())


def test_shared_write_builds_the_actor_snapshot_before_releasing_writer_transaction(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    order: list[str] = []

    class FakeDb:
        async def commit(self) -> None:
            order.append("commit")

    async def no_revision(_db, _expected):
        return 1

    async def catalog(*_args, **_kwargs):
        return [{"entityType": "subjectCatalog", "entityId": "all", "action": "replaced"}]

    async def auxiliary(*_args, **_kwargs):
        return []

    async def bump(*_args, **_kwargs):
        return {"revision": 2}

    async def snapshot(*_args, **_kwargs):
        order.append("snapshot")
        return {"subjects": [], "contentRevision": 2}

    async def legacy_read(*_args, **_kwargs):
        order.append("legacy-read-after-commit")
        return {"subjects": [], "contentRevision": 2}

    monkeypatch.setattr(content_prep_shared_service, "_assert_revision", no_revision)
    monkeypatch.setattr(content_prep_shared_service, "apply_catalog_snapshot", catalog)
    monkeypatch.setattr(content_prep_shared_service, "apply_auxiliary_assets", auxiliary)
    monkeypatch.setattr(teaching_content_revision_service, "bump", bump)
    monkeypatch.setattr(content_prep_shared_service, "_shared_content_snapshot", snapshot, raising=False)
    monkeypatch.setattr(content_prep_shared_service, "read_shared_content", legacy_read)

    result = asyncio.run(
        content_prep_shared_service.save_shared_content(
            FakeDb(),
            SimpleNamespace(username="teacher-a"),
            subject_id="subject-pmp",
            content_revision=1,
            knowledge_tree=None,
            recall_library=None,
            principles={},
            synthesis_presets={},
            tag_config={},
            subjects=[],
        )
    )
    assert result["contentRevision"] == 2
    assert order == ["snapshot", "commit"]
