"""Graph card practice does not alter ordinary catalog or paper permissions."""
from typing import Annotated
from fastapi import APIRouter, Depends, Query
from sqlalchemy.ext.asyncio import AsyncSession
from app.core.auth import get_current_user
from app.db.session import get_db
from app.models.user import User
from app.schemas.graph_question import BindingInput, RevisionInput, AttemptInput, BatchPreviewInput, BatchApplyInput
from app.services import graph_question_service as service, question_catalog_service as catalog, graph_question_batch_service as batch
router = APIRouter(prefix='/graph-questions', tags=['graph-questions'])
DB = Annotated[AsyncSession, Depends(get_db)]
Reader = Annotated[User, Depends(get_current_user)]

@router.get('/subjects')
async def subjects(db: DB, user: Reader):
    return await batch.subjects(db, user)

@router.get('/search')
async def search(db: DB, user: Reader, fileId: str, nodeId: str, q: str = Query('', max_length=200), subject: str | None = Query(None, max_length=32), page: int = Query(1, ge=1, le=500)):
    service.require_editor(user)
    await service.card(db, user, fileId, nodeId)
    return await catalog.search_graph_questions(db, user, fileId, nodeId, q, subject, page)

@router.get('/files/{file_id}/nodes/{node_id}/bindings')
async def bindings(file_id: str, node_id: str, db: DB, user: Reader):
    return await service.list_bindings(db, user, file_id, node_id)

@router.put('/files/{file_id}/nodes/{node_id}/bindings')
async def save(file_id: str, node_id: str, data: BindingInput, db: DB, user: Reader):
    return await service.set_bindings(db, user, file_id, node_id, data)

@router.post('/files/{file_id}/nodes/{node_id}/bindings/{binding_id}/refresh')
async def refresh(file_id: str, node_id: str, binding_id: str, data: RevisionInput, db: DB, user: Reader):
    return await service.revise_binding(db, user, file_id, node_id, binding_id, data, refresh=True)

@router.post('/files/{file_id}/nodes/{node_id}/bindings/{binding_id}/revoke')
async def revoke(file_id: str, node_id: str, binding_id: str, data: RevisionInput, db: DB, user: Reader):
    return await service.revise_binding(db, user, file_id, node_id, binding_id, data)

@router.post('/files/{file_id}/nodes/{node_id}/bindings/{binding_id}/attempts')
async def submit(file_id: str, node_id: str, binding_id: str, data: AttemptInput, db: DB, user: Reader):
    return await service.submit(db, user, file_id, node_id, binding_id, data)

@router.get('/attempts/{attempt_id}/analysis')
async def analysis(attempt_id: str, db: DB, user: Reader):
    return await service.history(db, user, attempt_id)


@router.post('/files/{file_id}/batch-preview')
async def batch_preview(file_id: str, data: BatchPreviewInput, db: DB, user: Reader):
    return await batch.preview(db, user, file_id, data)

@router.post('/files/{file_id}/batch-apply')
async def batch_apply(file_id: str, data: BatchApplyInput, db: DB, user: Reader):
    return await batch.apply(db, user, file_id, data)
