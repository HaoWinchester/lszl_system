"""Repeated short sessions prioritize actual unanswered questions across clients."""
import asyncio
from types import SimpleNamespace
import pytest
from fastapi.testclient import TestClient
from app.main import app
from app.services.question_group_service import select_grouped
from test_practice_sessions import _practice_fixture_ids, _seed_released_pmp_paper, _cleanup_released_pmp_paper, PASSWORD

@pytest.fixture
def paper():
    ids=_practice_fixture_ids()
    asyncio.run(_seed_released_pmp_paper(ids,domains=['people']*23))
    yield ids
    asyncio.run(_cleanup_released_pmp_paper(ids))

def login(ids,key='student'):
    c=TestClient(app)
    assert c.post('/api/v1/auth/login',json={'username':ids[key],'password':PASSWORD}).status_code==200
    return c

def start(c,ids,**changes):
    r=c.post('/api/v1/learning/practice/sessions/start',json=dict(paperId=ids['paper'],releaseId=ids['release'],mode='practice',count=10,order='paper')|changes)
    assert r.status_code==200,r.text
    return r.json()['session']

def qids(s):return [q['questionId'] for q in s['questions']]

def finish(c,s,answers=None):
    if answers is None:answers={qid:{'selectedAnswer':'A','selectionIndex':i+1} for i,qid in enumerate(qids(s))}
    r=c.post(f"/api/v1/learning/practice/sessions/{s['id']}/complete",json={'revision':s['revision'],'answers':answers})
    assert r.status_code==200,r.text
    return r.json()['session']

@pytest.mark.parametrize('order',['paper','random'])
def test_two_batches_then_three_new_plus_seven_review(paper,order):
    c=login(paper);first=start(c,paper,order=order);finish(c,first)
    second=start(c,paper,order=order)
    assert set(qids(first)).isdisjoint(qids(second))
    finish(c,second);seen=set(qids(first)+qids(second))
    third=start(c,paper,order=order)
    assert len(qids(third))==10 and len(set(qids(third))-seen)==3
    summary=third['selectionSummary']
    assert summary['unseenCount']==3 and summary['reviewCount']==7 and summary['completedCount']==20
    assert all(qid not in seen for qid in qids(third)[:3])
    finish(c,third);review=start(c,paper,order=order)
    assert review['selectionSummary']['unseenCount']==0 and review['selectionSummary']['reviewCount']==10
    other=start(login(paper,'other_student'),paper)
    assert other['selectionSummary']['completedCount']==0 and other['selectionSummary']['unseenCount']==10


def test_skip_timeout_and_resume(paper):
    c=login(paper);first=start(c,paper,mode='scholar');a,b,*_=qids(first)
    finish(c,first,{a:{'selectedAnswer':'B','selectionIndex':1},b:{'selectedAnswer':'__timeout__','timedOut':True,'selectionIndex':2}})
    second=start(c,paper,mode='challenge')
    assert a not in qids(second) and b in qids(second)
    assert second['selectionSummary']['completedCount']==1
    resumed=c.post('/api/v1/learning/practice/sessions/enter',json=dict(paperId=paper['paper'],releaseId=paper['release'],mode='challenge',count=20,order='random')).json()
    assert resumed['resumed'] and [q['questionId'] for q in resumed['questions']]==qids(second)
    assert resumed['session']['selectionSummary']==second['selectionSummary']


def test_abandoned_graded_answers_count_but_unsubmitted_questions_do_not(paper):
    c=login(paper);first=start(c,paper);a=qids(first)[0]
    r=c.post(f"/api/v1/learning/practice/sessions/{first['id']}/answers",json={'revision':first['revision'],'questionId':a,'selectedAnswer':'A'})
    assert r.status_code==200,r.text
    s=r.json()['session']
    r=c.post(f"/api/v1/learning/practice/sessions/{s['id']}/abandon",json={'revision':s['revision']})
    assert r.status_code==200,r.text
    next_session=start(c,paper)
    assert a not in qids(next_session) and qids(first)[1] in qids(next_session)
    assert next_session['selectionSummary']['completedCount']==1


def test_grouped_selection_maximizes_unseen_without_splitting_cases():
    def row(i,group=None):return SimpleNamespace(question_id=str(i),order_index=i,snapshot={'caseGroup':group} if group else {})
    rows=[row(0),row(1,{'id':'c','order':1,'total':2}),row(2,{'id':'c','order':2,'total':2}),row(3)]
    selected,counts=select_grouped(rows,2,unseen_ids={'1','2','3'})
    assert [r.question_id for r in selected]==['1','2']
    selected,_=select_grouped(rows,3,unseen_ids={'2','3'})
    assert [r.question_id for r in selected]==['1','2','3'] and 4 in counts


def test_too_small_batch_for_unseen_case_does_not_silently_return_only_review():
    rows=[SimpleNamespace(question_id=str(i),order_index=i,snapshot={'caseGroup':{'id':'large','order':i+1,'total':3}} if i<3 else {}) for i in range(5)]
    selected,counts=select_grouped(rows,2,unseen_ids={'0','1','2'})
    assert selected==[]
    assert counts==[3,4,5]


def test_coverage_answer_shapes_history_hidden_and_release_scope(paper):
    from app.db.session import AsyncSessionLocal
    from app.models.training import PracticeSession
    from app.services.practice_coverage_service import answered_question_ids
    c=login(paper);session=start(c,paper);ids=qids(session)
    async def verify():
        async with AsyncSessionLocal() as db:
            row=await db.get(PracticeSession,session['id'])
            row.answers={ids[0]:{'selectedAnswerIds':['A','C']},ids[1]:{'selectedPairs':{'left':'right'}},ids[2]:{'selectedAnswer':'B'},ids[3]:{'selectedAnswer':'A','draft':True},ids[4]:{'selectedAnswer':'__timeout__','timedOut':True},ids[5]:{'selectedAnswerIds':[]},ids[6]:{'selectedPairs':{}}}
            row.stats={'historyHidden':True};row.status='abandoned'
            await db.commit()
            assert await answered_question_ids(db,paper['student'],paper['release'])==set(ids[:3])
            assert await answered_question_ids(db,paper['other_student'],paper['release'])==set()
            assert await answered_question_ids(db,paper['student'],'another-release')==set()
    asyncio.run(verify())


def test_catalog_and_progress_expose_current_learner_coverage(paper):
    c = login(paper)
    def catalog_coverage(client):
        rows = client.get('/api/v1/paper-releases/catalog').json()['releases']
        return next(row for row in rows if row['releaseId'] == paper['release']).get('coverage')
    expected = {'releaseId': paper['release'], 'totalCount': 23, 'completedCount': 0, 'remainingUnseen': 23}
    assert catalog_coverage(c) == expected
    session = start(c, paper, mode="scholar")
    ids = qids(session)
    paused = c.post(f"/api/v1/learning/practice/sessions/{session['id']}/pause",
                    json={'revision': session['revision'], 'answers': {ids[0]: {'selectedAnswer': 'B', 'selectionIndex': 1}}})
    assert paused.status_code == 200, paused.text
    assert catalog_coverage(c)['completedCount'] == 1
    finish(c, paused.json()['session'], {ids[0]: {'selectedAnswer': 'B', 'selectionIndex': 1},
                        ids[1]: {'selectedAnswer': '__timeout__', 'timedOut': True, 'selectionIndex': 2}})
    expected.update(completedCount=1, remainingUnseen=22)
    assert catalog_coverage(c) == expected
    response = c.get(f"/api/v1/learning/practice/papers/{paper['paper']}/progress", params={'releaseId': paper['release']})
    assert response.status_code == 200
    assert response.json()['coverage'] == expected
    assert catalog_coverage(login(paper, 'other_student'))['completedCount'] == 0
    assert catalog_coverage(TestClient(app)) is None
    mismatch = c.get('/api/v1/learning/practice/papers/another-paper/progress', params={'releaseId': paper['release']})
    assert mismatch.json().get('coverage') is None


def test_ordinary_practice_resume_and_history_are_session_scoped(paper):
    c = login(paper)
    session = start(c, paper)
    progress_url = f"/api/v1/learning/practice/papers/{paper['paper']}/progress"
    progress = c.get(progress_url).json()['modes']
    assert progress['practice']['sessionId'] == session['id']
    history_url = '/api/v1/learning/practice/sessions'
    row = next(row for row in c.get(history_url).json()['sessions'] if row.get('sessionId') == session['id'])
    assert row['status'] == 'active' and row['total'] == 10 and not row['reportAvailable']
    assert row['releaseId'] == paper['release']
    other = login(paper, 'other_student')
    assert other.get(progress_url).json()['modes']['practice'] is None
    assert not other.get(history_url).json()['sessions']
    paused = c.post(f"{history_url}/{session['id']}/pause", json={'revision': session['revision'], 'answers': {}})
    assert paused.status_code == 200
    assert c.get(history_url).json()['sessions'][0]['status'] == 'paused'
    finish(c, paused.json()['session'])
    second = start(c, paper)
    rows = c.get(history_url).json()['sessions']
    by_id = {row['sessionId']: row for row in rows}
    assert by_id[session['id']]['reportAvailable'] is True
    assert by_id[second['id']]['reportAvailable'] is False
    assert c.get(progress_url).json()['modes']['practice']['sessionId'] == second['id']


@pytest.mark.parametrize('access_level', ['free', 'member'])
def test_admin_can_inspect_student_releases_without_changing_learner_access(paper, access_level):
    from app.db.session import AsyncSessionLocal
    from app.models.user import User
    from app.models.paper_release import PaperRelease
    async def setup():
        async with AsyncSessionLocal() as db:
            admin = await db.get(User, paper['other_student'])
            admin.role = 'admin'
            release = await db.get(PaperRelease, paper['release'])
            release.allowed_roles = ['student']
            release.access_level = access_level
            await db.commit()
    asyncio.run(setup())
    c = login(paper, 'other_student')
    catalog = c.get('/api/v1/paper-releases/catalog').json()['releases']
    row = next((row for row in catalog if row['releaseId'] == paper['release']), None)
    assert row is not None and not row.get('contentRestricted', False)
    assert c.get(f"/api/v1/paper-releases/{paper['release']}").status_code == 200
    assert c.get(f"/api/v1/paper-releases/{paper['release']}/questions").status_code == 200
    assert start(c, paper)['mode'] == 'practice'
    student = login(paper)
    response = student.get(f"/api/v1/paper-releases/{paper['release']}/questions")
    assert response.status_code == (200 if access_level == 'free' else 404)
    teacher = login(paper, 'teacher')
    assert teacher.get(f"/api/v1/paper-releases/{paper['release']}/questions").status_code == 404
    async def withdraw():
        async with AsyncSessionLocal() as db:
            release = await db.get(PaperRelease, paper['release'])
            release.status = 'withdrawn'
            await db.commit()
    asyncio.run(withdraw())
    assert all(row['releaseId'] != paper['release'] for row in c.get('/api/v1/paper-releases/catalog').json()['releases'])
    assert c.get(f"/api/v1/paper-releases/{paper['release']}/questions").status_code == 404
