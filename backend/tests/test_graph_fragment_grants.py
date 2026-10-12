"""Trusted cross-file fragment paste: binding inheritance without forged grants."""
import asyncio
from uuid import uuid4
import pytest
from fastapi import HTTPException
from fastapi.testclient import TestClient
from sqlalchemy import select, func
from app.main import app
from app.db.session import AsyncSessionLocal
from app.models.file import GraphFile, FileContent
from app.models.graph_asset import GraphAsset
from app.models.graph_question import GraphQuestionBinding
from app.services import graph_fragment_service as service
from test_graph_question_access import data as source_fixture, login, create_card, bind, PASSWORD
from test_graph_assets import upload_payload, png


def bpath(file, node):
    return f'/api/v1/graph-questions/files/{file}/nodes/{node}/bindings'


@pytest.fixture
def data():
    return source_fixture.__wrapped__()


def fragment(nodes, links=(), source=None, elements=(), tables=(), resources=()):
    return {'format': 'kg-graph-fragment', 'version': 1,
            'nodes': list(nodes), 'links': list(links), 'elements': list(elements),
            'tables': list(tables), 'resources': list(resources), 'source': source or {'fileId': None, 'nodeIds': [], 'revision': None}}


def paste(c, file_id, body):
    return c.post(f'/api/v1/files/{file_id}/fragments', json=body)


def bind_payload(question_ids):
    return {'expectedFileRevision': 1, 'questionIds': question_ids}


def test_paste_inherits_bindings_and_ignores_client_question_fields(data):
    with TestClient(app) as c:
        login(c, data, 'teacher')
        source = create_card(c)
        bind(c, source, [data.q, data.both])
        image = c.post('/api/v1/graph-assets', json=upload_payload()).json()['asset']
        source_revision = c.get('/api/v1/files/' + source).json()['meta']['revision']
        body = fragment(
            [{'id': 'n', 'title': 'card', 'x': 0, 'y': 0, 'content': {'title': 'card', 'notes': 'keep'}, 'images': [{'assetId': image['assetId']}], 'questionIds': [data.unused], 'bindings': [{'questionId': data.unused}]}],
            [{'id': 'l', 'from': 'n', 'to': '', 'toPoint': {'x': 1, 'y': 2}}],
            source={'fileId': source, 'nodeIds': ['n'], 'revision': source_revision},
            resources=[{'id': 'r', 'assetId': image['assetId']}])
        target = c.post('/api/v1/files', json={'name': 'target', 'graphData': {'nodes': [], 'links': []}}).json()['file']['id']
        r = paste(c, target, {'fragment': body, 'offset': {'x': 30, 'y': 40}, 'expectedFileRevision': 1})
        assert r.status_code == 200, r.text
        result = r.json()
        nid = result['idMap']['n']
        assert nid != 'n' and result['fileRevision'] == 2
        copy = c.get('/api/v1/files/' + target).json()['graphData']
        assert copy['nodes'][0]['id'] == nid and copy['nodes'][0]['x'] == 30
        # tables/resources 不在合并范围（T18 前编辑器 state 不支持，合并会被 autosave 覆盖）。
        assert 'resources' not in copy and 'tables' not in copy
        # Client-attached question authority never survives the paste.
        assert all(k not in copy['nodes'][0] for k in ('questionIds', 'bindings'))
        assert copy['links'][0]['from'] == nid and copy['links'][0]['toPoint'] == {'x': 31, 'y': 42}
        # Inherited grants equal the server-read source bindings, freshly versioned.
        bindings = c.get(bpath(target, nid)).json()['bindings']
        assert {b['question']['id'] for b in bindings} == {data.q, data.both}
        assert all(b['sourceVersion'] for b in bindings)
        attempt = c.post(bpath(target, nid) + '/' + bindings[0]['id'] + '/attempts',
                         json={'sourceVersion': bindings[0]['sourceVersion'], 'requestId': uuid4().hex, 'selectedOptionIds': ['A']})
        assert attempt.status_code == 200, attempt.text
        # Source file stays untouched; repeated paste creates independent identities.
        assert c.get('/api/v1/files/' + source).json()['graphData']['nodes'][0]['id'] == 'n'
        r2 = paste(c, target, {'fragment': body, 'offset': {'x': 0, 'y': 0}})
        assert r2.status_code == 200 and r2.json()['idMap']['n'] not in (nid, 'n')


def test_paste_rejects_stale_source_and_foreign_files_without_partial_writes(data):
    with TestClient(app) as c:
        login(c, data, 'teacher')
        source = create_card(c)
        bind(c, source, [data.q])
        target = c.post('/api/v1/files', json={'name': 'target', 'graphData': {'nodes': [], 'links': []}}).json()['file']['id']
        body = fragment([{'id': 'n', 'title': 'x'}], source={'fileId': source, 'nodeIds': ['n'], 'revision': 1})
        source_revision = c.get('/api/v1/files/' + source).json()['meta']['revision']
        c.put('/api/v1/files/' + source, json={'graphData': {'nodes': [{'id': 'n', 'content': {'title': 'changed'}}], 'links': []}, 'expectedRevision': source_revision})
        target_revision = c.get('/api/v1/files/' + target).json()['meta']['revision']
        r = paste(c, target, {'fragment': body, 'expectedFileRevision': target_revision})
        assert r.status_code == 409 and r.json()['detail']['code'] == 'GRAPH_FRAGMENT_SOURCE_STALE'
        # No half-pasted nodes: target revision and content unchanged.
        after = c.get('/api/v1/files/' + target).json()
        assert after['meta']['revision'] == target_revision and after['graphData']['nodes'] == []
        # Foreign source and foreign target are both invisible.
        login(c, data, 'student')
        own = create_card(c)
        foreign = fragment([{'id': 'n', 'title': 'x'}], source={'fileId': source, 'nodeIds': ['n'], 'revision': 2})
        assert paste(c, own, {'fragment': foreign}).status_code == 404
        assert paste(c, source, {'fragment': fragment([{'id': 'n', 'title': 'x'}])}).status_code == 404
        assert paste(c, own, {'fragment': fragment([{'id': 'n', 'title': 'x'}], source={'fileId': own, 'nodeIds': ['n'], 'revision': 99})}).status_code == 409
        # Revision conflict on the target and malformed fragments are 409/422, no writes.
        assert paste(c, own, {'fragment': fragment([{'id': 'n', 'title': 'x'}]), 'expectedFileRevision': 7}).status_code == 409
        bad = fragment([{'id': 'n', 'title': 'x'}], [{'id': 'l', 'from': 'n', 'to': 'missing'}])
        assert paste(c, own, {'fragment': bad}).status_code == 422
        elements_only = fragment([], elements=[{'id': 'e', 'text': '文字', 'x': 1, 'y': 2}])
        r = paste(c, own, {'fragment': elements_only})
        assert r.status_code == 200 and r.json()['idMap']['e']
        assert c.get('/api/v1/files/' + own).json()['graphData']['elements'][-1]['text'] == '文字'
        forged = fragment([{'id': 'n', 'title': 'x', 'questionIds': [data.q]}])
        r = paste(c, own, {'fragment': forged})
        assert r.status_code == 200
        copy = c.get('/api/v1/files/' + own).json()['graphData']
        assert 'questionIds' not in copy['nodes'][0]
        assert c.get(bpath(own, r.json()['idMap']['n'])).json()['bindings'] == []


def test_paste_atomic_rollback_and_revoked_grants_stay_revoked(data, monkeypatch):
    with TestClient(app) as c:
        login(c, data, 'teacher')
        source = create_card(c)
        bind(c, source, [data.q])
        binding = c.get(bpath(source, 'n')).json()['bindings'][0]
        target = c.post('/api/v1/files', json={'name': 'target', 'graphData': {'nodes': [], 'links': []}}).json()['file']['id']
        source_revision = c.get('/api/v1/files/' + source).json()['meta']['revision']
        body = fragment([{'id': 'n', 'title': 'card'}], source={'fileId': source, 'nodeIds': ['n'], 'revision': source_revision})
        async def counts():
            async with AsyncSessionLocal() as db:
                return tuple([await db.scalar(select(func.count()).select_from(model)) for model in (GraphFile, GraphAsset, GraphQuestionBinding)])
        before = asyncio.run(counts())
        original = service.questions.clone_card_bindings
        async def fail_at_bindings(*args, **kwargs):
            await original(*args, **kwargs)
            raise HTTPException(409, 'forced binding failure')
        monkeypatch.setattr(service.questions, 'clone_card_bindings', fail_at_bindings)
        assert paste(c, target, {'fragment': body}).status_code == 409
        assert asyncio.run(counts()) == before  # No nodes, assets or bindings survive.
        monkeypatch.undo()
        ok = paste(c, target, {'fragment': body}).json()
        nid = ok['idMap']['n']
        target_binding = c.get(bpath(target, nid)).json()['bindings'][0]
        # Explicit revoke on the copied card blocks practice; undo/redo of graph content
        # cannot resurrect it because only server-controlled clones create grants.
        assert c.post(bpath(target, nid) + '/' + target_binding['id'] + '/revoke',
                      json={'expectedFileRevision': ok['fileRevision'], 'sourceVersion': target_binding['sourceVersion']}).status_code == 200
        assert c.post(bpath(target, nid) + '/' + target_binding['id'] + '/attempts',
                      json={'sourceVersion': target_binding['sourceVersion'], 'requestId': uuid4().hex, 'selectedOptionIds': ['A']}).status_code == 404
        # Source binding untouched: revoking the copy does not revoke the origin.
        assert c.get(bpath(source, 'n')).json()['bindings'][0]['status'] == 'active'
        # Repeated same-target pastes stay independent (writes serialize on the advisory lock).
        for _ in range(3):
            assert paste(c, target, {'fragment': body}).status_code == 200


def test_template_to_copy_to_member_paper_boundary(data):
    """Brief AC: free template with member question -> nonmember practice -> paid release still closed."""
    from test_graph_templates import publication, publish, load
    with TestClient(app) as c:
        login(c, data, 'teacher')
        source = create_card(c)
        bind(c, source, [data.q])  # q: internal member-release question.
        template = publish(c, publication(source, 2))
        login(c, data, 'student')
        loaded = load(c, template).json()
        nid = loaded['idMap']['n']
        binding = c.get(bpath(loaded['fileId'], nid)).json()['bindings'][0]
        attempt = c.post(bpath(loaded['fileId'], nid) + '/' + binding['id'] + '/attempts',
                         json={'sourceVersion': binding['sourceVersion'], 'requestId': uuid4().hex, 'selectedOptionIds': ['A']})
        assert attempt.status_code == 200, attempt.text
        analysis = c.get('/api/v1/graph-questions/attempts/' + attempt.json()['attempt']['id'] + '/analysis')
        assert analysis.status_code == 200 and analysis.json()['analysis'] == 'SECRET ANALYSIS'
        # The card-scoped exception does not open ordinary member releases.
        assert c.get(f"/api/v1/paper-releases/{data.release}/questions").status_code == 404
        # Student copies the granted card into a second private file: grant follows, quota holds.
        second = c.post('/api/v1/files', json={'name': 'second', 'graphData': {'nodes': [], 'links': []}}).json()['file']['id']
        loaded_revision = c.get('/api/v1/files/' + loaded['fileId']).json()['meta']['revision']
        body = fragment([{'id': nid, 'title': 'card'}], source={'fileId': loaded['fileId'], 'nodeIds': [nid], 'revision': loaded_revision})
        r = paste(c, second, {'fragment': body})
        assert r.status_code == 200, r.text
        nid2 = r.json()['idMap'][nid]
        b2 = c.get(bpath(second, nid2)).json()['bindings']
        assert len(b2) == 1 and b2[0]['question']['id'] == data.q
        assert c.get(f"/api/v1/paper-releases/{data.release}/questions").status_code == 404
