"""关系化发布试卷的冻结版本、访问控制和按版本取题契约。"""

import asyncio
import json
import time
from datetime import timedelta
from uuid import uuid4

import pytest
from fastapi import HTTPException
from fastapi.testclient import TestClient
from sqlalchemy import delete, event, func, select

from app.core.security import hash_password, now_utc
from app.db.session import AsyncSessionLocal, engine
from app.main import app
from app.models.paper_release import PaperRelease, PaperReleaseQuestion
from app.models.question import ExamPaper, PaperQuestion, Question, QuestionBank
from app.models.subscription import Subscription
from app.models.training import LearningEvent, PracticeMistake, RecallProgress, RecallQuestionSnapshot, TrainingProgress
from app.models.user import User, UserAdminLog
from app.services import (
    deep_recall_service,
    learning_service,
    paper_release_service,
    published_paper_access_service,
)


def _ids() -> dict[str, str]:
    token = uuid4().hex[:10]
    return {
        "teacher": f"release-teacher-{token}",
        "student": f"release-student-{token}",
        "other_teacher": f"release-other-teacher-{token}",
        "bank": f"rb-{token}",
        "paper": f"rp-{token}",
        "other_paper": f"ro-{token}",
    }


async def _seed(ids: dict[str, str]) -> None:
    async with AsyncSessionLocal() as db:
        db.add_all(
            [
                User(username=ids["teacher"], password_hash="unused", role="teacher", status="active"),
                User(username=ids["student"], password_hash="unused", role="student", status="active"),
                User(username=ids["other_teacher"], password_hash="unused", role="teacher", status="active"),
            ]
        )
        await db.flush()
        db.add_all(
            [
                QuestionBank(
                    id=ids["bank"], owner_id=ids["teacher"], name="发布题库",
                    subject="PMP", created_by=ids["teacher"], updated_by=ids["teacher"],
                ),
                ExamPaper(
                    id=ids["paper"], owner_id=ids["teacher"], name="冻结试卷",
                    subject="PMP", created_by=ids["teacher"], updated_by=ids["teacher"],
                ),
                ExamPaper(
                    id=ids["other_paper"], owner_id=ids["teacher"], name="另一试卷",
                    subject="PMP", created_by=ids["teacher"], updated_by=ids["teacher"],
                ),
            ]
        )
        await db.flush()
        questions = []
        for index in range(6):
            question_id = f"rq-{index}-{ids['bank'][3:]}"
            question = Question(
                id=question_id, bank_id=ids["bank"], source_id=question_id,
                title=f"冻结题目 {index}", subject="PMP", scope="internal",
                stem_parts=[{"text": f"题干 {index}"}],
                options=[
                    {"id": "A", "text": "答案", "correct": True},
                    {"id": "B", "text": "干扰项", "correct": False},
                ],
                correct_answer="A",
                analysis="题目解析",
                content_metadata={
                    "subjectFacets": [
                        {
                            "dimensionId": "exam-domain",
                            "valueId": "process" if index in {0, 3, 4} else "people",
                        }
                    ]
                },
                created_by=ids["teacher"], updated_by=ids["teacher"],
            )
            db.add(question)
            questions.append(question)
        await db.flush()
        for index, question in enumerate(questions):
            db.add(PaperQuestion(paper_id=ids["paper"], question_id=question.id, order_index=index))
        db.add(PaperQuestion(paper_id=ids["other_paper"], question_id=questions[0].id, order_index=0))
        await db.commit()


async def _cleanup(ids: dict[str, str]) -> None:
    async with AsyncSessionLocal() as db:
        release_ids = [
            str(release_id)
            for release_id in (
                await db.scalars(
                    select(PaperRelease.id).where(
                        PaperRelease.paper_id.in_([ids["paper"], ids["other_paper"]])
                    )
                )
            ).all()
        ]
        if release_ids:
            await db.execute(delete(LearningEvent).where(
                LearningEvent.payload["releaseId"].astext.in_(release_ids)
            ))
            await db.execute(delete(PracticeMistake).where(PracticeMistake.release_id.in_(release_ids)))
            await db.execute(delete(TrainingProgress).where(TrainingProgress.release_id.in_(release_ids)))
            await db.execute(delete(RecallProgress).where(RecallProgress.release_id.in_(release_ids)))
            await db.execute(delete(RecallQuestionSnapshot).where(
                RecallQuestionSnapshot.release_id.in_(release_ids)
            ))
            await db.execute(delete(PaperReleaseQuestion).where(PaperReleaseQuestion.release_id.in_(release_ids)))
        await db.execute(delete(PaperRelease).where(PaperRelease.paper_id.in_([ids["paper"], ids["other_paper"]])))
        await db.execute(delete(PracticeMistake).where(PracticeMistake.owner_id == ids["teacher"]))
        await db.execute(delete(TrainingProgress).where(TrainingProgress.owner_id == ids["teacher"]))
        await db.execute(delete(PaperQuestion).where(PaperQuestion.paper_id.in_([ids["paper"], ids["other_paper"]])))
        await db.execute(delete(Question).where(Question.bank_id == ids["bank"]))
        await db.execute(delete(ExamPaper).where(ExamPaper.id.in_([ids["paper"], ids["other_paper"]])))
        await db.execute(delete(QuestionBank).where(QuestionBank.id == ids["bank"]))
        await db.execute(delete(Subscription).where(Subscription.username == ids["student"]))
        await db.execute(delete(User).where(User.username.in_([ids["teacher"], ids["student"], ids["other_teacher"]])))
        await db.commit()


def test_publish_and_withdraw_share_advisory_before_row_lock_order() -> None:
    ids = _ids()
    asyncio.run(_seed(ids))

    async def scenario() -> float:
        async with AsyncSessionLocal() as setup:
            teacher = await setup.get(User, ids["teacher"])
            release = await paper_release_service.publish(
                setup,
                teacher,
                ids["paper"],
                expected_revision=1,
                access_level="free",
                enabled_modes=["practice_mode"],
                allowed_roles=["teacher"],
                metadata={},
            )

        started = time.monotonic()
        async with AsyncSessionLocal() as first_db, AsyncSessionLocal() as second_db:
            first_teacher = await first_db.get(User, ids["teacher"])
            second_teacher = await second_db.get(User, ids["teacher"])

            async def withdraw_current() -> str:
                try:
                    result = await paper_release_service.withdraw(
                        first_db, first_teacher, release.id, expected_revision=2
                    )
                    return result.status
                except HTTPException as error:
                    assert error.status_code == 409
                    await first_db.rollback()
                    return "conflict"

            async def publish_next() -> str:
                try:
                    result = await paper_release_service.publish(
                        second_db,
                        second_teacher,
                        ids["paper"],
                        expected_revision=2,
                        access_level="free",
                        enabled_modes=["practice_mode"],
                        allowed_roles=["teacher"],
                        metadata={},
                    )
                    return result.status
                except HTTPException as error:
                    assert error.status_code == 409
                    await second_db.rollback()
                    return "conflict"

            results = await asyncio.wait_for(
                asyncio.gather(withdraw_current(), publish_next()), timeout=3
            )
            assert sorted(results) in (["conflict", "published"], ["conflict", "withdrawn"])
        return time.monotonic() - started

    try:
        elapsed = asyncio.run(scenario())
        assert elapsed < 3
    finally:
        asyncio.run(_cleanup(ids))


def test_publish_freezes_default_scoring_and_actual_domain_weights() -> None:
    ids = _ids()
    asyncio.run(_seed(ids))

    async def scenario() -> None:
        async with AsyncSessionLocal() as db:
            teacher = await db.get(User, ids["teacher"])
            release = await paper_release_service.publish(
                db,
                teacher,
                ids["paper"],
                expected_revision=1,
                access_level="free",
                enabled_modes=["practice_mode"],
                allowed_roles=["student"],
                metadata={"source": "teacher-publish"},
            )
            assert release.release_metadata["source"] == "teacher-publish"
            assert release.release_metadata["domainWeights"] == {
                "people": 3,
                "process": 3,
                "business-environment": 0,
            }
            assert release.release_metadata["simulationScoring"] == {
                "version": 1,
                "label": "幻谱模拟判定",
                "passPercent": 60,
                "bands": {
                    "needsImprovement": 50,
                    "belowTarget": 60,
                    "target": 80,
                },
                "official": False,
            }

    try:
        asyncio.run(scenario())
    finally:
        asyncio.run(_cleanup(ids))


def test_publish_uses_server_generated_hard_actual_as_domain_weights() -> None:
    ids = _ids()
    asyncio.run(_seed(ids))

    async def scenario() -> None:
        async with AsyncSessionLocal() as db:
            paper = await db.get(ExamPaper, ids["paper"])
            paper.generation_config = {
                "hardQuota": {
                    "dimensionId": "exam-domain",
                    "weights": {
                        "people": 33.33,
                        "process": 66.67,
                        "business-environment": 0,
                    },
                },
                "hardActual": {
                    "people": 2,
                    "process": 4,
                    "business-environment": 0,
                },
            }
            questions = list(
                (
                    await db.scalars(
                        select(Question)
                        .where(Question.bank_id == ids["bank"])
                        .order_by(Question.id)
                    )
                ).all()
            )
            for index, question in enumerate(questions):
                question.content_metadata = {
                    "subjectFacets": [
                        {
                            "dimensionId": "exam-domain",
                            "valueId": "process" if index < 4 else "people",
                        }
                    ]
                }
            await db.commit()

            teacher = await db.get(User, ids["teacher"])
            release = await paper_release_service.publish(
                db,
                teacher,
                ids["paper"],
                expected_revision=1,
                access_level="free",
                enabled_modes=["practice_mode"],
                allowed_roles=["student"],
                metadata={},
            )

            assert release.release_metadata["domainWeights"] == {
                "people": 2,
                "process": 4,
                "business-environment": 0,
            }

    try:
        asyncio.run(scenario())
    finally:
        asyncio.run(_cleanup(ids))


def test_multiple_choice_publish_requires_analysis_and_freezes_answer_array() -> None:
    ids = _ids()
    asyncio.run(_seed(ids))

    async def scenario() -> None:
        async with AsyncSessionLocal() as db:
            paper = await db.get(ExamPaper, ids["paper"])
            paper.paper_type = "multiple_choice"
            questions = list((await db.scalars(
                select(Question).where(Question.bank_id == ids["bank"])
            )).all())
            for question in questions:
                question.type = "multiple_choice"
                question.options = [
                    {"id": "A", "text": "A"},
                    {"id": "B", "text": "B"},
                    {"id": "C", "text": "C"},
                ]
                question.correct_answer = None
                question.correct_answer_ids = ["A", "C"]
                question.analysis = "多选解析"
            questions[0].analysis = ""
            await db.commit()

            teacher = await db.get(User, ids["teacher"])
            with pytest.raises(HTTPException) as missing_analysis:
                await paper_release_service.publish(
                    db,
                    teacher,
                    ids["paper"],
                    expected_revision=1,
                    access_level="free",
                    enabled_modes=["practice_mode"],
                    allowed_roles=["teacher", "student"],
                    metadata={},
                )
            assert missing_analysis.value.detail["code"] == "PUBLICATION_CHECK_FAILED"
            assert missing_analysis.value.detail["issues"][0]["code"] == "MULTIPLE_CHOICE_ANALYSIS_REQUIRED"

            questions[0].analysis = "补齐解析"
            await db.commit()
            release = await paper_release_service.publish(
                db,
                teacher,
                ids["paper"],
                expected_revision=1,
                access_level="free",
                enabled_modes=["practice_mode"],
                allowed_roles=["teacher", "student"],
                metadata={},
            )
            assert release.paper_type == "multiple_choice"
            assert paper_release_service.release_to_dict(release)["paperType"] == "multiple_choice"
            frozen = await paper_release_service.questions(
                db,
                teacher,
                release.id,
                limit=10,
                offset=0,
            )
            assert frozen["questions"][0]["question"]["correctOptionIds"] == ["A", "C"]

    try:
        asyncio.run(scenario())
    finally:
        asyncio.run(_cleanup(ids))


def test_publish_increments_version_and_keeps_prior_snapshot_immutable() -> None:
    ids = _ids()
    asyncio.run(_seed(ids))

    async def scenario() -> None:
        async with AsyncSessionLocal() as db:
            teacher = await db.get(User, ids["teacher"])
            first = await paper_release_service.publish(
                db, teacher, ids["paper"], expected_revision=1, access_level="free",
                enabled_modes=["practice_mode", "deep_recall"], allowed_roles=["teacher", "student"], metadata={},
            )
            question = await db.get(Question, f"rq-0-{ids['bank'][3:]}")
            question.title = "发布后被编辑"
            await db.commit()
            second = await paper_release_service.publish(
                db, teacher, ids["paper"], expected_revision=2, access_level="free",
                enabled_modes=["practice_mode"], allowed_roles=["teacher", "student"], metadata={},
            )
            teacher = await db.get(User, ids["teacher"])
            history = (await paper_release_service.history(
                db, teacher, ids["paper"], page=1, page_size=50
            ))["releases"]
            first_questions = await paper_release_service.questions(db, teacher, first.id, limit=20, offset=0)
            second_questions = await paper_release_service.questions(db, teacher, second.id, limit=20, offset=0)
            frozen_question = await db.get(Question, f"rq-1-{ids['bank'][3:]}")
            frozen_question.scope = "public"
            bank = await db.get(QuestionBank, ids["bank"])
            bank.visibility = "published"
            await db.commit()
            assert await published_paper_access_service.can_learn_published_question(
                db, teacher, frozen_question.id, release_id=second.id, mode="practice_mode"
            ) is True
            assert await published_paper_access_service.can_learn_published_question(
                db, teacher, frozen_question.id, release_id=second.id, mode="deep_recall"
            ) is False
            snapshot = await published_paper_access_service.load_published_question_snapshot(
                db, teacher, second.id, frozen_question.id, mode="practice_mode"
            )
            assert snapshot["title"] == "冻结题目 1"
            frozen_question.title = "当前题库已修改"
            frozen_question.correct_answer = "C"
            frozen_question.options = [
                {"id": "A", "text": "发布答案", "correct": False},
                {"id": "B", "text": "发布干扰项", "correct": False},
                {"id": "C", "text": "当前答案", "correct": True},
            ]
            await db.commit()
            authoritative = await published_paper_access_service.load_published_question(
                db, teacher, second.id, frozen_question.id, mode="practice_mode"
            )
            assert authoritative.title == "冻结题目 1"
            assert authoritative.correct_answer == "A"
            public_learning = await learning_service._visible_learning_question(
                db, authoritative.id, teacher, release_id=second.id, mode="practice_mode"
            )
            assert public_learning.title == "冻结题目 1"
            assert public_learning.correct_answer == "A"
            correct_result = await learning_service.record_practice_answer(
                db,
                teacher.username,
                {
                    "questionId": authoritative.id,
                    "bankId": authoritative.bank_id,
                    "releaseId": second.id,
                    "selectedAnswer": "A",
                },
                current_user=teacher,
            )
            wrong_result = await learning_service.record_practice_answer(
                db,
                teacher.username,
                {
                    "questionId": authoritative.id,
                    "bankId": authoritative.bank_id,
                    "releaseId": second.id,
                    "selectedAnswer": "B",
                },
                current_user=teacher,
            )
            assert correct_result["correct"] is True
            assert wrong_result["correct"] is False
            await db.execute(delete(LearningEvent).where(
                LearningEvent.question_id == authoritative.id
            ))
            await db.commit()
            public_recall = await deep_recall_service._visible_question(
                db, teacher, authoritative.id, release_id=first.id
            )
            assert public_recall.title == "冻结题目 1"
            await db.execute(delete(PaperQuestion).where(
                PaperQuestion.question_id == frozen_question.id
            ))
            await db.delete(frozen_question)
            await db.commit()
            deleted_canonical = await published_paper_access_service.load_published_question(
                db, teacher, second.id, authoritative.id, mode="practice_mode"
            )
            assert deleted_canonical.title == "冻结题目 1"
            assert deleted_canonical.correct_answer == "A"
            visible_for_learning = await learning_service._visible_learning_question(
                db,
                authoritative.id,
                teacher,
                release_id=second.id,
                mode="practice_mode",
            )
            assert visible_for_learning.title == "冻结题目 1"
            assert visible_for_learning.correct_answer == "A"
            visible_for_recall = await deep_recall_service._visible_question(
                db, teacher, authoritative.id, release_id=first.id
            )
            assert visible_for_recall.title == "冻结题目 1"

            assert (first.version, second.version) == (1, 2)
            assert first.status == "superseded"
            superseded = await published_paper_access_service.load_published_question(
                db, teacher, first.id, authoritative.id, mode="deep_recall"
            )
            assert superseded is not None
            assert superseded.title == "冻结题目 1"
            assert [item.version for item in history] == [2, 1]
            assert first_questions["questions"][0]["question"]["title"] == "冻结题目 0"
            assert second_questions["questions"][0]["question"]["title"] == "发布后被编辑"

    try:
        asyncio.run(scenario())
    finally:
        asyncio.run(_cleanup(ids))


def test_draft_save_syncs_active_release_name_without_mutating_frozen_questions() -> None:
    ids = _ids()
    asyncio.run(_seed(ids))

    async def scenario() -> None:
        async with AsyncSessionLocal() as db:
            teacher = await db.get(User, ids["teacher"])
            release = await paper_release_service.publish(
                db,
                teacher,
                ids["paper"],
                expected_revision=1,
                access_level="free",
                enabled_modes=["practice_mode"],
                allowed_roles=["teacher", "student"],
                metadata={},
            )
            frozen = await db.scalar(
                select(PaperReleaseQuestion)
                .where(PaperReleaseQuestion.release_id == release.id)
                .order_by(PaperReleaseQuestion.order_index)
                .limit(1)
            )
            original_snapshot = dict(frozen.snapshot)
            original_version = release.version

            changed = await paper_release_service.sync_active_release_names_from_draft_payload(
                db,
                json.dumps([
                    {"id": ids["paper"], "name": "保存后立即展示的新名称"},
                    {"id": ids["other_paper"], "name": "未发布试卷不应创建版本"},
                ], ensure_ascii=False),
            )
            await db.commit()
            await db.refresh(release)
            await db.refresh(frozen)

            assert changed == [release.id]
            assert release.name == "保存后立即展示的新名称"
            assert release.version == original_version
            assert frozen.snapshot == original_snapshot
            assert await db.scalar(
                select(func.count()).select_from(PaperRelease).where(
                    PaperRelease.paper_id == ids["other_paper"]
                )
            ) == 0

    try:
        asyncio.run(scenario())
    finally:
        asyncio.run(_cleanup(ids))


def test_management_catalog_projects_active_releases_as_lightweight_editable_papers() -> None:
    ids = _ids()
    asyncio.run(_seed(ids))

    async def scenario() -> None:
        async with AsyncSessionLocal() as db:
            teacher = await db.get(User, ids["teacher"])
            release = await paper_release_service.publish(
                db,
                teacher,
                ids["paper"],
                expected_revision=1,
                access_level="free",
                enabled_modes=["practice_mode", "deep_recall"],
                allowed_roles=["teacher", "student"],
                metadata={},
            )
            catalog = await paper_release_service.management_catalog(
                db, teacher, page=1, page_size=50
            )
            row = next(item for item in catalog["papers"] if item["paperId"] == ids["paper"])

            assert row["releaseId"] == release.id
            assert row["status"] == "published"
            assert row["publishedVersion"] == 1
            assert len(row["questions"]) == 6
            assert set(row["questions"][0]) == {"bankId", "questionId", "order", "score"}
            assert "question" not in row["questions"][0]

    try:
        asyncio.run(scenario())
    finally:
        asyncio.run(_cleanup(ids))


def test_withdraw_permissions_pagination_seed_and_release_isolation() -> None:
    ids = _ids()
    asyncio.run(_seed(ids))

    async def scenario() -> None:
        async with AsyncSessionLocal() as db:
            teacher = await db.get(User, ids["teacher"])
            student = await db.get(User, ids["student"])
            member_release = await paper_release_service.publish(
                db, teacher, ids["paper"], expected_revision=1, access_level="member",
                enabled_modes=["practice_mode"], allowed_roles=["student"], metadata={"label": "VIP"},
            )
            other = await paper_release_service.publish(
                db, teacher, ids["other_paper"], expected_revision=1, access_level="free",
                enabled_modes=["practice_mode"], allowed_roles=["student"], metadata={},
            )

            teacher = await db.get(User, ids["teacher"])
            student = await db.get(User, ids["student"])
            restricted = await paper_release_service.catalog(db, student, page=1, page_size=50)
            restricted_member = next(item for item in restricted["releases"] if item["releaseId"] == member_release.id)
            assert restricted_member["contentRestricted"] is True
            assert restricted_member["questionCount"] == 6
            assert await paper_release_service.questions(db, student, member_release.id, limit=2, offset=0) is None

            db.add(Subscription(
                username=student.username, plan_id="monthly", status="active",
                started_at=now_utc(), expires_at=now_utc() + timedelta(days=1),
            ))
            await db.commit()
            first = await paper_release_service.questions(db, student, member_release.id, limit=2, offset=1, seed="fixed")
            repeated = await paper_release_service.questions(db, student, member_release.id, limit=2, offset=1, seed="fixed")
            next_page = await paper_release_service.questions(
                db,
                student,
                member_release.id,
                limit=2,
                offset=first["nextOffset"],
                seed="fixed",
            )
            assert first == repeated
            assert first["consumed"] == len(first["questions"]) == 2
            assert first["nextOffset"] == first["offset"] + first["consumed"]
            assert next_page["offset"] == first["nextOffset"]
            assert {
                item["questionId"] for item in first["questions"]
            }.isdisjoint(item["questionId"] for item in next_page["questions"])
            assert first["total"] == 6
            assert len(first["questions"]) == 2
            assert {item["releaseId"] for item in first["questions"]} == {member_release.id}
            assert other.id not in {item["releaseId"] for item in first["questions"]}

            superseded = await paper_release_service.publish(
                db, teacher, ids["paper"], expected_revision=2, access_level="free",
                enabled_modes=["practice_mode"], allowed_roles=["student"], metadata={},
            )
            latest = await paper_release_service.publish(
                db, teacher, ids["paper"], expected_revision=3, access_level="free",
                enabled_modes=["practice_mode"], allowed_roles=["student"], metadata={},
            )
            assert superseded.status == "superseded"
            assert await paper_release_service.detail(db, student, superseded.id) is not None
            assert await paper_release_service.questions(
                db, student, superseded.id, limit=2, offset=0
            ) is not None
            assert latest.status == "published"

            withdrawn = await paper_release_service.withdraw(
                db, teacher, latest.id, expected_revision=4
            )
            assert withdrawn.status == "withdrawn"
            assert withdrawn.withdrawn_at is not None
            with pytest.raises(HTTPException) as repeated_withdraw:
                await paper_release_service.withdraw(
                    db, teacher, latest.id, expected_revision=5
                )
            assert repeated_withdraw.value.status_code == 409
            assert await paper_release_service.questions(
                db, student, latest.id, limit=2, offset=0
            ) is None

    try:
        asyncio.run(scenario())
    finally:
        asyncio.run(_cleanup(ids))



def test_publish_rejects_non_owner_empty_paper_invalid_modes_and_stale_revision() -> None:
    ids = _ids()
    asyncio.run(_seed(ids))

    async def scenario() -> None:
        async with AsyncSessionLocal() as db:
            owner = await db.get(User, ids["teacher"])
            student = await db.get(User, ids["student"])
            with pytest.raises(HTTPException) as denied:
                await paper_release_service.publish(
                    db, student, ids["paper"], expected_revision=1,
                    access_level="free", enabled_modes=["practice_mode"],
                    allowed_roles=["student"], metadata={},
                )
            assert denied.value.status_code == 404

            for modes in ([], ["unknown"]):
                with pytest.raises(HTTPException) as invalid:
                    await paper_release_service.publish(
                        db, owner, ids["paper"], expected_revision=1,
                        access_level="free", enabled_modes=modes,
                        allowed_roles=["student"], metadata={},
                    )
                assert invalid.value.status_code == 422

            await db.execute(delete(PaperQuestion).where(PaperQuestion.paper_id == ids["other_paper"]))
            await db.flush()
            with pytest.raises(HTTPException) as empty:
                await paper_release_service.publish(
                    db, owner, ids["other_paper"], expected_revision=1,
                    access_level="free", enabled_modes=["practice_mode"],
                    allowed_roles=["student"], metadata={},
                )
            assert empty.value.status_code == 422

            first = await paper_release_service.publish(
                db, owner, ids["paper"], expected_revision=1,
                access_level="free", enabled_modes=["practice"],
                allowed_roles=["student"], metadata={},
            )
            assert first.enabled_modes == ["practice_mode"]
            with pytest.raises(HTTPException) as conflict:
                await paper_release_service.publish(
                    db, owner, ids["paper"], expected_revision=1,
                    access_level="free", enabled_modes=["practice_mode"],
                    allowed_roles=["student"], metadata={},
                )
            assert conflict.value.status_code == 409

    try:
        asyncio.run(scenario())
    finally:
        asyncio.run(_cleanup(ids))

def test_history_paginates_and_questions_response_stays_below_one_megabyte() -> None:
    ids = _ids()
    asyncio.run(_seed(ids))

    async def scenario() -> None:
        async with AsyncSessionLocal() as db:
            teacher = await db.get(User, ids["teacher"])
            for revision in range(1, 4):
                await paper_release_service.publish(
                    db, teacher, ids["paper"], expected_revision=revision,
                    access_level="free", enabled_modes=["practice_mode"],
                    allowed_roles=["teacher"], metadata={},
                )
            history = await paper_release_service.history(
                db, teacher, ids["paper"], page=2, page_size=1
            )
            assert history["page"] == 2
            assert history["pageSize"] == 1
            assert history["total"] == 3
            assert [release.version for release in history["releases"]] == [2]

            active = (await paper_release_service.history(
                db, teacher, ids["paper"], page=1, page_size=1
            ))["releases"][0]
            rows = (await db.scalars(select(PaperReleaseQuestion).where(
                PaperReleaseQuestion.release_id == active.id
            ))).all()
            for row in rows:
                row.snapshot = {**row.snapshot, "analysis": "大" * 300_000}
            rows[0].snapshot = {**rows[0].snapshot, "analysis": "特" * 1_100_000}
            await db.commit()
            with pytest.raises(HTTPException) as too_large:
                await paper_release_service.questions(
                    db, teacher, active.id, limit=1, offset=0
                )
            assert too_large.value.status_code == 413
            rows[0].snapshot = {**rows[0].snapshot, "analysis": "大" * 300_000}
            await db.commit()
            payload = await paper_release_service.questions(
                db, teacher, active.id, limit=200, offset=0
            )
            encoded = json.dumps(payload, ensure_ascii=False).encode()
            assert len(encoded) < 1_000_000
            assert payload["responseTruncated"] is True
            assert payload["consumed"] == len(payload["questions"])
            assert payload["nextOffset"] == payload["offset"] + payload["consumed"]
            continuation = await paper_release_service.questions(
                db, teacher, active.id, limit=200, offset=payload["nextOffset"]
            )
            assert continuation["offset"] == payload["nextOffset"]
            assert {
                item["questionId"] for item in payload["questions"]
            }.isdisjoint(item["questionId"] for item in continuation["questions"])

    try:
        asyncio.run(scenario())
    finally:
        asyncio.run(_cleanup(ids))


def test_legacy_publish_endpoint_uses_release_lifecycle_and_withdraw_cas() -> None:
    ids = _ids()
    asyncio.run(_seed(ids))

    async def scenario() -> None:
        async with AsyncSessionLocal() as db:
            admin = await db.get(User, "admin")
            assert admin is not None
            release = await paper_release_service.publish(
                db, admin, ids["paper"], expected_revision=1,
                access_level="free", enabled_modes=["practice_mode"],
                allowed_roles=["student"], metadata={},
            )
            with pytest.raises(HTTPException) as stale:
                await paper_release_service.withdraw(
                    db, admin, release.id, expected_revision=1
                )
            assert stale.value.status_code == 409
            withdrawn = await paper_release_service.withdraw(
                db, admin, release.id, expected_revision=2
            )
            paper = await db.get(ExamPaper, ids["paper"])
            assert withdrawn.status == "withdrawn"
            assert paper.status == "draft"
            assert paper.revision == 3

    try:
        asyncio.run(scenario())
    finally:
        asyncio.run(_cleanup(ids))


def test_withdraw_paper_returns_editable_projection_to_draft() -> None:
    ids = _ids()
    asyncio.run(_seed(ids))

    async def scenario() -> None:
        async with AsyncSessionLocal() as db:
            teacher = await db.get(User, ids["teacher"])
            release = await paper_release_service.publish(
                db, teacher, ids["paper"], expected_revision=1,
                access_level="free", enabled_modes=["practice_mode"],
                allowed_roles=["student"], metadata={},
            )
            assert (await db.get(ExamPaper, ids["paper"])).status == "published"

            withdrawn = await paper_release_service.withdraw_paper(db, teacher, ids["paper"])
            paper = await db.get(ExamPaper, ids["paper"])
            assert withdrawn == 1
            assert (await db.get(PaperRelease, release.id)).status == "withdrawn"
            assert paper.status == "draft"
            assert paper.published_at is None
            assert paper.withdrawn_at is not None
            assert paper.published_version == release.version

            # 重复撤回：没有 active 版本时不改投影
            assert await paper_release_service.withdraw_paper(db, teacher, ids["paper"]) == 0
            assert (await db.get(ExamPaper, ids["paper"])).revision == paper.revision

    try:
        asyncio.run(scenario())
    finally:
        asyncio.run(_cleanup(ids))


def test_reconcile_withdrawn_projections_repairs_legacy_unpublish_drift() -> None:
    ids = _ids()
    asyncio.run(_seed(ids))

    async def scenario() -> None:
        async with AsyncSessionLocal() as db:
            teacher = await db.get(User, ids["teacher"])
            release = await paper_release_service.publish(
                db, teacher, ids["paper"], expected_revision=1,
                access_level="free", enabled_modes=["practice_mode"],
                allowed_roles=["student"], metadata={},
            )
            # 模拟旧版撤回：只下架 release，不回写试卷投影
            release.status = "withdrawn"
            release.withdrawn_at = now_utc()
            release.withdrawn_by = teacher.username
            await db.commit()

            repaired = await paper_release_service.reconcile_withdrawn_projections(db)
            paper = await db.get(ExamPaper, ids["paper"])
            assert repaired == 1
            assert paper.status == "draft"
            assert paper.published_at is None
            assert paper.withdrawn_at is not None

            # 已一致的试卷不会被重复改写
            assert await paper_release_service.reconcile_withdrawn_projections(db) == 0

    try:
        asyncio.run(scenario())
    finally:
        asyncio.run(_cleanup(ids))


def test_rename_paper_updates_active_release_name_but_not_history() -> None:
    ids = _ids()
    asyncio.run(_seed(ids))

    async def scenario() -> None:
        async with AsyncSessionLocal() as db:
            teacher = await db.get(User, ids["teacher"])
            release = await paper_release_service.publish(
                db, teacher, ids["paper"], expected_revision=1,
                access_level="free", enabled_modes=["practice_mode"],
                allowed_roles=["student"], metadata={},
            )
            from app.schemas.paper import PaperUpdateRequest
            from app.services import paper_service
            renamed = await paper_service.update_paper(
                db, teacher, ids["paper"],
                PaperUpdateRequest(revision=2, name="修改后的试卷名称"),
            )
            active = await db.get(PaperRelease, release.id)
            assert renamed["name"] == "修改后的试卷名称"
            assert active.name == "修改后的试卷名称"

    try:
        asyncio.run(scenario())
    finally:
        asyncio.run(_cleanup(ids))


def test_publish_preserves_callers_pending_transaction_work() -> None:
    ids = _ids()
    asyncio.run(_seed(ids))
    marker_id = f"marker-{ids['bank']}"

    async def scenario() -> None:
        async with AsyncSessionLocal() as db:
            owner = await db.get(User, ids["teacher"])
            db.add(QuestionBank(
                id=marker_id, owner_id=ids["teacher"], name="事务标记",
                subject="PMP", created_by=ids["teacher"], updated_by=ids["teacher"],
            ))
            await paper_release_service.publish(
                db, owner, ids["paper"], expected_revision=1,
                access_level="free", enabled_modes=["practice_mode"],
                allowed_roles=["student"], metadata={},
            )
        async with AsyncSessionLocal() as verify:
            assert await verify.get(QuestionBank, marker_id) is not None
            await verify.execute(delete(QuestionBank).where(QuestionBank.id == marker_id))
            await verify.commit()

    try:
        asyncio.run(scenario())
    finally:
        asyncio.run(_cleanup(ids))


def test_release_api_rejects_student_publish_and_exposes_lightweight_catalog() -> None:
    ids = _ids()
    asyncio.run(_seed(ids))
    try:
        with TestClient(app) as admin, TestClient(app) as viewer:
            assert admin.post("/api/v1/auth/login", json={"username": "admin", "password": "jbgsnmm~123"}).status_code == 200
            assert viewer.post(
                "/api/v1/auth/login", json={"username": "乔治008", "password": "111111"}
            ).status_code == 200
            forbidden = viewer.post(f"/api/v1/paper-releases/papers/{ids['paper']}/publish", json={})
            assert forbidden.status_code == 403

            published = admin.post(
                f"/api/v1/paper-releases/papers/{ids['paper']}/publish",
                json={"revision": 1, "accessLevel": "free", "enabledModes": ["practice_mode"], "allowedRoles": ["viewer"]},
            )
            assert published.status_code == 200, published.text
            oversized = admin.post(
                f"/api/v1/paper-releases/papers/{ids['other_paper']}/publish",
                json={
                    "revision": 1,
                    "metadata": {"blob": "x" * 70_000},
                    "enabledModes": ["practice_mode"],
                    "allowedRoles": ["viewer"],
                },
            )
            assert oversized.status_code == 422
            catalog = viewer.get("/api/v1/paper-releases/catalog")
            assert catalog.status_code == 200
            item = next(row for row in catalog.json()["releases"] if row["paperId"] == ids["paper"])
            assert item["questionCount"] == 6
            assert "questions" not in item
            assert "questionSnapshots" not in item

            legacy_paper = admin.post(
                f"/api/v1/papers/{ids['other_paper']}/publish?revision=1"
            )
            assert legacy_paper.status_code == 200, legacy_paper.text
            history = admin.get(
                f"/api/v1/paper-releases/papers/{ids['other_paper']}/history"
            )
            assert history.status_code == 200
            assert len(history.json()["releases"]) == 1
            release = history.json()["releases"][0]
            assert release["status"] == "published"

            unpublished = admin.post(
                f"/api/v1/papers/{ids['other_paper']}/unpublish?revision=2"
            )
            assert unpublished.status_code == 200, unpublished.text
            history = admin.get(
                f"/api/v1/paper-releases/papers/{ids['other_paper']}/history"
            ).json()["releases"]
            assert history[0]["status"] == "withdrawn"
    finally:
        asyncio.run(_cleanup(ids))


def test_guest_catalog_shows_student_papers_without_content_or_private_metadata():
    ids = _ids()
    asyncio.run(_seed(ids))

    async def publish():
        async with AsyncSessionLocal() as db:
            teacher = await db.get(User, ids["teacher"])
            release = await paper_release_service.publish(
                db, teacher, ids["paper"], expected_revision=1,
                access_level="member", enabled_modes=["practice_mode"],
                allowed_roles=["student"], metadata={"internalNote": "private"},
            )
            return release.id

    try:
        release_id = asyncio.run(publish())
        with TestClient(app) as client:
            response = client.get("/api/v1/paper-releases/catalog?pageSize=200")
            assert response.status_code == 200
            row = next(row for row in response.json()["releases"] if row["releaseId"] == release_id)
            assert row["name"] == "冻结试卷"
            assert row["questionCount"] == 6
            assert row["contentRestricted"] is True
            assert row["publishedAt"] > 0
            assert not {"questions", "questionSnapshots", "metadata", "publishedBy", "allowedRoles"} & row.keys()
            assert client.get(f"/api/v1/paper-releases/{release_id}").status_code == 401
            assert client.get(f"/api/v1/paper-releases/{release_id}/questions").status_code == 401

            async def change_visibility(status, roles):
                async with AsyncSessionLocal() as db:
                    release = await db.get(PaperRelease, release_id)
                    release.status = status
                    release.allowed_roles = roles
                    await db.commit()

            for status, roles in [("published", ["teacher"]), ("withdrawn", ["student"])]:
                asyncio.run(change_visibility(status, roles))
                hidden = client.get("/api/v1/paper-releases/catalog?pageSize=200")
                assert hidden.status_code == 200
                assert release_id not in {item["releaseId"] for item in hidden.json()["releases"]}
    finally:
        asyncio.run(_cleanup(ids))


@pytest.mark.parametrize("generated", [False, True])
def test_manual_selected_paper_publishes_current_mix_even_after_generated_edit(generated):
    ids = _ids()
    asyncio.run(_seed(ids))
    async def scenario():
        async with AsyncSessionLocal() as db:
            paper = await db.get(ExamPaper, ids["paper"])
            if generated:
                paper.generation_config = {
                    "hardQuota": {"dimensionId": "exam-domain", "weights": {"people": 42, "process": 50, "business-environment": 8}},
                    "hardActual": {"people": 3, "process": 3, "business-environment": 0},
                }
            for question in (await db.scalars(select(Question).where(Question.bank_id == ids["bank"]))).all():
                question.content_metadata = {"subjectFacets": [{"dimensionId": "exam-domain", "valueId": "people"}]}
            await db.commit()
            teacher = await db.get(User, ids["teacher"])
            release = await paper_release_service.publish(
                db, teacher, ids["paper"], expected_revision=1, access_level="free",
                enabled_modes=["practice_mode"], allowed_roles=["student"], metadata={},
            )
            assert release.release_metadata["domainWeights"] == {"people": 6, "process": 0, "business-environment": 0}
    try:
        asyncio.run(scenario())
    finally:
        asyncio.run(_cleanup(ids))


@pytest.mark.parametrize("audience", ["guest", "student", "member", "admin"])
def test_catalog_whitelists_learner_fields_without_selecting_bulk_columns(audience):
    ids = _ids()
    asyncio.run(_seed(ids))

    async def scenario():
        async with AsyncSessionLocal() as db:
            teacher = await db.get(User, ids["teacher"])
            release = await paper_release_service.publish(
                db, teacher, ids["paper"], expected_revision=1,
                access_level="member", enabled_modes=["practice_mode"],
                allowed_roles=["student"], metadata={"internalNote": "publish-detail"},
            )
            assert paper_release_service.release_to_dict(release)["metadata"]["internalNote"] == "publish-detail"
            release_id = release.id
            release.release_metadata = {"internalNote": "x" * 80_000}
            release.source_payload = {"questions": [{"answer": "y" * 200_000}]}
            password_hash = hash_password("catalog-test-password")
            student = await db.get(User, ids["student"])
            actor = await db.get(User, ids["other_teacher"])
            student.password_hash = actor.password_hash = password_hash
            if audience == "member":
                db.add(Subscription(
                    username=ids["student"], plan_id="monthly", status="active",
                    started_at=now_utc(), expires_at=now_utc() + timedelta(days=1),
                ))
            if audience == "admin":
                actor = await db.get(User, ids["other_teacher"])
                actor.role = "admin"
            await db.commit()

        async with AsyncSessionLocal() as db:
            user = None if audience == "guest" else await db.get(
                User, ids["other_teacher"] if audience == "admin" else ids["student"]
            )
            statements = []

            def record_sql(connection, cursor, statement, parameters, context, executemany):
                statements.append(statement)

            event.listen(engine.sync_engine, "before_cursor_execute", record_sql)
            try:
                result = await paper_release_service.catalog(
                    db, user, page=1, page_size=200, search="冻结试卷",
                )
            finally:
                event.remove(engine.sync_engine, "before_cursor_execute", record_sql)
            row = next(item for item in result["releases"] if item["releaseId"] == release_id)
            assert set(row) == {
                "id", "releaseId", "paperId", "version", "status", "availability",
                "name", "title", "subject", "description", "paperType", "purpose",
                "accessLevel", "accessPolicy", "enabledModes", "modeConfigVersion",
                "questionCount", "configuredCount", "totalCount", "publishedAt",
                "publishedAtIso", "updatedAt", "contentRestricted", "coverage",
            }
            assert row["name"] == "冻结试卷"
            assert row["questionCount"] == row["configuredCount"] == row["totalCount"] == 6
            assert row["enabledModes"] == ["practice_mode"]
            assert row["contentRestricted"] is (audience in {"guest", "student"})
            assert len(json.dumps(row)) < 3_000
            assert row["coverage"] == (None if user is None else {
                "releaseId": release_id, "totalCount": 6, "completedCount": 0, "remainingUnseen": 6,
            })
            release_queries = [sql.lower() for sql in statements if "paper_releases" in sql.lower()]
            assert release_queries
            assert not any("paper_releases.metadata" in sql or "paper_releases.source_payload" in sql for sql in release_queries)
            assert not any("paper_release_questions.snapshot" in sql for sql in statements)

            # Full detail and history still expose their frozen metadata on demand.
            actor = await db.get(User, ids["other_teacher"])
            actor.role = "admin"
            detail = await paper_release_service.detail(db, actor, release_id)
            assert detail["metadata"] == {"internalNote": "x" * 80_000}
            assert detail["publishedBy"] == ids["teacher"]
            assert detail["allowedRoles"] == ["student"]
            history = await paper_release_service.history(db, actor, ids["paper"], page=1, page_size=10)
            assert paper_release_service.release_to_dict(history["releases"][0])["metadata"] == detail["metadata"]
            return release_id
    try:
        release_id = asyncio.run(scenario())
        with TestClient(app) as client:
            if audience != "guest":
                username = ids["other_teacher"] if audience == "admin" else ids["student"]
                login = client.post("/api/v1/auth/login", json={
                    "username": username, "password": "catalog-test-password",
                })
                assert login.status_code == 200
            response = client.get("/api/v1/paper-releases/catalog", params={"search": "冻结试卷"})
            assert response.status_code == 200
            row = next(item for item in response.json()["releases"] if item["releaseId"] == release_id)
            assert not {"metadata", "sourcePayload", "publishedBy", "allowedRoles"} & row.keys()
            assert row["contentRestricted"] is (audience in {"guest", "student"})
    finally:
        async def cleanup_logs():
            async with AsyncSessionLocal() as db:
                await db.execute(delete(UserAdminLog).where(UserAdminLog.target_username.in_([
                    ids["student"], ids["other_teacher"],
                ])))
                await db.commit()
        asyncio.run(cleanup_logs())
        asyncio.run(_cleanup(ids))


def test_catalog_mode_filters_totals_pages_and_role_scoped_subject_facets():
    ids = _ids()
    asyncio.run(_seed(ids))
    token = ids["paper"]

    async def scenario():
        async with AsyncSessionLocal() as db:
            for index, (subject, modes, roles, access, status) in enumerate([
                ("DemandA", ["practice_mode"], ["student"], "free", "published"),
                ("DemandB", ["practice_mode", "deep_recall"], ["student"], "member", "published"),
                ("DemandC", ["practice_mode"], ["student"], "free", "published"),
                ("Hidden", ["practice_mode"], ["teacher"], "free", "published"),
                ("Recall", ["deep_recall"], ["student"], "free", "published"),
                ("Retired", ["practice_mode"], ["student"], "free", "withdrawn"),
            ]):
                db.add(PaperRelease(
                    id=f"{token}-mode-{index}", paper_id=f"{token}-mode-paper-{index}",
                    version=1, status=status, name=f"{token} title {index}", subject=subject,
                    publisher_id=ids["teacher"], access_level=access, enabled_modes=modes,
                    allowed_roles=roles, question_count=0, published_at=now_utc() + timedelta(seconds=index),
                ))
            await db.commit()
            student = await db.get(User, ids["student"])
            coverage_release_ids = []

            def record_coverage(connection, cursor, statement, parameters, context, executemany):
                if "WITH answered" in statement:
                    coverage_release_ids.append(context.compiled_parameters[0]["release_ids"])

            event.listen(engine.sync_engine, "before_cursor_execute", record_coverage)
            try:
                page = await paper_release_service.catalog(
                    db, student, page=1, page_size=1, search=token, mode="practice_mode",
                )
            finally:
                event.remove(engine.sync_engine, "before_cursor_execute", record_coverage)
            assert page["total"] == 3
            assert [row["releaseId"] for row in page["releases"]] == [f"{token}-mode-2"]
            assert coverage_release_ids == [[f"{token}-mode-2"]]
            second = await paper_release_service.catalog(
                db, student, page=2, page_size=1, search=token, mode="practice_mode",
            )
            assert [row["releaseId"] for row in second["releases"]] == [f"{token}-mode-1"]
            assert second["releases"][0]["contentRestricted"] is True
            assert second["subjects"] == page["subjects"]
            assert {"DemandA", "DemandB", "DemandC"} <= set(page["subjects"])
            assert not {"Hidden", "Recall", "Retired"} & set(page["subjects"])
            filtered = await paper_release_service.catalog(
                db, student, page=2, page_size=1, search="nothing-matches", subject="DemandA",
                access="free", mode="practice_mode",
            )
            assert filtered["total"] == 0
            assert filtered["releases"] == []
            assert filtered["subjects"] == page["subjects"]
            member_only = await paper_release_service.catalog(
                db, student, page=1, page_size=10, search=token, access="member", mode="practice_mode",
            )
            assert member_only["total"] == 1
            assert member_only["subjects"] == page["subjects"]
            unfiltered = await paper_release_service.catalog(db, student, page=1, page_size=10, search=token)
            assert unfiltered["total"] == 4
            guest = await paper_release_service.catalog(db, None, page=1, page_size=10, search=token, mode="practice_mode")
            assert guest["total"] == 3
            teacher = await db.get(User, ids["teacher"])
            teacher_page = await paper_release_service.catalog(db, teacher, page=1, page_size=10, search=token, mode="practice_mode")
            assert teacher_page["total"] == 1
            actor = await db.get(User, ids["other_teacher"])
            actor.role = "admin"
            admin_page = await paper_release_service.catalog(db, actor, page=1, page_size=10, search=token, mode="practice_mode")
            assert admin_page["total"] == 4
    try:
        asyncio.run(scenario())
        with TestClient(app) as client:
            response = client.get("/api/v1/paper-releases/catalog", params={"mode": "practice_mode", "search": token, "pageSize": 1})
            assert response.status_code == 200
            assert response.json()["total"] == 3
            assert len(response.json()["releases"]) == 1
            for mode, expected_total in [
                ("deep_recall", 2), ("multi_question_canvas", 0), ("single_deep_study", 0),
            ]:
                response = client.get("/api/v1/paper-releases/catalog", params={"mode": mode, "search": token})
                assert response.status_code == 200
                assert response.json()["total"] == expected_total
            for mode in ("unknown", "practice", " "):
                assert client.get("/api/v1/paper-releases/catalog", params={"mode": mode}).status_code == 422
    finally:
        async def cleanup_modes():
            async with AsyncSessionLocal() as db:
                await db.execute(delete(PaperRelease).where(PaperRelease.publisher_id == ids["teacher"]))
                await db.commit()
        asyncio.run(cleanup_modes())
        asyncio.run(_cleanup(ids))


def test_catalog_exact_paper_filter_preserves_global_subject_facets():
    ids = _ids()
    asyncio.run(_seed(ids))

    async def scenario():
        async with AsyncSessionLocal() as db:
            teacher = await db.get(User, ids["teacher"])
            for paper_id, subject in [(ids["paper"], "DemandExactA"), (ids["other_paper"], "DemandExactB")]:
                paper = await db.get(ExamPaper, paper_id)
                paper.subject = subject
                await paper_release_service.publish(
                    db, teacher, paper_id, expected_revision=1, access_level="free",
                    enabled_modes=["practice_mode"], allowed_roles=["student"], metadata={},
                )
        async with AsyncSessionLocal() as db:
            result = await paper_release_service.catalog(
                db, None, page=1, page_size=1, mode="practice_mode", paper_id=ids["paper"],
            )
            assert result["total"] == 1
            assert [row["paperId"] for row in result["releases"]] == [ids["paper"]]
            assert {"DemandExactA", "DemandExactB"} <= set(result["subjects"])
            prefix = await paper_release_service.catalog(db, None, page=1, page_size=1, paper_id=ids["paper"][:-1])
            assert prefix["total"] == 0
    try:
        asyncio.run(scenario())
        with TestClient(app) as client:
            response = client.get("/api/v1/paper-releases/catalog", params={
                "paperId": ids["other_paper"], "mode": "practice_mode", "pageSize": 1,
            })
            assert response.status_code == 200
            assert response.json()["total"] == 1
            assert response.json()["releases"][0]["paperId"] == ids["other_paper"]
            assert {"DemandExactA", "DemandExactB"} <= set(response.json()["subjects"])
    finally:
        asyncio.run(_cleanup(ids))
