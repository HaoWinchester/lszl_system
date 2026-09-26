"""单题留言（评论）API：/api/v1/questions/{question_id}/comments。"""

from typing import Annotated

from fastapi import APIRouter, Depends, HTTPException, Query, Response, status
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.auth import CurrentUser
from app.db.session import get_db
from app.models.user import User
from app.services import question_comment_service as service

router = APIRouter(prefix="/questions/{question_id}/comments", tags=["question-comments"])
# 独立前缀：挂 /questions 下会被 GET /questions/{question_id} 抢匹配。
counts_router = APIRouter(prefix="/question-comments", tags=["question-comments"])
DB = Annotated[AsyncSession, Depends(get_db)]


def _raise(error: ValueError) -> None:
    if isinstance(error, service.QuestionCommentNotFoundError):
        raise HTTPException(status_code=404, detail=str(error)) from error
    if isinstance(error, service.QuestionCommentPermissionError):
        raise HTTPException(status_code=403, detail=str(error)) from error
    raise HTTPException(status_code=422, detail=str(error)) from error


@router.get("")
async def list_comments(question_id: str, db: DB, user: CurrentUser, cursor: str | None = Query(default=None, max_length=512), limit: int = Query(default=50, ge=1, le=50)):
    try:
        return await service.list_comments_page(db, user, question_id, cursor, limit)
    except ValueError as error:
        _raise(error)


@router.post("", status_code=status.HTTP_201_CREATED)
async def create_comment(question_id: str, body: dict, db: DB, user: CurrentUser):
    try:
        comment = await service.create_comment(db, user, question_id, body.get("content"), body.get("parentId"))
    except ValueError as error:
        _raise(error)
    return {"comment": comment}


@router.post("/{comment_id}/like")
async def like_comment(question_id: str, comment_id: str, db: DB, user: CurrentUser):
    try:
        comment = await service.add_like(db, user, question_id, comment_id)
    except ValueError as error:
        _raise(error)
    return {"comment": comment}


@router.delete("/{comment_id}/like")
async def unlike_comment(question_id: str, comment_id: str, db: DB, user: CurrentUser):
    try:
        comment = await service.remove_like(db, user, question_id, comment_id)
    except ValueError as error:
        _raise(error)
    return {"comment": comment}


@router.delete("/{comment_id}", status_code=status.HTTP_204_NO_CONTENT)
async def delete_comment(question_id: str, comment_id: str, db: DB, user: CurrentUser):
    try:
        await service.delete_comment(db, user, question_id, comment_id)
    except ValueError as error:
        _raise(error)
    return Response(status_code=status.HTTP_204_NO_CONTENT)


@counts_router.get("/counts")
async def comment_counts(
    ids: Annotated[str, Query(max_length=4000)],
    db: DB,
    user: CurrentUser,
):
    """批量题目可见留言数：报告页折叠条展示“N 条”用，避免逐题请求。"""
    id_list = [item for item in (part.strip() for part in ids.split(",")) if item][:200]
    accessible = []
    for identifier in id_list:
        try:
            await service.require_question_access(db, user, identifier)
            accessible.append(identifier)
        except (service.QuestionCommentNotFoundError, service.QuestionCommentPermissionError):
            pass
    return {"counts": await service.count_comments(db, accessible)}


@router.put("/{comment_id}/favorite")
async def favorite_comment(question_id: str, comment_id: str, db: DB, user: CurrentUser):
    try:
        return {"comment": await service.set_favorite(db, user, question_id, comment_id, True)}
    except ValueError as error:
        _raise(error)

@router.delete("/{comment_id}/favorite")
async def unfavorite_comment(question_id: str, comment_id: str, db: DB, user: CurrentUser):
    try:
        return {"comment": await service.set_favorite(db, user, question_id, comment_id, False)}
    except ValueError as error:
        _raise(error)

@counts_router.get("/favorites")
async def favorites(db: DB, user: CurrentUser, cursor: str | None = Query(default=None, max_length=512), limit: int = Query(default=50, ge=1, le=50)):
    try:
        return await service.list_favorites(db, user, cursor, limit)
    except ValueError as error:
        _raise(error)
