from datetime import datetime, timezone
import pytest
from operator_app.store import Store
from operator_app.worker import Worker

class Adapter:
    def __init__(self,db,fail=False,pause=False):self.db=db;self.fail=fail;self.pause=pause;self.sent=0
    async def prepare(self,d):
        if self.pause:self.db.set_enabled(False)
        return {'before_ids':[]}
    async def submit(self):
        self.sent+=1
        if self.fail:raise TimeoutError('after click')
    async def verify(self,d,b):return {'status':'published','note_id':'a'*24}

class Pipeline:
    async def ensure_ready(self,draft):return draft
    async def generate(self): raise AssertionError('should not generate')

def setup(tmp_path,**kwargs):
    db=Store(tmp_path);db.configure(enabled=True,adapter_verified=True)
    d=db.create_draft({'title':'title'},'value');db.review(d['id'],1,{'passed':True},[])
    db.enqueue(d['id'],'2026-11-02T01:00:00+00:00')
    a=Adapter(db,**kwargs);w=Worker(db,Pipeline(),a)
    return db,a,w

@pytest.mark.asyncio
async def test_timeout_is_unknown_never_retried(tmp_path):
    db,a,w=setup(tmp_path,fail=True)
    await w.process('2026-11-02T01:00:01+00:00')
    await w.process('2026-11-02T01:00:03+00:00')
    assert a.sent==1 and db.jobs()[0]['status']=='unknown'

@pytest.mark.asyncio
async def test_pause_between_prepare_and_submit(tmp_path):
    db,a,w=setup(tmp_path,pause=True)
    await w.process('2026-11-02T01:00:01+00:00')
    assert a.sent==0 and db.jobs()[0]['status']=='canceled'

@pytest.mark.asyncio
async def test_success_requires_verified_receipt(tmp_path):
    db,a,w=setup(tmp_path)
    await w.process('2026-11-02T01:00:01+00:00')
    assert db.jobs()[0]['receipt']['note_id']=='a'*24

@pytest.mark.asyncio
async def test_slow_generation_does_not_block_inbox_or_pause(tmp_path):
    import asyncio
    from operator_app.research import Research
    db=Store(tmp_path);db.configure(enabled=True,adapter_verified=True,auto_reply=True)
    release=asyncio.Event();started=asyncio.Event()
    class Slow:
        busy=False
        async def generate(self):
            self.busy=True;started.set()
            try:await release.wait();raise ValueError('budget')
            finally:self.busy=False
    class Inbox:
        def __init__(self):self.lock=asyncio.Lock();self.reads=0
        async def read_messages(self):self.reads+=1;return {'messages':[],'complete_channels':['comment','dm']}
    a=Inbox();w=Worker(db,Slow(),a)
    # Knowledge refresh is independently verified; this regression focuses on
    # a model call that would formerly stall the entire worker loop.
    async def no_refresh():pass
    w.refresh_knowledge=no_refresh
    Research(db).save([{'note_id':'a'*24,'url':'https://www.xiaohongshu.com/explore/'+'a'*24,'title':'PMP怎么刷题','likes':'3'}], 'PMP',datetime.now(timezone.utc).isoformat())
    try:
        await w.tick();await asyncio.wait_for(started.wait(),1)
        w.last_inbox=None
        await asyncio.wait_for(w.tick(),1)
        assert a.reads==2
        db.set_enabled(False)
        release.set();await w.background
        assert db.jobs()==[]
    finally:
        release.set();await w.close()

@pytest.mark.asyncio
async def test_readonly_inbox_scan_can_establish_baseline_while_paused(tmp_path):
    import asyncio
    db=Store(tmp_path)
    class Inbox:
        lock=asyncio.Lock()
        async def read_messages(self):return {'messages':[],'complete_channels':['comment','dm']}
    w=Worker(db,Pipeline(),Inbox())
    result=await w.scan_inbox()
    assert result['complete_channels']==['comment','dm']
    assert db.settings()['enabled'] is False
    with db.connect() as c:assert c.execute('SELECT COUNT(*) FROM reply_baselines').fetchone()[0]==2
