"""Validated payloads for learner-owned personal synthesis cards."""

from typing import Literal

from pydantic import BaseModel, ConfigDict, Field, field_validator


class PersonalCardSourceQuestionRef(BaseModel):
    model_config = ConfigDict(extra="ignore", populate_by_name=True)

    question_id: str = Field(alias="questionId", min_length=1, max_length=64)
    bank_id: str = Field(default="", alias="bankId", max_length=64)
    paper_id: str = Field(default="", alias="paperId", max_length=64)
    release_id: str = Field(default="", alias="releaseId", max_length=128)
    title: str = Field(default="", max_length=500)


class PersonalCardCreate(BaseModel):
    model_config = ConfigDict(extra="forbid", populate_by_name=True)

    title: str = Field(min_length=1, max_length=200)
    synthesis_type: Literal["principle", "routine", "trap", "note"] = Field(alias="synthesisType")
    content: str = Field(default="", max_length=20000)
    tags: list[str] = Field(default_factory=list, max_length=24)
    status: Literal["draft", "verified", "mastered"] = "draft"
    source_question_refs: list[PersonalCardSourceQuestionRef] = Field(
        default_factory=list, alias="sourceQuestionRefs", max_length=200
    )

    @field_validator("title")
    @classmethod
    def title_must_not_be_blank(cls, value: str) -> str:
        normalized = value.strip()
        if not normalized:
            raise ValueError("归纳卡标题不能为空")
        return normalized


class PersonalCardUpdate(BaseModel):
    model_config = ConfigDict(extra="forbid", populate_by_name=True)

    title: str | None = Field(default=None, min_length=1, max_length=200)
    synthesis_type: Literal["principle", "routine", "trap", "note"] | None = Field(
        default=None, alias="synthesisType"
    )
    content: str | None = Field(default=None, max_length=20000)
    tags: list[str] | None = Field(default=None, max_length=24)
    status: Literal["draft", "verified", "mastered"] | None = None
    source_question_refs: list[PersonalCardSourceQuestionRef] | None = Field(
        default=None, alias="sourceQuestionRefs", max_length=200
    )
    revision: int = Field(ge=1)

    @field_validator("title")
    @classmethod
    def title_must_not_be_blank(cls, value: str | None) -> str | None:
        if value is None:
            return value
        normalized = value.strip()
        if not normalized:
            raise ValueError("归纳卡标题不能为空")
        return normalized
