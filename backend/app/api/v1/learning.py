"""新版单题深学、多题工作区和学习事件 API。"""

from typing import Annotated

from fastapi import APIRouter, Depends, HTTPException, Query
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.auth import CurrentUser
from app.db.session import get_db
from app.schemas.personal_card import PersonalCardCreate, PersonalCardUpdate
from app.services import learning_service, personal_card_service, practice_session_service

router = APIRouter(tags=["learning"])
DB = Annotated[AsyncSession, Depends(get_db)]


@router.get("/learning/personal-cards")
async def list_personal_cards(
    db: DB,
    user: CurrentUser,
    archived: bool = Query(False),
    query: str = Query("", max_length=200),
):
    cards = await personal_card_service.list_cards(
        db,
        user.username,
        archived=archived,
        query=query,
    )
    return {"cards": cards, "count": len(cards)}


@router.post("/learning/personal-cards")
async def create_personal_card(body: PersonalCardCreate, db: DB, user: CurrentUser):
    card = await personal_card_service.create_card(db, user.username, body)
    return {"card": personal_card_service.card_to_dict(card)}


@router.get("/learning/personal-cards/{card_id}")
async def get_personal_card(card_id: str, db: DB, user: CurrentUser):
    card = await personal_card_service.get_card(db, user.username, card_id)
    if card is None:
        raise HTTPException(status_code=404, detail="归纳卡不存在或无权访问")
    return {"card": personal_card_service.card_to_dict(card)}


@router.put("/learning/personal-cards/{card_id}")
async def update_personal_card(
    card_id: str,
    body: PersonalCardUpdate,
    db: DB,
    user: CurrentUser,
):
    try:
        card = await personal_card_service.update_card(db, user.username, card_id, body)
    except personal_card_service.PersonalCardConflict as error:
        raise HTTPException(
            status_code=409,
            detail={
                "code": "PERSONAL_CARD_REVISION_CONFLICT",
                "message": str(error),
                "currentRevision": error.current_revision,
            },
        ) from error
    if card is None:
        raise HTTPException(status_code=404, detail="归纳卡不存在或无权访问")
    return {"card": personal_card_service.card_to_dict(card)}


@router.post("/learning/personal-cards/{card_id}/archive")
async def archive_personal_card(card_id: str, db: DB, user: CurrentUser):
    card = await personal_card_service.set_archived(db, user.username, card_id, True)
    if card is None:
        raise HTTPException(status_code=404, detail="归纳卡不存在或无权访问")
    return {"card": personal_card_service.card_to_dict(card)}


@router.post("/learning/personal-cards/{card_id}/restore")
async def restore_personal_card(card_id: str, db: DB, user: CurrentUser):
    card = await personal_card_service.set_archived(db, user.username, card_id, False)
    if card is None:
        raise HTTPException(status_code=404, detail="归纳卡不存在或无权访问")
    return {"card": personal_card_service.card_to_dict(card)}


@router.get("/training/session/{question_id}")
async def get_training_session(
    question_id: str,
    db: DB,
    user: CurrentUser,
    release_id: str = Query("", alias="releaseId", max_length=64),
):
    return {
        "session": await learning_service.get_session(
            db, user.username, question_id, release_id
        )
    }


@router.put("/training/session/{question_id}")
async def save_training_session(
    question_id: str,
    body: dict,
    db: DB,
    user: CurrentUser,
    release_id: str = Query("", alias="releaseId", max_length=64),
):
    try:
        session = await learning_service.save_session(
            db,
            user.username,
            question_id,
            body,
            release_id=release_id,
            current_user=user,
        )
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


@router.get("/learning/practice/overview")
async def practice_overview(db: DB, user: CurrentUser):
    return await learning_service.practice_overview(db, user.username)


@router.post("/learning/practice/answers")
async def record_practice_answer(body: dict, db: DB, user: CurrentUser):
    try:
        return await learning_service.record_practice_answer(
            db, user.username, body, current_user=user
        )
    except ValueError as error:
        raise HTTPException(status_code=422, detail=str(error)) from error
    except LookupError as error:
        raise HTTPException(status_code=404, detail=str(error)) from error


@router.post("/learning/practice/sessions/start")
async def start_practice_session(body: dict, db: DB, user: CurrentUser):
    try:
        session = await practice_session_service.start_session(
            db, user.username, user, body
        )
    except practice_session_service.PracticeSessionError as error:
        raise HTTPException(
            status_code=error.status_code, detail=error.detail()
        ) from error
    return {"session": session}


@router.get("/learning/practice/sessions/active")
async def active_practice_sessions(
    db: DB,
    user: CurrentUser,
    release_id: str | None = Query(None, alias="releaseId"),
    mode: str | None = Query(None),
):
    return {
        "sessions": await practice_session_service.list_active_sessions(
            db, user.username, release_id=release_id, mode=mode
        )
    }


@router.post("/learning/practice/sessions")
async def record_practice_session(body: dict, db: DB, user: CurrentUser):
    try:
        session = await learning_service.record_practice_session(db, user.username, body)
    except ValueError as error:
        raise HTTPException(status_code=422, detail=str(error)) from error
    return {"session": session}


@router.get("/learning/practice/sessions")
async def list_practice_sessions(db: DB, user: CurrentUser):
    return {"sessions": await learning_service.list_practice_sessions(db, user.username)}


@router.get("/learning/practice/experience-summary")
async def practice_experience_summary(db: DB, user: CurrentUser):
    """做题经验聚合（累计 / 本学习周 / 最近 7 日），供做题大厅经验面板展示。"""
    return await learning_service.practice_experience_summary(db, user.username)


@router.delete("/learning/practice/sessions")
async def clear_practice_sessions(db: DB, user: CurrentUser):
    return {"ok": True, "deleted": await learning_service.clear_practice_sessions(db, user.username)}


@router.post("/learning/practice/sessions/{session_id}/answers")
async def answer_practice_session(
    session_id: str, body: dict, db: DB, user: CurrentUser
):
    try:
        return await practice_session_service.answer_session_question(
            db, user.username, user, session_id, body
        )
    except practice_session_service.PracticeSessionError as error:
        raise HTTPException(
            status_code=error.status_code, detail=error.detail()
        ) from error


@router.patch("/learning/practice/sessions/{session_id}/state")
async def update_practice_session_state(
    session_id: str, body: dict, db: DB, user: CurrentUser
):
    try:
        session = await practice_session_service.update_runtime_state(
            db, user.username, session_id, body
        )
    except practice_session_service.PracticeSessionError as error:
        raise HTTPException(
            status_code=error.status_code, detail=error.detail()
        ) from error
    return {"session": session}


@router.post("/learning/practice/sessions/{session_id}/pause")
async def pause_practice_session(
    session_id: str, body: dict, db: DB, user: CurrentUser
):
    try:
        session = await practice_session_service.pause_session(
            db, user.username, session_id, body
        )
    except practice_session_service.PracticeSessionError as error:
        raise HTTPException(
            status_code=error.status_code, detail=error.detail()
        ) from error
    return {"session": session}


@router.post("/learning/practice/sessions/{session_id}/abandon")
async def abandon_practice_session(
    session_id: str, body: dict, db: DB, user: CurrentUser
):
    try:
        session = await practice_session_service.abandon_session(
            db, user.username, session_id, body
        )
    except practice_session_service.PracticeSessionError as error:
        raise HTTPException(
            status_code=error.status_code, detail=error.detail()
        ) from error
    return {"session": session}


@router.post("/learning/practice/sessions/{session_id}/complete")
async def complete_practice_session(
    session_id: str, body: dict, db: DB, user: CurrentUser
):
    try:
        session, report = await practice_session_service.complete_session(
            db, user.username, session_id, body
        )
    except practice_session_service.PracticeSessionError as error:
        raise HTTPException(
            status_code=error.status_code, detail=error.detail()
        ) from error
    return {"session": session, "report": report}


@router.get("/learning/practice/sessions/{session_id}/report")
async def get_practice_session_report(
    session_id: str, db: DB, user: CurrentUser
):
    report = await practice_session_service.get_report(
        db, user.username, session_id
    )
    if report is None:
        raise HTTPException(status_code=404, detail="成绩报告不存在或无权访问")
    return {"report": report}


@router.get("/learning/practice/sessions/{session_id}")
async def get_practice_session(session_id: str, db: DB, user: CurrentUser):
    session = await practice_session_service.get_session(db, user.username, session_id)
    if session is None:
        raise HTTPException(status_code=404, detail="练习会话不存在或无权访问")
    return {"session": session}


@router.post("/learning/practice/mistakes")
async def record_practice_mistake(body: dict, db: DB, user: CurrentUser):
    try:
        mistake = await learning_service.record_practice_mistake(
            db, user.username, body, current_user=user
        )
    except ValueError as error:
        raise HTTPException(status_code=422, detail=str(error)) from error
    except LookupError as error:
        raise HTTPException(status_code=404, detail=str(error)) from error
    return {"mistake": learning_service._practice_mistake_to_dict(mistake)}


@router.post("/learning/practice/mistakes/{mistake_id}/revenge-answer")
async def record_revenge_answer(mistake_id: str, body: dict, db: DB, user: CurrentUser):
    try:
        mistake = await learning_service.record_revenge_answer(db, user.username, mistake_id, body)
    except ValueError as error:
        raise HTTPException(status_code=422, detail=str(error)) from error
    if mistake is None:
        raise HTTPException(status_code=404, detail="错题不存在或无权访问")
    return {"mistake": learning_service._practice_mistake_to_dict(mistake)}


@router.post("/learning/practice/mistakes/{mistake_id}/remediation-reviewed")
async def remediation_reviewed(mistake_id: str, db: DB, user: CurrentUser):
    try:
        mistake = await learning_service.mark_remediation_reviewed(db, user.username, mistake_id)
    except ValueError as error:
        raise HTTPException(status_code=409, detail=str(error)) from error
    if mistake is None:
        raise HTTPException(status_code=404, detail="错题不存在或无权访问")
    return {"mistake": learning_service._practice_mistake_to_dict(mistake)}


@router.get("/learning/practice/mistakes/{mistake_id}/verification-candidate")
async def verification_candidate(mistake_id: str, db: DB, user: CurrentUser):
    try:
        candidate = await learning_service.practice_verification_candidate(db, user.username, mistake_id)
    except ValueError as error:
        raise HTTPException(status_code=422, detail=str(error)) from error
    if candidate is None:
        raise HTTPException(status_code=404, detail="错题不存在或无权访问")
    return {"candidate": candidate}


@router.post("/learning/practice/mistakes/{mistake_id}/verification")
async def record_verification(mistake_id: str, body: dict, db: DB, user: CurrentUser):
    try:
        result = await learning_service.record_practice_verification(db, user.username, mistake_id, body)
    except ValueError as error:
        raise HTTPException(status_code=422, detail=str(error)) from error
    if result is None:
        raise HTTPException(status_code=404, detail="错题不存在或无权访问")
    mistake, verification = result
    return {
        "mistake": learning_service._practice_mistake_to_dict(mistake),
        "verification": learning_service._practice_verification_to_dict(verification),
    }


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
