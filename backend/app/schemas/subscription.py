"""Typed request contracts for subscription administration."""

from datetime import datetime
from typing import Literal

from pydantic import BaseModel, ConfigDict, Field, model_validator


class AdminOrderCancellationRequest(BaseModel):
    model_config = ConfigDict(extra="forbid", str_strip_whitespace=True)

    note: str = Field(default="", max_length=500)


class RedeemCodeGenerationRequest(BaseModel):
    model_config = ConfigDict(
        extra="forbid", populate_by_name=True, str_strip_whitespace=True
    )

    plan_id: str = Field(
        default="monthly", alias="planId", min_length=1, max_length=32
    )
    count: int = Field(default=1, ge=1, le=200)
    prefix: str = Field(
        default="VIP", min_length=1, max_length=8, pattern=r"^[A-Za-z0-9]+$"
    )
    note: str = Field(default="", max_length=500)


class RedeemCodeStatusUpdate(BaseModel):
    model_config = ConfigDict(extra="forbid")

    status: Literal["unused", "disabled"]


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
