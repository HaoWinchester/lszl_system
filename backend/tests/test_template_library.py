"""Real personal-file/library boundaries and persistent publication categories."""
import asyncio

import pytest
from fastapi.testclient import TestClient

from app.db.session import AsyncSessionLocal
from app.main import app
from app.models.file import CurrentFile, FileContent, GraphFile
from app.models.user import User
from app.services import file_service
from test_graph_templates import data, publication, publish, load, login


def run(coroutine):
    return asyncio.run(coroutine)


def source(owner, folder=None, *, trashed=False):
    async def create():
        async with AsyncSessionLocal() as db:
            file = await file_service.create_file(db, owner, name='内部模板源', folder_id=folder,
                source='builtin-template', source_file_id='pmp8-knowledge-graphs-20261025:01',
                graph_data={'meta': {'contentPackageId': 'pmp8-knowledge-graphs-20261025'},
                            'nodes': [{'id': 'n', 'title': '主题'}], 'links': []})
            if trashed:
                file.status = 'trashed'
                await db.commit()
                await db.refresh(file)
            return file.id
    return run(create())


def current(owner, file_id):
    async def set_pointer():
        async with AsyncSessionLocal() as db:
            row = await db.get(CurrentFile, owner)
            if row:
                row.file_id = file_id
            else:
                db.add(CurrentFile(owner_id=owner, file_id=file_id))
            await db.commit()
    run(set_pointer())


def create(c, name='个人图谱', **kwargs):
    r = c.post('/api/v1/files', json={'name': name, **kwargs})
    assert r.status_code == 200, r.text
    return r.json()['file']['id']


def test_library_sources_excluded_from_listing_search_stats_and_order(data):
    with TestClient(app) as c:
        login(c, data, 'teacher')
        personal = create(c)
        hidden = source(data.teacher)
        source(data.teacher, trashed=True)
        listed = c.get('/api/v1/files').json()
        assert {f['id'] for f in listed['files']} == {personal}
        assert listed['total'] == 1
        assert c.get('/api/v1/files', params={'query': '内部模板源'}).json()['total'] == 0
        assert c.get('/api/v1/files', params={'status': 'trashed'}).json()['total'] == 0
        stats = c.get('/api/v1/files/stats').json()
        assert stats['activeCount'] == 1 and stats['trashedCount'] == 0
        assert stats['totalNodes'] == 0
        assert stats['activeBytes'] == c.get('/api/v1/files/'+personal).json()['meta']['byteSize']
        assert c.put('/api/v1/files/order', json={'fileIds': [hidden]}).status_code == 404
        assert c.put('/api/v1/files/order', json={'fileIds': [personal]}).json()['fileIds'] == [personal]


@pytest.mark.parametrize('method,suffix,body', [
    ('get', '', None), ('put', '', {'graphData': {'nodes': []}}),
    ('patch', '', {'name': '不许修改'}), ('delete', '', None),
    ('post', '/duplicate', {}), ('put', '/tag', {'tagId': None}),
    ('post', '/restore', {}), ('delete', '/permanent', None),
])
def test_internal_source_denied_by_personal_file_api(data, method, suffix, body):
    hidden = source(data.teacher, trashed=suffix in ('/restore', '/permanent'))
    with TestClient(app) as c:
        login(c, data, 'teacher')
        response = c.request(method, '/api/v1/files/'+hidden+suffix, json=body)
        assert response.status_code == 404, response.text
        assert c.put('/api/v1/files/current', json={'fileId': hidden}).status_code == 404


def test_reserved_source_cannot_be_created_by_api(data):
    with TestClient(app) as c:
        login(c, data, 'admin')
        r = c.post('/api/v1/files', json={'name': '伪造库源', 'source': 'builtin-template'})
        assert r.status_code == 422
        assert c.get('/api/v1/files').json()['total'] == 0


@pytest.mark.parametrize('bad_pointer', ['library', 'foreign', 'missing', 'trashed'])
def test_invalid_current_recovers_last_opened_personal_and_persists(data, bad_pointer):
    with TestClient(app) as c:
        login(c, data, 'teacher')
        earlier = create(c, '较早')
        recent = create(c, '最近')
        c.get('/api/v1/files/'+earlier)
        c.get('/api/v1/files/'+recent)
        hidden = source(data.teacher)
        if bad_pointer == 'foreign':
            login(c, data, 'other')
            hidden = create(c)
            login(c, data, 'teacher')
        elif bad_pointer == 'missing':
            hidden = 'file-no-longer-exists'
        elif bad_pointer == 'trashed':
            hidden = create(c)
            c.delete('/api/v1/files/'+hidden)
        current(data.teacher, hidden)
        assert c.get('/api/v1/files/current').json()['fileId'] == recent
        c.post('/api/v1/auth/logout')
        login(c, data, 'teacher')
        assert c.get('/api/v1/files/current').json()['fileId'] == recent
        assert c.put('/api/v1/files/current', json={'fileId': None}).status_code == 200
        assert c.get('/api/v1/files/current').json()['fileId'] is None


def test_current_without_personal_files_or_without_pointer_stays_empty(data):
    hidden = source(data.teacher)
    current(data.teacher, hidden)
    with TestClient(app) as c:
        login(c, data, 'teacher')
        assert c.get('/api/v1/files/current').json()['fileId'] is None
        create(c)
        assert c.get('/api/v1/files/current').json()['fileId'] is None


def test_mixed_folder_keeps_personal_descendants_and_delete_fallback_skips_sources(data):
    with TestClient(app) as c:
        login(c, data, 'teacher')
        folder = lambda name, parent=None: c.post('/api/v1/files/folders', json={'name': name, 'parentId': parent}).json()['folder']['id']
        hidden_folder = folder('同名文件夹')
        library = source(data.teacher, hidden_folder)
        mixed = folder('同名文件夹')
        child = folder('个人子目录', mixed)
        personal = create(c, folderId=child)
        mixed_source = source(data.teacher, mixed)
        empty = folder('个人空目录')
        listed = {f['id'] for f in c.get('/api/v1/files/folders').json()['folders']}
        assert listed == {mixed, child, empty}
        assert c.get('/api/v1/files', params={'folder_id': hidden_folder}).json()['total'] == 0
        c.put('/api/v1/files/current', json={'fileId': personal})
        assert c.delete('/api/v1/files/folders/'+mixed).status_code == 200
        assert c.get('/api/v1/files/current').json()['fileId'] is None
        c.post('/api/v1/files/trash/empty')
        async def assert_sources_intact():
            async with AsyncSessionLocal() as db:
                for fid in (library, mixed_source):
                    row = await db.get(GraphFile, fid)
                    assert row is not None and row.status == 'active'
                    assert await db.get(FileContent, fid) is not None
        run(assert_sources_intact())
        login(c, data, 'other')
        assert c.get('/api/v1/files').json()['total'] == 0
        assert c.get('/api/v1/files/'+personal).status_code == 404


def test_trashing_current_file_never_selects_library_fallback(data):
    hidden = source(data.teacher)
    with TestClient(app) as c:
        login(c, data, 'teacher')
        personal = create(c)
        c.put('/api/v1/files/current', json={'fileId': personal})
        c.delete('/api/v1/files/'+personal)
        assert c.get('/api/v1/files/current').json()['fileId'] is None


@pytest.mark.parametrize('category,label', [('pmp','PMP'),('prince2','PRINCE2'),('cspm','CSPM'),('gaoxiang','高项'),('general','通用学习')])
def test_categories_round_trip_through_publish_catalog_preview_and_legacy_update(data, category, label):
    hidden = source(data.teacher)
    with TestClient(app) as c:
        login(c, data, 'teacher')
        async def set_name():
            async with AsyncSessionLocal() as db:
                user = await db.get(User, data.teacher)
                user.display_name = '模板讲师'
                await db.commit()
        run(set_name())
        template = publish(c, {**publication(hidden), 'category': category})
        assert template['category'] == category and template['categoryLabel'] == label
        assert template['publisherName'] == '模板讲师' and template['isBuiltin'] is True
        tid = template['id']
        catalog = c.get('/api/v1/graph-templates').json()['templates']
        listed = next(row for row in catalog if row['id'] == tid)
        assert listed == template and 'graphData' not in listed
        assert c.get('/api/v1/graph-templates/'+tid).json()['template'] == template
        result = c.post('/api/v1/graph-templates/'+tid+'/versions', json=publication(hidden))
        assert result.status_code == 201, result.text
        assert result.json()['template']['category'] == category
        assert c.patch('/api/v1/graph-templates/'+tid, json={'listed': False}).json()['template']['category'] == category
        changed = c.post('/api/v1/graph-templates/'+tid+'/versions', json={**publication(hidden), 'category': 'prince2'})
        assert changed.json()['template']['category'] == 'prince2'
        assert changed.json()['template']['listed'] is False


def test_legacy_new_publication_defaults_and_loaded_copy_remains_personal(data):
    with TestClient(app) as c:
        login(c, data, 'teacher')
        fid = create(c)
        template = publish(c, publication(fid))
        assert template['category'] == 'general' and template['isBuiltin'] is False
        assert template['publisherName'] == '教师模板'
        catalog = c.get('/api/v1/graph-templates').json()
        assert data.teacher not in str(catalog)
        login(c, data, 'student')
        response = load(c, template)
        assert response.status_code == 201, response.text
        copied = response.json()['fileId']
        assert c.get('/api/v1/files').json()['files'][0]['id'] == copied
        assert c.get('/api/v1/files/'+copied).json()['meta']['source'] == 'template'
        assert c.patch('/api/v1/files/'+copied, json={'name': '自己的副本'}).status_code == 200
        assert c.put('/api/v1/files/current', json={'fileId': copied}).status_code == 200
        assert c.get('/api/v1/files/current').json()['fileId'] == copied
        assert c.delete('/api/v1/files/'+copied).status_code == 200


@pytest.mark.parametrize('category', ['PMP', 'unsupported', '', None, 123])
def test_invalid_category_rejected_without_publication(data, category):
    with TestClient(app) as c:
        login(c, data, 'teacher')
        fid = create(c)
        assert c.post('/api/v1/graph-templates', json={**publication(fid), 'category': category}).status_code == 422


def test_current_recovery_preserves_a_concurrent_personal_choice(data):
    """A recovery waiting on a committed preference must return that user's choice."""
    from sqlalchemy import select, text
    with TestClient(app) as c:
        login(c, data, 'teacher')
        chosen = create(c, '用户主动选择')
        recent = create(c, '自动恢复候选')
        c.get('/api/v1/files/'+recent)
        current(data.teacher, source(data.teacher))

    async def race():
        async with AsyncSessionLocal() as writer, AsyncSessionLocal() as reader:
            pointer = await writer.scalar(select(CurrentFile).where(
                CurrentFile.owner_id == data.teacher).with_for_update())
            pointer.file_id = chosen
            await writer.flush()
            reader_pid = await reader.scalar(text('SELECT pg_backend_pid()'))
            recovering = asyncio.create_task(file_service.get_current(reader, data.teacher))
            # Observe a real blocked DB lock before committing; avoid scheduler timing assumptions.
            async def blocked_on_writer():
                while not await writer.scalar(text(
                    'SELECT EXISTS (SELECT 1 FROM pg_locks WHERE pid=:pid AND NOT granted)'
                ), {'pid': reader_pid}):
                    if recovering.done():
                        raise AssertionError('recovery did not serialize with preference writer')
                    await asyncio.sleep(0.01)
            await asyncio.wait_for(blocked_on_writer(), timeout=5)
            await writer.commit()
            assert await asyncio.wait_for(recovering, timeout=5) == chosen
        async with AsyncSessionLocal() as verify:
            assert (await verify.get(CurrentFile, data.teacher)).file_id == chosen
    run(race())


def test_admin_publication_keeps_builtin_provenance_on_teacher_owned_template(data):
    with TestClient(app) as c:
        login(c, data, 'teacher')
        template = publish(c, publication(create(c)))
        login(c, data, 'admin')
        admin_source = source(data.admin)
        response = c.post('/api/v1/graph-templates/'+template['id']+'/versions',
                          json={**publication(admin_source), 'category': 'pmp'})
        assert response.status_code == 201, response.text
        assert response.json()['template']['isBuiltin'] is True
        login(c, data, 'teacher')
        preview = c.get('/api/v1/graph-templates/'+template['id']).json()
        assert preview['template']['isBuiltin'] is True
        assert preview['template']['canMaintain'] is True


@pytest.mark.parametrize('target_source', ['builtin-template', 'template'])
def test_fragment_paste_protects_library_target_and_keeps_personal_template_copy(data, target_source):
    with TestClient(app) as c:
        login(c, data, 'teacher')
        target = source(data.teacher) if target_source == 'builtin-template' else create(c, source='template')

        async def snapshot():
            async with AsyncSessionLocal() as db:
                index = await db.get(GraphFile, target)
                content = await db.get(FileContent, target)
                return {'meta': file_service.file_meta(index), 'graph': content.graph_data,
                        'contentRevision': content.revision, 'savedAt': content.saved_at}

        before = run(snapshot())
        response = c.post('/api/v1/files/'+target+'/fragments', json={
            'expectedFileRevision': 1,
            'fragment': {'format': 'kg-graph-fragment', 'version': 1,
                         'nodes': [{'id': 'pasted-node', 'title': '个人新增卡片'}],
                         'links': [], 'elements': [], 'tables': [], 'source': {'nodeIds': []}},
        })
        after = run(snapshot())
        if target_source == 'builtin-template':
            assert response.status_code == 404, response.text
            assert after == before
        else:
            assert response.status_code == 200, response.text
            assert after['meta']['source'] == 'template'
            assert after['meta']['revision'] == after['contentRevision'] == 2
            assert after['meta']['nodeCount'] == 1
            assert after['graph']['nodes'][0]['title'] == '个人新增卡片'
            assert after['graph']['nodes'][0]['id'] == response.json()['idMap']['pasted-node']
