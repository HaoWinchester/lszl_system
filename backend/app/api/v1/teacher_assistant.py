"""Authenticated teacher assistant transport; long work is queued in PostgreSQL."""
from typing import Annotated
import shutil
from datetime import datetime, timezone
from fastapi import APIRouter,Depends,HTTPException,UploadFile,File,Response
from fastapi.responses import FileResponse
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession
from app.core.auth import require_role
from app.db.session import get_db
from app.models.user import User
from app.models.teacher_assistant import TeacherAssistantUpload as Upload
from app.schemas.teacher_assistant import MessageRequest,ExecuteRequest,RetryRequest
from app.services import teacher_assistant_service as service
router=APIRouter(prefix='/teacher-assistant',tags=['teacher-assistant'])
DB=Annotated[AsyncSession,Depends(get_db)]
Actor=Annotated[User,Depends(require_role('admin','teacher'))]

@router.get('/sessions')
async def sessions(db:DB,user:Actor): return await service.list_sessions(db,user)

@router.post('/sessions',status_code=201)
async def create(db:DB,user:Actor): return await service.create_session(db,user)

@router.get('/sessions/{sid}')
async def detail(sid:str,db:DB,user:Actor): return await service.envelope(db,await service.owned(db,user,sid))

@router.delete('/sessions/{sid}',status_code=204)
async def remove(sid:str,db:DB,user:Actor):
    obj=await service.owned(db,user,sid,lock=True)
    if await service.has_inflight(db,sid=sid): raise HTTPException(409,'请先取消任务，并等待当前步骤结束后再删除会话')
    await db.delete(obj);await db.commit()
    shutil.rmtree(service.storage(sid),ignore_errors=True)
    return Response(status_code=204)

@router.post('/sessions/{sid}/uploads')
async def upload(sid:str,db:DB,user:Actor,files:Annotated[list[UploadFile],File()]):
    return await service.upload_files(db,user,sid,files)

@router.get('/uploads/{uid}/file')
async def original(uid:str,db:DB,user:Actor):
    obj=await db.get(Upload,uid)
    if not obj: raise HTTPException(404,'文件不存在')
    await service.owned(db,user,obj.session_id)
    path=service.storage(obj.session_id,obj.id)/'original'
    if not path.is_file(): raise HTTPException(404,'文件已过期或不存在')
    return FileResponse(path,filename=obj.name,media_type='application/octet-stream',headers={'Cache-Control':'private, no-store','X-Content-Type-Options':'nosniff'})

@router.post('/sessions/{sid}/messages')
async def message(sid:str,body:MessageRequest,db:DB,user:Actor):
    return await service.enqueue(db,user,sid,'message',{'content':body.content},body.requestId)

@router.post('/sessions/{sid}/execute')
async def execute(sid:str,body:ExecuteRequest,db:DB,user:Actor):
    return await service.enqueue(db,user,sid,'execute',{'revision':body.revision},body.requestId)

@router.post('/sessions/{sid}/cancel')
async def cancel(sid:str,db:DB,user:Actor): return await service.cancel(db,user,sid)

@router.post('/sessions/{sid}/retry')
async def retry(sid:str,body:RetryRequest,db:DB,user:Actor): return await service.retry(db,user,sid,body.requestId)


@router.get('/uploads/{uid}/preview')
async def preview(uid:str,db:DB,user:Actor):
    from sqlalchemy.orm import undefer
    upload=(await db.execute(select(Upload).where(Upload.id==uid).options(undefer(Upload.extracted)))).scalar_one_or_none()
    if not upload: raise HTTPException(404,'文件不存在')
    await service.owned(db,user,upload.session_id)
    data=upload.extracted or {}
    sections=[]
    for item in data.get('sections',[])[:200]:
        sections.append({'location':item.get('location',''), 'text':str(item.get('text',''))[:16000],
            'images':[{'name':name,'url':f'/api/v1/teacher-assistant/uploads/{uid}/assets/{name}'} for name in item.get('images',[]) if '/' not in name and '\\' not in name]})
    if data.get('kind')=='json':
        import json
        sections=[{'location':'原始 JSON（完整内容请下载原件）','text':json.dumps(data.get('data'),ensure_ascii=False,indent=2)[:16000],'images':[]}]
    return {'sections':sections,'warnings':upload.warnings}

@router.get('/uploads/{uid}/assets/{name}')
async def asset(uid:str,name:str,db:DB,user:Actor):
    from pathlib import Path
    obj=await db.get(Upload,uid)
    if not obj: raise HTTPException(404,'文件不存在')
    await service.owned(db,user,obj.session_id)
    if Path(name).name!=name or Path(name).suffix.lower() not in ('.png','.jpg','.jpeg','.webp','.gif','.bmp','.tif','.tiff'):
        raise HTTPException(404,'图片不存在')
    base=(service.storage(obj.session_id,obj.id)/'extracted').resolve()
    path=(base/name).resolve()
    if path.parent!=base or not path.is_file(): raise HTTPException(404,'图片不存在')
    return FileResponse(path,headers={'Cache-Control':'private, no-store','X-Content-Type-Options':'nosniff'})

@router.get('/sessions/{sid}/export')
async def export(sid:str,db:DB,user:Actor,format:str='json'):
    import json
    obj=await service.owned(db,user,sid)
    if format not in ('json','report'): raise HTTPException(422,'不支持的导出格式')
    if not obj.plan: raise HTTPException(409,'请先生成预览')
    if format=='json':
        from app.services.teacher_assistant_export import standard_json
        data=await standard_json(db,user,obj)
    else:
        data={'revision':obj.revision,'summary':obj.plan.get('summary'),'blockers':obj.plan.get('blockers',[]),
            'files':[{'name':i.get('name'),'warnings':i.get('warnings',[]),'blockers':i.get('blockers',[])} for i in obj.plan.get('items',[])],'receipt':obj.receipt}
    return Response(json.dumps(data,ensure_ascii=False,indent=2),media_type='application/json',headers={'Content-Disposition':f'attachment; filename="teacher-assistant-{format}.json"','Cache-Control':'private, no-store'})


@router.get('/sessions/{sid}/status')
async def task_status(sid:str,db:DB,user:Actor):
    from app.models.teacher_assistant import TeacherAssistantSession
    row=(await db.execute(select(TeacherAssistantSession.id,TeacherAssistantSession.revision).where(TeacherAssistantSession.id==sid,TeacherAssistantSession.owner_id==user.username))).one_or_none()
    if not row: raise HTTPException(404,'会话不存在')
    job=await service.last_job(db,sid)
    return {'revision':row.revision,'job':({'id':job.id,'kind':job.kind,'status':job.status,'error':job.error} if job else None)}
