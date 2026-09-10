import pytest
from mixed_question_support import mixed_data_cleanup
pytestmark = pytest.mark.usefixtures("mixed_data_cleanup")
import asyncio
from fastapi.testclient import TestClient
from sqlalchemy import select
from app.main import app
from app.db.session import AsyncSessionLocal
from app.models.paper_release import PaperReleaseQuestion
from mixed_question_support import seed_users, login, png, questions, publish

def test_material_revision_assets_access_and_immutable_release():
    ids = asyncio.run(seed_users())
    with TestClient(app) as client:
        login(client, ids['teacher'])
        uploaded = client.post('/api/v1/question-assets', json=png())
        assert uploaded.status_code == 201, uploaded.text
        asset = uploaded.json()['asset']
        material = client.post('/api/v1/question-materials', json={'title':'案例','text':'旧材料','images':[asset]}).json()['material']
        assert client.get('/api/v1/question-materials/'+material['id']).json()['material'] == material
        release_id = asyncio.run(publish(ids, questions(ids, material, asset)))
        updated = client.put('/api/v1/question-materials/'+material['id'], json={'title':'案例','text':'新材料','images':[asset], 'revision':1})
        assert updated.status_code == 200, updated.text
        assert updated.json()['material']['revision'] == 2
        conflict = client.put('/api/v1/question-materials/'+material['id'], json={'title':'覆盖','revision':1})
        assert conflict.status_code == 409
        assert conflict.json()['detail']['currentRevision'] == 2
        assert client.delete('/api/v1/question-materials/'+material['id']+'?revision=2').status_code == 409
        async def frozen():
            async with AsyncSessionLocal() as db:
                rows = (await db.scalars(select(PaperReleaseQuestion).where(PaperReleaseQuestion.release_id == release_id).order_by(PaperReleaseQuestion.order_index))).all()
                assert len(rows) == 7
                assert rows[4].snapshot['material']['text'] == '旧材料'
                assert rows[4].snapshot['material']['revision'] == 1
        asyncio.run(frozen())
        login(client, ids['other'])
        assert client.get('/api/v1/question-materials/'+material['id']).status_code == 404
        assert client.get(asset['url']).status_code == 404
        login(client, ids['student'])
        assert client.get(asset['url']).status_code == 200
        assert client.get(asset['url']+'/content').json()['dataBase64'] == png()['dataBase64']
        assert client.post('/api/v1/question-assets', json=png()).status_code == 403
        assert client.get('/api/v1/question-materials').status_code == 403

def test_invalid_and_unreferenced_assets_are_rejected():
    ids = asyncio.run(seed_users())
    with TestClient(app) as client:
        login(client, ids['teacher'])
        assert client.post('/api/v1/question-assets', json={**png(), 'dataBase64':'YWJj'}).status_code == 422
        assert client.post('/api/v1/question-assets', json={**png(), 'mimeType':'image/svg+xml'}).status_code == 422
        asset = client.post('/api/v1/question-assets', json=png()).json()['asset']
        assert client.post('/api/v1/question-materials', json={'title':'远程','images':[{'id':'remote','url':'https://example.com/a.png'}]}).status_code == 404
        material = client.post('/api/v1/question-materials', json={'title':'未引用'}).json()['material']
        assert client.delete('/api/v1/question-materials/'+material['id']+'?revision=1').status_code == 204
        login(client, ids['student'])
        assert client.get(asset['url']).status_code == 404


def test_latest_material_hydration_case_integrity_and_wrong_child_review():
    import pytest
    from fastapi import HTTPException
    from app.services import question_catalog_service, question_service, paper_service
    from app.models.user import User
    from app.schemas.paper import PaperCreateRequest
    ids = asyncio.run(seed_users())
    with TestClient(app) as client:
        login(client, ids['teacher'])
        material = client.post('/api/v1/question-materials', json={'title':'共享案例','text':'v1'}).json()['material']
        qs = questions(ids, material)
        async def create_catalog():
            async with AsyncSessionLocal() as db:
                user = await db.get(User, ids['teacher'])
                saved = []
                for q in qs:
                    saved.append(question_catalog_service.question_to_payload(await question_service.create_question(db, user, ids['bank'], q)))
                return saved
        qs = asyncio.run(create_catalog())
        updated = client.put('/api/v1/question-materials/'+material['id'], json={'revision':1,'title':'共享案例','text':'v2'}).json()['material']
        async def check_catalog_and_refs():
            async with AsyncSessionLocal() as db:
                user = await db.get(User, ids['teacher'])
                current = await question_catalog_service.get_catalog_question(db, user, qs[4]['id'])
                assert current['material']['revision'] == 2 and current['material']['text'] == 'v2'
                request = PaperCreateRequest(name='不完整案例', paperType='mixed', questions=[{'bankId':ids['bank'],'questionId':qs[4]['id'],'order':1}])
                with pytest.raises(HTTPException) as error:
                    await paper_service.create_paper(db, user, request)
                assert error.value.detail['code'] == 'CASE_GROUP_INVALID'
        asyncio.run(check_catalog_and_refs())
        with pytest.raises(HTTPException) as error:
            asyncio.run(publish(ids, qs[:-1]))
        assert error.value.detail['code'] == 'CASE_GROUP_INVALID'
        release_id = asyncio.run(publish(ids, qs))
        login(client, ids['student'])
        path = '/api/v1/learning/practice/sessions'
        session = client.post(path+'/start', json={'paperId':ids['paper'],'releaseId':release_id,'mode':'challenge','count':7}).json()['session']
        children = [row['question'] for row in session['questions'] if row['question'].get('caseGroup')]
        assert [q['caseGroup']['order'] for q in children] == [1,2,3]
        assert all(q['material']['revision'] == 2 for q in children)
        wrong_id = children[0]['id']
        complete = client.post(path+'/'+session['id']+'/complete', json={'revision':session['revision'],'answers':{wrong_id:{'selectedAnswer':'B','selectionIndex':1}}})
        assert complete.status_code == 200, complete.text
        revenge = client.post(path+'/start', json={'mode':'revenge','count':1})
        assert revenge.status_code == 200, revenge.text
        question = revenge.json()['session']['questions'][0]['question']
        assert question['id'] == wrong_id and question['material']['text'] == 'v2'
        assert question['caseGroup']['total'] == 3


def test_question_save_material_edit_is_atomic_and_command_is_transient():
    from uuid import uuid4
    ids = asyncio.run(seed_users())
    with TestClient(app) as client:
        login(client, ids['teacher'])
        body = questions(ids)[0]
        body.update(materialEdit={'title':'材料v1','text':'v1','images':[]}, caseGroup={'id':'','order':1,'total':1})
        created = client.post('/api/v1/banks/'+ids['bank']+'/questions', json=body)
        assert created.status_code in (200,201), created.text
        q = created.json()['question']; mid = q['material']['id']
        assert q['caseGroup']['id'] == mid and q['material']['revision'] == 1
        assert 'materialEdit' not in q and '_materialEdit' not in q
        editor = 'atomic-editor'
        lock = client.post('/api/v1/content-prep/locks/'+q['id'], json={'clientInstanceId':editor}).json()
        changed = {**q, 'materialEdit':{'id':mid,'revision':1,'title':'材料v2','text':'v2','images':[]}}
        payload = {'idempotencyKey':uuid4().hex,'clientInstanceId':editor,'question':changed,'baseRevision':q['revision']+1,'lockToken':lock['lockToken']}
        invalid = client.put('/api/v1/content-prep/questions/'+q['id'], json=payload)
        assert invalid.status_code == 409, invalid.text
        assert client.get('/api/v1/question-materials/'+mid).json()['material']['revision'] == 1
        # Invalid matching content also rolls back the prepared material update.
        payload.update(idempotencyKey=uuid4().hex, baseRevision=q['revision'])
        payload['question'] = {**changed, 'type':'matching','matching':{'left':[],'right':[],'correctPairs':{}}}
        invalid = client.put('/api/v1/content-prep/questions/'+q['id'], json=payload)
        assert invalid.status_code == 422, invalid.text
        assert client.get('/api/v1/question-materials/'+mid).json()['material']['text'] == 'v1'
        payload.update(idempotencyKey=uuid4().hex, question=changed)
        saved = client.put('/api/v1/content-prep/questions/'+q['id'], json=payload)
        assert saved.status_code == 200, saved.text
        assert saved.json()['question']['material']['text'] == 'v2'
        assert 'materialEdit' not in saved.json()['question']
        repeated = client.put('/api/v1/content-prep/questions/'+q['id'], json=payload)
        assert repeated.status_code == 200, repeated.text
        assert client.get('/api/v1/question-materials/'+mid).json()['material']['revision'] == 2


def test_bank_question_create_rejects_invalid_payload_before_material_edit():
    ids = asyncio.run(seed_users())
    with TestClient(app) as client:
        login(client, ids['teacher'])
        # Validation failure on the question payload must leave no material row behind.
        body = questions(ids)[0]
        body.update(type='matching', options=[], correctAnswer=None, correctOptionIds=[],
                    matching={'left': [], 'right': [], 'correctPairs': {}},
                    materialEdit={'title':'不应存在','text':'x','images':[]})
        rejected = client.post('/api/v1/banks/'+ids['bank']+'/questions', json=body)
        assert rejected.status_code == 422, rejected.text
        rows = client.get('/api/v1/question-materials').json()
        assert all(row['title'] != '不应存在' for row in rows.get('materials', rows))
