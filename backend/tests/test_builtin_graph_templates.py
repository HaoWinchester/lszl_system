"""Original adult templates retain immutable publication and load authority."""
import asyncio
from copy import deepcopy
import json
from uuid import uuid4

import pytest
from fastapi.testclient import TestClient
from sqlalchemy import func, select

from app.core.security import hash_password
from app.db.session import AsyncSessionLocal
from app.main import app
from app.models.file import GraphFile, FileContent, CurrentFile
from app.models.graph_template import GraphTemplate, GraphTemplateVersion
from app.models.user import User


def test_packaged_adult_frameworks_are_original_complete_and_safe():
    from app.services.builtin_graph_template_seed_service import load_bundle
    templates=load_bundle()
    assert {row['topic'] for row in templates} == {'management','logic','relationships','classics'}
    for item in templates:
        assert item['rights']=='original-framework'
        graph=item['graphData'];assert 10<=len(graph['nodes'])<=50
        assert graph['meta']['contentOrigin']=='original-framework'
        assert all(node['content']['summary'] and node['content']['notes'] for node in graph['nodes'])
        ids={node['id'] for node in graph['nodes']}
        assert len(ids)==len(graph['nodes'])
        assert all(edge['from'] in ids and edge['to'] in ids for edge in graph['links'])
        assert not any(key in str(graph) for key in ('questionIds','assetId','学习记录'))


def test_seed_is_idempotent_and_preserves_admin_edits_downlisting_sources_and_current_file():
    from app.services import builtin_graph_template_seed_service as seed
    async def exercise():
        async with AsyncSessionLocal() as db:
            await seed.sync_builtin_graph_templates(db)
            templates=seed.load_bundle();identity=templates[0]['id']
            before=int(await db.scalar(select(func.count()).select_from(GraphFile).where(GraphFile.source=='builtin-template')))
            row=await db.get(GraphTemplate,identity);row.name='管理员自己的名称';row.listed=False
            version=await db.scalar(select(GraphTemplateVersion).where(GraphTemplateVersion.template_id==identity))
            source=await db.get(FileContent,version.source_file_id)
            original=deepcopy(source.graph_data);source.graph_data={**original,'meta':{'title':'管理员维护原图'}}
            await db.commit()
            try:
                summary=await seed.sync_builtin_graph_templates(db)
                await db.refresh(row);await db.refresh(source)
                assert summary['created']==0 and summary['unchanged']==4
                assert row.name=='管理员自己的名称' and row.listed is False and row.current_version==1
                assert source.graph_data['meta']['title']=='管理员维护原图'
                assert int(await db.scalar(select(func.count()).select_from(GraphFile).where(GraphFile.source=='builtin-template')))==before
                assert await db.get(CurrentFile,row.owner_id) is None
            finally:
                row.name=templates[0]['name'];row.listed=True;source.graph_data=original;await db.commit()
    asyncio.run(exercise())


def test_builtin_templates_keep_preview_role_load_receipts_and_current_file_contracts():
    from app.services import builtin_graph_template_seed_service as seed, file_service
    token=uuid4().hex[:8];student='adult-student-'+token;viewer='adult-viewer-'+token
    async def prepare():
        async with AsyncSessionLocal() as db:
            await seed.sync_builtin_graph_templates(db)
            db.add_all([User(username=name,role=role,status='active',password_hash=hash_password('adult-pass')) for name,role in [(student,'student'),(viewer,'viewer')]])
            await db.flush()
            existing=await file_service.create_file(db,student,name='不要替换当前文件')
            await file_service.set_current(db,student,existing.id)
            return existing.id
    current=asyncio.run(prepare());tid=seed.load_bundle()[0]['id']
    with TestClient(app) as client:
        assert client.get('/api/v1/graph-templates/'+tid).status_code==401
        client.post('/api/v1/auth/login',json={'username':viewer,'password':'adult-pass'})
        assert client.get('/api/v1/graph-templates/'+tid).status_code==403
        client.post('/api/v1/auth/login',json={'username':student,'password':'adult-pass'})
        catalog=client.get('/api/v1/graph-templates').json()['templates']
        assert set(t['id'] for t in catalog)>=set(t['id'] for t in seed.load_bundle())
        preview=client.get('/api/v1/graph-templates/'+tid).json()
        assert len(preview['preview']['nodes'])>=10
        assert preview['template']['memberOnly'] is False
        assert 'notes' not in str(preview)
        body={'requestId':'adult-'+token,'version':1}
        loaded=client.post('/api/v1/graph-templates/'+tid+'/loads',json=body)
        assert loaded.status_code==201,loaded.text
        assert client.post('/api/v1/graph-templates/'+tid+'/loads',json=body).json()==loaded.json()
        copy=client.get('/api/v1/files/'+loaded.json()['fileId']).json()
        assert len(copy['graphData']['nodes'])>=10
        assert copy['graphData']['nodes'][0]['content']['notes']
        assert client.post('/api/v1/graph-templates/'+tid+'/versions',json={'sourceFileId':current,'expectedFileRevision':1,'name':'学生不能改公版'}).status_code==403
    async def check_current():
        async with AsyncSessionLocal() as db:
            assert (await db.get(CurrentFile,student)).file_id==current
    asyncio.run(check_current())


def test_invalid_packaged_links_fail_before_database_writes(tmp_path):
    from app.services import builtin_graph_template_seed_service as seed
    payload={'schemaVersion':1,'templates':deepcopy(seed.load_bundle())}
    payload['templates'][0]['graphData']['links'][0]['to']='missing-card'
    fixture=tmp_path/'bad.json';fixture.write_text(json.dumps(payload,ensure_ascii=False))
    with pytest.raises(ValueError,match='连线'):
        seed.load_bundle(fixture)


def test_concurrent_startup_seed_creates_one_publication_and_source_per_identity(monkeypatch):
    from app.services import builtin_graph_template_seed_service as seed
    bundle=deepcopy(seed.load_bundle());suffix=uuid4().hex[:8]
    for item in bundle:
        item['id']='seed-race-'+item['topic']+'-'+suffix
    monkeypatch.setattr(seed,'load_bundle',lambda:bundle)
    async def exercise():
        async def once():
            async with AsyncSessionLocal() as db:
                return await seed.sync_builtin_graph_templates(db)
        results=await asyncio.gather(once(),once())
        assert sum(row['created'] for row in results)==4
        async with AsyncSessionLocal() as db:
            ids=[item['id'] for item in bundle]
            sources=int(await db.scalar(select(func.count()).select_from(GraphFile).where(GraphFile.source_file_id.in_(ids))))
            versions=int(await db.scalar(select(func.count()).select_from(GraphTemplateVersion).where(GraphTemplateVersion.template_id.in_(ids))))
            assert sources==versions==4
    asyncio.run(exercise())
