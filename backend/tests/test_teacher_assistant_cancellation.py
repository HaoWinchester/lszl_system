"""Cancelled in-flight jobs keep their lease until their bounded step exits."""
import asyncio
from datetime import datetime,timedelta,timezone
from uuid import uuid4
from fastapi.testclient import TestClient
from app.main import app
from app.core.security import hash_password
from app.db.session import AsyncSessionLocal
from app.models.user import User
from app.models.teacher_assistant import TeacherAssistantSession as Session,TeacherAssistantJob as Job


def test_any_older_live_lease_blocks_new_work_and_session_deletion():
    token=uuid4().hex;owner='cancel-'+token[:12];sid='tas_'+token;old='taj_'+uuid4().hex
    async def seed():
        async with AsyncSessionLocal() as db:
            db.add(User(username=owner,password_hash=hash_password('cancel-test'),role='teacher',status='active'));await db.flush()
            db.add(Session(id=sid,owner_id=owner,title='取消测试',messages=[],plan={},receipt={},revision=1));await db.flush()
            now=datetime.now(timezone.utc)
            db.add(Job(id=old,session_id=sid,owner_id=owner,request_id=uuid4().hex,kind='message',payload={'content':'旧任务'},status='cancelled',lease_until=now+timedelta(minutes=5),created_at=now-timedelta(minutes=1)))
            db.add(Job(id='taj_'+uuid4().hex,session_id=sid,owner_id=owner,request_id=uuid4().hex,kind='message',payload={'content':'新任务'},status='cancelled',created_at=now))
            await db.commit()
    asyncio.run(seed())
    with TestClient(app) as client:
        assert client.post('/api/v1/auth/login',json={'username':owner,'password':'cancel-test'}).status_code==200
        url=f'/api/v1/teacher-assistant/sessions/{sid}'
        assert client.delete(url).status_code==409
        assert client.post(url+'/messages',json={'content':'继续','requestId':uuid4().hex}).status_code==409
        assert client.post(url+'/uploads',files={'files':('x.json',b'{}','application/json')}).status_code==409
        async def finish():
            async with AsyncSessionLocal() as db:
                job=await db.get(Job,old);job.lease_until=None;await db.commit()
        asyncio.run(finish())
        assert client.delete(url).status_code==204
