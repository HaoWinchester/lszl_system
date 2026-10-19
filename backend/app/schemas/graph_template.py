from pydantic import BaseModel, ConfigDict, Field, field_validator

class PublicationInput(BaseModel):
    model_config = ConfigDict(extra='forbid', populate_by_name=True)
    source_file_id: str = Field(alias='sourceFileId', min_length=1, max_length=64)
    expected_file_revision: int = Field(alias='expectedFileRevision', ge=1)
    name: str = Field(min_length=1, max_length=200)
    description: str = Field(default='', max_length=3000)
    member_only: bool = Field(default=False, alias='memberOnly')

    @field_validator('name', mode='before')
    @classmethod
    def trim_name(cls, value):
        return value.strip() if isinstance(value, str) else value

class ListingInput(BaseModel):
    model_config = ConfigDict(extra='forbid')
    listed: bool

class LoadInput(BaseModel):
    model_config = ConfigDict(extra='forbid', populate_by_name=True)
    request_id: str = Field(alias='requestId', min_length=1, max_length=128)
    version: int = Field(ge=1)
