"""用户相关请求/响应 schema。"""

from pydantic import BaseModel, Field


class UserCreate(BaseModel):
    username: str = Field(min_length=2, max_length=64)
    password: str = Field(min_length=4, max_length=128)
    role: str = "student"
    status: str | None = "active"
    display_name: str | None = None
    email: str | None = None
    phone: str | None = None
    subject: str | None = "PMP"
    tags: list[str] = Field(default_factory=list)
    note: str | None = None
    source: str | None = "user-management"


class UserUpdate(BaseModel):
    display_name: str | None = None
    email: str | None = None
    phone: str | None = None
    role: str | None = None
    status: str | None = None
    subject: str | None = None
    tags: list[str] | None = None
    note: str | None = None


class StatusUpdate(BaseModel):
    status: str  # active | paused | archived


class ResetPassword(BaseModel):
    new_password: str = Field(min_length=4, max_length=128)


class DuplicateUser(BaseModel):
    new_username: str = Field(min_length=2, max_length=64)
    new_password: str = Field(min_length=4, max_length=128)


class BatchUpdate(BaseModel):
    usernames: list[str]
    role: str | None = None        # KEEP 表示不变
    status: str | None = None
    subject: str | None = None


class BatchDelete(BaseModel):
    usernames: list[str]


class UserImportRecord(BaseModel):
    username: str = Field(min_length=2, max_length=64)
    role: str = "student"
    status: str = "active"
    display_name: str | None = Field(default=None, max_length=120)
    email: str | None = Field(default=None, max_length=120)
    phone: str | None = Field(default=None, max_length=40)
    subject: str | None = Field(default="PMP", max_length=32)
    tags: list[str] = Field(default_factory=list)
    note: str | None = None


class UserImport(BaseModel):
    users: list[UserImportRecord]
    initial_password: str = Field(min_length=4, max_length=128)
