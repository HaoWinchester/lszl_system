"""Serializable contracts for safe shared-question cleanup classification."""

from __future__ import annotations

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
