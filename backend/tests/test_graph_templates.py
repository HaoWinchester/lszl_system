"""Real authenticated template authority/immutable-copy/atomicity regressions."""
import asyncio
from concurrent.futures import ThreadPoolExecutor
from datetime import timedelta
from uuid import uuid4
import pytest
from fastapi import HTTPException
from fastapi.testclient import TestClient
from sqlalchemy import select, func, delete
from app.main import app
from app.db.session import AsyncSessionLocal
from app.core.security import now_utc
from app.models.subscription import Subscription
from app.models.file import GraphFile, FileContent
from app.models.graph_asset import GraphAsset
from app.models.graph_template import GraphTemplateVersion, GraphTemplateLoad
from app.models.graph_question import GraphQuestionBinding
from app.services import graph_template_service as service
from test_graph_question_access import data as source_fixture, login, create_card, bind, path, PASSWORD
from test_graph_assets import upload_payload, png


@pytest.fixture
def data():
    value=source_fixture.__wrapped__()
    async def isolate_search_names():
        from app.models.question import Question
        async with AsyncSessionLocal() as db:
            for row in (await db.scalars(select(Question).where(Question.bank_id.in_([value.bank,value.public_bank])))).all():
                row.title='template-case '+row.id.rsplit('-',1)[-1]
            await db.commit()
    asyncio.run(isolate_search_names())
    return value


def publication(file, revision=1, member=False):
    return {'sourceFileId':file,'expectedFileRevision':revision,'name':'模板测试','description':'安全预览描述','memberOnly':member}


def publish(c, body):
    r=c.post('/api/v1/graph-templates',json=body)
    assert r.status_code==201,r.text
    return r.json()['template']


def load(c, template, request=None, version=None):
    return c.post(f"/api/v1/graph-templates/{template['id']}/loads",json={'requestId':request or uuid4().hex,'version':version or template['version']})


def set_subscription(username, plan, status='active', expires=None):
    async def run():
        async with AsyncSessionLocal() as db:
            old=await db.get(Subscription,username)
            if old:await db.delete(old);await db.flush()
            db.add(Subscription(username=username,plan_id=plan,status=status,expires_at=expires))
            await db.commit()
    asyncio.run(run())


def test_permission_subscription_and_preview_matrix(data):
    with TestClient(app) as c:
        login(c,data,'teacher');source=create_card(c)
        free=publish(c,publication(source));paid=publish(c,publication(source,member=True))
        assert load(c,paid).status_code==201
        preview=c.get('/api/v1/graph-templates/'+paid['id']).json()
        assert set(preview)=={'template'}
        assert 'graphData' not in str(preview) and 'SECRET' not in str(preview)
        login(c,data,'admin');assert load(c,paid).status_code==201
        assert c.patch('/api/v1/graph-templates/'+paid['id'],json={'listed':False}).status_code==200
        login(c,data,'student');assert paid['id'] not in [t['id'] for t in c.get('/api/v1/graph-templates').json()['templates']]
        login(c,data,'admin');assert c.patch('/api/v1/graph-templates/'+paid['id'],json={'listed':True}).status_code==200
        own=create_card(c);assert publish(c,publication(own))['canMaintain']
        login(c,data,'other')
        assert c.post('/api/v1/graph-templates/'+paid['id']+'/versions',json=publication(source)).status_code==404
        assert c.patch('/api/v1/graph-templates/'+paid['id'],json={'listed':False}).status_code==404
        assert c.post('/api/v1/graph-templates',json=publication(source)).status_code==404
        login(c,data,'student')
        assert c.post('/api/v1/graph-templates',json=publication(source)).status_code==403
        assert c.post('/api/v1/graph-templates/'+paid['id']+'/versions',json=publication(source)).status_code==403
        assert c.patch('/api/v1/graph-templates/'+paid['id'],json={'listed':False}).status_code==403
        assert load(c,free).status_code==201
        for plan,status,expiry,allowed in [
            ('free','active',None,False),('monthly','active',now_utc()+timedelta(days=1),True),
            ('quarterly','active',now_utc()+timedelta(days=1),True),('half_year','active',now_utc()+timedelta(days=1),True),
            ('lifetime','active',None,True),('monthly','active',now_utc()-timedelta(days=1),False),
            ('monthly','active',None,False),('lifetime','paused',None,False),('lifetime','expired',None,False)]:
            set_subscription(data.student,plan,status,expiry)
            assert load(c,paid).status_code==(201 if allowed else 403)
        assert c.post('/api/v1/graph-templates',json=publication(source)|{'graphData':{}}).status_code==422
        for role in ('viewer',):
            login(c,data,role)
            assert c.get('/api/v1/graph-templates').status_code==403
            assert load(c,free).status_code==403
        c.post('/api/v1/auth/logout');assert c.get('/api/v1/graph-templates').status_code==401


def test_frozen_versions_assets_grants_no_retroactive_revocation(data):
    with TestClient(app) as c:
        login(c,data,'teacher');image=c.post('/api/v1/graph-assets',json=upload_payload()).json()['asset']
        graph={'meta':{'title':'version one'},'viewport':{'x':900,'y':10,'scale':2},'flashReviews':{'n':{'reviewCount':3}},'importedFlashcards':[{'id':'secret'}],
               'mindmap':{'rootIds':['n'],'themeId':'mint'},'nodes':[{'id':'n','title':'card','x':200,'y':200,'content':{'title':'card','notes':'保持完整\n'*3000,'images':[image]},'questionIds':[data.unused]}],
               'links':[{'id':'l','from':'n','to':'','toPoint':{'x':800,'y':500},'fromPort':{'side':'right','offset':0.25},'curveControls':[{'x':200,'y':30},{'x':800,'y':400}]}],
               'elements':[{'id':'e','text':'文字','x':12,'y':32}], 'tables':[{'id':'t','schemaVersion':1,'x':0,'y':0,'rows':2,'cols':2,'columnWidths':[140.0,140.0],'rowHeights':[40.0,40.0],'cells':{'0,0':'cell'},'merges':[]}]}
        source=c.post('/api/v1/files',json={'name':'frozen','graphData':graph}).json()['file']['id']
        bind(c,source,[data.q]);template=publish(c,publication(source,2));tid=template['id']
        assert c.post('/api/v1/graph-templates/'+tid+'/versions',json=publication(source,1)).status_code==409
        login(c,data,'student');request=uuid4().hex;r=load(c,template,request);assert r.status_code==201,r.text;loaded=r.json();fid=loaded['fileId'];nid=loaded['idMap']['n']
        assert fid!=source and nid!='n'
        copy=c.get('/api/v1/files/'+fid).json()['graphData'];assert copy['nodes'][0]['content']['notes']==graph['nodes'][0]['content']['notes']
        assert all(k not in copy for k in ('flashReviews','viewport','importedFlashcards'))
        assert 'questionIds' not in copy['nodes'][0]
        assert copy['mindmap']['rootIds']==[nid] and copy['links'][0]['from']==nid and copy['links'][0]['toPoint']==graph['links'][0]['toPoint']
        assert copy['links'][0]['curveControls']==graph['links'][0]['curveControls'] and copy['tables'][0]['id']!='t'
        asset=copy['nodes'][0]['content']['images'][0]['assetId'];assert asset!=image['assetId']
        assert c.get('/api/v1/graph-assets/'+asset,params={'fileId':fid}).content==png()
        bpath=f'/api/v1/graph-questions/files/{fid}/nodes/{nid}/bindings';bindings=c.get(bpath).json()['bindings'];assert len(bindings)==1
        b=bindings[0];assert b['question']['title']=='template-case q'
        attempt=c.post(bpath+'/'+b['id']+'/attempts',json={'sourceVersion':b['sourceVersion'],'requestId':uuid4().hex,'selectedOptionIds':['A']});assert attempt.status_code==200,attempt.text
        assert c.get('/api/v1/graph-questions/attempts/'+attempt.json()['attempt']['id']+'/analysis').json()['analysis']=='SECRET ANALYSIS'
        copy['nodes'][0]['title']='copy change';assert c.put('/api/v1/files/'+fid,json={'graphData':copy,'expectedRevision':1}).status_code==200
        login(c,data,'teacher');assert c.get('/api/v1/files/'+source).json()['graphData']==graph
        updated=publication(source,2,True)|{'name':'版本二'};t2=c.post('/api/v1/graph-templates/'+tid+'/versions',json=updated).json()['template'];assert t2['version']==2
        c.patch('/api/v1/graph-templates/'+tid,json={'listed':False})
        # Source removal and binding deletion leave the immutable publication usable.
        async def remove():
            async with AsyncSessionLocal() as db:
                await db.execute(delete(GraphQuestionBinding).where(GraphQuestionBinding.file_id==source));await db.commit()
        asyncio.run(remove())
        login(c,data,'student');assert load(c,template,request).json()==loaded
        assert load(c,template).status_code==404
        assert load(c,t2,request).status_code==409
        assert c.get('/api/v1/files/'+fid).status_code==200
        assert c.get(bpath).status_code==200
        login(c,data,'teacher');c.patch('/api/v1/graph-templates/'+tid,json={'listed':True})
        login(c,data,'student');assert load(c,t2).status_code==403
        set_subscription(data.student,'lifetime');old=load(c,template,version=1);assert old.status_code==201
        oldgraph=c.get('/api/v1/files/'+old.json()['fileId']).json()['graphData'];assert oldgraph['nodes'][0]['title']=='card'


def test_free_template_node_quota(data):
    with TestClient(app) as c:
        login(c,data,'teacher')
        graph={'meta':{'title':'配额'},'nodes':[{'id':f'n{i}','title':f'k{i}','x':i*10,'y':0,'content':{'title':f'k{i}'}} for i in range(51)]}
        source=c.post('/api/v1/files',json={'name':'quota','graphData':graph}).json()['file']['id']
        big=publish(c,publication(source))
        login(c,data,'student')
        assert load(c,big).status_code==422
        assert load(c,big,request=uuid4().hex).json()['detail']['code']=='TEMPLATE_NODE_QUOTA_EXCEEDED'
        graph['nodes']=graph['nodes'][:50]
        login(c,data,'teacher')
        assert c.put('/api/v1/files/'+source,json={'graphData':graph,'expectedRevision':1}).status_code==200
        small=publish(c,publication(source,2))
        login(c,data,'student');assert load(c,small).status_code==201


def test_update_keeps_listing_state(data):
    with TestClient(app) as c:
        login(c,data,'teacher');source=create_card(c)
        template=publish(c,publication(source))
        c.patch('/api/v1/graph-templates/'+template['id'],json={'listed':False})
        updated=c.post('/api/v1/graph-templates/'+template['id']+'/versions',json=publication(source)|{'name':'静默上架检查'}).json()['template']
        assert updated['version']==2
        login(c,data,'student');assert template['id'] not in [t['id'] for t in c.get('/api/v1/graph-templates').json()['templates']]
        login(c,data,'teacher');assert c.patch('/api/v1/graph-templates/'+template['id'],json={'listed':True}).status_code==200
        login(c,data,'student');assert load(c,updated).status_code==201


def test_atomic_rollback_and_concurrent_request_receipt(data,monkeypatch):
    with TestClient(app) as c:
        login(c,data,'teacher');source=create_card(c);bind(c,source,[data.q]);template=publish(c,publication(source,2))
        login(c,data,'student')
        async def counts():
            async with AsyncSessionLocal() as db:
                return tuple([await db.scalar(select(func.count()).select_from(model)) for model in (GraphFile,GraphAsset,GraphTemplateLoad,GraphQuestionBinding)])
        before=asyncio.run(counts());original=service.questions.clone_card_bindings
        async def fail_after_clone(*args,**kwargs):
            await original(*args,**kwargs);raise HTTPException(409,'forced binding failure')
        monkeypatch.setattr(service.questions,'clone_card_bindings',fail_after_clone)
        assert load(c,template).status_code==409
        assert asyncio.run(counts())==before
        monkeypatch.setattr(service.questions,'clone_card_bindings',original)
        cookies=dict(c.cookies);request=uuid4().hex
        def send(_):
            with TestClient(app) as other:
                other.cookies.update(cookies);r=load(other,template,request);assert r.status_code==201,r.text;return r.json()['fileId']
        with ThreadPoolExecutor(max_workers=4) as pool:results=list(pool.map(send,range(4)))
        assert len(set(results))==1
        after=asyncio.run(counts());assert after[0]==before[0]+1 and after[2]==before[2]+1 and after[3]==before[3]+1


def test_template_only_frozen_material_and_cleanup_inventory(data):
    from app.models.question import Question
    from app.models.paper_release import PaperReleaseQuestion
    from app.services import question_cleanup_reference_service as inventory
    with TestClient(app) as c:
        login(c,data,'teacher');source=create_card(c);bind(c,source,[data.q]);template=publish(c,publication(source,2))
        async def remove_other_references():
            async with AsyncSessionLocal() as db:
                await db.execute(delete(GraphQuestionBinding).where(GraphQuestionBinding.file_id==source))
                await db.execute(delete(PaperReleaseQuestion).where(PaperReleaseQuestion.release_id==data.release))
                for q in (await db.scalars(select(Question).where(Question.bank_id.in_([data.bank,data.public_bank])))).all():
                    q.content_metadata={}
                await db.commit()
                result=await inventory.inventory_question_references(db)
                assert any(r.container_type=='graph_template_version' and r.question_id==data.q for r in result[0])
        asyncio.run(remove_other_references())
        login(c,data,'other');result=c.delete('/api/v1/question-materials/'+data.material,params={'revision':1})
        assert result.status_code==409,result.text
        assert result.json()['detail']['code']=='MATERIAL_REFERENCED'
        login(c,data,'student');r=load(c,template);assert r.status_code==201,r.text
        fid=r.json()['fileId'];nid=r.json()['idMap']['n'];bp=f'/api/v1/graph-questions/files/{fid}/nodes/{nid}/bindings';b=c.get(bp).json()['bindings'][0]
        assert b['question']['material']['text']=='version one'
        assert c.get(b['question']['material']['images'][0]['url']).content==b'frozen-test-bytes'
