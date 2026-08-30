"""单题深学会话、学习事件和多题工作区服务。"""

from copy import deepcopy
import re
from datetime import timedelta

from sqlalchemy import or_, select, text as sql_text
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.security import now_utc, uid
from app.models.question import Question, QuestionBank
from app.models.paper_release import PaperRelease, PaperReleaseQuestion
from app.models.training import (
    CanvasWorkspace,
    LearningEvent,
    PracticeMistake,
    PracticeSession,
    PracticeVerification,
    TrainingProgress,
)
from app.services import question_catalog_service, question_service, practice_experience_service

SESSION_SCHEMA_VERSIONS = {1, 2}
WORKSPACE_SCHEMA_VERSIONS = set(range(1, 11))
WORKSPACE_ID_PATTERN = re.compile(r"^[A-Za-z0-9_-]{1,64}$")
PRACTICE_MISTAKE_STATUSES = {"pending", "needs_remediation", "verification_due", "mastered"}
PRACTICE_LANGUAGE_MODES = {"zh", "en", "bilingual"}
PUBLISHED_LEARNING_MODES = {
    "practice_mode",
    "deep_recall",
    "multi_question_canvas",
    "single_deep_study",
}
PRACTICE_REVIEW_DELAY = timedelta(days=1)
PRACTICE_ANSWER_ONLY_FIELDS = {
    "answer",
    "analysis",
    "correctanswer",
    "explanation",
    "reasoningsteps",
    "solution",
}


def _iso(value) -> str | None:
    return value.isoformat() if value else None


def _published_learning_mode(data: dict) -> str:
    source_mode = str(data.get("sourceMode") or "").strip().lower()
    return source_mode if source_mode in PUBLISHED_LEARNING_MODES else "practice_mode"


async def _owned_question(db: AsyncSession, owner: str, question_id: str) -> bool:
    if await question_service.get_question(db, owner, question_id) is not None:
        return True
    return await question_catalog_service.is_learning_question_visible(db, question_id)


async def _progress(
    db: AsyncSession, owner: str, question_id: str, release_id: str = ""
) -> TrainingProgress | None:
    release_filter = (
        TrainingProgress.release_id == release_id
        if release_id else TrainingProgress.release_id.is_(None)
    )
    result = await db.execute(
        select(TrainingProgress).where(
            TrainingProgress.owner_id == owner,
            TrainingProgress.question_id == question_id,
            release_filter,
        )
    )
    return result.scalar_one_or_none()


async def _practice_write_lock(
    db: AsyncSession, owner: str, question_id: str, *, allow_concurrent: bool = False
) -> None:
    """Serialize every state mutation for one learner/question pair.

    PostgreSQL transaction advisory locks also cover the first insert, where a
    row lock cannot exist yet.  Using the question (not the release) in the
    scope protects both the release-specific mistake row and the
    owner/question-unique training progress row.

    整卷交卷已通过 PracticeSession 行级 FOR UPDATE 锁把同一学习者的交卷请求
    串行化；此时按题重新排队可能形成跨题锁序，因此以 allow_concurrent 跳过
    单题 advisory 锁，交给外层会话锁保证一次锁定、一次提交。
    """

    if allow_concurrent:
        return
    await db.execute(
        sql_text(
            "SELECT pg_advisory_xact_lock(hashtext(:owner), hashtext(:scope))"
        ),
        {"owner": owner, "scope": f"practice-answer:{question_id}"},
    )


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


async def get_session(
    db: AsyncSession, owner: str, question_id: str, release_id: str = ""
) -> dict | None:
    progress = await _progress(db, owner, question_id, release_id)
    if not progress:
        return None
    return progress.session_data or _legacy_session(progress)


async def save_session(
    db: AsyncSession,
    owner: str,
    question_id: str,
    data: dict,
    *,
    release_id: str = "",
    current_user: "object | None" = None,
) -> dict | None:
    if release_id:
        question = await _visible_learning_question(
            db, question_id, current_user, release_id=release_id, mode="single_deep_study"
        )
        if question is None:
            return None
    elif not await _owned_question(db, owner, question_id):
        return None
    version = int(data.get("schemaVersion") or 1)
    if version not in SESSION_SCHEMA_VERSIONS:
        raise ValueError("不支持的学习会话版本")
    await _practice_write_lock(db, owner, f"{release_id}:{question_id}")
    progress = await _progress(db, owner, question_id, release_id)
    answer = data.get("answer") if isinstance(data.get("answer"), dict) else {}
    if progress is None:
        progress = TrainingProgress(
            id=uid("tp_"),
            owner_id=owner,
            question_id=question_id,
            release_id=release_id or None,
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


def _question_snapshot_from_payload(snapshot: dict) -> dict:
    """Durable practice-snapshot projection of a frozen release question.

    correctAnswer/metadata(答案元数据)/analysis 是判题内部数据，不进入长期错题快照；
    options.correct 标记会被 redact_practice_question 在读取时统一剥离。
    """

    return {
        key: deepcopy(value)
        for key, value in (snapshot or {}).items()
        if key not in {"correctAnswer", "analysis", "releaseScore", "metadata"}
    }


def redact_practice_question(value):
    """Return a learner-safe question payload before server grading."""

    if isinstance(value, list):
        return [redact_practice_question(item) for item in value]
    if not isinstance(value, dict):
        return deepcopy(value)
    redacted = {}
    for key, item in value.items():
        if str(key).replace("_", "").lower() in PRACTICE_ANSWER_ONLY_FIELDS:
            continue
        if key == "correct":
            continue
        redacted[key] = redact_practice_question(item)
    return redacted


def _practice_mistake_to_dict(
    mistake: PracticeMistake,
    *,
    reveal_answer: bool = True,
) -> dict:
    return {
        "id": mistake.id,
        "questionId": mistake.question_id,
        "bankId": mistake.bank_id,
        "paperId": mistake.paper_id,
        "releaseId": mistake.release_id or "",
        "paperVersion": mistake.paper_version,
        "paperName": mistake.paper_name,
        "sourceMode": mistake.source_mode,
        "languageMode": mistake.language_mode,
        "questionSnapshot": (
            deepcopy(mistake.question_snapshot or {})
            if reveal_answer
            else redact_practice_question(mistake.question_snapshot or {})
        ),
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


async def _practice_mistake(
    db: AsyncSession,
    owner: str,
    mistake_id: str,
    *,
    for_update: bool = False,
) -> PracticeMistake | None:
    query = select(PracticeMistake).where(
        PracticeMistake.id == mistake_id,
        PracticeMistake.owner_id == owner,
    )
    if for_update:
        query = query.with_for_update()
    return (
        await db.execute(query)
    ).scalar_one_or_none()


async def _visible_learning_question(
    db: AsyncSession,
    question_id: str,
    current_user: "object | None" = None,
    *,
    release_id: str = "",
    mode: str = "practice_mode",
) -> Question | None:
    if current_user is not None and release_id:
        from app.services import published_paper_access_service

        frozen = await published_paper_access_service.load_published_question(
            db, current_user, release_id, question_id, mode=mode
        )
        if frozen is not None:
            return frozen
        return None
    query = (
        select(Question)
        .join(QuestionBank, QuestionBank.id == Question.bank_id)
        .where(
            Question.id == question_id,
            QuestionBank.visibility == "published",
            Question.scope == "public",
        )
    )
    question = (await db.execute(query)).scalar_one_or_none()
    if question is not None:
        return question
    # 题库未公开且没有发布版本上下文时不可学习。
    return None


async def _append_practice_event(
    db: AsyncSession,
    owner: str,
    *,
    event_type: str,
    question_id: str | None,
    payload: dict,
    snapshot_only: bool = False,
) -> None:
    event_payload = dict(payload)
    stored_question_id = question_id
    if question_id and await db.get(Question, question_id) is None:
        event_payload.setdefault("sourceQuestionId", question_id)
        stored_question_id = None
    if snapshot_only and question_id:
        event_payload.setdefault("sourceQuestionId", question_id)
        stored_question_id = None
    db.add(
        LearningEvent(
            id=uid("le_"),
            owner_id=owner,
            question_id=stored_question_id,
            event_type=event_type,
            payload=event_payload,
        )
    )


async def record_practice_mistake(
    db: AsyncSession, owner: str, data: dict, current_user: "object | None" = None
) -> PracticeMistake:
    question_id = str(data.get("questionId") or "").strip()
    if not question_id:
        raise ValueError("questionId 不能为空")
    release_id = str(data.get("releaseId") or "").strip()
    question = await _visible_learning_question(
        db,
        question_id,
        current_user,
        release_id=release_id,
        mode=_published_learning_mode(data),
    )
    if question is None:
        raise LookupError("题目不存在或当前不可学习")
    requested_bank_id = str(data.get("bankId") or "").strip()
    if requested_bank_id and requested_bank_id != question.bank_id:
        raise ValueError("bankId 与题目不一致")
    selected_answer = str(data.get("selectedAnswer") or data.get("reason") or "").strip()
    language_mode = str(data.get("languageMode") or "zh").strip().lower()
    if language_mode not in PRACTICE_LANGUAGE_MODES:
        raise ValueError("languageMode 不受支持")
    canonical_answer = _canonical_practice_answer(question)
    option_ids = {
        str(option.get("id") or "").strip()
        for option in (question.options or [])
        if isinstance(option, dict) and str(option.get("id") or "").strip()
    }
    if selected_answer != "timeout":
        if not selected_answer or selected_answer not in option_ids:
            raise ValueError("selectedAnswer 不是该题的有效选项")
        if canonical_answer and selected_answer == canonical_answer:
            raise ValueError("正确答案不能记录为错题")
    await _practice_write_lock(db, owner, f"{release_id}:{question.id}")
    existing = (
        await db.execute(
            select(PracticeMistake).where(
                PracticeMistake.owner_id == owner,
                PracticeMistake.question_id == question.id,
                (PracticeMistake.release_id == release_id)
                if release_id else PracticeMistake.release_id.is_(None),
            ).with_for_update()
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
            release_id=release_id or None,
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
        # A fresh wrong answer always reactivates a previously mastered or
        # waiting item.  Remediation is the one exception: answering the
        # original option again cannot bypass the required repair activity.
        if existing.status != "needs_remediation":
            existing.status = "pending"
        existing.wrong_count += 1
        existing.revenge_correct_count = 0
        existing.last_wrong_at = now
        if existing.status != "needs_remediation":
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


async def _record_answer_completion(
    db: AsyncSession,
    owner: str,
    question: Question,
    data: dict,
    *,
    selected_answer: str,
    correct: bool,
) -> dict:
    """Persist the fact that one option was accepted, independently of mastery."""

    progress = await _progress(
        db, owner, question.id, str(data.get("releaseId") or "").strip()
    )
    now = now_utc()
    previous_session = progress.session_data if progress and isinstance(progress.session_data, dict) else {}
    previous_context = previous_session.get("context") if isinstance(previous_session.get("context"), dict) else {}
    context = {
        **previous_context,
        "paperId": str(data.get("paperId") or previous_context.get("paperId") or ""),
        "releaseId": str(data.get("releaseId") or previous_context.get("releaseId") or ""),
        "questionId": question.id,
        "bankId": question.bank_id,
        "mode": str(data.get("sourceMode") or previous_context.get("mode") or "practice_mode"),
    }
    completed_at = previous_session.get("completedAt") or _iso(now)
    answer = previous_session.get("answer") if isinstance(previous_session.get("answer"), dict) else {}
    session_data = {
        **previous_session,
        "schemaVersion": 2,
        "status": "completed",
        "context": context,
        "paperId": context["paperId"],
        "releaseId": context["releaseId"],
        "questionId": question.id,
        "bankId": question.bank_id,
        "mode": context["mode"],
        "currentStep": max(1, int(previous_session.get("currentStep") or 1)),
        "completedAt": completed_at,
        "updatedAt": _iso(now),
        "answer": {
            **answer,
            "selectedAnswer": selected_answer,
            "selectedOptionId": selected_answer,
            "submitted": True,
            "isCorrect": correct,
        },
    }
    if progress is None:
        progress = TrainingProgress(
            id=uid("tp_"),
            owner_id=owner,
            question_id=question.id,
            release_id=context["releaseId"] or None,
            bank_id=question.bank_id,
            paper_id=context["paperId"] or None,
            selected_answer=selected_answer,
            submitted=True,
            found_clues=[],
            reasoning_state={},
            session_data=session_data,
        )
        db.add(progress)
    else:
        progress.bank_id = question.bank_id
        progress.paper_id = context["paperId"] or None
        progress.selected_answer = selected_answer
        progress.submitted = True
        progress.session_data = session_data
    return {
        "status": "completed",
        "questionId": question.id,
        "bankId": question.bank_id,
        "paperId": context["paperId"],
        "releaseId": context["releaseId"],
        "selectedAnswer": selected_answer,
        "correct": correct,
        "completedAt": completed_at,
    }


def _advance_mistake_after_correct(mistake: PracticeMistake, now) -> str:
    """Apply the Update delayed-verification rule without bypassing remediation."""

    if mistake.status == "needs_remediation":
        return mistake.status
    if mistake.status == "verification_due":
        if mistake.next_review_at is None or mistake.next_review_at <= now:
            mistake.status = "mastered"
            mistake.next_review_at = None
            mistake.mastered_at = now
        return mistake.status
    if mistake.status == "mastered":
        return mistake.status
    mistake.status = "verification_due"
    mistake.next_review_at = now + PRACTICE_REVIEW_DELAY
    mistake.mastered_at = None
    return mistake.status


async def record_practice_answer(
    db: AsyncSession,
    owner: str,
    data: dict,
    current_user: "object | None" = None,
    *,
    commit: bool = True,
    allow_concurrent: bool = False,
    record: bool = True,
) -> dict:
    """Grade a canvas answer from server-owned question content and update its mistake.

    record=False 只做权威判定、完全不动长期状态：整卷交卷重算时用于
    升级前已被旧 /answers 记过账的答案，避免同一事务内二次累计
    wrongCount 或撞 (owner, question, release) 唯一索引。
    """

    question_id = str(data.get("questionId") or "").strip()
    if not question_id:
        raise ValueError("questionId 不能为空")
    release_id = str(data.get("releaseId") or "").strip()
    question = await _visible_learning_question(
        db,
        question_id,
        current_user,
        release_id=release_id,
        mode=_published_learning_mode(data),
    )
    if question is None:
        raise LookupError("题目不存在或当前不可学习")
    requested_bank_id = str(data.get("bankId") or "").strip()
    if requested_bank_id and requested_bank_id != question.bank_id:
        raise ValueError("bankId 与题目不一致")
    timed_out = data.get("timedOut") is True
    selected_answer = str(data.get("selectedAnswer") or "").strip()
    option_ids = {
        str(option.get("id") or "").strip()
        for option in (question.options or [])
        if isinstance(option, dict) and str(option.get("id") or "").strip()
    }
    if timed_out:
        selected_answer = "__timeout__"
    elif not selected_answer or selected_answer not in option_ids:
        raise ValueError("selectedAnswer 不是该题的有效选项")
    canonical_answer = _canonical_practice_answer(question)
    if not canonical_answer:
        raise ValueError("题目尚未配置可判定的正确答案")
    correct = selected_answer == canonical_answer
    await _practice_write_lock(
        db, owner, f"{release_id}:{question.id}", allow_concurrent=allow_concurrent
    )
    mistake = (
        await db.execute(
            select(PracticeMistake).where(
                PracticeMistake.owner_id == owner,
                PracticeMistake.question_id == question.id,
                (PracticeMistake.release_id == release_id)
                if release_id else PracticeMistake.release_id.is_(None),
            ).with_for_update()
        )
    ).scalar_one_or_none()
    now = now_utc()
    if not record:
        # 只判定：长期错题状态保持原样（锁内的 FOR UPDATE 读取不产生写入）。
        completion = await _record_answer_completion(
            db, owner, question, data, selected_answer=selected_answer, correct=correct
        )
        return {"correct": correct, "mistake": None, "completion": completion}
    if not correct:
        if mistake is None:
            mistake = PracticeMistake(
                id=uid("pm_"), owner_id=owner, question_id=question.id, bank_id=question.bank_id,
                paper_id=str(data.get("paperId") or "").strip() or None, release_id=release_id or None,
                paper_version=max(0, int(data.get("paperVersion") or 0)),
                paper_name=str(data.get("paperName") or "错题来源试卷").strip()[:200] or "错题来源试卷",
                source_mode=str(data.get("sourceMode") or "challenge").strip()[:32] or "challenge",
                language_mode=str(data.get("languageMode") or "zh").strip().lower(),
                question_snapshot=_question_snapshot(question), knowledge=_practice_knowledge(question),
                selected_answers=[selected_answer], status="pending", wrong_count=1,
                first_wrong_at=now, last_wrong_at=now,
            )
            db.add(mistake)
        else:
            mistake.question_snapshot = _question_snapshot(question)
            mistake.knowledge = _practice_knowledge(question)
            mistake.selected_answers = [*(mistake.selected_answers or []), selected_answer][-20:]
            if mistake.status != "needs_remediation":
                mistake.status = "pending"
            mistake.wrong_count += 1
            mistake.revenge_correct_count = 0
            mistake.last_wrong_at = now
            mistake.next_review_at = None
            mistake.mastered_at = None
        await _append_practice_event(
            db,
            owner,
            event_type="PRACTICE_MISTAKE_RECORDED",
            question_id=question.id,
            payload={"mistakeId": mistake.id, "status": mistake.status, "knowledge": mistake.knowledge},
        )
    elif mistake is not None:
        previous_status = mistake.status
        next_status = _advance_mistake_after_correct(mistake, now)
        if next_status != previous_status:
            await _append_practice_event(
                db,
                owner,
                event_type="PRACTICE_MISTAKE_MASTERED" if next_status == "mastered" else "PRACTICE_MISTAKE_VERIFICATION_SCHEDULED",
                question_id=question.id,
                payload={"mistakeId": mistake.id, "releaseId": release_id, "selectedAnswer": selected_answer, "status": next_status},
            )
    completion = await _record_answer_completion(
        db, owner, question, data, selected_answer=selected_answer, correct=correct
    )
    await _append_practice_event(
        db, owner, event_type="PRACTICE_ANSWER_COMPLETED", question_id=question.id,
        payload={**completion, "mistakeId": mistake.id if mistake else None},
    )
    if commit:
        await db.commit()
        if mistake is not None:
            await db.refresh(mistake)
        return {
            "correct": correct,
            "mistake": _practice_mistake_to_dict(mistake) if mistake else None,
            "completion": completion,
        }
    # 外层事务（整卷交卷）还要继续写库：不做 refresh。新插入的 mistake 已有
    # Python 侧默认值可读；既有行的 server_default/onupdate 时间戳列在提交后
    # 才会过期加载，这里读取会触发同步 IO（MissingGreenlet），因此只返回判题
    # 相关的权威事实（id/status/wrong_count 由调用方在需要时按 id 再查）。
    if mistake is not None and mistake in db.new:
        return {
            "correct": correct,
            "mistake": _practice_mistake_to_dict(mistake),
            "completion": completion,
        }
    return {
        "correct": correct,
        "mistake": {
            "id": mistake.id,
            "status": mistake.status,
            "wrongCount": mistake.wrong_count,
        }
        if mistake is not None
        else None,
        "completion": completion,
    }


async def list_practice_mistakes(db: AsyncSession, owner: str) -> list[dict]:
    rows = (
        await db.execute(
            select(PracticeMistake)
            .where(PracticeMistake.owner_id == owner)
            .order_by(PracticeMistake.updated_at.desc(), PracticeMistake.id)
        )
    ).scalars().all()
    return [_practice_mistake_to_dict(row, reveal_answer=False) for row in rows]


async def record_mistake_from_release(
    db: AsyncSession,
    owner: str,
    release_question: "PaperReleaseQuestion",
    *,
    paper_id: str,
    source_mode: str,
    selected_answer: str,
    language_mode: str = "zh",
    commit: bool = True,
) -> PracticeMistake:
    """Record a wrong answer for a question that only exists in a frozen release.

    复用 PracticeMistake 长期错题模型：题干/解析来自 PaperReleaseQuestion 的
    冻结快照，保证即使源 Question 被删除，错题本身仍然可复盘。
    """

    question_id = release_question.question_id
    await _practice_write_lock(db, owner, question_id)
    mistake = (
        await db.execute(
            select(PracticeMistake).where(
                PracticeMistake.owner_id == owner,
                PracticeMistake.question_id == question_id,
                (
                    PracticeMistake.release_id == release_question.release_id
                    if release_question.release_id
                    else PracticeMistake.release_id.is_(None)
                ),
            ).with_for_update()
        )
    ).scalar_one_or_none()
    now = now_utc()
    snapshot = release_question.snapshot or {}
    knowledge = _practice_snapshot_knowledge(snapshot)
    practice_snapshot = _question_snapshot_from_payload(snapshot)
    if mistake is None:
        mistake = PracticeMistake(
            id=uid("pm_"),
            owner_id=owner,
            question_id=question_id,
            bank_id=release_question.bank_id,
            paper_id=paper_id or None,
            release_id=release_question.release_id,
            paper_version=0,
            paper_name="发布试卷练习",
            source_mode=source_mode[:32] or "challenge",
            language_mode=language_mode.lower(),
            question_snapshot=practice_snapshot,
            knowledge=knowledge,
            selected_answers=[selected_answer],
            status="pending",
            wrong_count=1,
            first_wrong_at=now,
            last_wrong_at=now,
        )
        db.add(mistake)
    else:
        mistake.question_snapshot = practice_snapshot
        mistake.knowledge = knowledge
        mistake.selected_answers = [*(mistake.selected_answers or []), selected_answer][-20:]
        if mistake.status != "needs_remediation":
            mistake.status = "pending"
        mistake.wrong_count += 1
        mistake.revenge_correct_count = 0
        mistake.last_wrong_at = now
        mistake.next_review_at = None
        mistake.mastered_at = None
    await _append_practice_event(
        db,
        owner,
        event_type="PRACTICE_MISTAKE_RECORDED",
        question_id=question_id,
        payload={"mistakeId": mistake.id, "status": mistake.status, "knowledge": knowledge},
    )
    if commit:
        await db.commit()
        await db.refresh(mistake)
    return mistake


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


def canonical_practice_snapshot_answer(snapshot: dict) -> str:
    if not isinstance(snapshot, dict):
        return ""
    options = snapshot.get("options")
    if not isinstance(options, list):
        return ""
    option_ids = {
        str(option.get("id") or "").strip()
        for option in options
        if isinstance(option, dict) and str(option.get("id") or "").strip()
    }
    explicit = str(snapshot.get("correctAnswer") or "").strip()
    if explicit in option_ids:
        return explicit
    correct_options = [
        str(option.get("id") or "").strip()
        for option in options
        if isinstance(option, dict)
        and option.get("correct") is True
        and str(option.get("id") or "").strip()
    ]
    return correct_options[0] if len(correct_options) == 1 else ""


def _revenge_snapshot_usable(snapshot: dict) -> bool:
    if not isinstance(snapshot, dict):
        return False
    options = snapshot.get("options")
    if not isinstance(options, list):
        return False
    option_ids = {
        str(option.get("id") or "").strip()
        for option in options
        if isinstance(option, dict) and str(option.get("id") or "").strip()
    }
    correct_answer = canonical_practice_snapshot_answer(snapshot)
    stem = str(snapshot.get("stem") or snapshot.get("title") or "").strip()
    return bool(stem and len(option_ids) >= 2 and correct_answer in option_ids)


def _revenge_status_rank(row: PracticeMistake, now) -> int:
    if row.status == "needs_remediation":
        return 0
    if row.status == "pending":
        return 1
    if row.status == "verification_due":
        if row.next_review_at is None or row.next_review_at <= now:
            return 2
        return 3
    if row.status == "mastered":
        return 4
    return 9


def _revenge_row_key(row: PracticeMistake, now) -> tuple:
    updated_at = row.updated_at.timestamp() if row.updated_at else 0.0
    return (
        _revenge_status_rank(row, now),
        -int(row.revenge_wrong_count or 0),
        -int(row.wrong_count or 0),
        -updated_at,
        str(row.id),
    )


def build_global_revenge_pool(
    rows: list[PracticeMistake], *, now=None
) -> dict:
    current_time = now or now_utc()
    grouped: dict[str, list[PracticeMistake]] = {}
    for row in rows:
        question_id = str(row.question_id or "").strip()
        if not question_id:
            continue
        grouped.setdefault(question_id, []).append(row)

    representatives: list[tuple[PracticeMistake, list[PracticeMistake]]] = []
    unavailable_count = 0
    for group_rows in grouped.values():
        active_rows = [
            row for row in group_rows if _revenge_status_rank(row, current_time) <= 2
        ]
        eligible_rows = active_rows or group_rows
        usable_rows = [
            row
            for row in eligible_rows
            if _revenge_snapshot_usable(row.question_snapshot or {})
        ]
        if not usable_rows:
            if active_rows:
                unavailable_count += 1
            continue
        ordered = sorted(usable_rows, key=lambda row: _revenge_row_key(row, current_time))
        if _revenge_status_rank(ordered[0], current_time) > 4:
            continue
        representative = ordered[0]
        grouped_order = [
            representative,
            *sorted(
                (row for row in group_rows if row.id != representative.id),
                key=lambda row: _revenge_row_key(row, current_time),
            ),
        ]
        representatives.append((representative, grouped_order))
    representatives.sort(key=lambda item: _revenge_row_key(item[0], current_time))

    stats = {
        "active": 0,
        "pending": 0,
        "needsRemediation": 0,
        "verificationDue": 0,
        "verificationWaiting": 0,
        "mastered": 0,
    }
    candidates = []
    for representative, group_rows in representatives:
        rank = _revenge_status_rank(representative, current_time)
        if rank == 0:
            stats["needsRemediation"] += 1
        elif rank == 1:
            stats["pending"] += 1
        elif rank == 2:
            stats["verificationDue"] += 1
        elif rank == 3:
            stats["verificationWaiting"] += 1
        elif rank == 4:
            stats["mastered"] += 1
        if rank > 2:
            continue
        stats["active"] += 1
        candidate = _practice_mistake_to_dict(representative, reveal_answer=True)
        snapshot = deepcopy(candidate.get("questionSnapshot") or {})
        snapshot["correctAnswer"] = canonical_practice_snapshot_answer(snapshot)
        candidate["questionSnapshot"] = snapshot
        candidate["mistakeId"] = representative.id
        candidate["mistakeIds"] = [row.id for row in group_rows]
        candidates.append(candidate)
    return {
        "candidates": candidates,
        "stats": stats,
        "unavailableCount": unavailable_count,
    }


async def global_revenge_candidates(db: AsyncSession, owner: str) -> list[dict]:
    return (await global_revenge_pool(db, owner))["candidates"]


async def global_revenge_pool(db: AsyncSession, owner: str) -> dict:
    rows = (
        await db.execute(
            select(PracticeMistake)
            .where(PracticeMistake.owner_id == owner)
            .order_by(PracticeMistake.updated_at.desc(), PracticeMistake.id)
        )
    ).scalars().all()
    return build_global_revenge_pool(list(rows))


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
    revenge_pool = build_global_revenge_pool(list(rows))
    public_candidates = [
        {
            **candidate,
            "questionSnapshot": redact_practice_question(
                candidate.get("questionSnapshot") or {}
            ),
        }
        for candidate in revenge_pool["candidates"]
    ]
    return {
        "mistakes": [
            _practice_mistake_to_dict(row, reveal_answer=False) for row in rows
        ],
        "stats": stats,
        "revengeStats": {
            **revenge_pool["stats"],
            "unavailable": revenge_pool["unavailableCount"],
        },
        "revengeCandidates": public_candidates,
        "plan": _practice_plan(revenge_pool["stats"]),
    }


async def record_revenge_answer(
    db: AsyncSession,
    owner: str,
    mistake_id: str,
    data: dict,
    *,
    commit: bool = True,
    allow_concurrent: bool = False,
    record: bool = True,
    authoritative_snapshot: dict | None = None,
) -> PracticeMistake | None:
    mistake = await _practice_mistake(db, owner, mistake_id)
    if mistake is None:
        return None
    if not mistake.question_id:
        raise ValueError("错题已缺少可判定的原题")
    await _practice_write_lock(
        db, owner, mistake.question_id, allow_concurrent=allow_concurrent
    )
    mistake = await _practice_mistake(db, owner, mistake_id, for_update=True)
    if mistake is None:
        return None
    if not record:
        # 只判定：升级链路对已记账的复仇答案不重放长期状态推进。
        return mistake
    selected_answer = str(data.get("selectedAnswer") or "").strip()
    snapshot = (
        authoritative_snapshot
        if isinstance(authoritative_snapshot, dict)
        else mistake.question_snapshot
        if isinstance(mistake.question_snapshot, dict)
        else {}
    )
    option_ids = {
        str(option.get("id") or "").strip()
        for option in snapshot.get("options") or []
        if isinstance(option, dict) and str(option.get("id") or "").strip()
    }
    if not selected_answer or selected_answer not in option_ids:
        raise ValueError("selectedAnswer 不是该题的有效选项")
    canonical_answer = canonical_practice_snapshot_answer(snapshot)
    if not canonical_answer:
        raise ValueError("错题快照尚未配置可判定的正确答案")
    correct = selected_answer == canonical_answer
    now = now_utc()
    mistake.revenge_attempt_count += 1
    mistake.last_revenge_at = now
    if correct:
        mistake.revenge_correct_count += 1
        _advance_mistake_after_correct(mistake, now)
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
    if commit:
        await db.commit()
        await db.refresh(mistake)
    return mistake


async def mark_remediation_reviewed(
    db: AsyncSession,
    owner: str,
    mistake_id: str,
    *,
    commit: bool = True,
) -> PracticeMistake | None:
    mistake = await _practice_mistake(db, owner, mistake_id)
    if mistake is None:
        return None
    if not mistake.question_id:
        raise ValueError("错题已缺少原题")
    await _practice_write_lock(db, owner, mistake.question_id)
    mistake = await _practice_mistake(db, owner, mistake_id, for_update=True)
    if mistake is None:
        return None
    if mistake.status != "needs_remediation":
        raise ValueError("当前错题不处于待补救状态")
    if mistake.remediation_reviewed_at is not None:
        return mistake
    mistake.remediation_reviewed_at = now_utc()
    await _append_practice_event(
        db,
        owner,
        event_type="PRACTICE_REMEDIATION_REVIEWED",
        question_id=mistake.question_id,
        payload={"mistakeId": mistake.id, "knowledge": mistake.knowledge or {}},
    )
    if commit:
        await db.commit()
        await db.refresh(mistake)
    return mistake


async def practice_verification_candidate(
    db: AsyncSession,
    owner: str,
    mistake_id: str,
    *,
    reveal_answer: bool = False,
) -> dict | None:
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
        "question": (
            _question_snapshot(candidate)
            if reveal_answer
            else redact_practice_question(_question_snapshot(candidate))
        ),
    }


async def record_practice_verification(
    db: AsyncSession,
    owner: str,
    mistake_id: str,
    data: dict,
    *,
    commit: bool = True,
) -> tuple[PracticeMistake, PracticeVerification, dict] | None:
    mistake = await _practice_mistake(db, owner, mistake_id)
    if mistake is None:
        return None
    if not mistake.question_id:
        raise ValueError("错题已缺少原题")
    await _practice_write_lock(db, owner, mistake.question_id)
    mistake = await _practice_mistake(db, owner, mistake_id, for_update=True)
    if mistake is None:
        return None
    if mistake.status != "needs_remediation" or mistake.remediation_reviewed_at is None:
        raise ValueError("请先完成错题补救后再提交验证")
    candidate = await practice_verification_candidate(
        db, owner, mistake_id, reveal_answer=True
    )
    question_id = str(data.get("questionId") or "").strip()
    if not candidate or not candidate.get("available"):
        raise ValueError("当前没有可用验证题")
    candidate_question = candidate["question"]
    if question_id != str(candidate_question.get("id") or ""):
        raise ValueError("验证题必须是同一知识点的不同已发布题")
    selected_answer = str(data.get("selectedAnswer") or "").strip()
    option_ids = {
        str(option.get("id") or "").strip()
        for option in candidate_question.get("options") or []
        if isinstance(option, dict) and str(option.get("id") or "").strip()
    }
    if not selected_answer or selected_answer not in option_ids:
        raise ValueError("selectedAnswer 不是验证题的有效选项")
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
    if commit:
        await db.commit()
        await db.refresh(mistake)
        await db.refresh(verification)
    return mistake, verification, candidate_question


async def append_event(db: AsyncSession, owner: str, data: dict) -> LearningEvent:
    question_id = data.get("questionId")
    source_question_id = str(question_id or "").strip() or None
    if question_id and await db.get(Question, str(question_id)) is None:
        question_id = None
    event_type = str(data.get("eventType") or "").strip()
    if not event_type:
        raise ValueError("eventType 不能为空")
    if event_type == practice_experience_service.EXPERIENCE_EVENT_TYPE:
        raise ValueError("该学习事件只能由服务器结算生成")
    payload = data.get("payload") if isinstance(data.get("payload"), dict) else {}
    payload = dict(payload)
    if source_question_id and question_id is None:
        payload.setdefault("sourceQuestionId", source_question_id)
    event = LearningEvent(
        id=uid("le_"),
        owner_id=owner,
        question_id=str(question_id) if question_id else None,
        event_type=event_type,
        payload=payload,
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
    if mode not in {"challenge", "scholar", "revenge", "practice"}:
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
    # 兼容入口只保留旧版历史展示，不接受客户端声明的经验值。
    payload["experience"] = 0
    payload["trustedExperience"] = False
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
    modern_rows = list(
        (
            await db.execute(
                select(PracticeSession, PaperRelease.name)
                .join(PaperRelease, PaperRelease.id == PracticeSession.release_id)
                .where(
                    PracticeSession.owner_id == owner,
                    or_(PracticeSession.status.in_(["completed", "abandoned"]),
                        (PracticeSession.status == "paused") & (PracticeSession.stats["answered"].as_integer() > 0)),
                    PracticeSession.stats["historyHidden"].as_boolean().isnot(True),
                )
                .order_by(PracticeSession.last_saved_at.desc())
                .limit(100)
            )
        ).all()
    )
    modern = [
        {
            "sessionId": session.id,
            "mode": session.mode,
            "paperId": session.paper_id,
            "paperName": paper_name,
            "answered": max(0, int((session.stats or {}).get("answered") or 0)),
            "correct": max(0, int((session.stats or {}).get("correct") or 0)),
            "experience": max(0, int((session.stats or {}).get("experience") or 0)),
            "durationMs": max(0, int((session.stats or {}).get("durationMs") or 0)),
            "status": session.status,
            "reportAvailable": session.status == "completed" and isinstance(session.report_snapshot, dict),
            "createdAt": _iso(session.completed_at or session.abandoned_at or session.last_saved_at),
        }
        for session, paper_name in modern_rows
    ]
    modern_ids = {row["sessionId"] for row in modern}
    event_rows = (
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
    legacy = [
        {
            **(row.payload if isinstance(row.payload, dict) else {}),
            "eventId": row.id,
            "createdAt": _iso(row.created_at),
            "reportAvailable": False,
        }
        for row in event_rows
        if str((row.payload or {}).get("sessionId") or "") not in modern_ids
    ]
    return sorted(
        [*modern, *legacy],
        key=lambda row: str(row.get("createdAt") or ""),
        reverse=True,
    )[:100]


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
    modern_rows = (
        await db.execute(
            select(PracticeSession).where(
                PracticeSession.owner_id == owner,
                PracticeSession.status.in_(["completed", "abandoned"]),
            )
        )
    ).scalars().all()
    for row in modern_rows:
        await db.delete(row)
    resumable = (await db.execute(select(PracticeSession).where(
        PracticeSession.owner_id == owner,
        PracticeSession.status.in_(["active", "paused"]),
    ))).scalars().all()
    for session in resumable:
        session.stats = {**(session.stats or {}), "historyHidden": True}
    await db.commit()
    return len(rows) + len(modern_rows) + len(resumable)


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


def _learning_week_start(now_local):
    """学霸学习周：每周日 19:00 开始，到下一周日 19:00 结束。返回本期起点。"""
    from datetime import datetime, time as dt_time, timezone

    aware = now_local if now_local.tzinfo else now_local.replace(tzinfo=timezone.utc)
    candidate = aware.replace(hour=19, minute=0, second=0, microsecond=0)
    # Python weekday(): 周一=0 … 周日=6；目标周日
    days_since_sunday = (aware.weekday() + 1) % 7
    week_sunday = candidate - timedelta(days=days_since_sunday)
    if aware < week_sunday:
        week_sunday = week_sunday - timedelta(days=7)
    return week_sunday


async def practice_experience_summary(db: AsyncSession, owner: str) -> dict:
    """做题经验聚合：累计 / 本学习周（周日19:00 起）/ 最近 7 个自然日。

    经验只来自服务器创建的差额事件；旧版客户端摘要及同名伪造事件不参与累计。
    """
    from datetime import datetime, timezone

    rows = (
        await db.execute(
            select(LearningEvent).where(
                LearningEvent.owner_id == owner,
                LearningEvent.event_type == practice_experience_service.EXPERIENCE_EVENT_TYPE,
                LearningEvent.id.startswith(practice_experience_service.EXPERIENCE_ID_PREFIX, autoescape=True),
            )
        )
    ).scalars().all()
    now_local = datetime.now(timezone.utc).astimezone()
    week_start = _learning_week_start(now_local)
    daily: dict[str, int] = {}
    for offset in range(6, -1, -1):
        day = (now_local - timedelta(days=offset)).date()
        daily[day.isoformat()] = 0
    total = 0
    weekly = 0
    for row in rows:
        stats = row.payload if isinstance(row.payload, dict) else {}
        try:
            experience = max(0, int(stats.get("delta") or 0))
        except (TypeError, ValueError):
            experience = 0
        total += experience
        completed_at = row.created_at
        created_local = completed_at.astimezone(now_local.tzinfo) if completed_at else None
        if created_local and created_local >= week_start:
            weekly += experience
        if created_local:
            key = created_local.date().isoformat()
            if key in daily:
                daily[key] += experience
    return {
        "totalExperience": total,
        "weekExperience": weekly,
        "weekStart": week_start.isoformat(),
        "weekEnd": (week_start + timedelta(days=7)).isoformat(),
        "daily": [{"date": key, "experience": value} for key, value in daily.items()],
    }
