"""Multipart confirmation metadata; document bytes are independently bounded."""
from pydantic import BaseModel, Field

class XMindConfirmation(BaseModel):
    sheetIds: list[str] = Field(min_length=1, max_length=100)
    acceptedWarnings: list[str] = Field(default_factory=list, max_length=200000)
