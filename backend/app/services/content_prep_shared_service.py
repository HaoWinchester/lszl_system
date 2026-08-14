"""Server-authoritative shared assets for Content Prep and Question Studio."""

from __future__ import annotations

import json
from copy import deepcopy
from datetime import datetime, timezone
from typing import Any
from urllib.parse import quote

from sqlalchemy import delete, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.content_prep import Principle, QuestionTagConfig, SynthesisPreset
from app.models.shared_runtime_state import SharedRuntimeState
from app.models.user import User
from app.services import (
    content_prep_service,
    subject_facet_service,
    teaching_content_projection_service,
    teaching_content_revision_service,
)


TAXONOMY_KEY = "kg_content_taxonomies_v1"
ACTIVITY_KEY = "kg_content_activity_overrides_v1"
RECALL_PREFIX = "kg_recall_association_library_v1__subject__"
MAX_SHARED_BYTES = 2 * 1024 * 1024
MAX_ACTIVITIES = 5000


class ContentRevisionConflict(RuntimeError):
    def __init__(self, current_revision: int):
        super().__init__("服务器内容已更新，请重新载入后再保存")
        self.current_revision = current_revision


class PrincipleMergeValidationError(ValueError):
    def __init__(self, code: str, message: str):
        super().__init__(message)
        self.code = code


def _json_text(value: object, label: str) -> str:
    try:
        encoded = json.dumps(value, ensure_ascii=False, separators=(",", ":"))
    except (TypeError, ValueError) as exc:
        raise ValueError(f"{label}必须是可序列化 JSON") from exc
    if len(encoded.encode("utf-8")) > MAX_SHARED_BYTES:
        raise ValueError(f"{label}超过大小限制")
    return encoded


def _decode(value: str | None, fallback: object, label: str) -> Any:
    if value is None:
        return deepcopy(fallback)
    try:
        return json.loads(value)
    except (TypeError, ValueError) as exc:
        raise ValueError(f"服务器{label}数据损坏，已拒绝覆盖") from exc


def _subject_id(value: object) -> str:
    subject_id = str(value or "").strip()
    if not subject_id or len(subject_id) > 128:
        raise ValueError("科目 ID 格式不正确")
    return "subject-pmp" if subject_id.upper() == "PMP" else subject_id


async def _read_row(db: AsyncSession, key: str) -> SharedRuntimeState | None:
    return await db.get(SharedRuntimeState, key)


async def _write_row(
    db: AsyncSession,
    key: str,
    value: object,
    actor_username: str,
    label: str,
) -> bool:
    encoded = _json_text(value, label)
    row = await _read_row(db, key)
    if row is not None and row.value == encoded:
        return False
    if row is None:
        db.add(SharedRuntimeState(key=key, value=encoded, updated_by=actor_username))
    else:
        row.value = encoded
        row.updated_by = actor_username
    return True


def _normalize_tree(value: object, subject_id: str) -> dict[str, Any] | None:
    if value in (None, {}):
        return None
    if not isinstance(value, dict):
        raise ValueError("知识树必须是 JSON 对象")
    taxonomy = value.get("taxonomy", value)
    if not isinstance(taxonomy, dict):
        raise ValueError("知识树缺少 taxonomy")
    taxonomy_id = str(taxonomy.get("id") or "").strip()
    if not taxonomy_id or len(taxonomy_id) > 128:
        raise ValueError("知识树 ID 格式不正确")
    nodes = taxonomy.get("nodes", [])
    if not isinstance(nodes, list):
        raise ValueError("知识树 nodes 必须是数组")
    return {
        **taxonomy,
        "id": taxonomy_id,
        "subjectId": _subject_id(taxonomy.get("subjectId") or subject_id),
        "nodes": nodes,
    }


def _normalize_recall(value: object) -> dict[str, Any] | None:
    if value in (None, {}):
        return None
    if not isinstance(value, dict):
        raise ValueError("联想库必须是 JSON 对象")
    nodes, edges = value.get("nodes", []), value.get("edges", [])
    if not isinstance(nodes, list) or not isinstance(edges, list):
        raise ValueError("联想库 nodes/edges 必须是数组")
    return {
        **value,
        "schemaVersion": 1,
        "nodes": nodes,
        "edges": edges,
        "updatedAt": str(value.get("updatedAt") or ""),
    }


def _tag_payload(row: QuestionTagConfig | None) -> dict[str, Any]:
    if row is None:
        return {}
    slot_schema = row.slot_schema if isinstance(row.slot_schema, dict) else {}
    return {
        "schemaVersion": row.schema_version,
        "names": dict(row.names or {}),
        "groupNames": dict(row.group_names or {}),
        "categoryNames": dict(row.category_names or {}),
        "aliases": dict(row.aliases or {}),
        **slot_schema,
    }


async def _active_tag_config(db: AsyncSession) -> QuestionTagConfig | None:
    return (
        await db.execute(
            select(QuestionTagConfig).where(QuestionTagConfig.active.is_(True))
        )
    ).scalar_one_or_none()


async def _assert_revision(db: AsyncSession, expected_revision: int) -> int:
    await teaching_content_revision_service.acquire_lock(db)
    current = int((await teaching_content_revision_service.current(db))["revision"])
    if expected_revision != current:
        raise ContentRevisionConflict(current)
    return current


async def read_shared_content(db: AsyncSession, subject_id: str) -> dict[str, Any]:
    subject_id = _subject_id(subject_id)
    await teaching_content_revision_service.acquire_read_lock(db)
    bundle = await teaching_content_projection_service.principle_card_bundle(db)
    taxonomy_row = await _read_row(db, TAXONOMY_KEY)
    taxonomies = _decode(taxonomy_row.value if taxonomy_row else None, [], "知识树")
    if not isinstance(taxonomies, list):
        raise ValueError("服务器知识树必须是数组")
    matching = [
        item
        for item in taxonomies
        if isinstance(item, dict)
        and str(item.get("subjectId") or "").strip()
        and _subject_id(item.get("subjectId")) == subject_id
    ]
    recall_key = RECALL_PREFIX + quote(subject_id, safe="")
    recall_row = await _read_row(db, recall_key)
    recall = _decode(
        recall_row.value if recall_row else None,
        {"schemaVersion": 1, "nodes": [], "edges": [], "updatedAt": ""},
        "联想库",
    )
    facet_snapshot = await subject_facet_service.list_schemas(db)
    subject_facet_schemas = [
        schema
        for schema in facet_snapshot["schemas"]
        if _subject_id(schema.get("subjectId")) == subject_id
        or any(_subject_id(code) == subject_id for code in schema.get("subjectCodes", []))
    ]
    revision = int((await teaching_content_revision_service.current(db))["revision"])
    return {
        "subjectId": subject_id,
        "knowledgeTree": {"taxonomy": matching[-1]} if matching else None,
        "recallLibrary": recall,
        "principles": bundle["principles"],
        "synthesisPresets": bundle["synthesisPresets"],
        "tagConfig": _tag_payload(await _active_tag_config(db)),
        "subjectFacetSchemas": subject_facet_schemas,
        "contentRevision": revision,
    }


async def apply_auxiliary_assets(
    db: AsyncSession,
    *,
    actor_username: str,
    subject_id: str,
    knowledge_tree: object,
    recall_library: object,
    tag_config: dict[str, Any],
) -> list[dict[str, str]]:
    """Apply tree, recall and tag browser projections in the caller transaction."""

    subject_id = _subject_id(subject_id)
    changes: list[dict[str, str]] = []
    tree = _normalize_tree(knowledge_tree, subject_id)
    if tree is not None:
        row = await _read_row(db, TAXONOMY_KEY)
        current = _decode(row.value if row else None, [], "知识树")
        if not isinstance(current, list):
            raise ValueError("服务器知识树必须是数组")
        next_value = [
            item
            for item in current
            if not isinstance(item, dict) or str(item.get("id") or "") != tree["id"]
        ]
        next_value.append(tree)
        if await _write_row(db, TAXONOMY_KEY, next_value, actor_username, "知识树"):
            changes.append(
                {"entityType": "taxonomy", "entityId": tree["id"], "action": "upserted"}
            )

    recall = _normalize_recall(recall_library)
    if recall is not None:
        key = RECALL_PREFIX + quote(subject_id, safe="")
        if await _write_row(db, key, recall, actor_username, "联想库"):
            changes.append(
                {"entityType": "recallLibrary", "entityId": subject_id, "action": "upserted"}
            )

    return changes


async def save_shared_content(
    db: AsyncSession,
    actor: User,
    *,
    subject_id: str,
    content_revision: int,
    knowledge_tree: object,
    recall_library: object,
    principles: dict[str, Any],
    synthesis_presets: dict[str, Any],
    tag_config: dict[str, Any],
) -> dict[str, Any]:
    subject_id = _subject_id(subject_id)
    await _assert_revision(db, content_revision)
    changes: list[dict[str, str]] = []

    if principles or synthesis_presets:
        bundle = teaching_content_projection_service.validate_principle_card_bundle(
            {"principles": principles, "synthesisPresets": synthesis_presets}
        )
        for key, value in (
            (teaching_content_projection_service.PRINCIPLE_KEY, bundle["principles"]),
            (teaching_content_projection_service.PRESET_KEY, bundle["synthesisPresets"]),
        ):
            changes.extend(
                await teaching_content_projection_service.apply_principle_projection(
                    db, actor.username, key, _json_text(value, "原则投影")
                )
            )
        await teaching_content_projection_service.write_principle_projection(
            db, actor.username
        )

    tag_changed = False
    if tag_config:
        tag_changed = await content_prep_service._upsert_tag_config(
            db, content_prep_service._actor_context(actor), tag_config
        )
    changes.extend(
        await apply_auxiliary_assets(
            db,
            actor_username=actor.username,
            subject_id=subject_id,
            knowledge_tree=knowledge_tree,
            recall_library=recall_library,
            tag_config=tag_config,
        )
    )
    if tag_changed and not any(item.get("entityType") == "tagConfig" for item in changes):
        changes.append(
            {"entityType": "tagConfig", "entityId": "active", "action": "upserted"}
        )

    if changes:
        revision = await teaching_content_revision_service.bump(
            db, actor.username, changes
        )
    else:
        revision = await teaching_content_revision_service.current(db)
    await db.commit()
    return {
        **(await read_shared_content(db, subject_id)),
        "contentRevision": int(revision["revision"]),
    }


async def upsert_principle(
    db: AsyncSession,
    actor: User,
    *,
    principle_id: str,
    content_revision: int,
    principle: dict[str, Any],
    preset: dict[str, Any],
) -> dict[str, Any]:
    if str(principle.get("id") or "").strip() != principle_id:
        raise ValueError("原则 ID 与路径不一致")
    if str(preset.get("principleId") or "").strip() != principle_id:
        raise ValueError("归纳卡必须引用当前原则")
    await _assert_revision(db, content_revision)
    principle_item = teaching_content_projection_service.validate_projection_container(
        teaching_content_projection_service.PRINCIPLE_KEY,
        {"schemaVersion": 1, "items": [principle]},
    )["items"][0]
    preset_item = teaching_content_projection_service.validate_projection_container(
        teaching_content_projection_service.PRESET_KEY,
        {"schemaVersion": 1, "items": [preset]},
    )["items"][0]
    actor_context = content_prep_service._actor_context(actor)
    changes = await content_prep_service._upsert_principles(
        db, actor_context, {"items": [principle_item]}
    )
    await db.flush()
    changes.extend(
        await content_prep_service._upsert_presets(
            db, actor_context, {"items": [preset_item]}
        )
    )
    await teaching_content_projection_service.write_principle_projection(
        db, actor.username
    )
    revision = (
        await teaching_content_revision_service.bump(db, actor.username, changes)
        if changes
        else await teaching_content_revision_service.current(db)
    )
    await db.commit()
    return {
        **(await teaching_content_projection_service.principle_card_bundle(db)),
        "contentRevision": int(revision["revision"]),
    }


async def read_principles(db: AsyncSession) -> dict[str, Any]:
    await teaching_content_revision_service.acquire_read_lock(db)
    revision = await teaching_content_revision_service.current(db)
    return {
        **(await teaching_content_projection_service.principle_card_bundle(db)),
        "contentRevision": int(revision["revision"]),
    }


async def preview_principle_merge(
    db: AsyncSession, bundle: object
) -> dict[str, Any]:
    incoming = teaching_content_projection_service.validate_principle_card_bundle(
        bundle
    )
    await teaching_content_revision_service.acquire_read_lock(db)
    existing = await teaching_content_projection_service.principle_card_bundle(db)
    plan = teaching_content_projection_service.plan_principle_bundle_merge(
        incoming, existing
    )
    revision = await teaching_content_revision_service.current(db)
    return {"plan": plan, "contentRevision": int(revision["revision"])}


async def apply_principle_merge(
    db: AsyncSession,
    actor: User,
    *,
    content_revision: int,
    bundle: object,
    resolutions: list[dict[str, Any]],
) -> dict[str, Any]:
    incoming = teaching_content_projection_service.validate_principle_card_bundle(
        bundle
    )
    await _assert_revision(db, content_revision)
    existing = await teaching_content_projection_service.principle_card_bundle(db)
    plan = teaching_content_projection_service.plan_principle_bundle_merge(
        incoming, existing
    )
    resolution_by_id: dict[str, str] = {}
    for item in resolutions:
        if not isinstance(item, dict):
            raise PrincipleMergeValidationError(
                "INVALID_PRINCIPLE_RESOLUTION", "原则冲突处理必须是对象"
            )
        conflict_id = str(item.get("conflictId") or "").strip()
        resolution = str(item.get("resolution") or "").strip()
        if not conflict_id or resolution not in {"keep-existing", "take-incoming"}:
            raise PrincipleMergeValidationError(
                "INVALID_PRINCIPLE_RESOLUTION",
                "原则冲突处理必须指定 keep-existing 或 take-incoming",
            )
        resolution_by_id[conflict_id] = resolution
    conflict_ids = {str(item["conflictId"]) for item in plan["conflicts"]}
    if conflict_ids - set(resolution_by_id):
        raise PrincipleMergeValidationError(
            "UNRESOLVED_PRINCIPLE_CONFLICT", "原则冲突尚未全部处理"
        )
    if set(resolution_by_id) - conflict_ids:
        raise PrincipleMergeValidationError(
            "INVALID_PRINCIPLE_RESOLUTION", "包含不属于当前合并计划的冲突处理"
        )

    selected_ids = {str(item["id"]) for item in plan["added"]}
    replaced_existing_ids: set[str] = set()
    for conflict in plan["conflicts"]:
        resolution = resolution_by_id[str(conflict["conflictId"])]
        incoming_id = str(conflict.get("principleId") or "")
        if conflict["type"] == "same-id-different-name":
            if resolution == "take-incoming":
                selected_ids.add(incoming_id)
        elif conflict["type"] == "same-normalized-name-different-id":
            if resolution == "take-incoming":
                selected_ids.add(incoming_id)
                replaced_existing_ids.add(str(conflict["existingId"]))
        elif conflict["type"] == "preset-rebind":
            if resolution == "keep-existing":
                selected_ids.discard(incoming_id)

    if replaced_existing_ids:
        referenced = (
            await teaching_content_projection_service.principle_reference_questions(
                db, replaced_existing_ids
            )
        )
        if referenced:
            raise teaching_content_projection_service.PrincipleArchiveConflict(
                referenced
            )
        await db.execute(
            delete(SynthesisPreset).where(
                SynthesisPreset.principle_id.in_(replaced_existing_ids)
            )
        )
        await db.execute(
            delete(Principle).where(Principle.id.in_(replaced_existing_ids))
        )

    incoming_principles = {
        str(item["id"]): item for item in incoming["principles"]["items"]
    }
    incoming_presets = {
        str(item["principleId"]): item
        for item in incoming["synthesisPresets"]["items"]
    }
    selected_principles = [
        incoming_principles[principle_id]
        for principle_id in sorted(selected_ids)
        if principle_id in incoming_principles
    ]
    selected_presets = [
        incoming_presets[principle_id]
        for principle_id in sorted(selected_ids)
        if principle_id in incoming_presets
    ]
    selected_preset_ids = {str(item["id"]) for item in selected_presets}
    if selected_ids:
        await db.execute(
            delete(SynthesisPreset).where(
                SynthesisPreset.principle_id.in_(selected_ids),
                SynthesisPreset.id.not_in(selected_preset_ids),
            )
        )
    actor_context = content_prep_service._actor_context(actor)
    changes = await content_prep_service._upsert_principles(
        db, actor_context, {"items": selected_principles}
    )
    await db.flush()
    changes.extend(
        await content_prep_service._upsert_presets(
            db, actor_context, {"items": selected_presets}
        )
    )
    if replaced_existing_ids:
        changes.extend(
            {
                "entityType": "principle",
                "entityId": principle_id,
                "action": "replaced",
            }
            for principle_id in sorted(replaced_existing_ids)
        )
    await teaching_content_projection_service.write_principle_projection(
        db, actor.username
    )
    revision = (
        await teaching_content_revision_service.bump(db, actor.username, changes)
        if changes
        else await teaching_content_revision_service.current(db)
    )
    await db.commit()
    return {
        **(await teaching_content_projection_service.principle_card_bundle(db)),
        "contentRevision": int(revision["revision"]),
        "summary": {
            "added": len(plan["added"]),
            "unchanged": len(plan["unchanged"]),
            "conflicts": len(plan["conflicts"]),
        },
    }


async def delete_principle(
    db: AsyncSession,
    actor: User,
    *,
    principle_id: str,
    content_revision: int,
) -> dict[str, Any]:
    await _assert_revision(db, content_revision)
    return await teaching_content_projection_service.delete_principles(
        db, actor.username, [principle_id]
    )


def _business_activity(value: object) -> object:
    item = deepcopy(value)
    if not isinstance(item, dict):
        return item
    metadata = item.get("metadata")
    if isinstance(metadata, dict):
        metadata.pop("authorship", None)
    return item


async def import_activities(
    db: AsyncSession,
    actor: User,
    *,
    content_revision: int,
    activities: list[dict[str, Any]],
) -> dict[str, Any]:
    if not activities or len(activities) > MAX_ACTIVITIES:
        raise ValueError("活动数量必须在 1 到 5000 之间")
    await _assert_revision(db, content_revision)
    row = await _read_row(db, ACTIVITY_KEY)
    current = _decode(row.value if row else None, {}, "活动库")
    if not isinstance(current, dict):
        raise ValueError("服务器活动库必须是 JSON 对象")
    created = updated = unchanged = 0
    changes: list[dict[str, str]] = []
    now = datetime.now(timezone.utc).isoformat()
    for source in activities:
        if not isinstance(source, dict):
            raise ValueError("活动必须是 JSON 对象")
        activity_id = str(source.get("id") or "").strip()
        if not activity_id or len(activity_id) > 128:
            raise ValueError("活动 ID 格式不正确")
        activity = json.loads(_json_text(source, "活动"))
        existing = current.get(activity_id)
        if existing is not None and _business_activity(existing) == _business_activity(activity):
            unchanged += 1
            continue
        previous_authorship = (
            existing.get("metadata", {}).get("authorship", {})
            if isinstance(existing, dict)
            else {}
        )
        metadata = activity.get("metadata")
        metadata = metadata if isinstance(metadata, dict) else {}
        metadata["authorship"] = {
            "createdByUserId": previous_authorship.get("createdByUserId") or actor.username,
            "createdByName": previous_authorship.get("createdByName") or actor.username,
            "createdAt": previous_authorship.get("createdAt") or now,
            "updatedByUserId": actor.username,
            "updatedByName": actor.username,
            "updatedAt": now,
        }
        activity["metadata"] = metadata
        current[activity_id] = activity
        action = "created" if existing is None else "updated"
        created += existing is None
        updated += existing is not None
        changes.append(
            {"entityType": "activity", "entityId": activity_id, "action": action}
        )
    if changes:
        await _write_row(db, ACTIVITY_KEY, current, actor.username, "活动库")
        revision = await teaching_content_revision_service.bump(
            db, actor.username, changes
        )
    else:
        revision = await teaching_content_revision_service.current(db)
    await db.commit()
    return {
        "contentRevision": int(revision["revision"]),
        "summary": {"created": created, "updated": updated, "unchanged": unchanged},
    }
