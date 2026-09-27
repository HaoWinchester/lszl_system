"""Only public lifecycle/text events; each write and replay uses a short transaction."""
import asyncio
import json
import time
from sqlalchemy import select,delete
from app.db.session import AsyncSessionLocal
from app.models.teacher_assistant import TeacherAssistantEvent as Event,TeacherAssistantJob as Job
MAX_EVENTS=4000
MAX_TEXT=64000
TYPES={'status','text_delta','tool_start','tool_end','error','done'}

async def emit(sid,jid,kind,data):
    if kind not in TYPES: raise ValueError('Unknown public event')
    if len(json.dumps(data,ensure_ascii=False).encode())>16384: raise ValueError('Event too large')
    async with AsyncSessionLocal() as db:
        job=(await db.execute(select(Job).where(Job.id==jid,Job.session_id==sid).with_for_update())).scalar_one_or_none()
        if not job: return
        state=dict(job.stream or {})
        if kind=='text_delta':
            value=str(data.get('text',''))
            if len(state.get('text',''))+len(value)>MAX_TEXT: raise ValueError('模型回复超过上限，请拆分需求')
            state['text']=state.get('text','')+value
        event=Event(session_id=sid,job_id=jid,type=kind,data=data)
        db.add(event);await db.flush()
        state['lastEventId']=event.id;job.stream=state
        cutoff=(await db.execute(select(Event.id).where(Event.session_id==sid).order_by(Event.id.desc()).offset(MAX_EVENTS).limit(1))).scalar_one_or_none()
        if cutoff is not None:
            await db.execute(delete(Event).where(Event.session_id==sid,Event.id<=cutoff))
            job.stream={**state,'retentionFloor':cutoff}
        await db.commit()

async def stream(sid,owner,after):
    from app.models.teacher_assistant import TeacherAssistantSession as Session
    deadline=time.monotonic()+15
    while time.monotonic()<deadline:
        async with AsyncSessionLocal() as db:
            # Authorization rechecked at every page, also handles deletion mid-stream.
            if not (await db.execute(select(Session.id).where(Session.id==sid,Session.owner_id==owner))).scalar_one_or_none(): return
            latest=(await db.execute(select(Job).where(Job.session_id==sid).order_by(Job.created_at.desc(),Job.id.desc()).limit(1))).scalar_one_or_none()
            resync=bool(latest and (latest.stream or {}).get('retentionFloor',0)>after)
            if resync:
                reset={'id':latest.stream['lastEventId'],'jobId':latest.id,'type':'status','data':{'status':'resync_required'}}
            rows=(await db.execute(select(Event).where(Event.session_id==sid,Event.id>after).order_by(Event.id).limit(200))).scalars().all()
            batch=[{'id':r.id,'jobId':r.job_id,'type':r.type,'data':r.data} for r in rows]
            active=(await db.execute(select(Job.id).where(Job.session_id==sid,Job.status.in_(('queued','running'))).limit(1))).scalar_one_or_none()
        if resync:
            yield f"id: {reset['id']}\ndata: {json.dumps(reset)}\n\n"
            return
        for event in batch:
            after=event['id']
            yield f'id: {after}\ndata: {json.dumps(event,ensure_ascii=False)}\n\n'
        if len(batch)==200: continue
        if not active: return
        if not batch: yield ': keepalive\n\n'
        await asyncio.sleep(.25)
