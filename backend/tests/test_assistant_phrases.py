from fastapi.testclient import TestClient
from app.main import app
from test_teacher_assistant import users, login


def test_phrases_persist_and_are_private_and_validated():
    a, b, student = users()
    url = '/api/v1/teacher-assistant/quick-phrases'
    with TestClient(app) as c:
        assert c.get(url).status_code == 401
        login(c, a)
        initial = c.get(url).json()
        assert len(initial['defaults']) >= 4
        assert initial['custom'] == []
        body = {'custom': [{'title': '我的检查', 'content': '请检查答案与解析是否一致。'}], 'username': a}
        assert c.put(url, json=body).status_code == 200
        assert c.get(url).json()['custom'] == body['custom']
        login(c, b)
        assert c.get(url).json()['custom'] == []
        assert c.put(url, json=body).status_code == 409
        login(c, a)
        assert c.get(url).json()['custom'] == body['custom']
        for custom in [[{'title':' ', 'content':'ok'}], [{'title':'ok','content':' '}], body['custom']*21]:
            assert c.put(url, json={'username':a,'custom':custom}).status_code == 422
        assert c.put(url, json={'username':a,'custom':[]}).status_code == 200
        assert c.get(url).json()['custom'] == []
        login(c, student)
        assert c.get(url).status_code == 403
        assert c.put(url,json={'username':student,'custom':[]}).status_code == 403
