"""Graph create/save/import use the same bounded strokes as recall and workspaces."""
from uuid import uuid4
from fastapi.testclient import TestClient
from app.main import app


def test_graph_ink_round_trip_rejects_malformed_strokes_without_partial_import():
    with TestClient(app) as client:
        assert client.post('/api/v1/auth/login', json={'username':'admin','password':'jbgsnmm~123'}).status_code == 200
        ink = [{'id':'ink','tool':'pen','color':'#123456','width':3,'opacity':.5,'points':[[1,2],[3,4]]}]
        created = client.post('/api/v1/files', json={'name':'ink-'+uuid4().hex,'graphData':{'nodes':[],'strokes':ink}})
        assert created.status_code == 200, created.text
        file_id = created.json()['file']['id']
        assert client.get('/api/v1/files/'+file_id).json()['graphData']['strokes'] == ink
        for patch in ({'opacity':-1},{'opacity':True},{'unknown':1}):
            invalid = [{**ink[0],**patch}]
            response = client.put('/api/v1/files/'+file_id,json={'graphData':{'strokes':invalid},'expectedRevision':1})
            assert response.status_code == 422, response.text
            assert response.json()['detail']['code'] == 'GRAPH_STROKES_INVALID'
            assert client.get('/api/v1/files/'+file_id).json()['graphData']['strokes'] == ink
            response = client.post('/api/v1/files',json={'name':'invalid','graphData':{'strokes':invalid}})
            assert response.status_code == 422, response.text
        before = client.get('/api/v1/files').json()['total']
        response = client.post('/api/v1/files/import-legacy',json={'files':[{'name':'valid-first','graphData':{'strokes':ink}},{'name':'bad-second','graphData':{'strokes':[{**ink[0],'opacity':2}]}}]})
        assert response.status_code == 422, response.text
        assert client.get('/api/v1/files').json()['total'] == before
        old = client.put('/api/v1/files/'+file_id,json={'graphData':{'nodes':[]},'expectedRevision':1})
        assert old.status_code == 200, old.text
        assert 'strokes' not in client.get('/api/v1/files/'+file_id).json()['graphData']
