"""Server-authoritative shared assets for Content Prep and Question Studio."""

from __future__ import annotations

import json
from copy import deepcopy
from datetime import datetime, timezone
from typing import Any
from uuid import uuid4

from sqlalchemy import delete, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.content_prep import Principle, QuestionTagConfig, SynthesisPreset
from sqlalchemy import func
from sqlalchemy.exc import IntegrityError

from app.models.teaching_content import (
    ActivityCollection,
    ActivityOverride,
    ContentSubject,
    ContentTaxonomy,
    RecallAssociationLibrary,
    TaxonomyNode,
    TeachingContentAudit,
)
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


async def _ensure_subject(db: AsyncSession, subject_id: str) -> ContentSubject:
    row = await db.get(ContentSubject, subject_id)
    if row is None:
        code = subject_id.removeprefix("subject-").upper()
        row = ContentSubject(id=subject_id, code=code, name=code, content_metadata={})
        db.add(row)
        await db.flush()
    return row


def _taxonomy_payload(row: ContentTaxonomy, nodes: list[TaxonomyNode]) -> dict[str, Any]:
    return {
        **dict(row.content_metadata or {}),
        "id": row.id,
        "subjectId": row.subject_id,
        "version": row.version,
        "status": row.status,
        "title": row.title,
        "nodes": [dict(node.record or {}) for node in nodes],
    }


async def _latest_taxonomy(db: AsyncSession, subject_id: str) -> tuple[ContentTaxonomy, list[TaxonomyNode]] | None:
    row = (await db.execute(
        select(ContentTaxonomy)
        .where(ContentTaxonomy.subject_id == subject_id)
        .order_by(ContentTaxonomy.updated_at.desc(), ContentTaxonomy.version.desc())
        .limit(1)
    )).scalar_one_or_none()
    if row is None:
        return None
    nodes = list((await db.execute(
        select(TaxonomyNode).where(TaxonomyNode.taxonomy_id == row.id).order_by(TaxonomyNode.position, TaxonomyNode.node_id)
    )).scalars())
    return row, nodes


async def _latest_recall(db: AsyncSession, subject_id: str) -> RecallAssociationLibrary | None:
    return (await db.execute(
        select(RecallAssociationLibrary)
        .where(RecallAssociationLibrary.subject_id == subject_id)
        .order_by((RecallAssociationLibrary.status == "published").desc(), RecallAssociationLibrary.version.desc(), RecallAssociationLibrary.updated_at.desc())
        .limit(1)
    )).scalar_one_or_none()


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


async def _principle_card_bundle(db: AsyncSession) -> dict[str, Any]:
    principles = (await db.execute(select(Principle).order_by(Principle.id))).scalars().all()
    presets = (await db.execute(select(SynthesisPreset).order_by(SynthesisPreset.id))).scalars().all()
    return {
        "principleCardBundleVersion": 1,
        "format": "kg-principle-card-bundle-v1",
        "principles": {"schemaVersion": 1, "items": [{"id": row.id, "name": row.name, "status": row.status, "confusablePrincipleIds": row.confusable_principle_ids or []} for row in principles]},
        "synthesisPresets": {"schemaVersion": 1, "items": [{"id": row.id, "principleId": row.principle_id, "title": row.title, "content": row.content, "status": row.status, "version": row.business_version} for row in presets]},
    }


async def read_shared_content(db: AsyncSession, subject_id: str) -> dict[str, Any]:
    subject_id = _subject_id(subject_id)
    await teaching_content_revision_service.acquire_read_lock(db)
    bundle = await _principle_card_bundle(db)
    taxonomy_result = await _latest_taxonomy(db, subject_id)
    taxonomy = _taxonomy_payload(*taxonomy_result) if taxonomy_result else None
    recall_row = await _latest_recall(db, subject_id)
    recall = {
        "schemaVersion": 1,
        "nodes": list(recall_row.nodes or []),
        "edges": list(recall_row.edges or []),
        "updatedAt": recall_row.updated_at.isoformat() if recall_row and recall_row.updated_at else "",
    } if recall_row else {"schemaVersion": 1, "nodes": [], "edges": [], "updatedAt": ""}
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
        "knowledgeTree": {"taxonomy": taxonomy} if taxonomy else None,
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
        subject = await _ensure_subject(db, subject_id)
        taxonomy_id = tree["id"]
        row = await db.get(ContentTaxonomy, taxonomy_id)
        requested_version = int(tree.get("version") or 1)
        if row is None:
            conflicting = (await db.execute(select(ContentTaxonomy).where(ContentTaxonomy.subject_id == subject_id, ContentTaxonomy.version == requested_version).limit(1))).scalar_one_or_none()
            if conflicting is not None:
                await db.execute(delete(TaxonomyNode).where(TaxonomyNode.taxonomy_id == conflicting.id))
                await db.delete(conflicting)
                await db.flush()
        if row is None:
            row = ContentTaxonomy(id=taxonomy_id, subject_id=subject.id, version=requested_version, status=str(tree.get("status") or "published"), title=str(tree.get("title") or tree.get("name") or ""), content_metadata={k: v for k, v in tree.items() if k != "nodes"}, updated_by=actor_username, created_by=actor_username)
            db.add(row)
        else:
            row.version = int(tree.get("version") or row.version)
            row.status = str(tree.get("status") or row.status)
            row.title = str(tree.get("title") or row.title)
            row.content_metadata = {k: v for k, v in tree.items() if k != "nodes"}
            row.updated_by = actor_username
        await db.flush()
        await db.execute(delete(TaxonomyNode).where(TaxonomyNode.taxonomy_id == taxonomy_id))
        for position, node in enumerate(tree["nodes"]):
            if not isinstance(node, dict) or not str(node.get("id") or "").strip():
                raise ValueError("知识点必须包含 ID")
            node_id = str(node["id"])
            db.add(TaxonomyNode(id=f"{taxonomy_id}:{node_id}", taxonomy_id=taxonomy_id, node_id=node_id, parent_node_id=node.get("parentId"), title=str(node.get("title") or ""), record=node, position=position, status=str(node.get("status") or "active")))
        db.add(TeachingContentAudit(id=uuid4().hex, entity_type="taxonomy", entity_id=taxonomy_id, action="published" if row.status == "published" else "upserted", actor_username=actor_username, after=tree))
        changes.append({"entityType": "taxonomy", "entityId": taxonomy_id, "action": "upserted"})

    recall = _normalize_recall(recall_library)
    if recall is not None:
        await _ensure_subject(db, subject_id)
        row = (await db.execute(select(RecallAssociationLibrary).where(RecallAssociationLibrary.subject_id == subject_id, RecallAssociationLibrary.version == int(recall.get("version") or 1)))).scalar_one_or_none()
        if row is None:
            row = RecallAssociationLibrary(id=uuid4().hex, subject_id=subject_id, version=int(recall.get("version") or 1), status="published", nodes=recall["nodes"], edges=recall["edges"], content_metadata={k: v for k, v in recall.items() if k not in {"nodes", "edges"}}, updated_by=actor_username)
            db.add(row)
        else:
            row.nodes, row.edges, row.content_metadata, row.updated_by = recall["nodes"], recall["edges"], {k: v for k, v in recall.items() if k not in {"nodes", "edges"}}, actor_username
        db.add(TeachingContentAudit(id=uuid4().hex, entity_type="recallLibrary", entity_id=row.id, action="upserted", actor_username=actor_username, after=recall))
        changes.append({"entityType": "recallLibrary", "entityId": subject_id, "action": "upserted"})

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
        actor_context = content_prep_service._actor_context(actor)
        changes.extend(await content_prep_service._upsert_principles(db, actor_context, bundle["principles"]))
        await db.flush()
        changes.extend(await content_prep_service._upsert_presets(db, actor_context, bundle["synthesisPresets"]))

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

    revision = (
        await teaching_content_revision_service.bump(db, actor.username, changes)
        if changes
        else await teaching_content_revision_service.current(db)
    )
    await db.commit()
    return {
        **(await _principle_card_bundle(db)),
        "contentRevision": int(revision["revision"]),
    }


async def read_principles(db: AsyncSession) -> dict[str, Any]:
    await teaching_content_revision_service.acquire_read_lock(db)
    revision = await teaching_content_revision_service.current(db)
    return {
        **(await _principle_card_bundle(db)),
        "contentRevision": int(revision["revision"]),
    }


async def preview_principle_merge(
    db: AsyncSession, bundle: object
) -> dict[str, Any]:
    incoming = teaching_content_projection_service.validate_principle_card_bundle(
        bundle
    )
    await teaching_content_revision_service.acquire_read_lock(db)
    existing = await _principle_card_bundle(db)
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
    existing = await _principle_card_bundle(db)
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

    revision = (
        await teaching_content_revision_service.bump(db, actor.username, changes)
        if changes
        else await teaching_content_revision_service.current(db)
    )
    await db.commit()
    return {
        **(await _principle_card_bundle(db)),
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
    principle = await db.get(Principle, principle_id)
    if principle is None:
        raise ValueError(f"原则不存在：{principle_id}")
    referenced = await teaching_content_projection_service.principle_reference_questions(db, [principle_id])
    if referenced:
        raise teaching_content_projection_service.PrincipleArchiveConflict(referenced)
    await db.execute(delete(SynthesisPreset).where(SynthesisPreset.principle_id == principle_id))
    await db.delete(principle)
    db.add(TeachingContentAudit(id=uuid4().hex, entity_type="principle", entity_id=principle_id, action="deleted", actor_username=actor.username, after={}))
    revision = await teaching_content_revision_service.bump(db, actor.username, [{"entityType": "principle", "entityId": principle_id, "action": "deleted"}])
    await db.commit()
    return {**(await _principle_card_bundle(db)), "contentRevision": int(revision["revision"])}


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
    subject_id: str = "subject-pmp",
    collection_id: str = "default",
    activities: list[dict[str, Any]],
) -> dict[str, Any]:
    if not activities or len(activities) > MAX_ACTIVITIES:
        raise ValueError("活动数量必须在 1 到 5000 之间")
    await _assert_revision(db, content_revision)
    row = (await db.execute(select(ActivityOverride).where(ActivityOverride.collection_id == collection_id))).scalars().all()
    current = {item.activity_id: item for item in row}
    collection = await db.get(ActivityCollection, collection_id)
    if collection is None:
        await _ensure_subject(db, subject_id)
        collection = ActivityCollection(id=collection_id, subject_id=subject_id, title="默认活动库", content_metadata={})
        db.add(collection)
        await db.flush()
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
        existing_row = current.get(activity_id)
        existing = existing_row.record if existing_row is not None else None
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
        if existing_row is None:
            db.add(ActivityOverride(id=uuid4().hex, collection_id=collection_id, activity_id=activity_id, record=activity, updated_by=actor.username))
        else:
            existing_row.record = activity
            existing_row.revision += 1
            existing_row.updated_by = actor.username
        action = "created" if existing is None else "updated"
        created += existing is None
        updated += existing is not None
        changes.append({"entityType": "activity", "entityId": activity_id, "action": action})
    if changes:
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
