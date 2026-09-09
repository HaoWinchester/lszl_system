import pytest
from mixed_question_support import mixed_data_cleanup
pytestmark = pytest.mark.usefixtures("mixed_data_cleanup")
import asyncio
from fastapi.testclient import TestClient
from app.main import app
from mixed_question_support import seed_users, login, questions, publish
PATH = '/api/v1/learning/practice/sessions'
def test_matching_partial_resume_submit_report_and_mistake():
    ids = asyncio.run(seed_users())
    qs = questions(ids)
    release_id = asyncio.run(publish(ids, qs))
    with TestClient(app) as client:
        login(client, ids['student'])
        response = client.post(PATH+'/start', json={'paperId':ids['paper'], 'releaseId':release_id, 'mode':'challenge', 'count':7})
        assert response.status_code == 200, response.text
        session = response.json()['session']; sid = session['id']; qid = qs[2]['id']
        response = client.patch(PATH+'/'+sid+'/state', json={'revision':session['revision'], 'runtimeState':{'pendingMatches':{qid:{'l1':'r2'}}}})
        assert response.status_code == 200, response.text
        session = response.json()['session']
        assert client.get(PATH+'/'+sid).json()['session']['runtimeState']['pendingMatches'][qid] == {'l1':'r2'}
        bad = client.patch(PATH+'/'+sid+'/state', json={'revision':session['revision'],'runtimeState':{'pendingMatches':{qid:{'l1':'r1','l2':'r1'}}}})
        assert bad.status_code == 422
        selected = {qs[0]['id']:{'selectedAnswer':'A','selectionIndex':1}, qs[1]['id']:{'selectedAnswerIds':['A','C'],'selectionIndex':2}, qid:{'selectedPairs':{'l1':'r1','l2':'r2'},'selectionIndex':3,'correct':True}}
        for i in range(3,7): selected[qs[i]['id']] = {'selectedAnswer':'A','selectionIndex':i+1}
        response = client.post(PATH+'/'+sid+'/complete', json={'revision':session['revision'],'answers':selected})
        assert response.status_code == 200, response.text
        completed = response.json()
        assert completed['session']['stats']['correct'] == 6
        assert completed['session']['answers'][qid]['selectedPairs'] == {'l1':'r1','l2':'r2'}
        assert completed['session']['answers'][qid]['correct'] is False
        report = client.get(PATH+'/'+sid+'/report')
        assert report.status_code == 200
        assert 'selectedPairs' in report.text
        mistakes = client.get('/api/v1/learning/practice/overview')
        assert mistakes.status_code == 200, mistakes.text
        assert 'selectedPairs' in mistakes.text and 'matching' in mistakes.text


def test_matching_submission_lock_revision_timeout_and_revenge():
    ids = asyncio.run(seed_users()); qs = questions(ids); release_id = asyncio.run(publish(ids, qs))
    with TestClient(app) as client:
        login(client, ids['student'])
        session = client.post(PATH+'/start', json={'paperId':ids['paper'],'releaseId':release_id,'mode':'scholar','count':7}).json()['session']
        sid = session['id']; qid = qs[2]['id']
        for invalid in ({'l1':'r1'}, {'foreign':'r1','l2':'r2'}, {'l1':'r1','l2':'r1'}):
            response = client.post(PATH+'/'+sid+'/answers', json={'revision':session['revision'],'questionId':qid,'selectedPairs':invalid})
            assert response.status_code == 422, response.text
        response = client.patch(PATH+'/'+sid+'/state', json={'revision':session['revision'],'answers':{qid:{'selectedPairs':{'l1':'r2','l2':'r1'},'selectionIndex':1}}})
        assert response.status_code == 200, response.text
        saved = response.json()['session']
        assert saved['answers'][qid]['selectedPairs'] == {'l1':'r2','l2':'r1'}
        conflict = client.patch(PATH+'/'+sid+'/state', json={'revision':session['revision'],'runtimeState':{'currentIndex':1}})
        assert conflict.status_code == 409
        locked = client.patch(PATH+'/'+sid+'/state', json={'revision':saved['revision'],'answers':{qid:{'selectedPairs':{'l1':'r1','l2':'r2'},'selectionIndex':1}}})
        assert locked.status_code == 409
        response = client.post(PATH+'/'+sid+'/complete', json={'revision':saved['revision'],'answers':{qid:{'selectedPairs':{'l1':'r2','l2':'r1'},'selectionIndex':1}}})
        assert response.status_code == 200, response.text
        assert response.json()['session']['answers'][qid]['correct'] is True
        session = client.post(PATH+'/start', json={'paperId':ids['paper'],'releaseId':release_id,'mode':'scholar','count':7}).json()['session']
        response = client.post(PATH+'/'+session['id']+'/answers', json={'revision':session['revision'],'questionId':qid,'selectedPairs':{},'timedOut':True})
        assert response.status_code == 200, response.text
        answer = response.json()['answer']
        assert answer['selectedPairs'] == {} and answer['correct'] is False and answer['timedOut'] is True
        revenge = client.post(PATH+'/start', json={'mode':'revenge','count':1})
        assert revenge.status_code == 200, revenge.text
        session = revenge.json()['session']
        assert session['questions'][0]['question']['type'] == 'matching'
        response = client.post(PATH+'/'+session['id']+'/complete', json={'revision':session['revision'],'answers':{qid:{'selectedPairs':{'l1':'r2','l2':'r1'},'selectionIndex':1}}})
        assert response.status_code == 200, response.text
        assert response.json()['session']['answers'][qid]['correct'] is True
