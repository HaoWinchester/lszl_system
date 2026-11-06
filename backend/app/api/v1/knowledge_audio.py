"""Authenticated published-node audio metadata and single-range playback."""
from typing import Annotated

from fastapi import APIRouter, Depends, Query, Request, Response
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.auth import CurrentUser
from app.db.session import get_db
from app.services import knowledge_audio_service as service

router = APIRouter(tags=['knowledge-audio'])
DB = Annotated[AsyncSession, Depends(get_db)]


@router.get('/learning/knowledge-nodes/{taxonomy_id}/{node_id}/audios')
async def list_audios(taxonomy_id: str, node_id: str, db: DB, user: CurrentUser,
                      offset: int = Query(0, ge=0), limit: int = Query(20, ge=1, le=100)):
    return await service.list_audios(db, taxonomy_id, node_id, offset=offset, limit=limit)


@router.get('/learning/knowledge-audios/{audio_id}/content')
@router.head('/learning/knowledge-audios/{audio_id}/content', include_in_schema=False)
async def audio_content(audio_id: str, request: Request, db: DB, user: CurrentUser):
    result = await service.content(db, audio_id, range_header=request.headers.get('range'),
                                   if_range=request.headers.get('if-range'), head=request.method == 'HEAD')
    return Response(**result)
