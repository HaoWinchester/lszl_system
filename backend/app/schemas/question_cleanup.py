"""Serializable contracts for safe shared-question cleanup reporting."""

from __future__ import annotations

from datetime import datetime
from typing import Annotated, Literal

from pydantic import BaseModel, ConfigDict, Field, StringConstraints, field_validator


QuestionCleanupDecisionValue = Literal[
    "keep_formal_import",
    "delete_explicit_test",
    "delete_non_imported",
    "review",
]

Sha256Hex = Annotated[str, StringConstraints(pattern=r"^[0-9a-f]{64}$")]
EvidenceCode = Annotated[
    str,
    StringConstraints(strip_whitespace=True, min_length=1, max_length=200),
]
ReferenceId = Annotated[
    str,
    StringConstraints(strip_whitespace=True, min_length=1, max_length=256),
]


class QuestionCleanupDecision(BaseModel):
    """One deterministic classification result for a live question row."""

    model_config = ConfigDict(extra="forbid", populate_by_name=True)

    question_id: str = Field(alias="questionId", min_length=1, max_length=64)
    decision: QuestionCleanupDecisionValue
    evidence_codes: list[EvidenceCode] = Field(
        alias="evidenceCodes",
        min_length=1,
    )
    source_fingerprint: Sha256Hex = Field(alias="sourceFingerprint")
    affected_reference_ids: list[ReferenceId] = Field(
        default_factory=list,
        alias="affectedReferenceIds",
    )

    @field_validator("evidence_codes", "affected_reference_ids")
    @classmethod
    def _sort_stable_codes(cls, values: list[str]) -> list[str]:
        return sorted(set(values))


QuestionCleanupRepairAction = Literal[
    "remove_question_and_recalculate",
    "preserve_historical_snapshot",
]


class QuestionCleanupReference(BaseModel):
    """One deterministic relational or shared-runtime question reference."""

    model_config = ConfigDict(extra="forbid", populate_by_name=True)

    reference_id: Sha256Hex = Field(alias="referenceId")
    container_type: str = Field(alias="containerType", min_length=1, max_length=80)
    container_id: str = Field(alias="containerId", min_length=1, max_length=256)
    question_id: str = Field(alias="questionId", min_length=1, max_length=64)
    repair_action: QuestionCleanupRepairAction = Field(alias="repairAction")
    storage_key: str | None = Field(
        default=None,
        alias="storageKey",
        min_length=1,
        max_length=120,
    )
    reference_path: str | None = Field(
        default=None,
        alias="referencePath",
        min_length=1,
        max_length=1000,
    )


class QuestionCleanupSummary(BaseModel):
    model_config = ConfigDict(extra="forbid", populate_by_name=True)

    total_count: int = Field(alias="totalCount", ge=0)
    keep_count: int = Field(alias="keepCount", ge=0)
    delete_count: int = Field(alias="deleteCount", ge=0)
    review_count: int = Field(alias="reviewCount", ge=0)
    reference_count: int = Field(alias="referenceCount", ge=0)
    repair_reference_count: int = Field(alias="repairReferenceCount", ge=0)
    preserved_reference_count: int = Field(alias="preservedReferenceCount", ge=0)


class QuestionCleanupReport(BaseModel):
    """Content-addressed, read-only cleanup inventory."""

    model_config = ConfigDict(extra="forbid", populate_by_name=True)

    policy_version: Literal["question-cleanup-v1"] = Field(alias="policyVersion")
    generated_at: datetime = Field(alias="generatedAt")
    summary: QuestionCleanupSummary
    keep: list[QuestionCleanupDecision] = Field(default_factory=list)
    delete: list[QuestionCleanupDecision] = Field(default_factory=list)
    review: list[QuestionCleanupDecision] = Field(default_factory=list)
    references: list[QuestionCleanupReference] = Field(default_factory=list)
    snapshot_hash: Sha256Hex = Field(alias="snapshotHash")
    manifest_hash: Sha256Hex = Field(alias="manifestHash")
