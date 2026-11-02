from datetime import datetime, timezone, timedelta
import pytest
from operator_app.store import Store
from operator_app.research import Research, summarize, metric


def sample(n=1, **values):
    return {'note_id':f'{n:024x}', 'title':'PMP备考怎么刷题？',
            'url':f'https://www.xiaohongshu.com/explore/{n:024x}',
            'author':'学习分享', 'likes':'1.2万', 'text':'先理解，再练习，最后复盘。', **values}


def test_research_metrics_do_not_invent_missing_values():
    assert metric('1.2万')==12000
    assert metric('赞') is None
    assert metric('10万+') is None
    report=summarize([sample(),sample(),sample(2,likes='赞')])
    assert report['sample_count']==2
    assert report['known_likes']==1
    assert report['median_likes']==12000
    assert report['question_titles']==2
    assert '转化' not in str(report['recommendations'])


def test_research_requires_recent_observed_evidence(tmp_path):
    r=Research(Store(tmp_path))
    with pytest.raises(ValueError):r.context()
    report=r.save([sample()], 'PMP 备考', datetime.now(timezone.utc).isoformat())
    assert r.context()['sample_count']==1
    assert report['samples'][0]['note_id']=='000000000000000000000001'
    r.save([sample()], 'PMP 备考', (datetime.now(timezone.utc)-timedelta(days=3)).isoformat())
    with pytest.raises(ValueError):r.context()


def test_research_rejects_foreign_links_and_sensitive_content(tmp_path):
    r=Research(Store(tmp_path))
    with pytest.raises(ValueError):r.save([sample(url='https://evil.invalid/a')], 'PMP', datetime.now(timezone.utc).isoformat())
    with pytest.raises(ValueError):r.save([], 'PMP', datetime.now(timezone.utc).isoformat())


@pytest.mark.asyncio
async def test_failed_refresh_keeps_success_but_reports_failure(tmp_path):
    r=Research(Store(tmp_path))
    r.save([sample()], 'PMP',datetime.now(timezone.utc).isoformat())
    class Offline:
        async def search_competitors(self,query,limit): raise ValueError('主站登录失效')
    with pytest.raises(ValueError):await r.refresh(Offline())
    assert r.state()['sample_count']==1
    assert r.state()['last_error']=='主站登录失效'

@pytest.mark.asyncio
async def test_audited_draft_records_research_used(tmp_path,monkeypatch):
    from operator_app import content
    from test_content import sample as draft_sample
    from operator_app.sources import TOPICS
    async def verified(*args):return {}
    async def rendered(*args):return []
    class Reviewer:
        def info(self):return {'model':'test'}
        async def json(self,*args):return {'passed':True,'issues':[],'claims':[{'claim':'七域','source_id':'pmi-pmbok8','supported':True}]}
    monkeypatch.setattr(content,'verify_sources',verified);monkeypatch.setattr(content,'render',rendered)
    db=Store(tmp_path);Research(db).save([sample()],'PMP',datetime.now(timezone.utc).isoformat())
    draft=db.create_draft(draft_sample(),TOPICS[0]['id'])
    result=await content.Pipeline(db).audit(draft,Reviewer())
    assert result['review']['research']['sample_count']==1
    assert result['review']['research']['sampled_at']
