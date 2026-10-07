"""Owner-isolated assistant state. API only queues heavy work."""
from datetime import datetime,timezone
from pathlib import Path
from uuid import uuid4
from copy import deepcopy
import os
import asyncio
import hashlib
import shutil
from fastapi import HTTPException, UploadFile
from sqlalchemy import select, text, or_
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
    return (await db.execute(select(Job).where(Job.session_id==sid).order_by(Job.created_at.desc(),Job.id.desc()).limit(1).execution_options(populate_existing=True))).scalar_one_or_none()

async def has_inflight(db,*,owner=None,sid=None):
    query=select(Job.id).where(or_(Job.status.in_(ACTIVE),Job.lease_until>datetime.now(timezone.utc)))
    if owner is not None: query=query.where(Job.owner_id==owner)
    if sid is not None: query=query.where(Job.session_id==sid)
    return (await db.execute(query.limit(1))).scalar_one_or_none() is not None

def native_id(obj):
    # Stable also for existing sessions, without mutating on GET.
    from uuid import uuid5,NAMESPACE_URL
    return str(uuid5(NAMESPACE_URL,'teacher-assistant:'+obj.id))

def runtime_state(obj,job):
    active=bool(job and (job.status=='running' or job.lease_until and job.lease_until>datetime.now(timezone.utc)))
    status='stopping' if active and job.status=='cancelled' else (job.status if job and job.status in ACTIVE else 'idle')
    return {'sessionId':native_id(obj),'active':active,'status':status}

async def activate(db,user,sid):
    await actor_lock(db,user)
    obj=await owned(db,user,sid)
    jobs=(await db.execute(select(Job).where(Job.owner_id==user.username,Job.session_id!=sid,
        or_(Job.status.in_(ACTIVE),Job.lease_until>datetime.now(timezone.utc))).with_for_update())).scalars().all()
    for job in jobs:
        job.status='cancelled';job.error='切换会话，正在结束当前步骤'
    stopped=[(job.session_id,job.id,bool(job.lease_until and job.lease_until>datetime.now(timezone.utc))) for job in jobs]
    stopping=any(live for _,_,live in stopped)
    await db.commit();await db.refresh(obj)
    from app.services.teacher_assistant_events import emit
    for prior_sid,jid,live in stopped:
        await emit(prior_sid,jid,'status' if live else 'done',{'status':'stopping' if live else 'cancelled'})
    if stopping: raise HTTPException(409,'正在停止之前的会话，请等待进程退出后重试')
    return await envelope(db,obj)

async def envelope(db,obj):
    # Protect the messages-to-stream handoff while taking a consistent snapshot.
    await db.refresh(obj,with_for_update={"read":True})
    uploads=(await db.execute(select(Upload).where(Upload.session_id==obj.id).order_by(Upload.created_at))).scalars().all()
    job=await last_job(db,obj.id)
    plan=deepcopy(obj.plan)
    for item in plan.get('items',[]): item.pop('bankPayload',None)
    return {'session':{'id':obj.id,'title':obj.title,'revision':obj.revision,'messages':obj.messages,'plan':plan,'receipt':obj.receipt or None,
        'runtime':runtime_state(obj,job),'stream':{'jobId':job.id if job else None,'text':(job.stream or {}).get('text','') if job and not (job.stream or {}).get('committed') else '', 'lastEventId':(job.stream or {}).get('lastEventId',0) if job else 0},
        'uploads':[{'id':u.id,'name':u.name,'size':u.size,'sha256':u.digest,'status':u.status,'warnings':u.warnings,'previewUrl':f'/api/v1/teacher-assistant/uploads/{u.id}/preview','downloadUrl':f'/api/v1/teacher-assistant/uploads/{u.id}/file'} for u in uploads],
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
    busy=await has_inflight(db,owner=user.username)
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
    jid=new_id('taj_')
    db.add(Job(id=jid,session_id=sid,owner_id=user.username,request_id=request_id,kind=kind,payload=payload,status='queued'))
    await db.commit(); await db.refresh(obj)
    from app.services.teacher_assistant_events import emit
    await emit(sid,jid,'status',{'status':'queued'})
    return await envelope(db,obj)

async def upload_files(db,user,sid,files:list[UploadFile]):
    await actor_lock(db,user)
    obj=await owned(db,user,sid,lock=True)
    if await has_inflight(db,sid=sid): raise HTTPException(409,'请等待当前任务结束后再上传')
    prior=(await db.execute(select(Upload).where(Upload.session_id==sid,Upload.status!='expired'))).scalars().all()
    if not files or len(files)>5: raise HTTPException(422,'每批最多上传 5 个文件')
    total=sum(u.size for u in prior); incoming=0; pending=[]; added=False
    try:
        for file in files:
            name=Path(file.filename or '').name[:255]
            validate_upload(name,1)
            uid=new_id('tau_'); directory=storage(sid,uid); directory.mkdir(parents=True,exist_ok=False)
            pending.append(directory)
            # API runs as root in Docker; the isolated worker uses uid/gid10001.
            # Give only that worker access to the shared private volume.
            for private_dir in (storage(sid).parent,storage(sid),directory):
                private_dir.chmod(0o750)
                if os.geteuid()==0: os.chown(private_dir,10001,10001)
            size=0; digest=hashlib.sha256()
            with (directory/'original').open('wb') as target:
                while chunk:=await file.read(64*1024):
                    size+=len(chunk); incoming+=len(chunk)
                    if size>20*1024*1024 or incoming>50*1024*1024: raise DocumentError('单文件限 20 MiB，每批合计限 50 MiB')
                    digest.update(chunk);target.write(chunk)
            validate_upload(name,size)
            if Path(name).suffix.lower() in {'.png','.jpg','.jpeg','.webp'}:
                from app.services.teacher_assistant_documents import validate_image
                await asyncio.to_thread(validate_image,directory/'original',Path(name).suffix.lower())
            (directory/'original').chmod(0o640)
            if os.geteuid()==0: os.chown(directory/'original',10001,10001)
            if any(u.digest==digest.hexdigest() for u in prior):
                shutil.rmtree(directory);pending.remove(directory);continue
            if len(prior)>=5 or total+size>50*1024*1024:
                raise DocumentError('每个会话最多 5 个不同文件，合计限 50 MiB')
            total+=size;added=True
            entry=Upload(id=uid,session_id=sid,name=name,size=size,digest=digest.hexdigest(),status='uploaded',extracted={},warnings=[])
            db.add(entry);prior.append(entry)
        if added: obj.plan={};obj.revision+=1
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
    changed=bool(job and job.status in ACTIVE)
    if changed:
        job.status='cancelled';job.error='已取消未执行步骤；已提交的结果仍保留'
        jid=job.id;live=bool(job.lease_until and job.lease_until>datetime.now(timezone.utc))
    await db.commit();await db.refresh(obj)
    if changed:
        from app.services.teacher_assistant_events import emit
        await emit(sid,jid,'status' if live else 'done',{'status':'stopping' if live else 'cancelled'})
    return await envelope(db,obj)

async def retry(db,user,sid,request_id):
    await owned(db,user,sid)
    job=await last_job(db,sid)
    if not job or job.status not in ('failed','cancelled'): raise HTTPException(409,'当前任务无需重试')
    if job.lease_until and job.lease_until > datetime.now(timezone.utc): raise HTTPException(409,'正在结束当前步骤，请稍后重试')
    kind,payload=job.kind,dict(job.payload)
    # Message is already durable. Retrying must not append it a second time.
    await actor_lock(db,user)
    obj=await owned(db,user,sid,lock=True)
    busy=await has_inflight(db,owner=user.username)
    if busy: raise HTTPException(409,'已有任务执行中')
    job.status='queued';job.error='';job.lease_until=None;job.attempts=0
    job.stream={'text':'','lastEventId':(job.stream or {}).get('lastEventId',0)}
    await db.commit();await db.refresh(obj);return await envelope(db,obj)


QUICK_PHRASES = [
    {'title': '导入文件中的题目', 'content': '请读取我上传的文件，按原文提取题干、选项、答案和解析，生成导入预览。缺失或无法识别的内容请标出，不要自行补全。'},
    {'title': '导入联想库文件', 'content': '我上传的是联想库 JSON（含 nodes/edges 与顶层 subjectId），请识别并生成联想库导入预览，不要当作题库解析。'},
    {'title': '导入原则卡文件', 'content': '我上传的是原则卡束 JSON，请识别并生成原则导入预览，列出与现有原则的冲突供我确认。'},
    {'title': '核对答案与解析', 'content': '请对照上传文件，核对导入预览中的题号、选项、答案和解析是否对应，列出不一致及需要人工确认的地方。'},
    {'title': '检查漏题和重复', 'content': '请对照上传文件检查导入预览，确认是否漏题或重复，保留多选题和案例题的完整结构，并说明原文件与预览的题量差异。'},
    {'title': '仅保存为草稿', 'content': '请将当前导入方案设置为仅保存草稿，不发布。保留原文内容，先展示预览供我确认。'},
]


def quick_phrases(user):
    return {'username': user.username, 'defaults': QUICK_PHRASES, 'custom': user.assistant_phrases or []}


async def save_quick_phrases(db, user, body):
    if body.username != user.username:
        raise HTTPException(409, '登录账号已变化，请刷新后再保存快捷话语')
    user.assistant_phrases = [item.model_dump() for item in body.custom]
    await db.commit()
    await db.refresh(user)
    return quick_phrases(user)
