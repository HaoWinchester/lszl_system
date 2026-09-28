"""V2 usage aggregation. Receives no content and returns no learner identifiers."""
from collections import defaultdict
from hashlib import sha256
from statistics import median
from datetime import timedelta
from sqlalchemy import select, func, literal, Interval
from sqlalchemy.dialects.postgresql import insert
from app.models.analytics import FeatureUsageInterval as Usage
from app.schemas.feature_usage import FEATURES
from app.services.analytics_service import _local_day_bounds, SHANGHAI

async def append_interval(db, user, event, client):
    # The authenticated owner is part of the key: retries cannot double count.
    key=sha256(f'{user.username}:{event.event_id}'.encode()).hexdigest()
    values=dict(id=key,owner_id=user.username,role=user.role,client=client,
                visit_id=str(event.visit_id),feature_key=event.feature_key,
                started_at=event.started_at,ended_at=event.ended_at,
                foreground_seconds=event.foreground_seconds,active_seconds=event.active_seconds)
    await db.execute(insert(Usage).values(**values).on_conflict_do_nothing(index_elements=['id']))
    await db.commit()

async def aggregate_usage(db, query, options):
    start,end=_local_day_bounds(query)
    filters=[Usage.ended_at > start,Usage.started_at < end]
    if query.role: filters.append(Usage.role==query.role)
    else: filters.append(Usage.role!='admin')
    if options.client: filters.append(Usage.client==options.client)
    # Clip both counters to the requested calendar range; midnight is not an
    # arbitrary receipt-time attribution. Active seconds occupy the interval start.
    active_end=Usage.started_at + Usage.active_seconds * literal(timedelta(seconds=1),type_=Interval())
    active=func.greatest(0,func.extract('epoch',func.least(active_end,end)-func.greatest(Usage.started_at,start)))
    foreground_end=Usage.started_at + Usage.foreground_seconds * literal(timedelta(seconds=1),type_=Interval())
    foreground=func.greatest(0,func.extract('epoch',func.least(foreground_end,end)-func.greatest(Usage.started_at,start)))
    day=func.date_trunc('day',Usage.started_at.op('AT TIME ZONE')('Asia/Shanghai'))
    stmt=select(Usage.feature_key,Usage.owner_id,Usage.visit_id,day.label('day'),
                func.sum(active).label('active'),func.sum(foreground).label('foreground'),func.count().label('samples')).where(*filters).group_by(Usage.feature_key,Usage.owner_id,Usage.visit_id,day)
    buckets={key:dict(users=set(),visits=defaultdict(float),user_visits=defaultdict(set),days=set(),active=0,foreground=0) for key in FEATURES}
    trends=defaultdict(lambda:dict(users=set(),active=0,foreground=0,samples=0))
    samples=0
    result=await db.stream(stmt)
    async for row in result:
        b=buckets.get(row.feature_key)
        if b is None: continue
        a=float(row.active); f=float(row.foreground)
        b['active']+=a; b['foreground']+=f; samples+=row.samples
        date=row.day.date().isoformat()
        t=trends[date]; t['active']+=a;t['foreground']+=f;t['samples']+=row.samples
        if a>0:
            b['users'].add(row.owner_id);b['visits'][(row.owner_id,row.visit_id)]+=a
            b['user_visits'][row.owner_id].add(row.visit_id);b['days'].add((row.owner_id,date))
            t['users'].add(row.owner_id)
    features=[]
    for key,b in buckets.items():
        users=len(b['users']);visits=len(b['visits'])
        features.append(dict(featureKey=key,label=FEATURES[key],activeUsers=users,visits=visits,
            usageDays=len(b['days']),returningUserRate=round(sum(len(v)>1 for v in b['user_visits'].values())/users,4) if users else 0,
            engagedSeconds=round(b['active']),foregroundSeconds=round(b['foreground']),
            averageSeconds=round(b['active']/users) if users else 0,
            medianVisitSeconds=round(median(b['visits'].values())) if visits else 0))
    order={'time':'engagedSeconds','users':'activeUsers','visits':'visits'}[options.sort]
    features.sort(key=lambda f:(f[order],f['engagedSeconds']),reverse=True)
    coverage=[dict(client='web',features=['graph','files','question_bank','papers','practice','recall','induction','analysis']),
              dict(client='mini',features=['home','papers','practice','recall','analysis','growth','profile'])]
    since=(await db.execute(select(func.min(Usage.received_at)))).scalar_one_or_none()
    return dict(methodologyVersion=2,filters=dict(start=query.start.isoformat(),end=query.end.isoformat(),role=query.role,client=options.client,sort=options.sort),
                sampleSize=samples,features=features,coverage=coverage,collectionStartedAt=since.isoformat() if since else None,
                methodology='前台且获得焦点计入前台停留；进入或交互后的 120 秒估算为有效使用，每 15 秒分段提交。阅读思考可能被低估；这不是专注度或学习效果。使用天数为学员与日期的去重组合；再次使用率为区间内有至少两次有效访问的学员占比。短于 1 秒的片段不计；关闭或断网可能漏掉尚未送达的片段。',
                legacyNotice='新口径与旧版事件分开统计，历史漏采不回填。旧版本小程序尚未更新时不会计入新口径。',
                trends=[dict(date=d,activeUsers=len(t['users']),engagedSeconds=round(t['active']),foregroundSeconds=round(t['foreground']),events=t['samples']) for d,t in sorted(trends.items())],insights=[])
