"""Schemas for the direct new-legacy storage adapter."""

from typing import Literal

from pydantic import BaseModel, Field, StrictInt


class RuntimeMutation(BaseModel):
    operation: Literal["setItem", "removeItem"]
    key: str = Field(min_length=1, max_length=240)
    value: str | None = None


class RuntimeStateUpdate(BaseModel):
    page: str = Field(min_length=1, max_length=120)
    namespace: str = Field(min_length=1, max_length=80)
    operation: Literal["setItem", "removeItem", "clear"]
    key: str = Field(default="", max_length=240)
    value: str | None = None
    storage: dict[str, str] = Field(default_factory=dict)
    snapshotMode: Literal["merge", "full"] = "merge"
    mutations: list[RuntimeMutation] = Field(default_factory=list, max_length=500)
    requestId: str = Field(min_length=1, max_length=120)
    revision: int = Field(default=0, ge=0)
    contentRevision: StrictInt | None = Field(default=None, ge=0)
