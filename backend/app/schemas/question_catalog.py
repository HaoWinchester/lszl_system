from __future__ import annotations

from typing import Any

from pydantic import BaseModel, ConfigDict, Field


class QuestionPayload(BaseModel):
    """Lossless DTO for the Content Prep v0.4.x question contract."""

    model_config = ConfigDict(extra="allow", populate_by_name=True)

    id: str = Field(min_length=1, max_length=64)
    title: str = Field(min_length=1, max_length=500)
    type: str = Field(default="single_choice", max_length=32)
    subject: str | None = Field(default=None, max_length=32)
    difficulty: str | None = Field(default=None, max_length=64)
    domain: str | None = Field(default=None, max_length=255)
    topic: str | None = Field(default=None, max_length=255)
    tags: list[Any] = Field(default_factory=list)
    stage: str | None = Field(default=None, max_length=128)
    scope: str | None = Field(default=None, max_length=16)
    stem_parts: list[dict[str, Any]] = Field(default_factory=list, alias="stemParts")
    options: list[dict[str, Any]] = Field(default_factory=list)
    correct_answer: Any = Field(default=None, alias="correctAnswer")
    correct_option_ids: list[str] = Field(default_factory=list, alias="correctOptionIds")
    analysis: Any = None
    translations: dict[str, Any] = Field(default_factory=dict)
    clues: list[dict[str, Any]] = Field(default_factory=list)
    concepts: list[dict[str, Any]] = Field(default_factory=list)
    reasoning_steps: list[dict[str, Any]] = Field(default_factory=list, alias="reasoningSteps")
    key_path: dict[str, Any] = Field(default_factory=dict, alias="keyPath")
    metadata: dict[str, Any] = Field(default_factory=dict)
    status: dict[str, Any] = Field(default_factory=dict)
    lifecycle: dict[str, Any] = Field(default_factory=dict)
    teacher_number: str | None = Field(default=None, alias="teacherNumber", max_length=128)
    explanation: Any = None


class QuestionBankImportQuestionPayload(QuestionPayload):
    """Question import payload with the external identity needed for idempotent imports."""

    source_id: str | None = Field(default=None, alias="sourceId", max_length=128)


class QuestionBankImportItem(BaseModel):
    """One JSON-import source bank; its IDs are stable external identities, not DB primary keys."""

    model_config = ConfigDict(extra="allow", populate_by_name=True)

    id: str = Field(min_length=1, max_length=128)
    source_id: str | None = Field(default=None, alias="sourceId", max_length=128)
    name: str = Field(min_length=1, max_length=200)
    subject: str = Field(default="PMP", min_length=1, max_length=32)
    description: str | None = None
    version: str = Field(default="1.0", max_length=32)
    visibility: str = Field(default="private", max_length=32)
    questions: list[QuestionBankImportQuestionPayload] = Field(min_length=1)


class QuestionBankImportRequest(BaseModel):
    model_config = ConfigDict(extra="forbid", populate_by_name=True)

    banks: list[QuestionBankImportItem] = Field(min_length=1)
    confirm_replace: bool = Field(default=False, alias="confirmReplace")
    confirm_duplicate_cleanup: bool = Field(default=False, alias="confirmDuplicateCleanup")


class QuestionBankImportResponse(BaseModel):
    model_config = ConfigDict(populate_by_name=True)

    banks: list[dict[str, Any]]
    source_bank_id_map: dict[str, str] = Field(alias="sourceBankIdMap")
    source_question_id_map: dict[str, str] = Field(alias="sourceQuestionIdMap")
    content_revision: int = Field(alias="contentRevision", ge=1)
    import_plan: dict[str, Any] = Field(alias="importPlan")


class CatalogQuestionPayload(QuestionPayload):
    source_id: str | None = Field(default=None, alias="sourceId", max_length=128)
    bank_id: str = Field(alias="bankId", min_length=1, max_length=64)
    content_hash: str | None = Field(default=None, alias="contentHash", max_length=64)
    creator_id: str | None = Field(default=None, alias="creatorId", max_length=64)
    creator_name: str | None = Field(default=None, alias="creatorName", max_length=120)
    revision: int = Field(ge=1)
    created_by: str | None = Field(default=None, alias="createdBy", max_length=64)
    updated_by: str | None = Field(default=None, alias="updatedBy", max_length=64)
    created_at: str | None = Field(default=None, alias="createdAt")
    updated_at: str | None = Field(default=None, alias="updatedAt")


class CatalogBankPayload(BaseModel):
    model_config = ConfigDict(extra="forbid", populate_by_name=True)

    id: str
    source_id: str | None = Field(default=None, alias="sourceId")
    owner_id: str = Field(alias="ownerId")
    name: str
    subject: str
    description: str | None = None
    version: str
    visibility: str
    revision: int = Field(ge=1)
    question_count: int = Field(alias="questionCount", ge=0)
    access_mode: str = Field(alias="accessMode")
    created_by: str | None = Field(default=None, alias="createdBy")
    updated_by: str | None = Field(default=None, alias="updatedBy")
    created_at: str | None = Field(default=None, alias="createdAt")
    updated_at: str | None = Field(default=None, alias="updatedAt")


class CatalogBankListResponse(BaseModel):
    banks: list[CatalogBankPayload]


class CatalogQuestionListResponse(BaseModel):
    model_config = ConfigDict(populate_by_name=True)

    questions: list[CatalogQuestionPayload]
    total: int = Field(ge=0)
    page: int = Field(ge=1)
    page_size: int = Field(alias="pageSize", ge=1)


class CatalogQuestionResponse(BaseModel):
    question: CatalogQuestionPayload


class TeachingContentChangePayload(BaseModel):
    model_config = ConfigDict(extra="forbid", populate_by_name=True)

    entity_type: str = Field(alias="entityType", min_length=1)
    entity_id: str = Field(alias="entityId", min_length=1)
    action: str = Field(min_length=1)


class TeachingContentRevisionResponse(BaseModel):
    model_config = ConfigDict(extra="forbid", populate_by_name=True)

    revision: int = Field(ge=0)
    changes: list[TeachingContentChangePayload] = Field(max_length=100)
    updated_at: str | None = Field(alias="updatedAt")
    updated_by: str | None = Field(alias="updatedBy")


class CatalogBootstrapResponse(BaseModel):
    model_config = ConfigDict(populate_by_name=True)

    banks: list[CatalogBankPayload]
    questions: list[CatalogQuestionPayload] = Field(default_factory=list)
    catalog_revision: str = Field(alias="catalogRevision", min_length=64, max_length=64)
    content_revision: int = Field(alias="contentRevision", ge=0)
