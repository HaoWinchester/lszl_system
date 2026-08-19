"""发布试卷 API 输入输出模型。"""

from typing import Any

from pydantic import BaseModel, ConfigDict, Field, field_validator


class PaperReleasePublishRequest(BaseModel):
    model_config = ConfigDict(populate_by_name=True, extra="forbid")

    revision: int = Field(ge=1)
    access_level: str = Field(default="free", alias="accessLevel", pattern="^(free|member)$")
    enabled_modes: list[str] = Field(default_factory=lambda: ["practice_mode"], alias="enabledModes", min_length=1)
    allowed_roles: list[str] = Field(default_factory=lambda: ["student"], alias="allowedRoles", min_length=1)
    metadata: dict[str, Any] = Field(default_factory=dict)

    @field_validator("metadata")
    @classmethod
    def limit_metadata_size(cls, value: dict[str, Any]) -> dict[str, Any]:
        import json

        if len(json.dumps(value, ensure_ascii=False, separators=(",", ":")).encode()) > 64_000:
            raise ValueError("metadata 不能超过 64KB")
        return value


class PaperReleaseWithdrawRequest(BaseModel):
    model_config = ConfigDict(populate_by_name=True, extra="forbid")

    revision: int = Field(ge=1)


class PaperReleaseResponse(BaseModel):
    model_config = ConfigDict(populate_by_name=True)

    release: dict[str, Any]
