"""Load and validate the canonical PMP teaching-content bundle."""

from __future__ import annotations

import json
from dataclasses import dataclass
from datetime import datetime, timezone
from pathlib import Path
from typing import Any

from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.content_prep import Principle, SynthesisPreset
from app.models.teaching_content import (
    ContentSubject,
    ContentTaxonomy,
    RecallAssociationLibrary,
    TaxonomyNode,
)
from app.services import teaching_content_revision_service


SEED_DIR = Path(__file__).parents[1] / "seed" / "builtin_teaching_content"
TAXONOMY_FILENAME = "pmp_taxonomy_v8_6_2.json"
RECALL_FILENAME = "pmp_recall_association_v9.json"
PRINCIPLE_FILENAME = "pmp_principle_cards_v1.json"
SUBJECT_ID = "subject-pmp"
TAXONOMY_ID = "taxonomy-pmp-complete-v1"
RECALL_LIBRARY_ID = "recall-subject-pmp-builtin-v1"
EXPECTED_TAXONOMY_NODES = 317
EXPECTED_RECALL_NODES = 471
EXPECTED_RECALL_EDGES = 2840
EXPECTED_PRINCIPLES = 8


class BuiltinSeedValidationError(ValueError):
    """Raised when a packaged teaching-content file is unsafe to sync."""


@dataclass(frozen=True)
class BuiltinTeachingBundle:
    subject_id: str
    taxonomy: dict[str, Any]
    recall_library: dict[str, Any]
    principles: tuple[dict[str, Any], ...]
    synthesis_presets: tuple[dict[str, Any], ...]


@dataclass(frozen=True)
class BuiltinSeedSummary:
    created: int
    updated: int
    unchanged: int
    changes: tuple[dict[str, str], ...]


def _read_object(path: Path, label: str) -> dict[str, Any]:
    try:
        value = json.loads(path.read_text(encoding="utf-8-sig"))
    except FileNotFoundError as error:
        raise BuiltinSeedValidationError(f"缺少{label}文件：{path.name}") from error
    except (OSError, json.JSONDecodeError) as error:
        raise BuiltinSeedValidationError(f"{label}文件无法解析：{path.name}") from error
    if not isinstance(value, dict):
        raise BuiltinSeedValidationError(f"{label}必须是 JSON 对象")
    return value


def _require_list(value: object, label: str) -> list[dict[str, Any]]:
    if not isinstance(value, list) or not all(isinstance(item, dict) for item in value):
        raise BuiltinSeedValidationError(f"{label}必须是对象数组")
    return value


def _unique_ids(rows: list[dict[str, Any]], label: str) -> set[str]:
    ids = [str(row.get("id") or "").strip() for row in rows]
    if any(not item for item in ids):
        raise BuiltinSeedValidationError(f"{label}存在空 ID")
    if len(ids) != len(set(ids)):
        raise BuiltinSeedValidationError(f"{label}存在重复 ID")
    return set(ids)


def _load_taxonomy(seed_dir: Path) -> dict[str, Any]:
    package = _read_object(seed_dir / TAXONOMY_FILENAME, "知识树")
    if package.get("schemaVersion") != "knowledge-taxonomy-package-v1":
        raise BuiltinSeedValidationError("知识树 schemaVersion 不受支持")
    taxonomy = package.get("taxonomy")
    if not isinstance(taxonomy, dict):
        raise BuiltinSeedValidationError("知识树缺少 taxonomy 对象")
    if taxonomy.get("id") != TAXONOMY_ID or taxonomy.get("subjectId") != SUBJECT_ID:
        raise BuiltinSeedValidationError("知识树稳定 ID 或科目 ID 不正确")
    nodes = _require_list(taxonomy.get("nodes"), "知识树 nodes")
    if len(nodes) != EXPECTED_TAXONOMY_NODES:
        raise BuiltinSeedValidationError(
            f"知识树节点数应为 {EXPECTED_TAXONOMY_NODES}，实际为 {len(nodes)}"
        )
    node_ids = _unique_ids(nodes, "知识树节点")
    for node in nodes:
        parent_id = node.get("parentId")
        if parent_id not in (None, "") and str(parent_id) not in node_ids:
            raise BuiltinSeedValidationError(
                f"知识树节点 {node['id']} 引用了不存在的父节点 {parent_id}"
            )
    return taxonomy


def _load_recall(seed_dir: Path) -> dict[str, Any]:
    recall = _read_object(seed_dir / RECALL_FILENAME, "科目级联想库")
    if recall.get("schemaVersion") != 1:
        raise BuiltinSeedValidationError("科目级联想库 schemaVersion 不受支持")
    nodes = _require_list(recall.get("nodes"), "科目级联想库 nodes")
    edges = _require_list(recall.get("edges"), "科目级联想库 edges")
    if len(nodes) != EXPECTED_RECALL_NODES or len(edges) != EXPECTED_RECALL_EDGES:
        raise BuiltinSeedValidationError(
            "科目级联想库数量不正确："
            f"节点 {len(nodes)}/{EXPECTED_RECALL_NODES}，"
            f"关系 {len(edges)}/{EXPECTED_RECALL_EDGES}"
        )
    node_ids = _unique_ids(nodes, "科目级联想节点")
    _unique_ids(edges, "科目级联想关系")
    for edge in edges:
        source = str(edge.get("from") or "")
        target = str(edge.get("to") or "")
        if source not in node_ids or target not in node_ids:
            raise BuiltinSeedValidationError(
                f"联想关系 {edge['id']} 引用了不存在的节点：{source} -> {target}"
            )
    return recall


def _load_principles(
    seed_dir: Path,
) -> tuple[tuple[dict[str, Any], ...], tuple[dict[str, Any], ...]]:
    package = _read_object(seed_dir / PRINCIPLE_FILENAME, "原则与归纳卡")
    if package.get("format") != "kg-principle-card-bundle-v1":
        raise BuiltinSeedValidationError("原则与归纳卡 format 不受支持")
    if package.get("principleCardBundleVersion") != 1:
        raise BuiltinSeedValidationError("原则与归纳卡版本不受支持")
    principle_projection = package.get("principles")
    preset_projection = package.get("synthesisPresets")
    if not isinstance(principle_projection, dict) or not isinstance(preset_projection, dict):
        raise BuiltinSeedValidationError("原则与归纳卡缺少投影对象")
    principles = _require_list(principle_projection.get("items"), "原则 items")
    presets = _require_list(preset_projection.get("items"), "归纳卡 items")
    if len(principles) != EXPECTED_PRINCIPLES or len(presets) != EXPECTED_PRINCIPLES:
        raise BuiltinSeedValidationError(
            f"原则与归纳卡必须各有 {EXPECTED_PRINCIPLES} 条"
        )
    principle_ids = _unique_ids(principles, "原则")
    _unique_ids(presets, "归纳卡")
    preset_principle_ids = [str(item.get("principleId") or "").strip() for item in presets]
    if len(preset_principle_ids) != len(set(preset_principle_ids)):
        raise BuiltinSeedValidationError("一个原则绑定了多张内置归纳卡")
    if set(preset_principle_ids) != principle_ids:
        raise BuiltinSeedValidationError("原则与归纳卡引用不一一对应")
    return tuple(principles), tuple(presets)


def load_builtin_bundle(seed_dir: Path = SEED_DIR) -> BuiltinTeachingBundle:
    """Parse and validate all packaged teaching-content resources."""

    taxonomy = _load_taxonomy(seed_dir)
    recall_library = _load_recall(seed_dir)
    principles, synthesis_presets = _load_principles(seed_dir)
    return BuiltinTeachingBundle(
        subject_id=SUBJECT_ID,
        taxonomy=taxonomy,
        recall_library=recall_library,
        principles=principles,
        synthesis_presets=synthesis_presets,
    )


def _localized_text(value: object) -> str:
    if isinstance(value, dict):
        return str(value.get("zh") or value.get("en") or "").strip()
    return str(value or "").strip()


async def _available_version(
    db: AsyncSession,
    model: type[ContentTaxonomy] | type[RecallAssociationLibrary],
    subject_id: str,
    requested: int,
) -> int:
    occupied = (
        await db.execute(
            select(model.version).where(
                model.subject_id == subject_id,
                model.version == requested,
            )
        )
    ).scalar_one_or_none()
    if occupied is None:
        return requested
    maximum = (
        await db.execute(select(func.max(model.version)).where(model.subject_id == subject_id))
    ).scalar_one_or_none()
    return int(maximum or 0) + 1


async def sync_builtin_teaching_content(
    db: AsyncSession,
    bundle: BuiltinTeachingBundle | None = None,
) -> BuiltinSeedSummary:
    """Create the packaged aggregate records once inside one transaction."""

    bundle = bundle or load_builtin_bundle()
    created = 0
    unchanged = 0
    changes: list[dict[str, str]] = []
    try:
        await teaching_content_revision_service.acquire_lock(db)
        subject = await db.get(ContentSubject, bundle.subject_id)
        if subject is None:
            subject = ContentSubject(
                id=bundle.subject_id,
                code="PMP",
                name="PMP",
                status="active",
                content_metadata={"builtin": True},
            )
            db.add(subject)
            await db.flush()

        taxonomy = await db.get(ContentTaxonomy, TAXONOMY_ID)
        if taxonomy is None:
            source_version = int(bundle.taxonomy.get("version") or 1)
            taxonomy = ContentTaxonomy(
                id=TAXONOMY_ID,
                subject_id=bundle.subject_id,
                version=await _available_version(
                    db, ContentTaxonomy, bundle.subject_id, source_version
                ),
                status="published",
                title=_localized_text(bundle.taxonomy.get("name") or bundle.taxonomy.get("title")),
                content_metadata={
                    key: value
                    for key, value in bundle.taxonomy.items()
                    if key != "nodes"
                }
                | {"builtin": True, "builtinSourceVersion": source_version},
                published_at=datetime.now(timezone.utc),
            )
            db.add(taxonomy)
            await db.flush()
            for position, node in enumerate(bundle.taxonomy["nodes"]):
                node_id = str(node["id"])
                db.add(
                    TaxonomyNode(
                        id=f"{TAXONOMY_ID}:{node_id}",
                        taxonomy_id=TAXONOMY_ID,
                        node_id=node_id,
                        parent_node_id=node.get("parentId"),
                        title=_localized_text(node.get("title")),
                        record=node,
                        position=position,
                        status=str(node.get("status") or "active"),
                    )
                )
            created += 1
            changes.append(
                {"entityType": "taxonomy", "entityId": TAXONOMY_ID, "action": "created"}
            )
        else:
            unchanged += 1

        recall = await db.get(RecallAssociationLibrary, RECALL_LIBRARY_ID)
        if recall is None:
            source_version = 1
            recall = RecallAssociationLibrary(
                id=RECALL_LIBRARY_ID,
                subject_id=bundle.subject_id,
                version=await _available_version(
                    db, RecallAssociationLibrary, bundle.subject_id, source_version
                ),
                status="published",
                nodes=list(bundle.recall_library["nodes"]),
                edges=list(bundle.recall_library["edges"]),
                content_metadata={
                    key: value
                    for key, value in bundle.recall_library.items()
                    if key not in {"nodes", "edges"}
                }
                | {"builtin": True, "builtinSourceVersion": source_version},
            )
            db.add(recall)
            created += 1
            changes.append(
                {
                    "entityType": "recallLibrary",
                    "entityId": RECALL_LIBRARY_ID,
                    "action": "created",
                }
            )
        else:
            unchanged += 1

        for item in bundle.principles:
            principle_id = str(item["id"])
            principle = await db.get(Principle, principle_id)
            if principle is None:
                db.add(
                    Principle(
                        id=principle_id,
                        name=str(item.get("name") or ""),
                        status=str(item.get("status") or "active"),
                        confusable_principle_ids=list(item.get("confusablePrincipleIds") or []),
                        revision=1,
                    )
                )
                created += 1
                changes.append(
                    {
                        "entityType": "principle",
                        "entityId": principle_id,
                        "action": "created",
                    }
                )
            else:
                unchanged += 1
        await db.flush()

        for item in bundle.synthesis_presets:
            preset_id = str(item["id"])
            preset = await db.get(SynthesisPreset, preset_id)
            if preset is None:
                db.add(
                    SynthesisPreset(
                        id=preset_id,
                        principle_id=str(item["principleId"]),
                        title=str(item.get("title") or ""),
                        content=str(item.get("content") or ""),
                        status=str(item.get("status") or "active"),
                        business_version=int(item.get("version") or 1),
                        revision=1,
                    )
                )
                created += 1
                changes.append(
                    {
                        "entityType": "synthesisPreset",
                        "entityId": preset_id,
                        "action": "created",
                    }
                )
            else:
                unchanged += 1

        if changes:
            await teaching_content_revision_service.bump(
                db,
                "system:builtin-teaching-content",
                changes,
            )
        await db.commit()
        return BuiltinSeedSummary(
            created=created,
            updated=0,
            unchanged=unchanged,
            changes=tuple(changes),
        )
    except Exception:
        await db.rollback()
        raise
