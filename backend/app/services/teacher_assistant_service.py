"""Owner-isolated assistant state. API only queues heavy work."""
from datetime import datetime,timezone
from pathlib import Path
from uuid import uuid4
from copy import deepcopy
import hashlib
import shutil
from fastapi import HTTPException, UploadFile
from sqlalchemy import select, text
from app.core.config import settings
from app.models.teacher_assistant import TeacherAssistantSession as Session, TeacherAssistantUpload as Upload, TeacherAssistantJob as Job
from app.services.teacher_assistant_documents import validate_upload, DocumentError

ACTIVE=('queued','running')
def new_id(prefix): return prefix+uuid4().hex

def storage(session_id, upload_id=''):
    return Path(settings.TEACHER_ASSISTANT_STORAGE)/session_id/upload_id

async def owned(db,user,sid,lock=False):
    query=select(Session).where(Session.id==sid,Session.owner_id==user.username)
    if lock: query=query.with_for_update()
    obj=(await db.execute(query)).scalar_one_or_none()
    if not obj: raise HTTPException(404,'会话不存在')
    return obj

async def actor_lock(db,user):
    await db.execute(text('SELECT pg_advisory_xact_lock(hashtext(:key))'),{'key':'teacher-assistant:'+user.username})

async def last_job(db,sid):
    return (await db.execute(select(Job).where(Job.session_id==sid).order_by(Job.created_at.desc(),Job.id.desc()).limit(1))).scalar_one_or_none()

async def envelope(db,obj):
    uploads=(await db.execute(select(Upload).where(Upload.session_id==obj.id).order_by(Upload.created_at))).scalars().all()
    job=await last_job(db,obj.id)
    plan=deepcopy(obj.plan)
    for item in plan.get('items',[]): item.pop('bankPayload',None)
    return {'session':{'id':obj.id,'title':obj.title,'revision':obj.revision,'messages':obj.messages,'plan':plan,'receipt':obj.receipt or None,
        'uploads':[{'id':u.id,'name':u.name,'size':u.size,'status':u.status,'warnings':u.warnings,'previewUrl':f'/api/v1/teacher-assistant/uploads/{u.id}/preview','downloadUrl':f'/api/v1/teacher-assistant/uploads/{u.id}/file'} for u in uploads],
        'job':({'id':job.id,'kind':job.kind,'status':job.status,'error':job.error} if job else None)}}

async def create_session(db,user):
    obj=Session(id=new_id('tas_'),owner_id=user.username,title='新的整理任务',messages=[],plan={},receipt={},revision=1)
    db.add(obj); await db.commit(); await db.refresh(obj)
    return await envelope(db,obj)

async def list_sessions(db,user):
    rows=(await db.execute(select(Session.id,Session.title,Session.updated_at).where(Session.owner_id==user.username).order_by(Session.updated_at.desc()).limit(100))).all()
    return {'sessions':[{'id':r.id,'title':r.title,'updatedAt':r.updated_at.isoformat()} for r in rows]}

async def enqueue(db,user,sid,kind,payload,request_id):
    await actor_lock(db,user)
    obj=await owned(db,user,sid,lock=True)
    existing=(await db.execute(select(Job).where(Job.session_id==sid,Job.request_id==request_id))).scalar_one_or_none()
    if existing:
        if existing.kind!=kind or existing.payload!=payload: raise HTTPException(409,'相同请求标识不能用于不同操作')
        return await envelope(db,obj)
    busy=(await db.execute(select(Job.id).where(Job.owner_id==user.username,Job.status.in_(ACTIVE)).limit(1))).scalar_one_or_none()
    if busy: raise HTTPException(409,'已有整理任务正在执行，请等待或取消')
    if kind=='message':
        content=payload['content'].strip()
        if not content: raise HTTPException(422,'请输入需求')
        if len(obj.messages)>=100: raise HTTPException(422,'本会话已达到消息上限，请新建会话')
        obj.messages=[*obj.messages,{'role':'user','content':content,'createdAt':datetime.now(timezone.utc).isoformat()}]
        if obj.title=='新的整理任务': obj.title=content[:80]
    elif kind=='execute':
        if payload['revision']!=obj.revision: raise HTTPException(409,'预览已更新，请查看最新内容后再确认')
        if not obj.plan.get('items'): raise HTTPException(422,'请先上传文件并生成预览')
        if obj.plan.get('blockers'): raise HTTPException(422,'仍有待核对内容，请先处理')
    db.add(Job(id=new_id('taj_'),session_id=sid,owner_id=user.username,request_id=request_id,kind=kind,payload=payload,status='queued'))
    await db.commit(); await db.refresh(obj)
    return await envelope(db,obj)

async def upload_files(db,user,sid,files:list[UploadFile]):
    await actor_lock(db,user)
    obj=await owned(db,user,sid,lock=True)
    job=await last_job(db,sid)
    if job and job.status in ACTIVE: raise HTTPException(409,'请等待当前任务完成再上传')
    prior=(await db.execute(select(Upload).where(Upload.session_id==sid))).scalars().all()
    if not files or len(files)+len(prior)>5: raise HTTPException(422,'每个会话最多上传 5 个文件')
    total=sum(u.size for u in prior); pending=[]
    try:
        for file in files:
            name=Path(file.filename or '').name[:255]
            validate_upload(name,1)
            uid=new_id('tau_'); directory=storage(sid,uid); directory.mkdir(parents=True,exist_ok=False)
            pending.append(directory)
            size=0; digest=hashlib.sha256()
            with (directory/'original').open('wb') as target:
                while chunk:=await file.read(64*1024):
                    size+=len(chunk); total+=len(chunk)
                    if size>20*1024*1024 or total>50*1024*1024: raise DocumentError('单文件限 20 MiB，会话合计限 50 MiB')
                    digest.update(chunk);target.write(chunk)
            validate_upload(name,size)
            if any(u.digest==digest.hexdigest() for u in prior):
                shutil.rmtree(directory);pending.remove(directory);continue
            entry=Upload(id=uid,session_id=sid,name=name,size=size,digest=digest.hexdigest(),status='uploaded',extracted={},warnings=[])
            db.add(entry);prior.append(entry)
        obj.plan={};obj.revision+=1
        await db.commit();await db.refresh(obj)
        return await envelope(db,obj)
    except BaseException as exc:
        await db.rollback()
        for directory in pending: shutil.rmtree(directory,ignore_errors=True)
        if isinstance(exc,DocumentError): raise HTTPException(422,str(exc)) from exc
        raise
    finally:
        for file in files: await file.close()

async def cancel(db,user,sid):
    obj=await owned(db,user,sid,lock=True);job=await last_job(db,sid)
    if job and job.status in ACTIVE:
        job.status='cancelled';job.error='已取消未执行步骤；已提交的结果仍保留'
    await db.commit();await db.refresh(obj);return await envelope(db,obj)

async def retry(db,user,sid,request_id):
    await owned(db,user,sid)
    job=await last_job(db,sid)
    if not job or job.status not in ('failed','cancelled'): raise HTTPException(409,'当前任务无需重试')
    if job.lease_until and job.lease_until > datetime.now(timezone.utc): raise HTTPException(409,'正在结束当前步骤，请稍后重试')
    kind,payload=job.kind,dict(job.payload)
    # Message is already durable. Retrying must not append it a second time.
    await actor_lock(db,user)
    obj=await owned(db,user,sid,lock=True)
    busy=(await db.execute(select(Job.id).where(Job.owner_id==user.username,Job.status.in_(ACTIVE)).limit(1))).scalar_one_or_none()
    if busy: raise HTTPException(409,'已有任务执行中')
    job.status='queued';job.error='';job.lease_until=None;job.attempts=0
    await db.commit();await db.refresh(obj);return await envelope(db,obj)
