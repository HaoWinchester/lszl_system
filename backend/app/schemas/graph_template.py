from pydantic import BaseModel, ConfigDict, Field

class PublicationInput(BaseModel):
    model_config = ConfigDict(extra='forbid', populate_by_name=True)
    source_file_id: str = Field(alias='sourceFileId', min_length=1, max_length=64)
    expected_file_revision: int = Field(alias='expectedFileRevision', ge=1)
    name: str = Field(min_length=1, max_length=200)
    description: str = Field(default='', max_length=3000)
    member_only: bool = Field(default=False, alias='memberOnly')

class ListingInput(BaseModel):
    model_config = ConfigDict(extra='forbid')
    listed: bool

class LoadInput(BaseModel):
    model_config = ConfigDict(extra='forbid', populate_by_name=True)
    request_id: str = Field(alias='requestId', min_length=1, max_length=128)
    version: int = Field(ge=1)
