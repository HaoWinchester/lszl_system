"""No client entitlement booleans or client-authored snapshots."""
from pydantic import BaseModel, ConfigDict, Field

class BindingInput(BaseModel):
    model_config = ConfigDict(extra='forbid', populate_by_name=True)
    expected_file_revision: int = Field(alias='expectedFileRevision', ge=1)
    question_ids: list[str] = Field(alias='questionIds', max_length=100)

class RevisionInput(BaseModel):
    model_config = ConfigDict(extra='forbid', populate_by_name=True)
    expected_file_revision: int = Field(alias='expectedFileRevision', ge=1)
    source_version: str = Field(alias='sourceVersion', min_length=1, max_length=64)

class AttemptInput(BaseModel):
    model_config = ConfigDict(extra='forbid', populate_by_name=True)
    source_version: str = Field(alias='sourceVersion', min_length=1, max_length=64)
    request_id: str = Field(alias='requestId', min_length=1, max_length=128)
    selected_option_ids: list[str] | None = Field(default=None, alias='selectedOptionIds', max_length=8)
    selected_pairs: dict[str, str] | None = Field(default=None, alias='selectedPairs')
