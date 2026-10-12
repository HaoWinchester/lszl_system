"""Live isolated API matrix: card grants never become catalog/asset authority."""
import asyncio
import base64
from uuid import uuid4
from types import SimpleNamespace
import pytest
from fastapi.testclient import TestClient
from sqlalchemy import select
from app.main import app
from app.db.session import AsyncSessionLocal
from app.models.user import User
from app.models.question import QuestionBank, Question, ExamPaper, PaperQuestion
from app.models.file import GraphFile, FileContent
from app.models.paper_release import PaperRelease, PaperReleaseQuestion
from app.models.question_material import QuestionAsset, QuestionMaterial, QuestionMaterialRevision
from app.models.graph_question import GraphQuestionBinding, GraphQuestionAttempt
from app.core.security import hash_password
from app.services import graph_question_service as service, question_catalog_service as catalog, file_service

PASSWORD = 'card-practice-tests'
IMAGE = b'frozen-test-bytes'

@pytest.fixture
def data():
    prefix = 'gq-' + uuid4().hex[:10]
    d = SimpleNamespace(**{k: prefix+'-'+k for k in ('teacher','other','student','viewer','admin','bank','public_bank','q','public','both','multi','match','material','asset','unused','release','paper')})
    async def seed():
        async with AsyncSessionLocal() as db:
            for k in ('teacher','other','student','viewer','admin'):
                db.add(User(username=getattr(d,k), role='teacher' if k=='other' else k, status='active', password_hash=hash_password(PASSWORD)))
            await db.flush()
            db.add_all([QuestionBank(id=d.bank, owner_id=d.other, name='private cross bank',visibility='private'),QuestionBank(id=d.public_bank,owner_id=d.other,name='explicit public',visibility='published')])
            db.add_all([QuestionAsset(id=d.asset,owner_id=d.other,mime_type='image/png',filename='f',alt='frozen image',data=IMAGE),QuestionAsset(id=d.unused,owner_id=d.other,mime_type='image/png',filename='other',alt='other',data=b'other')])
            db.add(QuestionMaterial(id=d.material,owner_id=d.other,title='material',text='version one',revision=1,images=[{'id':d.asset,'url':'/api/v1/question-assets/'+d.asset,'alt':'material image'}]))
            await db.flush()
            db.add(QuestionMaterialRevision(material_id=d.material,revision=1,snapshot={'id':d.material,'revision':1,'title':'material','text':'version one','images':[{'id':d.asset,'url':'/api/v1/question-assets/'+d.asset,'alt':'material image'}]}))
            for k in ('q','public','both','multi','match'):
                question = Question(id=getattr(d,k),bank_id=d.public_bank if k in ('public','both') else d.bank,title='card '+k,type={'multi':'multiple_choice','match':'matching'}.get(k,'single_choice'),scope='public' if k in ('public','both') else 'internal',options=[{'id':'A','text':'a','correct':True,'trap':'leak'},{'id':'B','text':'b'},{'id':'C','text':'c'}],correct_answer='A',correct_answer_ids=['A','B'] if k=='multi' else [],analysis='SECRET ANALYSIS',stem_parts=[{'text':'visible stem','clue':'answer clue'}],key_path={'answer':'A'},clues=[{'text':'secret clue'}],reasoning_steps=[{'content':'secret reasoning'}],translations={'correctAnswer':'A'},content_metadata={'answer':'A','_mixedContent':{'images':[{'id':d.asset}], 'material':{'id':d.material,'revision':1}, **({'matching':{'left':[{'id':'l1','text':'one'},{'id':'l2','text':'two'}],'right':[{'id':'r1','text':'一'},{'id':'r2','text':'二'}],'correctPairs':{'l1':'r1','l2':'r2'}}} if k=='match' else {})}})
                db.add(question)
            db.add(ExamPaper(id=d.paper,owner_id=d.other,name='paid paper',status='published'))
            db.add(PaperRelease(id=d.release,paper_id=d.paper,version=1,status='published',name='paid',subject='PMP',publisher_id=d.other,access_level='member',enabled_modes=['practice_mode'],allowed_roles=['student']))
            await db.flush()
            for i,k in enumerate(('q','both')):
                q=await db.get(Question,getattr(d,k))
                db.add(PaperReleaseQuestion(release_id=d.release,order_index=i,question_id=q.id,bank_id=q.bank_id,snapshot=catalog.question_to_payload(q)))
                db.add(PaperQuestion(paper_id=d.paper,question_id=q.id,order_index=i))
            await db.commit()
    asyncio.run(seed())
    return d


def login(c, d, role):
    assert c.post('/api/v1/auth/login',json={'username':getattr(d,role),'password':PASSWORD}).status_code==200


def create_card(c):
    response=c.post('/api/v1/files',json={'name':'card','graphData':{'nodes':[{'id':'n','content':{'title':'card'}}],'links':[]}})
    assert response.status_code==200,response.text
    return response.json()['file']['id']


def path(file):
    return f'/api/v1/graph-questions/files/{file}/nodes/n/bindings'


def bind(c,file,ids,revision=1):
    response=c.put(path(file),json={'expectedFileRevision':revision,'questionIds':ids})
    assert response.status_code==200,response.text
    return response.json()


async def trusted_clone(d, source, target):
    async with AsyncSessionLocal() as db:
        teacher=await db.get(User,d.teacher)
        snapshots=await service.export_card_bindings(db,teacher,source,'n')
        await service.clone_card_bindings(db,d.student,target,'n',snapshots)
        await db.commit()


def assert_safe(value):
    if isinstance(value,dict):
        assert not set(value)&{'correctAnswer','correctOptionIds','correctPairs','analysis','correct','trap','metadata','translations','keyPath','clues','concepts','reasoningSteps','clue'}
        for child in value.values():assert_safe(child)
    elif isinstance(value,list):
        for child in value:assert_safe(child)


def test_role_search_binding_revision_and_crossbank_frozen_material(data):
    d=data
    with TestClient(app) as c:
        login(c,d,'teacher');file=create_card(c)
        result=c.get('/api/v1/graph-questions/search',params={'fileId':file,'nodeId':'n','q':'card','subject':'PMP'})
        assert result.status_code==200,result.text
        assert d.q in {q['id'] for q in result.json()['questions']}
        assert result.json()['pageSize']==20
        assert_safe(result.json())
        linked=bind(c,file,[d.q,d.multi,d.match,d.q]);assert len(linked['bindings'])==3
        assert linked['fileRevision']==2
        assert_safe(linked)
        assert linked['bindings'][0]['question']['material']['text']=='version one'
        assert c.put(path(file),json={'expectedFileRevision':1,'questionIds':[d.q]}).status_code==409
        assert c.put(path(file),json={'expectedFileRevision':2,'questionIds':[d.q,'forged']}).status_code==404
        assert len(c.get(path(file)).json()['bindings'])==3
        assert c.get('/api/v1/graph-questions/search',params={'fileId':file,'nodeId':'missing'}).status_code==404
        login(c,d,'admin');other=create_card(c)
        assert c.get('/api/v1/graph-questions/search',params={'fileId':other,'nodeId':'n','q':'card'}).status_code==200
        bind(c,other,[d.q])
        for role in ('student','viewer'):
            login(c,d,role)
            assert c.get('/api/v1/graph-questions/search',params={'fileId':file,'nodeId':'n'}).status_code==403
            assert c.put(path(file),json={'expectedFileRevision':2,'questionIds':[d.q]}).status_code==403
            assert c.get(path(file)).status_code in (403,404)
        c.post('/api/v1/auth/logout')
        assert c.get('/api/v1/graph-questions/search',params={'fileId':file,'nodeId':'n'}).status_code==401


def test_nonmember_grant_asset_context_and_public_catalog_semantics(data):
    d=data
    with TestClient(app) as c:
        login(c,d,'teacher');source=create_card(c);bind(c,source,[d.q,d.both])
        login(c,d,'student');file=create_card(c);asyncio.run(trusted_clone(d,source,file))
        result=c.get(path(file));assert result.status_code==200,result.text
        assert_safe(result.json())
        binding=result.json()['bindings'][0]
        image=binding['question']['material']['images'][0]
        assert c.get(image['url']).content==IMAGE
        assert c.get(image['url'].replace(d.asset,d.unused)).status_code==404
        context={'fileId':file,'nodeId':'n','bindingId':binding['id'],'sourceVersion':binding['sourceVersion']}
        assert c.get('/api/v1/question-assets/'+d.asset,params=context).content==IMAGE
        assert c.get('/api/v1/question-assets/'+d.asset+'/content',params=context).status_code==200
        for key,val in [('fileId',source),('nodeId','other'),('bindingId',d.q),('sourceVersion','other')]:
            assert c.get('/api/v1/question-assets/'+d.asset,params={**context,key:val}).status_code in (404,409)
        assert c.get('/api/v1/question-assets/'+d.asset,params={'bindingId':binding['id']}).status_code==422
        assert c.get('/api/v1/question-assets/'+d.asset).status_code==404
        assert c.get('/api/v1/question-materials/'+d.material).status_code==403
        assert c.get('/api/v1/question-catalog/questions/'+d.q).status_code==403
        assert c.get('/api/v1/question-catalog/questions/'+d.both).status_code==403
        assert c.get('/api/v1/paper-releases/'+d.release+'/questions').status_code==404
        otherfile=create_card(c)
        assert c.post(path(otherfile)+'/'+binding['id']+'/attempts',json={'sourceVersion':binding['sourceVersion'],'requestId':'forged','selectedOptionIds':['A']}).status_code==404
        for authenticated in (True,False):
            if not authenticated:c.post('/api/v1/auth/logout')
            for params in ({'bank_id':d.bank},{'bank_id':d.public_bank},{'paper_id':d.paper}):
                response=c.get('/api/v1/question-catalog/learning/questions',params=params)
                assert response.status_code==200,response.text
                ids={q['id'] for q in response.json()['questions']}
                assert d.q not in ids
                if params.get('bank_id')==d.public_bank:
                    assert {d.public,d.both}<=ids
                    public=next(q for q in response.json()['questions'] if q['id']==d.both)
                    assert public['correctAnswer']=='A' and public['analysis']=='SECRET ANALYSIS'
                if 'paper_id' in params:assert d.both in ids
            boot=c.get('/api/v1/question-catalog/bootstrap',params={'include_questions':'true','subject':'PMP'})
            assert boot.status_code==200,boot.text
            assert d.q not in {q['id'] for q in boot.json().get('questions',[])}


def test_search_pagination_exact_order_dedup_and_explicit_regrant(data):
    d=data
    async def extra():
        async with AsyncSessionLocal() as db:
            for index in range(25):
                db.add(Question(id=d.q+'-extra-'+str(index).zfill(2),bank_id=d.bank,title='specific' if index==24 else 'specific '+str(index),stem_parts=[{'text':'specific'}],scope='internal'))
            await db.commit()
    asyncio.run(extra())
    with TestClient(app) as c:
        login(c,d,'teacher');file=create_card(c)
        params={'fileId':file,'nodeId':'n','q':'specific'}
        first=c.get('/api/v1/graph-questions/search',params=params).json()
        second=c.get('/api/v1/graph-questions/search',params={**params,'page':2}).json()
        assert first['total']==25 and len(first['questions'])==20 and len(second['questions'])==5
        assert first['questions'][0]['title']=='specific'
        assert len({q['id'] for q in first['questions']+second['questions']})==25
        assert not c.get('/api/v1/graph-questions/search',params={**params,'q':'%'}).json()['questions']
        assert c.get('/api/v1/graph-questions/search',params={**params,'page':501}).status_code==422
        original=bind(c,file,[d.multi,d.q])
        reordered=bind(c,file,[d.q,d.multi,d.q],2)
        assert [b['questionId'] for b in reordered['bindings']]==[d.q,d.multi]
        assert {b['id'] for b in original['bindings']}=={b['id'] for b in reordered['bindings']}
        old=reordered['bindings'][0]
        removed=bind(c,file,[d.multi],3)
        assert len(removed['bindings'])==1
        regrant=bind(c,file,[d.q,d.multi],4)['bindings'][0]
        assert regrant['id']==old['id'] and regrant['sourceVersion']!=old['sourceVersion']
