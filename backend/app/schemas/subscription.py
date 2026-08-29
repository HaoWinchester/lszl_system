"""Typed request contracts for subscription administration."""

from datetime import datetime
from typing import Literal

from pydantic import BaseModel, ConfigDict, Field, model_validator


class AdminSubscriptionUpdate(BaseModel):
    model_config = ConfigDict(extra="forbid", populate_by_name=True)

    plan_id: str = Field(default="free", alias="planId")
    status: Literal["active", "paused", "expired", "cancelled", "trial", "manual"] | None = None
    started_at: datetime | None = Field(default=None, alias="startedAt")
    expires_at: datetime | None = Field(default=None, alias="expiresAt")
    note: str | None = None

    @model_validator(mode="after")
    def validate_dates(self) -> "AdminSubscriptionUpdate":
        for field_name in ("started_at", "expires_at"):
            value = getattr(self, field_name)
            if value is not None and value.utcoffset() is None:
                raise ValueError(f"{field_name} 必须包含时区")
        if (
            self.started_at is not None
            and self.expires_at is not None
            and self.expires_at <= self.started_at
        ):
            raise ValueError("expiresAt 必须晚于 startedAt")
        return self
