"""Resumable practice session lifecycle and frozen scoring facts."""

from __future__ import annotations

import hashlib
import secrets
from typing import Any

from sqlalchemy import select, text as sql_text
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.security import now_utc, uid
from app.models.paper_release import PaperRelease, PaperReleaseQuestion
from app.models.training import PracticeSession
from app.models.user import User
from app.services import learning_service, paper_composition_service, paper_release_service
from app.services.practice_scoring_service import (
    DEFAULT_DOMAIN_WEIGHTS,
    DEFAULT_SIMULATION_SCORING,
)


PRACTICE_SESSION_MODES = {"challenge", "scholar", "revenge"}
PRACTICE_QUESTION_COUNTS = {10, 20, 60, 180}
PRACTICE_ORDERS = {"paper", "random"}
RUNTIME_INTEGER_FIELDS = {
    "currentIndex",
    "health",
    "streak",
    "maxStreak",
    "experience",
    "remainingMs",
    "durationMs",
}
RUNTIME_FIELDS = RUNTIME_INTEGER_FIELDS | {"languageMode", "autoExplain"}


class PracticeSessionError(RuntimeError):
    def __init__(
        self,
        status_code: int,
        code: str,
        message: str,
        **context: Any,
    ) -> None:
        super().__init__(message)
        self.status_code = status_code
        self.code = code
        self.message = message
        self.context = context

    def detail(self) -> dict[str, Any]:
        return {"code": self.code, "message": self.message, **self.context}


def _error(status_code: int, code: str, message: str, **context: Any) -> PracticeSessionError:
    return PracticeSessionError(status_code, code, message, **context)


def _domain_for_snapshot(snapshot: dict) -> str:
    metadata = snapshot.get("metadata") if isinstance(snapshot.get("metadata"), dict) else {}
    return paper_composition_service.facet_values(metadata).get(
        paper_composition_service.EXAM_DOMAIN, ""
    )


def _stable_random_key(seed: str, row: PaperReleaseQuestion) -> str:
    return hashlib.sha256(
        f"{seed}\0{row.release_id}\0{row.order_index}\0{row.question_id}".encode()
    ).hexdigest()


def _select_questions(
    rows: list[PaperReleaseQuestion],
    *,
    count: int,
    order: str,
    seed: str,
) -> tuple[list[dict], dict[str, int]]:
    targets = paper_composition_service.allocate_counts(DEFAULT_DOMAIN_WEIGHTS, count)
    buckets: dict[str, list[PaperReleaseQuestion]] = {
        domain: [] for domain in DEFAULT_DOMAIN_WEIGHTS
    }
    for row in rows:
        domain = _domain_for_snapshot(row.snapshot or {})
        if domain in buckets:
            buckets[domain].append(row)

    shortages = {
        domain: target - len(buckets[domain])
        for domain, target in targets.items()
        if len(buckets[domain]) < target
    }
    if shortages:
        raise _error(
            422,
            "PRACTICE_DOMAIN_SHORTAGE",
            "试卷领域题量不足，无法按当前配比开始练习",
            domainTargets=targets,
            shortages=shortages,
        )

    selected: list[tuple[PaperReleaseQuestion, str]] = []
    for domain, target in targets.items():
        candidates = buckets[domain]
        if order == "random":
            candidates = sorted(candidates, key=lambda row: _stable_random_key(seed, row))
        else:
            candidates = sorted(candidates, key=lambda row: row.order_index)
        selected.extend((row, domain) for row in candidates[:target])

    if order == "random":
        selected.sort(key=lambda item: _stable_random_key(seed, item[0]))
    else:
        selected.sort(key=lambda item: item[0].order_index)

    return (
        [
            {
                "questionId": row.question_id,
                "bankId": row.bank_id,
                "orderIndex": row.order_index,
                "domain": domain,
            }
            for row, domain in selected
        ],
        targets,
    )


async def _session_payload(db: AsyncSession, session: PracticeSession) -> dict:
    refs = session.question_order if isinstance(session.question_order, list) else []
    rows = (
        await db.execute(
            select(PaperReleaseQuestion)
            .where(PaperReleaseQuestion.release_id == session.release_id)
            .order_by(PaperReleaseQuestion.order_index)
        )
    ).scalars().all()
    row_map = {row.question_id: row for row in rows}
    questions = []
    for ref in refs:
        if not isinstance(ref, dict):
            continue
        row = row_map.get(str(ref.get("questionId") or ""))
        if row is None:
            continue
        questions.append({**ref, "question": row.snapshot or {}})
    scoring = session.scoring_snapshot if isinstance(session.scoring_snapshot, dict) else {}
    return {
        "id": session.id,
        "paperId": session.paper_id,
        "releaseId": session.release_id,
        "mode": session.mode,
        "status": session.status,
        "questionOrder": refs,
        "questions": questions,
        "answers": session.answers or {},
        "runtimeState": session.runtime_state or {},
        "stats": session.stats or {},
        "domainWeights": scoring.get("domainWeights", DEFAULT_DOMAIN_WEIGHTS),
        "domainTargets": scoring.get("domainTargets", {}),
        "scoringSnapshot": scoring,
        "reportSnapshot": session.report_snapshot,
        "revision": session.revision,
        "startedAt": session.started_at.isoformat() if session.started_at else None,
        "lastSavedAt": session.last_saved_at.isoformat() if session.last_saved_at else None,
        "pausedAt": session.paused_at.isoformat() if session.paused_at else None,
        "completedAt": session.completed_at.isoformat() if session.completed_at else None,
        "abandonedAt": session.abandoned_at.isoformat() if session.abandoned_at else None,
    }


async def start_session(
    db: AsyncSession,
    owner: str,
    user: User,
    data: dict,
) -> dict:
    paper_id = str(data.get("paperId") or "").strip()
    release_id = str(data.get("releaseId") or "").strip()
    mode = str(data.get("mode") or "").strip().lower()
    order = str(data.get("order") or "paper").strip().lower()
    try:
        count = int(data.get("count") or 0)
    except (TypeError, ValueError) as error:
        raise _error(422, "INVALID_PRACTICE_COUNT", "题目数量无效") from error
    if not paper_id or not release_id:
        raise _error(422, "PRACTICE_RELEASE_REQUIRED", "paperId 和 releaseId 不能为空")
    if mode not in PRACTICE_SESSION_MODES:
        raise _error(422, "INVALID_PRACTICE_MODE", "练习模式无效")
    if count not in PRACTICE_QUESTION_COUNTS:
        raise _error(422, "INVALID_PRACTICE_COUNT", "题目数量必须是 10、20、60 或 180")
    if order not in PRACTICE_ORDERS:
        raise _error(422, "INVALID_PRACTICE_ORDER", "答题顺序无效")

    release = await db.get(PaperRelease, release_id)
    if (
        release is None
        or release.paper_id != paper_id
        or release.status not in {"published", "superseded"}
        or "practice_mode" not in (release.enabled_modes or [])
        or (release.allowed_roles and user.role not in release.allowed_roles)
        or not await paper_release_service.can_access(db, user, release)
    ):
        raise _error(404, "PRACTICE_RELEASE_NOT_FOUND", "试卷不存在或当前不可练习")

    await db.execute(
        sql_text("SELECT pg_advisory_xact_lock(hashtext(:owner), hashtext(:scope))"),
        {"owner": owner, "scope": f"practice-session:{paper_id}:{release_id}:{mode}"},
    )
    existing = (
        await db.execute(
            select(PracticeSession).where(
                PracticeSession.owner_id == owner,
                PracticeSession.paper_id == paper_id,
                PracticeSession.release_id == release_id,
                PracticeSession.mode == mode,
                PracticeSession.status.in_(["active", "paused"]),
            )
        )
    ).scalar_one_or_none()
    if existing is not None:
        raise _error(
            409,
            "RESUMABLE_SESSION_EXISTS",
            "已有可继续的练习",
            sessionId=existing.id,
            status=existing.status,
        )

    rows = list(
        (
            await db.execute(
                select(PaperReleaseQuestion)
                .where(PaperReleaseQuestion.release_id == release_id)
                .order_by(PaperReleaseQuestion.order_index)
            )
        ).scalars().all()
    )
    selection_seed = secrets.token_hex(16)
    question_order, targets = _select_questions(
        rows, count=count, order=order, seed=selection_seed
    )
    session = PracticeSession(
        id=uid("ps_"),
        owner_id=owner,
        paper_id=paper_id,
        release_id=release_id,
        mode=mode,
        status="active",
        question_order=question_order,
        answers={},
        runtime_state={"currentIndex": 0, "order": order},
        stats={
            "total": count,
            "answered": 0,
            "correct": 0,
            "wrong": 0,
            "unanswered": count,
            "experience": 0,
            "durationMs": 0,
        },
        scoring_snapshot={
            **DEFAULT_SIMULATION_SCORING,
            "domainWeights": dict(DEFAULT_DOMAIN_WEIGHTS),
            "domainTargets": targets,
            "selectionSeed": selection_seed,
            "order": order,
        },
        revision=1,
    )
    db.add(session)
    await db.commit()
    await db.refresh(session)
    return await _session_payload(db, session)


async def get_session(
    db: AsyncSession, owner: str, session_id: str
) -> dict | None:
    session = (
        await db.execute(
            select(PracticeSession).where(
                PracticeSession.id == session_id,
                PracticeSession.owner_id == owner,
            )
        )
    ).scalar_one_or_none()
    return await _session_payload(db, session) if session is not None else None


async def list_active_sessions(
    db: AsyncSession,
    owner: str,
    *,
    release_id: str | None = None,
    mode: str | None = None,
) -> list[dict]:
    query = select(PracticeSession).where(
        PracticeSession.owner_id == owner,
        PracticeSession.status.in_(["active", "paused"]),
    )
    if release_id:
        query = query.where(PracticeSession.release_id == release_id)
    if mode:
        query = query.where(PracticeSession.mode == mode)
    sessions = (
        await db.execute(query.order_by(PracticeSession.last_saved_at.desc()))
    ).scalars().all()
    return [await _session_payload(db, session) for session in sessions]


def _required_revision(data: dict) -> int:
    raw = data.get("revision")
    if isinstance(raw, bool):
        raise _error(422, "INVALID_SESSION_REVISION", "revision 必须是正整数")
    try:
        revision = int(raw)
    except (TypeError, ValueError) as error:
        raise _error(422, "INVALID_SESSION_REVISION", "revision 必须是正整数") from error
    if revision < 1:
        raise _error(422, "INVALID_SESSION_REVISION", "revision 必须是正整数")
    return revision


async def _session_for_update(
    db: AsyncSession, owner: str, session_id: str
) -> PracticeSession:
    session = (
        await db.execute(
            select(PracticeSession)
            .where(
                PracticeSession.id == session_id,
                PracticeSession.owner_id == owner,
            )
            .with_for_update()
        )
    ).scalar_one_or_none()
    if session is None:
        raise _error(404, "PRACTICE_SESSION_NOT_FOUND", "练习会话不存在或无权访问")
    return session


async def answer_session_question(
    db: AsyncSession,
    owner: str,
    user: User,
    session_id: str,
    data: dict,
) -> dict:
    requested_revision = _required_revision(data)
    question_id = str(data.get("questionId") or "").strip()
    selected_answer = str(data.get("selectedAnswer") or "").strip()
    if not question_id or not selected_answer:
        raise _error(
            422,
            "PRACTICE_ANSWER_REQUIRED",
            "questionId 和 selectedAnswer 不能为空",
        )

    session = await _session_for_update(db, owner, session_id)
    if session.status != "active":
        raise _error(409, "PRACTICE_SESSION_NOT_ACTIVE", "当前会话不可继续作答")
    refs = session.question_order if isinstance(session.question_order, list) else []
    ref = next(
        (
            item
            for item in refs
            if isinstance(item, dict) and item.get("questionId") == question_id
        ),
        None,
    )
    if ref is None:
        raise _error(422, "QUESTION_NOT_IN_SESSION", "题目不属于当前练习会话")

    answers = dict(session.answers or {})
    existing = answers.get(question_id)
    if isinstance(existing, dict):
        if str(existing.get("selectedAnswer") or "") != selected_answer:
            raise _error(409, "PRACTICE_ANSWER_LOCKED", "已提交答案不能修改")
        return {
            "answer": existing,
            "session": await _session_payload(db, session),
            "idempotent": True,
        }
    if session.revision != requested_revision:
        raise _error(
            409,
            "PRACTICE_SESSION_REVISION_CONFLICT",
            "练习进度已在其他页面更新，请加载最新进度",
            currentRevision=session.revision,
        )

    try:
        grading = await learning_service.record_practice_answer(
            db,
            owner,
            {
                "questionId": question_id,
                "bankId": str(ref.get("bankId") or ""),
                "paperId": session.paper_id,
                "releaseId": session.release_id,
                "sourceMode": session.mode,
                "selectedAnswer": selected_answer,
            },
            current_user=user,
            commit=False,
        )
    except ValueError as error:
        raise _error(422, "PRACTICE_ANSWER_INVALID", str(error)) from error
    except LookupError as error:
        raise _error(404, "PRACTICE_QUESTION_NOT_FOUND", str(error)) from error

    row = (
        await db.execute(
            select(PaperReleaseQuestion).where(
                PaperReleaseQuestion.release_id == session.release_id,
                PaperReleaseQuestion.question_id == question_id,
            )
        )
    ).scalar_one()
    correct_answer = str((row.snapshot or {}).get("correctAnswer") or "")
    completion = grading.get("completion") if isinstance(grading.get("completion"), dict) else {}
    answer = {
        "questionId": question_id,
        "selectedAnswer": selected_answer,
        "correctAnswer": correct_answer,
        "correct": bool(grading.get("correct")),
        "submittedAt": completion.get("completedAt") or now_utc().isoformat(),
    }
    answers[question_id] = answer
    answered = len(answers)
    correct = sum(1 for item in answers.values() if item.get("correct") is True)
    previous_stats = session.stats if isinstance(session.stats, dict) else {}
    total = len(refs)
    session.answers = answers
    session.stats = {
        "total": total,
        "answered": answered,
        "correct": correct,
        "wrong": answered - correct,
        "unanswered": total - answered,
        "experience": max(0, int(previous_stats.get("experience") or 0)),
        "durationMs": max(0, int(previous_stats.get("durationMs") or 0)),
    }
    session.revision += 1
    await db.commit()
    await db.refresh(session)
    return {
        "answer": answer,
        "session": await _session_payload(db, session),
        "idempotent": False,
    }


def _validated_runtime_state(data: dict, *, question_count: int) -> dict:
    raw = data.get("runtimeState")
    if not isinstance(raw, dict):
        raise _error(422, "INVALID_RUNTIME_STATE", "runtimeState 必须是对象")
    unknown = sorted(set(raw) - RUNTIME_FIELDS)
    if unknown:
        raise _error(
            422,
            "INVALID_RUNTIME_STATE_FIELD",
            "runtimeState 包含不可写字段",
            fields=unknown,
        )
    state: dict[str, Any] = {}
    for field in RUNTIME_INTEGER_FIELDS:
        if field not in raw:
            continue
        value = raw[field]
        if isinstance(value, bool) or not isinstance(value, int) or value < 0:
            raise _error(
                422,
                "INVALID_RUNTIME_STATE_VALUE",
                f"{field} 必须是非负整数",
                field=field,
            )
        if field == "currentIndex" and value >= question_count:
            raise _error(
                422,
                "INVALID_RUNTIME_STATE_VALUE",
                "currentIndex 超出题目范围",
                field=field,
            )
        state[field] = value
    if "languageMode" in raw:
        if raw["languageMode"] not in {"zh", "en", "bilingual"}:
            raise _error(
                422,
                "INVALID_RUNTIME_STATE_VALUE",
                "languageMode 无效",
                field="languageMode",
            )
        state["languageMode"] = raw["languageMode"]
    if "autoExplain" in raw:
        if not isinstance(raw["autoExplain"], bool):
            raise _error(
                422,
                "INVALID_RUNTIME_STATE_VALUE",
                "autoExplain 必须是布尔值",
                field="autoExplain",
            )
        state["autoExplain"] = raw["autoExplain"]
    return state


async def update_runtime_state(
    db: AsyncSession,
    owner: str,
    session_id: str,
    data: dict,
) -> dict:
    requested_revision = _required_revision(data)
    session = await _session_for_update(db, owner, session_id)
    if session.status != "active":
        raise _error(409, "PRACTICE_SESSION_NOT_ACTIVE", "当前会话不可继续作答")
    if session.revision != requested_revision:
        raise _error(
            409,
            "PRACTICE_SESSION_REVISION_CONFLICT",
            "练习进度已在其他页面更新，请加载最新进度",
            currentRevision=session.revision,
        )
    refs = session.question_order if isinstance(session.question_order, list) else []
    patch = _validated_runtime_state(data, question_count=len(refs))
    runtime_state = dict(session.runtime_state or {})
    runtime_state.update(patch)
    stats = dict(session.stats or {})
    if "experience" in patch:
        stats["experience"] = patch["experience"]
    if "durationMs" in patch:
        stats["durationMs"] = patch["durationMs"]
    session.runtime_state = runtime_state
    session.stats = stats
    session.revision += 1
    session.last_saved_at = now_utc()
    await db.commit()
    await db.refresh(session)
    return await _session_payload(db, session)
