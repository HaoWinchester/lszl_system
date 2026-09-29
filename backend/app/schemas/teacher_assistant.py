from pydantic import BaseModel, ConfigDict, Field
class MessageRequest(BaseModel):
    model_config=ConfigDict(extra='forbid')
    content: str=Field(min_length=1,max_length=10000)
    requestId: str=Field(min_length=8,max_length=80,pattern=r'^[\w-]+$')
class ExecuteRequest(BaseModel):
    model_config=ConfigDict(extra='forbid')
    revision: int=Field(ge=1)
    requestId: str=Field(min_length=8,max_length=80,pattern=r'^[\w-]+$')
class RetryRequest(BaseModel):
    requestId: str=Field(min_length=8,max_length=80,pattern=r'^[\w-]+$')


class QuickPhrase(BaseModel):
    model_config = ConfigDict(extra='forbid', str_strip_whitespace=True)
    title: str = Field(min_length=1, max_length=30)
    content: str = Field(min_length=1, max_length=2000)


class QuickPhrasesRequest(BaseModel):
    model_config = ConfigDict(extra='forbid')
    username: str = Field(min_length=1, max_length=64)
    custom: list[QuickPhrase] = Field(max_length=20)
