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
from app.models.question import Question, QuestionBank
from app.models.shared_runtime_state import SharedRuntimeState
from app.models.teaching_content import ActivityOverride, ContentSubject, ContentTaxonomy, RecallAssociationLibrary, TaxonomyNode
from app.models.user import User
from app.services import teaching_content_revision_service


PASSWORD = "shared-prep-pass"
TAXONOMY_KEY = "kg_content_taxonomies_v1"
TAG_KEY = "kg_question_tag_names_v1"
ACTIVITY_KEY = "kg_content_activity_overrides_v1"
RECALL_KEY = "kg_recall_association_library_v1__subject__subject-pmp"
PROJECTION_KEYS = {"kg_principle_repository_v1", "kg_synthesis_preset_repository_v1"}


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
    keys = {
        TAXONOMY_KEY,
        TAG_KEY,
        ACTIVITY_KEY,
        RECALL_KEY,
        teaching_content_revision_service.REVISION_KEY,
        *PROJECTION_KEYS,
    }

    async def seed() -> None:
        nonlocal previous_active_tag_id, subject_metadata_snapshot, recall_snapshot
        async with AsyncSessionLocal() as db:
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
            response = client.post(
                "/api/v1/content-prep/principles/delete",
                json={"ids": [principle_id]},
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
