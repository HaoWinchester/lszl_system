"""训练作答与深度回忆路由。"""

from typing import Annotated

from fastapi import APIRouter, Depends, HTTPException, Query
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.auth import CurrentUser
from app.db.session import get_db
from app.services import training_service

router = APIRouter(tags=["training-recall"])
DB = Annotated[AsyncSession, Depends(get_db)]


@router.get("/training/progress/{question_id}")
async def get_progress(question_id: str, db: DB, user: CurrentUser):
    return {"progress": await training_service.get_progress(db, user.username, question_id)}


@router.put("/training/progress/{question_id}")
async def save_progress(question_id: str, body: dict, db: DB, user: CurrentUser):
    return {"progress": await training_service.save_progress(db, user.username, question_id, body)}


@router.get("/recall/question/{question_id}")
async def recall_question(question_id: str, db: DB, user: CurrentUser):
    q = await training_service.get_question_for_recall(db, user.username, question_id)
    if not q:
        raise HTTPException(status_code=404, detail="题目不存在或无权访问")
    return {"question": q}


@router.get("/recall/progress/{question_id}")
async def get_recall(question_id: str, db: DB, user: CurrentUser):
    return {"progress": await training_service.get_recall(db, user.username, question_id)}


@router.get("/recall/progress")
async def list_recall_progress(
    db: DB,
    user: CurrentUser,
    bank_id: str | None = Query(None, min_length=1),
    question_ids: list[str] = Query(default=[]),
):
    return {
        "questionIds": await training_service.list_recall_progress_question_ids(
            db,
            user.username,
            bank_id=bank_id,
            question_ids=[question_id for question_id in question_ids if question_id][:200],
        )
    }


@router.put("/recall/progress/{question_id}")
async def save_recall(question_id: str, body: dict, db: DB, user: CurrentUser):
    return {"progress": await training_service.save_recall(db, user.username, question_id, body)}


@router.delete("/recall/progress/{question_id}")
async def delete_recall(question_id: str, db: DB, user: CurrentUser):
    return {"deleted": await training_service.delete_recall(db, user.username, question_id)}
