"""新版单题深学、多题工作区和学习事件 API。"""

from typing import Annotated

from fastapi import APIRouter, Depends, HTTPException, Query
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.auth import CurrentUser
from app.db.session import get_db
from app.services import learning_service

router = APIRouter(tags=["learning"])
DB = Annotated[AsyncSession, Depends(get_db)]


@router.get("/training/session/{question_id}")
async def get_training_session(question_id: str, db: DB, user: CurrentUser):
    return {"session": await learning_service.get_session(db, user.username, question_id)}


@router.put("/training/session/{question_id}")
async def save_training_session(question_id: str, body: dict, db: DB, user: CurrentUser):
    try:
        session = await learning_service.save_session(db, user.username, question_id, body)
    except ValueError as error:
        raise HTTPException(status_code=400, detail=str(error)) from error
    if session is None:
        raise HTTPException(status_code=404, detail="题目不存在或无权访问")
    return {"session": session}


@router.get("/learning/events")
async def list_learning_events(
    db: DB,
    user: CurrentUser,
    question_id: str | None = Query(None),
    page: int = Query(1, ge=1),
    page_size: int = Query(50, ge=1, le=100),
):
    return {
        "events": await learning_service.list_events(
            db,
            user.username,
            question_id=question_id,
            page=page,
            page_size=page_size,
        )
    }


@router.post("/learning/events")
async def append_learning_event(body: dict, db: DB, user: CurrentUser):
    try:
        event = await learning_service.append_event(db, user.username, body)
    except ValueError as error:
        raise HTTPException(status_code=400, detail=str(error)) from error
    except LookupError as error:
        raise HTTPException(status_code=404, detail=str(error)) from error
    return {"event": learning_service.event_to_dict(event)}


@router.get("/workspaces")
async def list_workspaces(db: DB, user: CurrentUser):
    return {"workspaces": await learning_service.list_workspaces(db, user.username)}


@router.post("/workspaces")
async def create_workspace(body: dict, db: DB, user: CurrentUser):
    try:
        workspace = await learning_service.create_workspace(db, user.username, body)
    except ValueError as error:
        raise HTTPException(status_code=400, detail=str(error)) from error
    return {"workspace": learning_service.workspace_to_dict(workspace)}


@router.get("/workspaces/{workspace_id}")
async def get_workspace(workspace_id: str, db: DB, user: CurrentUser):
    workspace = await learning_service.get_workspace(db, user.username, workspace_id)
    if workspace is None:
        raise HTTPException(status_code=404, detail="工作区不存在或无权访问")
    return {"workspace": learning_service.workspace_to_dict(workspace)}


@router.put("/workspaces/{workspace_id}")
async def update_workspace(workspace_id: str, body: dict, db: DB, user: CurrentUser):
    try:
        workspace = await learning_service.update_workspace(db, user.username, workspace_id, body)
    except ValueError as error:
        raise HTTPException(status_code=400, detail=str(error)) from error
    if workspace is None:
        raise HTTPException(status_code=404, detail="工作区不存在或无权访问")
    return {"workspace": learning_service.workspace_to_dict(workspace)}


@router.delete("/workspaces/{workspace_id}")
async def delete_workspace(workspace_id: str, db: DB, user: CurrentUser):
    if not await learning_service.delete_workspace(db, user.username, workspace_id):
        raise HTTPException(status_code=404, detail="工作区不存在或无权访问")
    return {"ok": True}
