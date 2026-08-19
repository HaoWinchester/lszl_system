"""Authenticated user feedback and in-app message API."""

from typing import Annotated

from fastapi import APIRouter, Depends, HTTPException, Query, Response, status
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.auth import CurrentUser, require_role
from app.db.session import get_db
from app.models.user import User
from app.services import engagement_service as service

router = APIRouter(prefix="/engagement", tags=["engagement"])
DB = Annotated[AsyncSession, Depends(get_db)]
AdminUser = Annotated[User, Depends(require_role("admin"))]


def _raise(error: ValueError) -> None:
    if isinstance(error, service.EngagementNotFoundError):
        raise HTTPException(status_code=404, detail=str(error)) from error
    if isinstance(error, service.EngagementRateLimitError):
        raise HTTPException(status_code=429, detail=str(error)) from error
    raise HTTPException(status_code=422, detail=str(error)) from error


Limit = Annotated[int, Query(ge=1, le=service.MAX_PAGE_SIZE)]
Offset = Annotated[int, Query(ge=0)]


@router.post("/feedback", status_code=status.HTTP_201_CREATED)
async def submit_feedback(body: dict, db: DB, user: CurrentUser):
    try:
        return await service.submit_feedback(db, user, body)
    except ValueError as error:
        _raise(error)


@router.get("/feedback/mine")
async def my_feedback(db: DB, user: CurrentUser, limit: Limit = 100, offset: Offset = 0):
    return await service.list_my_feedback(db, user, limit=limit, offset=offset)


@router.post("/feedback/{feedback_id}/read", status_code=status.HTTP_204_NO_CONTENT)
async def mark_feedback_read(feedback_id: str, db: DB, user: CurrentUser):
    try:
        await service.mark_feedback_read(db, user, feedback_id)
    except ValueError as error:
        _raise(error)
    return Response(status_code=status.HTTP_204_NO_CONTENT)


@router.get("/admin/feedback")
async def admin_feedback(db: DB, user: AdminUser, limit: Limit = 100, offset: Offset = 0):
    return await service.list_feedback(db, limit=limit, offset=offset)


@router.patch("/admin/feedback/{feedback_id}")
async def update_feedback(feedback_id: str, body: dict, db: DB, user: AdminUser):
    try:
        return await service.update_feedback(db, user, feedback_id, body)
    except ValueError as error:
        _raise(error)


@router.post("/admin/feedback/{feedback_id}/replies")
async def reply_feedback(feedback_id: str, body: dict, db: DB, user: AdminUser):
    try:
        return await service.reply_feedback(db, user, feedback_id, body)
    except ValueError as error:
        _raise(error)


@router.get("/messages")
async def messages(db: DB, user: CurrentUser, limit: Limit = 100, offset: Offset = 0):
    return await service.list_user_messages(db, user, limit=limit, offset=offset)


@router.get("/unread-summary")
async def unread_summary(db: DB, user: CurrentUser):
    return await service.unread_summary(db, user)


@router.post("/messages/read-all", status_code=status.HTTP_204_NO_CONTENT)
async def mark_all_messages_read(db: DB, user: CurrentUser):
    await service.mark_all_messages_read(db, user)
    return Response(status_code=status.HTTP_204_NO_CONTENT)


@router.post("/messages/{message_id}/read", status_code=status.HTTP_204_NO_CONTENT)
async def mark_message_read(message_id: str, db: DB, user: CurrentUser):
    try:
        await service.mark_message_read(db, user, message_id)
    except ValueError as error:
        _raise(error)
    return Response(status_code=status.HTTP_204_NO_CONTENT)


@router.get("/admin/messages")
async def admin_messages(db: DB, user: AdminUser, limit: Limit = 100, offset: Offset = 0):
    return await service.list_announcements(db, limit=limit, offset=offset)


@router.post("/admin/messages", status_code=status.HTTP_201_CREATED)
async def create_message(body: dict, db: DB, user: AdminUser):
    try:
        return await service.save_announcement(db, user, body)
    except ValueError as error:
        _raise(error)


@router.patch("/admin/messages/{message_id}")
async def update_message(message_id: str, body: dict, db: DB, user: AdminUser):
    try:
        return await service.save_announcement(db, user, body, message_id)
    except ValueError as error:
        _raise(error)


@router.post("/admin/messages/{message_id}/publish")
async def publish_message(message_id: str, body: dict, db: DB, user: AdminUser):
    try:
        return await service.publish_announcement(db, user, message_id, body)
    except ValueError as error:
        _raise(error)


@router.post("/admin/messages/{message_id}/withdraw")
async def withdraw_message(message_id: str, db: DB, user: AdminUser):
    try:
        return await service.withdraw_announcement(db, user, message_id)
    except ValueError as error:
        _raise(error)


@router.delete("/admin/messages/{message_id}", status_code=status.HTTP_204_NO_CONTENT)
async def delete_message(message_id: str, db: DB, user: AdminUser):
    try:
        await service.delete_announcement(db, user, message_id)
    except ValueError as error:
        _raise(error)
    return Response(status_code=status.HTTP_204_NO_CONTENT)
