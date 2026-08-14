"""Database-authoritative Deep Recall sessions, snapshots, and progress."""

from __future__ import annotations

import hashlib
import json
from datetime import datetime
from typing import Any
from uuid import uuid4

from fastapi import HTTPException
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.permissions import can
from app.models.question import Question, QuestionBank
from app.models.subscription import Subscription
from app.models.training import (
    RecallLibrarySnapshot,
    RecallProgress,
    RecallQuestionSnapshot,
)
from app.models.user import User
from app.schemas.deep_recall import RecallProgressResetRequest, RecallProgressSaveRequest
from app.services import (
    content_prep_shared_service,
    published_paper_access_service,
    question_catalog_service,
    subscription_service,
)


FREE_STUDENT_NODE_LIMIT = 30
DEFAULT_TRANSFORM = {"x": 0, "y": 0, "scale": 1}


def canonical_hash(payload: Any) -> str:
    encoded = json.dumps(
        payload,
        ensure_ascii=False,
        sort_keys=True,
        separators=(",", ":"),
    ).encode("utf-8")
    return hashlib.sha256(encoded).hexdigest()


def _iso(value: datetime | None) -> str | None:
    return value.isoformat() if value else None


def _error(status_code: int, code: str, message: str, **extra: Any) -> HTTPException:
    return HTTPException(
        status_code=status_code,
        detail={"code": code, "message": message, **extra},
    )


async def _visible_question(
    db: AsyncSession,
    user: User,
    question_id: str,
) -> Question:
    question = await db.get(Question, question_id)
    if question is None:
        question = (
            await published_paper_access_service.load_or_project_published_question(
                db, user, question_id
            )
        )
        if question is None:
            raise _error(404, "recall_question_not_found", "题目不存在或当前不可学习")
    if not await question_catalog_service.is_learning_question_visible(
        db, question_id
    ) and not await published_paper_access_service.can_learn_published_question(
        db, user, question
    ):
        raise _error(404, "recall_question_not_found", "题目不存在或当前不可学习")
    return question


async def _question_subject(db: AsyncSession, question: Question) -> str:
    subject = str(question.subject or "").strip()
    if subject:
        return subject
    bank = await db.get(QuestionBank, question.bank_id)
    return str(bank.subject if bank else "PMP").strip() or "PMP"


async def _ensure_question_snapshot(
    db: AsyncSession,
    question: Question,
) -> tuple[RecallQuestionSnapshot, bool]:
    payload = question_catalog_service.question_to_payload(question)
    content_hash = str(question.content_hash or "").strip() or canonical_hash(payload)
    snapshot = (
        await db.execute(
            select(RecallQuestionSnapshot).where(
                RecallQuestionSnapshot.question_id == question.id,
                RecallQuestionSnapshot.question_revision == int(question.revision or 1),
            )
        )
    ).scalar_one_or_none()
    if snapshot is not None:
        if snapshot.content_hash != content_hash:
            raise _error(
                409,
                "question_revision_content_changed",
                "题目内容已变化但 revision 未递增，已拒绝混合历史图",
            )
        return snapshot, False

    snapshot = RecallQuestionSnapshot(
        id=str(uuid4()),
        question_id=question.id,
        bank_id=question.bank_id,
        question_revision=int(question.revision or 1),
        content_hash=content_hash,
        subject=await _question_subject(db, question),
        payload=payload,
    )
    db.add(snapshot)
    await db.flush()
    return snapshot, True


async def _ensure_library_snapshot(
    db: AsyncSession,
    subject: str,
) -> tuple[RecallLibrarySnapshot, bool]:
    shared = await content_prep_shared_service.read_shared_content(db, subject)
    normalized_subject = str(shared["subjectId"])
    payload = shared.get("recallLibrary") or {
        "schemaVersion": 1,
        "nodes": [],
        "edges": [],
        "updatedAt": "",
    }
    content_hash = canonical_hash(payload)
    snapshot = (
        await db.execute(
            select(RecallLibrarySnapshot).where(
                RecallLibrarySnapshot.subject == normalized_subject,
                RecallLibrarySnapshot.content_hash == content_hash,
            )
        )
    ).scalar_one_or_none()
    if snapshot is not None:
        return snapshot, False
    snapshot = RecallLibrarySnapshot(
        id=str(uuid4()),
        subject=normalized_subject,
        content_hash=content_hash,
        payload=payload,
        source_revision=int(shared.get("contentRevision") or 0),
    )
    db.add(snapshot)
    await db.flush()
    return snapshot, True


async def _history_question(
    db: AsyncSession,
    progress: RecallProgress,
) -> RecallQuestionSnapshot | None:
    return (
        await db.execute(
            select(RecallQuestionSnapshot).where(
                RecallQuestionSnapshot.question_id == progress.question_id,
                RecallQuestionSnapshot.question_revision
                == progress.source_question_revision,
            )
        )
    ).scalar_one_or_none()


async def _history_library(
    db: AsyncSession,
    progress: RecallProgress,
    subject: str,
) -> RecallLibrarySnapshot | None:
    if not progress.recall_library_hash:
        return None
    normalized_subject = str(
        (await content_prep_shared_service.read_shared_content(db, subject))["subjectId"]
    )
    return (
        await db.execute(
            select(RecallLibrarySnapshot).where(
                RecallLibrarySnapshot.subject == normalized_subject,
                RecallLibrarySnapshot.content_hash == progress.recall_library_hash,
            )
        )
    ).scalar_one_or_none()


def _permissions(user: User, *, mismatch: bool = False) -> dict[str, bool]:
    has_capability = can(user.role, "useDeepRecall")
    can_write = has_capability and user.role in {"admin", "teacher", "student"}
    return {
        "canRead": has_capability,
        "canWrite": can_write and not mismatch,
        "canReveal": can_write and not mismatch,
        "canReset": can_write,
        "readOnly": not can_write or mismatch,
    }


async def _node_limit(db: AsyncSession, user: User) -> int | None:
    if user.role in {"admin", "teacher"}:
        return None
    if user.role != "student":
        return 0
    subscription = await db.get(Subscription, user.username)
    if subscription_service.entitlements_for(user.role, subscription).get("allExamPapers"):
        return None
    return FREE_STUDENT_NODE_LIMIT


def _library_payload(snapshot: RecallLibrarySnapshot) -> dict[str, Any]:
    return {
        "subject": snapshot.subject,
        "contentHash": snapshot.content_hash,
        "sourceRevision": snapshot.source_revision,
        "payload": snapshot.payload or {"schemaVersion": 1, "nodes": [], "edges": []},
        "updatedAt": _iso(snapshot.created_at),
    }


def _empty_progress(*, read_only: bool) -> dict[str, Any]:
    return {
        "nodes": [],
        "edges": [],
        "customNodes": {},
        "activeKeywords": [],
        "choiceOffsets": {},
        "transform": dict(DEFAULT_TRANSFORM),
        "metrics": {},
        "graphSchemaVersion": 3,
        "revision": 0,
        "readOnly": read_only,
        "savedAt": None,
    }


def progress_payload(progress: RecallProgress, *, read_only: bool = False) -> dict[str, Any]:
    return {
        "nodes": progress.nodes or [],
        "edges": progress.edges or [],
        "customNodes": progress.custom_nodes or {},
        "activeKeywords": progress.active_keywords or [],
        "choiceOffsets": progress.choice_offsets or {},
        "transform": progress.transform or dict(DEFAULT_TRANSFORM),
        "metrics": progress.metrics or {},
        "graphSchemaVersion": int(progress.graph_schema_version or 3),
        "revision": int(progress.revision or 0),
        "readOnly": read_only,
        "savedAt": _iso(progress.saved_at),
    }


async def get_session(
    db: AsyncSession,
    user: User,
    question_id: str,
) -> dict[str, Any]:
    if not can(user.role, "useDeepRecall"):
        raise _error(403, "deep_recall_permission_denied", "当前账号无权使用深度回忆")
    question = await _visible_question(db, user, question_id)
    question_snapshot, question_created = await _ensure_question_snapshot(db, question)
    library_snapshot, library_created = await _ensure_library_snapshot(
        db,
        await _question_subject(db, question),
    )
    if question_created or library_created:
        await db.commit()
        await db.refresh(question_snapshot)
        await db.refresh(library_snapshot)

    progress = await db.get(RecallProgress, (user.username, question_id))
    mismatch = bool(
        progress
        and (
            int(progress.source_question_revision or 0) != question_snapshot.question_revision
            or str(progress.source_content_hash or "") != question_snapshot.content_hash
            or str(progress.recall_library_hash or "") != library_snapshot.content_hash
        )
    )
    permissions = _permissions(user, mismatch=mismatch)
    history_question = await _history_question(db, progress) if mismatch and progress else None
    history_library = (
        await _history_library(
            db,
            progress,
            history_question.subject if history_question else library_snapshot.subject,
        )
        if mismatch and progress
        else None
    )
    bound_library = history_library or library_snapshot
    graph = (
        progress_payload(progress, read_only=permissions["readOnly"])
        if progress
        else _empty_progress(read_only=permissions["readOnly"])
    )
    return {
        "questionId": question_id,
        "bankId": question.bank_id,
        "versionState": "mismatch" if mismatch else "current",
        "currentQuestion": question_snapshot.payload,
        "historyQuestion": history_question.payload if history_question else None,
        "library": _library_payload(bound_library),
        "currentLibrary": _library_payload(library_snapshot),
        "progress": graph,
        "progressRevision": int(progress.revision or 0) if progress else 0,
        "permissions": permissions,
        "nodeLimit": await _node_limit(db, user),
    }


async def _current_snapshots(
    db: AsyncSession,
    user: User,
    question_id: str,
) -> tuple[Question, RecallQuestionSnapshot, RecallLibrarySnapshot]:
    question = await _visible_question(db, user, question_id)
    question_snapshot, _ = await _ensure_question_snapshot(db, question)
    library_snapshot, _ = await _ensure_library_snapshot(
        db,
        await _question_subject(db, question),
    )
    return question, question_snapshot, library_snapshot


async def save_progress(
    db: AsyncSession,
    user: User,
    question_id: str,
    request: RecallProgressSaveRequest,
) -> dict[str, Any]:
    permissions = _permissions(user)
    if not permissions["canWrite"]:
        raise _error(403, "deep_recall_read_only", "当前账号只能查看深度回忆")
    question, question_snapshot, library_snapshot = await _current_snapshots(
        db, user, question_id
    )
    if request.question_revision != question_snapshot.question_revision:
        raise _error(409, "question_revision_mismatch", "题目版本已更新，请重新载入")
    if request.library_hash != library_snapshot.content_hash:
        raise _error(409, "library_snapshot_mismatch", "正式联想库已更新，请重新载入")

    limit = await _node_limit(db, user)
    if limit is not None and len(request.nodes) > limit:
        raise _error(
            422,
            "recall_node_limit",
            f"当前套餐每题最多保存 {limit} 个回忆节点",
            limit=limit,
        )

    progress = (
        await db.execute(
            select(RecallProgress)
            .where(
                RecallProgress.owner_id == user.username,
                RecallProgress.question_id == question_id,
            )
            .with_for_update()
        )
    ).scalar_one_or_none()
    current_revision = int(progress.revision or 0) if progress else 0
    if request.expected_revision != current_revision:
        raise _error(
            409,
            "recall_revision_conflict",
            "深度回忆已在其他页面更新，请重新载入",
            currentRevision=current_revision,
        )

    if progress is None:
        progress = RecallProgress(owner_id=user.username, question_id=question_id)
        db.add(progress)
    progress.bank_id = question.bank_id
    progress.source_question_revision = question_snapshot.question_revision
    progress.source_content_hash = question_snapshot.content_hash
    progress.recall_library_hash = library_snapshot.content_hash
    progress.graph_schema_version = request.graph_schema_version
    progress.nodes = request.nodes
    progress.edges = request.edges
    progress.custom_nodes = request.custom_nodes
    progress.active_keywords = request.active_keywords
    progress.choice_offsets = request.choice_offsets
    progress.transform = request.transform.model_dump()
    progress.metrics = request.metrics
    progress.revision = current_revision + 1
    await db.commit()
    await db.refresh(progress)
    return progress_payload(progress)


async def reset_progress(
    db: AsyncSession,
    user: User,
    question_id: str,
    request: RecallProgressResetRequest,
) -> dict[str, Any]:
    permissions = _permissions(user)
    if not permissions["canReset"]:
        raise _error(403, "deep_recall_read_only", "当前账号不能重置深度回忆")
    question, question_snapshot, library_snapshot = await _current_snapshots(
        db, user, question_id
    )
    if request.target_question_revision != question_snapshot.question_revision:
        raise _error(409, "question_revision_mismatch", "目标题目版本不是当前版本")
    progress = (
        await db.execute(
            select(RecallProgress)
            .where(
                RecallProgress.owner_id == user.username,
                RecallProgress.question_id == question_id,
            )
            .with_for_update()
        )
    ).scalar_one_or_none()
    current_revision = int(progress.revision or 0) if progress else 0
    if request.expected_revision != current_revision:
        raise _error(
            409,
            "recall_revision_conflict",
            "深度回忆已在其他页面更新，请重新载入",
            currentRevision=current_revision,
        )
    if progress is None:
        progress = RecallProgress(owner_id=user.username, question_id=question_id)
        db.add(progress)
    progress.bank_id = question.bank_id
    progress.source_question_revision = question_snapshot.question_revision
    progress.source_content_hash = question_snapshot.content_hash
    progress.recall_library_hash = library_snapshot.content_hash
    progress.graph_schema_version = 3
    progress.nodes = []
    progress.edges = []
    progress.custom_nodes = {}
    progress.active_keywords = []
    progress.choice_offsets = {}
    progress.transform = dict(DEFAULT_TRANSFORM)
    progress.metrics = {}
    progress.revision = current_revision + 1
    await db.commit()
    await db.refresh(progress)
    return progress_payload(progress)


async def get_library(
    db: AsyncSession,
    user: User,
    subject: str,
) -> dict[str, Any]:
    if not can(user.role, "useDeepRecall"):
        raise _error(403, "deep_recall_permission_denied", "当前账号无权读取正式联想库")
    snapshot, created = await _ensure_library_snapshot(db, subject)
    if created:
        await db.commit()
        await db.refresh(snapshot)
    return _library_payload(snapshot)
