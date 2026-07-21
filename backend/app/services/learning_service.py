"""单题深学会话、学习事件和多题工作区服务。"""

import re

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.security import uid
from app.models.training import CanvasWorkspace, LearningEvent, TrainingProgress
from app.services import question_service

SESSION_SCHEMA_VERSIONS = {1, 2}
WORKSPACE_SCHEMA_VERSIONS = set(range(1, 7))
WORKSPACE_ID_PATTERN = re.compile(r"^[A-Za-z0-9_-]{1,64}$")


def _iso(value) -> str | None:
    return value.isoformat() if value else None


async def _owned_question(db: AsyncSession, owner: str, question_id: str) -> bool:
    return await question_service.get_question(db, owner, question_id) is not None


async def _progress(db: AsyncSession, owner: str, question_id: str) -> TrainingProgress | None:
    result = await db.execute(
        select(TrainingProgress).where(
            TrainingProgress.owner_id == owner,
            TrainingProgress.question_id == question_id,
        )
    )
    return result.scalar_one_or_none()


def _legacy_session(progress: TrainingProgress) -> dict:
    return {
        "schemaVersion": 1,
        "answer": {
            "selectedAnswer": progress.selected_answer,
            "submitted": progress.submitted,
        },
        "foundClues": progress.found_clues or [],
        "reasoningState": progress.reasoning_state or {},
    }


async def get_session(db: AsyncSession, owner: str, question_id: str) -> dict | None:
    progress = await _progress(db, owner, question_id)
    if not progress:
        return None
    return progress.session_data or _legacy_session(progress)


async def save_session(db: AsyncSession, owner: str, question_id: str, data: dict) -> dict | None:
    if not await _owned_question(db, owner, question_id):
        return None
    version = int(data.get("schemaVersion") or 1)
    if version not in SESSION_SCHEMA_VERSIONS:
        raise ValueError("不支持的学习会话版本")
    progress = await _progress(db, owner, question_id)
    answer = data.get("answer") if isinstance(data.get("answer"), dict) else {}
    if progress is None:
        progress = TrainingProgress(
            id=uid("tp_"),
            owner_id=owner,
            question_id=question_id,
            selected_answer=answer.get("selectedAnswer"),
            submitted=bool(answer.get("submitted", False)),
            found_clues=data.get("foundClues") or [],
            reasoning_state=data.get("reasoningState") or {},
            session_data=data,
        )
        db.add(progress)
    else:
        progress.session_data = data
        if "selectedAnswer" in answer:
            progress.selected_answer = answer.get("selectedAnswer")
        if "submitted" in answer:
            progress.submitted = bool(answer.get("submitted"))
        if "foundClues" in data:
            progress.found_clues = data.get("foundClues") or []
        if "reasoningState" in data:
            progress.reasoning_state = data.get("reasoningState") or {}
    await db.commit()
    await db.refresh(progress)
    return progress.session_data


def event_to_dict(event: LearningEvent) -> dict:
    return {
        "id": event.id,
        "questionId": event.question_id,
        "eventType": event.event_type,
        "payload": event.payload or {},
        "createdAt": _iso(event.created_at),
    }


async def append_event(db: AsyncSession, owner: str, data: dict) -> LearningEvent:
    question_id = data.get("questionId")
    if question_id and not await _owned_question(db, owner, str(question_id)):
        raise LookupError("题目不存在或无权访问")
    event_type = str(data.get("eventType") or "").strip()
    if not event_type:
        raise ValueError("eventType 不能为空")
    event = LearningEvent(
        id=uid("le_"),
        owner_id=owner,
        question_id=str(question_id) if question_id else None,
        event_type=event_type,
        payload=data.get("payload") if isinstance(data.get("payload"), dict) else {},
    )
    db.add(event)
    await db.commit()
    await db.refresh(event)
    return event


async def list_events(
    db: AsyncSession,
    owner: str,
    *,
    question_id: str | None = None,
    page: int = 1,
    page_size: int = 50,
) -> list[dict]:
    query = select(LearningEvent).where(LearningEvent.owner_id == owner)
    if question_id:
        query = query.where(LearningEvent.question_id == question_id)
    query = query.order_by(LearningEvent.created_at.desc()).offset((page - 1) * page_size).limit(min(page_size, 100))
    events = (await db.execute(query)).scalars().all()
    return [event_to_dict(event) for event in events]


def workspace_to_dict(workspace: CanvasWorkspace) -> dict:
    return {
        "id": workspace.id,
        "title": workspace.title,
        "schemaVersion": workspace.schema_version,
        "payload": workspace.payload or {},
        "createdAt": _iso(workspace.created_at),
        "updatedAt": _iso(workspace.updated_at),
    }


def _workspace_values(data: dict) -> tuple[str, int, dict]:
    title = str(data.get("title") or "").strip()
    if not title:
        raise ValueError("工作区名称不能为空")
    version = int(data.get("schemaVersion") or 6)
    if version not in WORKSPACE_SCHEMA_VERSIONS:
        raise ValueError("不支持的工作区版本")
    payload = data.get("payload")
    if not isinstance(payload, dict):
        raise ValueError("工作区 payload 必须是对象")
    return title[:200], version, payload


async def list_workspaces(db: AsyncSession, owner: str) -> list[dict]:
    query = select(CanvasWorkspace).where(CanvasWorkspace.owner_id == owner).order_by(CanvasWorkspace.updated_at.desc())
    rows = (await db.execute(query)).scalars().all()
    return [workspace_to_dict(row) for row in rows]


async def get_workspace(db: AsyncSession, owner: str, workspace_id: str) -> CanvasWorkspace | None:
    result = await db.execute(
        select(CanvasWorkspace).where(
            CanvasWorkspace.owner_id == owner,
            CanvasWorkspace.id == workspace_id,
        )
    )
    return result.scalar_one_or_none()


async def create_workspace(db: AsyncSession, owner: str, data: dict) -> CanvasWorkspace:
    title, version, payload = _workspace_values(data)
    requested_id = str(data.get("id") or "").strip()
    if requested_id and not WORKSPACE_ID_PATTERN.fullmatch(requested_id):
        raise ValueError("工作区 ID 格式不正确")
    workspace_id = requested_id or uid("cw_")
    if await db.get(CanvasWorkspace, workspace_id) is not None:
        raise ValueError("工作区 ID 已存在")
    workspace = CanvasWorkspace(
        id=workspace_id,
        owner_id=owner,
        title=title,
        schema_version=version,
        payload=payload,
    )
    db.add(workspace)
    await db.commit()
    await db.refresh(workspace)
    return workspace


async def update_workspace(
    db: AsyncSession,
    owner: str,
    workspace_id: str,
    data: dict,
) -> CanvasWorkspace | None:
    workspace = await get_workspace(db, owner, workspace_id)
    if workspace is None:
        return None
    title, version, payload = _workspace_values({
        "title": data.get("title", workspace.title),
        "schemaVersion": data.get("schemaVersion", workspace.schema_version),
        "payload": data.get("payload", workspace.payload),
    })
    workspace.title = title
    workspace.schema_version = version
    workspace.payload = payload
    await db.commit()
    await db.refresh(workspace)
    return workspace


async def delete_workspace(db: AsyncSession, owner: str, workspace_id: str) -> bool:
    workspace = await get_workspace(db, owner, workspace_id)
    if workspace is None:
        return False
    await db.delete(workspace)
    await db.commit()
    return True
