from fastapi.testclient import TestClient

def test_converter_rejects_wrong_format_and_non_office_bytes():
    from app.worker.document_converter import app
    with TestClient(app) as client:
        assert client.post('/convert?target=exe',content=b'x').status_code==422
        assert client.post('/convert?target=docx',content=b'not ole').status_code==422

def test_converter_health_no_host_environment():
    from app.worker.document_converter import app
    with TestClient(app) as client:
        data=client.get('/health').json()
        assert set(data)=={'status'}
