"""Shared material requests for standalone and atomic question editing."""
from typing import Literal
from pydantic import BaseModel, ConfigDict, Field

class MaterialInput(BaseModel):
    model_config = ConfigDict(extra='forbid')
    title: str = Field(min_length=1, max_length=200)
    text: str = Field(default='', max_length=100000)
    images: list[dict] = Field(default_factory=list, max_length=20)
    revision: int | None = Field(default=None, ge=1)

class MaterialEditInput(MaterialInput):
    id: str | None = Field(default=None, max_length=64)

class AssetInput(BaseModel):
    model_config = ConfigDict(extra='forbid', populate_by_name=True)
    filename: str = Field(min_length=1, max_length=200)
    mime_type: Literal['image/png','image/jpeg','image/webp'] = Field(alias='mimeType')
    data_base64: str = Field(alias='dataBase64', max_length=6990508)
    alt: str = Field(default='', max_length=1000)
