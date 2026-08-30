"""课程管理 API 的类型化输入模型。"""

from __future__ import annotations

import json
from typing import Any, Literal

from pydantic import BaseModel, ConfigDict, Field, field_validator, model_validator


MAX_JSON_BYTES = 2_000_000


def _bounded_json(value: dict[str, Any], *, label: str) -> dict[str, Any]:
    try:
        encoded = json.dumps(
            value,
            ensure_ascii=False,
            separators=(",", ":"),
            allow_nan=False,
        ).encode()
    except (TypeError, ValueError) as error:
        raise ValueError(f"{label} 必须是标准 JSON，且数字必须为有限值") from error
    if len(encoded) > MAX_JSON_BYTES:
        raise ValueError(f"{label} 不能超过 2MB")
    return value


class CourseDraftCreate(BaseModel):
    model_config = ConfigDict(populate_by_name=True, extra="forbid")

    name: str = Field(min_length=1, max_length=255)
    structure: dict[str, Any] = Field(default_factory=dict)

    @field_validator("structure")
    @classmethod
    def bound_structure(cls, value: dict[str, Any]) -> dict[str, Any]:
        return _bounded_json(value, label="structure")


class CourseDraftUpdate(BaseModel):
    model_config = ConfigDict(populate_by_name=True, extra="forbid")

    revision: int = Field(ge=1)
    name: str | None = Field(default=None, min_length=1, max_length=255)
    structure: dict[str, Any] | None = None
    status: Literal["draft", "archived"] | None = None

    @field_validator("structure")
    @classmethod
    def bound_structure(cls, value: dict[str, Any] | None) -> dict[str, Any] | None:
        return None if value is None else _bounded_json(value, label="structure")

    @model_validator(mode="after")
    def require_change(self) -> "CourseDraftUpdate":
        changed = self.model_fields_set - {"revision"}
        if not changed:
            raise ValueError("请至少提供一个草稿修改字段")
        if any(getattr(self, field) is None for field in changed):
            raise ValueError("草稿修改字段不能为 null")
        return self


class RevisionRequest(BaseModel):
    model_config = ConfigDict(populate_by_name=True, extra="forbid")

    revision: int = Field(ge=1)


class CoursePublishRequest(RevisionRequest):
    notes: str = Field(default="", max_length=20_000)


class LearningTaskCreate(BaseModel):
    model_config = ConfigDict(populate_by_name=True, extra="forbid")

    title: str = Field(min_length=1, max_length=255)
    description: str = Field(default="", max_length=100_000)
    release_id: str = Field(alias="releaseId", min_length=1, max_length=128)
    audience: dict[str, Any] = Field(default_factory=dict)
    content: dict[str, Any] = Field(default_factory=dict)
    status: Literal["draft", "published", "archived"] = "draft"

    @field_validator("audience", "content")
    @classmethod
    def bound_payload(cls, value: dict[str, Any], info) -> dict[str, Any]:
        return _bounded_json(value, label=info.field_name)


class LearningTaskUpdate(BaseModel):
    model_config = ConfigDict(populate_by_name=True, extra="forbid")

    revision: int = Field(ge=1)
    title: str | None = Field(default=None, min_length=1, max_length=255)
    description: str | None = Field(default=None, max_length=100_000)
    release_id: str | None = Field(
        default=None, alias="releaseId", min_length=1, max_length=128
    )
    audience: dict[str, Any] | None = None
    content: dict[str, Any] | None = None
    status: Literal["draft", "published", "archived"] | None = None

    @field_validator("audience", "content")
    @classmethod
    def bound_payload(
        cls, value: dict[str, Any] | None, info
    ) -> dict[str, Any] | None:
        return None if value is None else _bounded_json(value, label=info.field_name)

    @model_validator(mode="after")
    def require_change(self) -> "LearningTaskUpdate":
        changed = self.model_fields_set - {"revision"}
        if not changed:
            raise ValueError("请至少提供一个任务修改字段")
        if any(getattr(self, field) is None for field in changed):
            raise ValueError("任务修改字段不能为 null")
        return self
