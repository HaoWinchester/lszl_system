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
