"""Publication checks identify every editable question problem."""

import asyncio
from uuid import uuid4

from fastapi.testclient import TestClient
from fastapi import HTTPException
import pytest
from sqlalchemy import delete

from app.db.session import AsyncSessionLocal
from app.main import app
from app.models.question import ExamPaper, PaperQuestion, Question, QuestionBank
from app.models.user import User
from app.services import paper_release_service, question_answer_service


def _base(kind="single_choice"):
    return {
        "type": kind, "stemParts": [{"text": "题干"}],
        "options": [{"id": "A", "text": "一"}, {"id": "B", "text": "二"}, {"id": "C", "text": "三"}],
        "correctAnswer": "A", "analysis": "解析",
    }


def test_single_choice_requires_answer_and_analysis():
    question = _base()
    question["correctAnswer"] = ""
    question["analysis"] = " "
    fields = {issue["field"] for issue in question_answer_service.validate_question(question, require_analysis=True)}
    assert fields == {"correctAnswer", "analysis"}


def test_multiple_choice_uses_existing_answer_validator_and_requires_analysis():
    question = _base("multiple_choice")
    question["correctAnswer"] = ""
    question["correctOptionIds"] = ["A"]
    question["analysis"] = ""
    fields = {issue["field"] for issue in question_answer_service.validate_question(question, require_analysis=True)}
    assert fields == {"correctOptionIds", "analysis"}


def test_matching_requires_pairs_and_analysis():
    question = _base("matching")
    question["matching"] = {"left": [{"id": "l1", "text": "一"}, {"id": "l2", "text": "二"}], "right": [{"id": "r1", "text": "甲"}, {"id": "r2", "text": "乙"}], "correctPairs": {}}
    question["analysis"] = ""
    fields = {issue["field"] for issue in question_answer_service.validate_question(question, require_analysis=True)}
    assert fields == {"matching.correctPairs", "analysis"}


def test_english_is_warning_without_explicit_language_config():
    entry = {"order": 1, "bankId": "bank", "questionId": "question", "question": _base()}
    warning = paper_release_service._publication_checklist([entry], {})
    assert warning["ready"]
    assert warning["issues"] == []
    assert warning["warnings"][0]["code"] == "QUESTION_ENGLISH_INCOMPLETE"
    required = paper_release_service._publication_checklist([entry], {"languageMode": "bilingual"})
    assert not required["ready"]
    assert required["issues"][0]["field"] == "translations.en"
    bypass = paper_release_service._publication_checklist([entry], {"languageMode": "zh"}, {"languageMode": "bilingual"})
    assert not bypass["ready"]


def test_chinese_choice_text_is_required_for_single_and_multiple_choice():
    for kind in ("single_choice", "multiple_choice"):
        question = _base(kind)
        if kind == "multiple_choice":
            question["correctOptionIds"] = ["A", "B"]
        question["options"][1]["text"] = " "
        entry = {"order": 2, "bankId": "bank", "questionId": "question", "question": question}
        result = paper_release_service._publication_checklist([entry])
        assert not result["ready"]
        assert any(issue["field"] == "options" and issue["questionId"] == "question" and issue["number"] == 2 for issue in result["issues"])


def test_preflight_lists_question_issues_and_never_publishes_draft():
    token = uuid4().hex[:8]
    teacher, bank_id, paper_id, question_id = (f"check-{token}", f"cb-{token}", f"cp-{token}", f"cq-{token}")

    async def seed():
        async with AsyncSessionLocal() as db:
            db.add(User(username=teacher, password_hash="unused", role="teacher", status="active"))
            await db.flush()
            db.add_all([
                QuestionBank(id=bank_id, owner_id=teacher, name="检查题库", subject="PMP", created_by=teacher, updated_by=teacher),
                ExamPaper(id=paper_id, owner_id=teacher, name="检查试卷", subject="PMP", created_by=teacher, updated_by=teacher),
            ])
            await db.flush()
            db.add(Question(id=question_id, bank_id=bank_id, source_id=question_id, title="待补解析", subject="PMP", scope="internal", stem_parts=[{"text": "题干"}], options=[{"id": "A", "text": "一"}, {"id": "B", "text": "二"}], correct_answer="A", analysis="", created_by=teacher, updated_by=teacher))
            await db.flush()
            db.add(PaperQuestion(paper_id=paper_id, question_id=question_id, order_index=0))
            await db.commit()

    async def cleanup():
        async with AsyncSessionLocal() as db:
            await db.execute(delete(PaperQuestion).where(PaperQuestion.paper_id == paper_id))
            await db.execute(delete(Question).where(Question.id == question_id))
            await db.execute(delete(ExamPaper).where(ExamPaper.id == paper_id))
            await db.execute(delete(QuestionBank).where(QuestionBank.id == bank_id))
            await db.execute(delete(User).where(User.username == teacher))
            await db.commit()

    asyncio.run(seed())
    try:
        with TestClient(app) as client:
            response = client.get(f"/api/v1/paper-releases/papers/{paper_id}/preflight")
            assert response.status_code in {401, 403}
        async def inspect():
            async with AsyncSessionLocal() as db:
                from app.services import paper_release_service
                actor = await db.get(User, teacher)
                result = await paper_release_service.preflight(db, actor, paper_id)
                assert not result["ready"]
                assert result["issues"][0]["questionId"] == question_id
                assert result["issues"][0]["bankId"] == bank_id
                assert result["issues"][0]["field"] == "analysis"
                assert (await db.get(ExamPaper, paper_id)).status == "draft"
                paper = await db.get(ExamPaper, paper_id)
                paper.access_policy = {"languageMode": "bilingual"}
                question = await db.get(Question, question_id)
                question.analysis = "中文解析"
                await db.commit()
                with pytest.raises(HTTPException) as rejected:
                    await paper_release_service.publish(db, actor, paper_id, expected_revision=1, access_level="free", enabled_modes=["practice_mode"], allowed_roles=["student"], metadata={"languageMode": "zh"})
                assert rejected.value.detail["issues"][0]["field"] == "translations.en"
                await db.rollback()
        asyncio.run(inspect())
    finally:
        asyncio.run(cleanup())
