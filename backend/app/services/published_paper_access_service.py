"""Server-side access checks for frozen published-paper question snapshots."""

from __future__ import annotations

import json
import hashlib
from collections.abc import Mapping

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.question import Question, QuestionBank
from app.models.shared_runtime_state import SharedRuntimeState
from app.models.subscription import Subscription
from app.models.user import User
from app.services import subscription_service


PUBLISHED_PAPERS_KEY = "kg_exam_papers_published_v1"
PUBLISHED_STATUSES = frozenset({"published", "active", "released"})
MEMBER_ACCESS_LEVELS = frozenset({"member", "vip", "paid", "premium"})


def _text(value: object) -> str:
    return str(value or "").strip()


def _question_identity(value: object) -> tuple[str, str]:
    if not isinstance(value, Mapping):
        return "", ""
    question = value.get("question")
    question_payload = question if isinstance(question, Mapping) else {}
    return (
        _text(
            value.get("questionId")
            or value.get("sourceQuestionId")
            or question_payload.get("id")
            or value.get("id")
        ),
        _text(
            value.get("bankId")
            or value.get("sourceBankId")
            or question_payload.get("bankId")
        ),
    )


def _release_contains_question(release: object, question: Question) -> bool:
    if not isinstance(release, Mapping):
        return False
    if _text(release.get("status") or "published").casefold() not in PUBLISHED_STATUSES:
        return False
    modes = release.get("enabledModes")
    if isinstance(modes, list) and "deep_recall" not in {_text(mode) for mode in modes}:
        return False

    expected = (question.id, question.bank_id)
    references = release.get("questions")
    if not isinstance(references, list):
        references = release.get("questionRefs")
    if not isinstance(references, list):
        references = []
    snapshots = release.get("questionSnapshots")
    if not isinstance(snapshots, list):
        snapshots = []
    return (
        any(_question_identity(reference) == expected for reference in references)
        and any(_question_identity(snapshot) == expected for snapshot in snapshots)
    )


def _published_question_snapshot(
    release: object,
    question_id: str,
) -> tuple[str, Mapping] | None:
    if not isinstance(release, Mapping):
        return None
    if _text(release.get("status") or "published").casefold() not in PUBLISHED_STATUSES:
        return None
    modes = release.get("enabledModes")
    if isinstance(modes, list) and "deep_recall" not in {_text(mode) for mode in modes}:
        return None
    references = release.get("questions")
    if not isinstance(references, list):
        references = release.get("questionRefs")
    if not isinstance(references, list):
        references = []
    matching_banks = {
        bank_id
        for candidate_id, bank_id in map(_question_identity, references)
        if candidate_id == question_id and bank_id
    }
    snapshots = release.get("questionSnapshots")
    if not isinstance(snapshots, list):
        return None
    for snapshot in snapshots:
        candidate_id, bank_id = _question_identity(snapshot)
        if candidate_id != question_id or bank_id not in matching_banks:
            continue
        if isinstance(snapshot, Mapping) and isinstance(snapshot.get("question"), Mapping):
            return bank_id, snapshot
    return None


async def _can_access_release(
    db: AsyncSession,
    user: User,
    release: Mapping,
) -> bool:
    allowed_roles = release.get("allowedRoles")
    if isinstance(allowed_roles, list):
        normalized_roles = {_text(role) for role in allowed_roles if _text(role)}
        if normalized_roles and user.role not in normalized_roles:
            return False

    policy = release.get("accessPolicy")
    access_level = _text(
        policy.get("accessLevel") if isinstance(policy, Mapping) else release.get("accessLevel")
    ).casefold()
    if access_level not in MEMBER_ACCESS_LEVELS:
        return True
    if user.role in {"admin", "teacher"}:
        return True
    if user.role != "student":
        return False
    subscription = await db.get(Subscription, user.username)
    return bool(
        subscription_service.entitlements_for(user.role, subscription).get(
            "allExamPapers"
        )
    )


async def can_learn_published_question(
    db: AsyncSession,
    user: User,
    question: Question,
) -> bool:
    row = await db.get(SharedRuntimeState, PUBLISHED_PAPERS_KEY)
    if row is None:
        return False
    try:
        releases = json.loads(row.value or "[]")
    except (TypeError, ValueError, json.JSONDecodeError):
        return False
    if not isinstance(releases, list):
        return False
    for release in releases:
        if not _release_contains_question(release, question):
            continue
        if await _can_access_release(db, user, release):
            return True
    return False


def _publisher_username(release: Mapping, fallback: str | None) -> str:
    publisher = release.get("publishedBy")
    if isinstance(publisher, Mapping):
        candidate = _text(publisher.get("username") or publisher.get("id"))
    else:
        candidate = _text(publisher)
    return candidate or _text(fallback)


def _content_hash(payload: Mapping) -> str:
    explicit = _text(payload.get("contentHash"))
    if len(explicit) == 64:
        return explicit
    encoded = json.dumps(
        payload,
        ensure_ascii=False,
        sort_keys=True,
        separators=(",", ":"),
    ).encode("utf-8")
    return hashlib.sha256(encoded).hexdigest()


async def _projection_owner(
    db: AsyncSession,
    release: Mapping,
    fallback: str | None,
) -> User | None:
    username = _publisher_username(release, fallback)
    owner = await db.get(User, username) if username else None
    if owner is not None:
        return owner
    return (
        await db.execute(
            select(User)
            .where(User.role == "admin", User.status == "active")
            .order_by(User.username)
            .limit(1)
        )
    ).scalar_one_or_none()


async def load_or_project_published_question(
    db: AsyncSession,
    user: User,
    question_id: str,
) -> Question | None:
    """Materialize one legacy frozen release into canonical PostgreSQL rows."""

    row = await db.get(SharedRuntimeState, PUBLISHED_PAPERS_KEY)
    if row is None:
        return None
    try:
        releases = json.loads(row.value or "[]")
    except (TypeError, ValueError, json.JSONDecodeError):
        return None
    if not isinstance(releases, list):
        return None
    for release in releases:
        match = _published_question_snapshot(release, question_id)
        if match is None or not isinstance(release, Mapping):
            continue
        if not await _can_access_release(db, user, release):
            continue
        bank_id, snapshot = match
        if not bank_id or len(bank_id) > 64 or not question_id or len(question_id) > 64:
            return None
        existing = await db.get(Question, question_id)
        if existing is not None:
            return existing if existing.bank_id == bank_id else None
        owner = await _projection_owner(db, release, row.updated_by)
        if owner is None:
            return None
        bank = await db.get(QuestionBank, bank_id)
        if bank is None:
            bank = QuestionBank(
                id=bank_id,
                owner_id=owner.username,
                name=_text(snapshot.get("bankName"))[:200] or "发布试卷快照题库",
                subject=_text(
                    snapshot.get("bankSubject") or release.get("subject") or "PMP"
                )[:32],
                description="由已发布试卷冻结快照投影",
                visibility="private",
                revision=1,
                created_by=owner.username,
                updated_by=owner.username,
            )
            db.add(bank)
            await db.flush()
        payload = snapshot["question"]
        title = _text(payload.get("title"))
        if not title:
            return None
        question = Question(
            id=question_id,
            bank_id=bank_id,
            source_id=_text(payload.get("sourceId"))[:128] or None,
            title=title[:500],
            type=_text(payload.get("type") or "single_choice")[:32],
            subject=_text(payload.get("subject") or bank.subject)[:32] or None,
            difficulty=_text(payload.get("difficulty"))[:32] or None,
            domain=_text(payload.get("domain"))[:100] or None,
            topic=_text(payload.get("topic"))[:100] or None,
            teacher_number=_text(payload.get("teacherNumber"))[:64] or None,
            scope="internal",
            content_hash=_content_hash(payload),
            creator_id=_text(payload.get("creatorId"))[:64] or None,
            creator_name=_text(payload.get("creatorName"))[:120] or None,
            created_by=owner.username,
            updated_by=owner.username,
            revision=max(1, int(payload.get("revision") or 1)),
            tags=payload.get("tags") if isinstance(payload.get("tags"), list) else [],
            stem_parts=(
                payload.get("stemParts")
                if isinstance(payload.get("stemParts"), list)
                else []
            ),
            options=(
                payload.get("options") if isinstance(payload.get("options"), list) else []
            ),
            correct_answer=_text(payload.get("correctAnswer"))[:20] or None,
            analysis=(
                str(payload.get("analysis"))
                if payload.get("analysis") is not None
                else None
            ),
            clues=payload.get("clues") if isinstance(payload.get("clues"), list) else [],
            concepts=(
                payload.get("concepts")
                if isinstance(payload.get("concepts"), list)
                else []
            ),
            reasoning_steps=(
                payload.get("reasoningSteps")
                if isinstance(payload.get("reasoningSteps"), list)
                else []
            ),
            status=payload.get("status") if isinstance(payload.get("status"), dict) else {},
            translations=(
                payload.get("translations")
                if isinstance(payload.get("translations"), dict)
                else {}
            ),
            content_metadata=(
                payload.get("metadata")
                if isinstance(payload.get("metadata"), dict)
                else {}
            ),
            key_path=(
                payload.get("keyPath")
                if isinstance(payload.get("keyPath"), dict)
                else {}
            ),
            lifecycle=(
                payload.get("lifecycle")
                if isinstance(payload.get("lifecycle"), dict)
                else {"status": "active"}
            ),
        )
        db.add(question)
        await db.flush()
        return question
    return None
