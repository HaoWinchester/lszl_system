from concurrent.futures import ThreadPoolExecutor
from datetime import datetime, timezone
import pytest
from operator_app.store import Store, due_slot

@pytest.fixture
def db(tmp_path):
    return Store(tmp_path)

def draft(db):
    return db.create_draft({'title':'价值交付','body':'讲解','cards':[]}, 'value')

def ready(db):
    d=draft(db)
    db.review(d['id'], d['version'], {'passed':True}, ['abc'])
    db.enqueue(d['id'], '2026-11-02T01:00:00+00:00')
    return d

def test_pause_persists_and_claim_is_exclusive(db):
    d=ready(db)
    assert db.claim('one', '2026-11-02T01:00:01+00:00') is None
    db.set_enabled(True)
    with ThreadPoolExecutor(2) as pool:
        rows=list(pool.map(lambda w:db.claim(w,'2026-11-02T01:00:01+00:00'),['one','two']))
    assert sum(x is not None for x in rows)==1
    db.set_enabled(False)
    assert Store(db.root).settings()['enabled'] is False

def test_edits_invalidate_review_and_queued_copy(db):
    d=ready(db)
    db.edit(d['id'], {'title':'新标题','body':'新内容','cards':[]})
    row=db.get_draft(d['id'])
    assert row['version']==2 and row['status']=='draft' and row['review'] is None
    assert db.jobs()[0]['status']=='canceled'

def test_duplicate_queue_and_stale_review_rejected(db):
    d=ready(db)
    with pytest.raises(ValueError): db.enqueue(d['id'],'2026-11-02T12:00:00+00:00')
    db.edit(d['id'],{'title':'变更','body':'','cards':[]})
    with pytest.raises(ValueError): db.review(d['id'],1,{'passed':True},[])

def test_pause_before_send_prevents_marker(db):
    ready(db);db.set_enabled(True)
    job=db.claim('one','2026-11-02T01:00:01+00:00')
    db.set_enabled(False)
    assert not db.begin_send(job['id'],'one')

def test_crash_after_marker_becomes_unknown_never_reclaimed(db):
    ready(db);db.set_enabled(True)
    job=db.claim('one','2026-11-02T01:00:01+00:00')
    assert db.begin_send(job['id'],'one')
    db.recover('2099-01-01T00:00:00+00:00')
    assert db.jobs()[0]['status']=='unknown'
    assert db.claim('two','2099-01-01T00:00:00+00:00') is None

def test_schedule_no_catchup_and_timezone():
    assert due_slot(datetime(2026,11,2,1,1,tzinfo=timezone.utc), ['09:00','20:00'])=='2026-11-02T01:00:00+00:00'
    assert due_slot(datetime(2026,11,2,1,15,tzinfo=timezone.utc), ['09:00','20:00']) is None
    assert due_slot(datetime(2026,11,2,12,0,tzinfo=timezone.utc), ['09:00','20:00'])=='2026-11-02T12:00:00+00:00'

def test_canceled_queue_can_reschedule_without_duplicate(db):
    d=ready(db)
    db.finish(db.jobs()[0]['id'],'canceled',reason='用户取消')
    db.enqueue(d['id'],'2026-11-03T01:00:00+00:00')
    assert len(db.jobs())==1 and db.jobs()[0]['status']=='queued'

def test_claim_specific_draft_does_not_take_other_due_job(db):
    first=ready(db)
    second=db.create_draft({'title':'另一个知识点'},'tailoring')
    db.review(second['id'],1,{'passed':True},[])
    db.enqueue(second['id'],'2026-11-02T01:01:00+00:00')
    db.set_enabled(True)
    job=db.claim('one','2026-11-02T01:02:00+00:00',draft_id=second['id'])
    assert job['draft_id']==second['id']
    assert next(j for j in db.jobs() if j['draft_id']==first['id'])['status']=='queued'
