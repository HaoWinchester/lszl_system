from pydantic import BaseModel, Field


class SubjectWriteRequest(BaseModel):
    content_revision: int = Field(alias="contentRevision", ge=0)
    id: str = Field(min_length=1, max_length=128)
    code: str = Field(min_length=1, max_length=64)
    name: str = Field(min_length=1, max_length=160)
    metadata: dict = Field(default_factory=dict)


class TaxonomyReleaseRequest(BaseModel):
    content_revision: int = Field(alias="contentRevision", ge=0)
    subject_id: str = Field(alias="subjectId", min_length=1, max_length=128)
    version: int = Field(ge=1)
    title: str = Field(default="", max_length=240)
    nodes: list[dict] = Field(default_factory=list)


class RecallLibraryWriteRequest(BaseModel):
    content_revision: int = Field(alias="contentRevision", ge=0)
    version: int = Field(default=1, ge=1)
    nodes: list[dict] = Field(default_factory=list)
    edges: list[dict] = Field(default_factory=list)
    metadata: dict = Field(default_factory=dict)


class ActivityOverrideWriteRequest(BaseModel):
    content_revision: int = Field(alias="contentRevision", ge=0)
    record: dict = Field(default_factory=dict)
