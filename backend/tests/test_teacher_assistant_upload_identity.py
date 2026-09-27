"""Real DB/filesystem upload identity, dedup quotas, and atomic cleanup."""
import hashlib
from fastapi.testclient import TestClient
from app.main import app
from app.core.config import settings
from test_teacher_assistant import users, login


def make_session(client):
    return '/api/v1/teacher-assistant/sessions/' + client.post('/api/v1/teacher-assistant/sessions',json={}).json()['session']['id']


def upload(client,url,items):
    return client.post(url+'/uploads',files=[('files',(name,data,'application/json')) for name,data in items])


def test_content_identity_dedups_renames_batch_and_full_count_capacity(tmp_path,monkeypatch):
    monkeypatch.setattr(settings,'TEACHER_ASSISTANT_STORAGE',str(tmp_path))
    owner,other,_=users()
    with TestClient(app) as c:
        login(c,owner);url=make_session(c)
        initial=upload(c,url,[('a.json',b'111'),('renamed.json',b'111')])
        assert initial.status_code==200,initial.text
        first=initial.json()['session']['uploads'];assert len(first)==1
        assert first[0]['sha256']==hashlib.sha256(b'111').hexdigest()
        different=upload(c,url,[('a.json',b'222')]);assert different.status_code==200
        files=different.json()['session']['uploads'];assert len(files)==2
        assert len({item['sha256'] for item in files})==2
        filled=upload(c,url,[(f'{i}.json',str(i).encode()) for i in range(3)])
        assert filled.status_code==200;assert len(filled.json()['session']['uploads'])==5
        ids={item['id'] for item in filled.json()['session']['uploads']}
        again=upload(c,url,[('new-name.json',b'111'),('same.json',b'111'),('a.json',b'222')])
        assert again.status_code==200,again.text
        assert {item['id'] for item in again.json()['session']['uploads']}==ids
        assert again.json()['session']['revision']==filled.json()['session']['revision']
        assert len(list(tmp_path.rglob('original')))==5
        login(c,other);assert c.get(url).status_code==404


def test_unique_count_failure_rolls_back_batch_and_cleans_files(tmp_path,monkeypatch):
    monkeypatch.setattr(settings,'TEACHER_ASSISTANT_STORAGE',str(tmp_path))
    owner,_,_=users()
    with TestClient(app) as c:
        login(c,owner);url=make_session(c)
        assert upload(c,url,[(f'{i}.json',str(i).encode()) for i in range(4)]).status_code==200
        before=c.get(url).json()['session'];paths=set(tmp_path.rglob('original'))
        result=upload(c,url,[('duplicate.json',b'0'),('new.json',b'4'),('overflow.json',b'5')])
        assert result.status_code==422,result.text
        after=c.get(url).json()['session']
        assert after['uploads']==before['uploads'];assert after['revision']==before['revision']
        assert set(tmp_path.rglob('original'))==paths
        assert upload(c,url,[(f'{i}.json',b'0') for i in range(6)]).status_code==422
        assert set(tmp_path.rglob('original'))==paths


def test_byte_quotas_count_stored_unique_and_bound_incoming_batch(tmp_path,monkeypatch):
    monkeypatch.setattr(settings,'TEACHER_ASSISTANT_STORAGE',str(tmp_path))
    owner,_,_=users();mib=1024*1024
    with TestClient(app) as c:
        login(c,owner);url=make_session(c)
        a=b'a'*(20*mib);b=b'b'*(20*mib);d=b'd'*(10*mib)
        first=upload(c,url,[('a.json',a),('b.json',b),('d.json',d)])
        assert first.status_code==200,first.text
        baseline=c.get(url).json()['session'];paths=set(tmp_path.rglob('original'))
        duplicate=upload(c,url,[('renamed-a.json',a),('renamed-b.json',b),('renamed-d.json',d)])
        assert duplicate.status_code==200,duplicate.text
        assert duplicate.json()['session']['uploads']==baseline['uploads']
        overflow=upload(c,url,[('a.json',a),('b.json',b),('d.json',d),('tiny.json',b'a')])
        assert overflow.status_code==422,overflow.text
        addition=upload(c,url,[('a.json',a),('tiny.json',b'x')]);assert addition.status_code==422
        too_big=upload(c,url,[('big.json',b'x'*(20*mib+1))]);assert too_big.status_code==422
        assert c.get(url).json()['session']['uploads']==baseline['uploads']
        assert set(tmp_path.rglob('original'))==paths
