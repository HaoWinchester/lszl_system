"""Server-authoritative subject facet schemas for Content Prep editors."""

from __future__ import annotations

from copy import deepcopy
from datetime import datetime
from typing import Any

from sqlalchemy import or_, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.subject_facet import SubjectFacetSchema
from app.models.user import User
from app.services import teaching_content_revision_service


_STATUSES = frozenset({"active", "inactive", "deprecated"})
_SELECTIONS = frozenset({"single", "multi"})
_MAX_DIMENSIONS = 200
_MAX_VALUES_PER_DIMENSION = 1000


class SubjectFacetValidationError(ValueError):
    """A display-safe validation error with a stable API code."""

    def __init__(self, code: str, message: str):
        super().__init__(message)
        self.code = code


class SubjectFacetRevisionConflict(RuntimeError):
    def __init__(self, current_revision: int):
        super().__init__("服务器内容已更新，请重新载入后再保存")
        self.current_revision = current_revision


def _error(code: str, message: str) -> None:
    raise SubjectFacetValidationError(code, message)


def _clean_text(value: object, *, label: str, maximum: int, required: bool = True) -> str:
    if not isinstance(value, str):
        if required:
            _error("INVALID_SUBJECT_FACET_SCHEMA", f"{label}必须是字符串")
        return ""
    cleaned = value.strip()
    if required and not cleaned:
        _error("INVALID_SUBJECT_FACET_SCHEMA", f"{label}不能为空")
    if len(cleaned) > maximum:
        _error("INVALID_SUBJECT_FACET_SCHEMA", f"{label}长度超过限制")
    return cleaned


def _unique_strings(value: object, *, label: str, maximum: int) -> list[str]:
    if value in (None, []):
        return []
    if not isinstance(value, list):
        _error("INVALID_SUBJECT_FACET_SCHEMA", f"{label}必须是数组")
    unique: dict[str, str] = {}
    for item in value:
        cleaned = _clean_text(item, label=label, maximum=maximum)
        unique.setdefault(cleaned.casefold(), cleaned)
    return sorted(unique.values(), key=lambda item: (item.casefold(), item))


def _status(value: object, *, label: str) -> str:
    if value in (None, ""):
        return "active"
    normalized = _clean_text(value, label=label, maximum=32)
    if normalized not in _STATUSES:
        _error("INVALID_SUBJECT_FACET_SCHEMA", f"{label}必须是 active、inactive 或 deprecated")
    return normalized


def _schema_subject_id(value: object) -> str:
    subject_id = _clean_text(value, label="科目 ID", maximum=128)
    return "subject-pmp" if subject_id.upper() == "PMP" else subject_id


def _value_rows(dimension: dict[str, Any], *, subject_id: str, dimension_id: str) -> list[dict[str, Any]]:
    raw_values = dimension.get("values", [])
    if not isinstance(raw_values, list) or not raw_values:
        _error("INVALID_SUBJECT_FACET_SCHEMA", "分类维度必须至少包含一个分类值")
    if len(raw_values) > _MAX_VALUES_PER_DIMENSION:
        _error("INVALID_SUBJECT_FACET_SCHEMA", "单个分类维度的值超过数量限制")

    values: list[dict[str, Any]] = []
    value_ids: set[str] = set()
    for raw_value in raw_values:
        if not isinstance(raw_value, dict):
            _error("INVALID_SUBJECT_FACET_SCHEMA", "分类值必须是对象")
        value_id = _clean_text(raw_value.get("id"), label="分类值 ID", maximum=128)
        # A stable rendered facet identity is scoped to its dimension.  Checking
        # the full identity rather than display labels allows identical labels in
        # different dimensions without weakening the ID invariant.
        facet_id = f"subject/{subject_id}/{dimension_id}/{value_id}"
        if facet_id in value_ids:
            _error("DUPLICATE_FACET_ID", f"分类值 ID 重复：{value_id}")
        value_ids.add(facet_id)
        values.append(
            {
                "id": value_id,
                "label": _clean_text(
                    raw_value.get("label", raw_value.get("name")),
                    label="分类值名称",
                    maximum=300,
                ),
                "status": _status(raw_value.get("status"), label="分类值状态"),
                "aliases": _unique_strings(
                    raw_value.get("aliases"), label="分类值别名", maximum=300
                ),
                "replacedBy": _unique_strings(
                    raw_value.get("replacedBy"), label="替代分类值", maximum=128
                ),
            }
        )

    known_ids = {item["id"] for item in values}
    replacements = {
        item["id"]: set(item["replacedBy"])
        for item in values
    }
    for value in values:
        invalid = sorted(set(value["replacedBy"]) - known_ids)
        if invalid:
            _error("INVALID_REPLACED_BY", f"替代分类值不存在：{invalid[0]}")
        if value["id"] in value["replacedBy"]:
            _error("INVALID_REPLACED_BY", "分类值不能替代自身")
        if value["status"] == "active" and value["replacedBy"]:
            _error("INVALID_REPLACED_BY", "只有停用或废弃分类值可以声明替代项")

    def _has_cycle(value_id: str, visiting: set[str], visited: set[str]) -> bool:
        if value_id in visiting:
            return True
        if value_id in visited:
            return False
        visiting.add(value_id)
        for replacement in replacements[value_id]:
            if _has_cycle(replacement, visiting, visited):
                return True
        visiting.remove(value_id)
        visited.add(value_id)
        return False

    visited: set[str] = set()
    for value_id in known_ids:
        if _has_cycle(value_id, set(), visited):
            _error("INVALID_REPLACED_BY", "替代分类值不能形成循环")
    return values


def canonical_schema(raw: object) -> dict[str, Any]:
    """Produce one safe, deterministic schema payload before persisting it."""

    if not isinstance(raw, dict):
        _error("INVALID_SUBJECT_FACET_SCHEMA", "Facet Schema 必须是对象")
    source = deepcopy(raw)
    schema_id = _clean_text(
        source.get("schemaId", source.get("id")), label="Schema ID", maximum=128
    )
    subject_id = _schema_subject_id(source.get("subjectId"))
    schema_version = source.get("schemaVersion", source.get("version", 1))
    if type(schema_version) is not int or schema_version < 1:
        _error("INVALID_SUBJECT_FACET_SCHEMA", "Schema 版本必须是正整数")
    raw_dimensions = source.get("dimensions", [])
    if not isinstance(raw_dimensions, list) or not raw_dimensions:
        _error("INVALID_SUBJECT_FACET_SCHEMA", "Facet Schema 必须至少包含一个分类维度")
    if len(raw_dimensions) > _MAX_DIMENSIONS:
        _error("INVALID_SUBJECT_FACET_SCHEMA", "分类维度超过数量限制")

    dimensions: list[dict[str, Any]] = []
    dimension_ids: set[str] = set()
    for raw_dimension in raw_dimensions:
        if not isinstance(raw_dimension, dict):
            _error("INVALID_SUBJECT_FACET_SCHEMA", "分类维度必须是对象")
        dimension_id = _clean_text(raw_dimension.get("id"), label="分类维度 ID", maximum=128)
        if dimension_id in dimension_ids:
            _error("DUPLICATE_FACET_ID", f"分类维度 ID 重复：{dimension_id}")
        dimension_ids.add(dimension_id)
        selection = raw_dimension.get("selection", "multi")
        if selection not in _SELECTIONS:
            _error("INVALID_SUBJECT_FACET_SCHEMA", "分类维度 selection 必须是 single 或 multi")
        dimensions.append(
            {
                "id": dimension_id,
                "label": _clean_text(
                    raw_dimension.get("label", raw_dimension.get("name")),
                    label="分类维度名称",
                    maximum=300,
                ),
                "selection": selection,
                "status": _status(raw_dimension.get("status"), label="分类维度状态"),
                "values": _value_rows(
                    raw_dimension, subject_id=subject_id, dimension_id=dimension_id
                ),
            }
        )

    return {
        "schema_id": schema_id,
        "subject_id": subject_id,
        "schema_version": schema_version,
        "name": _clean_text(source.get("name"), label="Schema 名称", maximum=300),
        "subject_codes": _unique_strings(
            source.get("subjectCodes"), label="科目识别代码", maximum=128
        ),
        "dimensions": dimensions,
        "status": _status(source.get("status"), label="Schema 状态"),
    }


def _row_dimensions(row: SubjectFacetSchema) -> dict[str, dict[str, Any]]:
    return {
        str(item.get("id")): item
        for item in row.dimensions
        if isinstance(item, dict) and isinstance(item.get("id"), str)
    }


def _preserve_historical_ids(existing: SubjectFacetSchema, candidate: dict[str, Any]) -> None:
    """Reject removals so question-level immutable facet snapshots stay valid."""

    next_dimensions = {item["id"]: item for item in candidate["dimensions"]}
    for dimension_id, previous_dimension in _row_dimensions(existing).items():
        next_dimension = next_dimensions.get(dimension_id)
        if next_dimension is None:
            _error(
                "FACET_DIMENSION_REMOVAL_FORBIDDEN",
                f"历史分类维度不能删除：{dimension_id}；请将它标记为 inactive 或 deprecated",
            )
        previous_values = {
            str(value.get("id"))
            for value in previous_dimension.get("values", [])
            if isinstance(value, dict) and isinstance(value.get("id"), str)
        }
        next_values = {value["id"] for value in next_dimension["values"]}
        removed = sorted(previous_values - next_values)
        if removed:
            _error(
                "FACET_VALUE_REMOVAL_FORBIDDEN",
                f"历史分类值不能删除：{removed[0]}；请将它标记为 inactive 或 deprecated",
            )


def _row_payload(row: SubjectFacetSchema) -> dict[str, Any]:
    def _timestamp(value: datetime | None) -> str | None:
        return value.isoformat() if value is not None else None

    return {
        "schemaId": row.schema_id,
        "schemaVersion": int(row.schema_version),
        "subjectId": row.subject_id,
        "subjectCodes": list(row.subject_codes or []),
        "name": row.name,
        "status": row.status,
        "dimensions": deepcopy(row.dimensions or []),
        "revision": int(row.revision),
        "createdBy": row.created_by,
        "updatedBy": row.updated_by,
        "createdAt": _timestamp(row.created_at),
        "updatedAt": _timestamp(row.updated_at),
    }


async def _current_content_revision(db: AsyncSession) -> int:
    return int((await teaching_content_revision_service.current(db))["revision"])


async def list_schemas(db: AsyncSession) -> dict[str, Any]:
    await teaching_content_revision_service.acquire_read_lock(db)
    rows = (
        await db.execute(
            select(SubjectFacetSchema).order_by(
                SubjectFacetSchema.subject_id, SubjectFacetSchema.schema_id
            )
        )
    ).scalars().all()
    return {
        "schemas": [_row_payload(row) for row in rows],
        "contentRevision": await _current_content_revision(db),
    }


async def upsert_schema(
    db: AsyncSession,
    actor: User,
    *,
    content_revision: int,
    schema: object,
) -> dict[str, Any]:
    candidate = canonical_schema(schema)
    await teaching_content_revision_service.acquire_lock(db)
    current_revision = await _current_content_revision(db)
    if content_revision != current_revision:
        raise SubjectFacetRevisionConflict(current_revision)

    matching_rows = (
        await db.execute(
            select(SubjectFacetSchema)
            .where(
                or_(
                    SubjectFacetSchema.schema_id == candidate["schema_id"],
                    SubjectFacetSchema.subject_id == candidate["subject_id"],
                )
            )
            .with_for_update()
        )
    ).scalars().all()
    by_schema_id = next(
        (row for row in matching_rows if row.schema_id == candidate["schema_id"]), None
    )
    by_subject_id = next(
        (row for row in matching_rows if row.subject_id == candidate["subject_id"]), None
    )
    if by_subject_id is not None and by_subject_id.schema_id != candidate["schema_id"]:
        _error("SCHEMA_ID_IMMUTABLE", "同一科目的 Schema ID 不能变更")
    if by_schema_id is not None and by_schema_id.subject_id != candidate["subject_id"]:
        _error("SCHEMA_SUBJECT_IMMUTABLE", "Schema ID 不能改到其他科目")
    existing = by_schema_id or by_subject_id

    fields = (
        "subject_id",
        "schema_version",
        "name",
        "subject_codes",
        "dimensions",
        "status",
    )
    if existing is not None:
        _preserve_historical_ids(existing, candidate)
        if candidate["schema_version"] < existing.schema_version:
            _error("SCHEMA_VERSION_REGRESSION", "Schema 版本不能回退")
        changed = any(getattr(existing, field) != candidate[field] for field in fields)
        if not changed:
            await db.commit()
            await db.refresh(existing)
            return {
                "schema": _row_payload(existing),
                "contentRevision": current_revision,
            }
        if candidate["schema_version"] <= existing.schema_version:
            candidate["schema_version"] = existing.schema_version + 1
        for field in fields:
            setattr(existing, field, candidate[field])
        existing.revision += 1
        existing.updated_by = actor.username
        row = existing
        action = "updated"
    else:
        row = SubjectFacetSchema(
            **candidate,
            revision=1,
            created_by=actor.username,
            updated_by=actor.username,
        )
        db.add(row)
        action = "created"

    await db.flush()
    revision = await teaching_content_revision_service.bump(
        db,
        actor.username,
        [
            {
                "entityType": "subjectFacetSchema",
                "entityId": row.schema_id,
                "action": action,
            }
        ],
    )
    await db.commit()
    await db.refresh(row)
    return {
        "schema": _row_payload(row),
        "contentRevision": int(revision["revision"]),
    }
