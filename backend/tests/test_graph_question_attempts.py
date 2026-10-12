"""Canonical grading, retry integrity, immutable revisions and history lifetime."""
import asyncio
from fastapi.testclient import TestClient
from sqlalchemy import select,func
from app.main import app
from app.db.session import AsyncSessionLocal
from app.models.question import Question
from app.models.question_material import QuestionMaterial,QuestionMaterialRevision
from app.models.graph_question import GraphQuestionBinding,GraphQuestionAttempt
from app.models.user import User
from app.services import file_service,question_service,question_cleanup_reference_service
from test_graph_question_access import data,login,create_card,bind,path,trusted_clone,assert_safe


def test_canonical_grading_retry_conflicts_and_read_after_submit(data):
    d=data
    with TestClient(app) as c:
        login(c,d,'teacher');source=create_card(c);bind(c,source,[d.q,d.multi,d.match])
        login(c,d,'student');file=create_card(c);asyncio.run(trusted_clone(d,source,file))
        bindings=c.get(path(file)).json()['bindings'];assert_safe({'bindings':bindings})
        for index,(binding,selection) in enumerate(zip(bindings,[{'selectedOptionIds':['A']},{'selectedOptionIds':['B','A']},{'selectedPairs':{'l1':'r1','l2':'r2'}}])):
            url=path(file)+'/'+binding['id']+'/attempts'
            request={'sourceVersion':binding['sourceVersion'],'requestId':f'r{index}',**selection}
            response=c.post(url,json=request);assert response.status_code==200,response.text
            assert response.json()['attempt']['correct'] is True
            assert 'correctOptionIds' not in response.text and 'SECRET' not in response.text
            retry=c.post(url,json=request);assert retry.json()==response.json()
            wrong={'selectedOptionIds':['C']} if index<2 else {'selectedPairs':{'l1':'r2','l2':'r1'}}
            assert c.post(url,json={**request,**wrong}).status_code==409
            bad=c.post(url,json={**request,'requestId':'bad'+str(index),'selectedOptionIds':['forged']})
            assert bad.status_code==422
            graded=c.post(url,json={**request,**wrong,'requestId':'wrong'+str(index)})
            assert graded.status_code==200,graded.text
            assert graded.json()['attempt']['correct'] is False
            history=c.get('/api/v1/graph-questions/attempts/'+response.json()['attempt']['id']+'/analysis')
            assert history.status_code==200 and history.json()['analysis']=='SECRET ANALYSIS'
            assert c.post(url,json={**request,'questionId':d.public,'isMember':True}).status_code==422
        async def counts():
            async with AsyncSessionLocal() as db:return await db.scalar(select(func.count()).select_from(GraphQuestionAttempt).where(GraphQuestionAttempt.owner_id==d.student))
        assert asyncio.run(counts())==6
        login(c,d,'other')
        assert c.get('/api/v1/graph-questions/attempts/'+response.json()['attempt']['id']+'/analysis').status_code==404


def test_freeze_refresh_revoke_source_deletion_and_file_history(data):
    d=data
    with TestClient(app) as c:
        login(c,d,'teacher');file=create_card(c);binding=bind(c,file,[d.multi])['bindings'][0]
        url=path(file)+'/'+binding['id']
        submitted=c.post(url+'/attempts',json={'sourceVersion':binding['sourceVersion'],'requestId':'before','selectedOptionIds':['A','B']})
        assert submitted.status_code==200,submitted.text
        attempt=submitted.json()['attempt']['id']
        async def change():
            async with AsyncSessionLocal() as db:
                q=await db.get(Question,d.multi);q.correct_answer_ids=['B','C'];q.analysis='NEW';q.revision+=1
                m=await db.get(QuestionMaterial,d.material);m.text='version two';m.revision=2
                db.add(QuestionMaterialRevision(material_id=d.material,revision=2,snapshot={'id':d.material,'revision':2,'title':'material','text':'version two','images':[]}))
                await db.commit()
        asyncio.run(change())
        assert c.get(path(file)).json()['bindings'][0]['question']['material']['text']=='version one'
        assert c.post(url+'/attempts',json={'sourceVersion':binding['sourceVersion'],'requestId':'unchanged','selectedOptionIds':['A','B']}).json()['attempt']['correct'] is True
        refreshed=c.post(url+'/refresh',json={'expectedFileRevision':2,'sourceVersion':binding['sourceVersion']})
        assert refreshed.status_code==200,refreshed.text
        current=refreshed.json()['binding'];assert current['sourceVersion']!=binding['sourceVersion']
        assert current['question']['material']['text']=='version one' # exact revision referenced by question
        assert c.post(url+'/attempts',json={'sourceVersion':binding['sourceVersion'],'requestId':'stale','selectedOptionIds':['A','B']}).status_code==409
        async def remove_source_and_inventory():
            async with AsyncSessionLocal() as db:
                refs,snapshot=await question_cleanup_reference_service.inventory_question_references(db)
                assert any(r.container_type=='graph_question_binding' and r.question_id==d.multi and r.repair_action=='preserve_historical_snapshot' for r in refs)
                other=await db.get(User,d.other)
                assert await question_service.delete_question(db,other,d.multi)
        asyncio.run(remove_source_and_inventory())
        assert c.post(url+'/attempts',json={'sourceVersion':current['sourceVersion'],'requestId':'deleted-source','selectedOptionIds':['B','C']}).json()['attempt']['correct'] is True
        revoked=c.post(url+'/revoke',json={'expectedFileRevision':3,'sourceVersion':current['sourceVersion']});assert revoked.status_code==200,revoked.text
        assert c.post(url+'/attempts',json={'sourceVersion':current['sourceVersion'],'requestId':'after-revoke','selectedOptionIds':['B','C']}).status_code==404
        assert c.get('/api/v1/graph-questions/attempts/'+attempt+'/analysis').json()['analysis']=='SECRET ANALYSIS'
        async def delete_file():
            async with AsyncSessionLocal() as db:
                await file_service.trash_file(db,d.teacher,file)
                await file_service.delete_permanent(db,d.teacher,file)
        asyncio.run(delete_file())
        assert c.get(path(file)).status_code==404
        history=c.get('/api/v1/graph-questions/attempts/'+attempt+'/analysis')
        assert history.status_code==200
        image_url=history.json()['question']['material']['images'][0]['url']
        assert c.get(image_url).status_code==200
        assert c.get(image_url.replace('nodeId=n','nodeId=other')).status_code==404
        assert c.get(image_url.replace(d.asset,d.unused)).status_code==404
        assert c.get(image_url.replace('attemptId='+attempt,'attemptId=forged')).status_code==404
        login(c,d,'other')
        assert c.get(image_url).status_code==404
        # Source deleted, but frozen bindings still protect referenced material lifetime.
        assert c.delete('/api/v1/question-materials/'+d.material,params={'revision':2}).status_code==409


def test_trusted_clone_transaction_rollback_and_crossbinding_request_id(data):
    d=data
    with TestClient(app) as c:
        login(c,d,'teacher');source=create_card(c);bind(c,source,[d.q,d.multi])
        login(c,d,'student');file=create_card(c);asyncio.run(trusted_clone(d,source,file))
        bindings=c.get(path(file)).json()['bindings']
        for index,binding in enumerate(bindings):
            response=c.post(path(file)+'/'+binding['id']+'/attempts',json={'sourceVersion':binding['sourceVersion'],'requestId':'shared','selectedOptionIds':['A']})
            assert response.status_code== (200 if index==0 else 409),response.text
        async def rollback():
            async with AsyncSessionLocal() as db:
                before=await db.scalar(select(func.count()).select_from(GraphQuestionBinding))
                teacher=await db.get(User,d.teacher)
                from app.services.graph_question_service import export_card_bindings,clone_card_bindings
                snapshots=await export_card_bindings(db,teacher,source,'n')
                file=await file_service.create_file(db,d.student,name='rollback',graph_data={'nodes':[{'id':'n'}]},commit=False)
                await clone_card_bindings(db,d.student,file.id,'n',snapshots)
                await db.rollback()
                assert await db.scalar(select(func.count()).select_from(GraphQuestionBinding))==before
        asyncio.run(rollback())


def test_empty_trash_preserves_attempt_and_material_reference(data):
    d=data
    with TestClient(app) as c:
        login(c,d,'teacher');file=create_card(c);binding=bind(c,file,[d.multi])['bindings'][0]
        response=c.post(path(file)+'/'+binding['id']+'/attempts',json={'sourceVersion':binding['sourceVersion'],'requestId':'trash','selectedOptionIds':['A','B']})
        assert response.status_code==200,response.text
        attempt=response.json()['attempt']['id']
        async def empty():
            async with AsyncSessionLocal() as db:
                await file_service.trash_file(db,d.teacher,file)
                assert (await file_service.empty_trash(db,d.teacher))['deletedFiles'] == 1
                refs,_=await question_cleanup_reference_service.inventory_question_references(db)
                assert any(r.container_type=='graph_question_attempt' and r.container_id==attempt for r in refs)
        asyncio.run(empty())
        assert c.get(path(file)).status_code==404
        assert c.get('/api/v1/graph-questions/attempts/'+attempt+'/analysis').status_code==200


def test_material_delete_protection_for_only_binding_then_only_attempt(data):
    d=data
    material_id=d.material+'-solo';question_id=d.q+'-solo'
    async def seed():
        from app.models.question_material import QuestionMaterial
        async with AsyncSessionLocal() as db:
            db.add(QuestionMaterial(id=material_id,owner_id=d.other,title='solo',text='solo frozen',revision=1,images=[]))
            await db.flush()
            db.add(QuestionMaterialRevision(material_id=material_id,revision=1,snapshot={'id':material_id,'revision':1,'title':'solo','text':'solo frozen','images':[]}))
            db.add(Question(id=question_id,bank_id=d.bank,title='solo',options=[{'id':'A','text':'a'},{'id':'B','text':'b'}],correct_answer='A',analysis='solo analysis',content_metadata={'_mixedContent':{'material':{'id':material_id,'revision':1}}}))
            await db.commit()
    asyncio.run(seed())
    with TestClient(app) as c:
        login(c,d,'teacher');file=create_card(c);binding=bind(c,file,[question_id])['bindings'][0]
        submitted=c.post(path(file)+'/'+binding['id']+'/attempts',json={'sourceVersion':binding['sourceVersion'],'requestId':'solo','selectedOptionIds':['A']})
        assert submitted.status_code==200,submitted.text
        async def delete_source():
            async with AsyncSessionLocal() as db:
                owner=await db.get(User,d.other)
                assert await question_service.delete_question(db,owner,question_id)
        asyncio.run(delete_source())
        login(c,d,'other')
        assert c.delete('/api/v1/question-materials/'+material_id,params={'revision':1}).status_code==409
        async def remove_binding():
            async with AsyncSessionLocal() as db:
                row=await db.get(GraphQuestionBinding,binding['id']);await db.delete(row);await db.commit()
        asyncio.run(remove_binding())
        assert c.delete('/api/v1/question-materials/'+material_id,params={'revision':1}).status_code==409


def test_concurrent_identical_retry_creates_one_attempt(data):
    from concurrent.futures import ThreadPoolExecutor
    d=data
    with TestClient(app) as c:
        login(c,d,'teacher');file=create_card(c);binding=bind(c,file,[d.multi])['bindings'][0]
        url=path(file)+'/'+binding['id']+'/attempts'
        payload={'sourceVersion':binding['sourceVersion'],'requestId':'concurrent','selectedOptionIds':['B','A']}
        with ThreadPoolExecutor(max_workers=4) as pool:
            responses=list(pool.map(lambda _: c.post(url,json=payload),range(4)))
        assert all(r.status_code==200 for r in responses),[r.text for r in responses]
        assert len({r.json()['attempt']['id'] for r in responses})==1
        async def count():
            async with AsyncSessionLocal() as db:
                return await db.scalar(select(func.count()).select_from(GraphQuestionAttempt).where(GraphQuestionAttempt.owner_id==d.teacher,GraphQuestionAttempt.request_id=='concurrent'))
        assert asyncio.run(count())==1
