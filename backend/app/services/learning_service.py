"""单题深学会话、学习事件和多题工作区服务。"""

import re
from datetime import timedelta

from sqlalchemy import or_, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.security import now_utc, uid
from app.models.question import Question, QuestionBank
from app.models.training import (
    CanvasWorkspace,
    LearningEvent,
    PracticeMistake,
    PracticeVerification,
    TrainingProgress,
)
from app.services import question_catalog_service, question_service

SESSION_SCHEMA_VERSIONS = {1, 2}
WORKSPACE_SCHEMA_VERSIONS = set(range(1, 7))
WORKSPACE_ID_PATTERN = re.compile(r"^[A-Za-z0-9_-]{1,64}$")
PRACTICE_MISTAKE_STATUSES = {"pending", "needs_remediation", "verification_due", "mastered"}
PRACTICE_LANGUAGE_MODES = {"zh", "en", "bilingual"}
PRACTICE_REVIEW_DELAY = timedelta(days=1)


def _iso(value) -> str | None:
    return value.isoformat() if value else None


async def _owned_question(db: AsyncSession, owner: str, question_id: str) -> bool:
    if await question_service.get_question(db, owner, question_id) is not None:
        return True
    return await question_catalog_service.is_learning_question_visible(db, question_id)


async def _progress(db: AsyncSession, owner: str, question_id: str) -> TrainingProgress | None:
    result = await db.execute(
        select(TrainingProgress).where(
            TrainingProgress.owner_id == owner,
            TrainingProgress.question_id == question_id,
        )
    )
    return result.scalar_one_or_none()


def _legacy_session(progress: TrainingProgress) -> dict:
    return {
        "schemaVersion": 1,
        "answer": {
            "selectedAnswer": progress.selected_answer,
            "submitted": progress.submitted,
        },
        "foundClues": progress.found_clues or [],
        "reasoningState": progress.reasoning_state or {},
    }


async def get_session(db: AsyncSession, owner: str, question_id: str) -> dict | None:
    progress = await _progress(db, owner, question_id)
    if not progress:
        return None
    return progress.session_data or _legacy_session(progress)


async def save_session(db: AsyncSession, owner: str, question_id: str, data: dict) -> dict | None:
    if not await _owned_question(db, owner, question_id):
        return None
    version = int(data.get("schemaVersion") or 1)
    if version not in SESSION_SCHEMA_VERSIONS:
        raise ValueError("不支持的学习会话版本")
    progress = await _progress(db, owner, question_id)
    answer = data.get("answer") if isinstance(data.get("answer"), dict) else {}
    if progress is None:
        progress = TrainingProgress(
            id=uid("tp_"),
            owner_id=owner,
            question_id=question_id,
            selected_answer=answer.get("selectedAnswer"),
            submitted=bool(answer.get("submitted", False)),
            found_clues=data.get("foundClues") or [],
            reasoning_state=data.get("reasoningState") or {},
            session_data=data,
        )
        db.add(progress)
    else:
        progress.session_data = data
        if "selectedAnswer" in answer:
            progress.selected_answer = answer.get("selectedAnswer")
        if "submitted" in answer:
            progress.submitted = bool(answer.get("submitted"))
        if "foundClues" in data:
            progress.found_clues = data.get("foundClues") or []
        if "reasoningState" in data:
            progress.reasoning_state = data.get("reasoningState") or {}
    await db.commit()
    await db.refresh(progress)
    return progress.session_data


def event_to_dict(event: LearningEvent) -> dict:
    return {
        "id": event.id,
        "questionId": event.question_id,
        "eventType": event.event_type,
        "payload": event.payload or {},
        "createdAt": _iso(event.created_at),
    }


def _question_snapshot(question: Question) -> dict:
    """Use the canonical public payload as a durable source-question snapshot."""

    return question_catalog_service.question_to_payload(question)


def _practice_knowledge(question: Question) -> dict:
    metadata = question.content_metadata if isinstance(question.content_metadata, dict) else {}
    raw = metadata.get("knowledge") if isinstance(metadata.get("knowledge"), dict) else {}
    taxonomy_id = str(raw.get("taxonomyId") or "").strip()
    node_id = str(raw.get("primaryNodeId") or raw.get("nodeId") or "").strip()
    path = raw.get("pathSnapshot") if isinstance(raw.get("pathSnapshot"), list) else []
    title = ""
    if path:
        last = path[-1]
        if isinstance(last, dict):
            title = str(last.get("zh") or last.get("title") or "").strip()
        else:
            title = str(last or "").strip()
    title = title or str(raw.get("title") or question.topic or "").strip()
    return {
        "taxonomyId": taxonomy_id,
        "nodeId": node_id,
        "title": title,
        "path": path,
    }


def _practice_snapshot_knowledge(snapshot: dict) -> dict:
    metadata = snapshot.get("metadata") if isinstance(snapshot.get("metadata"), dict) else {}
    raw = metadata.get("knowledge") if isinstance(metadata.get("knowledge"), dict) else {}
    taxonomy_id = str(raw.get("taxonomyId") or "").strip()
    node_id = str(raw.get("primaryNodeId") or raw.get("nodeId") or "").strip()
    path = raw.get("pathSnapshot") if isinstance(raw.get("pathSnapshot"), list) else []
    title = ""
    if path:
        last = path[-1]
        title = str(last.get("zh") or last.get("title") or "") if isinstance(last, dict) else str(last or "")
    return {
        "taxonomyId": taxonomy_id,
        "nodeId": node_id,
        "title": title or str(raw.get("title") or snapshot.get("topic") or "").strip(),
        "path": path,
    }


def _practice_mistake_to_dict(mistake: PracticeMistake) -> dict:
    return {
        "id": mistake.id,
        "questionId": mistake.question_id,
        "bankId": mistake.bank_id,
        "paperId": mistake.paper_id,
        "releaseId": mistake.release_id,
        "paperVersion": mistake.paper_version,
        "paperName": mistake.paper_name,
        "sourceMode": mistake.source_mode,
        "languageMode": mistake.language_mode,
        "questionSnapshot": mistake.question_snapshot or {},
        "knowledge": mistake.knowledge or {},
        "selectedAnswers": mistake.selected_answers or [],
        "status": mistake.status,
        "wrongCount": mistake.wrong_count,
        "revengeAttemptCount": mistake.revenge_attempt_count,
        "revengeWrongCount": mistake.revenge_wrong_count,
        "revengeCorrectCount": mistake.revenge_correct_count,
        "verificationAttemptCount": mistake.verification_attempt_count,
        "verificationPassCount": mistake.verification_pass_count,
        "verificationFailCount": mistake.verification_fail_count,
        "firstWrongAt": _iso(mistake.first_wrong_at),
        "lastWrongAt": _iso(mistake.last_wrong_at),
        "lastRevengeAt": _iso(mistake.last_revenge_at),
        "nextReviewAt": _iso(mistake.next_review_at),
        "remediationReviewedAt": _iso(mistake.remediation_reviewed_at),
        "masteredAt": _iso(mistake.mastered_at),
        "createdAt": _iso(mistake.created_at),
        "updatedAt": _iso(mistake.updated_at),
    }


def _practice_verification_to_dict(verification: PracticeVerification) -> dict:
    return {
        "id": verification.id,
        "mistakeId": verification.mistake_id,
        "questionId": verification.question_id,
        "bankId": verification.bank_id,
        "selectedAnswer": verification.selected_answer,
        "correct": verification.correct,
        "createdAt": _iso(verification.created_at),
    }


async def _practice_mistake(db: AsyncSession, owner: str, mistake_id: str) -> PracticeMistake | None:
    return (
        await db.execute(
            select(PracticeMistake).where(
                PracticeMistake.id == mistake_id,
                PracticeMistake.owner_id == owner,
            )
        )
    ).scalar_one_or_none()


async def _visible_learning_question(db: AsyncSession, question_id: str) -> Question | None:
    query = (
        select(Question)
        .join(QuestionBank, QuestionBank.id == Question.bank_id)
        .where(
            Question.id == question_id,
            QuestionBank.visibility == "published",
            Question.scope == "public",
        )
    )
    return (await db.execute(query)).scalar_one_or_none()


async def _append_practice_event(
    db: AsyncSession,
    owner: str,
    *,
    event_type: str,
    question_id: str | None,
    payload: dict,
) -> None:
    db.add(
        LearningEvent(
            id=uid("le_"),
            owner_id=owner,
            question_id=question_id,
            event_type=event_type,
            payload=payload,
        )
    )


async def record_practice_mistake(db: AsyncSession, owner: str, data: dict) -> PracticeMistake:
    question_id = str(data.get("questionId") or "").strip()
    if not question_id:
        raise ValueError("questionId 不能为空")
    question = await _visible_learning_question(db, question_id)
    if question is None:
        raise LookupError("题目不存在或当前不可学习")
    requested_bank_id = str(data.get("bankId") or "").strip()
    if requested_bank_id and requested_bank_id != question.bank_id:
        raise ValueError("bankId 与题目不一致")
    release_id = str(data.get("releaseId") or "").strip()
    selected_answer = str(data.get("selectedAnswer") or data.get("reason") or "").strip()
    language_mode = str(data.get("languageMode") or "zh").strip().lower()
    if language_mode not in PRACTICE_LANGUAGE_MODES:
        raise ValueError("languageMode 不受支持")
    existing = (
        await db.execute(
            select(PracticeMistake).where(
                PracticeMistake.owner_id == owner,
                PracticeMistake.question_id == question.id,
                PracticeMistake.release_id == release_id,
            )
        )
    ).scalar_one_or_none()
    now = now_utc()
    if existing is None:
        existing = PracticeMistake(
            id=uid("pm_"),
            owner_id=owner,
            question_id=question.id,
            bank_id=question.bank_id,
            paper_id=str(data.get("paperId") or "").strip() or None,
            release_id=release_id,
            paper_version=max(0, int(data.get("paperVersion") or 0)),
            paper_name=str(data.get("paperName") or "错题来源试卷").strip()[:200] or "错题来源试卷",
            source_mode=str(data.get("sourceMode") or "challenge").strip()[:32] or "challenge",
            language_mode=language_mode,
            question_snapshot=_question_snapshot(question),
            knowledge=_practice_knowledge(question),
            selected_answers=[selected_answer] if selected_answer else [],
            status="pending",
            wrong_count=1,
            first_wrong_at=now,
            last_wrong_at=now,
        )
        db.add(existing)
    else:
        existing.question_snapshot = _question_snapshot(question)
        existing.knowledge = _practice_knowledge(question)
        existing.selected_answers = [*(existing.selected_answers or []), *([selected_answer] if selected_answer else [])][-20:]
        existing.status = "pending"
        existing.wrong_count += 1
        existing.revenge_correct_count = 0
        existing.last_wrong_at = now
        existing.next_review_at = None
        existing.mastered_at = None
    await _append_practice_event(
        db,
        owner,
        event_type="PRACTICE_MISTAKE_RECORDED",
        question_id=question.id,
        payload={"mistakeId": existing.id, "status": existing.status, "knowledge": existing.knowledge},
    )
    await db.commit()
    await db.refresh(existing)
    return existing


def _canonical_practice_answer(question: Question) -> str:
    explicit = str(question.correct_answer or "").strip()
    if explicit:
        return explicit
    correct_options = [
        str(option.get("id") or "").strip()
        for option in (question.options or [])
        if isinstance(option, dict) and option.get("correct") is True
    ]
    correct_options = [option_id for option_id in correct_options if option_id]
    return correct_options[0] if len(correct_options) == 1 else ""


async def record_practice_answer(db: AsyncSession, owner: str, data: dict) -> dict:
    """Grade a canvas answer from server-owned question content and update its mistake."""

    question_id = str(data.get("questionId") or "").strip()
    if not question_id:
        raise ValueError("questionId 不能为空")
    question = await _visible_learning_question(db, question_id)
    if question is None:
        raise LookupError("题目不存在或当前不可学习")
    requested_bank_id = str(data.get("bankId") or "").strip()
    if requested_bank_id and requested_bank_id != question.bank_id:
        raise ValueError("bankId 与题目不一致")
    selected_answer = str(data.get("selectedAnswer") or "").strip()
    option_ids = {
        str(option.get("id") or "").strip()
        for option in (question.options or [])
        if isinstance(option, dict) and str(option.get("id") or "").strip()
    }
    if not selected_answer or selected_answer not in option_ids:
        raise ValueError("selectedAnswer 不是该题的有效选项")
    canonical_answer = _canonical_practice_answer(question)
    if not canonical_answer:
        raise ValueError("题目尚未配置可判定的正确答案")
    correct = selected_answer == canonical_answer
    if not correct:
        mistake = await record_practice_mistake(
            db,
            owner,
            {
                **data,
                "questionId": question.id,
                "bankId": question.bank_id,
                "selectedAnswer": selected_answer,
            },
        )
        return {"correct": False, "mistake": _practice_mistake_to_dict(mistake)}

    release_id = str(data.get("releaseId") or "").strip()
    mistake = (
        await db.execute(
            select(PracticeMistake).where(
                PracticeMistake.owner_id == owner,
                PracticeMistake.question_id == question.id,
                PracticeMistake.release_id == release_id,
            )
        )
    ).scalar_one_or_none()
    if mistake is None:
        return {"correct": True, "mistake": None}
    if mistake.status != "mastered":
        mistake.status = "mastered"
        mistake.next_review_at = None
        mistake.mastered_at = now_utc()
        await _append_practice_event(
            db,
            owner,
            event_type="PRACTICE_MISTAKE_MASTERED",
            question_id=question.id,
            payload={
                "mistakeId": mistake.id,
                "releaseId": release_id,
                "selectedAnswer": selected_answer,
            },
        )
        await db.commit()
        await db.refresh(mistake)
    return {"correct": True, "mistake": _practice_mistake_to_dict(mistake)}


async def list_practice_mistakes(db: AsyncSession, owner: str) -> list[dict]:
    rows = (
        await db.execute(
            select(PracticeMistake)
            .where(PracticeMistake.owner_id == owner)
            .order_by(PracticeMistake.updated_at.desc(), PracticeMistake.id)
        )
    ).scalars().all()
    return [_practice_mistake_to_dict(row) for row in rows]


def _practice_stats(rows: list[PracticeMistake], now) -> dict:
    pending = [row for row in rows if row.status == "pending"]
    remediation = [row for row in rows if row.status == "needs_remediation"]
    due = [row for row in rows if row.status == "verification_due" and (row.next_review_at is None or row.next_review_at <= now)]
    waiting = [row for row in rows if row.status == "verification_due" and row.next_review_at and row.next_review_at > now]
    mastered = [row for row in rows if row.status == "mastered"]
    return {
        "total": len(rows),
        "active": len(pending) + len(remediation) + len(due),
        "pending": len(pending),
        "needsRemediation": len(remediation),
        "verificationDue": len(due),
        "verificationWaiting": len(waiting),
        "mastered": len(mastered),
    }


def _practice_plan(stats: dict) -> dict:
    if stats["verificationDue"]:
        action = {
            "id": "verification",
            "title": "优先完成知识验证",
            "count": stats["verificationDue"],
            "launchMode": "revenge",
            "code": "VERIFICATION_DUE",
            "reason": f"有 {stats['verificationDue']} 道补救后的知识验证已经到期，先确认是否真正掌握。",
        }
    elif stats["needsRemediation"]:
        action = {
            "id": "remediation",
            "title": "继续补救薄弱知识",
            "count": stats["needsRemediation"],
            "launchMode": "revenge",
            "code": "REMEDIATION_REQUIRED",
            "reason": f"有 {stats['needsRemediation']} 道题仍需要知识补救，继续处理比刷新题更重要。",
        }
    elif stats["pending"]:
        action = {
            "id": "revenge",
            "title": "清理待复仇错题",
            "count": stats["pending"],
            "launchMode": "revenge",
            "code": "REVENGE_PENDING",
            "reason": f"有 {stats['pending']} 道真实错题等待复仇，优先把错误变成学习任务。",
        }
    else:
        action = {
            "id": "challenge",
            "title": "继续挑战训练",
            "count": 0,
            "launchMode": "challenge",
            "code": "CONTINUE_CHALLENGE",
            "reason": "当前没有待处理错题，继续用挑战模式累积真实作答证据。",
        }
    return {"version": 1, "idealAction": action, "executableAction": dict(action)}


async def practice_overview(db: AsyncSession, owner: str) -> dict:
    rows = (
        await db.execute(
            select(PracticeMistake)
            .where(PracticeMistake.owner_id == owner)
            .order_by(PracticeMistake.updated_at.desc(), PracticeMistake.id)
        )
    ).scalars().all()
    stats = _practice_stats(rows, now_utc())
    return {"mistakes": [_practice_mistake_to_dict(row) for row in rows], "stats": stats, "plan": _practice_plan(stats)}


async def record_revenge_answer(db: AsyncSession, owner: str, mistake_id: str, data: dict) -> PracticeMistake | None:
    mistake = await _practice_mistake(db, owner, mistake_id)
    if mistake is None:
        return None
    correct = bool(data.get("correct"))
    selected_answer = str(data.get("selectedAnswer") or "").strip()
    now = now_utc()
    mistake.revenge_attempt_count += 1
    mistake.last_revenge_at = now
    if correct:
        mistake.revenge_correct_count += 1
        if mistake.status == "needs_remediation":
            mistake.status = "needs_remediation"
        elif mistake.status == "verification_due" and (mistake.next_review_at is None or mistake.next_review_at <= now):
            mistake.status = "mastered"
            mistake.next_review_at = None
            mistake.mastered_at = now
        else:
            mistake.status = "verification_due"
            mistake.next_review_at = now + PRACTICE_REVIEW_DELAY
            mistake.mastered_at = None
    else:
        mistake.revenge_wrong_count += 1
        mistake.revenge_correct_count = 0
        mistake.status = "needs_remediation"
        mistake.next_review_at = None
        mistake.mastered_at = None
        if selected_answer:
            mistake.selected_answers = [*(mistake.selected_answers or []), selected_answer][-20:]
    await _append_practice_event(
        db,
        owner,
        event_type="PRACTICE_REVENGE_ANSWERED",
        question_id=mistake.question_id,
        payload={"mistakeId": mistake.id, "correct": correct, "status": mistake.status},
    )
    await db.commit()
    await db.refresh(mistake)
    return mistake


async def mark_remediation_reviewed(db: AsyncSession, owner: str, mistake_id: str) -> PracticeMistake | None:
    mistake = await _practice_mistake(db, owner, mistake_id)
    if mistake is None:
        return None
    if mistake.status != "needs_remediation":
        raise ValueError("当前错题不处于待补救状态")
    mistake.remediation_reviewed_at = now_utc()
    await _append_practice_event(
        db,
        owner,
        event_type="PRACTICE_REMEDIATION_REVIEWED",
        question_id=mistake.question_id,
        payload={"mistakeId": mistake.id, "knowledge": mistake.knowledge or {}},
    )
    await db.commit()
    await db.refresh(mistake)
    return mistake


async def practice_verification_candidate(db: AsyncSession, owner: str, mistake_id: str) -> dict | None:
    mistake = await _practice_mistake(db, owner, mistake_id)
    if mistake is None:
        return None
    if mistake.status != "needs_remediation" or mistake.remediation_reviewed_at is None:
        raise ValueError("请先完成错题补救后再获取验证题")
    knowledge = mistake.knowledge or _practice_snapshot_knowledge(mistake.question_snapshot or {})
    taxonomy_id = str(knowledge.get("taxonomyId") or "").strip()
    node_id = str(knowledge.get("nodeId") or "").strip()
    if not taxonomy_id or not node_id:
        raise ValueError("当前错题尚未配置可用于验证的主要知识点")
    query = (
        select(Question)
        .join(QuestionBank, QuestionBank.id == Question.bank_id)
        .where(
            QuestionBank.visibility == "published",
            Question.scope == "public",
            Question.id != mistake.question_id,
            Question.content_metadata["knowledge"]["taxonomyId"].astext == taxonomy_id,
            or_(
                Question.content_metadata["knowledge"]["primaryNodeId"].astext == node_id,
                Question.content_metadata["knowledge"]["nodeId"].astext == node_id,
            ),
        )
        .order_by(Question.created_at, Question.id)
        .limit(1)
    )
    candidate = (await db.execute(query)).scalar_one_or_none()
    if candidate is None:
        return {"available": False, "code": "NO_VERIFICATION_QUESTION", "message": "当前暂无同一核心知识点的其他可用验证题。"}
    return {
        "available": True,
        "code": "READY",
        "message": "已找到同一核心知识点的不同验证题。",
        "question": _question_snapshot(candidate),
    }


async def record_practice_verification(
    db: AsyncSession,
    owner: str,
    mistake_id: str,
    data: dict,
) -> tuple[PracticeMistake, PracticeVerification] | None:
    mistake = await _practice_mistake(db, owner, mistake_id)
    if mistake is None:
        return None
    if mistake.status != "needs_remediation" or mistake.remediation_reviewed_at is None:
        raise ValueError("请先完成错题补救后再提交验证")
    candidate = await practice_verification_candidate(db, owner, mistake_id)
    question_id = str(data.get("questionId") or "").strip()
    if not candidate or not candidate.get("available"):
        raise ValueError("当前没有可用验证题")
    candidate_question = candidate["question"]
    if question_id != str(candidate_question.get("id") or ""):
        raise ValueError("验证题必须是同一知识点的不同已发布题")
    selected_answer = str(data.get("selectedAnswer") or "").strip()
    correct = selected_answer == str(candidate_question.get("correctAnswer") or "")
    verification = PracticeVerification(
        id=uid("pv_"),
        mistake_id=mistake.id,
        owner_id=owner,
        question_id=question_id,
        bank_id=str(candidate_question.get("bankId") or "").strip() or None,
        selected_answer=selected_answer or None,
        correct=correct,
    )
    db.add(verification)
    now = now_utc()
    mistake.verification_attempt_count += 1
    mistake.verification_pass_count += int(correct)
    mistake.verification_fail_count += int(not correct)
    mistake.status = "verification_due" if correct else "needs_remediation"
    mistake.next_review_at = now + PRACTICE_REVIEW_DELAY if correct else None
    mistake.mastered_at = None
    await _append_practice_event(
        db,
        owner,
        event_type="PRACTICE_REMEDIATION_VERIFIED",
        question_id=question_id,
        payload={"mistakeId": mistake.id, "correct": correct, "sourceQuestionId": mistake.question_id},
    )
    await db.commit()
    await db.refresh(mistake)
    await db.refresh(verification)
    return mistake, verification


async def append_event(db: AsyncSession, owner: str, data: dict) -> LearningEvent:
    question_id = data.get("questionId")
    if question_id and not await _owned_question(db, owner, str(question_id)):
        raise LookupError("题目不存在或无权访问")
    event_type = str(data.get("eventType") or "").strip()
    if not event_type:
        raise ValueError("eventType 不能为空")
    event = LearningEvent(
        id=uid("le_"),
        owner_id=owner,
        question_id=str(question_id) if question_id else None,
        event_type=event_type,
        payload=data.get("payload") if isinstance(data.get("payload"), dict) else {},
    )
    db.add(event)
    await db.commit()
    await db.refresh(event)
    return event


async def list_events(
    db: AsyncSession,
    owner: str,
    *,
    question_id: str | None = None,
    page: int = 1,
    page_size: int = 50,
) -> list[dict]:
    query = select(LearningEvent).where(LearningEvent.owner_id == owner)
    if question_id:
        query = query.where(LearningEvent.question_id == question_id)
    query = query.order_by(LearningEvent.created_at.desc()).offset((page - 1) * page_size).limit(min(page_size, 100))
    events = (await db.execute(query)).scalars().all()
    return [event_to_dict(event) for event in events]


PRACTICE_SESSION_EVENT_TYPE = "PRACTICE_SESSION_COMPLETED"


def _practice_session_payload(data: dict) -> dict:
    """Accept only the small, display-ready summary used by the history drawer."""

    mode = str(data.get("mode") or "").strip()
    if mode not in {"challenge", "scholar", "revenge"}:
        raise ValueError("练习模式无效")
    status = str(data.get("status") or "completed").strip()
    if status not in {"completed", "abandoned"}:
        raise ValueError("练习记录状态无效")
    answered = max(0, int(data.get("answered") or 0))
    correct = max(0, min(answered, int(data.get("correct") or 0)))
    return {
        "mode": mode,
        "paperId": str(data.get("paperId") or "").strip()[:120],
        "paperName": str(data.get("paperName") or "未命名练习").strip()[:200],
        "answered": answered,
        "correct": correct,
        "experience": max(0, int(data.get("experience") or 0)),
        "durationMs": max(0, int(data.get("durationMs") or 0)),
        "status": status,
    }


async def record_practice_session(db: AsyncSession, owner: str, data: dict) -> dict:
    payload = _practice_session_payload(data)
    event = LearningEvent(
        id=uid("le_"),
        owner_id=owner,
        event_type=PRACTICE_SESSION_EVENT_TYPE,
        payload=payload,
    )
    db.add(event)
    await db.commit()
    await db.refresh(event)
    return {**payload, "eventId": event.id, "createdAt": _iso(event.created_at)}


async def list_practice_sessions(db: AsyncSession, owner: str) -> list[dict]:
    rows = (
        await db.execute(
            select(LearningEvent)
            .where(
                LearningEvent.owner_id == owner,
                LearningEvent.event_type == PRACTICE_SESSION_EVENT_TYPE,
            )
            .order_by(LearningEvent.created_at.desc())
            .limit(100)
        )
    ).scalars().all()
    return [
        {
            **(row.payload if isinstance(row.payload, dict) else {}),
            "eventId": row.id,
            "createdAt": _iso(row.created_at),
        }
        for row in rows
    ]


async def clear_practice_sessions(db: AsyncSession, owner: str) -> int:
    rows = (
        await db.execute(
            select(LearningEvent).where(
                LearningEvent.owner_id == owner,
                LearningEvent.event_type == PRACTICE_SESSION_EVENT_TYPE,
            )
        )
    ).scalars().all()
    for row in rows:
        await db.delete(row)
    await db.commit()
    return len(rows)


def workspace_to_dict(workspace: CanvasWorkspace) -> dict:
    return {
        "id": workspace.id,
        "title": workspace.title,
        "schemaVersion": workspace.schema_version,
        "payload": workspace.payload or {},
        "createdAt": _iso(workspace.created_at),
        "updatedAt": _iso(workspace.updated_at),
    }


def _workspace_values(data: dict) -> tuple[str, int, dict]:
    title = str(data.get("title") or "").strip()
    if not title:
        raise ValueError("工作区名称不能为空")
    version = int(data.get("schemaVersion") or 6)
    if version not in WORKSPACE_SCHEMA_VERSIONS:
        raise ValueError("不支持的工作区版本")
    payload = data.get("payload")
    if not isinstance(payload, dict):
        raise ValueError("工作区 payload 必须是对象")
    return title[:200], version, payload


async def list_workspaces(db: AsyncSession, owner: str) -> list[dict]:
    query = select(CanvasWorkspace).where(CanvasWorkspace.owner_id == owner).order_by(CanvasWorkspace.updated_at.desc())
    rows = (await db.execute(query)).scalars().all()
    return [workspace_to_dict(row) for row in rows]


async def get_workspace(db: AsyncSession, owner: str, workspace_id: str) -> CanvasWorkspace | None:
    result = await db.execute(
        select(CanvasWorkspace).where(
            CanvasWorkspace.owner_id == owner,
            CanvasWorkspace.id == workspace_id,
        )
    )
    return result.scalar_one_or_none()


async def create_workspace(db: AsyncSession, owner: str, data: dict) -> CanvasWorkspace:
    title, version, payload = _workspace_values(data)
    requested_id = str(data.get("id") or "").strip()
    if requested_id and not WORKSPACE_ID_PATTERN.fullmatch(requested_id):
        raise ValueError("工作区 ID 格式不正确")
    workspace_id = requested_id or uid("cw_")
    if await db.get(CanvasWorkspace, workspace_id) is not None:
        raise ValueError("工作区 ID 已存在")
    workspace = CanvasWorkspace(
        id=workspace_id,
        owner_id=owner,
        title=title,
        schema_version=version,
        payload=payload,
    )
    db.add(workspace)
    await db.commit()
    await db.refresh(workspace)
    return workspace


async def update_workspace(
    db: AsyncSession,
    owner: str,
    workspace_id: str,
    data: dict,
) -> CanvasWorkspace | None:
    workspace = await get_workspace(db, owner, workspace_id)
    if workspace is None:
        return None
    title, version, payload = _workspace_values({
        "title": data.get("title", workspace.title),
        "schemaVersion": data.get("schemaVersion", workspace.schema_version),
        "payload": data.get("payload", workspace.payload),
    })
    workspace.title = title
    workspace.schema_version = version
    workspace.payload = payload
    await db.commit()
    await db.refresh(workspace)
    return workspace


async def delete_workspace(db: AsyncSession, owner: str, workspace_id: str) -> bool:
    workspace = await get_workspace(db, owner, workspace_id)
    if workspace is None:
        return False
    await db.delete(workspace)
    await db.commit()
    return True
