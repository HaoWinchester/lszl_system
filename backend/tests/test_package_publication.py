"""Real disposable PostgreSQL checks for authored-package publication/repair."""
import asyncio
from copy import deepcopy
from datetime import datetime, timezone
import hashlib
import importlib.util
import json
from pathlib import Path
import subprocess
from uuid import uuid4

import pytest
from sqlalchemy import select, func
from app.db.session import AsyncSessionLocal
from app.models.file import GraphFile, FileContent, CurrentFile
from app.models.graph_template import GraphTemplate, GraphTemplateVersion
from app.models.user import User
from app.services import file_service, graph_template_service

ROOT=Path(__file__).resolve().parents[2]
spec=importlib.util.spec_from_file_location('package_publication',ROOT/'内置数据/shared/publication.py')
pub=importlib.util.module_from_spec(spec);spec.loader.exec_module(pub)


def run(coro):return asyncio.run(coro)


async def actor(db):
    name='pkg_'+uuid4().hex[:12]
    user=User(username=name,password_hash='unused',role='admin',status='active',display_name=name)
    db.add(user);await db.commit();await db.refresh(user)
    return user


def package(legacy=False):
    catalog,graphs=pub.read_package(ROOT/'内置数据'/('PMP8知识图谱' if legacy else '项目管理基础图谱'))
    catalog=deepcopy(catalog);graphs=deepcopy(graphs[:2]);prefix=uuid4().hex[:8]
    for item,graph in graphs:
        item['name']=prefix+' '+item['name'];graph['meta']['title']=item['name']
        if legacy:
            item['id']=prefix+'-'+item['id']
            item['sourceKey']=catalog['packageId']+':'+item['id']
            graph['meta']['topicId']=item['id']
        if not legacy:
            catalog['packageId']='test-'+prefix
            item['sourceKey']=catalog['packageId']+':'+item['id'];graph['meta']['contentPackageId']=catalog['packageId']
    catalog.update(graphCount=2,nodeCount=sum(len(g['nodes']) for _,g in graphs),linkCount=sum(len(g['links']) for _,g in graphs))
    return catalog,graphs


async def counts(db):
    return tuple([await db.scalar(select(func.count()).select_from(model)) for model in (GraphFile,FileContent,GraphTemplate,GraphTemplateVersion)])


async def database_state(db):
    result=[]
    for model in (GraphFile, FileContent, GraphTemplate, GraphTemplateVersion):
        rows=(await db.scalars(select(model).order_by(*model.__table__.primary_key))).all()
        result.append([tuple(deepcopy(getattr(row,column.name)) for column in model.__table__.columns) for row in rows])
    return result


def test_dry_run_apply_idempotence_category_and_source_conflict():
    async def scenario():
        async with AsyncSessionLocal() as db:
            user=await actor(db);catalog,graphs=package()
            before=await counts(db)
            plan=await pub.apply_publication(db,user,catalog,graphs)
            assert len(plan['templates'])==2 and await counts(db)==before
            result=await pub.apply_publication(db,user,catalog,graphs,apply=True)
            assert result['created']==2
            after=await counts(db)
            assert await db.get(CurrentFile,user.username) is None
            result=await pub.apply_publication(db,user,catalog,graphs,apply=True)
            assert result['created']==0 and result['unchanged']==2 and await counts(db)==after
            row=await db.get(GraphTemplate,result['templates'][0]['templateId']);row.category='general';await db.commit()
            result=await pub.apply_publication(db,user,catalog,graphs,apply=True)
            assert result['categoriesUpdated']==1 and await counts(db)==after
            content=await db.get(FileContent,result['templates'][1]['fileId'])
            modified=deepcopy(content.graph_data);modified['nodes'][0]['content']['notes']='personal edit';content.graph_data=modified;await db.commit()
            content_id=content.file_id
            with pytest.raises(ValueError,match='source differs'):
                await pub.apply_publication(db,user,catalog,graphs,apply=True)
            assert await counts(db)==after and (await db.get(FileContent,content_id)).graph_data==modified
    run(scenario())


def backup(tmp_path, monkeypatch):
    dump=tmp_path/'dev.dump'
    # The backup verifier checks pg_restore validity, DB identity, digest and age;
    # dump only the disposable test DB, never access actual developer data.
    from app.core.config import settings
    from sqlalchemy.engine import make_url
    url=make_url(settings.DATABASE_URL)
    subprocess.run(['pg_dump','-Fc','-h',url.query.get('host','/tmp'),'-U',url.username,'-f',str(dump),url.database],check=True,capture_output=True)
    evidence=tmp_path/'backup.json'
    evidence.write_text(json.dumps({'path':str(dump),'database':'kg_graph_dev','createdAt':datetime.now(timezone.utc).isoformat(),'sha256':hashlib.sha256(dump.read_bytes()).hexdigest()}))
    original_run=subprocess.run
    def archive_header_only(args, **kwargs):
        result=original_run(args, **kwargs)
        if args[:2]==['pg_restore','--list']:
            # Never dump dev in tests: emulate only archive DB identity after
            # parsing a real disposable-DB archive. Hash/time/restore stay real.
            result.stdout=result.stdout.replace(';     dbname: '+url.database, ';     dbname: kg_graph_dev')
        return result
    monkeypatch.setattr(pub.subprocess,'run',archive_header_only)
    return evidence


async def old_sources(db):
    user=await actor(db);catalog,graphs=package(legacy=True)
    folder=await file_service.create_folder(db,user.username,'old-import')
    receipt={'username':user.username,'baseUrl':'http://127.0.0.1:5173','folderId':folder.id,'graphs':[]}
    for item,graph in graphs:
        source=await file_service.create_file(db,user.username,name=item['name'],folder_id=folder.id,graph_data=graph,source='imported')
        from app.schemas.graph_template import PublicationInput
        result=await graph_template_service.publish(db,user,PublicationInput(sourceFileId=source.id,expectedFileRevision=source.revision,name=item['name'],memberOnly=False))
        receipt['graphs'].append({'id':item['id'],'name':item['name'],'fileId':source.id,'templateId':result['template']['id'],'version':1})
        content=await db.get(FileContent,source.id)
        normalized=deepcopy(content.graph_data)
        normalized['meta']={k:v for k,v in normalized['meta'].items() if k in {'title','subject','audience','description'}}
        normalized['defaults']=deepcopy(pub.EDITOR_DEFAULTS);normalized.pop('resources',None)
        content.graph_data=normalized;await db.commit()
    personal=await file_service.create_file(db,user.username,name=graphs[0][0]['name'],graph_data={'nodes':[],'links':[]},source='template',source_file_id=receipt['graphs'][0]['templateId'])
    db.add(CurrentFile(owner_id=user.username,file_id=personal.id));await db.commit()
    return user,catalog,graphs,receipt,personal.id


async def snapshot(db,receipt,personal):
    values=[]
    for fid in [r['fileId'] for r in receipt['graphs']]+[personal]:
        source=await db.get(GraphFile,fid);content=await db.get(FileContent,fid)
        values.append((fid,deepcopy(content.graph_data),deepcopy(content.learning_state),content.revision,content.saved_at,source.revision,source.updated_at,source.created_at))
    versions=[(v.id,v.template_id,v.version,v.source_file_id,v.source_revision,v.asset_owner,deepcopy(v.graph_data),deepcopy(v.bindings)) for v in (await db.scalars(select(GraphTemplateVersion).where(GraphTemplateVersion.template_id.in_([r['templateId'] for r in receipt['graphs']])).order_by(GraphTemplateVersion.id))).all()]
    return values,await counts(db),(await db.get(CurrentFile,(await db.get(GraphFile,personal)).owner_id)).file_id,versions


@pytest.mark.parametrize('snapshot_roundtrip',[False,True])
def test_local_repair_roundtrip_preserves_everything_and_publication_rerun(tmp_path,monkeypatch,snapshot_roundtrip):
    async def scenario():
        async with AsyncSessionLocal() as db:
            user,catalog,graphs,receipt,personal=await old_sources(db)
            if snapshot_roundtrip:
                for entry in receipt['graphs']:
                    version=await db.scalar(select(GraphTemplateVersion).where(GraphTemplateVersion.template_id==entry['templateId']))
                    graph=deepcopy(version.graph_data);graph['defaults']=deepcopy(pub.EDITOR_DEFAULTS);graph.pop('resources',None);version.graph_data=graph
                await db.commit()
            before=await snapshot(db,receipt,personal)
            result=await pub.repair_receipt(db,user,catalog,graphs,receipt)
            assert all(p['action']=='repair' for p in result['templates']) and before==await snapshot(db,receipt,personal)
            evidence=backup(tmp_path,monkeypatch)
            result=await pub.repair_receipt(db,user,catalog,graphs,receipt,apply=True,backup_evidence=evidence)
            assert result['repaired']==2 and before==await snapshot(db,receipt,personal)
            result=await pub.repair_receipt(db,user,catalog,graphs,receipt,apply=True,backup_evidence=evidence)
            assert result['repaired']==0
            result=await pub.apply_publication(db,user,catalog,graphs,apply=True)
            assert result['unchanged']==2 and before==await snapshot(db,receipt,personal)
    run(scenario())


@pytest.mark.parametrize('fault',['edited','owner','duplicate','snapshot','backup','sourceKey'])
def test_repair_rejects_entire_batch_before_writes(tmp_path,monkeypatch,fault):
    async def scenario():
        async with AsyncSessionLocal() as db:
            user,catalog,graphs,receipt,personal=await old_sources(db)
            if fault=='edited':
                content=await db.get(FileContent,receipt['graphs'][-1]['fileId']);graph=deepcopy(content.graph_data);graph['nodes'][0]['content']['notes']='edited';content.graph_data=graph
            if fault=='owner':receipt['username']='another'
            if fault=='duplicate':receipt['graphs'][-1]['fileId']=receipt['graphs'][0]['fileId']
            if fault=='snapshot':
                version=await db.scalar(select(GraphTemplateVersion).where(GraphTemplateVersion.template_id==receipt['graphs'][-1]['templateId']));graph=deepcopy(version.graph_data);graph['meta']['contentPackageId']='wrong';version.graph_data=graph
            if fault=='sourceKey':
                await file_service.create_file(db,user.username,name='collision',source='builtin-template',source_file_id=graphs[-1][0]['sourceKey'],graph_data=graphs[-1][1])
            await db.commit()
            before=await snapshot(db,receipt,personal)
            evidence=None if fault=='backup' else backup(tmp_path,monkeypatch)
            with pytest.raises(ValueError):
                await pub.repair_receipt(db,user,catalog,graphs,receipt,apply=True,backup_evidence=evidence)
            assert before==await snapshot(db,receipt,personal)
            source=await db.get(GraphFile,receipt['graphs'][0]['fileId']);assert source.source=='imported'
    run(scenario())


def test_late_service_failure_rolls_back_complete_batch(monkeypatch):
    async def scenario():
        async with AsyncSessionLocal() as db:
            user=await actor(db);catalog,graphs=package();before=await counts(db)
            original=graph_template_service.publish;calls=0
            async def fail_second(*args,**kwargs):
                nonlocal calls
                calls+=1
                if calls==2:raise RuntimeError('injected second publication failure')
                return await original(*args,**kwargs)
            monkeypatch.setattr(graph_template_service,'publish',fail_second)
            with pytest.raises(RuntimeError,match='second publication'):
                await pub.apply_publication(db,user,catalog,graphs,apply=True)
            assert await counts(db)==before
    run(scenario())


@pytest.mark.parametrize('fault',['folder','source','template','wrongOwner'])
def test_complete_preflight_prevents_earlier_creations(fault):
    async def scenario():
        async with AsyncSessionLocal() as db:
            user=await actor(db);catalog,graphs=package();item,graph=graphs[-1]
            if fault=='folder':
                folder=await file_service.create_folder(db,user.username,catalog['packageId']+' · 模板源');folder.status='trashed';await db.commit()
            else:
                source=await file_service.create_file(db,user.username,name=item['name'],graph_data=graph,source='builtin-template',source_file_id=item['sourceKey'])
                if fault=='source':source.status='trashed'
                if fault=='wrongOwner':
                    other=await actor(db);source.owner_id=other.username
                if fault=='template':
                    from app.schemas.graph_template import PublicationInput
                    template=await graph_template_service.publish(db,user,PublicationInput(sourceFileId=source.id,expectedFileRevision=source.revision,name=item['name']))
                    row=await db.get(GraphTemplate,template['template']['id']);row.listed=False
                await db.commit()
            before=await counts(db)
            with pytest.raises(ValueError):await pub.apply_publication(db,user,catalog,graphs,apply=True)
            assert await counts(db)==before
    run(scenario())


@pytest.mark.parametrize('fault',['renamed','wrongOwner','historical','ambiguous'])
def test_source_bound_publication_identity_drift_aborts_before_writes(fault):
    async def scenario():
        async with AsyncSessionLocal() as db:
            user=await actor(db);catalog,graphs=package()
            result=await pub.apply_publication(db,user,catalog,graphs,apply=True)
            first=await db.get(GraphTemplate,result['templates'][0]['templateId']);first.category='general'
            entry=result['templates'][-1];row=await db.get(GraphTemplate,entry['templateId'])
            if fault=='renamed':row.name='renamed '+row.name
            if fault=='wrongOwner':
                other=await actor(db);row.name='other '+row.name;row.owner_id=other.username
            if fault=='historical':
                # Catalog source remains bound to historical version1; current
                # publication name and source have both moved to another file.
                other=await file_service.create_file(db,user.username,name='new publication source',graph_data=graphs[-1][1],source='created')
                from app.schemas.graph_template import PublicationInput
                await graph_template_service.publish(db,user,PublicationInput(sourceFileId=other.id,expectedFileRevision=other.revision,name='moved publication'),template_id=row.id)
            if fault=='ambiguous':
                from app.schemas.graph_template import PublicationInput
                await graph_template_service.publish(db,user,PublicationInput(sourceFileId=entry['fileId'],expectedFileRevision=1,name='duplicate source publication'))
            await db.commit()
            before=await counts(db)
            before_state=await database_state(db)
            with pytest.raises(ValueError):await pub.apply_publication(db,user,catalog,graphs,apply=True)
            assert await counts(db)==before
            assert before_state==await database_state(db)
    run(scenario())


@pytest.mark.parametrize('fault',['mindmap','unknownMeta','retainedAuthoringMeta','unknownGraphField','defaults','flashReviews','importedFlashcards','fileLearningState','snapshotAuthoringMeta'])
def test_repair_rejects_non_roundtrip_graph_edits(tmp_path,monkeypatch,fault):
    async def scenario():
        async with AsyncSessionLocal() as db:
            user,catalog,graphs,receipt,personal=await old_sources(db)
            content=await db.get(FileContent,receipt['graphs'][-1]['fileId'])
            graph=deepcopy(content.graph_data)
            if fault=='mindmap':graph['mindmap']={'rootIds':[graph['nodes'][1]['id']],'themeId':'mint','direction':'left'}
            if fault=='unknownMeta':graph['meta']['customTeachingNote']='personal edit'
            if fault=='retainedAuthoringMeta':graph['meta']['edition']='changed edition'
            if fault=='unknownGraphField':graph['unrecognizedPersistedContent']={'edited':True}
            if fault=='defaults':graph['defaults']['nodeColor']='#ff0000'
            if fault=='flashReviews':graph['flashReviews']={graph['nodes'][0]['id']:{'reviewCount':1}}
            if fault=='importedFlashcards':graph['importedFlashcards']=[{'id':'studied'}]
            if fault=='fileLearningState':content.learning_state={'reviewCount':1}
            if fault=='snapshotAuthoringMeta':
                version=await db.scalar(select(GraphTemplateVersion).where(GraphTemplateVersion.template_id==receipt['graphs'][-1]['templateId']))
                edited=deepcopy(version.graph_data);edited['meta']['edition']='changed snapshot edition';version.graph_data=edited
            content.graph_data=graph;await db.commit()
            before=await snapshot(db,receipt,personal);before_state=await database_state(db);evidence=backup(tmp_path,monkeypatch)
            with pytest.raises(ValueError):await pub.repair_receipt(db,user,catalog,graphs,receipt,apply=True,backup_evidence=evidence)
            assert before==await snapshot(db,receipt,personal)
            assert before_state==await database_state(db)
            assert (await db.get(GraphFile,receipt['graphs'][0]['fileId'])).source=='imported'
    run(scenario())


@pytest.mark.parametrize('fault',['mindmap','unknownMeta','authoringMeta','defaults','studyState'])
def test_repaired_legacy_rerun_refuses_source_drift(tmp_path,monkeypatch,fault):
    async def scenario():
        async with AsyncSessionLocal() as db:
            user,catalog,graphs,receipt,personal=await old_sources(db)
            await pub.repair_receipt(db,user,catalog,graphs,receipt,apply=True,backup_evidence=backup(tmp_path,monkeypatch))
            content=await db.get(FileContent,receipt['graphs'][-1]['fileId']);graph=deepcopy(content.graph_data)
            if fault=='mindmap':graph['mindmap']={'rootIds':['changed']}
            if fault=='unknownMeta':graph['meta']['customNote']='changed'
            if fault=='authoringMeta':graph['meta']['layout']='changed'
            if fault=='defaults':graph['defaults']['linkColor']='#ff0000'
            if fault=='studyState':graph['flashReviews']={'studied':{'reviewCount':1}}
            content.graph_data=graph;await db.commit()
            before=await snapshot(db,receipt,personal)
            with pytest.raises(ValueError,match='source differs'):
                await pub.apply_publication(db,user,catalog,graphs,apply=True)
            assert before==await snapshot(db,receipt,personal)
    run(scenario())
