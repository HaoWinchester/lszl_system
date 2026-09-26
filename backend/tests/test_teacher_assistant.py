"""Private teacher conversations, durable jobs and repeat-click invariants."""
import asyncio
from uuid import uuid4
from fastapi.testclient import TestClient
from app.main import app
from app.core.security import hash_password
from app.db.session import AsyncSessionLocal
from app.models.user import User


def users():
    ids = [f'ta-{uuid4().hex[:12]}' for _ in range(3)]
    async def seed():
        async with AsyncSessionLocal() as db:
            for name, role in zip(ids, ['teacher','teacher','student']):
                db.add(User(username=name,password_hash=hash_password('test-assistant'),role=role,status='active'))
            await db.commit()
    asyncio.run(seed())
    return ids


def login(client, name):
    assert client.post('/api/v1/auth/login', json={'username':name,'password':'test-assistant'}).status_code == 200


def test_private_session_roles_and_durable_idempotent_messages():
    a,b,student = users()
    with TestClient(app) as client:
        login(client,student)
        assert client.post('/api/v1/teacher-assistant/sessions',json={}).status_code == 403
        login(client,a)
        created = client.post('/api/v1/teacher-assistant/sessions',json={})
        assert created.status_code == 201, created.text
        sid=created.json()['session']['id']; url=f'/api/v1/teacher-assistant/sessions/{sid}'
        body={'content':'请整理成习题课，先保存草稿','requestId':uuid4().hex}
        first=client.post(url+'/messages',json=body)
        second=client.post(url+'/messages',json=body)
        assert first.status_code==second.status_code==200
        assert first.json()['session']['job']['id']==second.json()['session']['job']['id']
        assert len(second.json()['session']['messages'])==1
        assert client.post(url+'/messages',json={**body,'requestId':uuid4().hex}).status_code==409
        assert client.post(url+'/cancel',json={}).status_code==200
        assert client.get(url).json()['session']['job']['status']=='cancelled'
        login(client,b)
        assert client.get(url).status_code==404
        assert client.delete(url).status_code==404
        assert client.get('/api/v1/teacher-assistant/sessions').json()['sessions']==[]


def test_upload_limits_and_original_download_is_private(tmp_path,monkeypatch):
    from app.core.config import settings
    monkeypatch.setattr(settings,'TEACHER_ASSISTANT_STORAGE',str(tmp_path))
    a,b,_=users()
    with TestClient(app) as c:
        login(c,a)
        sid=c.post('/api/v1/teacher-assistant/sessions',json={}).json()['session']['id']
        url=f'/api/v1/teacher-assistant/sessions/{sid}'
        bad=c.post(url+'/uploads',files={'files':('evil.exe',b'no','application/octet-stream')})
        assert bad.status_code==422
        r=c.post(url+'/uploads',files={'files':('test.json',b'{"questions":[]}','application/json')})
        assert r.status_code==200,r.text
        upload=r.json()['session']['uploads'][0]
        assert c.get(upload['downloadUrl']).content==b'{"questions":[]}'
        login(c,b)
        assert c.get(upload['downloadUrl']).status_code==404


def test_polling_status_does_not_return_business_payloads():
    a,b,_=users()
    with TestClient(app) as c:
        login(c,a)
        sid=c.post('/api/v1/teacher-assistant/sessions',json={}).json()['session']['id']
        url=f'/api/v1/teacher-assistant/sessions/{sid}'
        status=c.get(url+'/status')
        assert status.status_code==200
        assert set(status.json())=={'revision','job'}
        login(c,b)
        assert c.get(url+'/status').status_code==404
