from __future__ import annotations

from datetime import datetime
from typing import Any, Literal

from pydantic import BaseModel, ConfigDict, Field, StrictInt, field_validator

from app.schemas.question_catalog import QuestionPayload
from app.services import teaching_content_projection_service


class QuestionSyncItem(BaseModel):
    model_config = ConfigDict(extra="forbid", populate_by_name=True)

    question: QuestionPayload
    base_revision: int | None = Field(default=None, alias="baseRevision", ge=1)
    lock_token: str | None = Field(default=None, alias="lockToken", max_length=128)


class ContentPrepBatchRequest(BaseModel):
    model_config = ConfigDict(extra="forbid", populate_by_name=True)

    idempotency_key: str = Field(alias="idempotencyKey", min_length=1, max_length=120)
    client_instance_id: str = Field(alias="clientInstanceId", min_length=1, max_length=128)
    target_bank_id: str = Field(alias="targetBankId", min_length=1, max_length=64)
    creator_id: str = Field(alias="creatorId", min_length=1, max_length=64)
    prep_version: str = Field(alias="prepVersion", min_length=1, max_length=32)
    workspace_version: str = Field(alias="workspaceVersion", min_length=1, max_length=32)
    questions: list[QuestionSyncItem] = Field(default_factory=list)
    subject_id: str = Field(default="PMP", alias="subjectId", min_length=1, max_length=128)
    knowledge_tree: dict[str, Any] | None = Field(default=None, alias="knowledgeTree")
    recall_library: dict[str, Any] | None = Field(default=None, alias="recallLibrary")
    principles: dict[str, Any] = Field(default_factory=dict)
    synthesis_presets: dict[str, Any] = Field(default_factory=dict, alias="synthesisPresets")
    tag_config: dict[str, Any] = Field(default_factory=dict, alias="tagConfig")

    @field_validator("principles")
    @classmethod
    def validate_principles(cls, value: dict[str, Any]) -> dict[str, Any]:
        return teaching_content_projection_service.validate_projection_container(
            teaching_content_projection_service.PRINCIPLE_KEY,
            value,
        )

    @field_validator("synthesis_presets")
    @classmethod
    def validate_synthesis_presets(cls, value: dict[str, Any]) -> dict[str, Any]:
        return teaching_content_projection_service.validate_projection_container(
            teaching_content_projection_service.PRESET_KEY,
            value,
        )


class ContentPrepQuestionSaveRequest(BaseModel):
    model_config = ConfigDict(extra="forbid", populate_by_name=True)

    idempotency_key: str = Field(alias="idempotencyKey", min_length=1, max_length=120)
    client_instance_id: str = Field(alias="clientInstanceId", min_length=1, max_length=128)
    creator_id: str | None = Field(default=None, alias="creatorId", min_length=1, max_length=64)
    prep_version: str = Field(default="0.4.0", alias="prepVersion", max_length=32)
    workspace_version: str = Field(default="1", alias="workspaceVersion", max_length=32)
    question: QuestionPayload
    base_revision: int = Field(alias="baseRevision", ge=1)
    lock_token: str = Field(alias="lockToken", min_length=1, max_length=128)
    principles: dict[str, Any] = Field(default_factory=dict)
    synthesis_presets: dict[str, Any] = Field(default_factory=dict, alias="synthesisPresets")
    tag_config: dict[str, Any] = Field(default_factory=dict, alias="tagConfig")

    @field_validator("principles")
    @classmethod
    def validate_principles(cls, value: dict[str, Any]) -> dict[str, Any]:
        return teaching_content_projection_service.validate_projection_container(
            teaching_content_projection_service.PRINCIPLE_KEY,
            value,
        )

    @field_validator("synthesis_presets")
    @classmethod
    def validate_synthesis_presets(cls, value: dict[str, Any]) -> dict[str, Any]:
        return teaching_content_projection_service.validate_projection_container(
            teaching_content_projection_service.PRESET_KEY,
            value,
        )


class ContentPrepSharedContentRequest(BaseModel):
    model_config = ConfigDict(extra="forbid", populate_by_name=True)

    subject_id: str = Field(alias="subjectId", min_length=1, max_length=128)
    content_revision: StrictInt = Field(alias="contentRevision", ge=0)
    knowledge_tree: dict[str, Any] | None = Field(default=None, alias="knowledgeTree")
    recall_library: dict[str, Any] | None = Field(default=None, alias="recallLibrary")
    principles: dict[str, Any] = Field(default_factory=dict)
    synthesis_presets: dict[str, Any] = Field(default_factory=dict, alias="synthesisPresets")
    tag_config: dict[str, Any] = Field(default_factory=dict, alias="tagConfig")


class SubjectFacetSchemaWriteRequest(BaseModel):
    """One canonical subject-facet schema write under the shared content lock."""

    model_config = ConfigDict(extra="forbid", populate_by_name=True)

    content_revision: StrictInt = Field(alias="contentRevision", ge=0)
    facet_schema: dict[str, Any] = Field(alias="schema")


class ContentPrepPrincipleWriteRequest(BaseModel):
    model_config = ConfigDict(extra="forbid", populate_by_name=True)

    content_revision: StrictInt = Field(alias="contentRevision", ge=0)
    principle: dict[str, Any]
    preset: dict[str, Any]


class ContentPrepDeleteRequest(BaseModel):
    model_config = ConfigDict(extra="forbid", populate_by_name=True)

    content_revision: StrictInt = Field(alias="contentRevision", ge=0)


class ContentPrepActivityImportRequest(BaseModel):
    model_config = ConfigDict(extra="forbid", populate_by_name=True)

    content_revision: StrictInt = Field(alias="contentRevision", ge=0)
    subject_id: str = Field(default="subject-pmp", alias="subjectId", min_length=1, max_length=128)
    collection_id: str = Field(default="default", alias="collectionId", min_length=1, max_length=128)
    activities: list[dict[str, Any]] = Field(min_length=1, max_length=5000)


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
    bank_revision: int | None = Field(default=None, alias="bankRevision", ge=1)
    content_revision: int = Field(default=0, alias="contentRevision", ge=0)
    replayed: bool = False
    questions: list[ContentPrepQuestionResult]


class ContentPrepDraftCreateRequest(BaseModel):
    model_config = ConfigDict(extra="forbid", populate_by_name=True)

    title: str = Field(min_length=1, max_length=160)
    payload: dict[str, Any]


class ContentPrepDraftUpdateRequest(ContentPrepDraftCreateRequest):
    revision: StrictInt = Field(ge=1)


class ContentPrepDraftSyncRequest(BaseModel):
    model_config = ConfigDict(extra="forbid", populate_by_name=True)

    revision: StrictInt = Field(ge=1)
    creator_id: str = Field(alias="creatorId", min_length=1, max_length=64)


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
