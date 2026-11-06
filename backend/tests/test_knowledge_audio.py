"""Knowledge audio stays node-scoped, lazy, authenticated and range-readable."""
import asyncio
import importlib
import json
import os
from pathlib import Path
import subprocess
import sys
from uuid import uuid4

import pytest
from fastapi.testclient import TestClient
from sqlalchemy import delete, event, select, update

from app.core.security import hash_password
from app.db.session import AsyncSessionLocal, engine
from app.main import app
from app.models.teaching_content import ContentSubject, ContentTaxonomy, TaxonomyNode
from app.models.user import User

AUDIO = b'\x00\x00\x00\x1cftypM4A \x00\x00\x00\x00M4A isommp42' + bytes(range(256)) * 4


def service():
    return importlib.import_module('app.services.knowledge_audio_service')


def login(client, username):
    assert client.post('/api/v1/auth/login', json={
        'username': username, 'password': 'audio-test-pass'}).status_code == 200


@pytest.fixture
def audio_catalog():
    token = uuid4().hex[:10]
    prefix = f'audio-{token}'
    subject, taxonomy = prefix+'-subject', prefix+'-tree'
    owners = {role: prefix+'-'+role for role in ('teacher', 'student', 'viewer')}

    async def seed():
        async with AsyncSessionLocal() as db:
            for role, username in owners.items():
                db.add(User(username=username, password_hash=hash_password('audio-test-pass'), role=role))
            db.add(ContentSubject(id=subject, code=subject, name='音频测试科目',
                                 content_metadata={'currentTaxonomyId': taxonomy}))
            await db.flush()
            for suffix, version, status in [('', 1, 'published'), ('-new', 2, 'published'), ('-draft', 3, 'draft')]:
                db.add(ContentTaxonomy(id=taxonomy+suffix, subject_id=subject,
                                       version=version, status=status, title='测试树'))
            await db.flush()
            for suffix in ('', '-new', '-draft'):
                for node in ('n1', 'n2', 'silent'):
                    db.add(TaxonomyNode(id=taxonomy+suffix+'-'+node,
                        taxonomy_id=taxonomy+suffix, node_id=node, title=node,
                        record={'id': node, 'unneededLargeRecord': 'x'*10000}))
            await db.commit()

    async def cleanup():
        async with AsyncSessionLocal() as db:
            await db.execute(delete(ContentTaxonomy).where(ContentTaxonomy.subject_id == subject))
            await db.execute(delete(ContentSubject).where(ContentSubject.id == subject))
            await db.execute(delete(User).where(User.username.in_(owners.values())))
            await db.commit()

    asyncio.run(seed())
    try:
        yield {'subject': subject, 'taxonomy': taxonomy, 'owners': owners}
    finally:
        asyncio.run(cleanup())


async def imported(catalog, *, node='n1', title='知识点讲解', data=AUDIO):
    async with AsyncSessionLocal() as db:
        result = await service().import_audio(db, actor=catalog['owners']['teacher'],
            taxonomy_id=catalog['taxonomy'], node_id=node, title=title,
            filename='讲解.m4a', data=data, duration_ms=1500, apply=True)
        return result['resource']


def test_knowledge_audio_endpoints_require_login():
    with TestClient(app) as client:
        assert client.get('/api/v1/learning/knowledge-nodes/tree/node/audios').status_code == 401
        assert client.get('/api/v1/learning/knowledge-audios/audio/content').status_code == 401
        assert client.head('/api/v1/learning/knowledge-audios/audio/content').status_code == 401


def test_dry_run_idempotence_and_editor_permissions(audio_catalog):
    async def run():
        async with AsyncSessionLocal() as db:
            args = dict(actor=audio_catalog['owners']['teacher'], taxonomy_id=audio_catalog['taxonomy'],
                        node_id='n1', title='讲解', filename='讲解.m4a', data=AUDIO, duration_ms=1500)
            planned = await service().import_audio(db, **args)
            assert planned['applied'] is False and planned['wouldCreate'] is True
            assert (await service().list_audios(db, audio_catalog['taxonomy'], 'n1'))['total'] == 0
            created = await service().import_audio(db, **args, apply=True)
            again = await service().import_audio(db, **args, apply=True)
            assert created['created'] is True and again['created'] is False
            assert created['resource']['id'] == again['resource']['id']
            assert (await service().list_audios(db, audio_catalog['taxonomy'], 'n1'))['total'] == 1
            for role in ('student', 'viewer'):
                with pytest.raises(Exception) as error:
                    await service().import_audio(db, **{**args, 'actor': audio_catalog['owners'][role]}, apply=True)
                assert error.value.status_code == 403
            with pytest.raises(Exception) as error:
                await service().import_audio(db, **{**args, 'data': b'not audio'}, apply=True)
            assert error.value.status_code == 422
    asyncio.run(run())


def test_node_summary_pagination_is_white_listed_without_binary_or_node_records(audio_catalog):
    asyncio.run(imported(audio_catalog, title='讲解一'))
    asyncio.run(imported(audio_catalog, title='讲解二', data=AUDIO+b'other'))
    asyncio.run(imported(audio_catalog, node='n2', title='其他节点'))
    statements = []
    def capture(connection, cursor, statement, parameters, context, executemany):
        statements.append(statement)
    with TestClient(app) as client:
        login(client, audio_catalog['owners']['student'])
        event.listen(engine.sync_engine, 'before_cursor_execute', capture)
        try:
            response = client.get(f"/api/v1/learning/knowledge-nodes/{audio_catalog['taxonomy']}/n1/audios?offset=1&limit=1")
        finally:
            event.remove(engine.sync_engine, 'before_cursor_execute', capture)
        assert response.status_code == 200
        body = response.json()
        assert body['total'] == 2 and body['offset'] == body['limit'] == 1 and len(body['items']) == 1
        assert set(body['items'][0]) == {'id', 'title', 'mimeType', 'byteLength', 'durationMs', 'contentUrl'}
        assert body['items'][0]['mimeType'] == 'audio/mp4'
        assert body['items'][0]['byteLength'] >= len(AUDIO)
        assert all('knowledge_node_audios.data' not in query and 'taxonomy_nodes.record' not in query
                   for query in statements), statements
        empty = client.get(f"/api/v1/learning/knowledge-nodes/{audio_catalog['taxonomy']}/silent/audios").json()
        assert empty['items'] == [] and empty['total'] == 0
        assert client.get(f"/api/v1/learning/knowledge-nodes/{audio_catalog['taxonomy']}/missing/audios").status_code == 404
        assert client.get(f"/api/v1/learning/knowledge-nodes/{audio_catalog['taxonomy']}/n1/audios?limit=101").status_code == 422


def test_media_get_head_and_ranges_read_only_requested_database_bytes(audio_catalog):
    resource = asyncio.run(imported(audio_catalog))
    url = resource['contentUrl']
    statements = []
    def capture(connection, cursor, statement, parameters, context, executemany):
        statements.append(statement)
    with TestClient(app) as client:
        login(client, audio_catalog['owners']['viewer'])
        response = client.get(url)
        assert response.status_code == 200 and response.content == AUDIO
        assert response.headers['content-type'] == 'audio/mp4'
        assert response.headers['accept-ranges'] == 'bytes'
        assert response.headers['x-content-type-options'] == 'nosniff'
        event.listen(engine.sync_engine, 'before_cursor_execute', capture)
        try:
            head = client.head(url, headers={'Range': 'bytes=0-1'})
        finally:
            event.remove(engine.sync_engine, 'before_cursor_execute', capture)
        assert head.status_code == 200 and head.content == b''
        assert int(head.headers['content-length']) == len(AUDIO)
        assert all('knowledge_node_audios.data' not in query for query in statements)
        for header, expected, bounds in [
            ('bytes=0-0', AUDIO[:1], (0, 0)),
            ('bytes=25-44', AUDIO[25:45], (25, 44)),
            ('bytes=1000-', AUDIO[1000:], (1000, len(AUDIO)-1)),
            ('bytes=-16', AUDIO[-16:], (len(AUDIO)-16, len(AUDIO)-1)),
            ('bytes=10-999999', AUDIO[10:], (10, len(AUDIO)-1)),
        ]:
            statements.clear()
            event.listen(engine.sync_engine, 'before_cursor_execute', capture)
            try:
                part = client.get(url, headers={'Range': header})
            finally:
                event.remove(engine.sync_engine, 'before_cursor_execute', capture)
            assert part.status_code == 206 and part.content == expected
            assert part.headers['content-range'] == f'bytes {bounds[0]}-{bounds[1]}/{len(AUDIO)}'
            assert int(part.headers['content-length']) == len(expected)
            binary_queries = [query for query in statements if 'knowledge_node_audios.data' in query]
            assert len(binary_queries) == 1 and ('substr(' in binary_queries[0] or 'substring(' in binary_queries[0]), statements
        for header in ('bytes=99999-', 'bytes=20-10', 'bytes=-0', 'bytes=0-1,4-5', 'items=0-1', 'bytes=-', 'bytes=not-a-range'):
            invalid = client.get(url, headers={'Range': header})
            assert invalid.status_code == 416
            assert invalid.headers['content-range'] == f'bytes */{len(AUDIO)}'


def test_archived_replaced_or_inactive_catalog_never_exposes_audio(audio_catalog):
    resource = asyncio.run(imported(audio_catalog))
    with TestClient(app) as client:
        login(client, audio_catalog['owners']['student'])
        for taxonomy in (audio_catalog['taxonomy']+'-new', audio_catalog['taxonomy']+'-draft'):
            assert client.get(f'/api/v1/learning/knowledge-nodes/{taxonomy}/n1/audios').status_code == 404
        async def change(model, condition, values):
            async with AsyncSessionLocal() as db:
                await db.execute(update(model).where(condition).values(**values))
                await db.commit()
        for model, condition, changed, restore in [
            (TaxonomyNode, (TaxonomyNode.taxonomy_id==audio_catalog['taxonomy']) & (TaxonomyNode.node_id=='n1'), {'status':'inactive'}, {'status':'active'}),
            (ContentTaxonomy, ContentTaxonomy.id==audio_catalog['taxonomy'], {'status':'archived'}, {'status':'published'}),
            (ContentSubject, ContentSubject.id==audio_catalog['subject'], {'status':'inactive'}, {'status':'active'}),
            (ContentSubject, ContentSubject.id==audio_catalog['subject'], {'content_metadata':{'currentTaxonomyId':audio_catalog['taxonomy']+'-new'}}, {'content_metadata':{'currentTaxonomyId':audio_catalog['taxonomy']}}),
        ]:
            asyncio.run(change(model, condition, changed))
            assert client.get(resource['contentUrl']).status_code == 404
            assert client.head(resource['contentUrl']).status_code == 404
            asyncio.run(change(model, condition, restore))
        assert client.get(resource['contentUrl']).content == AUDIO


def test_node_rebuild_preserves_audio_and_universe_only_adds_positive_counts(audio_catalog):
    resource = asyncio.run(imported(audio_catalog))
    async def rebuild():
        async with AsyncSessionLocal() as db:
            await db.execute(delete(TaxonomyNode).where(TaxonomyNode.taxonomy_id==audio_catalog['taxonomy'], TaxonomyNode.node_id=='n1'))
            await db.flush()
            db.add(TaxonomyNode(id=audio_catalog['taxonomy']+'-replacement', taxonomy_id=audio_catalog['taxonomy'], node_id='n1', title='重建后节点'))
            await db.commit()
    asyncio.run(rebuild())
    with TestClient(app) as client:
        login(client, audio_catalog['owners']['student'])
        assert client.get(resource['contentUrl']).content == AUDIO
        universe = client.get('/api/v1/learning/practice/knowledge-universe').json()
        own = {node['primaryNodeId']: node for node in universe['nodes'] if node['taxonomyId']==audio_catalog['taxonomy']}
        assert own['n1']['audioCount'] == 1
        assert 'audioCount' not in own['n2'] and 'audioCount' not in own['silent']
        assert not any('contentUrl' in node or 'audios' in node for node in universe['nodes'])
        assert universe['attemptCount'] == 0


def test_cli_is_read_only_by_default_and_explicit_apply_repeats_safely(audio_catalog, tmp_path):
    filename = tmp_path/'lecture.m4a'
    filename.write_bytes(AUDIO)
    command = [sys.executable, '-m', 'app.cli.import_knowledge_audio', '--actor', audio_catalog['owners']['teacher'],
               '--taxonomy-id', audio_catalog['taxonomy'], '--node-id', 'n1', '--file', str(filename),
               '--title', 'CLI讲解', '--duration-ms', '1500']
    def run(extra=()):
        result = subprocess.run(command+list(extra), cwd=Path(__file__).resolve().parents[1],
                                env=dict(os.environ), text=True, capture_output=True)
        assert result.returncode == 0, result.stderr
        return json.loads(result.stdout)
    assert run()['applied'] is False
    assert run(['--apply'])['created'] is True
    assert run(['--apply'])['created'] is False


def test_colon_containing_taxonomy_and_node_ids_remain_distinct(audio_catalog):
    first_taxonomy = audio_catalog['taxonomy']+':tree'
    second_taxonomy = first_taxonomy+':part'
    subjects = [audio_catalog['subject']+'-scope-a', audio_catalog['subject']+'-scope-b']

    async def run():
        async with AsyncSessionLocal() as db:
            try:
                resources = []
                for subject, taxonomy, node, title in [
                    (subjects[0], first_taxonomy, 'part:node', '科目A讲解'),
                    (subjects[1], second_taxonomy, 'node', '科目B讲解'),
                ]:
                    db.add(ContentSubject(id=subject, code=subject, name=subject,
                                         content_metadata={'currentTaxonomyId': taxonomy}))
                    await db.flush()
                    db.add(ContentTaxonomy(id=taxonomy, subject_id=subject, status='published', version=1))
                    await db.flush()
                    db.add(TaxonomyNode(id=taxonomy+'-node', taxonomy_id=taxonomy, node_id=node, title=title))
                    await db.commit()
                    imported = await service().import_audio(db, actor=audio_catalog['owners']['teacher'],
                        taxonomy_id=taxonomy, node_id=node, title=title, filename='讲解.m4a',
                        data=AUDIO, duration_ms=1500, apply=True)
                    resources.append(imported['resource'])
                assert resources[0]['id'] != resources[1]['id'], 'Stable IDs must encode tuple boundaries'
                first = await service().list_audios(db, first_taxonomy, 'part:node')
                second = await service().list_audios(db, second_taxonomy, 'node')
                assert first['total'] == second['total'] == 1
                assert first['items'][0]['title'] == '科目A讲解'
                assert second['items'][0]['title'] == '科目B讲解'
            finally:
                await db.rollback()
                await db.execute(delete(ContentTaxonomy).where(ContentTaxonomy.id.in_([first_taxonomy, second_taxonomy])))
                await db.execute(delete(ContentSubject).where(ContentSubject.id.in_(subjects)))
                await db.commit()
    asyncio.run(run())
