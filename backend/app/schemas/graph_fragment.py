"""Trusted cross-file graph fragment paste. Client authorization fields are forbidden."""
from pydantic import BaseModel, ConfigDict, Field, model_validator

FRAGMENT_FORMAT = 'kg-graph-fragment'
FRAGMENT_VERSION = 1
# Same provisional limits as new-legacy/src/graph/graph-fragment.js.
FRAGMENT_LIMITS = {'nodes': 2500, 'links': 5000, 'elements': 1500, 'tables': 2500}


class FragmentSource(BaseModel):
    model_config = ConfigDict(extra='forbid')
    file_id: str | None = Field(None, alias='fileId')
    node_ids: list[str] = Field(default_factory=list, alias='nodeIds')
    revision: int | None = None


class FragmentItem(BaseModel):
    model_config = ConfigDict(extra='allow')
    id: str


class GraphFragmentInput(BaseModel):
    model_config = ConfigDict(extra='forbid')
    format: str
    version: int
    nodes: list[FragmentItem]
    links: list[FragmentItem]
    elements: list[FragmentItem]
    tables: list[FragmentItem]
    resources: list[dict] = Field(default_factory=list)
    source: FragmentSource

    @model_validator(mode='after')
    def check_contract(self):
        if self.format != FRAGMENT_FORMAT or self.version != FRAGMENT_VERSION:
            raise ValueError('unsupported fragment format')
        node_ids = {n.id for n in self.nodes}
        for key, limit in FRAGMENT_LIMITS.items():
            items = getattr(self, key)
            if len(items) > limit:
                raise ValueError(f'fragment {key} exceed limit')
            ids: set[str] = set()
            for item in items:
                if not item.id or item.id in ids:
                    raise ValueError('duplicate or empty fragment id')
                ids.add(item.id)
        for link in self.links:
            extra = link.model_extra or {}
            # 空字符串端点表示自由端点（fromPoint/toPoint），仅校验非空引用。
            for endpoint in ('from', 'to'):
                value = extra.get(endpoint)
                if value and value not in node_ids:
                    raise ValueError('fragment link references external node')
        return self


class FragmentPasteInput(BaseModel):
    model_config = ConfigDict(extra='forbid')
    fragment: GraphFragmentInput
    offset: dict | None = None
    expected_file_revision: int | None = Field(None, alias='expectedFileRevision')
