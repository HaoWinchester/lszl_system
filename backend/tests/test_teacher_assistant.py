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


def test_expired_source_can_be_uploaded_again(tmp_path,monkeypatch):
    from app.core.config import settings
    from app.models.teacher_assistant import TeacherAssistantUpload
    monkeypatch.setattr(settings,'TEACHER_ASSISTANT_STORAGE',str(tmp_path))
    a,_,_=users()
    with TestClient(app) as c:
        login(c,a)
        sid=c.post('/api/v1/teacher-assistant/sessions',json={}).json()['session']['id']
        url=f'/api/v1/teacher-assistant/sessions/{sid}/uploads'
        files={'files':('same.json',b'{"questions":[]}','application/json')}
        old=c.post(url,files=files).json()['session']['uploads'][0]['id']
        async def expire():
            async with AsyncSessionLocal() as db:
                obj=await db.get(TeacherAssistantUpload,old);obj.status='expired';obj.extracted={}
                await db.commit()
        asyncio.run(expire())
        response=c.post(url,files=files)
        assert response.status_code==200,response.text
        active=[item for item in response.json()['session']['uploads'] if item['status']!='expired']
        assert len(active)==1 and active[0]['id']!=old


def test_standard_export_is_bank_import_contract_and_report_omits_answers():
    from app.models.teacher_assistant import TeacherAssistantSession
    a,_,_=users()
    with TestClient(app) as c:
        login(c,a)
        sid=c.post('/api/v1/teacher-assistant/sessions',json={}).json()['session']['id']
        async def draft():
            async with AsyncSessionLocal() as db:
                s=await db.get(TeacherAssistantSession,sid)
                s.plan={'settings':{'publish':False},'items':[{'id':'u:b','name':'习题课','kind':'questions','questions':[{'id':'q1','title':'问题','correctAnswer':'A'}],'bankPayload':{'id':'ta_bank','name':'习题课','subject':'PMP'},'warnings':[],'blockers':[]}],'blockers':[]}
                await db.commit()
        asyncio.run(draft())
        url=f'/api/v1/teacher-assistant/sessions/{sid}/export'
        data=c.get(url).json()
        assert data['banks'][0]['questions'][0]['id']=='q1'
        assert data['banks'][0]['name']=='习题课'
        assert 'bankPayload' not in str(data)
        report=c.get(url+'?format=report').json()
        assert 'correctAnswer' not in str(report)


def test_image_export_preserves_authorized_assets_and_rejects_incomplete_mapping():
    import base64, hashlib
    from copy import deepcopy
    from app.models.teacher_assistant import TeacherAssistantSession
    from mixed_question_support import png
    a,b,_=users()
    with TestClient(app) as c:
        login(c,a)
        image=c.post('/api/v1/question-assets',json=png()).json()['asset']
        digest=hashlib.sha256(base64.b64decode(png()['dataBase64'])).hexdigest()
        sid=c.post('/api/v1/teacher-assistant/sessions',json={}).json()['session']['id']
        source={'uploadId':'upload1','filename':'page-1.png','digest':digest,'location':'第1页'}
        key='upload1:page-1.png:'+digest
        question={'id':'export-q-'+uuid4().hex[:12],'title':'含图片问题','type':'single_choice','stemParts':[{'text':'看图作答'}], 'options':[{'id':'A','text':'甲','correct':True},{'id':'B','text':'乙','correct':False}],'correctAnswer':'A','sourceImages':[source]}
        async def update(receipt):
            async with AsyncSessionLocal() as db:
                s=await db.get(TeacherAssistantSession,sid)
                s.revision=3;s.plan={'items':[{'id':'item1','name':'含图习题课','kind':'questions','questions':[deepcopy(question)],'bankPayload':{'id':'export-bank-'+sid[-10:],'subject':'PMP'},'blockers':[]}]};s.receipt=receipt
                await db.commit()
        url=f'/api/v1/teacher-assistant/sessions/{sid}/export'
        asyncio.run(update({}))
        denied=c.get(url);assert denied.status_code==409 and '先保存草稿' in denied.text
        assert c.get(url+'?format=report').status_code==200
        receipt={'revision':3,'status':'succeeded','items':[{'itemId':'item1','status':'succeeded','bankId':'saved-bank','assets':{key:image}}]}
        asyncio.run(update(receipt));exported=c.get(url)
        assert exported.status_code==200,exported.text
        payload=exported.json();q=payload['banks'][0]['questions'][0]
        assert payload['format']=='teacher-assistant-bundle-v1' and payload['principleBundles']==[]
        assert q['images']==[image] and 'sourceImages' not in q
        assert c.get(q['images'][0]['url']).status_code==200
        async def original_unchanged():
            async with AsyncSessionLocal() as db:
                s=await db.get(TeacherAssistantSession,sid)
                assert s.plan['items'][0]['questions'][0]['sourceImages']==[source]
        asyncio.run(original_unchanged())
        imported=c.post('/api/v1/banks/import',json={'banks':payload['banks']})
        assert imported.status_code==200,imported.text
        incomplete=deepcopy(receipt);incomplete['items'][0]['assets']={}
        asyncio.run(update(incomplete));assert c.get(url).status_code==409
        mismatch=deepcopy(receipt);mismatch['revision']=2
        asyncio.run(update(mismatch));assert c.get(url).status_code==409
        missing=deepcopy(receipt);missing['items'][0]['assets'][key]={'id':'not-an-asset'}
        asyncio.run(update(missing));assert c.get(url).status_code==409
        login(c,b);foreign=c.post('/api/v1/question-assets',json=png()).json()['asset']
        denied_owner=deepcopy(receipt);denied_owner['items'][0]['assets'][key]=foreign
        asyncio.run(update(denied_owner));login(c,a);assert c.get(url).status_code==409
        login(c,b);assert c.get(url).status_code==404
