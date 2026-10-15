"""Signed previews and atomic append of existing questions to selected graph cards."""
import asyncio
import pytest
from fastapi.testclient import TestClient
from sqlalchemy import select, func
from app.main import app
from app.db.session import AsyncSessionLocal
from app.models.question import Question
from app.models.graph_question import GraphQuestionBinding
from app.models.file import GraphFile
from test_graph_question_access import data, login, bind, path, assert_safe


def setup_graph(c, d):
    term=d.q+' knowledge'
    async def seed():
        async with AsyncSessionLocal() as db:
            q=await db.get(Question,d.q);q.title=term
            q=await db.get(Question,d.multi);q.concepts=[{'title':term}]
            q=await db.get(Question,d.match);q.stem_parts=[{'text':term}]
            await db.commit()
    asyncio.run(seed())
    r=c.post('/api/v1/files',json={'name':'batch','graphData':{'nodes':[{'id':'n','title':term},{'id':'nested','content':{'title':'other','keywords':term}},{'id':'none','title':d.q+' unmatched'}],'links':[]}})
    assert r.status_code==200,r.text
    return r.json()['file']['id']


def preview(c,file,revision=1,ids=None,count=3):
    return c.post(f'/api/v1/graph-questions/files/{file}/batch-preview',json={'expectedFileRevision':revision,'nodeIds':ids or ['n','nested','none'],'countPerCard':count})


def apply(c,file,p,selection=None):
    return c.post(f'/api/v1/graph-questions/files/{file}/batch-apply',json={'previewToken':p['previewToken'],'selections':selection if selection is not None else [{'nodeId':row['nodeId'],'questionIds':[q['id'] for q in row['questions']]} for row in p['cards']]})


def test_preview_is_readonly_ranked_and_append_preserves_existing(data):
    d=data
    with TestClient(app) as c:
        login(c,d,'teacher');file=setup_graph(c,d)
        bind(c,file,[d.public]);r=preview(c,file,2);assert r.status_code==200,r.text;p=r.json()
        assert p['fileRevision']==2 and len(p['cards'])==3
        assert p['cards'][0]['questions'][0]['id']==d.q
        assert {q['id'] for q in p['cards'][1]['questions']}=={d.q,d.multi,d.match}
        assert p['cards'][2]['questions']==[] and p['cards'][2]['shortfall']==3
        assert_safe(p['cards'])
        assert len(c.get(path(file)).json()['bindings'])==1
        result=apply(c,file,p);assert result.status_code==200,result.text
        assert result.json()['addedCount']==6 and result.json()['fileRevision']==3
        assert {b['questionId'] for b in c.get(path(file)).json()['bindings']}=={d.public,d.q,d.multi,d.match}
        assert c.get(path(file)).json()['bindings'][1]['question']['material']['text']=='version one'
        assert apply(c,file,p).status_code==409
        r=preview(c,file,3);assert r.status_code==200;r=r.json()
        assert all(not row['questions'] for row in r['cards'])
        assert apply(c,file,r).status_code==422


def test_apply_only_preview_subset_and_rejects_tampering(data):
    d=data
    with TestClient(app) as c:
        login(c,d,'teacher');file=setup_graph(c,d);r=preview(c,file);assert r.status_code==200,r.text;p=r.json()
        assert apply(c,file,p,[{'nodeId':'n','questionIds':[d.public]}]).status_code==422
        forged={**p,'previewToken':p['previewToken']+'x'};assert apply(c,file,forged).status_code==422
        result=apply(c,file,p,[{'nodeId':'n','questionIds':[d.q]}]);assert result.status_code==200,result.text
        assert result.json()['addedCount']==1
        assert len(c.get(path(file)).json()['bindings'])==1


def test_owner_roles_revision_and_invalid_inputs(data):
    d=data
    with TestClient(app) as c:
        login(c,d,'teacher');file=setup_graph(c,d);r=preview(c,file);assert r.status_code==200,r.text;p=r.json()
        assert preview(c,file,2).status_code==409
        assert preview(c,file,ids=['missing']).status_code==404
        assert preview(c,file,count=0).status_code==422
        assert preview(c,file,count=101).status_code==422
        login(c,d,'other');assert preview(c,file).status_code==404;assert apply(c,file,p).status_code in (403,404,422)
        for role in ['student','viewer']:
            login(c,d,role);assert preview(c,file).status_code==403;assert apply(c,file,p).status_code==403


def test_source_changed_after_preview_rolls_back_all_cards(data):
    d=data
    with TestClient(app) as c:
        login(c,d,'teacher');file=setup_graph(c,d);r=preview(c,file);assert r.status_code==200,r.text;p=r.json()
        async def change():
            async with AsyncSessionLocal() as db:
                q=await db.get(Question,d.multi);q.revision+=1;await db.commit()
        asyncio.run(change());assert apply(c,file,p).status_code==409
        assert c.get(path(file)).json()['bindings']==[]
        async def revision():
            async with AsyncSessionLocal() as db:return (await db.get(GraphFile,file)).revision
        assert asyncio.run(revision())==1


def test_preview_expiration(data,monkeypatch):
    from itsdangerous.timed import TimestampSigner
    d=data
    with TestClient(app) as c:
        login(c,d,'teacher');file=setup_graph(c,d);r=preview(c,file);assert r.status_code==200,r.text;p=r.json()
        original=TimestampSigner.get_timestamp
        monkeypatch.setattr(TimestampSigner,'get_timestamp',lambda self: original(self)+1000)
        assert apply(c,file,p).status_code==422


def test_matches_text_values_not_json_field_names_and_splits_keywords(data):
    d=data
    async def seed():
        async with AsyncSessionLocal() as db:
            q=await db.get(Question,d.q);q.title='ordinary question';q.stem_parts=[{'text':d.q+' secondword','structuralOnlyNeedle':'not a keyword'}];await db.commit()
    with TestClient(app) as c:
        login(c,d,'teacher');asyncio.run(seed())
        r=c.post('/api/v1/files',json={'name':'matching semantics','graphData':{'nodes':[{'id':'n','title':'structuralOnlyNeedle'},{'id':'nested','title':d.q+' no-match','keywords':'absent '+d.q}],'links':[]}});file=r.json()['file']['id']
        r=preview(c,file,ids=['n','nested']);assert r.status_code==200,r.text
        a,b=r.json()['cards'];assert not a['questions']
        assert d.q in {q['id'] for q in b['questions']}
