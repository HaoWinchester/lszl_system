"""Order writes are atomic owner-scoped metadata updates, independent of content."""
from fastapi.testclient import TestClient

from app.main import app
from tests.test_files_api_contract import login


def test_order_survives_login_and_preserves_unlisted_files_and_current():
    with TestClient(app) as client, TestClient(app) as other:
        login(client, "学生")
        login(other, "乔治008")
        files = [client.post('/api/v1/files', json={'name': f'order-{i}'}).json()['file'] for i in range(3)]
        ids = [file['id'] for file in files]
        client.put('/api/v1/files/current', json={'fileId': ids[0]})
        result = client.put('/api/v1/files/order', json={'fileIds': [ids[2], ids[0]]})
        assert result.status_code == 200, result.text
        assert result.json()['fileIds'][:2] == [ids[2], ids[0]]
        client.post('/api/v1/auth/logout')
        login(client, '学生')
        saved = client.get('/api/v1/files', params={'sort': 'order', 'page_size': 200}).json()['files']
        assert [row['id'] for row in saved if row['id'] in ids] == [ids[2], ids[0], ids[1]]
        assert client.get('/api/v1/files/current').json()['fileId'] == ids[0]
        for row in saved:
            assert 'graphData' not in row
            if row['id'] in ids:
                original = files[ids.index(row['id'])]
                assert row['revision'] == original['revision']
                assert row['updatedAt'] == original['updatedAt']
        foreign = other.post('/api/v1/files', json={'name': 'other-order'}).json()['file']
        denied = other.put('/api/v1/files/order', json={'fileIds': [foreign['id'], ids[0]]})
        assert denied.status_code == 404
        other_saved = other.get('/api/v1/files', params={'sort': 'order', 'page_size': 200}).json()['files']
        assert next(row for row in other_saved if row['id'] == foreign['id'])['order'] == foreign['order']
        assert client.get('/api/v1/files', params={'sort': 'order', 'page_size': 200}).json()['files'] == saved
        for invalid in ([ids[0], ids[0]], [], 'bad', [123]):
            assert client.put('/api/v1/files/order', json={'fileIds': invalid}).status_code == 422
        client.delete(f'/api/v1/files/{ids[1]}')
        assert client.put('/api/v1/files/order', json={'fileIds': [ids[0], ids[1]]}).status_code == 404
        assert client.get('/api/v1/files', params={'sort': 'order', 'page_size': 200}).json()['files'][0]['id'] == ids[2]
        other.delete(f"/api/v1/files/{foreign['id']}")
        other.delete(f"/api/v1/files/{foreign['id']}/permanent")
        for file_id in ids:
            client.delete(f'/api/v1/files/{file_id}')
            client.delete(f'/api/v1/files/{file_id}/permanent')
