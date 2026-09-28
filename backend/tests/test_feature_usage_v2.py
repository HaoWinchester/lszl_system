"""Versioned, idempotent usage intervals; no user-level output."""
from datetime import datetime, timedelta, timezone
from uuid import uuid4
import pytest
from fastapi.testclient import TestClient
from test_feature_analytics import _student_client, _admin_client
from app.main import app


def interval(client, **changes):
    end = datetime.now(timezone.utc)
    data = dict(eventId=str(uuid4()), visitId=str(uuid4()), featureKey='practice',
                startedAt=(end-timedelta(seconds=30)).isoformat(), endedAt=end.isoformat(),
                foregroundSeconds=30, activeSeconds=20,
                loginSessionId=client.get('/api/v1/auth/me').json()['loginSessionId'])
    return data | changes


def summary(**changes):
    today = datetime.now(timezone(timedelta(hours=8))).date().isoformat()
    return _admin_client().get('/api/v1/system/feature-analytics', params=dict(start=today,end=today,role='student',version=2,**changes))


def test_usage_retries_are_idempotent_and_open_only_is_not_active():
    client = _student_client()
    data = interval(client)
    before = summary().json()
    for _ in range(2):
        res = client.post('/api/v1/analytics/feature-intervals', json=data)
        assert res.status_code == 201, res.text
    after = summary().json()
    p = lambda d: next(x for x in d['features'] if x['featureKey']=='practice')
    assert p(after)['engagedSeconds'] - p(before)['engagedSeconds'] == 20
    assert p(after)['foregroundSeconds'] - p(before)['foregroundSeconds'] == 30
    assert p(after)['visits'] - p(before)['visits'] == 1
    idle = interval(client,featureKey='analysis',activeSeconds=0)
    old = next(x for x in after['features'] if x['featureKey']=='analysis')
    assert client.post('/api/v1/analytics/feature-intervals',json=idle).status_code==201
    new = next(x for x in summary().json()['features'] if x['featureKey']=='analysis')
    assert new['activeUsers'] == old['activeUsers']
    assert new['foregroundSeconds'] - old['foregroundSeconds'] == 30
    assert 'username' not in str(after) and 'owner_id' not in str(after)
    assert after['methodologyVersion']==2 and after['coverage']


@pytest.mark.parametrize('changes',[
    {'activeSeconds':31}, {'foregroundSeconds':61}, {'activeSeconds':-1},
    {'featureKey':'private free text'}, {'ownerId':'admin'},
    {'startedAt':'2000-01-01T00:00:00+00:00'},
])
def test_usage_rejects_bad_intervals(changes):
    c=_student_client()
    assert c.post('/api/v1/analytics/feature-intervals',json=interval(c,**changes)).status_code==422


def test_usage_session_binding_permission_and_legacy_separation():
    c=_student_client()
    assert c.post('/api/v1/analytics/feature-intervals',json=interval(c,loginSessionId='wrong')).status_code==409
    assert TestClient(app).post('/api/v1/analytics/feature-intervals',json=interval(c)).status_code==401
    assert c.get('/api/v1/system/feature-analytics?start=2026-09-01&end=2026-09-28&version=2').status_code==403
    assert summary(client='invalid').status_code==422
    assert summary(sort='invalid').status_code==422
    assert summary(client='mini').json()['filters']['client']=='mini'


def test_usage_metrics_count_visits_days_median_and_snapshot_role():
    from test_feature_analytics import _create_user, _name, _seed
    from app.models.analytics import FeatureUsageInterval
    owner = _name('usage_metrics')
    _create_user(owner,'student')
    base=datetime(2026,2,10,12,tzinfo=timezone.utc)
    rows=[]
    for index,(visit,seconds,day) in enumerate([('one',20,0),('one',40,0),('two',30,1)]):
        start=base+timedelta(days=day,minutes=index)
        rows.append(FeatureUsageInterval(id=str(uuid4()),owner_id=owner,role='student',client='web',visit_id=visit,feature_key='practice',started_at=start,ended_at=start+timedelta(seconds=seconds),foreground_seconds=seconds,active_seconds=seconds))
    _seed(rows)
    response=_admin_client().get('/api/v1/system/feature-analytics',params=dict(start='2026-02-10',end='2026-02-11',role='student',version=2,client='web'))
    assert response.status_code==200,response.text
    feature=next(f for f in response.json()['features'] if f['featureKey']=='practice')
    assert feature['activeUsers']==1
    assert feature['visits']==2
    assert feature['usageDays']==2
    assert feature['medianVisitSeconds']==45
    assert feature['averageSeconds']==90
    assert feature['returningUserRate']==1
    assert owner not in str(response.json())


def test_interval_requires_shanghai_midnight_split(monkeypatch):
    from app.schemas import feature_usage
    from pydantic import ValidationError
    class FrozenDate(datetime):
        @classmethod
        def now(cls, tz=None):
            return datetime(2026,9,28,0,tzinfo=timezone.utc)
    monkeypatch.setattr(feature_usage,'datetime',FrozenDate)
    data=dict(eventId=str(uuid4()),visitId=str(uuid4()),featureKey='practice',
              startedAt='2026-09-27T15:59:50+00:00',endedAt='2026-09-27T16:00:20+00:00',
              foregroundSeconds=30,activeSeconds=30)
    with pytest.raises(ValidationError,match='跨日'):
        feature_usage.FeatureIntervalCreate.model_validate(data)
    feature_usage.FeatureIntervalCreate.model_validate(data | dict(endedAt='2026-09-27T16:00:00+00:00',foregroundSeconds=10,activeSeconds=10))
    feature_usage.FeatureIntervalCreate.model_validate(data | dict(startedAt='2026-09-27T16:00:00+00:00',foregroundSeconds=20,activeSeconds=20))
