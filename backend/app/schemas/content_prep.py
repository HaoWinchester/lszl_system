from __future__ import annotations

from datetime import datetime
from typing import Any, Literal

from pydantic import BaseModel, ConfigDict, Field

from app.schemas.question_catalog import QuestionPayload


class QuestionSyncItem(BaseModel):
    model_config = ConfigDict(extra="forbid", populate_by_name=True)

    question: QuestionPayload
    base_revision: int | None = Field(default=None, alias="baseRevision", ge=1)
    lock_token: str | None = Field(default=None, alias="lockToken", max_length=128)


class ContentPrepBatchRequest(BaseModel):
    model_config = ConfigDict(extra="forbid", populate_by_name=True)

    idempotency_key: str = Field(alias="idempotencyKey", min_length=1, max_length=128)
    client_instance_id: str = Field(alias="clientInstanceId", min_length=1, max_length=128)
    target_bank_id: str = Field(alias="targetBankId", min_length=1, max_length=64)
    creator_id: str = Field(alias="creatorId", min_length=1, max_length=64)
    prep_version: str = Field(alias="prepVersion", min_length=1, max_length=32)
    workspace_version: str = Field(alias="workspaceVersion", min_length=1, max_length=32)
    questions: list[QuestionSyncItem] = Field(min_length=1)
    principles: dict[str, Any] = Field(default_factory=dict)
    synthesis_presets: dict[str, Any] = Field(default_factory=dict, alias="synthesisPresets")
    tag_config: dict[str, Any] = Field(default_factory=dict, alias="tagConfig")


class ContentPrepQuestionResult(BaseModel):
    model_config = ConfigDict(extra="forbid", populate_by_name=True)

    question_id: str = Field(alias="questionId", min_length=1, max_length=64)
    status: Literal["created", "updated", "skipped"]
    revision: int = Field(ge=1)
    content_hash: str = Field(alias="contentHash", min_length=64, max_length=64)


class ContentPrepBatchResult(BaseModel):
    model_config = ConfigDict(extra="forbid", populate_by_name=True)

    batch_id: str = Field(alias="batchId", min_length=1, max_length=64)
    bank_id: str = Field(alias="bankId", min_length=1, max_length=64)
    replayed: bool = False
    questions: list[ContentPrepQuestionResult]


class LockGrant(BaseModel):
    model_config = ConfigDict(extra="forbid", populate_by_name=True)

    question_id: str = Field(alias="questionId", min_length=1, max_length=64)
    lock_token: str = Field(alias="lockToken", min_length=1, max_length=256)
    locked_by: str = Field(alias="lockedBy", min_length=1, max_length=64)
    creator_id: str | None = Field(default=None, alias="creatorId", max_length=64)
    creator_name: str | None = Field(default=None, alias="creatorName", max_length=120)
    client_instance_id: str = Field(alias="clientInstanceId", min_length=1, max_length=128)
    acquired_at: datetime = Field(alias="acquiredAt")
    expires_at: datetime = Field(alias="expiresAt")
    heartbeat_interval_seconds: int = Field(alias="heartbeatIntervalSeconds", ge=1)
    lease_seconds: int = Field(alias="leaseSeconds", ge=1)


class CatalogIssue(BaseModel):
    model_config = ConfigDict(extra="forbid", populate_by_name=True)

    question_id: str | None = Field(default=None, alias="questionId", max_length=64)
    field: str | None = Field(default=None, max_length=255)
    code: str = Field(min_length=1, max_length=128)
    message: str = Field(min_length=1)


class CatalogError(BaseModel):
    model_config = ConfigDict(extra="forbid", populate_by_name=True)

    code: str = Field(min_length=1, max_length=128)
    message: str = Field(min_length=1)
    batch_id: str | None = Field(default=None, alias="batchId", max_length=64)
    issues: list[CatalogIssue] = Field(default_factory=list)
