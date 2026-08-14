"""Strict request contracts for database-backed Deep Recall sessions."""

from __future__ import annotations

import math
from typing import Any

from pydantic import BaseModel, ConfigDict, Field, model_validator


class RecallTransform(BaseModel):
    model_config = ConfigDict(extra="forbid")

    x: float = 0
    y: float = 0
    scale: float = Field(default=1, ge=0.2, le=4)

    @model_validator(mode="after")
    def finite_values(self) -> "RecallTransform":
        if not all(math.isfinite(value) for value in (self.x, self.y, self.scale)):
            raise ValueError("画布坐标必须是有限数值")
        return self


class RecallProgressSaveRequest(BaseModel):
    model_config = ConfigDict(extra="forbid", populate_by_name=True)

    expected_revision: int = Field(alias="expectedRevision", ge=0)
    question_revision: int = Field(alias="questionRevision", ge=1)
    library_hash: str = Field(alias="libraryHash", pattern=r"^[0-9a-f]{64}$")
    graph_schema_version: int = Field(alias="graphSchemaVersion", ge=1, le=10)
    nodes: list[dict[str, Any]] = Field(max_length=5000)
    edges: list[dict[str, Any]] = Field(max_length=20000)
    custom_nodes: dict[str, dict[str, Any]] = Field(
        default_factory=dict,
        alias="customNodes",
    )
    active_keywords: list[str] = Field(default_factory=list, alias="activeKeywords")
    choice_offsets: dict[str, Any] = Field(default_factory=dict, alias="choiceOffsets")
    transform: RecallTransform = Field(default_factory=RecallTransform)
    metrics: dict[str, Any] = Field(default_factory=dict)

    @model_validator(mode="after")
    def validate_graph(self) -> "RecallProgressSaveRequest":
        node_ids: list[str] = []
        for node in self.nodes:
            node_id = str(node.get("instanceId") or node.get("id") or "").strip()
            if not node_id:
                raise ValueError("每个回忆节点必须包含 instanceId")
            node_ids.append(node_id)
            if node.get("custom") is True:
                data_id = str(node.get("dataId") or "").strip()
                if not data_id.startswith("personal:"):
                    raise ValueError("个人节点 dataId 必须以 personal: 开头")
        if len(node_ids) != len(set(node_ids)):
            raise ValueError("回忆节点 instanceId 不能重复")

        known = set(node_ids)
        for edge in self.edges:
            source = str(edge.get("from") or "").strip()
            target = str(edge.get("to") or "").strip()
            if not source or not target or source not in known or target not in known:
                raise ValueError("回忆关系的 from/to 必须引用现有节点")
            if source == target:
                raise ValueError("回忆关系不能连接节点自身")

        for personal_id in self.custom_nodes:
            if not str(personal_id).startswith("personal:"):
                raise ValueError("个人节点 ID 必须以 personal: 开头")
        return self


class RecallProgressResetRequest(BaseModel):
    model_config = ConfigDict(extra="forbid", populate_by_name=True)

    expected_revision: int = Field(alias="expectedRevision", ge=0)
    target_question_revision: int = Field(alias="targetQuestionRevision", ge=1)
