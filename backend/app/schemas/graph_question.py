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


class BatchPreviewInput(BaseModel):
    model_config = ConfigDict(extra='forbid', populate_by_name=True)
    subject: str | None = Field(default=None, min_length=1, max_length=32)
    expected_file_revision: int = Field(alias='expectedFileRevision', ge=1)
    node_ids: list[str] = Field(alias='nodeIds', min_length=1, max_length=500)
    count_per_card: int = Field(alias='countPerCard', ge=1, le=100, default=3)

class BatchCardSelection(BaseModel):
    model_config = ConfigDict(extra='forbid', populate_by_name=True)
    node_id: str = Field(alias='nodeId', min_length=1, max_length=128)
    question_ids: list[str] = Field(alias='questionIds', max_length=100)

class BatchApplyInput(BaseModel):
    model_config = ConfigDict(extra='forbid', populate_by_name=True)
    preview_token: str = Field(alias='previewToken', min_length=1, max_length=1000000)
    selections: list[BatchCardSelection] = Field(min_length=1, max_length=500)
