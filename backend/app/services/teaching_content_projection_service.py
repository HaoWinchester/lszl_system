"""Bidirectional projections for browser principle and synthesis repositories."""

from __future__ import annotations

import json
from typing import Any

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.content_prep import Principle, SynthesisPreset
from app.models.question import Question
from app.models.shared_runtime_state import SharedRuntimeState
from app.services import teaching_content_revision_service


PRINCIPLE_KEY = "kg_principle_repository_v1"
PRESET_KEY = "kg_synthesis_preset_repository_v1"
PROJECTION_KEYS = frozenset({PRINCIPLE_KEY, PRESET_KEY})
MAX_PROJECTION_ITEMS = 500
MAX_PROJECTION_BYTES = 2 * 1024 * 1024
MAX_ID_LENGTH = 128
MAX_PRINCIPLE_NAME_LENGTH = 300
MAX_PRESET_TITLE_LENGTH = 500
MAX_BUSINESS_VERSION = 2_147_483_647


class PrincipleArchiveConflict(RuntimeError):
    def __init__(self, reference_counts: dict[str, int]):
        super().__init__("原则仍被题目引用")
        self.reference_counts = reference_counts


def _milliseconds(value: object) -> int:
    return int(value.timestamp() * 1000) if value is not None else 0


def _principle_item(row: Principle) -> dict[str, Any]:
    return {
        "id": row.id,
        "name": row.name,
        "status": row.status,
        "confusablePrincipleIds": list(row.confusable_principle_ids or []),
        "createdAt": _milliseconds(row.created_at),
        "updatedAt": _milliseconds(row.updated_at),
    }


def _preset_item(row: SynthesisPreset) -> dict[str, Any]:
    return {
        "id": row.id,
        "principleId": row.principle_id,
        "title": row.title,
        "content": row.content,
        "status": row.status,
        "version": row.business_version,
        "createdAt": _milliseconds(row.created_at),
        "updatedAt": _milliseconds(row.updated_at),
    }


def _payload(items: list[dict[str, Any]]) -> dict[str, Any]:
    return {
        "schemaVersion": 1,
        "items": items,
        "updatedAt": max((int(item["updatedAt"]) for item in items), default=0),
    }


def _normalized_ids(values: object) -> list[str]:
    if not isinstance(values, list):
        return []
    return list(
        dict.fromkeys(
            str(value).strip()
            for value in values
            if str(value or "").strip()
        )
    )


def _question_principle_ids(metadata: object) -> set[str]:
    if not isinstance(metadata, dict):
        return set()
    ids = set(_normalized_ids(metadata.get("stemPrincipleIds")))
    ids.update(_normalized_ids(metadata.get("principleIds")))
    option_map = metadata.get("optionPrincipleMap")
    if isinstance(option_map, dict):
        for value in option_map.values():
            ids.update(_normalized_ids(value))
    return ids


async def _write_row(
    db: AsyncSession,
    key: str,
    payload: dict[str, Any],
    actor_username: str,
) -> None:
    value = json.dumps(payload, ensure_ascii=False, separators=(",", ":"))
    row = await db.get(SharedRuntimeState, key)
    if row is None:
        db.add(
            SharedRuntimeState(
                key=key,
                value=value,
                updated_by=actor_username,
            )
        )
    else:
        row.value = value
        row.updated_by = actor_username


async def write_principle_projection(
    db: AsyncSession,
    actor_username: str,
) -> None:
    """Rewrite both shared browser repositories from canonical relational rows."""

    await db.flush()
    principles = (
        await db.execute(select(Principle).order_by(Principle.id))
    ).scalars().all()
    presets = (
        await db.execute(select(SynthesisPreset).order_by(SynthesisPreset.id))
    ).scalars().all()
    await _write_row(
        db,
        PRINCIPLE_KEY,
        _payload([_principle_item(row) for row in principles]),
        actor_username,
    )
    await _write_row(
        db,
        PRESET_KEY,
        _payload([_preset_item(row) for row in presets]),
        actor_username,
    )
    await db.flush()


async def projection_rows_present(db: AsyncSession) -> bool:
    keys = set(
        (
            await db.execute(
                select(SharedRuntimeState.key).where(
                    SharedRuntimeState.key.in_(PROJECTION_KEYS)
                )
            )
        ).scalars().all()
    )
    return keys == PROJECTION_KEYS


def validate_projection_container(
    key: str,
    payload: dict[str, Any],
) -> dict[str, Any]:
    if not payload:
        return {}
    try:
        encoded = json.dumps(
            payload,
            ensure_ascii=False,
            separators=(",", ":"),
        ).encode("utf-8")
    except (TypeError, ValueError) as exc:
        raise ValueError("原则投影必须是可序列化 JSON") from exc
    if len(encoded) > MAX_PROJECTION_BYTES:
        raise ValueError("原则投影超过大小限制")
    raw_items = payload.get("items")
    if not isinstance(raw_items, list):
        raise ValueError("原则投影必须包含 items 数组")
    if len(raw_items) > MAX_PROJECTION_ITEMS:
        raise ValueError("原则投影 items 超过数量限制")
    if key not in PROJECTION_KEYS:
        raise ValueError(f"不是原则投影键：{key}")
    schema_version = payload.get("schemaVersion", 1)
    if type(schema_version) is not int or schema_version != 1:
        raise ValueError("原则投影 schemaVersion 必须严格为 1")

    items: list[dict[str, Any]] = []
    seen: set[str] = set()
    for raw in raw_items:
        if not isinstance(raw, dict):
            raise ValueError("原则投影 items 只能包含对象")
        row_id = raw.get("id")
        if not isinstance(row_id, str):
            raise ValueError("原则投影 ID 必须是字符串")
        row_id = row_id.strip()
        if not row_id or row_id in seen:
            raise ValueError("原则投影 ID 不能为空或重复")
        if len(row_id) > MAX_ID_LENGTH:
            raise ValueError("原则投影 ID 超过长度限制")
        seen.add(row_id)

        if key == PRINCIPLE_KEY:
            name = raw.get("name", raw.get("title", ""))
            if not isinstance(name, str) or len(name.strip()) > MAX_PRINCIPLE_NAME_LENGTH:
                raise ValueError("原则名称格式不正确或超过长度限制")
            confusable = raw.get("confusablePrincipleIds", [])
            if not isinstance(confusable, list):
                raise ValueError("confusablePrincipleIds 必须是数组")
            if any(
                not isinstance(value, str)
                or not value.strip()
                or len(value.strip()) > MAX_ID_LENGTH
                for value in confusable
            ):
                raise ValueError("易混淆原则 ID 格式不正确或超过长度限制")
            status = raw.get("status", "active")
            if not isinstance(status, str) or status not in {"active", "inactive"}:
                raise ValueError("原则 status 必须是 active 或 inactive")
            normalized = {
                **raw,
                "id": row_id,
                "name": name.strip(),
                "status": status,
                "confusablePrincipleIds": list(
                    dict.fromkeys(value.strip() for value in confusable)
                ),
            }
        else:
            principle_id = raw.get("principleId")
            if (
                not isinstance(principle_id, str)
                or not principle_id.strip()
                or len(principle_id.strip()) > MAX_ID_LENGTH
            ):
                raise ValueError("归纳预设必须引用有效原则 ID")
            title = raw.get("title", "")
            if not isinstance(title, str) or len(title.strip()) > MAX_PRESET_TITLE_LENGTH:
                raise ValueError("归纳预设标题格式不正确或超过长度限制")
            content = raw.get("content", raw.get("description", ""))
            if not isinstance(content, str):
                raise ValueError("归纳预设 content 必须是字符串")
            status = raw.get("status", "draft")
            if (
                not isinstance(status, str)
                or status not in {"draft", "active", "inactive"}
            ):
                raise ValueError("归纳预设 status 格式不正确")
            version = raw.get("version", 1)
            if (
                type(version) is not int
                or version < 1
                or version > MAX_BUSINESS_VERSION
            ):
                raise ValueError("归纳预设 version 必须是有限正整数")
            normalized = {
                **raw,
                "id": row_id,
                "principleId": principle_id.strip(),
                "title": title.strip(),
                "content": content.strip(),
                "status": status,
                "version": version,
            }
        items.append(normalized)
    return {**payload, "schemaVersion": 1, "items": items}


def validate_projection_value(key: str, value: str) -> list[dict[str, Any]]:
    if len(value.encode("utf-8")) > MAX_PROJECTION_BYTES:
        raise ValueError("原则投影超过大小限制")
    try:
        payload = json.loads(value or "")
    except (TypeError, ValueError, json.JSONDecodeError) as exc:
        raise ValueError("原则投影必须是有效 JSON") from exc
    if not isinstance(payload, dict):
        raise ValueError("原则投影必须是 JSON 对象")
    if not payload:
        raise ValueError("运行时原则投影不能使用省略占位符 {}")
    return validate_projection_container(key, payload).get("items", [])


async def _apply_principles(
    db: AsyncSession,
    actor_username: str,
    items: list[dict[str, Any]],
) -> list[dict[str, str]]:
    rows = (
        await db.execute(select(Principle).order_by(Principle.id).with_for_update())
    ).scalars().all()
    existing = {row.id: row for row in rows}
    incoming_ids = {str(item["id"]).strip() for item in items}
    changes: list[dict[str, str]] = []
    for item in items:
        row_id = str(item["id"]).strip()
        values = {
            "name": str(item.get("name") or item.get("title") or "未命名原则").strip()
            or "未命名原则",
            "status": "inactive"
            if str(item.get("status") or "active") == "inactive"
            else "active",
            "confusable_principle_ids": list(
                dict.fromkeys(
                    str(value).strip()
                    for value in (item.get("confusablePrincipleIds") or [])
                    if str(value).strip()
                )
            ),
        }
        row = existing.get(row_id)
        if row is None:
            db.add(
                Principle(
                    id=row_id,
                    **values,
                    revision=1,
                    created_by=actor_username,
                    updated_by=actor_username,
                )
            )
            changes.append(
                {"entityType": "principle", "entityId": row_id, "action": "created"}
            )
        elif any(getattr(row, key) != value for key, value in values.items()):
            for key, value in values.items():
                setattr(row, key, value)
            row.revision += 1
            row.updated_by = actor_username
            changes.append(
                {"entityType": "principle", "entityId": row_id, "action": "updated"}
            )
    for row in rows:
        if row.id not in incoming_ids and row.status != "inactive":
            row.status = "inactive"
            row.revision += 1
            row.updated_by = actor_username
            changes.append(
                {"entityType": "principle", "entityId": row.id, "action": "inactivated"}
            )
    return changes


async def _apply_presets(
    db: AsyncSession,
    actor_username: str,
    items: list[dict[str, Any]],
) -> list[dict[str, str]]:
    rows = (
        await db.execute(
            select(SynthesisPreset).order_by(SynthesisPreset.id).with_for_update()
        )
    ).scalars().all()
    existing = {row.id: row for row in rows}
    incoming_ids = {str(item["id"]).strip() for item in items}
    referenced_principle_ids = {
        str(item["principleId"]).strip() for item in items
    }
    existing_principle_ids = set(
        (
            await db.execute(
                select(Principle.id).where(
                    Principle.id.in_(referenced_principle_ids)
                )
            )
        ).scalars().all()
    ) if referenced_principle_ids else set()
    missing_principle_ids = referenced_principle_ids - existing_principle_ids
    if missing_principle_ids:
        raise ValueError(
            f"归纳预设引用的原则不存在：{sorted(missing_principle_ids)[0]}"
        )
    changes: list[dict[str, str]] = []
    for item in items:
        row_id = str(item["id"]).strip()
        values = {
            "principle_id": str(item.get("principleId") or "").strip(),
            "title": str(item.get("title") or "").strip(),
            "content": str(item.get("content") or item.get("description") or "").strip(),
            "status": str(item.get("status") or "draft")
            if str(item.get("status") or "draft") in {"draft", "active", "inactive"}
            else "draft",
            "business_version": max(1, int(item.get("version") or 1)),
        }
        if not values["principle_id"]:
            raise ValueError("归纳预设必须引用原则")
        row = existing.get(row_id)
        if row is None:
            db.add(
                SynthesisPreset(
                    id=row_id,
                    **values,
                    revision=1,
                    created_by=actor_username,
                    updated_by=actor_username,
                )
            )
            changes.append(
                {
                    "entityType": "synthesisPreset",
                    "entityId": row_id,
                    "action": "created",
                }
            )
        elif any(getattr(row, key) != value for key, value in values.items()):
            for key, value in values.items():
                setattr(row, key, value)
            row.revision += 1
            row.updated_by = actor_username
            changes.append(
                {
                    "entityType": "synthesisPreset",
                    "entityId": row_id,
                    "action": "updated",
                }
            )
    for row in rows:
        if row.id not in incoming_ids and row.status != "inactive":
            row.status = "inactive"
            row.revision += 1
            row.updated_by = actor_username
            changes.append(
                {
                    "entityType": "synthesisPreset",
                    "entityId": row.id,
                    "action": "inactivated",
                }
            )
    return changes


async def apply_principle_projection(
    db: AsyncSession,
    actor_username: str,
    key: str,
    value: str,
) -> list[dict[str, str]]:
    """Apply one browser projection to canonical rows without hard deletion."""

    items = validate_projection_value(key, value)
    if key == PRINCIPLE_KEY:
        changes = await _apply_principles(db, actor_username, items)
    elif key == PRESET_KEY:
        changes = await _apply_presets(db, actor_username, items)
    else:
        raise ValueError(f"不是原则投影键：{key}")
    await db.flush()
    return changes


async def archive_principles(
    db: AsyncSession,
    actor_username: str,
    principle_ids: object,
) -> dict[str, Any]:
    """Archive unreferenced principles and their paired synthesis presets atomically."""

    ids = _normalized_ids(principle_ids)
    if not ids:
        raise ValueError("至少选择一条原则")

    await teaching_content_revision_service.acquire_lock(db)
    principles = (
        await db.execute(
            select(Principle)
            .where(Principle.id.in_(ids))
            .with_for_update()
        )
    ).scalars().all()
    found_ids = {principle.id for principle in principles}
    missing_ids = [principle_id for principle_id in ids if principle_id not in found_ids]
    if missing_ids:
        raise ValueError(f"原则不存在：{missing_ids[0]}")

    reference_counts = {principle_id: 0 for principle_id in ids}
    question_rows = (
        await db.execute(select(Question.id, Question.content_metadata))
    ).all()
    selected_ids = set(ids)
    for _, metadata in question_rows:
        for principle_id in _question_principle_ids(metadata) & selected_ids:
            reference_counts[principle_id] += 1
    referenced = {
        principle_id: count
        for principle_id, count in reference_counts.items()
        if count
    }
    if referenced:
        raise PrincipleArchiveConflict(referenced)

    changes: list[dict[str, str]] = []
    for principle in principles:
        if principle.status != "inactive":
            principle.status = "inactive"
            principle.revision += 1
            principle.updated_by = actor_username
            changes.append(
                {
                    "entityType": "principle",
                    "entityId": principle.id,
                    "action": "archived",
                }
            )

    presets = (
        await db.execute(
            select(SynthesisPreset)
            .where(SynthesisPreset.principle_id.in_(ids))
            .with_for_update()
        )
    ).scalars().all()
    for preset in presets:
        if preset.status != "inactive":
            preset.status = "inactive"
            preset.revision += 1
            preset.updated_by = actor_username
            changes.append(
                {
                    "entityType": "synthesisPreset",
                    "entityId": preset.id,
                    "action": "archived",
                }
            )

    await write_principle_projection(db, actor_username)
    revision = await teaching_content_revision_service.bump(
        db,
        actor_username,
        changes,
    )
    await db.commit()
    return {
        "archivedIds": ids,
        "contentRevision": int(revision["revision"]),
    }


async def update_principle_statuses(
    db: AsyncSession,
    actor_username: str,
    principle_ids: object,
    *,
    principle_status: object = None,
    preset_status: object = None,
) -> dict[str, Any]:
    """Update selected principle and/or paired-preset statuses atomically."""

    ids = _normalized_ids(principle_ids)
    if not ids:
        raise ValueError("至少选择一条原则")
    normalized_principle_status = (
        str(principle_status).strip() if principle_status is not None else None
    )
    normalized_preset_status = (
        str(preset_status).strip() if preset_status is not None else None
    )
    if normalized_principle_status not in {None, "active", "inactive"}:
        raise ValueError("原则状态必须是 active 或 inactive")
    if normalized_preset_status not in {None, "draft", "active", "inactive"}:
        raise ValueError("归纳卡状态必须是 draft、active 或 inactive")
    if normalized_principle_status is None and normalized_preset_status is None:
        raise ValueError("至少提供一种状态修改")

    await teaching_content_revision_service.acquire_lock(db)
    principles = (
        await db.execute(
            select(Principle)
            .where(Principle.id.in_(ids))
            .with_for_update()
        )
    ).scalars().all()
    found_ids = {principle.id for principle in principles}
    missing_ids = [principle_id for principle_id in ids if principle_id not in found_ids]
    if missing_ids:
        raise ValueError(f"原则不存在：{missing_ids[0]}")

    changes: list[dict[str, str]] = []
    updated_principle_ids: list[str] = []
    if normalized_principle_status is not None:
        by_id = {principle.id: principle for principle in principles}
        for principle_id in ids:
            principle = by_id[principle_id]
            if principle.status != normalized_principle_status:
                principle.status = normalized_principle_status
                principle.revision += 1
                principle.updated_by = actor_username
                changes.append(
                    {
                        "entityType": "principle",
                        "entityId": principle.id,
                        "action": "status_updated",
                    }
                )
                updated_principle_ids.append(principle.id)

    updated_preset_ids: list[str] = []
    if normalized_preset_status is not None:
        presets = (
            await db.execute(
                select(SynthesisPreset)
                .where(SynthesisPreset.principle_id.in_(ids))
                .with_for_update()
            )
        ).scalars().all()
        for preset in presets:
            if preset.status != normalized_preset_status:
                preset.status = normalized_preset_status
                preset.revision += 1
                preset.updated_by = actor_username
                changes.append(
                    {
                        "entityType": "synthesisPreset",
                        "entityId": preset.id,
                        "action": "status_updated",
                    }
                )
                updated_preset_ids.append(preset.id)

    await write_principle_projection(db, actor_username)
    revision = await teaching_content_revision_service.bump(
        db,
        actor_username,
        changes,
    )
    await db.commit()
    return {
        "updatedPrincipleIds": updated_principle_ids,
        "updatedPresetIds": updated_preset_ids,
        "contentRevision": int(revision["revision"]),
    }
