"""关系化课程管理 API。"""

from typing import Annotated, NoReturn

from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.auth import require_permissions
from app.db.session import get_db
from app.models.user import User
from app.schemas.course_management import (
    CourseDraftCreate,
    CourseDraftUpdate,
    CoursePublishRequest,
    LearningTaskCreate,
    LearningTaskUpdate,
    RevisionRequest,
)
from app.services import course_management_service


router = APIRouter(prefix="/course-management", tags=["course-management"])
DB = Annotated[AsyncSession, Depends(get_db)]
Manager = Annotated[User, Depends(require_permissions("managePapers"))]
Publisher = Annotated[
    User, Depends(require_permissions("managePapers", "publishPapers"))
]


def _raise_domain(error: course_management_service.CourseManagementError) -> NoReturn:
    detail: dict[str, object] = {"code": error.code, "message": error.message}
    if error.current_revision is not None:
        detail["currentRevision"] = error.current_revision
    raise HTTPException(status_code=error.status_code, detail=detail)


@router.get("/drafts")
async def list_drafts(db: DB, user: Manager):
    drafts = await course_management_service.list_drafts(db, user)
    return {"drafts": [course_management_service.draft_to_dict(item) for item in drafts]}


@router.post("/drafts")
async def create_draft(body: CourseDraftCreate, db: DB, user: Manager):
    try:
        draft = await course_management_service.create_draft(
            db,
            user,
            name=body.name,
            structure=body.structure,
        )
    except course_management_service.CourseManagementError as error:
        _raise_domain(error)
    return {"draft": course_management_service.draft_to_dict(draft)}


@router.get("/drafts/{draft_id}")
async def get_draft(draft_id: str, db: DB, user: Manager):
    draft = await course_management_service.get_draft(db, user, draft_id)
    if draft is None:
        _raise_domain(course_management_service.not_found("draft"))
    return {"draft": course_management_service.draft_to_dict(draft)}


@router.put("/drafts/{draft_id}")
async def update_draft(
    draft_id: str, body: CourseDraftUpdate, db: DB, user: Manager
):
    changes = body.model_dump(exclude={"revision"}, exclude_unset=True)
    try:
        draft = await course_management_service.update_draft(
            db,
            user,
            draft_id,
            expected_revision=body.revision,
            changes=changes,
        )
    except course_management_service.CourseManagementError as error:
        _raise_domain(error)
    return {"draft": course_management_service.draft_to_dict(draft)}


@router.delete("/drafts/{draft_id}")
async def delete_draft(draft_id: str, body: RevisionRequest, db: DB, user: Manager):
    try:
        deleted_id = await course_management_service.delete_draft(
            db, user, draft_id, expected_revision=body.revision
        )
    except course_management_service.CourseManagementError as error:
        _raise_domain(error)
    return {"deletedId": deleted_id}


@router.post("/drafts/{draft_id}/publish")
async def publish_draft(
    draft_id: str, body: CoursePublishRequest, db: DB, user: Publisher
):
    try:
        release, draft = await course_management_service.publish_draft(
            db,
            user,
            draft_id,
            expected_revision=body.revision,
            notes=body.notes,
        )
    except course_management_service.CourseManagementError as error:
        _raise_domain(error)
    return {
        "release": course_management_service.release_to_dict(release),
        "draft": course_management_service.draft_to_dict(draft),
    }


@router.get("/releases")
async def list_releases(db: DB, user: Manager):
    releases = await course_management_service.list_releases(db, user)
    return {
        "releases": [
            course_management_service.release_to_dict(item) for item in releases
        ]
    }


@router.get("/releases/{release_id}")
async def get_release(release_id: str, db: DB, user: Manager):
    release = await course_management_service.get_release(db, user, release_id)
    if release is None:
        _raise_domain(course_management_service.not_found("release"))
    return {"release": course_management_service.release_to_dict(release)}


@router.post("/releases/{release_id}/withdraw")
async def withdraw_release(
    release_id: str, body: RevisionRequest, db: DB, user: Publisher
):
    try:
        release = await course_management_service.withdraw_release(
            db, user, release_id, expected_revision=body.revision
        )
    except course_management_service.CourseManagementError as error:
        _raise_domain(error)
    return {"release": course_management_service.release_to_dict(release)}


@router.get("/tasks")
async def list_tasks(db: DB, user: Manager):
    tasks = await course_management_service.list_tasks(db, user)
    return {"tasks": [course_management_service.task_to_dict(item) for item in tasks]}


@router.post("/tasks")
async def create_task(body: LearningTaskCreate, db: DB, user: Manager):
    try:
        task = await course_management_service.create_task(
            db,
            user,
            release_id=body.release_id,
            title=body.title,
            description=body.description,
            audience=body.audience,
            content=body.content,
            status=body.status,
        )
    except course_management_service.CourseManagementError as error:
        _raise_domain(error)
    return {"task": course_management_service.task_to_dict(task)}


@router.get("/tasks/{task_id}")
async def get_task(task_id: str, db: DB, user: Manager):
    task = await course_management_service.get_task(db, user, task_id)
    if task is None:
        _raise_domain(course_management_service.not_found("task"))
    return {"task": course_management_service.task_to_dict(task)}


@router.put("/tasks/{task_id}")
async def update_task(
    task_id: str, body: LearningTaskUpdate, db: DB, user: Manager
):
    changes = body.model_dump(exclude={"revision"}, exclude_unset=True)
    try:
        task = await course_management_service.update_task(
            db,
            user,
            task_id,
            expected_revision=body.revision,
            changes=changes,
        )
    except course_management_service.CourseManagementError as error:
        _raise_domain(error)
    return {"task": course_management_service.task_to_dict(task)}


@router.delete("/tasks/{task_id}")
async def delete_task(task_id: str, body: RevisionRequest, db: DB, user: Manager):
    try:
        deleted_id = await course_management_service.delete_task(
            db, user, task_id, expected_revision=body.revision
        )
    except course_management_service.CourseManagementError as error:
        _raise_domain(error)
    return {"deletedId": deleted_id}
