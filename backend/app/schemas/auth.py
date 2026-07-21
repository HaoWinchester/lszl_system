"""认证请求 schema。"""

from pydantic import BaseModel, Field


class LoginRequest(BaseModel):
    username: str = Field(min_length=1, max_length=64)
    password: str = Field(min_length=1, max_length=128)


class RegisterRequest(BaseModel):
    username: str = Field(min_length=2, max_length=64)
    password: str = Field(min_length=4, max_length=128)
    display_name: str | None = None
    subject: str | None = "PMP"


class WechatLoginRequest(BaseModel):
    code: str = Field(min_length=1)
    state: str = Field(min_length=1)
