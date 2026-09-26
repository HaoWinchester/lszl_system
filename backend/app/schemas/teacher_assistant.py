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
