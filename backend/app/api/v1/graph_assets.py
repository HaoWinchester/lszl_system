"""Graph image uploads and file-bound private delivery."""
from typing import Annotated
from fastapi import APIRouter, Depends, Query, Response
from sqlalchemy.ext.asyncio import AsyncSession
from app.core.auth import get_current_user, require_role
from app.db.session import get_db
from app.models.user import User
from app.schemas.graph_asset import GraphAssetInput
from app.services import graph_asset_service as service
router = APIRouter(tags=['graph-assets'])
DB = Annotated[AsyncSession, Depends(get_db)]

@router.post('/graph-assets', status_code=201)
async def upload(data: GraphAssetInput, db: DB, user: Annotated[User, Depends(require_role('admin', 'teacher', 'student'))]):
    return {'asset': await service.upload_asset(db, user, data)}

@router.get('/graph-assets/{asset_id}')
async def read(asset_id: str, db: DB, user: Annotated[User, Depends(get_current_user)], file_id: str = Query(alias='fileId')):
    asset = await service.authorized_asset(db, user.username, asset_id, file_id)
    return Response(asset.data, media_type=asset.mime_type, headers={'Cache-Control': 'private, no-store', 'X-Content-Type-Options': 'nosniff'})
