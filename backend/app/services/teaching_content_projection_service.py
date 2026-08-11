"""Bidirectional projections for browser principle and synthesis repositories."""

from __future__ import annotations

import json
from typing import Any

from sqlalchemy import delete, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.content_prep import Principle, SynthesisPreset
from app.models.question import Question, QuestionBank
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
    def __init__(self, reference_questions: dict[str, list[dict[str, Any]]]):
        super().__init__("原则仍被题目引用")
        self.reference_questions = {
            principle_id: list(reference_questions[principle_id])
            for principle_id in sorted(reference_questions)
            if reference_questions[principle_id]
        }
        self.reference_counts = {
            principle_id: len(rows)
            for principle_id, rows in self.reference_questions.items()
        }


def validate_principle_card_bundle(payload: object) -> dict[str, dict[str, Any]]:
    """Validate the portable one-principle-to-one-card configuration contract."""

    if not isinstance(payload, dict):
        raise ValueError("原则与归纳卡组合必须是 JSON 对象")
    bundle_version = payload.get("principleCardBundleVersion", 1)
    if type(bundle_version) is not int or bundle_version != 1:
        raise ValueError("原则与归纳卡组合版本必须是 1")
    bundle_format = payload.get("format")
    if bundle_format not in {None, "", "kg-principle-card-bundle-v1"}:
        raise ValueError("不是支持的原则与归纳卡组合文件")
    raw_principles = payload.get("principles") or payload.get("principleRepository")
    raw_presets = (
        payload.get("synthesisPresets")
        or payload.get("presets")
        or payload.get("synthesisPresetRepository")
    )
    if not isinstance(raw_principles, dict):
        raise ValueError("原则必须包含 items 数组")
    if not isinstance(raw_presets, dict):
        raise ValueError("归纳卡必须包含 items 数组")
    principles = validate_projection_container(PRINCIPLE_KEY, raw_principles)
    presets = validate_projection_container(PRESET_KEY, raw_presets)
    principle_names = {
        str(item["id"]): str(item["name"])
        for item in principles["items"]
    }
    seen_principle_ids: set[str] = set()
    normalized_presets: list[dict[str, Any]] = []
    for preset in presets["items"]:
        principle_id = str(preset["principleId"])
        if principle_id not in principle_names:
            raise ValueError(f"归纳卡引用了不存在的原则：{principle_id}")
        if principle_id in seen_principle_ids:
            raise ValueError(f"原则 {principle_id} 存在重复归纳卡")
        seen_principle_ids.add(principle_id)
        normalized_presets.append(
            {
                **preset,
                "title": f"原则：{principle_names[principle_id]}",
            }
        )
    for principle_id in principle_names:
        if principle_id not in seen_principle_ids:
            raise ValueError(f"原则 {principle_id} 缺少对应归纳卡")
    return {
        "principles": {**principles, "items": list(principles["items"])},
        "synthesisPresets": {**presets, "items": normalized_presets},
    }


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


async def principle_reference_questions(
    db: AsyncSession,
    principle_ids: object,
) -> dict[str, list[dict[str, str | None]]]:
    values = (
        list(principle_ids)
        if isinstance(principle_ids, (set, frozenset, tuple))
        else principle_ids
    )
    selected_ids = set(_normalized_ids(values))
    if not selected_ids:
        return {}
    grouped: dict[str, list[dict[str, str | None]]] = {
        principle_id: [] for principle_id in selected_ids
    }
    rows = (
        await db.execute(
            select(
                Question.id,
                Question.title,
                Question.teacher_number,
                Question.content_metadata,
                QuestionBank.id,
                QuestionBank.name,
            ).join(QuestionBank, QuestionBank.id == Question.bank_id)
        )
    ).all()
    for (
        question_id,
        question_title,
        teacher_number,
        metadata,
        bank_id,
        bank_name,
    ) in rows:
        reference = {
            "questionId": str(question_id),
            "questionTitle": str(question_title or "未命名题目"),
            "teacherNumber": str(teacher_number) if teacher_number else None,
            "bankId": str(bank_id),
            "bankName": str(bank_name or "未命名题库"),
        }
        for principle_id in _question_principle_ids(metadata) & selected_ids:
            grouped[principle_id].append(reference)
    return {
        principle_id: sorted(
            grouped[principle_id],
            key=lambda row: (
                str(row["bankName"]),
                str(row["questionTitle"]),
                str(row["questionId"]),
            ),
        )
        for principle_id in sorted(grouped)
        if grouped[principle_id]
    }


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


async def principle_card_bundle(db: AsyncSession) -> dict[str, Any]:
    """Read the canonical pair in the same envelope used by both UIs."""

    principles = (
        await db.execute(select(Principle).order_by(Principle.id))
    ).scalars().all()
    presets = (
        await db.execute(select(SynthesisPreset).order_by(SynthesisPreset.id))
    ).scalars().all()
    return {
        "principleCardBundleVersion": 1,
        "format": "kg-principle-card-bundle-v1",
        "principles": _payload([_principle_item(row) for row in principles]),
        "synthesisPresets": _payload([_preset_item(row) for row in presets]),
    }


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

    referenced = await principle_reference_questions(db, ids)
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


async def delete_principles(
    db: AsyncSession,
    actor_username: str,
    principle_ids: object,
) -> dict[str, Any]:
    """Hard-delete unused principle/card pairs and refresh the browser projection."""

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

    selected_ids = set(ids)
    referenced = await principle_reference_questions(db, ids)
    if referenced:
        raise PrincipleArchiveConflict(referenced)

    all_principles = (
        await db.execute(select(Principle).with_for_update())
    ).scalars().all()
    changes: list[dict[str, str]] = []
    for principle in all_principles:
        if principle.id in selected_ids:
            continue
        filtered = [
            value
            for value in (principle.confusable_principle_ids or [])
            if value not in selected_ids
        ]
        if filtered != list(principle.confusable_principle_ids or []):
            principle.confusable_principle_ids = filtered
            principle.revision += 1
            principle.updated_by = actor_username
            changes.append(
                {
                    "entityType": "principle",
                    "entityId": principle.id,
                    "action": "updated",
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
        changes.append(
            {
                "entityType": "synthesisPreset",
                "entityId": preset.id,
                "action": "deleted",
            }
        )
    for principle in principles:
        changes.append(
            {
                "entityType": "principle",
                "entityId": principle.id,
                "action": "deleted",
            }
        )
    # The models deliberately do not declare an ORM relationship. Issue the
    # dependent delete first so PostgreSQL's RESTRICT foreign key is honored.
    await db.execute(delete(SynthesisPreset).where(SynthesisPreset.id.in_([item.id for item in presets])))
    await db.execute(delete(Principle).where(Principle.id.in_(ids)))

    await write_principle_projection(db, actor_username)
    bundle = await principle_card_bundle(db)
    revision = await teaching_content_revision_service.bump(db, actor_username, changes)
    await db.commit()
    return {
        "deletedIds": ids,
        "contentRevision": int(revision["revision"]),
        **bundle,
    }


async def import_principle_card_bundle(
    db: AsyncSession,
    actor_username: str,
    payload: object,
) -> dict[str, Any]:
    """Replace the global principle/card configuration as one safe transaction."""

    bundle = validate_principle_card_bundle(payload)
    incoming_principles = list(bundle["principles"]["items"])
    incoming_presets = list(bundle["synthesisPresets"]["items"])
    incoming_principle_ids = {str(item["id"]) for item in incoming_principles}

    await teaching_content_revision_service.acquire_lock(db)
    existing_principles = (
        await db.execute(select(Principle).with_for_update())
    ).scalars().all()
    existing_by_principle_id = {row.id: row for row in existing_principles}
    removed_ids = set(existing_by_principle_id) - incoming_principle_ids

    if removed_ids:
        referenced = await principle_reference_questions(db, removed_ids)
        if referenced:
            raise PrincipleArchiveConflict(referenced)

    existing_presets = (
        await db.execute(select(SynthesisPreset).with_for_update())
    ).scalars().all()
    existing_preset_by_id = {row.id: row for row in existing_presets}
    existing_preset_by_principle_id = {
        row.principle_id: row for row in existing_presets
    }
    changes: list[dict[str, str]] = []

    for item in incoming_principles:
        principle_id = str(item["id"])
        values = {
            "name": str(item["name"]),
            "status": str(item["status"]),
            "confusable_principle_ids": list(item["confusablePrincipleIds"]),
        }
        row = existing_by_principle_id.get(principle_id)
        if row is None:
            db.add(
                Principle(
                    id=principle_id,
                    **values,
                    revision=1,
                    created_by=actor_username,
                    updated_by=actor_username,
                )
            )
            changes.append(
                {
                    "entityType": "principle",
                    "entityId": principle_id,
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
                    "entityType": "principle",
                    "entityId": principle_id,
                    "action": "updated",
                }
            )

    # Make newly added parents visible to the child foreign keys before cards.
    await db.flush()
    retained_preset_ids: set[str] = set()
    for item in incoming_presets:
        incoming_id = str(item["id"])
        principle_id = str(item["principleId"])
        direct_match = existing_preset_by_id.get(incoming_id)
        if direct_match is not None and direct_match.principle_id != principle_id:
            raise ValueError(f"归纳卡 ID 已绑定不同原则：{incoming_id}")
        row = direct_match or existing_preset_by_principle_id.get(principle_id)
        values = {
            "principle_id": principle_id,
            "title": str(item["title"]),
            "content": str(item["content"]),
            "status": str(item["status"]),
            "business_version": int(item["version"]),
        }
        if row is None:
            db.add(
                SynthesisPreset(
                    id=incoming_id,
                    **values,
                    revision=1,
                    created_by=actor_username,
                    updated_by=actor_username,
                )
            )
            retained_preset_ids.add(incoming_id)
            changes.append(
                {
                    "entityType": "synthesisPreset",
                    "entityId": incoming_id,
                    "action": "created",
                }
            )
        else:
            retained_preset_ids.add(row.id)
            if any(getattr(row, key) != value for key, value in values.items()):
                for key, value in values.items():
                    setattr(row, key, value)
                row.revision += 1
                row.updated_by = actor_username
                changes.append(
                    {
                        "entityType": "synthesisPreset",
                        "entityId": row.id,
                        "action": "updated",
                    }
                )

    preset_ids_to_delete: list[str] = []
    for preset in existing_presets:
        if preset.id not in retained_preset_ids:
            changes.append(
                {
                    "entityType": "synthesisPreset",
                    "entityId": preset.id,
                    "action": "deleted",
                }
            )
            preset_ids_to_delete.append(preset.id)
    principle_ids_to_delete: list[str] = []
    for principle in existing_principles:
        if principle.id not in incoming_principle_ids:
            changes.append(
                {
                    "entityType": "principle",
                    "entityId": principle.id,
                    "action": "deleted",
                }
            )
            principle_ids_to_delete.append(principle.id)

    if preset_ids_to_delete:
        await db.execute(
            delete(SynthesisPreset).where(SynthesisPreset.id.in_(preset_ids_to_delete))
        )
    if principle_ids_to_delete:
        await db.execute(
            delete(Principle).where(Principle.id.in_(principle_ids_to_delete))
        )

    await write_principle_projection(db, actor_username)
    canonical_bundle = await principle_card_bundle(db)
    revision = await teaching_content_revision_service.bump(db, actor_username, changes)
    await db.commit()
    return {
        "importedPrincipleCount": len(incoming_principles),
        "importedPresetCount": len(incoming_presets),
        "contentRevision": int(revision["revision"]),
        **canonical_bundle,
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
