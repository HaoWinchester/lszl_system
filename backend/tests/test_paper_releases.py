"""关系化发布试卷的冻结版本、访问控制和按版本取题契约。"""

import asyncio
import json
import time
from datetime import timedelta
from uuid import uuid4

import pytest
from fastapi import HTTPException
from fastapi.testclient import TestClient
from sqlalchemy import delete, func, select

from app.core.security import now_utc
from app.db.session import AsyncSessionLocal
from app.main import app
from app.models.paper_release import PaperRelease, PaperReleaseQuestion
from app.models.question import ExamPaper, PaperQuestion, Question, QuestionBank
from app.models.subscription import Subscription
from app.models.training import LearningEvent, PracticeMistake, RecallProgress, RecallQuestionSnapshot, TrainingProgress
from app.models.user import User
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
                correct_answer="A", created_by=ids["teacher"], updated_by=ids["teacher"],
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
