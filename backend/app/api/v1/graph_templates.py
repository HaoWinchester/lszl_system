from typing import Annotated
from fastapi import APIRouter, Depends
from sqlalchemy.ext.asyncio import AsyncSession
from app.db.session import get_db
from app.core.auth import get_current_user
from app.models.user import User
from app.schemas.graph_template import PublicationInput, ListingInput, LoadInput
from app.services import graph_template_service as service

router = APIRouter(prefix='/graph-templates', tags=['graph-templates'])
DB = Annotated[AsyncSession, Depends(get_db)]
Actor = Annotated[User, Depends(get_current_user)]

@router.get('')
async def catalog(db: DB, user: Actor):
    return await service.catalog(db, user)

@router.post('', status_code=201)
async def publish(data: PublicationInput, db: DB, user: Actor):
    return await service.publish(db, user, data)

@router.get('/{template_id}')
async def preview(template_id: str, db: DB, user: Actor):
    return await service.preview(db, user, template_id)

@router.post('/{template_id}/versions', status_code=201)
async def update(template_id: str, data: PublicationInput, db: DB, user: Actor):
    return await service.publish(db, user, data, template_id)

@router.patch('/{template_id}')
async def listing(template_id: str, data: ListingInput, db: DB, user: Actor):
    return await service.set_listing(db, user, template_id, data)

@router.post('/{template_id}/loads', status_code=201)
async def load(template_id: str, data: LoadInput, db: DB, user: Actor):
    return await service.load(db, user, template_id, data)
