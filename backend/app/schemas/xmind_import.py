"""Multipart confirmation metadata; document bytes are independently bounded."""
from pydantic import BaseModel, Field

MAX_IMPORT_WARNINGS = 2048
# SHA-prefix IDs are at most22 ASCII chars, plus JSON quotes/separators.
MAX_ACCEPTED_WARNINGS_BYTES = MAX_IMPORT_WARNINGS * 32 + 2

class XMindConfirmation(BaseModel):
    sheetIds: list[str] = Field(min_length=1, max_length=100)
    acceptedWarnings: list[str] = Field(default_factory=list, max_length=MAX_IMPORT_WARNINGS)
