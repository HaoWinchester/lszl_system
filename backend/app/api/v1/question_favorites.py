"""题目收藏 API：/api/v1/question-favorites。"""

from typing import Annotated

from fastapi import APIRouter, Depends, HTTPException, Query
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.auth import CurrentUser
from app.db.session import get_db
from app.models.user import User
from app.services import question_comment_service as comment_service
from app.services import question_favorite_service as service

router = APIRouter(prefix="/question-favorites", tags=["question-favorites"])
DB = Annotated[AsyncSession, Depends(get_db)]


def _raise(error: ValueError) -> None:
    if isinstance(error, comment_service.QuestionCommentNotFoundError):
        raise HTTPException(status_code=404, detail=str(error)) from error
    if isinstance(error, comment_service.QuestionCommentPermissionError):
        raise HTTPException(status_code=403, detail=str(error)) from error
    raise HTTPException(status_code=422, detail=str(error)) from error


@router.get("")
async def list_favorites(db: DB, user: CurrentUser, cursor: str | None = Query(default=None, max_length=512), limit: int = Query(default=50, ge=1, le=50), search: str | None = Query(default=None, max_length=100)):
    """收藏列表：题目题干 + 解析 + 来源，支持搜索与游标分页。"""
    try:
        return await service.list_favorites(db, user, cursor, limit, search)
    except ValueError as error:
        _raise(error)


@router.get("/detail")
async def favorite_detail_by_query(db: DB, user: CurrentUser, question_id: Annotated[str, Query(max_length=64)]):
    """收藏题目详情（query 形式，避免与 /{question_id} 路径歧义）。"""
    try:
        return await service.favorite_detail(db, user, question_id)
    except ValueError as error:
        _raise(error)


@router.get("/status")
async def favorite_status(db: DB, user: CurrentUser, ids: Annotated[str, Query(max_length=4000)]):
    """批量查询收藏状态：练习页侧栏收藏按钮高亮用。"""
    return {"status": await service.favorite_status(db, user, ids.split(","))}


@router.get("/counts")
async def favorite_counts(db: DB, user: CurrentUser, ids: Annotated[str, Query(max_length=4000)]):
    """批量题目收藏总数：练习页侧栏收藏角标用。"""
    return {"counts": await service.question_favorite_counts(db, user, ids.split(","))}


@router.put("/{question_id}")
async def favorite_question(question_id: str, db: DB, user: CurrentUser):
    try:
        return await service.set_favorite(db, user, question_id, True)
    except ValueError as error:
        _raise(error)


@router.delete("/{question_id}")
async def unfavorite_question(question_id: str, db: DB, user: CurrentUser):
    try:
        return await service.set_favorite(db, user, question_id, False)
    except ValueError as error:
        _raise(error)


@router.post("/{question_id}/toggle")
async def toggle_question_favorite(question_id: str, db: DB, user: CurrentUser):
    try:
        return await service.toggle_favorite(db, user, question_id)
    except ValueError as error:
        _raise(error)
