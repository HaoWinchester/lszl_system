"""Typed paper draft API contracts."""

from __future__ import annotations

from typing import Any, Literal

from pydantic import BaseModel, ConfigDict, Field, model_validator


class PaperReference(BaseModel):
    model_config = ConfigDict(populate_by_name=True, extra="forbid")

    bank_id: str = Field(alias="bankId", min_length=1, max_length=64)
    question_id: str = Field(alias="questionId", min_length=1, max_length=64)
    order: int = Field(ge=1)
    score: float = Field(default=1, ge=0, le=1_000_000)


class PaperCreateRequest(BaseModel):
    model_config = ConfigDict(populate_by_name=True, extra="forbid")

    name: str = Field(default="新试卷", min_length=1, max_length=200)
    subject: str = Field(default="PMP", min_length=1, max_length=32)
    description: str | None = None
    category_id: str | None = Field(default=None, alias="categoryId", max_length=64)
    total_count: int | None = Field(default=None, alias="totalCount", ge=0, le=10_000)
    quotas: dict[str, Any] = Field(default_factory=dict)
    access_policy: dict[str, Any] = Field(default_factory=dict, alias="accessPolicy")
    enabled_modes: list[str] = Field(default_factory=list, alias="enabledModes")
    mode_config_version: int = Field(default=2, alias="modeConfigVersion", ge=1)
    purpose: str = Field(default="learning", min_length=1, max_length=32)
    questions: list[PaperReference] = Field(default_factory=list)

    @model_validator(mode="after")
    def validate_question_sequence(self) -> "PaperCreateRequest":
        orders = [item.order for item in self.questions]
        question_ids = [item.question_id for item in self.questions]
        if orders != list(range(1, len(orders) + 1)):
            raise ValueError("questions.order 必须从 1 开始连续排列")
        if len(question_ids) != len(set(question_ids)):
            raise ValueError("同一试卷不能重复引用题目")
        if self.total_count is not None and self.total_count < len(self.questions):
            raise ValueError("totalCount 不能小于已选题目数量")
        return self


class PaperUpdateRequest(BaseModel):
    # Existing paper clients may still send server-owned audit fields.  Ignore
    # those values so they can never override the authenticated actor/owner.
    model_config = ConfigDict(populate_by_name=True, extra="ignore")

    revision: int | str | None = None
    name: str | None = Field(default=None, min_length=1, max_length=200)
    subject: str | None = Field(default=None, min_length=1, max_length=32)
    description: str | None = None
    category_id: str | None = Field(default=None, alias="categoryId", max_length=64)
    total_count: int | None = Field(default=None, alias="totalCount", ge=0, le=10_000)
    quotas: dict[str, Any] | None = None
    access_policy: dict[str, Any] | None = Field(default=None, alias="accessPolicy")
    enabled_modes: list[str] | None = Field(default=None, alias="enabledModes")
    mode_config_version: int | None = Field(default=None, alias="modeConfigVersion", ge=1)
    purpose: str | None = Field(default=None, min_length=1, max_length=32)


class PaperQuestionReplaceRequest(BaseModel):
    model_config = ConfigDict(populate_by_name=True, extra="forbid")

    revision: int = Field(ge=1)
    questions: list[PaperReference]

    @model_validator(mode="after")
    def validate_question_sequence(self) -> "PaperQuestionReplaceRequest":
        orders = [item.order for item in self.questions]
        question_ids = [item.question_id for item in self.questions]
        if orders != list(range(1, len(orders) + 1)):
            raise ValueError("questions.order 必须从 1 开始连续排列")
        if len(question_ids) != len(set(question_ids)):
            raise ValueError("同一试卷不能重复引用题目")
        return self


class PaperCategoryCreateRequest(BaseModel):
    model_config = ConfigDict(populate_by_name=True, extra="forbid")

    name: str = Field(min_length=1, max_length=200)
    description: str | None = None
    order_index: int = Field(default=0, alias="orderIndex", ge=0)


class PaperCategoryUpdateRequest(BaseModel):
    model_config = ConfigDict(populate_by_name=True, extra="forbid")

    revision: int = Field(ge=1)
    name: str | None = Field(default=None, min_length=1, max_length=200)
    description: str | None = None
    order_index: int | None = Field(default=None, alias="orderIndex", ge=0)


class PaperImportPreflightRequest(BaseModel):
    model_config = ConfigDict(populate_by_name=True, extra="forbid")

    file_name: str = Field(alias="fileName", min_length=1, max_length=500)
    package_data: dict[str, Any] = Field(alias="package")


class PaperImportRequest(PaperImportPreflightRequest):
    preflight_hash: str = Field(alias="preflightHash", min_length=64, max_length=64)
    conflict_action: Literal["create", "copy", "replace_draft"] = Field(
        alias="conflictAction"
    )
    expected_revision: int | str | None = Field(
        default=None,
        alias="expectedRevision",
    )
    idempotency_key: str = Field(
        alias="idempotencyKey",
        min_length=1,
        max_length=120,
    )


class PaperCompositionVariantRequest(BaseModel):
    model_config = ConfigDict(populate_by_name=True, extra="forbid")

    code: str = Field(min_length=1, max_length=16)
    name: str = Field(min_length=1, max_length=200)
    total_count: int = Field(alias="totalCount", ge=1, le=10_000)


class PaperCompositionQuotaRequest(BaseModel):
    model_config = ConfigDict(populate_by_name=True, extra="forbid")

    dimension_id: str = Field(alias="dimensionId", min_length=1, max_length=64)
    weights: dict[str, float]

    @model_validator(mode="after")
    def validate_weights(self) -> "PaperCompositionQuotaRequest":
        if not self.weights or any(
            not str(key).strip() or isinstance(value, bool) or value < 0
            for key, value in self.weights.items()
        ):
            raise ValueError("weights 必须包含非负数值")
        if not any(value > 0 for value in self.weights.values()):
            raise ValueError("weights 至少需要一个正数")
        return self


class PaperCompositionPreflightRequest(BaseModel):
    model_config = ConfigDict(populate_by_name=True, extra="forbid")

    subject: str = Field(default="PMP", min_length=1, max_length=32)
    bank_ids: list[str] = Field(alias="bankIds", min_length=1, max_length=200)
    filters: dict[str, Any] = Field(default_factory=dict)
    variants: list[PaperCompositionVariantRequest] = Field(
        min_length=1,
        max_length=10,
    )
    hard_quota: PaperCompositionQuotaRequest = Field(alias="hardQuota")
    soft_quota: PaperCompositionQuotaRequest | None = Field(
        default=None,
        alias="softQuota",
    )
    random_seed: str | None = Field(
        default=None,
        alias="randomSeed",
        max_length=128,
    )

    @model_validator(mode="after")
    def validate_composition_contract(self) -> "PaperCompositionPreflightRequest":
        normalized_banks = [item.strip() for item in self.bank_ids]
        if any(not item for item in normalized_banks):
            raise ValueError("bankIds 不能包含空值")
        if len(normalized_banks) != len(set(normalized_banks)):
            raise ValueError("bankIds 不能重复")
        codes = [item.code.strip() for item in self.variants]
        if len(codes) != len(set(codes)):
            raise ValueError("variants.code 不能重复")
        if self.hard_quota.dimension_id != "exam-domain":
            raise ValueError("hardQuota.dimensionId 必须是 exam-domain")
        if (
            self.soft_quota is not None
            and self.soft_quota.dimension_id != "performance-domain"
        ):
            raise ValueError("softQuota.dimensionId 必须是 performance-domain")
        return self


class PaperCompositionBatchRequest(PaperCompositionPreflightRequest):
    plan_hash: str = Field(alias="planHash", min_length=64, max_length=64)
    idempotency_key: str = Field(
        alias="idempotencyKey",
        min_length=1,
        max_length=120,
    )
