"""Exercise real start/pause/complete flows, including feedback disabled."""
import asyncio
from datetime import datetime, timedelta, timezone
import pytest

from app.db.session import AsyncSessionLocal
from app.models.training import PracticeSession
from app.services import practice_session_service
from test_practice_sessions import practice_ids, client, active_session  # noqa: F401


def raw_answers(session_id):
    async def read():
        async with AsyncSessionLocal() as db:
            session=await db.get(PracticeSession,session_id)
            return session.answers
    return asyncio.run(read())


def test_saved_valid_answer_lights_topic_with_first_server_acceptance_time(client,active_session,monkeypatch):
    sid=active_session['id'];qid=active_session['questions'][0]['questionId'];base=f'/api/v1/learning/practice/sessions/{sid}'
    first=datetime.now(timezone.utc)-timedelta(days=15)
    monkeypatch.setattr(practice_session_service,'now_utc',lambda:first)
    assert client.get('/api/v1/learning/practice/knowledge-dashboard').json()['attemptCount']==0
    chosen={qid:{'selectedAnswer':'B','selectionIndex':1,'correct':True,'acceptedAt':'2099-01-01T00:00:00Z','submittedAt':'2099-01-01T00:00:00Z'}}
    saved=client.post(base+'/pause',json={'revision':active_session['revision'],'answers':chosen,'runtimeState':{'instantFeedback':False}})
    assert saved.status_code==200,saved.text
    session=saved.json()['session'];persisted=raw_answers(sid)
    assert persisted[qid]['acceptedAt']==first.isoformat()
    assert 'correct' not in persisted[qid]
    assert session['answers'][qid]=={'selectedAnswer':'B','selectionIndex':1}
    dashboard=client.get('/api/v1/learning/practice/knowledge-dashboard').json()
    assert dashboard['attemptCount']==1
    assert dashboard['nodes'][0]['lastPracticedAt']==first.isoformat()
    assert dashboard['nodes'][0]['brightness']==pytest.approx(.6,abs=.001)
    assert 'correct' not in str(dashboard) and 'selectedAnswer' not in str(dashboard)
    monkeypatch.setattr(practice_session_service,'now_utc',lambda:first+timedelta(days=10))
    replay=client.post(base+'/pause',json={'revision':session['revision'],'answers':chosen})
    assert replay.status_code==200,replay.text
    assert raw_answers(sid)[qid]['acceptedAt']==first.isoformat()
    rejected=client.post(base+'/pause',json={'revision':session['revision'],'answers':{qid:{'selectedAnswer':'A','selectionIndex':1}}})
    assert rejected.status_code==409
    assert raw_answers(sid)[qid]['acceptedAt']==first.isoformat()
    completed=client.post(base+'/complete',json={'revision':session['revision'],'answers':chosen})
    assert completed.status_code==200,completed.text
    assert raw_answers(sid)[qid]['acceptedAt']==first.isoformat()
    final=client.get('/api/v1/learning/practice/knowledge-dashboard').json()
    assert final['attemptCount']==1 and final['nodes'][0]['lastPracticedAt']==first.isoformat()


def test_open_runtime_invalid_values_and_timeouts_do_not_light_topics(client,practice_ids):
    started=client.post('/api/v1/learning/practice/sessions/start',json={'paperId':practice_ids['paper'],'releaseId':practice_ids['release'],'mode':'scholar','count':10,'order':'paper'}).json()['session']
    sid=started['id'];first,second=[row['questionId'] for row in started['questions'][:2]];base=f'/api/v1/learning/practice/sessions/{sid}'
    draft=client.patch(base+'/state',json={'revision':started['revision'],'runtimeState':{'currentIndex':1}})
    assert draft.status_code==200,draft.text
    session=draft.json()['session']
    assert client.get('/api/v1/learning/practice/knowledge-dashboard').json()['attemptCount']==0
    invalid=client.post(base+'/pause',json={'revision':session['revision'],'answers':{first:{'selectedAnswer':'FORGED','selectionIndex':1}}})
    assert invalid.status_code==422
    saved=client.post(base+'/pause',json={'revision':session['revision'],'answers':{first:{'selectedAnswer':'__timeout__','selectionIndex':1,'timedOut':True},second:{'selectedAnswer':'A','selectionIndex':2}}})
    assert saved.status_code==200,saved.text
    persisted=raw_answers(sid)
    assert 'acceptedAt' not in persisted[first]
    assert persisted[second]['acceptedAt']
    assert client.get('/api/v1/learning/practice/knowledge-dashboard').json()['attemptCount']==1
