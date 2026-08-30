"""课程草稿、发布版本与学习任务的 owner 隔离事务服务。"""

from __future__ import annotations

from copy import deepcopy
from dataclasses import dataclass
import hashlib
import json
from typing import Any

from sqlalchemy import delete, func, select, update
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.security import now_utc, uid
from app.models.course_management import CourseDraft, CourseRelease, LearningTask
from app.models.user import User
from app.services import teaching_content_revision_service


@dataclass(slots=True)
class CourseManagementError(Exception):
    status_code: int
    code: str
    message: str
    current_revision: int | None = None


def not_found(entity: str) -> CourseManagementError:
    return CourseManagementError(404, f"{entity.upper()}_NOT_FOUND", f"{entity} 不存在或无权访问")


def _conflict(entity: str, current_revision: int) -> CourseManagementError:
    return CourseManagementError(
        409,
        "REVISION_CONFLICT",
        f"{entity} 已被其他请求更新，请刷新后重试",
        current_revision=current_revision,
    )


def _timestamp(value) -> str | None:
    return value.isoformat() if value else None


async def _begin_write(db: AsyncSession) -> None:
    """Join the global teaching-content writer lock before domain rows."""

    await teaching_content_revision_service.acquire_lock(db)


async def _bump_content_revision(
    db: AsyncSession,
    actor: User,
    changes: list[dict[str, str]],
) -> None:
    await teaching_content_revision_service.bump(db, actor.username, changes)


def draft_to_dict(draft: CourseDraft) -> dict[str, Any]:
    return {
        "id": draft.id,
        "ownerId": draft.owner_id,
        "name": draft.name,
        "structure": deepcopy(draft.structure or {}),
        "revision": draft.revision,
        "status": draft.status,
        "createdBy": draft.created_by,
        "updatedBy": draft.updated_by,
        "createdAt": _timestamp(draft.created_at),
        "updatedAt": _timestamp(draft.updated_at),
    }


def release_to_dict(release: CourseRelease) -> dict[str, Any]:
    return {
        "id": release.id,
        "ownerId": release.owner_id,
        "courseId": release.course_id,
        "sourceDraftId": release.source_draft_id,
        "sourceDraftRevision": release.source_draft_revision,
        "version": release.version,
        "status": release.status,
        "revision": release.revision,
        "notes": release.notes,
        "contentHash": release.content_hash,
        "course": deepcopy(release.course_snapshot or {}),
        "publishedBy": release.published_by,
        "publishedAt": _timestamp(release.published_at),
        "withdrawnBy": release.withdrawn_by,
        "withdrawnAt": _timestamp(release.withdrawn_at),
        "updatedAt": _timestamp(release.updated_at),
    }


def task_to_dict(task: LearningTask) -> dict[str, Any]:
    return {
        "id": task.id,
        "ownerId": task.owner_id,
        "releaseId": task.release_id,
        "title": task.title,
        "description": task.description,
        "audience": deepcopy(task.audience or {}),
        "content": deepcopy(task.content or {}),
        "status": task.status,
        "revision": task.revision,
        "createdBy": task.created_by,
        "updatedBy": task.updated_by,
        "createdAt": _timestamp(task.created_at),
        "updatedAt": _timestamp(task.updated_at),
    }


async def list_drafts(db: AsyncSession, actor: User) -> list[CourseDraft]:
    return list(
        (
            await db.scalars(
                select(CourseDraft)
                .where(CourseDraft.owner_id == actor.username)
                .order_by(CourseDraft.updated_at.desc(), CourseDraft.id)
            )
        ).all()
    )


async def get_draft(db: AsyncSession, actor: User, draft_id: str) -> CourseDraft | None:
    return await db.scalar(
        select(CourseDraft).where(
            CourseDraft.id == draft_id,
            CourseDraft.owner_id == actor.username,
        )
    )


async def create_draft(
    db: AsyncSession,
    actor: User,
    *,
    name: str,
    structure: dict[str, Any],
) -> CourseDraft:
    identifier = uid("course_")
    await _begin_write(db)
    draft = CourseDraft(
        id=identifier,
        owner_id=actor.username,
        name=name,
        structure=deepcopy(structure),
        revision=1,
        status="draft",
        created_by=actor.username,
        updated_by=actor.username,
    )
    db.add(draft)
    await _bump_content_revision(
        db,
        actor,
        [{"entityType": "courseDraft", "entityId": identifier, "action": "created"}],
    )
    await db.commit()
    await db.refresh(draft)
    return draft


async def _current_draft_or_error(
    db: AsyncSession, actor: User, draft_id: str
) -> CourseDraft:
    current = await get_draft(db, actor, draft_id)
    if current is None:
        raise not_found("draft")
    raise _conflict("draft", current.revision)


async def update_draft(
    db: AsyncSession,
    actor: User,
    draft_id: str,
    *,
    expected_revision: int,
    changes: dict[str, Any],
) -> CourseDraft:
    await _begin_write(db)
    values = {**changes, "updated_by": actor.username, "updated_at": now_utc()}
    statement = (
        update(CourseDraft)
        .where(
            CourseDraft.id == draft_id,
            CourseDraft.owner_id == actor.username,
            CourseDraft.revision == expected_revision,
        )
        .values(**values, revision=CourseDraft.revision + 1)
        .returning(CourseDraft.id)
    )
    if await db.scalar(statement) is None:
        await _current_draft_or_error(db, actor, draft_id)
    action = "archived" if changes.get("status") == "archived" else "updated"
    await _bump_content_revision(
        db,
        actor,
        [{"entityType": "courseDraft", "entityId": draft_id, "action": action}],
    )
    await db.commit()
    draft = await get_draft(db, actor, draft_id)
    assert draft is not None
    await db.refresh(draft)
    return draft


async def delete_draft(
    db: AsyncSession, actor: User, draft_id: str, *, expected_revision: int
) -> str:
    await _begin_write(db)
    deleted_id = await db.scalar(
        delete(CourseDraft)
        .where(
            CourseDraft.id == draft_id,
            CourseDraft.owner_id == actor.username,
            CourseDraft.revision == expected_revision,
        )
        .returning(CourseDraft.id)
    )
    if deleted_id is None:
        await _current_draft_or_error(db, actor, draft_id)
    await _bump_content_revision(
        db,
        actor,
        [{"entityType": "courseDraft", "entityId": draft_id, "action": "deleted"}],
    )
    await db.commit()
    return str(deleted_id)


async def publish_draft(
    db: AsyncSession,
    actor: User,
    draft_id: str,
    *,
    expected_revision: int,
    notes: str,
) -> tuple[CourseRelease, CourseDraft]:
    await _begin_write(db)
    draft = await db.scalar(
        select(CourseDraft)
        .where(
            CourseDraft.id == draft_id,
            CourseDraft.owner_id == actor.username,
        )
        .with_for_update()
    )
    if draft is None:
        raise not_found("draft")
    if draft.revision != expected_revision:
        raise _conflict("draft", draft.revision)

    latest_version = await db.scalar(
        select(func.max(CourseRelease.version)).where(
            CourseRelease.owner_id == actor.username,
            CourseRelease.course_id == draft.id,
        )
    )
    version = int(latest_version or 0) + 1
    now = now_utc()
    await db.execute(
        update(CourseRelease)
        .where(
            CourseRelease.owner_id == actor.username,
            CourseRelease.course_id == draft.id,
            CourseRelease.status == "published",
        )
        .values(
            status="superseded",
            revision=CourseRelease.revision + 1,
            updated_at=now,
        )
    )

    snapshot = deepcopy(draft.structure or {})
    snapshot.update(
        {
            "id": draft.id,
            "name": draft.name,
            "status": "published",
            "version": version,
        }
    )
    canonical = json.dumps(
        snapshot, ensure_ascii=False, sort_keys=True, separators=(",", ":")
    ).encode()
    release = CourseRelease(
        id=uid("course_release_"),
        owner_id=actor.username,
        course_id=draft.id,
        source_draft_id=draft.id,
        source_draft_revision=draft.revision,
        version=version,
        status="published",
        course_snapshot=snapshot,
        notes=notes,
        content_hash=hashlib.sha256(canonical).hexdigest(),
        revision=1,
        published_by=actor.username,
        published_at=now,
        updated_at=now,
    )
    db.add(release)
    draft.revision += 1
    draft.updated_by = actor.username
    draft.updated_at = now
    await db.flush()
    await _bump_content_revision(
        db,
        actor,
        [
            {
                "entityType": "courseDraft",
                "entityId": draft.id,
                "action": "published",
            },
            {
                "entityType": "courseRelease",
                "entityId": release.id,
                "action": "created",
            },
        ],
    )
    await db.commit()
    await db.refresh(release)
    await db.refresh(draft)
    return release, draft


async def list_releases(db: AsyncSession, actor: User) -> list[CourseRelease]:
    return list(
        (
            await db.scalars(
                select(CourseRelease)
                .where(CourseRelease.owner_id == actor.username)
                .order_by(
                    CourseRelease.published_at.desc(),
                    CourseRelease.version.desc(),
                    CourseRelease.id,
                )
            )
        ).all()
    )


async def get_release(
    db: AsyncSession, actor: User, release_id: str
) -> CourseRelease | None:
    return await db.scalar(
        select(CourseRelease).where(
            CourseRelease.id == release_id,
            CourseRelease.owner_id == actor.username,
        )
    )


async def withdraw_release(
    db: AsyncSession,
    actor: User,
    release_id: str,
    *,
    expected_revision: int,
) -> CourseRelease:
    await _begin_write(db)
    now = now_utc()
    changed_id = await db.scalar(
        update(CourseRelease)
        .where(
            CourseRelease.id == release_id,
            CourseRelease.owner_id == actor.username,
            CourseRelease.revision == expected_revision,
            CourseRelease.status == "published",
        )
        .values(
            status="withdrawn",
            revision=CourseRelease.revision + 1,
            withdrawn_by=actor.username,
            withdrawn_at=now,
            updated_at=now,
        )
        .returning(CourseRelease.id)
    )
    if changed_id is None:
        current = await get_release(db, actor, release_id)
        if current is None:
            raise not_found("release")
        raise _conflict("release", current.revision)
    await _bump_content_revision(
        db,
        actor,
        [
            {
                "entityType": "courseRelease",
                "entityId": release_id,
                "action": "withdrawn",
            }
        ],
    )
    await db.commit()
    release = await get_release(db, actor, release_id)
    assert release is not None
    await db.refresh(release)
    return release


async def list_tasks(db: AsyncSession, actor: User) -> list[LearningTask]:
    return list(
        (
            await db.scalars(
                select(LearningTask)
                .where(LearningTask.owner_id == actor.username)
                .order_by(LearningTask.updated_at.desc(), LearningTask.id)
            )
        ).all()
    )


async def get_task(db: AsyncSession, actor: User, task_id: str) -> LearningTask | None:
    return await db.scalar(
        select(LearningTask).where(
            LearningTask.id == task_id,
            LearningTask.owner_id == actor.username,
        )
    )


async def _require_owned_release(
    db: AsyncSession, actor: User, release_id: str
) -> CourseRelease:
    release = await get_release(db, actor, release_id)
    if release is None:
        raise not_found("release")
    return release


async def create_task(
    db: AsyncSession,
    actor: User,
    *,
    release_id: str,
    title: str,
    description: str,
    audience: dict[str, Any],
    content: dict[str, Any],
    status: str,
) -> LearningTask:
    await _begin_write(db)
    await _require_owned_release(db, actor, release_id)
    identifier = uid("learning_task_")
    task = LearningTask(
        id=identifier,
        owner_id=actor.username,
        release_id=release_id,
        title=title,
        description=description,
        audience=deepcopy(audience),
        content=deepcopy(content),
        status=status,
        revision=1,
        created_by=actor.username,
        updated_by=actor.username,
    )
    db.add(task)
    await _bump_content_revision(
        db,
        actor,
        [{"entityType": "learningTask", "entityId": identifier, "action": "created"}],
    )
    await db.commit()
    await db.refresh(task)
    return task


async def _current_task_or_error(
    db: AsyncSession, actor: User, task_id: str
) -> LearningTask:
    current = await get_task(db, actor, task_id)
    if current is None:
        raise not_found("task")
    raise _conflict("task", current.revision)


async def update_task(
    db: AsyncSession,
    actor: User,
    task_id: str,
    *,
    expected_revision: int,
    changes: dict[str, Any],
) -> LearningTask:
    await _begin_write(db)
    if "release_id" in changes:
        await _require_owned_release(db, actor, str(changes["release_id"]))
    values = {**changes, "updated_by": actor.username, "updated_at": now_utc()}
    changed_id = await db.scalar(
        update(LearningTask)
        .where(
            LearningTask.id == task_id,
            LearningTask.owner_id == actor.username,
            LearningTask.revision == expected_revision,
        )
        .values(**values, revision=LearningTask.revision + 1)
        .returning(LearningTask.id)
    )
    if changed_id is None:
        await _current_task_or_error(db, actor, task_id)
    action = "archived" if changes.get("status") == "archived" else "updated"
    await _bump_content_revision(
        db,
        actor,
        [{"entityType": "learningTask", "entityId": task_id, "action": action}],
    )
    await db.commit()
    task = await get_task(db, actor, task_id)
    assert task is not None
    await db.refresh(task)
    return task


async def delete_task(
    db: AsyncSession, actor: User, task_id: str, *, expected_revision: int
) -> str:
    await _begin_write(db)
    deleted_id = await db.scalar(
        delete(LearningTask)
        .where(
            LearningTask.id == task_id,
            LearningTask.owner_id == actor.username,
            LearningTask.revision == expected_revision,
        )
        .returning(LearningTask.id)
    )
    if deleted_id is None:
        await _current_task_or_error(db, actor, task_id)
    await _bump_content_revision(
        db,
        actor,
        [{"entityType": "learningTask", "entityId": task_id, "action": "deleted"}],
    )
    await db.commit()
    return str(deleted_id)
