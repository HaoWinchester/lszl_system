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
