from __future__ import annotations

import asyncio
import json
from uuid import uuid4

import pytest

from fastapi.testclient import TestClient
from sqlalchemy import delete, func, select

from app.core.security import hash_password
from app.db.session import AsyncSessionLocal
from app.main import app
from app.models.paper_release import PaperRelease, PaperReleaseQuestion
from app.models.question import ExamPaper, Question, QuestionBank
from app.models.shared_runtime_state import SharedRuntimeState
from app.models.teaching_content import ContentSubject, RecallAssociationLibrary
from app.models.training import (
    RecallLibrarySnapshot,
    RecallProgress,
    RecallQuestionSnapshot,
)
from app.models.user import User
from app.services.teaching_content_current_service import set_current_recall_library


PASSWORD = "deep-recall-pass"
RECALL_KEY = "kg_recall_association_library_v1__subject__subject-pmp"
PUBLISHED_PAPERS_KEY = "kg_exam_papers_published_v1"


def _login(client: TestClient, username: str) -> None:
    response = client.post(
        "/api/v1/auth/login",
        json={"username": username, "password": PASSWORD},
    )
    assert response.status_code == 200, response.text


def _graph_payload(session: dict, title: str = "我的口诀") -> dict:
    return {
        "expectedRevision": session["progressRevision"],
        "questionRevision": session["currentQuestion"]["revision"],
        "libraryHash": session["library"]["contentHash"],
        "graphSchemaVersion": 3,
        "nodes": [
            {
                "instanceId": "node-personal-1",
                "dataId": "personal:node-1",
                "title": title,
                "custom": True,
            }
        ],
        "edges": [],
        "customNodes": {
            "personal:node-1": {"title": title, "aliases": []},
        },
        "activeKeywords": ["keyword-1"],
        "choiceOffsets": {},
        "transform": {"x": 12, "y": -4, "scale": 1},
        "metrics": {"keywordClicks": 1},
    }


def test_recall_progress_is_owner_isolated_revision_checked_and_library_read_only() -> None:
    suffix = uuid4().hex[:10]
    teacher = f"recall-teacher-{suffix}"
    student_a = f"recall-student-a-{suffix}"
    student_b = f"recall-student-b-{suffix}"
    bank_id = f"recall-bank-{suffix}"
    question_id = f"recall-question-{suffix}"
    recall_library_id = f"recall-library-{suffix}"
    previous_recall: dict | None = None
    previous_subject_metadata: dict | None = None

    async def seed() -> None:
        nonlocal previous_recall, previous_subject_metadata
        async with AsyncSessionLocal() as db:
            row = await db.get(SharedRuntimeState, RECALL_KEY)
            if row is not None:
                previous_recall = {
                    "value": row.value,
                    "schema_version": row.schema_version,
                    "updated_by": row.updated_by,
                    "created_at": row.created_at,
                    "updated_at": row.updated_at,
                }
            db.add_all(
                [
                    User(username=teacher, password_hash=hash_password(PASSWORD), role="teacher", status="active", subject="PMP"),
                    User(username=student_a, password_hash=hash_password(PASSWORD), role="student", status="active", subject="PMP"),
                    User(username=student_b, password_hash=hash_password(PASSWORD), role="student", status="active", subject="PMP"),
                ]
            )
            await db.flush()
            db.add(
                QuestionBank(
                    id=bank_id,
                    owner_id=teacher,
                    name="深度回忆公开题库",
                    subject="PMP",
                    visibility="published",
                )
            )
            await db.flush()
            db.add(
                Question(
                    id=question_id,
                    bank_id=bank_id,
                    title="风险发生后应该先做什么？",
                    subject="PMP",
                    scope="public",
                    revision=1,
                    content_hash="a" * 64,
                    stem_parts=[{"text": "风险发生后应该先分析影响。"}],
                    concepts=[{"id": "keyword-1", "title": "分析影响", "isCore": True}],
                )
            )
            recall_payload = {
                "schemaVersion": 1,
                "nodes": [
                    {
                        "id": "recall:impact-analysis",
                        "title": "影响分析",
                        "english": "impact analysis",
                        "aliases": ["影响评估"],
                    }
                ],
                "edges": [],
                "updatedAt": "2026-08-14T00:00:00Z",
            }
            subject = await db.get(ContentSubject, "subject-pmp")
            if subject is None:
                subject = ContentSubject(id="subject-pmp", code="PMP", name="PMP", content_metadata={})
                db.add(subject)
                await db.flush()
            previous_subject_metadata = dict(subject.content_metadata or {})
            latest_version = int(
                (
                    await db.execute(
                        select(func.max(RecallAssociationLibrary.version)).where(
                            RecallAssociationLibrary.subject_id == "subject-pmp"
                        )
                    )
                ).scalar_one_or_none()
                or 0
            )
            db.add(RecallAssociationLibrary(id=recall_library_id, subject_id="subject-pmp", version=latest_version + 1, status="published", nodes=recall_payload["nodes"], edges=recall_payload["edges"], content_metadata=recall_payload, updated_by=teacher))
            set_current_recall_library(subject, recall_library_id)
            await db.commit()

    async def cleanup() -> None:
        async with AsyncSessionLocal() as db:
            await db.execute(delete(RecallProgress).where(RecallProgress.question_id == question_id))
            await db.execute(delete(RecallQuestionSnapshot).where(RecallQuestionSnapshot.question_id == question_id))
            await db.execute(delete(RecallLibrarySnapshot).where(RecallLibrarySnapshot.subject == "subject-pmp"))
            await db.execute(delete(Question).where(Question.id == question_id))
            await db.execute(delete(QuestionBank).where(QuestionBank.id == bank_id))
            await db.execute(
                delete(RecallAssociationLibrary).where(
                    RecallAssociationLibrary.id == recall_library_id
                )
            )
            subject = await db.get(ContentSubject, "subject-pmp")
            if subject is not None and previous_subject_metadata is not None:
                subject.content_metadata = previous_subject_metadata
            await db.execute(delete(SharedRuntimeState).where(SharedRuntimeState.key == RECALL_KEY))
            if previous_recall is not None:
                db.add(SharedRuntimeState(key=RECALL_KEY, **previous_recall))
            await db.execute(delete(User).where(User.username.in_([teacher, student_a, student_b])))
            await db.commit()

    asyncio.run(seed())
    try:
        with TestClient(app) as first, TestClient(app) as second:
            _login(first, student_a)
            _login(second, student_b)

            session_response = first.get(f"/api/v1/recall/session/{question_id}")
            assert session_response.status_code == 200, session_response.text
            session = session_response.json()
            assert session["versionState"] == "current"
            assert session["progressRevision"] == 0
            assert session["currentQuestion"]["revision"] == 1
            assert session["library"]["payload"]["nodes"][0]["id"] == "recall:impact-analysis"
            library_before = first.get("/api/v1/recall/libraries/PMP")
            assert library_before.status_code == 200, library_before.text

            body = _graph_payload(session)
            saved = first.put(f"/api/v1/recall/progress/{question_id}", json=body)
            assert saved.status_code == 200, saved.text
            assert saved.json()["revision"] == 1
            assert saved.json()["nodes"][0]["title"] == "我的口诀"

            conflict = first.put(f"/api/v1/recall/progress/{question_id}", json=body)
            assert conflict.status_code == 409
            assert conflict.json()["detail"]["code"] == "recall_revision_conflict"

            other = second.get(f"/api/v1/recall/session/{question_id}")
            assert other.status_code == 200, other.text
            assert other.json()["progress"]["nodes"] == []
            assert other.json()["progressRevision"] == 0

            library_after = first.get("/api/v1/recall/libraries/PMP")
            assert library_after.status_code == 200
            assert library_after.json() == library_before.json()
    finally:
        asyncio.run(cleanup())


def test_published_paper_grants_recall_access_to_private_bank_question() -> None:
    suffix = uuid4().hex[:10]
    teacher = f"recall-paper-teacher-{suffix}"
    student = f"recall-paper-student-{suffix}"
    bank_id = f"recall-paper-bank-{suffix}"
    question_id = f"recall-paper-question-{suffix}"
    paper_id = f"recall-paper-{suffix}"
    release_id = f"recall-release-{suffix}"
    previous_shared: dict[str, dict] = {}

    async def seed() -> None:
        async with AsyncSessionLocal() as db:
            for key in (RECALL_KEY, PUBLISHED_PAPERS_KEY):
                row = await db.get(SharedRuntimeState, key)
                if row is not None:
                    previous_shared[key] = {
                        "value": row.value,
                        "schema_version": row.schema_version,
                        "updated_by": row.updated_by,
                        "created_at": row.created_at,
                        "updated_at": row.updated_at,
                    }
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
                ]
            )
            await db.flush()
            db.add(
                QuestionBank(
                    id=bank_id,
                    owner_id=teacher,
                    name="仅教师可见题库",
                    subject="PMP",
                    visibility="private",
                )
            )
            await db.flush()
            db.add(
                Question(
                    id=question_id,
                    bank_id=bank_id,
                    title="已发布试卷中的私有源题目",
                    subject="PMP",
                    scope="internal",
                    revision=1,
                    content_hash="e" * 64,
                    stem_parts=[{"text": "发布试卷应授予该题学习权限。"}],
                )
            )
            recall_payload = {
                "schemaVersion": 1,
                "nodes": [],
                "edges": [],
                "updatedAt": "2026-08-14T00:00:00Z",
            }
            published_payload = [
                {
                    "paperId": paper_id,
                    "releaseId": release_id,
                    "name": "已发布深度回忆试卷",
                    "status": "published",
                    "enabledModes": ["deep_recall"],
                    "accessPolicy": {"accessLevel": "free"},
                    "publishedBy": teacher,
                    "questions": [
                        {
                            "bankId": bank_id,
                            "questionId": question_id,
                            "order": 1,
                        }
                    ],
                    "questionSnapshots": [
                        {
                            "bankId": bank_id,
                            "questionId": question_id,
                            "bankName": "仅教师可见题库",
                            "bankSubject": "PMP",
                            "question": {
                                "id": question_id,
                                "bankId": bank_id,
                                "title": "已发布试卷中的私有源题目",
                                "subject": "PMP",
                                "scope": "internal",
                                "revision": 1,
                                "contentHash": "e" * 64,
                                "stemParts": [
                                    {"text": "发布试卷应授予该题学习权限。"}
                                ],
                            },
                        }
                    ],
                }
            ]
            db.add(ExamPaper(
                id=paper_id, owner_id=teacher, name="已发布深度回忆试卷",
                subject="PMP", status="published",
            ))
            await db.flush()
            db.add(PaperRelease(
                id=release_id, paper_id=paper_id, version=1, status="published",
                name="已发布深度回忆试卷", subject="PMP", publisher_id=teacher,
                access_level="free", enabled_modes=["deep_recall"],
                allowed_roles=["student"], question_count=1,
            ))
            await db.flush()
            db.add(PaperReleaseQuestion(
                release_id=release_id, order_index=0, bank_id=bank_id,
                question_id=question_id,
                snapshot=published_payload[0]["questionSnapshots"][0]["question"],
            ))
            for key, payload in (
                (RECALL_KEY, recall_payload),
                (PUBLISHED_PAPERS_KEY, published_payload),
            ):
                row = await db.get(SharedRuntimeState, key)
                value = json.dumps(payload, ensure_ascii=False)
                if row is None:
                    db.add(
                        SharedRuntimeState(
                            key=key,
                            value=value,
                            updated_by=teacher,
                        )
                    )
                else:
                    row.value = value
                    row.updated_by = teacher
            await db.commit()

    async def cleanup() -> None:
        async with AsyncSessionLocal() as db:
            await db.execute(delete(RecallProgress).where(
                RecallProgress.question_id == question_id
            ))
            await db.execute(
                delete(RecallQuestionSnapshot).where(
                    RecallQuestionSnapshot.question_id == question_id
                )
            )
            await db.execute(delete(Question).where(Question.id == question_id))
            await db.execute(delete(QuestionBank).where(QuestionBank.id == bank_id))
            for key in (RECALL_KEY, PUBLISHED_PAPERS_KEY):
                await db.execute(
                    delete(SharedRuntimeState).where(SharedRuntimeState.key == key)
                )
                if key in previous_shared:
                    db.add(SharedRuntimeState(key=key, **previous_shared[key]))
            await db.execute(delete(PaperReleaseQuestion).where(PaperReleaseQuestion.release_id == release_id))
            await db.execute(delete(PaperRelease).where(PaperRelease.id == release_id))
            await db.execute(delete(ExamPaper).where(ExamPaper.id == paper_id))
            await db.execute(delete(User).where(User.username.in_([teacher, student])))
            await db.commit()

    asyncio.run(seed())
    try:
        with TestClient(app) as client:
            _login(client, student)
            response = client.get(
                f"/api/v1/recall/session/{question_id}?releaseId={release_id}"
            )
            assert response.status_code == 200, response.text
            body = response.json()
            assert body["questionId"] == question_id
            assert body["bankId"] == bank_id
            assert body["currentQuestion"]["title"] == "已发布试卷中的私有源题目"

            async def seed_legacy_progress():
                async with AsyncSessionLocal() as db:
                    db.add(RecallProgress(
                        owner_id=student,question_id=question_id,bank_id=bank_id,
                        source_question_revision=1,source_content_hash="e" * 64,
                        recall_library_hash=body["library"]["contentHash"],revision=3,
                        nodes=[{"instanceId":"legacy-node","dataId":"personal:legacy","title":"旧版存量节点","custom":True}],
                        edges=[],custom_nodes={"personal:legacy":{"title":"旧版存量节点"}},
                    ))
                    await db.commit()
            asyncio.run(seed_legacy_progress())
            body = client.get(f"/api/v1/recall/session/{question_id}?releaseId={release_id}").json()
            assert body["progress"]["nodes"][0]["title"] == "旧版存量节点"
            assert body["progressRevision"] == 3

            async def remove_scoped_progress():
                async with AsyncSessionLocal() as db:
                    await db.execute(delete(RecallProgress).where(RecallProgress.owner_id==student,RecallProgress.question_id==question_id,RecallProgress.release_id==release_id))
                    await db.commit()

            async def race_first_write(reset_second):
                from fastapi import HTTPException
                from app.services import deep_recall_service
                from app.schemas.deep_recall import RecallProgressSaveRequest, RecallProgressResetRequest
                gate=asyncio.Event()
                async def write(reset):
                    async with AsyncSessionLocal() as db:
                        user=await db.get(User,student)
                        await gate.wait()
                        try:
                            if reset:
                                await deep_recall_service.reset_progress(db,user,question_id,RecallProgressResetRequest(expectedRevision=3,targetQuestionRevision=1),release_id=release_id)
                            else:
                                await deep_recall_service.save_progress(db,user,question_id,RecallProgressSaveRequest.model_validate(_graph_payload(body,"并发首次派生")),release_id=release_id)
                            return 200
                        except HTTPException as error:
                            await db.rollback()
                            return error.status_code
                operations=[asyncio.create_task(write(False)),asyncio.create_task(write(reset_second))]
                gate.set()
                assert sorted(await asyncio.gather(*operations)) == [200,409]
                async with AsyncSessionLocal() as db:
                    scoped=(await db.execute(select(RecallProgress).where(RecallProgress.owner_id==student,RecallProgress.question_id==question_id,RecallProgress.release_id==release_id))).scalars().all()
                    assert len(scoped)==1 and scoped[0].revision==4
                    legacy=(await db.execute(select(RecallProgress).where(RecallProgress.owner_id==student,RecallProgress.question_id==question_id,RecallProgress.release_id.is_(None)))).scalar_one()
                    assert legacy.revision==3 and legacy.nodes[0]["title"]=="旧版存量节点"
            for reset_second in (False,True):
                asyncio.run(race_first_write(reset_second))
                asyncio.run(remove_scoped_progress())
            first_reset=client.post(f"/api/v1/recall/progress/{question_id}/reset?releaseId={release_id}",json={"expectedRevision":3,"targetQuestionRevision":1})
            assert first_reset.status_code==200,first_reset.text
            assert first_reset.json()["revision"]==4 and first_reset.json()["nodes"]==[]
            asyncio.run(remove_scoped_progress())

            async def set_ambiguous(enabled):
                async with AsyncSessionLocal() as db:
                    if enabled:
                        db.add(PaperRelease(id=release_id+"-other",paper_id=paper_id,version=2,status="withdrawn",name="第二份同题发布",subject="PMP",publisher_id=teacher,access_level="free",enabled_modes=["deep_recall"],allowed_roles=["student"],question_count=1))
                        await db.flush()
                        db.add(PaperReleaseQuestion(release_id=release_id+"-other",order_index=0,bank_id=bank_id,question_id=question_id,snapshot=body["currentQuestion"]))
                    else:
                        await db.execute(delete(PaperReleaseQuestion).where(PaperReleaseQuestion.release_id==release_id+"-other"))
                        await db.execute(delete(PaperRelease).where(PaperRelease.id==release_id+"-other"))
                    await db.commit()
            asyncio.run(set_ambiguous(True))
            ambiguous=client.get(f"/api/v1/recall/session/{question_id}?releaseId={release_id}").json()
            assert ambiguous["progress"]["nodes"] == []
            assert ambiguous["progressRevision"] == 0
            asyncio.run(set_ambiguous(False))

            async def set_legacy_hash(value):
                async with AsyncSessionLocal() as db:
                    legacy=(await db.execute(select(RecallProgress).where(RecallProgress.owner_id==student,RecallProgress.question_id==question_id,RecallProgress.release_id.is_(None)))).scalar_one()
                    legacy.source_content_hash=value
                    await db.commit()
            asyncio.run(set_legacy_hash("f" * 64))
            incompatible=client.get(f"/api/v1/recall/session/{question_id}?releaseId={release_id}").json()
            assert incompatible["progress"]["nodes"] == []
            asyncio.run(set_legacy_hash("e" * 64))
            async def set_legacy_library_hash(value):
                async with AsyncSessionLocal() as db:
                    legacy=(await db.execute(select(RecallProgress).where(RecallProgress.owner_id==student,RecallProgress.question_id==question_id,RecallProgress.release_id.is_(None)))).scalar_one()
                    legacy.recall_library_hash=value
                    await db.commit()
            asyncio.run(set_legacy_library_hash("0" * 64))
            outdated=client.get(f"/api/v1/recall/session/{question_id}?releaseId={release_id}").json()
            assert outdated["versionState"]=="mismatch"
            assert outdated["permissions"]["canWrite"] is False
            assert outdated["progress"]["nodes"][0]["title"]=="旧版存量节点"
            asyncio.run(set_legacy_library_hash(body["library"]["contentHash"]))
            saved = client.put(
                f"/api/v1/recall/progress/{question_id}?releaseId={release_id}",
                json=_graph_payload(body, "发布版本节点"),
            )
            assert saved.status_code == 200, saved.text
            assert saved.json()["revision"] == 4
            async def assert_legacy_preserved():
                async with AsyncSessionLocal() as db:
                    legacy=(await db.execute(select(RecallProgress).where(RecallProgress.owner_id==student,RecallProgress.question_id==question_id,RecallProgress.release_id.is_(None)))).scalar_one()
                    assert legacy.nodes[0]["title"] == "旧版存量节点"
                    assert legacy.revision == 3
            asyncio.run(assert_legacy_preserved())
            resumed = client.get(
                f"/api/v1/recall/session/{question_id}?releaseId={release_id}"
            )
            assert resumed.status_code == 200, resumed.text
            assert resumed.json()["progress"]["nodes"][0]["title"] == "发布版本节点"
            ordinary = client.get(f"/api/v1/recall/session/{question_id}")
            assert ordinary.status_code == 404
            reset = client.post(
                f"/api/v1/recall/progress/{question_id}/reset?releaseId={release_id}",
                json={
                    "expectedRevision": resumed.json()["progressRevision"],
                    "targetQuestionRevision": body["currentQuestion"]["revision"],
                },
            )
            assert reset.status_code == 200, reset.text
            assert reset.json()["revision"] == 5
            assert reset.json()["nodes"] == []
    finally:
        asyncio.run(cleanup())


def test_published_snapshot_is_projected_before_recall_session() -> None:
    suffix = uuid4().hex[:10]
    teacher = f"recall-project-teacher-{suffix}"
    student = f"recall-project-student-{suffix}"
    bank_id = f"recall-project-bank-{suffix}"
    question_id = f"recall-project-question-{suffix}"
    previous_shared: dict[str, dict] = {}

    async def seed() -> None:
        async with AsyncSessionLocal() as db:
            for key in (RECALL_KEY, PUBLISHED_PAPERS_KEY):
                row = await db.get(SharedRuntimeState, key)
                if row is not None:
                    previous_shared[key] = {
                        "value": row.value,
                        "schema_version": row.schema_version,
                        "updated_by": row.updated_by,
                        "created_at": row.created_at,
                        "updated_at": row.updated_at,
                    }
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
                ]
            )
            await db.flush()
            recall_payload = {
                "schemaVersion": 1,
                "nodes": [],
                "edges": [],
                "updatedAt": "2026-08-14T00:00:00Z",
            }
            published_payload = [
                {
                    "paperId": f"recall-project-paper-{suffix}",
                    "releaseId": f"recall-project-release-{suffix}",
                    "name": "存量发布试卷",
                    "status": "published",
                    "enabledModes": ["deep_recall"],
                    "accessPolicy": {"accessLevel": "free"},
                    "publishedBy": {
                        "id": teacher,
                        "username": teacher,
                        "role": "teacher",
                    },
                    "questions": [
                        {
                            "bankId": bank_id,
                            "questionId": question_id,
                            "order": 1,
                        }
                    ],
                    "questionSnapshots": [
                        {
                            "bankId": bank_id,
                            "questionId": question_id,
                            "bankName": "存量快照题库",
                            "bankSubject": "PMP",
                            "question": {
                                "id": question_id,
                                "bankId": bank_id,
                                "title": "仅存在于存量发布快照中的题目",
                                "type": "single_choice",
                                "subject": "PMP",
                                "difficulty": "medium",
                                "revision": 3,
                                "contentHash": "f" * 64,
                                "stemParts": [{"text": "存量快照需要投影到数据库。"}],
                                "options": [
                                    {"id": "A", "text": "正确", "correct": True},
                                    {"id": "B", "text": "错误", "correct": False},
                                ],
                                "correctAnswer": "A",
                                "lifecycle": {"status": "active"},
                            },
                        }
                    ],
                }
            ]
            for key, payload in (
                (RECALL_KEY, recall_payload),
                (PUBLISHED_PAPERS_KEY, published_payload),
            ):
                row = await db.get(SharedRuntimeState, key)
                value = json.dumps(payload, ensure_ascii=False)
                if row is None:
                    db.add(
                        SharedRuntimeState(
                            key=key,
                            value=value,
                            updated_by=teacher,
                        )
                    )
                else:
                    row.value = value
                    row.updated_by = teacher
            await db.commit()

    async def assert_projection() -> None:
        async with AsyncSessionLocal() as db:
            bank = await db.get(QuestionBank, bank_id)
            question = await db.get(Question, question_id)
            assert bank is None
            assert question is None

    async def cleanup() -> None:
        async with AsyncSessionLocal() as db:
            await db.execute(
                delete(RecallQuestionSnapshot).where(
                    RecallQuestionSnapshot.question_id == question_id
                )
            )
            await db.execute(delete(Question).where(Question.id == question_id))
            await db.execute(delete(QuestionBank).where(QuestionBank.id == bank_id))
            for key in (RECALL_KEY, PUBLISHED_PAPERS_KEY):
                await db.execute(
                    delete(SharedRuntimeState).where(SharedRuntimeState.key == key)
                )
                if key in previous_shared:
                    db.add(SharedRuntimeState(key=key, **previous_shared[key]))
            await db.execute(delete(User).where(User.username.in_([teacher, student])))
            await db.commit()

    asyncio.run(seed())
    try:
        with TestClient(app) as client:
            _login(client, student)
            response = client.get(f"/api/v1/recall/session/{question_id}")
            assert response.status_code == 404
            assert response.json()["detail"]["code"] == "recall_question_not_found"
        asyncio.run(assert_projection())
    finally:
        asyncio.run(cleanup())


def test_question_revision_change_requires_explicit_reset_and_viewer_is_read_only() -> None:
    suffix = uuid4().hex[:10]
    teacher = f"recall-version-teacher-{suffix}"
    student = f"recall-version-student-{suffix}"
    viewer = f"recall-version-viewer-{suffix}"
    bank_id = f"recall-version-bank-{suffix}"
    question_id = f"recall-version-question-{suffix}"

    async def seed() -> None:
        async with AsyncSessionLocal() as db:
            db.add_all(
                [
                    User(username=teacher, password_hash=hash_password(PASSWORD), role="teacher", status="active", subject="PMP"),
                    User(username=student, password_hash=hash_password(PASSWORD), role="student", status="active", subject="PMP"),
                    User(username=viewer, password_hash=hash_password(PASSWORD), role="viewer", status="active", subject="PMP"),
                ]
            )
            await db.flush()
            db.add(QuestionBank(id=bank_id, owner_id=teacher, name="版本题库", subject="PMP", visibility="published"))
            await db.flush()
            db.add(
                Question(
                    id=question_id,
                    bank_id=bank_id,
                    title="版本一题目",
                    subject="PMP",
                    scope="public",
                    revision=1,
                    content_hash="b" * 64,
                )
            )
            await db.commit()

    async def bump() -> None:
        async with AsyncSessionLocal() as db:
            question = await db.get(Question, question_id)
            assert question is not None
            source_library = (
                await db.execute(
                    select(RecallLibrarySnapshot).where(
                        RecallLibrarySnapshot.subject == "subject-pmp"
                    )
                )
            ).scalars().first()
            assert source_library is not None
            db.add(
                RecallLibrarySnapshot(
                    id=str(uuid4()),
                    subject=f"subject-other-{suffix}",
                    content_hash=source_library.content_hash,
                    payload=source_library.payload,
                    source_revision=source_library.source_revision,
                )
            )
            question.title = "版本二题目"
            question.revision = 2
            question.content_hash = "c" * 64
            await db.commit()

    async def cleanup() -> None:
        async with AsyncSessionLocal() as db:
            await db.execute(delete(RecallProgress).where(RecallProgress.question_id == question_id))
            await db.execute(delete(RecallQuestionSnapshot).where(RecallQuestionSnapshot.question_id == question_id))
            await db.execute(
                delete(RecallLibrarySnapshot).where(
                    RecallLibrarySnapshot.subject == f"subject-other-{suffix}"
                )
            )
            await db.execute(delete(Question).where(Question.id == question_id))
            await db.execute(delete(QuestionBank).where(QuestionBank.id == bank_id))
            await db.execute(delete(User).where(User.username.in_([teacher, student, viewer])))
            await db.commit()

    asyncio.run(seed())
    try:
        with TestClient(app) as learner:
            _login(learner, student)
            original = learner.get(f"/api/v1/recall/session/{question_id}").json()
            saved = learner.put(
                f"/api/v1/recall/progress/{question_id}",
                json=_graph_payload(original, "旧版本节点"),
            )
            assert saved.status_code == 200, saved.text
            asyncio.run(bump())

            mismatch = learner.get(f"/api/v1/recall/session/{question_id}")
            assert mismatch.status_code == 200, mismatch.text
            body = mismatch.json()
            assert body["versionState"] == "mismatch"
            assert body["historyQuestion"]["title"] == "版本一题目"
            assert body["currentQuestion"]["title"] == "版本二题目"
            assert body["progress"]["readOnly"] is True
            overwrite = learner.put(
                f"/api/v1/recall/progress/{question_id}",
                json=_graph_payload(body, "不得覆盖历史图"),
            )
            assert overwrite.status_code == 409, overwrite.text
            assert overwrite.json()["detail"]["code"] == "recall_history_requires_reset"
            preserved = learner.get(f"/api/v1/recall/session/{question_id}").json()
            assert preserved["progress"]["nodes"][0]["title"] == "旧版本节点"
            assert preserved["progressRevision"] == body["progressRevision"]

            reset = learner.post(
                f"/api/v1/recall/progress/{question_id}/reset",
                json={
                    "expectedRevision": body["progressRevision"],
                    "targetQuestionRevision": 2,
                },
            )
            assert reset.status_code == 200, reset.text
            assert reset.json()["revision"] == 2
            assert reset.json()["nodes"] == []
            current = learner.get(f"/api/v1/recall/session/{question_id}").json()
            assert current["versionState"] == "current"
            assert current["historyQuestion"] is None

        with TestClient(app) as read_only:
            _login(read_only, viewer)
            session = read_only.get(f"/api/v1/recall/session/{question_id}")
            assert session.status_code == 200
            assert session.json()["permissions"]["canWrite"] is False
            denied = read_only.put(
                f"/api/v1/recall/progress/{question_id}",
                json=_graph_payload(session.json()),
            )
            assert denied.status_code == 403
    finally:
        asyncio.run(cleanup())


@pytest.mark.parametrize('role,node_count,limit,status', [
    ('student', 31, 30, 422),
    ('teacher', 495, None, 200),
])
def test_recall_node_quota_applies_only_to_free_students(role, node_count, limit, status) -> None:
    suffix = uuid4().hex[:10]
    teacher = f"recall-limit-teacher-{suffix}"
    student = f"recall-limit-student-{suffix}"
    bank_id = f"recall-limit-bank-{suffix}"
    question_id = f"recall-limit-question-{suffix}"

    async def seed() -> None:
        async with AsyncSessionLocal() as db:
            db.add_all(
                [
                    User(username=teacher, password_hash=hash_password(PASSWORD), role="teacher", status="active"),
                    User(username=student, password_hash=hash_password(PASSWORD), role="student", status="active"),
                ]
            )
            await db.flush()
            db.add(QuestionBank(id=bank_id, owner_id=teacher, name="限额题库", subject="PMP", visibility="published"))
            await db.flush()
            db.add(Question(id=question_id, bank_id=bank_id, title="限额题", subject="PMP", scope="public", revision=1, content_hash="d" * 64))
            await db.commit()

    async def cleanup() -> None:
        async with AsyncSessionLocal() as db:
            await db.execute(delete(RecallProgress).where(RecallProgress.question_id == question_id))
            await db.execute(delete(RecallQuestionSnapshot).where(RecallQuestionSnapshot.question_id == question_id))
            await db.execute(delete(Question).where(Question.id == question_id))
            await db.execute(delete(QuestionBank).where(QuestionBank.id == bank_id))
            await db.execute(delete(User).where(User.username.in_([teacher, student])))
            await db.commit()

    asyncio.run(seed())
    try:
        with TestClient(app) as client:
            _login(client, teacher if role == 'teacher' else student)
            session = client.get(f"/api/v1/recall/session/{question_id}").json()
            assert session["nodeLimit"] == limit
            body = _graph_payload(session)
            body["nodes"] = [
                {"instanceId": f"node-{index}", "dataId": f"personal:{index}", "title": str(index), "custom": True}
                for index in range(node_count)
            ]
            body["customNodes"] = {
                f"personal:{index}": {"title": str(index)} for index in range(node_count)
            }
            response = client.put(f"/api/v1/recall/progress/{question_id}", json=body)
            assert response.status_code == status, response.text
            if status == 422:
                assert response.json()["detail"]["code"] == "recall_node_limit"
            else:
                saved = client.get(f"/api/v1/recall/session/{question_id}").json()
                assert len(saved['progress']['nodes']) == node_count
    finally:
        asyncio.run(cleanup())
