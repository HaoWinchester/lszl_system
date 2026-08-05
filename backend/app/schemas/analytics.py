"""用户功能偏好遥测：写入契约与聚合查询参数。

- 事件只接受固定功能 × 事件类型 × 动作组合，杜绝客户端自定义遥测键。
- 请求体使用 camelCase（前端契约），内部归一化为 snake_case，且禁止携带身份字段。
"""

from datetime import date
from typing import Self

from pydantic import BaseModel, ConfigDict, Field, model_validator

# 固定的功能键与事件类型——不可由客户端扩展。
ALLOWED_FEATURES: tuple[str, ...] = (
    "graph",
    "files",
    "question_bank",
    "training",
    "recall",
    "learning_path",
)
ALLOWED_EVENT_TYPES: tuple[str, ...] = ("opened", "engaged", "key_action", "outcome")

# 功能 × 事件类型 → 允许的动作集合（同一动作在 key_action / outcome 下可不同）。
ALLOWED_ACTIONS: dict[str, dict[str, set[str]]] = {
    "graph": {"key_action": {"graph_saved"}, "outcome": {"graph_saved"}},
    "files": {"key_action": {"library_saved"}, "outcome": {"library_saved"}},
    "question_bank": {
        "key_action": {"bank_saved", "question_saved"},
        "outcome": {"bank_saved", "question_saved"},
    },
    "training": {
        "key_action": {"answer_submitted"},
        "outcome": {"answer_correct", "answer_incorrect"},
    },
    "recall": {"key_action": {"recall_saved"}, "outcome": {"recall_saved"}},
    "learning_path": {
        "key_action": {"node_completed", "placement_completed"},
        "outcome": {"node_completed", "placement_completed"},
    },
}

# 不携带动作的事件类型：opened 仅记录进入，engaged 仅记录停留时长。
EVENTS_WITHOUT_ACTION: tuple[str, ...] = ("opened", "engaged")

ALLOWED_ANALYTICS_ROLES: tuple[str, ...] = ("teacher", "student", "viewer")


class FeatureEventCreate(BaseModel):
    """单条功能遥测事件的写入契约（仅允许列表内组合，禁止身份/时间字段）。"""

    model_config = ConfigDict(extra="forbid", populate_by_name=True)

    feature_key: str = Field(alias="featureKey")
    event_type: str = Field(alias="eventType")
    action_key: str | None = Field(default=None, alias="actionKey")
    duration_seconds: int | None = Field(default=None, alias="durationSeconds")

    @model_validator(mode="after")
    def _enforce_feature_event_contract(self) -> Self:
        if self.feature_key not in ALLOWED_FEATURES:
            raise ValueError(f"未知的功能：{self.feature_key}")
        if self.event_type not in ALLOWED_EVENT_TYPES:
            raise ValueError(f"未知的事件类型：{self.event_type}")

        if self.event_type in EVENTS_WITHOUT_ACTION:
            if self.action_key is not None:
                raise ValueError(f"{self.event_type} 事件不能携带动作")
        else:
            actions = ALLOWED_ACTIONS.get(self.feature_key, {}).get(self.event_type, set())
            if self.action_key not in actions:
                raise ValueError(
                    f"动作 {self.action_key!r} 不在功能 {self.feature_key} 的 "
                    f"{self.event_type} 允许列表内"
                )

        if self.duration_seconds is not None:
            if self.event_type != "engaged":
                raise ValueError("仅 engaged 事件可记录停留时长")
            if not 10 <= self.duration_seconds <= 1800:
                raise ValueError("停留时长需在 10–1800 秒之间")
        return self


class FeatureAnalyticsQuery(BaseModel):
    """管理员聚合查询参数：日期区间（闭区间）与可选角色过滤。"""

    model_config = ConfigDict(extra="forbid")

    start: date
    end: date
    role: str | None = None

    @model_validator(mode="after")
    def _enforce_query_contract(self) -> Self:
        if self.start > self.end:
            raise ValueError("开始日期不能晚于结束日期")
        if (self.end - self.start).days > 365:
            raise ValueError("查询日期范围不能超过 366 天")
        if self.role is not None and self.role not in ALLOWED_ANALYTICS_ROLES:
            raise ValueError("角色过滤仅支持 teacher / student / viewer")
        return self
