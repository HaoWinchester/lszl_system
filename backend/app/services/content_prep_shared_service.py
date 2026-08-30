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
from app.models.course_management import CourseDraft, CourseRelease, LearningTask
from app.models.paper_release import PaperRelease, PaperReleaseQuestion
from app.models.question import ExamPaper, Question, QuestionBank
from sqlalchemy import func
from sqlalchemy.exc import IntegrityError

from app.models.teaching_content import (
    ActivityCollection,
    ActivityOverride,
    ActivityTag,
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
    teaching_content_current_service,
    teaching_content_projection_service,
    teaching_content_revision_service,
)


MAX_SHARED_BYTES = 2 * 1024 * 1024
MAX_ACTIVITIES = 5000


ContentRevisionConflict = teaching_content_revision_service.ContentRevisionConflict


class PrincipleMergeValidationError(ValueError):
    def __init__(self, code: str, message: str):
        super().__init__(message)
        self.code = code


def _json_text(value: object, label: str) -> str:
    try:
        encoded = json.dumps(
            value, ensure_ascii=False, separators=(",", ":"), allow_nan=False
        )
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
    nodes = _validate_taxonomy_nodes(taxonomy_id, nodes)
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
    return await teaching_content_revision_service.assert_expected(
        db, expected_revision
    )


async def _principle_card_bundle(db: AsyncSession) -> dict[str, Any]:
    principles = (await db.execute(select(Principle).order_by(Principle.id))).scalars().all()
    presets = (await db.execute(select(SynthesisPreset).order_by(SynthesisPreset.id))).scalars().all()
    return {
        "principleCardBundleVersion": 1,
        "format": "kg-principle-card-bundle-v1",
        "principles": {"schemaVersion": 1, "items": [{"id": row.id, "name": row.name, "status": row.status, "confusablePrincipleIds": row.confusable_principle_ids or []} for row in principles]},
        "synthesisPresets": {"schemaVersion": 1, "items": [{"id": row.id, "principleId": row.principle_id, "title": row.title, "content": row.content, "status": row.status, "version": row.business_version} for row in presets]},
    }


class CatalogResourceNotModifiable(ValueError):
    code = "RESOURCE_NOT_MODIFIABLE"


def _system_collection(row: ActivityCollection) -> bool:
    return bool((row.content_metadata or {}).get("systemNamespace"))


def _collection_visible(row: ActivityCollection, viewer_username: str | None) -> bool:
    if _system_collection(row):
        return False
    if viewer_username is None or row.owner_username == viewer_username:
        return True
    return str((row.content_metadata or {}).get("visibility") or "private") == "shared"


def _collection_payload(row: ActivityCollection) -> dict[str, Any]:
    metadata = dict(row.content_metadata or {})
    authorship = dict(metadata.get("authorship") or {})
    if row.owner_username:
        authorship["createdByUserId"] = row.owner_username
        metadata["authorship"] = authorship
    return {
        **metadata,
        "id": row.id,
        "subjectId": row.subject_id,
        "title": row.title,
        "status": row.status,
    }


def _activity_tag_payload(row: ActivityTag) -> dict[str, Any]:
    return {
        **dict(row.content_metadata or {}),
        "id": row.id,
        "name": row.tag,
        "collectionId": row.collection_id,
    }


def _activity_override_payload(row: ActivityOverride) -> dict[str, Any]:
    return dict(row.record or {})


def _collection_writable(
    row: ActivityCollection | None, actor_username: str
) -> bool:
    return row is None or _system_collection(row) or row.owner_username == actor_username


async def _relational_repository_snapshot(
    db: AsyncSession, viewer_username: str | None = None
) -> dict[str, Any]:
    """Return the teaching repository shapes consumed by the legacy facades."""

    subjects = list(
        (await db.execute(select(ContentSubject).order_by(ContentSubject.id)))
        .scalars()
        .all()
    )
    taxonomies = list(
        (
            await db.execute(
                select(ContentTaxonomy).order_by(
                    ContentTaxonomy.subject_id,
                    ContentTaxonomy.version,
                    ContentTaxonomy.id,
                )
            )
        )
        .scalars()
        .all()
    )
    node_rows = list(
        (
            await db.execute(
                select(TaxonomyNode).order_by(
                    TaxonomyNode.taxonomy_id,
                    TaxonomyNode.position,
                    TaxonomyNode.node_id,
                )
            )
        )
        .scalars()
        .all()
    )
    nodes_by_taxonomy: dict[str, list[TaxonomyNode]] = {}
    for node in node_rows:
        nodes_by_taxonomy.setdefault(node.taxonomy_id, []).append(node)
    collections = list(
        (await db.execute(select(ActivityCollection).order_by(ActivityCollection.id)))
        .scalars()
        .all()
    )
    activities = list(
        (
            await db.execute(
                select(ActivityOverride).order_by(
                    ActivityOverride.collection_id,
                    ActivityOverride.activity_id,
                )
            )
        )
        .scalars()
        .all()
    )
    tags = list(
        (await db.execute(select(ActivityTag).order_by(ActivityTag.id)))
        .scalars()
        .all()
    )
    collection_by_id = {row.id: row for row in collections}
    visible_collection_ids = {
        row.id for row in collections if _collection_visible(row, viewer_username)
    }
    visible_tag_rows = [
        row
        for row in tags
        if _system_collection(collection_by_id[row.collection_id])
        or row.collection_id in visible_collection_ids
    ]
    visible_activity_rows = [
        row
        for row in activities
        if _system_collection(collection_by_id[row.collection_id])
        or row.collection_id in visible_collection_ids
    ]
    return {
        "subjects": [
            {
                **{
                    key: value
                    for key, value in dict(row.content_metadata or {}).items()
                    if key != "nameEn"
                },
                "id": row.id,
                "code": row.code,
                "name": {
                    "zh": row.name,
                    "en": str((row.content_metadata or {}).get("nameEn") or ""),
                },
                "status": row.status,
            }
            for row in subjects
        ],
        "taxonomies": [
            _taxonomy_payload(row, nodes_by_taxonomy.get(row.id, []))
            for row in taxonomies
        ],
        "activityCollections": [
            _collection_payload(row)
            for row in collections
            if row.id in visible_collection_ids
        ],
        "activityOverrides": [_activity_override_payload(row) for row in visible_activity_rows],
        "activityTags": [
            _activity_tag_payload(row)
            for row in visible_tag_rows
        ],
    }


def _required_id(value: object, label: str) -> str:
    identifier = str(value or "").strip()
    if not identifier or len(identifier) > 128:
        raise ValueError(f"{label} ID 格式不正确")
    return identifier


def _unique_rows(rows: list[dict[str, Any]], label: str) -> dict[str, dict[str, Any]]:
    result: dict[str, dict[str, Any]] = {}
    for item in rows:
        if not isinstance(item, dict):
            raise ValueError(f"{label}必须是对象列表")
        identifier = _required_id(item.get("id"), label)
        if identifier in result:
            raise ValueError(f"{label} ID 不能重复：{identifier}")
        _json_text(item, label)
        result[identifier] = deepcopy(item)
    return result


def _strict_id_list(value: object, label: str) -> list[str]:
    if value is None:
        return []
    if not isinstance(value, list):
        raise ValueError(f"{label}必须是数组")
    result: list[str] = []
    for item in value:
        if not isinstance(item, str):
            raise ValueError(f"{label}必须是字符串数组")
        identifier = item.strip()
        if not identifier or len(identifier) > 128:
            raise ValueError(f"{label}包含格式不正确的 ID")
        result.append(identifier)
    if len(result) != len(set(result)):
        raise ValueError(f"{label}不能包含重复 ID")
    return result


def _validate_taxonomy_nodes(
    taxonomy_id: str, value: object
) -> list[dict[str, Any]]:
    if not isinstance(value, list):
        raise ValueError("知识树 nodes 必须是对象数组")
    nodes: dict[str, dict[str, Any]] = {}
    parents: dict[str, str | None] = {}
    for raw in value:
        if not isinstance(raw, dict):
            raise ValueError("知识点必须是对象")
        node = deepcopy(raw)
        node_id = _required_id(node.get("id"), "知识点")
        if node_id in nodes:
            raise ValueError("知识点 ID 不能重复")
        declared_taxonomy = str(node.get("taxonomyId") or "").strip()
        if declared_taxonomy and declared_taxonomy != taxonomy_id:
            raise ValueError("知识点 taxonomyId 与知识树不一致")
        parent_value = node.get("parentId")
        if parent_value is not None and not isinstance(parent_value, str):
            raise ValueError("知识点 parentId 必须是字符串")
        parent_id = str(parent_value or "").strip() or None
        if parent_id == node_id:
            raise ValueError("知识点不能以自身为父节点")
        level = node.get("level")
        if level is not None and (
            isinstance(level, bool) or not isinstance(level, int) or not 1 <= level <= 9
        ):
            raise ValueError("知识点 level 必须是 1 到 9 的整数")
        nodes[node_id] = node
        parents[node_id] = parent_id

    for node_id, parent_id in parents.items():
        if parent_id and parent_id not in nodes:
            raise ValueError("知识点引用了不存在的父节点")
        seen = {node_id}
        cursor = parent_id
        depth = 1
        while cursor is not None:
            if cursor in seen:
                raise ValueError("知识点层级不能形成循环")
            seen.add(cursor)
            depth += 1
            if depth > 9:
                raise ValueError("知识树深度不能超过 9 层")
            cursor = parents[cursor]
        declared_level = nodes[node_id].get("level")
        if declared_level is not None and declared_level != depth:
            raise ValueError("知识点 level 必须与父子层级连续")
        nodes[node_id]["level"] = depth
        nodes[node_id]["taxonomyId"] = taxonomy_id
    return list(nodes.values())


def _localized_text(value: object) -> str:
    if isinstance(value, dict):
        return str(value.get("zh") or value.get("en") or "").strip()
    return str(value or "").strip()


def _payload_references(
    value: object,
    targets: set[str],
    *,
    scalar_keys: frozenset[str],
    array_keys: frozenset[str],
) -> bool:
    if isinstance(value, dict):
        for key, child in value.items():
            if key in scalar_keys and str(child or "").strip() in targets:
                return True
            if key in array_keys and isinstance(child, list) and any(
                str(item or "").strip() in targets for item in child
            ):
                return True
            if _payload_references(
                child, targets, scalar_keys=scalar_keys, array_keys=array_keys
            ):
                return True
    elif isinstance(value, list):
        return any(
            _payload_references(
                child, targets, scalar_keys=scalar_keys, array_keys=array_keys
            )
            for child in value
        )
    return False


async def _external_payloads(db: AsyncSession) -> list[tuple[str, object]]:
    payloads: list[tuple[str, object]] = []
    for row in (await db.scalars(select(CourseDraft))).all():
        payloads.append(("课程草稿", row.structure or {}))
    for row in (await db.scalars(select(CourseRelease))).all():
        payloads.append(("课程发布", row.course_snapshot or {}))
    for row in (await db.scalars(select(LearningTask))).all():
        payloads.append(("学习任务", {**(row.content or {}), "audience": row.audience or {}}))
    for row in (await db.scalars(select(Question))).all():
        payloads.append(("题目", {"metadata": row.content_metadata or {}, "keyPath": row.key_path or {}, "status": row.status or {}}))
    for row in (await db.scalars(select(PaperRelease))).all():
        payloads.append(("试卷发布", {"metadata": row.release_metadata or {}, "source": row.source_payload or {}}))
    for row in (await db.scalars(select(PaperReleaseQuestion))).all():
        payloads.append(("试卷发布题目", row.snapshot or {}))
    return payloads


async def _assert_unreferenced(
    db: AsyncSession,
    targets: set[str],
    *,
    label: str,
    scalar_keys: frozenset[str],
    array_keys: frozenset[str] = frozenset(),
) -> None:
    if not targets:
        return
    for owner, payload in await _external_payloads(db):
        if _payload_references(
            payload, targets, scalar_keys=scalar_keys, array_keys=array_keys
        ):
            raise ValueError(f"{label}仍被{owner}引用，不能删除")


async def _tag_namespace(
    db: AsyncSession,
    subject_id: str,
    collections: dict[str, dict[str, Any]],
) -> str:
    identifier = f"__tags__:{subject_id}"
    row = await db.get(ActivityCollection, identifier)
    if row is None:
        row = ActivityCollection(
            id=identifier,
            subject_id=subject_id,
            title="标签命名空间",
            status="active",
            content_metadata={"systemNamespace": "tags"},
        )
        db.add(row)
        await db.flush()
    return identifier


async def _activity_namespace(db: AsyncSession, subject_id: str) -> str:
    identifier = f"__activities__:{subject_id}"
    row = await db.get(ActivityCollection, identifier)
    if row is None:
        row = ActivityCollection(
            id=identifier,
            subject_id=subject_id,
            title="活动覆盖命名空间",
            status="active",
            content_metadata={"systemNamespace": "activities"},
        )
        db.add(row)
        await db.flush()
    return identifier


async def apply_catalog_snapshot(
    db: AsyncSession,
    *,
    actor_username: str,
    subjects: list[dict[str, Any]] | None,
    taxonomies: list[dict[str, Any]] | None,
    activity_overrides: list[dict[str, Any]] | None,
    activity_tags: list[dict[str, Any]] | None,
    activity_collections: list[dict[str, Any]] | None,
) -> list[dict[str, str]]:
    """Replace requested teaching catalog resources in one locked transaction."""

    if all(
        value is None
        for value in (
            subjects,
            taxonomies,
            activity_overrides,
            activity_tags,
            activity_collections,
        )
    ):
        return []

    before_snapshot = await _relational_repository_snapshot(db)
    requested_values = {
        "subjects": subjects,
        "taxonomies": taxonomies,
        "activityOverrides": activity_overrides,
        "activityTags": activity_tags,
        "activityCollections": activity_collections,
    }
    if all(
        value is None or value == before_snapshot[name]
        for name, value in requested_values.items()
    ):
        return []

    incoming_subjects = None if subjects is None else _unique_rows(subjects, "科目")
    incoming_taxonomies = None if taxonomies is None else _unique_rows(taxonomies, "知识树")
    incoming_collections = None if activity_collections is None else _unique_rows(activity_collections, "题集")
    incoming_tags = None if activity_tags is None else _unique_rows(activity_tags, "活动标签")
    incoming_activities = None if activity_overrides is None else _unique_rows(activity_overrides, "活动覆盖")
    pending_removed_subject_ids: set[str] = set()
    pending_removed_collection_ids: set[str] = set()

    current_collection_rows = list(
        (await db.scalars(select(ActivityCollection))).all()
    )
    current_collection_by_id = {
        row.id: row for row in current_collection_rows if not _system_collection(row)
    }
    if incoming_collections is not None:
        merged_collections: dict[str, dict[str, Any]] = {
            identifier: _collection_payload(row)
            for identifier, row in current_collection_by_id.items()
            if row.owner_username != actor_username
        }
        for identifier, item in incoming_collections.items():
            existing = current_collection_by_id.get(identifier)
            if existing is not None and existing.owner_username != actor_username:
                if item != _collection_payload(existing):
                    raise CatalogResourceNotModifiable("资源不可修改或不存在")
                continue
            merged_collections[identifier] = item
        incoming_collections = merged_collections

    all_collection_by_id = {row.id: row for row in current_collection_rows}
    current_tag_rows = list((await db.scalars(select(ActivityTag))).all())
    if incoming_tags is not None:
        merged_tags: dict[str, dict[str, Any]] = {
            row.id: _activity_tag_payload(row)
            for row in current_tag_rows
            if not _collection_writable(
                all_collection_by_id.get(row.collection_id), actor_username
            )
        }
        current_tag_by_id = {row.id: row for row in current_tag_rows}
        for identifier, item in incoming_tags.items():
            existing = current_tag_by_id.get(identifier)
            if existing is not None and not _collection_writable(
                all_collection_by_id.get(existing.collection_id), actor_username
            ):
                if item != _activity_tag_payload(existing):
                    raise CatalogResourceNotModifiable("资源不可修改或不存在")
                continue
            merged_tags[identifier] = item
        incoming_tags = merged_tags

    current_activity_rows = list((await db.scalars(select(ActivityOverride))).all())
    if incoming_activities is not None:
        merged_activities: dict[str, dict[str, Any]] = {
            row.activity_id: _activity_override_payload(row)
            for row in current_activity_rows
            if not _collection_writable(
                all_collection_by_id.get(row.collection_id), actor_username
            )
        }
        current_activity_by_id = {row.activity_id: row for row in current_activity_rows}
        for identifier, item in incoming_activities.items():
            existing = current_activity_by_id.get(identifier)
            if existing is not None and not _collection_writable(
                all_collection_by_id.get(existing.collection_id), actor_username
            ):
                if item != _activity_override_payload(existing):
                    raise CatalogResourceNotModifiable("资源不可修改或不存在")
                continue
            merged_activities[identifier] = item
        incoming_activities = merged_activities

    known_subject_ids = set(
        incoming_subjects
        if incoming_subjects is not None
        else (await db.scalars(select(ContentSubject.id))).all()
    )
    known_taxonomy_ids = set(
        incoming_taxonomies
        if incoming_taxonomies is not None
        else (await db.scalars(select(ContentTaxonomy.id))).all()
    )
    collection_records = incoming_collections if incoming_collections is not None else {
        row.id: {"id": row.id, "subjectId": row.subject_id}
        for row in (await db.scalars(select(ActivityCollection))).all()
        if not bool((row.content_metadata or {}).get("systemNamespace"))
    }
    effective_taxonomies = incoming_taxonomies if incoming_taxonomies is not None else {
        str(item["id"]): item for item in before_snapshot["taxonomies"]
    }
    effective_tags = incoming_tags if incoming_tags is not None else {
        str(item["id"]): item for item in before_snapshot["activityTags"]
    }
    effective_activities = incoming_activities if incoming_activities is not None else {
        str(item["id"]): item for item in before_snapshot["activityOverrides"]
    }
    taxonomy_subjects = {
        identifier: _subject_id(item.get("subjectId"))
        for identifier, item in effective_taxonomies.items()
    }
    normalized_taxonomy_nodes = {
        identifier: _validate_taxonomy_nodes(identifier, item.get("nodes"))
        for identifier, item in effective_taxonomies.items()
    }
    taxonomy_nodes = {
        identifier: {str(node["id"]) for node in nodes}
        for identifier, nodes in normalized_taxonomy_nodes.items()
    }
    system_collection_subjects = {
        row.id: row.subject_id
        for row in (await db.scalars(select(ActivityCollection))).all()
        if bool((row.content_metadata or {}).get("systemNamespace"))
    }
    collection_subjects = {
        **system_collection_subjects,
        **{
            identifier: _subject_id(item.get("subjectId"))
            for identifier, item in collection_records.items()
        },
    }
    for item in (incoming_taxonomies or {}).values():
        subject_id = _subject_id(item.get("subjectId"))
        if subject_id not in known_subject_ids:
            raise ValueError(f"知识树引用了不存在的科目：{subject_id}")
        item["nodes"] = normalized_taxonomy_nodes[str(item["id"])]
    for item in collection_records.values():
        subject_id = _subject_id(item.get("subjectId"))
        if subject_id not in known_subject_ids:
            raise ValueError(f"题集引用了不存在的科目：{subject_id}")
    tag_subjects: dict[str, str] = {}
    for identifier, item in effective_tags.items():
        subject_id = _subject_id(item.get("subjectId") or "subject-pmp")
        if subject_id not in known_subject_ids:
            raise ValueError(f"活动标签引用了不存在的科目：{subject_id}")
        collection_id = str(item.get("collectionId") or "").strip()
        if collection_id:
            collection_subject = collection_subjects.get(collection_id)
            if collection_subject is None:
                raise ValueError(f"活动标签引用了不存在的题集：{collection_id}")
            if collection_subject != subject_id:
                raise ValueError("活动标签不能挂载到其他科目的题集")
            target_collection = all_collection_by_id.get(collection_id)
            existing_tag = current_tag_by_id.get(identifier) if incoming_tags is not None else None
            if (
                target_collection is not None
                and not _collection_writable(target_collection, actor_username)
                and (existing_tag is None or existing_tag.collection_id != collection_id)
            ):
                raise CatalogResourceNotModifiable("资源不可修改或不存在")
        tag_subjects[identifier] = subject_id
    activity_subjects: dict[str, str] = {}
    for identifier, item in effective_activities.items():
        metadata_value = item.get("metadata")
        if metadata_value is not None and not isinstance(metadata_value, dict):
            raise ValueError("活动 metadata 必须是对象")
        metadata = metadata_value or {}
        subject_id = _subject_id(metadata.get("subjectId") or "subject-pmp")
        if subject_id not in known_subject_ids:
            raise ValueError(f"活动引用了不存在的科目：{subject_id}")
        knowledge_value = metadata.get("knowledge")
        if knowledge_value is not None and not isinstance(knowledge_value, dict):
            raise ValueError("活动 knowledge 必须是对象")
        knowledge = knowledge_value or {}
        taxonomy_id = str(knowledge.get("taxonomyId") or "").strip()
        if taxonomy_id and taxonomy_id not in known_taxonomy_ids:
            raise ValueError(f"活动引用了不存在的知识树：{taxonomy_id}")
        if taxonomy_id and taxonomy_subjects.get(taxonomy_id) != subject_id:
            raise ValueError("活动不能引用其他科目的知识树")
        related_node_ids = _strict_id_list(
            knowledge.get("relatedNodeIds"), "relatedNodeIds"
        )
        primary_node_id = knowledge.get("primaryNodeId")
        if primary_node_id is not None and not isinstance(primary_node_id, str):
            raise ValueError("primaryNodeId 必须是字符串")
        referenced_nodes = {
            str(primary_node_id or "").strip(),
            *related_node_ids,
        } - {""}
        if referenced_nodes and (
            not taxonomy_id
            or not referenced_nodes.issubset(taxonomy_nodes.get(taxonomy_id, set()))
        ):
            raise ValueError("活动引用了不存在的知识点")
        collection_id = str(metadata.get("collectionId") or "").strip()
        if collection_id:
            collection_subject = collection_subjects.get(collection_id)
            if collection_subject is None:
                raise ValueError(f"活动引用了不存在的题集：{collection_id}")
            if collection_subject != subject_id:
                raise ValueError("活动不能挂载到其他科目的题集")
            target_collection = all_collection_by_id.get(collection_id)
            existing_activity = current_activity_by_id.get(identifier) if incoming_activities is not None else None
            if (
                target_collection is not None
                and not _collection_writable(target_collection, actor_username)
                and (
                    existing_activity is None
                    or existing_activity.collection_id != collection_id
                )
            ):
                raise CatalogResourceNotModifiable("资源不可修改或不存在")
        organization_value = metadata.get("organization")
        if organization_value is not None and not isinstance(organization_value, dict):
            raise ValueError("活动 organization 必须是对象")
        organization = organization_value or {}
        tag_ids = set(_strict_id_list(organization.get("tagIds"), "tagIds"))
        missing_tags = tag_ids - set(effective_tags)
        if missing_tags:
            raise ValueError(f"活动引用了不存在的标签：{sorted(missing_tags)[0]}")
        if any(tag_subjects[tag_id] != subject_id for tag_id in tag_ids):
            raise ValueError("活动不能引用其他科目的标签")
        activity_subjects[identifier] = subject_id
    for identifier, item in collection_records.items():
        subject_id = collection_subjects[identifier]
        activity_ids = set(_strict_id_list(item.get("activityIds"), "activityIds"))
        missing_activities = activity_ids - set(effective_activities)
        if missing_activities:
            raise ValueError(f"题集引用了不存在的活动：{sorted(missing_activities)[0]}")
        if any(activity_subjects[activity_id] != subject_id for activity_id in activity_ids):
            raise ValueError("题集不能引用其他科目的活动")

    if incoming_subjects is not None:
        subject_codes: set[str] = set()
        for identifier, item in incoming_subjects.items():
            code = str(item.get("code") or identifier.removeprefix("subject-")).strip().upper()
            if not code or code in subject_codes:
                raise ValueError("科目 code 必须唯一且非空")
            subject_codes.add(code)
    taxonomy_versions: set[tuple[str, int]] = set()
    for item in effective_taxonomies.values():
        subject_id = _subject_id(item.get("subjectId"))
        try:
            version = int(item.get("version") or 1)
        except (TypeError, ValueError) as exc:
            raise ValueError("知识树 version 必须是正整数") from exc
        if version < 1 or (subject_id, version) in taxonomy_versions:
            raise ValueError("同一科目的知识树 version 必须唯一")
        taxonomy_versions.add((subject_id, version))
    tag_names: set[tuple[str, str]] = set()
    for identifier, item in effective_tags.items():
        subject_id = tag_subjects[identifier]
        collection_id = str(item.get("collectionId") or "").strip()
        namespace = collection_id or f"__tags__:{subject_id}"
        name = str(item.get("name") or item.get("tag") or "").strip()
        key = (namespace, name.casefold())
        if not name or key in tag_names:
            raise ValueError("同一题集的活动标签名称必须唯一")
        tag_names.add(key)

    normalized_requested = {
        "subjects": incoming_subjects,
        "taxonomies": incoming_taxonomies,
        "activityOverrides": incoming_activities,
        "activityTags": incoming_tags,
        "activityCollections": incoming_collections,
    }
    if all(
        rows is None
        or rows
        == {
            _required_id(item.get("id"), name): item
            for item in before_snapshot[name]
        }
        for name, rows in normalized_requested.items()
    ):
        return []

    changes: list[dict[str, str]] = []
    if incoming_subjects is not None:
        current_subject_rows = (await db.scalars(select(ContentSubject))).all()
        current_ids = {row.id for row in current_subject_rows}
        for identifier, item in incoming_subjects.items():
            code = str(item.get("code") or identifier.removeprefix("subject-")).strip().upper()
            name = _localized_text(item.get("name")) or code
            status = str(item.get("status") or "active").strip()
            if status not in {"active", "inactive", "archived"}:
                raise ValueError("科目状态不正确")
            metadata = {k: deepcopy(v) for k, v in item.items() if k not in {"id", "code", "name", "status"}}
            if isinstance(item.get("name"), dict) and str(item["name"].get("en") or "").strip():
                metadata["nameEn"] = str(item["name"]["en"]).strip()
            row = await db.get(ContentSubject, identifier)
            if row is None:
                row = ContentSubject(id=identifier, code=code, name=name, status=status, content_metadata=metadata)
                db.add(row)
            else:
                row.code, row.name, row.status, row.content_metadata = code, name, status, metadata
        removed = current_ids - set(incoming_subjects)
        if removed:
            removed_codes = {
                row.code
                for row in current_subject_rows
                if row.id in removed
            }
            direct_subject_values = removed | removed_codes
            for model in (QuestionBank, Question, ExamPaper, PaperRelease):
                if await db.scalar(select(model).where(model.subject.in_(direct_subject_values)).limit(1)):
                    raise ValueError("科目仍被题目或试卷引用，不能删除")
            if await db.scalar(
                select(RecallAssociationLibrary.id)
                .where(RecallAssociationLibrary.subject_id.in_(removed))
                .limit(1)
            ):
                raise ValueError("科目仍被联想库引用，不能删除")
            await _assert_unreferenced(
                db,
                direct_subject_values,
                label="科目",
                scalar_keys=frozenset({"subjectId", "subject"}),
            )
            pending_removed_subject_ids = removed
        changes.append({"entityType": "subjectCatalog", "entityId": "all", "action": "replaced"})
        await db.flush()

    if incoming_taxonomies is not None:
        current_taxonomy_rows = (await db.scalars(select(ContentTaxonomy))).all()
        current_ids = {row.id for row in current_taxonomy_rows}
        current_node_rows = (await db.scalars(select(TaxonomyNode))).all()
        incoming_node_ids = {
            identifier: {str(node.get("id")) for node in item.get("nodes") or []}
            for identifier, item in incoming_taxonomies.items()
        }
        removed_nodes = {
            row.node_id
            for row in current_node_rows
            if row.taxonomy_id not in incoming_taxonomies
            or row.node_id not in incoming_node_ids.get(row.taxonomy_id, set())
        }
        await _assert_unreferenced(
            db,
            removed_nodes,
            label="知识点",
            scalar_keys=frozenset({"primaryNodeId", "nodeId"}),
            array_keys=frozenset({"relatedNodeIds", "nodeIds"}),
        )
        for identifier, item in incoming_taxonomies.items():
            subject_id = _subject_id(item.get("subjectId"))
            version = max(1, int(item.get("version") or 1))
            status = str(item.get("status") or "draft")
            if status not in {"draft", "published", "archived"}:
                raise ValueError("知识树状态不正确")
            metadata = {k: deepcopy(v) for k, v in item.items() if k not in {"id", "subjectId", "version", "status", "title", "nodes"}}
            row = await db.get(ContentTaxonomy, identifier)
            title = _localized_text(item.get("title") or item.get("name"))
            if row is None:
                row = ContentTaxonomy(id=identifier, subject_id=subject_id, version=version, status=status, title=title, content_metadata=metadata, created_by=actor_username, updated_by=actor_username)
                db.add(row)
                await db.flush()
            else:
                row.subject_id, row.version, row.status, row.title = subject_id, version, status, title
                row.content_metadata, row.updated_by = metadata, actor_username
            await db.execute(delete(TaxonomyNode).where(TaxonomyNode.taxonomy_id == identifier))
            for position, node in enumerate(item.get("nodes") or []):
                node_id = _required_id(node.get("id"), "知识点")
                db.add(TaxonomyNode(id=f"{identifier}:{node_id}", taxonomy_id=identifier, node_id=node_id, parent_node_id=node.get("parentId"), title=_localized_text(node.get("title")), record=deepcopy(node), position=int(node.get("sortOrder") or node.get("position") or position), status=str(node.get("status") or "active")))
        removed = current_ids - set(incoming_taxonomies)
        if removed:
            await _assert_unreferenced(
                db,
                removed,
                label="知识树",
                scalar_keys=frozenset({"taxonomyId"}),
            )
            await db.execute(delete(ContentTaxonomy).where(ContentTaxonomy.id.in_(removed)))
        changes.append({"entityType": "taxonomyCatalog", "entityId": "all", "action": "replaced"})
        await db.flush()

    if incoming_collections is not None:
        current_rows = (await db.scalars(select(ActivityCollection))).all()
        current_ids = {row.id for row in current_rows if not bool((row.content_metadata or {}).get("systemNamespace"))}
        for identifier, item in incoming_collections.items():
            subject_id = _subject_id(item.get("subjectId"))
            metadata = {k: deepcopy(v) for k, v in item.items() if k not in {"id", "subjectId", "title", "status"}}
            row = await db.get(ActivityCollection, identifier)
            if row is None:
                authorship = dict(metadata.get("authorship") or {})
                authorship["createdByUserId"] = actor_username
                metadata["authorship"] = authorship
                row = ActivityCollection(id=identifier, subject_id=subject_id, title=str(item.get("title") or ""), status=str(item.get("status") or "active"), content_metadata=metadata, owner_username=actor_username)
                db.add(row)
            else:
                if row.owner_username != actor_username:
                    continue
                authorship = dict(metadata.get("authorship") or {})
                authorship["createdByUserId"] = row.owner_username
                metadata["authorship"] = authorship
                row.subject_id, row.title, row.status, row.content_metadata = subject_id, str(item.get("title") or ""), str(item.get("status") or "active"), metadata
        removed = current_ids - set(incoming_collections)
        if removed:
            if incoming_tags is None and await db.scalar(select(ActivityTag.id).where(ActivityTag.collection_id.in_(removed)).limit(1)):
                raise ValueError("题集仍有活动标签引用，不能删除")
            if incoming_activities is None and await db.scalar(select(ActivityOverride.id).where(ActivityOverride.collection_id.in_(removed)).limit(1)):
                raise ValueError("题集仍有活动覆盖引用，不能删除")
            await _assert_unreferenced(
                db,
                removed,
                label="题集",
                scalar_keys=frozenset({"collectionId"}),
                array_keys=frozenset({"collectionIds"}),
            )
            pending_removed_collection_ids = removed
        changes.append({"entityType": "activityCollectionCatalog", "entityId": "all", "action": "replaced"})
        await db.flush()

    if incoming_tags is not None:
        current_ids = set((await db.scalars(select(ActivityTag.id))).all())
        for identifier, item in incoming_tags.items():
            subject_id = _subject_id(item.get("subjectId") or "subject-pmp")
            collection_id = str(item.get("collectionId") or "").strip()
            if not collection_id or await db.get(ActivityCollection, collection_id) is None:
                collection_id = await _tag_namespace(db, subject_id, collection_records)
            name = str(item.get("name") or item.get("tag") or "").strip()
            if not name:
                raise ValueError("活动标签名称不能为空")
            metadata = {k: deepcopy(v) for k, v in item.items() if k not in {"id", "name", "tag", "collectionId"}}
            row = await db.get(ActivityTag, identifier)
            collection_row = await db.get(ActivityCollection, collection_id)
            owner_username = (
                None if collection_row is None or _system_collection(collection_row)
                else collection_row.owner_username
            )
            if row is None:
                row = ActivityTag(id=identifier, collection_id=collection_id, tag=name, content_metadata=metadata, owner_username=owner_username)
                db.add(row)
            else:
                if not _collection_writable(
                    all_collection_by_id.get(row.collection_id), actor_username
                ):
                    continue
                row.collection_id, row.tag, row.content_metadata, row.owner_username = collection_id, name, metadata, owner_username
        removed = current_ids - set(incoming_tags)
        if removed:
            activity_payloads = list((incoming_activities or {}).values()) if incoming_activities is not None else [row.record or {} for row in (await db.scalars(select(ActivityOverride))).all()]
            if any(_payload_references(payload, removed, scalar_keys=frozenset({"tagId"}), array_keys=frozenset({"tagIds"})) for payload in activity_payloads):
                raise ValueError("活动标签仍被活动引用，不能删除")
            await db.execute(delete(ActivityTag).where(ActivityTag.id.in_(removed)))
        changes.append({"entityType": "activityTagCatalog", "entityId": "all", "action": "replaced"})
        await db.flush()

    if incoming_activities is not None:
        current_rows = (await db.scalars(select(ActivityOverride))).all()
        current_by_activity: dict[str, ActivityOverride] = {}
        for row in current_rows:
            if row.activity_id in current_by_activity:
                raise ValueError(f"活动 ID 在多个题集中重复：{row.activity_id}")
            current_by_activity[row.activity_id] = row
        for identifier, item in incoming_activities.items():
            metadata = item.get("metadata") if isinstance(item.get("metadata"), dict) else {}
            subject_id = _subject_id(metadata.get("subjectId") or "subject-pmp")
            collection_id = str(metadata.get("collectionId") or "").strip()
            if not collection_id or await db.get(ActivityCollection, collection_id) is None:
                collection_id = await _activity_namespace(db, subject_id)
            row = current_by_activity.get(identifier)
            collection_row = await db.get(ActivityCollection, collection_id)
            owner_username = (
                None if collection_row is None or _system_collection(collection_row)
                else collection_row.owner_username
            )
            if row is None:
                row = ActivityOverride(id=uuid4().hex, collection_id=collection_id, activity_id=identifier, record=deepcopy(item), revision=1, updated_by=actor_username, owner_username=owner_username)
                db.add(row)
            elif _collection_writable(
                all_collection_by_id.get(row.collection_id), actor_username
            ) and (row.collection_id != collection_id or row.record != item):
                row.collection_id, row.record, row.revision, row.updated_by, row.owner_username = collection_id, deepcopy(item), row.revision + 1, actor_username, owner_username
        removed = set(current_by_activity) - set(incoming_activities)
        if removed:
            collection_payloads = list((incoming_collections or {}).values()) if incoming_collections is not None else [row.content_metadata or {} for row in (await db.scalars(select(ActivityCollection))).all()]
            if any(_payload_references(payload, removed, scalar_keys=frozenset({"activityId"}), array_keys=frozenset({"activityIds", "sourceActivityIds"})) for payload in collection_payloads):
                raise ValueError("活动仍被题集引用，不能删除")
            await _assert_unreferenced(
                db,
                removed,
                label="活动",
                scalar_keys=frozenset({"activityId"}),
                array_keys=frozenset({"activityIds", "sourceActivityIds"}),
            )
            await db.execute(delete(ActivityOverride).where(ActivityOverride.activity_id.in_(removed)))
        changes.append({"entityType": "activityOverrideCatalog", "entityId": "all", "action": "replaced"})

    if pending_removed_collection_ids:
        await db.execute(
            delete(ActivityCollection).where(
                ActivityCollection.id.in_(pending_removed_collection_ids)
            )
        )
    system_rows = list(
        (
            await db.scalars(
                select(ActivityCollection).where(
                    ActivityCollection.content_metadata["systemNamespace"].astext.in_(
                        ("tags", "activities")
                    )
                )
            )
        ).all()
    )
    for row in system_rows:
        has_tag = await db.scalar(
            select(ActivityTag.id).where(ActivityTag.collection_id == row.id).limit(1)
        )
        has_activity = await db.scalar(
            select(ActivityOverride.id)
            .where(ActivityOverride.collection_id == row.id)
            .limit(1)
        )
        if not has_tag and not has_activity:
            await db.delete(row)
    await db.flush()
    if pending_removed_subject_ids:
        child_taxonomy = await db.scalar(
            select(ContentTaxonomy.id)
            .where(ContentTaxonomy.subject_id.in_(pending_removed_subject_ids))
            .limit(1)
        )
        child_collection = await db.scalar(
            select(ActivityCollection.id)
            .where(ActivityCollection.subject_id.in_(pending_removed_subject_ids))
            .limit(1)
        )
        if child_taxonomy or child_collection:
            raise ValueError("科目仍有知识树或题集引用，不能删除")
        await db.execute(
            delete(ContentSubject).where(
                ContentSubject.id.in_(pending_removed_subject_ids)
            )
        )

    db.add(TeachingContentAudit(id=uuid4().hex, entity_type="teachingCatalog", entity_id="all", action="replaced", actor_username=actor_username, after={"resources": [item["entityType"] for item in changes]}))
    return changes


async def _shared_content_snapshot(
    db: AsyncSession, subject_id: str, viewer_username: str | None = None
) -> dict[str, Any]:
    subject_id = _subject_id(subject_id)
    bundle = await _principle_card_bundle(db)
    taxonomy_result = await teaching_content_current_service.current_taxonomy(db, subject_id)
    taxonomy = _taxonomy_payload(*taxonomy_result) if taxonomy_result else None
    recall_row = await teaching_content_current_service.current_recall_library(db, subject_id)
    recall = {
        **dict(recall_row.content_metadata or {}),
        "id": recall_row.id,
        "subjectId": recall_row.subject_id,
        "version": recall_row.version,
        "status": recall_row.status,
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
        **(await _relational_repository_snapshot(db, viewer_username)),
        "subjectId": subject_id,
        "knowledgeTree": {"taxonomy": taxonomy} if taxonomy else None,
        "recallLibrary": recall,
        "principles": bundle["principles"],
        "synthesisPresets": bundle["synthesisPresets"],
        "tagConfig": _tag_payload(await _active_tag_config(db)),
        "subjectFacetSchemas": subject_facet_schemas,
        "contentRevision": revision,
    }


async def read_shared_content(
    db: AsyncSession, subject_id: str, viewer_username: str | None = None
) -> dict[str, Any]:
    await teaching_content_revision_service.acquire_read_lock(db)
    return await _shared_content_snapshot(db, subject_id, viewer_username)


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
                maximum = (await db.execute(select(func.max(ContentTaxonomy.version)).where(ContentTaxonomy.subject_id == subject_id))).scalar_one_or_none()
                requested_version = int(maximum or 0) + 1
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
        if row.status == "published":
            teaching_content_current_service.set_current_taxonomy(subject, row.id)
        changes.append({"entityType": "taxonomy", "entityId": taxonomy_id, "action": "upserted"})

    recall = _normalize_recall(recall_library)
    if recall is not None:
        subject = await _ensure_subject(db, subject_id)
        row = await teaching_content_current_service.current_recall_library(db, subject_id)
        if row is None:
            requested_version = int(recall.get("version") or 1)
            conflict = (await db.execute(select(RecallAssociationLibrary.id).where(RecallAssociationLibrary.subject_id == subject_id, RecallAssociationLibrary.version == requested_version).limit(1))).scalar_one_or_none()
            if conflict is not None:
                maximum = (await db.execute(select(func.max(RecallAssociationLibrary.version)).where(RecallAssociationLibrary.subject_id == subject_id))).scalar_one_or_none()
                requested_version = int(maximum or 0) + 1
            row = RecallAssociationLibrary(id=str(recall.get("id") or uuid4().hex), subject_id=subject_id, version=requested_version, status="published", nodes=recall["nodes"], edges=recall["edges"], content_metadata={k: v for k, v in recall.items() if k not in {"nodes", "edges", "id", "subjectId", "version", "status"}}, updated_by=actor_username)
            db.add(row)
        else:
            row.nodes, row.edges, row.content_metadata, row.updated_by = recall["nodes"], recall["edges"], {k: v for k, v in recall.items() if k not in {"nodes", "edges", "id", "subjectId", "version", "status"}}, actor_username
        teaching_content_current_service.set_current_recall_library(subject, row.id)
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
    subjects: list[dict[str, Any]] | None = None,
    taxonomies: list[dict[str, Any]] | None = None,
    activity_overrides: list[dict[str, Any]] | None = None,
    activity_tags: list[dict[str, Any]] | None = None,
    activity_collections: list[dict[str, Any]] | None = None,
) -> dict[str, Any]:
    subject_id = _subject_id(subject_id)
    await _assert_revision(db, content_revision)
    changes: list[dict[str, str]] = []

    changes.extend(
        await apply_catalog_snapshot(
            db,
            actor_username=actor.username,
            subjects=subjects,
            taxonomies=taxonomies,
            activity_overrides=activity_overrides,
            activity_tags=activity_tags,
            activity_collections=activity_collections,
        )
    )

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
    response = {
        **(await _shared_content_snapshot(db, subject_id, actor.username)),
        "contentRevision": int(revision["revision"]),
    }
    await db.commit()
    return response


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
