import asyncio
from datetime import datetime,timedelta,timezone
from uuid import uuid4
from app.core.config import settings
from app.db.session import AsyncSessionLocal
from app.models.user import User
from app.models.teacher_assistant import TeacherAssistantSession as Session,TeacherAssistantUpload as Upload,TeacherAssistantJob as Job
from app.services.teacher_assistant_retention import cleanup,EXPIRED_WARNING,_safe_directory


def test_retention_real_database(tmp_path,monkeypatch):
    monkeypatch.setattr(settings,'TEACHER_ASSISTANT_STORAGE',str(tmp_path))
    async def run():
        now=datetime.now(timezone.utc);old=now-timedelta(days=200);owner='ret-'+uuid4().hex[:10];ids=['tas_'+uuid4().hex for _ in range(4)]
        async with AsyncSessionLocal() as db:
            db.add(User(username=owner,password_hash='unused',role='teacher',status='active'));await db.flush()
            for index,sid in enumerate(ids):
                receipt={'revision':2,'status':'succeeded','items':[{'itemId':'one','status':'succeeded','bankId':'bank','paperId':'paper','releaseId':'release','name':'name','links':[],'result':{'large':'body'}}]} if index==2 else {}
                db.add(Session(id=sid,owner_id=owner,title='会话',messages=[{'content':'原对话'}],plan={'items':[{'id':'one'}]},receipt=receipt,revision=2,created_at=old,updated_at=old));await db.flush()
                uid='tau_'+uuid4().hex;db.add(Upload(id=uid,session_id=sid,name='lesson.json',size=2,digest='a'*64,status='ready',extracted={'data':{}},warnings=[],created_at=old))
                directory=tmp_path/sid/uid;directory.mkdir(parents=True);(directory/'original').write_text('{}')
                if index:
                    db.add(Job(id='taj_'+uuid4().hex,session_id=sid,owner_id=owner,request_id=uuid4().hex,kind='message' if index==1 else 'execute',status='running' if index==1 else 'succeeded' if index==2 else 'failed',payload={'revision':2},attempts=1,lease_until=now+timedelta(minutes=2) if index==1 else None,created_at=old,updated_at=old))
            await db.commit();result=await cleanup(db,now)
            assert result['uploadsExpired']>=1 and result['receiptsCompacted']>=1
            assert result['sessions'] <= 20
            first=await db.get(Session,ids[0],populate_existing=True)
            assert first.messages==[{'content':'原对话'}] and first.plan['items']==[{'id':'one'}]
            assert EXPIRED_WARNING in first.plan['blockers']
            assert not any((tmp_path/ids[0]).glob('*/original'))
            assert all(any((tmp_path/sid).glob('*/original')) for sid in ids[1:])
            published=await db.get(Session,ids[2],populate_existing=True)
            assert published.receipt['items']==[{'itemId':'one','status':'succeeded','bankId':'bank','paperId':'paper','releaseId':'release'}]
            second=await cleanup(db,now);assert second['uploadsExpired']==second['receiptsCompacted']==0
    asyncio.run(run())


def test_retention_path_safety(tmp_path,monkeypatch):
    root=tmp_path/'root';outside=tmp_path/'outside';root.mkdir();outside.mkdir();(outside/'keep').write_text('safe')
    monkeypatch.setattr(settings,'TEACHER_ASSISTANT_STORAGE',str(root));(root/'session').symlink_to(outside,target_is_directory=True)
    assert _safe_directory('session','upload') is None and _safe_directory('../outside','upload') is None
    assert (outside/'keep').read_text()=='safe'
