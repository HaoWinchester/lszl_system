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
