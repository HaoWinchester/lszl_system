from copy import deepcopy
import pytest
from operator_app.content import validate_content, Model, Pipeline
from operator_app.sources import SOURCES, TOPICS
from operator_app.store import Store

def sample():
    t=TOPICS[0]
    return {'title':'第八版先看什么','body':'先认识绩效域，再用题目检查理解。', 'cards':[{'title':'认识绩效域','text':'第八版包含七个绩效域。','source_ids':['pmi-pmbok8']} for _ in range(4)],'question':t['question']}

def test_missing_source_is_rejected():
    c=sample();c['cards'][0]['source_ids']=['invented']
    assert any('来源' in x for x in validate_content(c,TOPICS[0],SOURCES))

def test_answer_conflict_and_url_and_claims_are_rejected():
    c=sample();c['question']=deepcopy(c['question']);c['question']['answer']='Z'
    c['body']='100%包过 https://example.com'
    errors=validate_content(c,TOPICS[0],SOURCES)
    assert any('题目' in x for x in errors)
    assert any('网址' in x for x in errors)
    assert any('承诺' in x for x in errors)

def test_content_size_and_good_content():
    assert validate_content(sample(),TOPICS[0],SOURCES)==[]
    c=sample();c['cards'][0]['text']='长文'*400
    assert any('过长' in x for x in validate_content(c,TOPICS[0],SOURCES))

def test_model_config_does_not_leak_key(tmp_path):
    p=tmp_path/'claude.json';p.write_text('{"env":{"ANTHROPIC_AUTH_TOKEN":"secret","ANTHROPIC_BASE_URL":"https://open.bigmodel.cn/api/anthropic","ANTHROPIC_MODEL":"gLm-5.3-flash[1m]"}}')
    m=Model(Store(tmp_path/'db'),p)
    assert m.info()['model']=='glm-5.3-flash'
    assert 'secret' not in str(m.info())

def test_untrusted_model_host_rejected(tmp_path):
    p=tmp_path/'claude.json';p.write_text('{"env":{"ANTHROPIC_AUTH_TOKEN":"secret","ANTHROPIC_BASE_URL":"http://evil.invalid","ANTHROPIC_MODEL":"glm"}}')
    with pytest.raises(ValueError): Model(Store(tmp_path/'db'),p)

@pytest.mark.asyncio
async def test_review_serializes_and_binds_evidence(tmp_path, monkeypatch):
    import asyncio
    from operator_app import content
    from operator_app.store import digest
    started=asyncio.Event(); release=asyncio.Event()
    async def verified(root,source_ids=None): return {}
    async def rendered(*args): return []
    class Reviewer:
        def info(self): return {'model':'test'}
        async def json(self,*args):
            started.set(); await release.wait()
            return {'passed':True,'issues':[], 'claims':[{'claim':'七个绩效域','source_id':'pmi-pmbok8','supported':True}]}
    monkeypatch.setattr(content,'verify_sources',verified)
    monkeypatch.setattr(content,'render',rendered)
    db=Store(tmp_path); p=Pipeline(db); d=db.create_draft(sample(),TOPICS[0]['id'])
    task=asyncio.create_task(p.audit(d,Reviewer()))
    await started.wait()
    try:
        assert p.busy
        with pytest.raises(ValueError): await p.audit(d,Reviewer())
        with pytest.raises(ValueError): await p.generate()
    finally:
        release.set(); result=await task
    assert result['review']['source_hash']==digest([SOURCES[0]])
    assert result['review']['product_hash']==digest({k:db.settings()[k] for k in ('product_name','product_fact','product_url')})
    assert not p.busy

@pytest.mark.asyncio
async def test_malformed_review_fails_closed(tmp_path,monkeypatch):
    from operator_app import content
    async def verified(root,source_ids=None):return {}
    class Reviewer:
        def info(self):return {'model':'test'}
        async def json(self,*args):return ['not an audit object']
    monkeypatch.setattr(content,'verify_sources',verified)
    db=Store(tmp_path);d=db.create_draft(sample(),TOPICS[0]['id'])
    result=await Pipeline(db).audit(d,Reviewer())
    assert result['status']=='needs-revision'
    assert result['assets']==[]

@pytest.mark.asyncio
async def test_old_review_is_refreshed_before_automatic_publish(tmp_path,monkeypatch):
    from operator_app.research import Research
    from datetime import datetime, timezone
    db=Store(tmp_path);d=db.create_draft(sample(),TOPICS[0]['id'])
    db.review(d['id'],1,{'passed':True},[])
    Research(db).save([{'note_id':'a'*24,'title':'PMP怎么刷题','url':'https://www.xiaohongshu.com/explore/'+'a'*24}], 'PMP',datetime.now(timezone.utc).isoformat())
    p=Pipeline(db)
    async def reject(draft):
        db.review(draft['id'],draft['version'],{'passed':False,'issues':['来源更新后不再支持该表述']},[])
        return db.get_draft(draft['id'])
    monkeypatch.setattr(p,'audit',reject)
    with pytest.raises(ValueError,match='审核'):
        await p.ensure_ready(db.get_draft(d['id']))
    assert db.get_draft(d['id'])['status']=='needs-revision'


@pytest.mark.asyncio
async def test_large_input_reserves_budget_before_network(tmp_path,monkeypatch):
    from operator_app import content
    p=tmp_path/'claude.json';p.write_text('{"env":{"ANTHROPIC_AUTH_TOKEN":"secret","ANTHROPIC_BASE_URL":"https://open.bigmodel.cn/api/anthropic"}}')
    db=Store(tmp_path/'db');db.configure(daily_tokens=8000)
    def no_network(**kwargs):raise AssertionError('Oversized call must be blocked before network')
    monkeypatch.setattr(content.httpx,'AsyncClient',no_network)
    with pytest.raises(ValueError,match='预算'):await Model(db,p).json('审核输入',{'text':'学'*10000})
