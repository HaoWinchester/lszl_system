"""Resumable practice session lifecycle and frozen scoring facts."""

from __future__ import annotations

import hashlib
import secrets
from copy import deepcopy
from dataclasses import dataclass
from typing import Any

from sqlalchemy import select, text as sql_text
from sqlalchemy.exc import IntegrityError
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.security import now_utc, uid
from app.models.paper_release import PaperRelease, PaperReleaseQuestion
from app.models.training import LearningEvent, PracticeSession
from app.models.user import User
from app.services import learning_service, practice_experience_service, paper_composition_service, paper_release_service, question_answer_service
from app.services.practice_scoring_service import (
    DEFAULT_DOMAIN_WEIGHTS,
    DEFAULT_SIMULATION_SCORING,
)


PRACTICE_SESSION_MODES = {"challenge", "scholar", "revenge", "practice"}
PRACTICE_QUESTION_COUNT_MIN = 1
PRACTICE_QUESTION_COUNT_MAX = 180
PRACTICE_ORDERS = {"paper", "random"}
# 与前端 KGPracticeDraftState.submission() / 后端 _judge 同构的超时占位符：
# timedOut:true 条目的 selectedAnswer 统一为该值，判 false。
TIMEOUT_ANSWER_PLACEHOLDER = "__timeout__"
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


@dataclass(frozen=True)
class SessionQuestion:
    question_id: str
    bank_id: str
    snapshot: dict
    order_index: int
    release_id: str


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
    # 已发布试卷直接使用冻结题目；领域配比由新组卷/发布预检负责，
    # 不能在学习入口重新组卷而拦住题量充足的历史试卷。
    if len(rows) < count:
        raise _error(
            422,
            "PRACTICE_QUESTION_SHORTAGE",
            "试卷题量不足，无法开始本次练习",
            available=len(rows),
            requested=count,
        )
    if order == "random":
        candidates = sorted(rows, key=lambda row: _stable_random_key(seed, row))
    else:
        candidates = sorted(rows, key=lambda row: row.order_index)
    selected = [
        {
            "questionId": row.question_id,
            "bankId": row.bank_id,
            "orderIndex": row.order_index,
            "domain": _domain_for_snapshot(row.snapshot or {}),
            "score": _score_for_snapshot(row.snapshot or {}),
        }
        for row in candidates[:count]
    ]
    targets = {
        domain: sum(1 for ref in selected if ref["domain"] == domain)
        for domain in weights
    }
    return selected, targets, all(ref["domain"] in weights for ref in selected)


def _question_snapshot_for_session(
    snapshot: dict,
    *,
    reveal_explanation: bool,
) -> dict:
    payload = deepcopy(snapshot)
    if not reveal_explanation:
        for key in ("analysis", "explanation", "reasoningSteps"):
            payload.pop(key, None)
    return payload


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
    db: AsyncSession,
    release_id: str,
    *,
    question_ids: list[str] | None = None,
) -> dict[str, PaperReleaseQuestion]:
    query = select(PaperReleaseQuestion).where(
        PaperReleaseQuestion.release_id == release_id
    )
    if question_ids is not None:
        if not question_ids:
            return {}
        query = query.where(PaperReleaseQuestion.question_id.in_(question_ids))
    rows = (
        await db.execute(query)
    ).scalars().all()
    return {row.question_id: row for row in rows}


async def _release_question_headers(
    db: AsyncSession,
    release_id: str,
) -> list[Any]:
    return list(
        (
            await db.execute(
                select(
                    PaperReleaseQuestion.release_id,
                    PaperReleaseQuestion.order_index,
                    PaperReleaseQuestion.bank_id,
                    PaperReleaseQuestion.question_id,
                ).where(PaperReleaseQuestion.release_id == release_id)
            )
        ).all()
    )


async def _session_question_rows(
    db: AsyncSession, session: PracticeSession
) -> dict[str, SessionQuestion]:
    refs = session.question_order if isinstance(session.question_order, list) else []
    embedded = {}
    for ref in refs:
        if not isinstance(ref, dict) or not isinstance(ref.get("questionSnapshot"), dict):
            continue
        question_id = str(ref.get("questionId") or "")
        if not question_id:
            continue
        embedded[question_id] = SessionQuestion(
            question_id=question_id,
            bank_id=str(ref.get("bankId") or ""),
            snapshot=deepcopy(ref["questionSnapshot"]),
            order_index=int(ref.get("orderIndex") or 0),
            release_id=str(ref.get("sourceReleaseId") or ""),
        )
    if embedded:
        return embedded
    if not session.release_id:
        return {}
    question_ids = [
        str(ref.get("questionId") or "")
        for ref in refs
        if isinstance(ref, dict) and str(ref.get("questionId") or "")
    ]
    release_rows = await _release_question_rows(
        db,
        session.release_id,
        question_ids=question_ids,
    )
    return {
        question_id: SessionQuestion(
            question_id=row.question_id,
            bank_id=row.bank_id,
            snapshot=deepcopy(row.snapshot or {}),
            order_index=row.order_index,
            release_id=row.release_id,
        )
        for question_id, row in release_rows.items()
    }


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
    rows = await _session_question_rows(db, session)
    normalized = {}
    seen_indexes = set()
    for question_id, value in raw.items():
        if question_id not in refs or not isinstance(value, dict):
            raise _error(422, "PRACTICE_DRAFT_ANSWER_INVALID", "草稿包含非法题目")
        row = rows.get(question_id)
        snapshot = row.snapshot if row is not None and isinstance(row.snapshot, dict) else {}
        multiple = str(snapshot.get("type") or "") == "multiple_choice"
        selected = str(value.get("selectedAnswer") or "").strip()
        selected_ids = question_answer_service.normalize_option_ids(
            value.get("selectedAnswerIds"), [
                str(option.get("id") or "").strip()
                for option in snapshot.get("options") or []
                if isinstance(option, dict) and str(option.get("id") or "").strip()
            ]
        ) if multiple else []
        selection_index = value.get("selectionIndex")
        if (
            (not selected_ids if multiple else not selected)
            or isinstance(selection_index, bool)
            or not isinstance(selection_index, int)
            or selection_index < 1
            or selection_index > len(refs)
        ):
            raise _error(422, "PRACTICE_DRAFT_ANSWER_INVALID", "草稿答案或顺序无效")
        if selection_index in seen_indexes:
            raise _error(422, "PRACTICE_DRAFT_ANSWER_INVALID", "草稿选择顺序重复")
        seen_indexes.add(selection_index)
        # 选项合法性从会话冻结的题目快照校验（白名单），
        # 不接受 A/B/C/D 之外的任何注入值。唯一例外与 _judge 同构：
        # timedOut:true 条目的 selectedAnswer 允许超时占位符
        # （前端 submission() 统一发 '__timeout__'）或真实选项值；
        # 裸 '__timeout__' 不带 timedOut:true 仍被拒绝，防伪造超时。
        timed_out = value.get("timedOut") is True
        allowed_values = {TIMEOUT_ANSWER_PLACEHOLDER} if timed_out else set()
        option_ids = (
            _snapshot_option_ids(row.snapshot or {}) if row is not None else set()
        )
        invalid_selection = (
            (not selected_ids if not timed_out else selected not in allowed_values)
            if multiple
            else selected not in (allowed_values | option_ids)
        )
        if invalid_selection or (
            timed_out and session.mode != "scholar"
        ):
            if timed_out:
                raise _error(
                    422, "PRACTICE_TIMEOUT_MODE_INVALID", "只有学霸模式可以提交超时"
                )
            raise _error(
                422, "PRACTICE_DRAFT_ANSWER_INVALID", "草稿答案不在题目选项内"
            )
        # 只保留白名单字段：correct/correctAnswer/score 等客户端注入一律剥离。
        # timedOut 条目存储归一化为超时占位符（镜像前端 gradeLocal 与后端 _judge），
        # 使旧格式（真实值+timedOut）与新载荷（占位符+timedOut）落库形状一致，
        # 幂等深比较与锁定比较不再出现口径分裂。
        normalized[question_id] = {
            **({"selectedAnswerIds": selected_ids} if multiple and not timed_out else {"selectedAnswer": (
                TIMEOUT_ANSWER_PLACEHOLDER
                if timed_out
                else selected
            )}),
            "selectionIndex": selection_index,
            **({"timedOut": True} if timed_out else {}),
        }
    return normalized


def _draft_stats(
    refs: list[dict],
    rows: dict[str, SessionQuestion],
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
        multiple = str(snapshot.get("type") or "") == "multiple_choice"
        selected_ids = answer.get("selectedAnswerIds") if multiple else []
        grading = question_answer_service.grade_selection(
            snapshot,
            selected_ids if multiple else [selected],
            timed_out=answer.get("timedOut") is True,
        )
        is_correct = bool(grading["correct"])
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
            **({"selectedAnswerIds": grading["selectedOptionIds"]} if multiple else {"selectedAnswer": selected}),
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
        **{key: previous[key] for key in ("creditedExperience", "experienceAccountingVersion", "historyHidden") if key in previous},
    }


async def _session_payload(db: AsyncSession, session: PracticeSession) -> dict:
    refs = session.question_order if isinstance(session.question_order, list) else []
    row_map = await _session_question_rows(db, session)
    reveal_explanation = session.status == "completed" or session.mode not in {
        "challenge",
        "scholar",
    }
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
                    reveal_explanation=reveal_explanation,
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


def _progress_summary(row: Any, *, include_release: bool) -> dict:
    stats = row.stats if isinstance(row.stats, dict) else {}
    runtime = row.runtime_state if isinstance(row.runtime_state, dict) else {}
    summary = {
        "sessionId": row.id,
        "status": row.status,
        "answered": max(0, int(stats.get("answered") or 0)),
        "total": max(0, int(stats.get("total") or 0)),
        "currentIndex": max(0, int(runtime.get("currentIndex") or 0)),
        "revision": row.revision,
    }
    if include_release:
        summary["releaseId"] = row.release_id
        summary["lastSavedAt"] = (
            row.last_saved_at.isoformat() if row.last_saved_at else None
        )
    return summary


async def paper_progress(
    db: AsyncSession,
    owner: str,
    paper_id: str,
    *,
    release_id: str | None = None,
) -> dict:
    # releaseId 只描述当前目录版本；旧 release 的未完成会话仍须显示并恢复。
    _ = release_id
    rows = (
        await db.execute(
            select(
                PracticeSession.id,
                PracticeSession.release_id,
                PracticeSession.mode,
                PracticeSession.status,
                PracticeSession.stats,
                PracticeSession.runtime_state,
                PracticeSession.revision,
                PracticeSession.last_saved_at,
            )
            .where(
                PracticeSession.owner_id == owner,
                PracticeSession.paper_id == paper_id,
                PracticeSession.mode.in_(["challenge", "scholar"]),
                PracticeSession.status.in_(["active", "paused"]),
            )
            .order_by(PracticeSession.last_saved_at.desc(), PracticeSession.id)
        )
    ).all()
    latest: dict[str, dict | None] = {"challenge": None, "scholar": None}
    for row in rows:
        if latest[row.mode] is None:
            latest[row.mode] = _progress_summary(row, include_release=True)
    return {"paperId": paper_id, "modes": latest}


async def revenge_summary(db: AsyncSession, owner: str) -> dict:
    revenge_pool = await learning_service.global_revenge_pool(db, owner)
    pool_stats = revenge_pool["stats"]
    row = (
        await db.execute(
            select(
                PracticeSession.id,
                PracticeSession.status,
                PracticeSession.stats,
                PracticeSession.runtime_state,
                PracticeSession.revision,
            )
            .where(
                PracticeSession.owner_id == owner,
                PracticeSession.mode == "revenge",
                PracticeSession.status.in_(["active", "paused"]),
            )
            .order_by(PracticeSession.last_saved_at.desc(), PracticeSession.id)
            .limit(1)
        )
    ).one_or_none()
    return {
        "stats": {
            "active": int(pool_stats.get("active") or 0),
            "pending": int(pool_stats.get("pending") or 0),
            "needsRemediation": int(pool_stats.get("needsRemediation") or 0),
            "verificationDue": int(pool_stats.get("verificationDue") or 0),
            "mastered": int(pool_stats.get("mastered") or 0),
            "unavailable": int(revenge_pool.get("unavailableCount") or 0),
        },
        "resumable": _progress_summary(row, include_release=False) if row else None,
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
    if mode not in PRACTICE_SESSION_MODES:
        raise _error(422, "INVALID_PRACTICE_MODE", "练习模式无效")
    if not PRACTICE_QUESTION_COUNT_MIN <= count <= PRACTICE_QUESTION_COUNT_MAX:
        raise _error(422, "INVALID_PRACTICE_COUNT", "题目数量必须在 1 到 180 之间")
    if order not in PRACTICE_ORDERS:
        raise _error(422, "INVALID_PRACTICE_ORDER", "答题顺序无效")

    release = None
    if mode != "revenge":
        if not paper_id or not release_id:
            raise _error(422, "PRACTICE_RELEASE_REQUIRED", "paperId 和 releaseId 不能为空")
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
        {
            "owner": owner,
            "scope": (
                "practice-session:global:revenge"
                if mode == "revenge"
                else f"practice-session:{paper_id}:{mode}"
            ),
        },
    )
    existing_query = select(PracticeSession).where(
        PracticeSession.owner_id == owner,
        PracticeSession.mode == mode,
        PracticeSession.status.in_(["active", "paused"]),
    )
    if mode != "revenge":
        existing_query = existing_query.where(PracticeSession.paper_id == paper_id)
    existing = (
        await db.execute(
            existing_query.order_by(
                PracticeSession.last_saved_at.desc(), PracticeSession.id
            ).limit(1)
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

    selection_seed = secrets.token_hex(16)
    if mode == "revenge":
        revenge_pool = await learning_service.global_revenge_pool(db, owner)
        candidates = revenge_pool["candidates"]
        question_order = []
        for index, candidate in enumerate(candidates[:count]):
            snapshot = deepcopy(candidate.get("questionSnapshot") or {})
            question_order.append(
                {
                    "questionId": str(candidate.get("questionId") or ""),
                    "bankId": str(candidate.get("bankId") or ""),
                    "orderIndex": index,
                    "domain": _domain_for_snapshot(snapshot),
                    "score": _score_for_snapshot(snapshot),
                    "mistakeId": str(candidate.get("mistakeId") or ""),
                    "mistakeIds": list(candidate.get("mistakeIds") or []),
                    "previousWrongAnswer": str(
                        candidate.get("previousWrongAnswer") or ""
                    ),
                    "previousWrongAnswerIds": list(candidate.get("previousWrongAnswerIds") or []),
                    "sourcePaperId": str(candidate.get("paperId") or ""),
                    "sourcePaperName": str(candidate.get("paperName") or ""),
                    "sourceReleaseId": str(candidate.get("releaseId") or ""),
                    "sourcePaperVersion": int(candidate.get("paperVersion") or 0),
                    "questionSnapshot": snapshot,
                }
            )
        if not question_order:
            unavailable_count = int(revenge_pool.get("unavailableCount") or 0)
            if unavailable_count:
                raise _error(
                    422,
                    "REVENGE_SNAPSHOT_UNAVAILABLE",
                    "历史错题内容暂不可用，请先使用其他练习模式",
                    unavailableCount=unavailable_count,
                )
            raise _error(
                422,
                "NO_REVENGE_QUESTIONS",
                "当前没有可用的全局复仇错题",
            )
        paper_id = ""
        release_id = ""
        weights = dict(DEFAULT_DOMAIN_WEIGHTS)
        scoring = deepcopy(DEFAULT_SIMULATION_SCORING)
        targets = {
            domain: sum(1 for item in question_order if item.get("domain") == domain)
            for domain in weights
        }
        domain_data_complete = all(
            str(item.get("domain") or "") in weights for item in question_order
        )
    else:
        headers = await _release_question_headers(db, release_id)
        if len(headers) < count:
            raise _error(
                422,
                "PRACTICE_QUESTION_SHORTAGE",
                "试卷题量不足，无法开始本次练习",
                available=len(headers),
                requested=count,
            )
        ordered_headers = (
            sorted(headers, key=lambda row: _stable_random_key(selection_seed, row))
            if order == "random"
            else sorted(headers, key=lambda row: row.order_index)
        )
        selected_ids = [row.question_id for row in ordered_headers[:count]]
        row_map = await _release_question_rows(
            db,
            release_id,
            question_ids=selected_ids,
        )
        rows = [row_map[question_id] for question_id in selected_ids]
        weights, scoring = _release_scoring(release)
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
        paper_id=paper_id or None,
        release_id=release_id or None,
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
        existing_query = select(PracticeSession).where(
            PracticeSession.owner_id == owner,
            PracticeSession.mode == mode,
            PracticeSession.status.in_(["active", "paused"]),
        )
        if mode != "revenge":
            existing_query = existing_query.where(PracticeSession.paper_id == paper_id)
        existing = (
            await db.execute(
                existing_query.order_by(
                    PracticeSession.last_saved_at.desc(), PracticeSession.id
                ).limit(1)
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


def _entry_response(session: dict, *, resumed: bool) -> dict:
    questions = list(session.get("questions") or [])
    entry_session = {
        key: deepcopy(session.get(key))
        for key in (
            "id",
            "paperId",
            "releaseId",
            "mode",
            "status",
            "questionOrder",
            "answers",
            "runtimeState",
            "stats",
            "revision",
            "startedAt",
            "lastSavedAt",
        )
    }
    return {
        "resumed": resumed,
        "session": entry_session,
        "questions": questions,
    }


async def enter_session(
    db: AsyncSession,
    owner: str,
    user: User,
    data: dict,
) -> dict:
    mode = str(data.get("mode") or "").strip().lower()
    paper_id = str(data.get("paperId") or "").strip()
    if mode not in PRACTICE_SESSION_MODES:
        raise _error(422, "INVALID_PRACTICE_MODE", "练习模式无效")
    if mode != "revenge" and not paper_id:
        raise _error(422, "PRACTICE_RELEASE_REQUIRED", "paperId 和 releaseId 不能为空")

    await db.execute(
        sql_text("SELECT pg_advisory_xact_lock(hashtext(:owner), hashtext(:scope))"),
        {
            "owner": owner,
            "scope": (
                "practice-session:global:revenge"
                if mode == "revenge"
                else f"practice-session:{paper_id}:{mode}"
            ),
        },
    )
    existing_query = select(PracticeSession).where(
        PracticeSession.owner_id == owner,
        PracticeSession.mode == mode,
        PracticeSession.status.in_(["active", "paused"]),
    )
    if mode != "revenge":
        existing_query = existing_query.where(PracticeSession.paper_id == paper_id)
    existing = (
        await db.execute(
            existing_query.order_by(
                PracticeSession.last_saved_at.desc(), PracticeSession.id
            ).limit(1)
        )
    ).scalar_one_or_none()
    if existing is not None:
        return _entry_response(
            await _session_payload(db, existing),
            resumed=True,
        )

    created = await start_session(db, owner, user, data)
    return _entry_response(created, resumed=False)


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

    session_rows = await _session_question_rows(db, session)
    row = session_rows.get(question_id)
    if row is None:
        raise _error(404, "PRACTICE_QUESTION_NOT_FOUND", "题目不存在于当前练习快照")
    # 旧逐题接口与整卷交卷共用同一个单题判题入口：不复制第二套错题逻辑。
    submission_index = len(
        [key for key, value in answers.items() if isinstance(value, dict)]
    ) + 1
    try:
        answer = await _grade_session_selection(
            db,
            owner,
            user,
            session,
            ref,
            row,
            {"selectedAnswer": selected_answer} | ({"timedOut": True} if timed_out else {}),
            submission_index,
        )
    except PracticeSessionError as error:
        # 旧接口错误语义保持：ValueError→422 PRACTICE_ANSWER_INVALID；
        # LookupError（题目不再可用）沿用既有 404 PRACTICE_QUESTION_NOT_FOUND。
        if error.code == "PRACTICE_GRADE_FAILED":
            code = (
                "PRACTICE_QUESTION_NOT_FOUND"
                if error.status_code == 409
                else "PRACTICE_ANSWER_INVALID"
            )
            raise _error(error.status_code, code, error.message) from error
        raise
    except IntegrityError:
        # 并发兜底：理论上外层会话行锁已串行化，唯一索引冲突意味着状态异常，
        # 结构化返回而不是 500。
        raise _error(409, "PRACTICE_MISTAKE_ALREADY_RECORDED", "该题错题已记录，请刷新后重试")
    mistake_status = str(answer.get("mistakeStatus") or "")

    answers[question_id] = answer
    session.answers = answers
    _record_runtime_ledger(session, question_id)
    previous_stats = session.stats if isinstance(session.stats, dict) else {}
    session.stats = _draft_stats(refs, session_rows, answers, previous_stats)
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


_DRAFT_LOCK_FIELDS = ("selectedAnswer", "selectedAnswerIds", "timedOut", "selectionIndex")


def _assert_existing_selections_unchanged(existing: dict, draft: dict) -> None:
    """整卷草稿不允许减少或改写已保存的锁定答案。

    旧版已判题答案（带 correct 等字段）只比较 selectedAnswer/timedOut/selectionIndex，
    保证升级前保留下来的进行中草稿可以继续。
    """
    for question_id, answer in (existing or {}).items():
        if not isinstance(answer, dict) or answer.get("draft") is True:
            # 旧版未锁定草稿不参与锁定比较。
            continue
        replacement = draft.get(question_id)
        if not isinstance(replacement, dict):
            raise _error(
                409,
                "PRACTICE_ANSWER_LOCKED",
                "已保存答案不能减少",
                questionId=question_id,
            )
        for field in _DRAFT_LOCK_FIELDS:
            if field not in answer or answer.get(field) == replacement.get(field):
                continue
            if (
                field == "selectedAnswer"
                and answer.get("timedOut") is True
                and replacement.get("timedOut") is True
            ):
                # 旧版超时答案以 "__timeout__" 占位 selectedAnswer，仍标记超时不算改写。
                continue
            raise _error(
                409,
                "PRACTICE_ANSWER_LOCKED",
                "已保存答案不能修改",
                questionId=question_id,
            )


async def _apply_saved_draft(db: AsyncSession, session: PracticeSession, data: dict) -> None:
    draft = await _validated_draft_answers(db, session, data) if "answers" in data else None
    if draft is not None:
        _assert_existing_selections_unchanged(session.answers or {}, draft)
    _apply_runtime_patch(session, data)
    if draft is not None:
        session.answers = draft
    refs = session.question_order if isinstance(session.question_order, list) else []
    rows = await _session_question_rows(db, session)
    session.stats = _draft_stats(refs, rows, session.answers or {}, dict(session.stats or {}))
    session.runtime_state = {**(session.runtime_state or {}), "experience": session.stats["experience"]}


async def _same_saved_payload(db: AsyncSession, session: PracticeSession, data: dict) -> bool:
    if "answers" in data:
        draft = await _validated_draft_answers(db, session, data)
        saved = {
            qid: {key: answer[key] for key in _DRAFT_LOCK_FIELDS if key in answer}
            for qid, answer in (session.answers or {}).items()
        }
        if draft != saved:
            return False
    if "runtimeState" in data:
        patch = _validated_runtime_state(data, question_count=len(session.question_order or []))
        if any(key != "experience" and value != (session.runtime_state or {}).get(key)
               for key, value in patch.items()):
            return False
    return True


async def _settle_saved_experience(db: AsyncSession, session: PracticeSession, saved_at) -> None:
    try:
        await practice_experience_service.settle_experience_delta(
            db, session, int((session.stats or {}).get("experience") or 0), saved_at
        )
    except ValueError as error:
        raise _error(409, "PRACTICE_EXPERIENCE_CONFLICT", str(error)) from error
    session.stats = {key: value for key, value in session.stats.items() if key != "historyHidden"}


async def pause_session(db: AsyncSession, owner: str, session_id: str, data: dict) -> dict:
    requested_revision = _required_revision(data)
    session = await _session_for_update(db, owner, session_id)
    if session.status == "paused":
        if requested_revision not in {session.revision, session.revision - 1}:
            raise _revision_conflict(session)
        if await _same_saved_payload(db, session, data):
            return await _session_payload(db, session)
        if requested_revision != session.revision:
            raise _revision_conflict(session)
        # A restored paused session may accumulate new local answers without a resume write.
    elif session.status != "active":
        raise _error(409, "PRACTICE_SESSION_TERMINAL", "练习已结束，不能暂停")
    if session.revision != requested_revision:
        raise _revision_conflict(session)
    await _apply_saved_draft(db, session, data)
    saved_at = now_utc()
    await _settle_saved_experience(db, session, saved_at)
    session.status = "paused"
    session.paused_at = saved_at
    session.last_saved_at = saved_at
    session.revision += 1
    await db.commit()
    await db.refresh(session)
    return await _session_payload(db, session)


async def abandon_session(db: AsyncSession, owner: str, session_id: str, data: dict) -> dict:
    requested_revision = _required_revision(data)
    session = await _session_for_update(db, owner, session_id)
    if session.status == "abandoned":
        if requested_revision in {session.revision, session.revision - 1} and await _same_saved_payload(db, session, data):
            return await _session_payload(db, session)
        raise _revision_conflict(session)
    if session.status == "completed":
        raise _error(409, "PRACTICE_SESSION_TERMINAL", "已完成的练习不能放弃")
    if session.revision != requested_revision:
        raise _revision_conflict(session)
    await _apply_saved_draft(db, session, data)
    saved_at = now_utc()
    await _settle_saved_experience(db, session, saved_at)
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
    release = (
        await db.get(PaperRelease, session.release_id)
        if session.release_id
        else None
    )
    paper_name = (
        "全局复仇错题"
        if session.mode == "revenge" and session.release_id is None
        else release.name if release is not None else "PMP 模拟练习"
    )
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


async def _grade_session_selection(
    db: AsyncSession,
    owner: str,
    user: User,
    session: PracticeSession,
    ref: dict,
    row: SessionQuestion,
    draft: dict,
    submission_index: int,
    *,
    record: bool = True,
) -> dict:
    """Judge one selection against the frozen session snapshot.

    整卷交卷与旧逐题接口共用这一个入口：错题/进度副作用全部在当前事务内
    commit=False 记录，由调用方决定提交或整体回滚。record=False 只判定、
    不动长期状态（升级链路里已被旧 /answers 记过账的答案）。
    """

    selected = str(draft.get("selectedAnswer") or "")
    timed_out = draft.get("timedOut") is True
    if timed_out:
        selected = "__timeout__"
    frozen_snapshot = row.snapshot if isinstance(row.snapshot, dict) else {}
    multiple = str(frozen_snapshot.get("type") or "") == "multiple_choice"
    selected_ids = draft.get("selectedAnswerIds") if multiple else [selected]
    selection_grading = question_answer_service.grade_selection(
        frozen_snapshot, selected_ids, timed_out=timed_out
    )
    correct_answer = learning_service.canonical_practice_snapshot_answer(
        frozen_snapshot
    )
    correct_option_ids = selection_grading["correctOptionIds"]
    selected_option_ids = selection_grading["selectedOptionIds"]

    mistake = None
    completion: dict = {}
    try:
        if session.mode == "revenge":
            option_ids = _snapshot_option_ids(frozen_snapshot)
            if (multiple and len(correct_option_ids) < 2) or (not multiple and (not correct_answer or correct_answer not in option_ids)):
                raise _error(
                    409,
                    "PRACTICE_SNAPSHOT_INVALID",
                    "判题失败：冻结错题快照缺少有效正确答案",
                    questionId=str(ref.get("questionId") or ""),
                )
            if (multiple and not selected_option_ids) or (not multiple and selected not in option_ids):
                raise _error(
                    422,
                    "PRACTICE_GRADE_FAILED",
                    "selectedAnswer 不是冻结题目快照的有效选项",
                )
            mistake = await learning_service.record_revenge_answer(
                db,
                owner,
                str(ref.get("mistakeId") or ""),
                ({"selectedAnswerIds": selected_option_ids} if multiple else {"selectedAnswer": selected}),
                commit=False,
                allow_concurrent=True,
                record=record,
                authoritative_snapshot=frozen_snapshot,
            )
            if mistake is None or str(mistake.question_id or "") != str(
                ref.get("questionId") or ""
            ):
                raise _error(404, "PRACTICE_MISTAKE_NOT_FOUND", "错题不存在或无权访问")
            correct = bool(selection_grading["correct"])
        else:
            grading = await learning_service.record_practice_answer(
                db,
                owner,
                {
                    "questionId": ref["questionId"],
                    "bankId": ref.get("bankId", ""),
                    "paperId": session.paper_id,
                    "releaseId": session.release_id,
                    "sourceMode": session.mode,
                    **({"selectedAnswerIds": selected_option_ids} if multiple else {"selectedAnswer": selected}),
                    "timedOut": timed_out,
                },
                current_user=user,
                commit=False,
                allow_concurrent=True,
                record=record,
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
        raise _error(422, "PRACTICE_GRADE_FAILED", str(error)) from error
    except LookupError as error:
        raise _error(
            409, "PRACTICE_GRADE_FAILED", "判题失败：题目不再可用"
        ) from error

    answer = {
        "questionId": ref["questionId"],
        **({"selectedAnswerIds": selected_option_ids, "correctOptionIds": correct_option_ids} if multiple else {"selectedAnswer": selected, "correctAnswer": correct_answer}),
        "correct": correct,
        "submittedAt": completion.get("completedAt") or now_utc().isoformat(),
        "submissionIndex": submission_index,
    }
    if timed_out:
        answer["timedOut"] = True
    if session.mode == "revenge":
        answer["mistakeId"] = str(ref.get("mistakeId") or "")
        answer["mistakeStatus"] = mistake.status
    return answer


def _already_graded_selections(runtime_state: dict) -> set[str]:
    """Question ids whose mistakes were already recorded before this submit.

    runtime_state.gradedQuestionIds 是服务端维护的记账账本：旧 /answers 判题
    成功时追加；整卷草稿/重算路径只读不写。客户端无法伪造——
    _validated_runtime_state 白名单会直接拒绝未知字段。
    """

    raw = (runtime_state or {}).get("gradedQuestionIds")
    if not isinstance(raw, list):
        return set()
    return {str(item) for item in raw if isinstance(item, str) and item}


def _record_runtime_ledger(session: PracticeSession, question_id: str) -> None:
    """Append one graded question to the server-owned runtime ledger."""

    state = dict(session.runtime_state or {})
    ledger = {
        str(item)
        for item in state.get("gradedQuestionIds") or []
        if isinstance(item, str) and item
    }
    ledger.add(str(question_id))
    state["gradedQuestionIds"] = sorted(ledger)
    session.runtime_state = state


async def complete_session(
    db: AsyncSession,
    owner: str,
    user: User,
    session_id: str,
    data: dict,
) -> tuple[dict, dict]:
    # 终态幂等：重复交卷（网络重试等）先于解析新 body 返回冻结报告，
    # 不重放判题、不重复产生经验/错题/完成事件。
    # 门槛只看 status=='completed'：snapshot 损坏的存量行同样返回终态
    # （get_report 对缺 snapshot 返回 404 由读取端兜底），不再重放判题副作用。
    existing = (
        await db.execute(
            select(PracticeSession).where(
                PracticeSession.id == session_id,
                PracticeSession.owner_id == owner,
                PracticeSession.status == "completed",
            )
        )
    ).scalar_one_or_none()
    if existing is not None:
        return (
            await _session_payload(db, existing),
            existing.report_snapshot if isinstance(existing.report_snapshot, dict) else {},
        )

    requested_revision = _required_revision(data)
    session = await _session_for_update(db, owner, session_id)
    if session.status == "completed":
        return (
            await _session_payload(db, session),
            session.report_snapshot if isinstance(session.report_snapshot, dict) else {},
        )
    if session.status == "abandoned":
        raise _error(409, "PRACTICE_SESSION_TERMINAL", "已放弃的练习不能交卷")
    if session.revision != requested_revision:
        raise _revision_conflict(session)

    refs = [item for item in session.question_order if isinstance(item, dict)]
    rows = await _session_question_rows(db, session)

    whole_paper = isinstance(data.get("answers"), dict)
    if whole_paper:
        # 整卷载荷：白名单校验后按 selectionIndex 排序，形成权威提交顺序。
        draft = await _validated_draft_answers(db, session, data)
        _assert_existing_selections_unchanged(session.answers or {}, draft)
        ordered = sorted(draft.items(), key=lambda pair: int(pair[1]["selectionIndex"]))
        selections: list[tuple[str, dict]] = []
        for question_id, selection in ordered:
            row = rows.get(question_id)
            if row is None:
                raise _error(
                    409,
                    "PRACTICE_GRADE_FAILED",
                    "判题失败：题目不存在于当前练习快照",
                    questionId=question_id,
                )
            selections.append((question_id, selection))

    # 升级兼容：账本内的题升级前已被旧 /answers 记过账。整卷重算对这些题只做
    # 权威判定（record=False），不重放错题记账——否则同一事务内对
    # (owner, question, release) 二次累计会重复 wrongCount 甚至撞唯一索引。
    already_graded = _already_graded_selections(session.runtime_state or {})
    if whole_paper:
        # 一次锁定后开始逐题权威重算；任何一题失败都会在路由层整体回滚。
        answers: dict[str, dict] = {}
        try:
            for submission_index, (question_id, selection) in enumerate(selections, start=1):
                ref = next(item for item in refs if item.get("questionId") == question_id)
                if question_id in already_graded:
                    previous_answer = (session.answers or {}).get(question_id)
                    carried = (
                        dict(previous_answer)
                        if isinstance(previous_answer, dict)
                        else {}
                    )
                    graded = await _grade_session_selection(
                        db, owner, user, session, ref, rows[question_id],
                        selection, submission_index,
                        record=False,
                    )
                    if "submittedAt" in carried:
                        graded["submittedAt"] = carried["submittedAt"]
                    answers[question_id] = graded
                    continue
                answers[question_id] = await _grade_session_selection(
                    db, owner, user, session, ref, rows[question_id], selection, submission_index
                )
        except IntegrityError:
            # 防御性兜底：账本识别失守时唯一索引冲突按结构化错误整笔回滚，
            # 不产生 500 或半份完成态。
            raise _error(
                409,
                "PRACTICE_MISTAKE_ALREADY_RECORDED",
                "该题错题已记录，请刷新进度后重试",
            )
        session.answers = answers

    runtime_state = dict(session.runtime_state or {})
    _apply_runtime_patch(session, data)
    runtime_state.update(session.runtime_state or {})
    current_answers = session.answers if isinstance(session.answers, dict) else {}
    previous_stats = session.stats if isinstance(session.stats, dict) else {}
    stats = _draft_stats(refs, rows, current_answers, previous_stats)
    # 单一来源：完成态经验只由服务端按 submissionIndex 权威连击值决定。
    stats["experience"] = _experience_for_answers(current_answers)
    stats["durationMs"] = stats.get(
        "durationMs", max(0, int(previous_stats.get("durationMs") or 0))
    )
    runtime_state["experience"] = stats["experience"]
    session.stats = stats
    session.runtime_state = runtime_state

    report = await _build_report(db, session)
    completed_at = now_utc()
    await _settle_saved_experience(db, session, completed_at)
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
                "experience": max(0, int(stats["experience"])),
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
