"""Read-only preview and explicit, atomic XMind confirmation."""
import json
from typing import Annotated
from fastapi import APIRouter, Depends, File, Form, UploadFile, HTTPException
from pydantic import ValidationError
from sqlalchemy.ext.asyncio import AsyncSession
from app.core.auth import require_role
from app.db.session import get_db
from app.models.user import User
from app.schemas.xmind_import import XMindConfirmation
from app.services import xmind_import_service as service

router=APIRouter(prefix='/graph-imports/xmind',tags=['graph-imports'])
DB=Annotated[AsyncSession,Depends(get_db)]
Editor=Annotated[User,Depends(require_role('admin','teacher','student'))]

async def document(file):
    try:
        data=await file.read(service.MAX_UPLOAD+1)
        return service.parse(data,file.filename or '')
    finally:
        await file.close()

@router.post('/preview')
async def preview(db:DB,user:Editor,file:UploadFile=File(...)):
    parsed=await document(file)
    quota=await service.check_quota(db,user,parsed)
    return service.public_preview(parsed,quota)

@router.post('/import',status_code=201)
async def confirm(db:DB,user:Editor,file:UploadFile=File(...),sheet_ids:str=Form(alias='sheetIds'),accepted_warnings:str=Form('[]',alias='acceptedWarnings')):
    if len(sheet_ids)>20000 or len(accepted_warnings)>4000000:
        raise HTTPException(413,'确认参数超限')
    try:
        data=XMindConfirmation(sheetIds=json.loads(sheet_ids),acceptedWarnings=json.loads(accepted_warnings))
    except (ValueError,ValidationError):
        raise HTTPException(422,'工作表和差异确认必须为有效字符串数组')
    parsed=await document(file)
    return await service.import_parsed(db,user,parsed,data.sheetIds,data.acceptedWarnings)
