from copy import deepcopy
from datetime import datetime, timedelta, timezone
import json
import httpx
import pytest
from operator_app import sources, content
from operator_app.render import document
from operator_app.store import Store, digest


def test_catalog_has_substantive_supplemental_topics_with_original_answers(tmp_path):
    src, topics = sources.catalog(tmp_path)
    assert len(topics) >= 16
    assert len({t['question']['stem'] for t in topics}) == len(topics)
    for t in topics:
        selected=sources.selected_sources(tmp_path,t['id'])
        assert selected and all(s['facts'] and s['locator'] for s in selected)
        assert t['question']['answer'] in t['question']['options']
    assert any('2014' in s['edition'] and '补充' in s['edition'] for s in src)


def test_supplemental_render_does_not_claim_pmbok8():
    src=[{'id':'pmi-approach','edition':'2014 会议论文 · PMP 通用学习补充','kind':'supplemental'}]
    doc=document({'title':'生命周期','text':'比较不同方法'},0,6,'知习',src)
    assert '第八版' not in doc and '通用学习补充' in doc and '2014' in doc


def test_topics_rotate_after_cooldown_with_new_angle(tmp_path):
    _, topics=sources.catalog(tmp_path)
    now=datetime.now(timezone.utc)
    old=[{'topic':t['id'],'status':'ready','created':(now-timedelta(days=31)).isoformat(),'content':{}} for t in topics]
    chosen,angle=sources.choose_topic(topics,old,now=now)
    assert chosen['id']==topics[0]['id'] and angle
    fresh=[{**d,'created':now.isoformat()} for d in old]
    with pytest.raises(ValueError,match='冷却'): sources.choose_topic(topics,fresh,now=now)


@pytest.mark.asyncio
async def test_each_source_checked_and_changed_evidence_rejected(tmp_path,monkeypatch):
    class Client:
        async def __aenter__(self): return self
        async def __aexit__(self,*args): pass
        async def get(self,url):
            return httpx.Response(200,text='unrelated article',request=httpx.Request('GET',url))
    monkeypatch.setattr(sources.httpx,'AsyncClient',lambda **kw:Client())
    with pytest.raises(ValueError,match='依据'): await sources.verify_sources(tmp_path,['pmi-approach'])
    assert not (tmp_path/'source-check.json').exists()


@pytest.mark.asyncio
async def test_fresh_verification_cache_never_hides_changed_source_hash(tmp_path,monkeypatch):
    class Client:
        async def __aenter__(self): return self
        async def __aexit__(self,*args): pass
        async def get(self,url):
            s=next(s for s in sources.SOURCES if s['url']==url)
            return httpx.Response(200,text=' '.join(s['anchors']),request=httpx.Request('GET',url))
    monkeypatch.setattr(sources.httpx,'AsyncClient',lambda **kw:Client())
    report=await sources.verify_sources(tmp_path,['pmi-approach'])
    assert report['sources'][0]['source_id']=='pmi-approach'
    assert report['sources'][0]['mode']=='live'
    assert report['source_hash']==digest(sources.selected_sources(tmp_path,'predictive'))


def test_supplemental_content_cannot_be_passed_as_eighth_edition(tmp_path):
    topic=next(t for t in sources.catalog(tmp_path)[1] if t['id']=='predictive')
    c={'title':'第八版规定','body':'第八版规定这样做。','cards':[{'title':'定义','text':'预测型方法','source_ids':['pmi-approach']} for _ in range(4)],'question':topic['question']}
    assert any('版本' in e for e in content.validate_content(c,topic,sources.selected_sources(tmp_path,topic['id'])))


@pytest.mark.asyncio
async def test_refresh_rejects_unreviewed_topics_and_persists_status(tmp_path,monkeypatch):
    async def verified(*args):return {'passed':True,'sources':[]}
    monkeypatch.setattr(sources,'verify_sources',verified)
    class Model:
        async def json(self,system,data): return {'topics':[{'id':'unsupported','name':'fake'}]}
    result=await sources.refresh_library(Store(tmp_path),Model())
    assert result['added_topics']==0
    assert (tmp_path/'knowledge-refresh.json').exists()
    assert all(t['id']!='unsupported' for t in sources.catalog(tmp_path)[1])


@pytest.mark.asyncio
async def test_historical_source_snapshot_does_not_expire_like_live_overview(tmp_path,monkeypatch):
    class Client:
        async def __aenter__(self):return self
        async def __aexit__(self,*args):pass
        async def get(self,url):return httpx.Response(403,request=httpx.Request('GET',url))
    monkeypatch.setattr(sources.httpx,'AsyncClient',lambda **kw:Client())
    seeds=deepcopy(sources.SOURCES)
    for s in seeds:s['checked_at']='2020-01-01'
    monkeypatch.setattr(sources,'SOURCES',seeds)
    report=await sources.verify_sources(tmp_path,['pmi-approach'])
    assert report['sources'][0]['mode']=='historical-snapshot'
    assert report['sources'][0]['checked_at']=='2020-01-01'
    with pytest.raises(ValueError,match='过期'):await sources.verify_sources(tmp_path,['pmi-pmbok8'])


@pytest.mark.asyncio
async def test_reviewed_expansion_is_persisted_and_budgeted_weekly(tmp_path,monkeypatch):
    async def verified(*args):return {'passed':True,'sources':[]}
    monkeypatch.setattr(sources,'verify_sources',verified)
    class Model:
        def __init__(self):self.calls=0
        async def json(self,system,data):
            self.calls+=1
            if self.calls==1:
                t=deepcopy(sources.TOPICS[4]);t.update(id='new-study-angle',name='确定需求后怎样考虑项目方法')
                t['question']['stem']='交付预期清楚时，应该评估什么方法？'
                return {'topics':[t]}
            return {'reviews':[{'id':'new-study-angle','passed':True,'issues':[],'source_ids':['pmi-approach']}]}
    model=Model();db=Store(tmp_path)
    result=await sources.refresh_library(db,model)
    assert result['added_topics']==1
    assert sources.selected_sources(tmp_path,'new-study-angle')[0]['id']=='pmi-approach'
    again=await sources.refresh_library(db,model)
    assert again['added_topics']==0 and model.calls==2


def test_external_topic_cannot_smuggle_links_or_invalid_source_ids():
    t=deepcopy(sources.TOPICS[4]);t['question']['explanation']='请访问 https://evil.invalid'
    assert not sources._valid_topic(t,{'pmi-approach'})
    t=deepcopy(sources.TOPICS[4]);t['source_ids']=[{}]
    assert not sources._valid_topic(t,{'pmi-approach'})


@pytest.mark.asyncio
async def test_source_refresh_failure_does_not_disable_other_verified_topics(tmp_path,monkeypatch):
    async def verified(root,ids=None):
        if not ids or 'pmi-pmbok8' in ids:raise ValueError('简介已过期')
        return {'passed':True,'sources':[{'source_id':ids[0],'mode':'historical-snapshot'}]}
    monkeypatch.setattr(sources,'verify_sources',verified)
    result=await sources.refresh_library(Store(tmp_path))
    assert not result['passed']
    assert result['available_source_ids']==['pmi-approach','pmi-stakeholders','pmi-tailoring']
    assert any(s.get('error')=='简介已过期' for s in result['verification']['sources'])


@pytest.mark.asyncio
async def test_generation_skips_failed_source_and_binds_only_selected_evidence(tmp_path,monkeypatch):
    async def verified(root,ids=None):
        if 'pmi-pmbok8' in ids:raise ValueError('简介已过期')
        return {'passed':True}
    async def rendered(*args):return []
    class Model:
        def __init__(self,db):pass
        def info(self):return {'model':'test'}
        async def json(self,system,data):
            if system==content.GENERATE:
                assert data['facts'][0]['id']=='pmi-approach' and len(data['facts'])==1
                return {'title':'范围稳定时考虑什么','body':'2014 年论文通用学习补充：预测型适合交付预期较明确的情境。','cards':[{'title':'原创举例','text':'原创举例：搬家物品清单已经确定，可以先规划打包步骤。','source_ids':['pmi-approach']} for _ in range(4)],'question':data['question']}
            return {'passed':True,'issues':[],'claims':[{'claim':'预测型适合交付预期较明确的情境','source_id':'pmi-approach','supported':True}]}
    monkeypatch.setattr(content,'verify_sources',verified)
    monkeypatch.setattr(content,'Model',Model);monkeypatch.setattr(content,'render',rendered)
    draft=await content.Pipeline(Store(tmp_path)).generate()
    assert draft['status']=='ready' and draft['topic']=='predictive'
    assert draft['review']['source_ids']==['pmi-approach']
    assert draft['review']['source_hash']==digest([sources.SOURCES[1]])


def test_malformed_model_topic_is_rejected_without_crashing():
    t=deepcopy(sources.TOPICS[4]);t['question']['answer']=[]
    assert not sources._valid_topic(t,{'pmi-approach'})


def test_corrupt_library_does_not_hide_curated_topics(tmp_path):
    (tmp_path/'knowledge-library.json').write_text(json.dumps({'source_hash':digest(sources.SOURCES),'topics':{}}))
    assert len(sources.catalog(tmp_path)[1])>=19


@pytest.mark.asyncio
async def test_library_growth_stops_at_cap_even_when_batch_has_four(tmp_path,monkeypatch):
    async def verified(*args):return {'passed':True,'sources':[]}
    monkeypatch.setattr(sources,'verify_sources',verified)
    topics=[]
    for i in range(199):
        t=deepcopy(sources.TOPICS[4]);t.update(id=f'old-{i}',name=f'现有选题{i}');t['question']['stem']=f'现有题干{i}';topics.append(t)
    monkeypatch.setattr(sources,'catalog',lambda root:(sources.SOURCES,topics))
    class Model:
        async def json(self,system,data):
            if system==sources.REVIEW_TOPICS:return {'reviews':[{'id':t['id'],'passed':True,'issues':[],'source_ids':t['source_ids']} for t in data['topics']]}
            result=[]
            for i in range(4):
                t=deepcopy(sources.TOPICS[4]);t.update(id=f'new-{i}',name=f'新选题{i}');t['question']['stem']=f'新题干{i}';result.append(t)
            return {'topics':result}
    result=await sources.refresh_library(Store(tmp_path),Model())
    assert result['topic_count']==200 and result['added_topics']==1


@pytest.mark.asyncio
async def test_expansion_budget_exhaustion_keeps_verified_library_available(tmp_path,monkeypatch):
    async def verified(*args):return {'passed':True,'sources':[]}
    monkeypatch.setattr(sources,'verify_sources',verified)
    class Model:
        async def json(self,*args):raise ValueError('今日模型预算已用完')
    result=await sources.refresh_library(Store(tmp_path),Model())
    assert result['passed'] and result['added_topics']==0
    assert '预算' in result['expansion_error']
    assert len(sources.catalog(tmp_path)[1])>=19
