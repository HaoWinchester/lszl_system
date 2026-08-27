"""Resumable practice session lifecycle and frozen scoring facts."""

from __future__ import annotations

import hashlib
import secrets
from copy import deepcopy
from typing import Any

from sqlalchemy import or_, select, text as sql_text
from sqlalchemy.exc import IntegrityError
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.security import now_utc, uid
from app.models.paper_release import PaperRelease, PaperReleaseQuestion
from app.models.training import LearningEvent, PracticeMistake, PracticeSession
from app.models.user import User
from app.services import learning_service, paper_composition_service, paper_release_service
from app.services.practice_scoring_service import (
    DEFAULT_DOMAIN_WEIGHTS,
    DEFAULT_SIMULATION_SCORING,
)


PRACTICE_SESSION_MODES = {"challenge", "scholar", "revenge"}
PRACTICE_QUESTION_COUNT_MIN = 1
PRACTICE_QUESTION_COUNT_MAX = 180
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
RUNTIME_FIELDS = RUNTIME_INTEGER_FIELDS | {
    "languageMode",
    "autoExplain",
    "revengeState",
}


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


def _score_for_snapshot(snapshot: dict) -> float:
    raw = snapshot.get("releaseScore", 1)
    try:
        score = float(raw)
    except (TypeError, ValueError):
        return 1.0
    return score if score >= 0 else 1.0


def _release_scoring(release: PaperRelease) -> tuple[dict[str, int], dict]:
    metadata = release.release_metadata if isinstance(release.release_metadata, dict) else {}
    raw_weights = metadata.get("domainWeights")
    weights = (
        {domain: int(raw_weights.get(domain, 0)) for domain in DEFAULT_DOMAIN_WEIGHTS}
        if isinstance(raw_weights, dict)
        else dict(DEFAULT_DOMAIN_WEIGHTS)
    )
    if any(value <= 0 for value in weights.values()) or sum(weights.values()) != 100:
        weights = dict(DEFAULT_DOMAIN_WEIGHTS)
    raw_scoring = metadata.get("simulationScoring")
    scoring = deepcopy(raw_scoring) if isinstance(raw_scoring, dict) else deepcopy(DEFAULT_SIMULATION_SCORING)
    scoring["domainWeights"] = weights
    scoring["official"] = False
    return weights, scoring


def _select_questions(
    rows: list[PaperReleaseQuestion],
    *,
    count: int,
    order: str,
    seed: str,
    weights: dict[str, int],
) -> tuple[list[dict], dict[str, int], bool]:
    targets = paper_composition_service.allocate_counts(weights, count)
    buckets: dict[str, list[PaperReleaseQuestion]] = {
        domain: [] for domain in weights
    }
    for row in rows:
        domain = _domain_for_snapshot(row.snapshot or {})
        if domain in buckets:
            buckets[domain].append(row)

    domain_data_complete = all(
        _domain_for_snapshot(row.snapshot or {}) in buckets for row in rows
    )
    if not domain_data_complete:
        candidates = list(rows)
        if order == "random":
            candidates.sort(key=lambda row: _stable_random_key(seed, row))
        else:
            candidates.sort(key=lambda row: row.order_index)
        selected_rows = candidates[:count]
        if len(selected_rows) < count:
            raise _error(
                422,
                "PRACTICE_QUESTION_SHORTAGE",
                "试卷题量不足，无法开始本次练习",
                available=len(selected_rows),
                requested=count,
            )
        legacy_order = [
            {
                "questionId": row.question_id,
                "bankId": row.bank_id,
                "orderIndex": row.order_index,
                "domain": _domain_for_snapshot(row.snapshot or {}),
                "score": _score_for_snapshot(row.snapshot or {}),
            }
            for row in selected_rows
        ]
        legacy_targets = {
            domain: sum(1 for item in legacy_order if item.get("domain") == domain)
            for domain in weights
        }
        return legacy_order, legacy_targets, False

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
                "score": _score_for_snapshot(row.snapshot or {}),
            }
            for row, domain in selected
        ],
        targets,
        True,
    )


def _question_snapshot_for_session(
    snapshot: dict,
    *,
    reveal_answer: bool,
) -> dict:
    # 本产品不以隐藏答案为防作弊边界：会话载荷固定下发冻结 correctAnswer/analysis/reasoningSteps。
    _ = reveal_answer
    return deepcopy(snapshot)


def _public_answer(answer: dict) -> dict:
    return {key: deepcopy(value) for key, value in answer.items() if key != "submissionIndex"}


def _snapshot_option_ids(snapshot: dict) -> set[str]:
    options = snapshot.get("options") if isinstance(snapshot, dict) else None
    if not isinstance(options, list):
        return set()
    return {
        str(option.get("id"))
        for option in options
        if isinstance(option, dict) and option.get("id") is not None
    }


async def _release_question_rows(
    db: AsyncSession, release_id: str
) -> dict[str, PaperReleaseQuestion]:
    rows = (
        await db.execute(
            select(PaperReleaseQuestion).where(
                PaperReleaseQuestion.release_id == release_id
            )
        )
    ).scalars().all()
    return {row.question_id: row for row in rows}


async def _validated_draft_answers(
    db: AsyncSession, session: PracticeSession, data: dict
) -> dict[str, dict]:
    raw = data.get("answers")
    if not isinstance(raw, dict):
        raise _error(422, "INVALID_PRACTICE_DRAFT", "answers 必须是对象")
    refs = {
        str(item.get("questionId") or ""): item
        for item in session.question_order
        if isinstance(item, dict)
    }
    rows = await _release_question_rows(db, session.release_id)
    normalized = {}
    seen_indexes = set()
    for question_id, value in raw.items():
        if question_id not in refs or not isinstance(value, dict):
            raise _error(422, "PRACTICE_DRAFT_ANSWER_INVALID", "草稿包含非法题目")
        selected = str(value.get("selectedAnswer") or "").strip()
        selection_index = value.get("selectionIndex")
        if (
            not selected
            or isinstance(selection_index, bool)
            or not isinstance(selection_index, int)
            or selection_index < 1
            or selection_index > len(refs)
        ):
            raise _error(422, "PRACTICE_DRAFT_ANSWER_INVALID", "草稿答案或顺序无效")
        if selection_index in seen_indexes:
            raise _error(422, "PRACTICE_DRAFT_ANSWER_INVALID", "草稿选择顺序重复")
        seen_indexes.add(selection_index)
        # 选项合法性从 PaperReleaseQuestion.snapshot.options 校验（白名单），
        # 不接受 A/B/C/D 之外的任何注入值。
        row = rows.get(question_id)
        if row is None or selected not in _snapshot_option_ids(row.snapshot or {}):
            raise _error(
                422, "PRACTICE_DRAFT_ANSWER_INVALID", "草稿答案不在题目选项内"
            )
        if value.get("timedOut") is True and session.mode != "scholar":
            raise _error(
                422, "PRACTICE_TIMEOUT_MODE_INVALID", "只有学霸模式可以提交超时"
            )
        # 只保留白名单字段：correct/correctAnswer/score 等客户端注入一律剥离。
        normalized[question_id] = {
            "selectedAnswer": selected,
            "selectionIndex": selection_index,
            **({"timedOut": True} if value.get("timedOut") is True else {}),
        }
    return normalized


def _draft_stats(
    refs: list[dict],
    rows: dict[str, PaperReleaseQuestion],
    answers: dict[str, dict],
    previous: dict,
) -> dict:
    """从冻结快照临时重算未完成会话统计；不落任何长期错题/进度/完成事件。"""

    ref_items = [item for item in refs if isinstance(item, dict)]
    total = len(ref_items)
    answered = 0
    correct = 0
    scoring_answers: dict[str, dict] = {}
    for position, ref in enumerate(ref_items):
        question_id = str(ref.get("questionId") or "")
        answer = answers.get(question_id)
        if not isinstance(answer, dict):
            continue
        row = rows.get(question_id)
        snapshot = row.snapshot if row is not None and isinstance(row.snapshot, dict) else {}
        selected = str(answer.get("selectedAnswer") or "")
        is_correct = (
            bool(str(snapshot.get("correctAnswer") or ""))
            and selected == str(snapshot.get("correctAnswer") or "")
        )
        answered += 1
        if is_correct:
            correct += 1
        try:
            submission_index = int(
                answer.get("submissionIndex") or answer.get("selectionIndex") or position + 1
            )
        except (TypeError, ValueError):
            submission_index = position + 1
        scoring_answers[question_id] = {
            "questionId": question_id,
            "selectedAnswer": selected,
            "correct": is_correct,
            "submissionIndex": submission_index,
            "submittedAt": str(answer.get("submittedAt") or ""),
        }
    experience = _experience_for_answers(scoring_answers)
    return {
        "total": total,
        "answered": answered,
        "correct": correct,
        "wrong": answered - correct,
        "unanswered": total - answered,
        "experience": experience,
        "durationMs": max(0, int(previous.get("durationMs") or 0)),
    }


async def _revenge_question_order(
    db: AsyncSession,
    *,
    owner: str,
    release_id: str,
    count: int,
) -> list[dict]:
    now = now_utc()
    rows = list(
        (
            await db.execute(
                select(PracticeMistake).where(
                    PracticeMistake.owner_id == owner,
                    PracticeMistake.release_id == release_id,
                    or_(
                        PracticeMistake.status.in_(["pending", "needs_remediation"]),
                        (
                            (PracticeMistake.status == "verification_due")
                            & or_(
                                PracticeMistake.next_review_at.is_(None),
                                PracticeMistake.next_review_at <= now,
                            )
                        ),
                    ),
                )
            )
        ).scalars().all()
    )
    priority = {"needs_remediation": 0, "pending": 1, "verification_due": 2}
    rows.sort(
        key=lambda row: (
            priority.get(row.status, 9),
            -row.revenge_wrong_count,
            -row.wrong_count,
            row.id,
        )
    )
    selected = rows[:count]
    if not selected:
        raise _error(
            422,
            "NO_REVENGE_QUESTIONS",
            "当前试卷暂无可复仇错题",
        )
    return [
        {
            "questionId": str(row.question_id or ""),
            "bankId": str(row.bank_id or ""),
            "orderIndex": index,
            "domain": _domain_for_snapshot(row.question_snapshot or {}),
            "score": _score_for_snapshot(row.question_snapshot or {}),
            "mistakeId": row.id,
        }
        for index, row in enumerate(selected)
        if row.question_id
    ]


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
    answers = session.answers if isinstance(session.answers, dict) else {}
    for ref in refs:
        if not isinstance(ref, dict):
            continue
        row = row_map.get(str(ref.get("questionId") or ""))
        if row is None:
            continue
        questions.append(
            {
                **ref,
                "question": _question_snapshot_for_session(
                    row.snapshot or {},
                    reveal_answer=True,
                ),
            }
        )
    scoring = session.scoring_snapshot if isinstance(session.scoring_snapshot, dict) else {}
    return {
        "id": session.id,
        "paperId": session.paper_id,
        "releaseId": session.release_id,
        "mode": session.mode,
        "status": session.status,
        "questionOrder": refs,
        "questions": questions,
        "answers": {
            question_id: _public_answer(answer)
            for question_id, answer in answers.items()
            if isinstance(answer, dict)
        },
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
    if not PRACTICE_QUESTION_COUNT_MIN <= count <= PRACTICE_QUESTION_COUNT_MAX:
        raise _error(422, "INVALID_PRACTICE_COUNT", "题目数量必须在 1 到 180 之间")
    if order not in PRACTICE_ORDERS:
        raise _error(422, "INVALID_PRACTICE_ORDER", "答题顺序无效")

    release = await db.get(PaperRelease, release_id)
    if (
        release is None
        or release.paper_id != paper_id
        or release.status != "published"
        or "practice_mode" not in (release.enabled_modes or [])
        or (release.allowed_roles and user.role not in release.allowed_roles)
        or not await paper_release_service.can_access(db, user, release)
    ):
        raise _error(404, "PRACTICE_RELEASE_NOT_FOUND", "试卷不存在或当前不可练习")

    await db.execute(
        sql_text("SELECT pg_advisory_xact_lock(hashtext(:owner), hashtext(:scope))"),
        {"owner": owner, "scope": f"practice-session:{paper_id}:{mode}"},
    )
    existing = (
        await db.execute(
            select(PracticeSession).where(
                PracticeSession.owner_id == owner,
                PracticeSession.paper_id == paper_id,
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
    weights, scoring = _release_scoring(release)
    if mode == "revenge":
        question_order = await _revenge_question_order(
            db,
            owner=owner,
            release_id=release_id,
            count=count,
        )
        targets = {
            domain: sum(1 for item in question_order if item.get("domain") == domain)
            for domain in weights
        }
        domain_data_complete = all(
            str(item.get("domain") or "") in weights for item in question_order
        )
    else:
        question_order, targets, domain_data_complete = _select_questions(
            rows,
            count=count,
            order=order,
            seed=selection_seed,
            weights=weights,
        )
    actual_count = len(question_order)
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
            "total": actual_count,
            "answered": 0,
            "correct": 0,
            "wrong": 0,
            "unanswered": actual_count,
            "experience": 0,
            "durationMs": 0,
        },
        scoring_snapshot={
            **scoring,
            "domainWeights": weights,
            "domainTargets": targets,
            "domainDataComplete": domain_data_complete,
            "selectionSeed": selection_seed,
            "order": order,
        },
        revision=1,
    )
    db.add(session)
    try:
        await db.commit()
    except IntegrityError:
        await db.rollback()
        existing = (
            await db.execute(
                select(PracticeSession).where(
                    PracticeSession.owner_id == owner,
                    PracticeSession.paper_id == paper_id,
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
        raise
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
    timed_out = data.get("timedOut") is True
    selected_answer = str(data.get("selectedAnswer") or "").strip()
    if not question_id or (not selected_answer and not timed_out):
        raise _error(
            422,
            "PRACTICE_ANSWER_REQUIRED",
            "questionId 和 selectedAnswer 不能为空",
        )
    if timed_out:
        selected_answer = "__timeout__"

    session = await _session_for_update(db, owner, session_id)
    if session.status not in {"active", "paused"}:
        raise _error(409, "PRACTICE_SESSION_NOT_ACTIVE", "当前会话不可继续作答")
    if timed_out and session.mode != "scholar":
        raise _error(422, "PRACTICE_TIMEOUT_MODE_INVALID", "只有学霸模式可以提交超时")
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
    if isinstance(existing, dict) and existing.get("draft") is not True:
        if str(existing.get("selectedAnswer") or "") != selected_answer:
            raise _error(409, "PRACTICE_ANSWER_LOCKED", "已提交答案不能修改")
        return {
            "answer": _public_answer(existing),
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
    if session.status == "paused":
        session.status = "active"
        session.paused_at = None

    release_rows = await _release_question_rows(db, session.release_id)
    row = release_rows.get(question_id)
    if row is None:
        raise _error(404, "PRACTICE_QUESTION_NOT_FOUND", "题目不存在于当前发布")
    correct_answer = str((row.snapshot or {}).get("correctAnswer") or "")
    mistake_status = ""
    completion: dict = {}
    try:
        if session.mode == "revenge":
            mistake_id = str(ref.get("mistakeId") or "")
            mistake = await learning_service.record_revenge_answer(
                db,
                owner,
                mistake_id,
                {"selectedAnswer": selected_answer},
                commit=False,
            )
            if mistake is None:
                raise _error(404, "PRACTICE_MISTAKE_NOT_FOUND", "错题不存在或无权访问")
            correct = selected_answer == correct_answer
            mistake_status = mistake.status
        else:
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
                    "timedOut": timed_out,
                },
                current_user=user,
                commit=False,
            )
            correct = bool(grading.get("correct"))
            completion = (
                grading.get("completion")
                if isinstance(grading.get("completion"), dict)
                else {}
            )
    except PracticeSessionError:
        raise
    except ValueError as error:
        raise _error(422, "PRACTICE_ANSWER_INVALID", str(error)) from error
    except LookupError as error:
        raise _error(404, "PRACTICE_QUESTION_NOT_FOUND", str(error)) from error

    answer = {
        "questionId": question_id,
        "selectedAnswer": selected_answer,
        "correctAnswer": correct_answer,
        "correct": correct,
        "submittedAt": completion.get("completedAt") or now_utc().isoformat(),
        "submissionIndex": len(answers) + 1,
    }
    if timed_out:
        answer["timedOut"] = True
    if session.mode == "revenge":
        answer["mistakeId"] = str(ref.get("mistakeId") or "")
        answer["mistakeStatus"] = mistake_status
    answers[question_id] = answer
    session.answers = answers
    previous_stats = session.stats if isinstance(session.stats, dict) else {}
    session.stats = _draft_stats(refs, release_rows, answers, previous_stats)
    experience = session.stats["experience"]
    runtime_state = dict(session.runtime_state or {})
    runtime_state["experience"] = experience
    if session.mode == "revenge":
        runtime_state["revengeState"] = {
            "phase": (
                "remediation"
                if mistake_status == "needs_remediation"
                else "verification_due"
            ),
            "mistakeId": str(ref.get("mistakeId") or ""),
            "questionId": question_id,
        }
    session.runtime_state = runtime_state
    session.revision += 1
    await db.commit()
    await db.refresh(session)
    return {
        "answer": _public_answer(answer),
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
    if "revengeState" in raw:
        revenge_state = raw["revengeState"]
        if not isinstance(revenge_state, dict):
            raise _error(
                422,
                "INVALID_RUNTIME_STATE_VALUE",
                "revengeState 必须是对象",
                field="revengeState",
            )
        allowed = {"phase", "mistakeId", "questionId", "verificationQuestion"}
        unknown_revenge = sorted(set(revenge_state) - allowed)
        phase = str(revenge_state.get("phase") or "question")
        if unknown_revenge or phase not in {
            "question",
            "remediation",
            "verification",
            "verification_due",
        }:
            raise _error(
                422,
                "INVALID_RUNTIME_STATE_VALUE",
                "revengeState 内容无效",
                field="revengeState",
            )
        normalized_revenge = {
            "phase": phase,
            "mistakeId": str(revenge_state.get("mistakeId") or "")[:64],
            "questionId": str(revenge_state.get("questionId") or "")[:64],
        }
        verification_question = revenge_state.get("verificationQuestion")
        if isinstance(verification_question, dict):
            normalized_revenge["verificationQuestion"] = learning_service.redact_practice_question(
                verification_question
            )
        state["revengeState"] = normalized_revenge
    return state


def _streak_bonus(streak: int) -> int:
    if streak >= 8:
        return 10
    if streak >= 5:
        return 5
    if streak >= 3:
        return 2
    return 0


def _experience_for_answers(answers: dict) -> int:
    ordered = sorted(
        (item for item in answers.values() if isinstance(item, dict)),
        key=lambda item: (
            int(item.get("submissionIndex") or 0),
            str(item.get("submittedAt") or ""),
            str(item.get("questionId") or ""),
        ),
    )
    experience = 0
    streak = 0
    for answer in ordered:
        if answer.get("correct") is True:
            streak += 1
            experience += 10 + _streak_bonus(streak)
        else:
            streak = 0
    return experience


async def update_runtime_state(
    db: AsyncSession,
    owner: str,
    session_id: str,
    data: dict,
) -> dict:
    requested_revision = _required_revision(data)
    session = await _session_for_update(db, owner, session_id)
    if session.status not in {"active", "paused"}:
        raise _error(409, "PRACTICE_SESSION_NOT_ACTIVE", "当前会话不可继续作答")
    if session.revision != requested_revision:
        raise _error(
            409,
            "PRACTICE_SESSION_REVISION_CONFLICT",
            "练习进度已在其他页面更新，请加载最新进度",
            currentRevision=session.revision,
        )
    _apply_runtime_patch(session, data)
    if session.status == "paused":
        session.status = "active"
        session.paused_at = None
    session.revision += 1
    session.last_saved_at = now_utc()
    await db.commit()
    await db.refresh(session)
    return await _session_payload(db, session)


def _require_revenge_mistake(session: PracticeSession, mistake_id: str) -> dict:
    if session.mode != "revenge":
        raise _error(409, "PRACTICE_SESSION_MODE_MISMATCH", "当前会话不是复仇模式")
    refs = session.question_order if isinstance(session.question_order, list) else []
    ref = next(
        (
            item
            for item in refs
            if isinstance(item, dict)
            and str(item.get("mistakeId") or "") == mistake_id
        ),
        None,
    )
    if ref is None:
        raise _error(422, "MISTAKE_NOT_IN_SESSION", "错题不属于当前复仇会话")
    return ref


async def review_revenge_remediation(
    db: AsyncSession,
    owner: str,
    session_id: str,
    mistake_id: str,
    data: dict,
) -> tuple[dict, Any, dict]:
    requested_revision = _required_revision(data)
    session = await _session_for_update(db, owner, session_id)
    if session.status not in {"active", "paused"}:
        raise _error(409, "PRACTICE_SESSION_NOT_ACTIVE", "当前会话不可继续作答")
    ref = _require_revenge_mistake(session, mistake_id)
    if session.revision != requested_revision:
        raise _revision_conflict(session)
    mistake = await learning_service.mark_remediation_reviewed(
        db, owner, mistake_id, commit=False
    )
    if mistake is None:
        raise _error(404, "PRACTICE_MISTAKE_NOT_FOUND", "错题不存在或无权访问")
    candidate = await learning_service.practice_verification_candidate(
        db, owner, mistake_id
    )
    revenge_state = {
        "phase": "verification" if candidate.get("available") else "remediation",
        "mistakeId": mistake_id,
        "questionId": str(ref.get("questionId") or ""),
    }
    if candidate.get("available") and isinstance(candidate.get("question"), dict):
        revenge_state["verificationQuestion"] = candidate["question"]
    runtime_state = dict(session.runtime_state or {})
    runtime_state["revengeState"] = revenge_state
    session.runtime_state = runtime_state
    session.status = "active"
    session.paused_at = None
    session.revision += 1
    session.last_saved_at = now_utc()
    await db.commit()
    await db.refresh(session)
    await db.refresh(mistake)
    return await _session_payload(db, session), mistake, candidate


async def verify_revenge_session(
    db: AsyncSession,
    owner: str,
    session_id: str,
    mistake_id: str,
    data: dict,
) -> tuple[dict, Any, Any, dict]:
    requested_revision = _required_revision(data)
    session = await _session_for_update(db, owner, session_id)
    if session.status not in {"active", "paused"}:
        raise _error(409, "PRACTICE_SESSION_NOT_ACTIVE", "当前会话不可继续作答")
    ref = _require_revenge_mistake(session, mistake_id)
    if session.revision != requested_revision:
        raise _revision_conflict(session)
    result = await learning_service.record_practice_verification(
        db, owner, mistake_id, data, commit=False
    )
    if result is None:
        raise _error(404, "PRACTICE_MISTAKE_NOT_FOUND", "错题不存在或无权访问")
    mistake, verification, answer = result
    runtime_state = dict(session.runtime_state or {})
    runtime_state["revengeState"] = {
        "phase": "verification_due" if verification.correct else "remediation",
        "mistakeId": mistake_id,
        "questionId": str(ref.get("questionId") or ""),
    }
    session.runtime_state = runtime_state
    session.status = "active"
    session.paused_at = None
    session.revision += 1
    session.last_saved_at = now_utc()
    await db.commit()
    await db.refresh(session)
    await db.refresh(mistake)
    await db.refresh(verification)
    return await _session_payload(db, session), mistake, verification, answer


def _apply_runtime_patch(session: PracticeSession, data: dict) -> None:
    if "runtimeState" not in data:
        return
    refs = session.question_order if isinstance(session.question_order, list) else []
    patch = _validated_runtime_state(data, question_count=len(refs))
    runtime_state = dict(session.runtime_state or {})
    runtime_state.update(patch)
    stats = dict(session.stats or {})
    trusted_experience = max(0, int(stats.get("experience") or 0))
    runtime_state["experience"] = trusted_experience
    stats["experience"] = trusted_experience
    if "durationMs" in patch:
        stats["durationMs"] = patch["durationMs"]
    session.runtime_state = runtime_state
    session.stats = stats


def _revision_conflict(session: PracticeSession) -> PracticeSessionError:
    return _error(
        409,
        "PRACTICE_SESSION_REVISION_CONFLICT",
        "练习进度已在其他页面更新，请加载最新进度",
        currentRevision=session.revision,
    )


async def pause_session(
    db: AsyncSession, owner: str, session_id: str, data: dict
) -> dict:
    requested_revision = _required_revision(data)
    session = await _session_for_update(db, owner, session_id)
    if session.status == "paused":
        if requested_revision in {session.revision, session.revision - 1}:
            return await _session_payload(db, session)
        raise _revision_conflict(session)
    if session.status != "active":
        raise _error(409, "PRACTICE_SESSION_TERMINAL", "练习已结束，不能暂停")
    if session.revision != requested_revision:
        raise _revision_conflict(session)
    # 草稿先整体校验（白名单/选项/顺序），任何非法值都不落库。
    drafts = (
        await _validated_draft_answers(db, session, data)
        if "answers" in data
        else None
    )
    _apply_runtime_patch(session, data)
    if drafts is not None:
        refs = session.question_order if isinstance(session.question_order, list) else []
        answers = dict(session.answers or {})
        for question_id, draft in drafts.items():
            existing = answers.get(question_id)
            if isinstance(existing, dict) and existing.get("draft") is not True:
                # 已显式提交的答案不可被草稿覆盖。
                continue
            answers[question_id] = {"questionId": question_id, **draft, "draft": True}
        session.answers = answers
        rows = await _release_question_rows(db, session.release_id)
        session.stats = _draft_stats(refs, rows, answers, dict(session.stats or {}))
        runtime_state = dict(session.runtime_state or {})
        runtime_state["experience"] = session.stats["experience"]
        session.runtime_state = runtime_state
    saved_at = now_utc()
    session.status = "paused"
    session.paused_at = saved_at
    session.last_saved_at = saved_at
    session.revision += 1
    await db.commit()
    await db.refresh(session)
    return await _session_payload(db, session)


async def abandon_session(
    db: AsyncSession, owner: str, session_id: str, data: dict
) -> dict:
    requested_revision = _required_revision(data)
    session = await _session_for_update(db, owner, session_id)
    if session.status == "abandoned":
        if requested_revision in {session.revision, session.revision - 1}:
            return await _session_payload(db, session)
        raise _revision_conflict(session)
    if session.status == "completed":
        raise _error(409, "PRACTICE_SESSION_TERMINAL", "已交卷的练习不能放弃")
    if session.revision != requested_revision:
        raise _revision_conflict(session)
    _apply_runtime_patch(session, data)
    saved_at = now_utc()
    session.status = "abandoned"
    session.abandoned_at = saved_at
    session.last_saved_at = saved_at
    session.revision += 1
    await db.commit()
    await db.refresh(session)
    return await _session_payload(db, session)


def performance_band(percent: float, scoring: dict) -> str:
    bands = scoring.get("bands") if isinstance(scoring.get("bands"), dict) else {}
    if percent < float(bands.get("needsImprovement", 50)):
        return "needsImprovement"
    if percent < float(bands.get("belowTarget", 60)):
        return "belowTarget"
    if percent < float(bands.get("target", 80)):
        return "target"
    return "aboveTarget"


async def _build_report(db: AsyncSession, session: PracticeSession) -> dict:
    refs = session.question_order if isinstance(session.question_order, list) else []
    answers = session.answers if isinstance(session.answers, dict) else {}
    scoring = (
        session.scoring_snapshot
        if isinstance(session.scoring_snapshot, dict)
        else dict(DEFAULT_SIMULATION_SCORING)
    )
    weights = scoring.get("domainWeights")
    if not isinstance(weights, dict):
        weights = dict(DEFAULT_DOMAIN_WEIGHTS)
    domain_counts = {
        domain: {"total": 0, "answered": 0, "correct": 0, "wrong": 0}
        for domain in weights
    }
    wrong_question_ids: list[str] = []
    correct_count = 0
    answered_count = 0
    raw_score = 0.0
    max_score = 0.0
    domain_data_complete = scoring.get("domainDataComplete") is not False
    for ref in refs:
        if not isinstance(ref, dict):
            continue
        question_id = str(ref.get("questionId") or "")
        domain = str(ref.get("domain") or "")
        try:
            raw_question_score = ref.get("score")
            question_score = float(
                raw_question_score if raw_question_score is not None else 1
            )
        except (TypeError, ValueError):
            question_score = 1.0
        question_score = question_score if question_score >= 0 else 1.0
        max_score += question_score
        answer = answers.get(question_id)
        answered = isinstance(answer, dict)
        answer_correct = answered and answer.get("correct") is True
        if answered:
            answered_count += 1
        if answer_correct:
            correct_count += 1
            raw_score += question_score
        elif answered:
            wrong_question_ids.append(question_id)

        if domain not in domain_counts:
            domain_data_complete = False
            continue
        domain_counts[domain]["total"] += 1
        domain_counts[domain]["maxScore"] = (
            float(domain_counts[domain].get("maxScore") or 0) + question_score
        )
        if not answered:
            continue
        domain_counts[domain]["answered"] += 1
        if answer_correct:
            domain_counts[domain]["correct"] += 1
            domain_counts[domain]["rawScore"] = (
                float(domain_counts[domain].get("rawScore") or 0) + question_score
            )
        else:
            domain_counts[domain]["wrong"] += 1
    total = len(refs)
    score_percent = round((raw_score / max_score * 100) if max_score else 0, 2)
    pass_percent = float(scoring.get("passPercent", 60))
    passed = score_percent >= pass_percent
    domains = {}
    for domain, counts in domain_counts.items():
        domain_total = counts["total"]
        domain_max_score = float(counts.get("maxScore") or 0)
        domain_raw_score = float(counts.get("rawScore") or 0)
        domain_percent = round(
            (domain_raw_score / domain_max_score * 100) if domain_max_score else 0,
            2,
        )
        domains[domain] = {
            "weight": int(weights.get(domain, 0)),
            **counts,
            "unanswered": domain_total - counts["answered"],
            "rawScore": round(domain_raw_score, 2),
            "maxScore": round(domain_max_score, 2),
            "scorePercent": domain_percent,
            "performanceBand": performance_band(domain_percent, scoring),
        }
    stats = session.stats if isinstance(session.stats, dict) else {}
    release = await db.get(PaperRelease, session.release_id)
    paper_name = release.name if release is not None else "PMP 模拟练习"
    return {
        "sessionId": session.id,
        "paperId": session.paper_id,
        "releaseId": session.release_id,
        "mode": session.mode,
        "resultLabel": f"模拟考试结果：{'PASS' if passed else 'FAIL'}",
        "passed": passed,
        "scorePercent": score_percent,
        "accuracyPercent": round((correct_count / total * 100) if total else 0, 2),
        "rawScore": round(raw_score, 2),
        "maxScore": round(max_score, 2),
        "passPercent": pass_percent,
        "bands": deepcopy(scoring.get("bands") or DEFAULT_SIMULATION_SCORING["bands"]),
        "overallBand": performance_band(score_percent, scoring),
        "counts": {
            "total": total,
            "answered": answered_count,
            "correct": correct_count,
            "wrong": answered_count - correct_count,
            "unanswered": total - answered_count,
        },
        "domainWeights": {domain: int(value) for domain, value in weights.items()},
        "domainDataComplete": domain_data_complete,
        "domains": domains,
        "wrongQuestionIds": wrong_question_ids,
        "durationMs": max(0, int(stats.get("durationMs") or 0)),
        "learner": session.owner_id,
        "paperName": paper_name,
        "examDate": now_utc().date().isoformat(),
        "reportNumber": session.id,
        "recommendations": [
            "优先复盘本次错题及对应知识点",
            "根据领域表现安排下一轮针对性练习",
        ],
        "pageNumber": "1 / 1",
        "official": False,
        "disclaimer": "幻谱模拟判定，不代表 PMI 官方考试成绩",
    }


async def complete_session(
    db: AsyncSession, owner: str, session_id: str, data: dict
) -> tuple[dict, dict]:
    requested_revision = _required_revision(data)
    session = await _session_for_update(db, owner, session_id)
    if session.status == "completed" and isinstance(session.report_snapshot, dict):
        return await _session_payload(db, session), session.report_snapshot
    if session.status == "abandoned":
        raise _error(409, "PRACTICE_SESSION_TERMINAL", "已放弃的练习不能交卷")
    if session.revision != requested_revision:
        raise _revision_conflict(session)
    _apply_runtime_patch(session, data)
    report = await _build_report(db, session)
    completed_at = now_utc()
    report["completedAt"] = completed_at.isoformat()
    session.report_snapshot = report
    session.status = "completed"
    session.completed_at = completed_at
    session.last_saved_at = completed_at
    session.revision += 1
    counts = report["counts"]
    db.add(
        LearningEvent(
            id=uid("le_"),
            owner_id=owner,
            event_type=learning_service.PRACTICE_SESSION_EVENT_TYPE,
            payload={
                "sessionId": session.id,
                "mode": session.mode,
                "paperId": session.paper_id,
                "paperName": "PMP 模拟练习",
                "answered": counts["answered"],
                "correct": counts["correct"],
                "experience": max(
                    0, int((session.stats or {}).get("experience") or 0)
                ),
                "durationMs": report["durationMs"],
                "status": "completed",
            },
        )
    )
    await db.commit()
    await db.refresh(session)
    return await _session_payload(db, session), report


async def get_report(
    db: AsyncSession, owner: str, session_id: str
) -> dict | None:
    session = (
        await db.execute(
            select(PracticeSession).where(
                PracticeSession.id == session_id,
                PracticeSession.owner_id == owner,
                PracticeSession.status == "completed",
            )
        )
    ).scalar_one_or_none()
    if session is None or not isinstance(session.report_snapshot, dict):
        return None
    return session.report_snapshot
