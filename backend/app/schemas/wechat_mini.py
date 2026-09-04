"""Request and response contracts for native WeChat mini-program auth."""

from typing import Any, Literal

from pydantic import BaseModel, ConfigDict, Field


class MiniClientMetadata(BaseModel):
    model_config = ConfigDict(extra="ignore")

    platform: str | None = Field(default=None, max_length=32)
    model: str | None = Field(default=None, max_length=80)
    system: str | None = Field(default=None, max_length=80)
    version: str | None = Field(default=None, max_length=32)


class MiniWechatLoginRequest(BaseModel):
    code: str = Field(min_length=1, max_length=256)
    client: MiniClientMetadata = Field(default_factory=MiniClientMetadata)


class MiniBindRequest(BaseModel):
    binding_ticket: str = Field(alias="bindingTicket", min_length=16, max_length=512)
    username: str = Field(min_length=1, max_length=64)
    password: str = Field(min_length=1, max_length=128)
    accepted_terms_version: str | None = Field(
        default=None, alias="acceptedTermsVersion", max_length=32
    )
    client: MiniClientMetadata = Field(default_factory=MiniClientMetadata)


class MiniRegisterRequest(BaseModel):
    binding_ticket: str = Field(alias="bindingTicket", min_length=16, max_length=512)
    username: str = Field(min_length=2, max_length=64)
    password: str = Field(min_length=4, max_length=128)
    display_name: str | None = Field(default=None, alias="displayName", max_length=120)
    subject: str | None = Field(default="PMP", max_length=32)
    accepted_terms_version: str | None = Field(
        default=None, alias="acceptedTermsVersion", max_length=32
    )
    client: MiniClientMetadata = Field(default_factory=MiniClientMetadata)


class MiniSessionResponse(BaseModel):
    status: Literal["authenticated"] = "authenticated"
    token: str
    expires_at: str = Field(alias="expiresAt")
    login_session_id: str = Field(alias="loginSessionId")
    user: dict[str, Any]


class MiniBindingResponse(BaseModel):
    status: Literal["binding_required"] = "binding_required"
    binding_ticket: str = Field(alias="bindingTicket")
    expires_at: str = Field(alias="expiresAt")
