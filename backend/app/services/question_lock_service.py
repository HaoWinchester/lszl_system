"""Database-backed, per-question edit leases for Content Prep clients."""

from __future__ import annotations

import hashlib
import hmac
import secrets
from datetime import timedelta

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.security import now_utc, uid
from app.models.content_prep import QuestionAuditLog, QuestionEditLock
from app.models.question import Question
from app.models.user import User
from app.services import content_prep_service, question_access_service

HEARTBEAT_INTERVAL_SECONDS = 30
LEASE_SECONDS = 300


class QuestionLockError(RuntimeError):
    def __init__(self, code: str, message: str, *, status_code: int = 409):
        super().__init__(message)
        self.code = code
        self.message = message
        self.status_code = status_code


def _token_hash(lock_token: str) -> str:
    return hashlib.sha256(lock_token.encode("utf-8")).hexdigest()


def _token_matches(lock: QuestionEditLock, lock_token: str) -> bool:
    return hmac.compare_digest(lock.token_hash, _token_hash(lock_token))


def _lock_payload(lock: QuestionEditLock, plain_token: str) -> dict:
    return {
        "questionId": lock.question_id,
        "lockToken": plain_token,
        "lockedBy": lock.locked_by,
        "creatorId": lock.creator_id,
        "creatorName": lock.creator_name,
        "clientInstanceId": lock.client_instance_id,
        "acquiredAt": lock.acquired_at.isoformat(),
        "expiresAt": lock.expires_at.isoformat(),
        "heartbeatIntervalSeconds": HEARTBEAT_INTERVAL_SECONDS,
        "leaseSeconds": LEASE_SECONDS,
    }


def _add_audit(
    db: AsyncSession,
    *,
    action: str,
    actor: User,
    question: Question,
    creator_id: str | None,
    creator_name: str | None,
    detail: dict,
) -> None:
    db.add(
        QuestionAuditLog(
            id=uid("qal_"),
            entity_type="question_lock",
            entity_id=question.id,
            action=action,
            actor_username=actor.username,
            actor_role=actor.role,
            creator_id=creator_id,
            creator_name=creator_name,
            bank_id=question.bank_id,
            question_id=question.id,
            outcome="success",
            detail=detail,
        )
    )


async def _locked_question(
    db: AsyncSession,
    question_id: str,
    actor: User,
    *,
    require_edit: bool,
) -> Question:
    question = await db.get(Question, question_id)
    if question is None:
        raise QuestionLockError(
            "QUESTION_NOT_FOUND",
            "题目不存在",
            status_code=404,
        )
    if require_edit:
        await question_access_service.require_bank_access(
            db,
            actor,
            question.bank_id,
            edit=True,
        )
    result = await db.execute(
        select(Question).where(Question.id == question_id).with_for_update()
    )
    return result.scalar_one()


async def _current_lock_for_update(
    db: AsyncSession,
    question_id: str,
) -> QuestionEditLock | None:
    result = await db.execute(
        select(QuestionEditLock)
        .where(QuestionEditLock.question_id == question_id)
        .with_for_update()
    )
    return result.scalar_one_or_none()


def _creator_for_lock(
    question: Question,
    requested_creator_id: str | None,
) -> tuple[str | None, str | None]:
    candidate = requested_creator_id or question.creator_id
    if candidate:
        try:
            return content_prep_service.resolve_creator(candidate)
        except content_prep_service.ContentPrepInputError as error:
            raise QuestionLockError(
                error.code,
                error.message,
                status_code=422,
            ) from error
    return None, None


async def acquire_lock(
    db: AsyncSession,
    question_id: str,
    actor: User,
    *,
    client_instance_id: str,
    creator_id: str | None,
) -> dict:
    if not str(client_instance_id or "").strip():
        raise QuestionLockError(
            "CLIENT_INSTANCE_REQUIRED",
            "clientInstanceId 不能为空",
            status_code=422,
        )
    question = await _locked_question(db, question_id, actor, require_edit=True)
    normalized_creator_id, creator_name = _creator_for_lock(question, creator_id)
    now = now_utc()
    existing = await _current_lock_for_update(db, question_id)

    if existing is not None and existing.expires_at > now:
        same_holder = (
            existing.locked_by == actor.username
            and existing.client_instance_id == client_instance_id
        )
        if not same_holder:
            raise QuestionLockError(
                "LOCKED_BY_OTHER",
                f"题目正由 {existing.locked_by} 编辑",
            )
        plain_token = secrets.token_urlsafe(32)
        existing.token_hash = _token_hash(plain_token)
        existing.heartbeat_at = now
        existing.expires_at = now + timedelta(seconds=LEASE_SECONDS)
        existing.creator_id = normalized_creator_id
        existing.creator_name = creator_name
        _add_audit(
            db,
            action="lock_reacquired",
            actor=actor,
            question=question,
            creator_id=normalized_creator_id,
            creator_name=creator_name,
            detail={"clientInstanceId": client_instance_id},
        )
    else:
        if existing is not None:
            _add_audit(
                db,
                action="lock_expired",
                actor=actor,
                question=question,
                creator_id=existing.creator_id,
                creator_name=existing.creator_name,
                detail={
                    "previousLockedBy": existing.locked_by,
                    "previousClientInstanceId": existing.client_instance_id,
                    "expiredAt": existing.expires_at.isoformat(),
                },
            )
        plain_token = secrets.token_urlsafe(32)
        if existing is None:
            existing = QuestionEditLock(
                question_id=question_id,
                locked_by=actor.username,
                creator_id=normalized_creator_id,
                creator_name=creator_name,
                client_instance_id=client_instance_id,
                token_hash=_token_hash(plain_token),
                acquired_at=now,
                heartbeat_at=now,
                expires_at=now + timedelta(seconds=LEASE_SECONDS),
            )
            db.add(existing)
        else:
            existing.locked_by = actor.username
            existing.creator_id = normalized_creator_id
            existing.creator_name = creator_name
            existing.client_instance_id = client_instance_id
            existing.token_hash = _token_hash(plain_token)
            existing.acquired_at = now
            existing.heartbeat_at = now
            existing.expires_at = now + timedelta(seconds=LEASE_SECONDS)
        _add_audit(
            db,
            action="lock_acquired",
            actor=actor,
            question=question,
            creator_id=normalized_creator_id,
            creator_name=creator_name,
            detail={"clientInstanceId": client_instance_id},
        )

    await db.commit()
    await db.refresh(existing)
    return _lock_payload(existing, plain_token)


def _assert_holder(
    lock: QuestionEditLock | None,
    actor: User,
    client_instance_id: str,
    lock_token: str,
) -> QuestionEditLock:
    now = now_utc()
    if lock is None or lock.expires_at <= now:
        raise QuestionLockError("LOCK_TOKEN_INVALID", "编辑锁不存在或已过期")
    if lock.locked_by != actor.username or lock.client_instance_id != client_instance_id:
        raise QuestionLockError(
            "LOCKED_BY_OTHER",
            f"题目正由 {lock.locked_by} 编辑",
        )
    if not lock_token or not _token_matches(lock, lock_token):
        raise QuestionLockError("LOCK_TOKEN_INVALID", "编辑锁令牌无效")
    return lock


async def heartbeat_lock(
    db: AsyncSession,
    question_id: str,
    actor: User,
    *,
    client_instance_id: str,
    lock_token: str,
) -> dict:
    question = await _locked_question(db, question_id, actor, require_edit=True)
    lock = _assert_holder(
        await _current_lock_for_update(db, question_id),
        actor,
        client_instance_id,
        lock_token,
    )
    now = now_utc()
    lock.heartbeat_at = now
    lock.expires_at = now + timedelta(seconds=LEASE_SECONDS)
    _add_audit(
        db,
        action="lock_heartbeat",
        actor=actor,
        question=question,
        creator_id=lock.creator_id,
        creator_name=lock.creator_name,
        detail={"clientInstanceId": client_instance_id},
    )
    await db.commit()
    await db.refresh(lock)
    return _lock_payload(lock, lock_token)


async def release_lock(
    db: AsyncSession,
    question_id: str,
    actor: User,
    *,
    client_instance_id: str,
    lock_token: str,
) -> None:
    question = await _locked_question(db, question_id, actor, require_edit=True)
    lock = _assert_holder(
        await _current_lock_for_update(db, question_id),
        actor,
        client_instance_id,
        lock_token,
    )
    _add_audit(
        db,
        action="lock_released",
        actor=actor,
        question=question,
        creator_id=lock.creator_id,
        creator_name=lock.creator_name,
        detail={"clientInstanceId": client_instance_id},
    )
    await db.delete(lock)
    await db.commit()


async def force_release_lock(
    db: AsyncSession,
    question_id: str,
    actor: User,
) -> None:
    question = await _locked_question(db, question_id, actor, require_edit=False)
    lock = await _current_lock_for_update(db, question_id)
    if lock is not None:
        _add_audit(
            db,
            action="lock_force_released",
            actor=actor,
            question=question,
            creator_id=lock.creator_id,
            creator_name=lock.creator_name,
            detail={
                "previousLockedBy": lock.locked_by,
                "previousClientInstanceId": lock.client_instance_id,
            },
        )
        await db.delete(lock)
    await db.commit()


async def assert_lock_and_revision(
    db: AsyncSession,
    question: Question,
    actor: User,
    *,
    client_instance_id: str,
    lock_token: str,
    base_revision: int | None,
) -> QuestionEditLock:
    lock = _assert_holder(
        await _current_lock_for_update(db, question.id),
        actor,
        client_instance_id,
        lock_token,
    )
    if base_revision is None or int(base_revision) != question.revision:
        raise QuestionLockError(
            "REVISION_CONFLICT",
            "题目已被更新，请重新加载后再编辑",
        )
    return lock
