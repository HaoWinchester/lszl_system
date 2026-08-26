"""发布试卷冻结版本的事务、目录和按版本取题服务。"""

from __future__ import annotations

import json
from typing import Any

from fastapi import HTTPException
from sqlalchemy import String, cast, func, or_, select, update
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.security import now_utc, uid
from app.models.paper_release import PaperRelease, PaperReleaseQuestion
from app.models.question import ExamPaper, PaperQuestion, Question
from app.models.subscription import Subscription
from app.models.user import User
from app.services import (
    paper_service,
    practice_scoring_service,
    question_catalog_service,
    subscription_service,
    teaching_content_revision_service,
)


ACTIVE_STATUS = "published"
MAX_QUESTIONS_RESPONSE_BYTES = 950_000
MAX_RELEASE_METADATA_BYTES = 64_000
MEMBER_ACCESS_LEVELS = frozenset({"member", "vip", "paid", "premium"})
VALID_MODES = frozenset({
    "practice_mode", "deep_recall", "multi_question_canvas", "single_deep_study"
})
MODE_ALIASES = {
    "practice": "practice_mode",
    "recall": "deep_recall",
    "deep-recall": "deep_recall",
    "multi_question": "multi_question_canvas",
    "multi-question": "multi_question_canvas",
    "canvas": "multi_question_canvas",
    "single_deep": "single_deep_study",
    "single-deep": "single_deep_study",
}
VALID_ROLES = frozenset({"admin", "teacher", "student", "viewer"})


def _error(status: int, code: str, message: str) -> HTTPException:
    return HTTPException(status_code=status, detail={"code": code, "message": message})


def _snapshot_is_learnable(snapshot: dict) -> bool:
    """快照必须自带可学习内容（题干 + ≥2 选项 + 正确答案），摘要桩不算。"""
    if not isinstance(snapshot, dict) or snapshot.get("__paperSummaryOnly"):
        return False
    stem = "".join(
        str(part.get("text") or "") for part in (snapshot.get("stemParts") or [])
        if isinstance(part, dict)
    ) or str(snapshot.get("stem") or "")
    options = snapshot.get("options") or []
    has_answer = bool(snapshot.get("correctAnswer")) or any(
        isinstance(option, dict) and option.get("correct") for option in options
    )
    return bool(stem and len(options) >= 2 and has_answer)


async def _repair_release_snapshots(db: AsyncSession, canonical: dict) -> None:
    """发布载荷中的摘要桩快照直接用题库权威内容重建（2026-08-25 生产事故加固）。

    教师端发布时若浏览器未加载完整题目，前端会以 ref.summary 伪造
    __paperSummaryOnly 桩；服务端在此用 questions 表重建，缺失/已删除/
    本身不完整的题目才拒绝发布。
    """
    broken = [
        question for question in canonical["questions"]
        if not _snapshot_is_learnable(question["question"])
    ]
    if not broken:
        return
    issues: list[str] = []
    for question in broken:
        row = await db.get(Question, question["questionId"])
        if row is None or row.bank_id != question["bankId"]:
            issues.append(f"第 {question['order']} 题（{question['questionId']}）在题库中不存在")
            continue
        if (row.lifecycle or {}).get("status") == "deleted":
            issues.append(f"第 {question['order']} 题（{question['questionId']}）已被安全删除")
            continue
        payload = question_catalog_service.question_to_payload(row)
        if not _snapshot_is_learnable(payload):
            issues.append(f"第 {question['order']} 题（{question['questionId']}）缺少题干、选项或正确答案")
            continue
        question["question"] = payload
    if issues:
        preview = "；".join(issues[:5])
        suffix = f" 等 {len(issues)} 处问题" if len(issues) > 5 else ""
        raise _error(
            422,
            "RELEASE_SNAPSHOT_INCOMPLETE",
            f"试卷题目不完整，无法发布：{preview}{suffix}",
        )


def _normalize_modes(values: list[str]) -> list[str]:
    modes: list[str] = []
    for value in values:
        raw = str(value or "").strip()
        mode = raw if raw in VALID_MODES else MODE_ALIASES.get(raw, "")
        if not mode:
            raise _error(422, "INVALID_RELEASE_MODE", f"未知学习模式：{raw or '空值'}")
        if mode not in modes:
            modes.append(mode)
    if not modes:
        raise _error(422, "RELEASE_MODE_REQUIRED", "请至少选择一种学习模式")
    return modes


def _normalize_roles(values: list[str]) -> list[str]:
    roles = list(dict.fromkeys(str(value or "").strip().lower() for value in values))
    if not roles or any(role not in VALID_ROLES for role in roles):
        raise _error(422, "INVALID_ALLOWED_ROLES", "allowedRoles 必须包含有效角色")
    return roles


def _timestamp(value) -> int:
    return int(value.timestamp() * 1000) if value else 0


async def sync_active_release_name(
    db: AsyncSession,
    *,
    paper_id: str,
    name: str,
) -> int:
    """同步当前 active 发布版本的展示名称，历史版本保持冻结。"""
    result = await db.execute(
        update(PaperRelease)
        .where(PaperRelease.paper_id == paper_id, PaperRelease.status == ACTIVE_STATUS)
        .values(name=name)
    )
    return int(result.rowcount or 0)


async def sync_active_release_names_from_draft_payload(
    db: AsyncSession,
    raw_payload: str,
) -> list[str]:
    """Project saved draft names onto active catalog rows only.

    The release version and frozen question snapshots stay immutable. Invalid
    draft rows are ignored so an unrelated legacy row cannot make a valid save
    fail at the relational projection boundary.
    """
    try:
        rows = json.loads(raw_payload or "[]")
    except (TypeError, ValueError, json.JSONDecodeError):
        return []
    if not isinstance(rows, list):
        return []

    names: dict[str, str] = {}
    for row in rows:
        if not isinstance(row, dict):
            continue
        paper_id = str(row.get("id") or row.get("paperId") or "").strip()
        name = str(row.get("name") or row.get("title") or "").strip()
        if paper_id and name and len(name) <= 200:
            names[paper_id] = name
    if not names:
        return []

    releases = list((await db.execute(
        select(PaperRelease)
        .where(
            PaperRelease.paper_id.in_(names),
            PaperRelease.status == ACTIVE_STATUS,
        )
        .with_for_update()
    )).scalars().all())
    changed: list[str] = []
    for release in releases:
        name = names[release.paper_id]
        if release.name != name:
            release.name = name
            changed.append(release.id)
    return changed


def release_to_dict(release: PaperRelease, *, content_restricted: bool = False) -> dict:
    payload = {
        "id": release.id,
        "releaseId": release.id,
        "paperId": release.paper_id,
        "version": release.version,
        "status": release.status,
        "availability": release.status,
        "name": release.name,
        "title": release.name,
        "subject": release.subject,
        "description": release.description or "",
        "purpose": "learning",
        "publishedBy": release.publisher_id,
        "accessLevel": release.access_level,
        "accessPolicy": {"accessLevel": release.access_level},
        "enabledModes": release.enabled_modes or [],
        "modeConfigVersion": 2,
        "allowedRoles": release.allowed_roles or [],
        "metadata": release.release_metadata or {},
        "questionCount": release.question_count,
        "configuredCount": release.question_count,
        "totalCount": release.question_count,
        "publishedAt": _timestamp(release.published_at),
        "publishedAtIso": release.published_at.isoformat() if release.published_at else None,
        "updatedAt": _timestamp(release.published_at),
        "withdrawnAt": _timestamp(release.withdrawn_at),
        "withdrawnAtIso": release.withdrawn_at.isoformat() if release.withdrawn_at else None,
    }
    if content_restricted:
        payload["contentRestricted"] = True
    return payload


async def entitlement_for_request(db: AsyncSession, user: User) -> bool:
    if user.role in {"admin", "teacher"}:
        return True
    subscription = await db.get(Subscription, user.username) if user.role == "student" else None
    return bool(subscription_service.entitlements_for(user.role, subscription).get("allExamPapers"))


def can_access_with_entitlement(user: User, release: PaperRelease, entitled: bool) -> bool:
    roles = {str(role).strip() for role in (release.allowed_roles or []) if str(role).strip()}
    if roles and user.role not in roles:
        return False
    return str(release.access_level).casefold() not in MEMBER_ACCESS_LEVELS or entitled


async def can_access(db: AsyncSession, user: User, release: PaperRelease) -> bool:
    return can_access_with_entitlement(user, release, await entitlement_for_request(db, user))


async def publish(
    db: AsyncSession,
    actor: User,
    paper_id: str,
    *,
    expected_revision: object,
    access_level: str,
    enabled_modes: list[str],
    allowed_roles: list[str],
    metadata: dict,
) -> PaperRelease:
    modes = _normalize_modes(enabled_modes)
    roles = _normalize_roles(allowed_roles)
    metadata = practice_scoring_service.freeze_release_metadata(metadata)
    if len(json.dumps(metadata, ensure_ascii=False, separators=(",", ":")).encode()) > MAX_RELEASE_METADATA_BYTES:
        raise _error(422, "RELEASE_METADATA_TOO_LARGE", "发布版本 metadata 不能超过 64KB")
    if actor.role not in {"admin", "teacher"}:
        raise _error(404, "PAPER_NOT_FOUND", "试卷不存在或无权发布")
    revision = paper_service.require_revision(expected_revision)
    await teaching_content_revision_service.acquire_lock(db)
    paper = (
        await db.execute(
            select(ExamPaper).where(
                ExamPaper.id == paper_id,
                ExamPaper.deleted_at.is_(None),
                ExamPaper.revision == revision,
            ).with_for_update()
        )
    ).scalar_one_or_none()
    if paper is None:
        current = await db.get(ExamPaper, paper_id)
        if current is None or current.deleted_at is not None:
            raise _error(404, "PAPER_NOT_FOUND", "试卷不存在或无权发布")
        raise _error(409, "REVISION_CONFLICT", "试卷已被其他用户更新，请刷新后重试")

    rows = (
        await db.execute(
            select(Question, PaperQuestion.order_index)
            .join(PaperQuestion, PaperQuestion.question_id == Question.id)
            .where(PaperQuestion.paper_id == paper_id)
            .order_by(PaperQuestion.order_index, Question.id)
        )
    ).all()
    if not rows:
        raise _error(422, "EMPTY_PAPER_RELEASE", "试卷至少需要一道题目")

    latest = await db.scalar(select(func.max(PaperRelease.version)).where(PaperRelease.paper_id == paper_id))
    release_id = uid("pr_")
    release_version = int(latest or 0) + 1
    released_at = now_utc()
    await db.execute(
        update(PaperRelease)
        .where(PaperRelease.paper_id == paper_id, PaperRelease.status == ACTIVE_STATUS)
        .values(status="superseded")
    )
    release = PaperRelease(
        id=release_id,
        paper_id=paper.id,
        version=release_version,
        status=ACTIVE_STATUS,
        name=paper.name,
        subject=paper.subject,
        description=paper.description,
        publisher_id=actor.username,
        access_level=access_level,
        enabled_modes=modes,
        allowed_roles=roles,
        release_metadata=metadata,
        question_count=len(rows),
        published_at=released_at,
    )
    db.add(release)
    await db.flush()
    updated_id = await paper_service.cas_paper_mutation(
        db,
        actor,
        paper_id,
        expected_revision,
        {
            "status": "published",
            "published_at": released_at,
            "published_release_id": release.id,
            "published_version": release_version,
        },
    )
    if updated_id is None:
        raise _error(404, "PAPER_NOT_FOUND", "试卷不存在")
    for question, order_index in rows:
        db.add(PaperReleaseQuestion(
            release_id=release.id,
            order_index=order_index,
            bank_id=question.bank_id,
            question_id=question.id,
            snapshot=question_catalog_service.question_to_payload(question),
        ))
    await teaching_content_revision_service.bump(
        db, actor.username, [{"entityType": "paper", "entityId": paper_id, "action": "published"}]
    )
    await db.commit()
    await db.refresh(release)
    return release


async def withdraw(
    db: AsyncSession,
    actor: User,
    release_id: str,
    *,
    expected_revision: object,
) -> PaperRelease | None:
    revision = paper_service.require_revision(expected_revision)
    await teaching_content_revision_service.acquire_lock(db)
    release = (
        await db.execute(
            select(PaperRelease)
            .join(ExamPaper, ExamPaper.id == PaperRelease.paper_id)
            .where(
                PaperRelease.id == release_id,
                ExamPaper.revision == revision,
            )
            .with_for_update()
        )
    ).scalar_one_or_none()
    if release is None:
        existing = await db.get(PaperRelease, release_id)
        if existing is None:
            return None
        raise _error(409, "REVISION_CONFLICT", "试卷已被其他用户更新，请刷新后重试")
    if release.status != ACTIVE_STATUS:
        raise _error(409, "RELEASE_NOT_ACTIVE", "发布版本已撤回或已被新版本替代")
    released_at = now_utc()
    updated_id = await paper_service.cas_paper_mutation(
        db,
        actor,
        release.paper_id,
        expected_revision,
        {"status": "draft", "published_at": None, "withdrawn_at": released_at},
    )
    if updated_id is None:
        return None
    release.status = "withdrawn"
    release.withdrawn_at = released_at
    release.withdrawn_by = actor.username
    await teaching_content_revision_service.bump(
        db,
        actor.username,
        [{"entityType": "paper", "entityId": release.paper_id, "action": "unpublished"}],
    )
    await db.commit()
    await db.refresh(release)
    return release


async def history(
    db: AsyncSession,
    actor: User,
    paper_id: str,
    *,
    page: int,
    page_size: int,
) -> dict:
    paper = await db.get(ExamPaper, paper_id)
    if paper is None or (actor.role not in {"admin", "teacher"}):
        return {"releases": [], "page": page, "pageSize": page_size, "total": 0}
    base = select(PaperRelease).where(PaperRelease.paper_id == paper_id)
    total = int(await db.scalar(select(func.count()).select_from(base.subquery())) or 0)
    releases = list((await db.execute(
        base.order_by(PaperRelease.version.desc())
        .limit(page_size)
        .offset((page - 1) * page_size)
    )).scalars().all())
    return {"releases": releases, "page": page, "pageSize": page_size, "total": total}


async def catalog(db: AsyncSession, user: User, *, page: int, page_size: int) -> dict:
    entitled = await entitlement_for_request(db, user)
    # allowed_roles 为空数组表示不限制角色（与 can_access_with_entitlement 语义一致）
    role_filter = or_(
        func.jsonb_array_length(PaperRelease.allowed_roles) == 0,
        PaperRelease.allowed_roles.contains([user.role]),
    )
    base = select(PaperRelease).where(PaperRelease.status == ACTIVE_STATUS, role_filter)
    total = int(await db.scalar(select(func.count()).select_from(base.subquery())) or 0)
    releases = (await db.execute(
        base.order_by(PaperRelease.published_at.desc(), PaperRelease.id)
        .limit(page_size).offset((page - 1) * page_size)
    )).scalars().all()
    return {
        "releases": [
            release_to_dict(item, content_restricted=not can_access_with_entitlement(user, item, entitled))
            for item in releases
        ],
        "page": page,
        "pageSize": page_size,
        "total": total,
    }


async def management_catalog(
    db: AsyncSession,
    actor: User,
    *,
    page: int,
    page_size: int,
) -> dict:
    """Return active releases as lightweight editable-paper projections.

    The management page needs ordered question references, but not the frozen
    question snapshots used by learners. Keeping snapshots out of this response
    avoids restoring the retired multi-megabyte runtime bootstrap payload.
    """
    if actor.role not in {"admin", "teacher"}:
        raise _error(403, "MANAGE_PAPERS_FORBIDDEN", "仅教师或管理员可以管理试卷")
    base = select(PaperRelease).where(PaperRelease.status == ACTIVE_STATUS)
    total = int(await db.scalar(select(func.count()).select_from(base.subquery())) or 0)
    releases = list((await db.execute(
        base.order_by(PaperRelease.published_at.desc(), PaperRelease.id)
        .limit(page_size)
        .offset((page - 1) * page_size)
    )).scalars().all())
    release_ids = [release.id for release in releases]
    question_rows = list((await db.execute(
        select(PaperReleaseQuestion)
        .where(PaperReleaseQuestion.release_id.in_(release_ids))
        .order_by(PaperReleaseQuestion.release_id, PaperReleaseQuestion.order_index)
    )).scalars().all()) if release_ids else []
    refs_by_release: dict[str, list[dict[str, Any]]] = {release_id: [] for release_id in release_ids}
    for row in question_rows:
        refs_by_release[row.release_id].append({
            "bankId": row.bank_id,
            "questionId": row.question_id,
            "order": row.order_index + 1,
            "score": 1,
        })
    papers = []
    for release in releases:
        payload = release_to_dict(release)
        source = release.source_payload if isinstance(release.source_payload, dict) else {}
        payload.update({
            "id": release.paper_id,
            "publishedVersion": release.version,
            "publishedReleaseId": release.id,
            "categoryId": str(source.get("categoryId") or ""),
            "categoryName": str(source.get("categoryName") or ""),
            "questions": refs_by_release.get(release.id, []),
        })
        papers.append(payload)
    return {"papers": papers, "page": page, "pageSize": page_size, "total": total}


async def detail(db: AsyncSession, user: User, release_id: str) -> dict | None:
    release = await db.get(PaperRelease, release_id)
    if release is None or release.status not in {ACTIVE_STATUS, "superseded"}:
        return None
    entitled = await entitlement_for_request(db, user)
    if not can_access_with_entitlement(user, release, entitled) and user.role not in (release.allowed_roles or []):
        return None
    return release_to_dict(release, content_restricted=not can_access_with_entitlement(user, release, entitled))


async def questions(
    db: AsyncSession,
    user: User,
    release_id: str,
    *,
    limit: int,
    offset: int,
    seed: str | None = None,
) -> dict | None:
    release = await db.get(PaperRelease, release_id)
    if release is None:
        return None
    if release.status not in {ACTIVE_STATUS, "superseded"}:
        return None
    entitled = await entitlement_for_request(db, user)
    if not can_access_with_entitlement(user, release, entitled):
        return None

    query = select(PaperReleaseQuestion).where(PaperReleaseQuestion.release_id == release_id)
    total = int(await db.scalar(
        select(func.count()).select_from(PaperReleaseQuestion).where(PaperReleaseQuestion.release_id == release_id)
    ) or 0)
    if seed is None:
        query = query.order_by(PaperReleaseQuestion.order_index)
    else:
        stable_key = func.md5(
            release_id + ":" + seed + ":" + cast(PaperReleaseQuestion.order_index, String)
        )
        query = query.order_by(stable_key, PaperReleaseQuestion.order_index)
    rows = (await db.execute(query.limit(limit).offset(offset))).scalars().all()
    question_payloads = []
    response_truncated = False
    response_bytes = len(json.dumps(release_to_dict(release), ensure_ascii=False).encode()) + 256
    for row in rows:
        item = {
            "releaseId": row.release_id,
            "orderIndex": row.order_index,
            "order": row.order_index + 1,
            "bankId": row.bank_id,
            "questionId": row.question_id,
            "question": row.snapshot,
        }
        item_bytes = len(json.dumps(item, ensure_ascii=False, separators=(",", ":")).encode())
        if response_bytes + item_bytes > MAX_QUESTIONS_RESPONSE_BYTES:
            if not question_payloads:
                raise _error(413, "RELEASE_QUESTION_TOO_LARGE", "单题快照过大，无法在 1MB 响应限制内返回")
            response_truncated = True
            break
        question_payloads.append(item)
        response_bytes += item_bytes
    return {
        "release": release_to_dict(release),
        "total": total,
        "limit": limit,
        "offset": offset,
        "responseTruncated": response_truncated,
        "consumed": len(question_payloads),
        "nextOffset": offset + len(question_payloads),
        "questions": question_payloads,
    }


async def publish_from_payload(db: AsyncSession, actor: User, payload: dict) -> PaperRelease:
    """教师发布入口：接受前端构建的完整发布载荷（题目引用 + 冻结快照）。

    与迁移共用同一套归一化校验；发布者以当前登录账号为准，
    同试卷旧的 active 版本自动 superseded。
    """
    from app.services import runtime_domain_migration_service

    if actor.role not in {"admin", "teacher"}:
        raise _error(403, "PUBLISH_FORBIDDEN", "仅教师或管理员可以发布试卷")
    try:
        canonical = runtime_domain_migration_service.normalize_release_payload(payload)
    except ValueError as exc:
        raise _error(422, "RELEASE_PAYLOAD_INVALID", str(exc)) from exc
    canonical["metadata"] = practice_scoring_service.freeze_release_metadata(
        canonical.get("metadata")
    )
    await _repair_release_snapshots(db, canonical)

    await teaching_content_revision_service.acquire_lock(db)
    release_id = canonical["releaseId"]
    if await db.get(PaperRelease, release_id) is not None:
        raise _error(409, "RELEASE_EXISTS", "该发布版本已存在，请刷新后重试")

    latest = await db.scalar(
        select(func.max(PaperRelease.version)).where(
            PaperRelease.paper_id == canonical["paperId"]
        )
    )
    assigned_version = int(latest or 0) + 1
    if canonical["version"] != assigned_version:
        release_id = uid("pr_")
    frozen_payload = dict(payload)
    frozen_payload.update({
        "id": release_id,
        "releaseId": release_id,
        "version": assigned_version,
        "metadata": canonical["metadata"],
    })

    # 先 supersede 同试卷旧 active 版本，避免触发"每试卷仅一个 active"部分唯一索引
    await db.execute(
        update(PaperRelease)
        .where(
            PaperRelease.paper_id == canonical["paperId"],
            PaperRelease.status == ACTIVE_STATUS,
            PaperRelease.id != release_id,
        )
        .values(status="superseded")
    )
    release = PaperRelease(
        id=release_id,
        paper_id=canonical["paperId"],
        version=assigned_version,
        status=ACTIVE_STATUS,
        name=canonical["name"],
        subject=canonical["subject"],
        description=canonical["description"],
        publisher_id=actor.username,
        access_level=canonical["accessLevel"],
        enabled_modes=canonical["enabledModes"],
        allowed_roles=canonical["allowedRoles"],
        release_metadata=canonical["metadata"],
        source_payload=frozen_payload,
        question_count=len(canonical["questions"]),
        published_at=now_utc(),
    )
    db.add(release)
    await db.flush()
    await paper_service.sync_published_projection(
        db,
        paper_id=release.paper_id,
        release_id=release.id,
        version=release.version,
        published_at=release.published_at,
        updated_by=actor.username,
    )
    for question in canonical["questions"]:
        db.add(PaperReleaseQuestion(
            release_id=release_id,
            order_index=question["order"] - 1,
            bank_id=question["bankId"],
            question_id=question["questionId"],
            snapshot=question["question"],
        ))
    await teaching_content_revision_service.bump(
        db,
        actor.username,
        [{"entityType": "paper", "entityId": release.paper_id, "action": "published"}],
    )
    await db.commit()
    await db.refresh(release)
    return release


async def reconcile_active_paper_projections(db: AsyncSession) -> int:
    """Repair editable-paper status from the authoritative active releases."""
    releases = list((await db.scalars(
        select(PaperRelease)
        .where(PaperRelease.status == ACTIVE_STATUS)
        .order_by(PaperRelease.paper_id, PaperRelease.version.desc())
    )).all())
    repaired = 0
    for release in releases:
        repaired += int(await paper_service.sync_published_projection(
            db,
            paper_id=release.paper_id,
            release_id=release.id,
            version=release.version,
            published_at=release.published_at,
            updated_by=release.publisher_id,
        ))
    await db.commit()
    return repaired


async def reconcile_withdrawn_projections(db: AsyncSession) -> int:
    """把仍标记 published 但已无 active 发布版本的试卷投影回草稿。

    旧版撤回只下架 release 不回写试卷状态，会留下"后台显示已发布、
    学生端却看不到"的脱节；这里以 release 目录为权威反向对账。
    """
    active_exists = select(PaperRelease.id).where(
        PaperRelease.paper_id == ExamPaper.id,
        PaperRelease.status == ACTIVE_STATUS,
    ).exists()
    papers = list((await db.scalars(
        select(ExamPaper).where(
            ExamPaper.status == "published",
            ExamPaper.deleted_at.is_(None),
            ~active_exists,
        )
    )).all())
    repaired = 0
    for paper in papers:
        latest = (await db.execute(
            select(PaperRelease)
            .where(PaperRelease.paper_id == paper.id)
            .order_by(PaperRelease.version.desc())
            .limit(1)
        )).scalar_one_or_none()
        repaired += int(await paper_service.sync_withdrawn_projection(
            db,
            paper_id=paper.id,
            withdrawn_at=(latest.withdrawn_at if latest is not None else None) or now_utc(),
            updated_by=(latest.withdrawn_by if latest is not None else "") or "system",
        ))
    await db.commit()
    return repaired


async def _orphan_active_releases(db: AsyncSession) -> list[PaperRelease]:
    """active 但缺少 exam_papers 行的发布版本（后台不可见的孤儿）。"""
    paper_exists = select(ExamPaper.id).where(ExamPaper.id == PaperRelease.paper_id).exists()
    return list((await db.scalars(
        select(PaperRelease)
        .where(PaperRelease.status == ACTIVE_STATUS, ~paper_exists)
        .order_by(PaperRelease.published_at, PaperRelease.id)
    )).all())


async def materialize_release_papers(db: AsyncSession, *, dry_run: bool = False) -> dict:
    """为孤儿 active 发布版本补建后台可见的题库、题目与试卷数据。

    迁移期只导入了发布快照（paper_releases），部分试卷的可编辑行从未落库。
    这里按发布快照反向物化：题库/题目从冻结快照恢复，试卷状态与 active
    发布版本对齐。幂等：已存在的行一律跳过。
    """
    from app.models.question import QuestionBank
    from app.services.published_paper_access_service import question_from_snapshot

    releases = await _orphan_active_releases(db)
    report: dict = {"releases": [], "materialized": 0, "dryRun": dry_run}
    if dry_run:
        report["releases"] = [
            {"releaseId": r.id, "paperId": r.paper_id, "name": r.name, "version": r.version}
            for r in releases
        ]
        return report

    await teaching_content_revision_service.acquire_lock(db)
    for release in releases:
        rows = list((await db.execute(
            select(PaperReleaseQuestion)
            .where(PaperReleaseQuestion.release_id == release.id)
            .order_by(PaperReleaseQuestion.order_index)
        )).scalars().all())
        owner = release.publisher_id
        if owner is None or (await db.get(User, owner)) is None:
            owner = "admin"
        banks: dict[str, QuestionBank] = {}
        for row in rows:
            snapshot = dict(row.snapshot or {})
            bank_id = str(snapshot.get("bankId") or row.bank_id or f"b_{release.paper_id}")
            bank = banks.get(bank_id)
            if bank is None:
                bank = await db.get(QuestionBank, bank_id)
                if bank is None:
                    bank = QuestionBank(
                        id=bank_id,
                        owner_id=owner,
                        name=f"{release.name}·题库",
                        subject=release.subject or "PMP",
                        version="1.0",
                        visibility="private",
                        created_by=owner,
                        updated_by=owner,
                    )
                    db.add(bank)
                    await db.flush()
                banks[bank_id] = bank
            if (await db.get(Question, row.question_id)) is not None:
                continue
            question = question_from_snapshot(snapshot)
            question.id = row.question_id
            question.bank_id = bank.id
            question.created_by = owner
            question.updated_by = owner
            db.add(question)
        paper = ExamPaper(
            id=release.paper_id,
            owner_id=owner,
            revision=1,
            created_by=owner,
            updated_by=owner,
            name=release.name,
            subject=release.subject or "PMP",
            description=release.description,
            total_count=len(rows),
            quotas={},
            access_policy={
                "accessLevel": "member"
                if str(release.access_level or "").lower() in MEMBER_ACCESS_LEVELS
                else "free"
            },
            enabled_modes=list(release.enabled_modes or []),
            import_metadata={"materializedFromRelease": release.id},
            status="published",
            published_release_id=release.id,
            published_version=release.version,
            published_at=release.published_at,
        )
        db.add(paper)
        await db.flush()
        for row in rows:
            db.add(PaperQuestion(
                paper_id=paper.id,
                question_id=row.question_id,
                order_index=row.order_index,
            ))
        report["releases"].append({
            "releaseId": release.id,
            "paperId": paper.id,
            "name": paper.name,
            "version": release.version,
            "questions": len(rows),
        })
        report["materialized"] += 1
    if report["materialized"]:
        await teaching_content_revision_service.bump(
            db,
            "admin",
            [
                {"entityType": "paper", "entityId": item["paperId"], "action": "materialized"}
                for item in report["releases"]
            ],
        )
    await db.commit()
    return report


async def withdraw_paper(db: AsyncSession, actor: User, paper_id: str) -> int:
    """教师撤回入口：下架该试卷全部 active 发布版本。"""
    if actor.role not in {"admin", "teacher"}:
        raise _error(403, "WITHDRAW_FORBIDDEN", "仅教师或管理员可以撤回试卷")
    await teaching_content_revision_service.acquire_lock(db)
    released_at = now_utc()
    result = await db.execute(
        update(PaperRelease)
        .where(PaperRelease.paper_id == paper_id, PaperRelease.status == ACTIVE_STATUS)
        .values(status="withdrawn", withdrawn_at=released_at, withdrawn_by=actor.username)
    )
    withdrawn = int(result.rowcount or 0)
    if withdrawn == 0:
        await db.commit()
        return 0
    await paper_service.sync_withdrawn_projection(
        db,
        paper_id=paper_id,
        withdrawn_at=released_at,
        updated_by=actor.username,
    )
    await teaching_content_revision_service.bump(
        db,
        actor.username,
        [{"entityType": "paper", "entityId": paper_id, "action": "unpublished"}],
    )
    await db.commit()
    return withdrawn
