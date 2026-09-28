"""Bounded, content-free foreground intervals, separate from legacy telemetry."""
from datetime import datetime, timezone, timedelta
from typing import Literal
from uuid import UUID
from pydantic import BaseModel, ConfigDict, Field, model_validator

FEATURES = {
    'graph': '知识图谱', 'practice': '刷题', 'recall': '知识回忆',
    'induction': '多题归纳', 'analysis': '解析与报告', 'papers': '选择试卷',
    'home': '学习首页', 'growth': '学习成长', 'profile': '个人中心',
    'files': '文件管理', 'question_bank': '题目管理',
}

class FeatureIntervalCreate(BaseModel):
    model_config = ConfigDict(extra='forbid', populate_by_name=True)
    event_id: UUID = Field(alias='eventId')
    visit_id: UUID = Field(alias='visitId')
    feature_key: str = Field(alias='featureKey')
    started_at: datetime = Field(alias='startedAt')
    ended_at: datetime = Field(alias='endedAt')
    foreground_seconds: int = Field(alias='foregroundSeconds', ge=1, le=60, strict=True)
    active_seconds: int = Field(alias='activeSeconds', ge=0, le=60, strict=True)
    login_session_id: str | None = Field(default=None, alias='loginSessionId', max_length=128)

    @model_validator(mode='after')
    def valid_interval(self):
        if self.feature_key not in FEATURES:
            raise ValueError('未知功能')
        if self.started_at.tzinfo is None or self.ended_at.tzinfo is None:
            raise ValueError('统计时段必须包含时区')
        span = (self.ended_at-self.started_at).total_seconds()
        now = datetime.now(timezone.utc)
        if not 1 <= span <= 60 or self.foreground_seconds > span + 0.01:
            raise ValueError('时段必须为 1—60 秒，前台秒数不得超过时段')
        # Shared web/mini clocks split at Shanghai midnight. Keep the
        # aggregation contract single-day, with an exclusive end boundary.
        shanghai = timezone(timedelta(hours=8))
        if self.started_at.astimezone(shanghai).date() != (self.ended_at-timedelta(microseconds=1)).astimezone(shanghai).date():
            raise ValueError('跨日时段须按北京时间零点拆分')
        if self.active_seconds > self.foreground_seconds:
            raise ValueError('有效使用不得超过前台停留')
        if self.ended_at > now + timedelta(seconds=60) or self.started_at < now-timedelta(hours=24):
            raise ValueError('仅接收最近 24 小时内的时段，请检查设备时间')
        return self

class UsageQuery(BaseModel):
    client: Literal['web','mini'] | None = None
    sort: Literal['time','users','visits'] = 'time'
