"""Authenticated material editing and immutable image delivery."""
import base64
from typing import Annotated
from fastapi import APIRouter, Depends, Query, Response
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession
from app.core.auth import get_current_user, require_role
from app.db.session import get_db
from app.models.user import User
from app.models.question_material import QuestionMaterial
from app.schemas.question_material import AssetInput, MaterialInput
from app.services import question_material_service as service

router = APIRouter(tags=['question-materials'])
DB = Annotated[AsyncSession, Depends(get_db)]
Editor = Annotated[User, Depends(require_role('teacher', 'admin'))]
Reader = Annotated[User, Depends(get_current_user)]

@router.post('/question-assets', status_code=201)
async def upload(data: AssetInput, db: DB, user: Editor):
    return {'asset': await service.upload_asset(db, user, data)}

@router.get('/question-assets/{asset_id}/content')
async def asset_content(asset_id: str, db: DB, user: Reader):
    asset = await service.authorized_asset(db, user, asset_id)
    return {'asset': service.asset_payload(asset), 'mimeType': asset.mime_type, 'dataBase64': base64.b64encode(asset.data).decode('ascii')}

@router.get('/question-assets/{asset_id}')
async def asset_bytes(asset_id: str, db: DB, user: Reader):
    asset = await service.authorized_asset(db, user, asset_id)
    return Response(asset.data, media_type=asset.mime_type, headers={'Cache-Control': 'private, no-store', 'X-Content-Type-Options': 'nosniff'})

@router.get('/question-materials')
async def list_materials(db: DB, user: Editor):
    query = select(QuestionMaterial).order_by(QuestionMaterial.updated_at.desc())
    if user.role != 'admin':
        query = query.where(QuestionMaterial.owner_id == user.username)
    return {'materials': [service.material_payload(row) for row in (await db.scalars(query)).all()]}

@router.get('/question-materials/{material_id}')
async def get_material(material_id: str, db: DB, user: Editor):
    return {'material': service.material_payload(await service.owned_material(db, user, material_id))}

@router.post('/question-materials', status_code=201)
async def create_material(data: MaterialInput, db: DB, user: Editor):
    return {'material': await service.save_material(db, user, data)}

@router.put('/question-materials/{material_id}')
async def update_material(material_id: str, data: MaterialInput, db: DB, user: Editor):
    return {'material': await service.save_material(db, user, data, material_id)}

@router.delete('/question-materials/{material_id}', status_code=204)
async def delete_material(material_id: str, db: DB, user: Editor, revision: int = Query(ge=1)):
    await service.delete_material(db, user, material_id, revision)
    return Response(status_code=204)
