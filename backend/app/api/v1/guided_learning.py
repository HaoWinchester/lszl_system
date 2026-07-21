"""引导式学习课程与进度 API。"""

from typing import Annotated

from fastapi import APIRouter, Depends, HTTPException, Query
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.auth import CurrentUser
from app.db.session import get_db
from app.services import guided_learning_service as service

router = APIRouter(prefix="/guided-learning", tags=["guided-learning"])
DB = Annotated[AsyncSession, Depends(get_db)]


@router.get("/courses/default")
async def default_course(db: DB):
    try:
        return await service.default_course_package(db)
    except (ValueError, service.CourseNotFoundError) as error:
        raise HTTPException(status_code=500, detail=str(error)) from error


@router.get("/courses/{course_id}/progress")
async def get_progress(
    course_id: str,
    db: DB,
    user: CurrentUser,
    preview: bool = Query(False),
):
    try:
        if preview:
            if user.role != "admin":
                raise HTTPException(status_code=403, detail="仅管理员可使用预览模式")
            return {"progress": await service.get_preview_progress(db, user.username, course_id), "revision": 0, "preview": True}
        progress, revision = await service.get_progress(db, user.username, course_id)
        return {"progress": progress, "revision": revision, "preview": False}
    except service.CourseNotFoundError as error:
        raise HTTPException(status_code=404, detail=str(error)) from error


@router.put("/courses/{course_id}/progress")
async def update_progress(course_id: str, body: dict, db: DB, user: CurrentUser):
    try:
        progress, revision = await service.update_progress(db, user.username, course_id, body)
        return {"progress": progress, "revision": revision}
    except service.CourseNotFoundError as error:
        raise HTTPException(status_code=404, detail=str(error)) from error
    except ValueError as error:
        raise HTTPException(status_code=409, detail=str(error)) from error


@router.post("/courses/{course_id}/nodes/{node_id}/complete")
async def complete_node(
    course_id: str,
    node_id: str,
    body: dict,
    db: DB,
    user: CurrentUser,
    preview: bool = Query(False),
):
    try:
        progress, revision = await service.complete_node(
            db, user.username, course_id, node_id, body, preview=preview
        )
        return {"progress": progress, "revision": revision}
    except service.CourseNotFoundError as error:
        raise HTTPException(status_code=404, detail=str(error)) from error
    except (service.LockedNodeError, service.PreviewWriteError) as error:
        raise HTTPException(status_code=409, detail=str(error)) from error


@router.post("/courses/{course_id}/parts/{part_id}/placement-attempt")
async def placement_attempt(
    course_id: str,
    part_id: str,
    body: dict,
    db: DB,
    user: CurrentUser,
    preview: bool = Query(False),
):
    try:
        progress, revision, result = await service.placement_attempt(
            db, user.username, course_id, part_id, body, preview=preview
        )
        return {"progress": progress, "revision": revision, "result": result}
    except service.CourseNotFoundError as error:
        raise HTTPException(status_code=404, detail=str(error)) from error
    except (service.LockedNodeError, service.PreviewWriteError) as error:
        raise HTTPException(status_code=409, detail=str(error)) from error
