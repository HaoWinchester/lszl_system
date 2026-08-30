"""Typed Content Prep recall-acceptance API contracts."""

from __future__ import annotations

from typing import Literal

from pydantic import BaseModel, ConfigDict, Field, StrictInt


class RecallAcceptanceChoice(BaseModel):
    model_config = ConfigDict(extra="forbid")

    id: str = Field(max_length=256)
    title: str = Field(max_length=1000)
    label: str | None = Field(default=None, max_length=1000)
    priority: int | float | None = None


class RecallAcceptanceMatch(BaseModel):
    model_config = ConfigDict(extra="forbid")

    id: str = Field(max_length=256)
    title: str = Field(max_length=1000)


class RecallAcceptanceRecord(BaseModel):
    model_config = ConfigDict(extra="forbid", populate_by_name=True)

    id: str = Field(min_length=1, max_length=256)
    at: str = Field(min_length=1, max_length=64)
    type: Literal["input", "node"]
    source: str = Field(max_length=64)
    query: str = Field(default="", max_length=2000)
    match_mode: str = Field(default="", alias="matchMode", max_length=128)
    node_id: str = Field(default="", alias="nodeId", max_length=256)
    node_title: str = Field(default="", alias="nodeTitle", max_length=1000)
    auto_status: str = Field(default="", alias="autoStatus", max_length=128)
    candidate_count: StrictInt | None = Field(default=None, alias="candidateCount", ge=0)
    first_choices: list[RecallAcceptanceChoice] = Field(
        default_factory=list,
        alias="firstChoices",
        max_length=100,
    )
    path: list[str] = Field(default_factory=list, max_length=500)
    suggestion: str | None = Field(default=None, max_length=4000)
    matches: list[RecallAcceptanceMatch] | None = Field(default=None, max_length=100)
    manual_verdict: str = Field(default="", alias="manualVerdict", max_length=128)
    note: str = Field(default="", max_length=10000)
    updated_at: str | None = Field(default=None, alias="updatedAt", max_length=64)


class RecallAcceptanceWriteRequest(BaseModel):
    model_config = ConfigDict(extra="forbid", populate_by_name=True)

    revision: StrictInt = Field(ge=0)
    records: list[RecallAcceptanceRecord] = Field(default_factory=list, max_length=10000)


class RecallAcceptanceClearRequest(BaseModel):
    model_config = ConfigDict(extra="forbid")

    revision: StrictInt = Field(ge=0)


class RecallAcceptanceResponse(BaseModel):
    model_config = ConfigDict(populate_by_name=True)

    revision: int
    records: list[RecallAcceptanceRecord]
    updated_at: str | None = Field(alias="updatedAt")
