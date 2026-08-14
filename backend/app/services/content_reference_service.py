"""Read-only validation against the currently published content catalogs."""

from __future__ import annotations

import json
from typing import Any
from urllib.parse import quote

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.content_prep import Principle
from app.models.shared_runtime_state import SharedRuntimeState
from app.models.subject_facet import SubjectFacetSchema
from app.schemas.content_prep import CatalogIssue

TAXONOMY_KEY = "kg_content_taxonomies_v1"
RECALL_LIBRARY_KEY_PREFIX = "kg_recall_association_library_v1__subject__"


def _issue(field: str, code: str, message: str, question_id: str | None) -> CatalogIssue:
    return CatalogIssue(
        questionId=question_id,
        field=field,
        code=code,
        message=message,
    )


def _decode_json(value: Any) -> Any:
    if isinstance(value, str):
        return json.loads(value)
    return value


def _taxonomy_matches_subject(taxonomy: dict, subject: str) -> bool:
    normalized = subject.strip().casefold()
    candidates = {
        str(taxonomy.get("subjectId") or "").strip().casefold(),
        str(taxonomy.get("subjectCode") or "").strip().casefold(),
        str(taxonomy.get("subject") or "").strip().casefold(),
    }
    return normalized in candidates or f"subject-{normalized}" in candidates


def _current_taxonomy(
    raw_value: str,
    subject: str,
) -> dict:
    parsed = _decode_json(raw_value)
    if not isinstance(parsed, list):
        raise ValueError("taxonomy catalog is not a list")
    published = [
        item
        for item in parsed
        if isinstance(item, dict)
        and str(item.get("status") or "").casefold() == "published"
        and _taxonomy_matches_subject(item, subject)
    ]
    if not published:
        raise ValueError("published taxonomy is unavailable")
    defaults = [item for item in published if item.get("isDefault") is True]
    candidates = defaults or published
    selected = max(
        candidates,
        key=lambda item: (
            int(item.get("version") or 0),
            str(item.get("updatedAt") or item.get("publishedAt") or ""),
        ),
    )
    if not isinstance(selected.get("nodes"), list):
        raise ValueError("taxonomy nodes are unavailable")
    return selected


def _active_node_ids(nodes: list[Any]) -> set[str]:
    return {
        str(node.get("id"))
        for node in nodes
        if isinstance(node, dict)
        and node.get("id")
        and str(node.get("status") or "active").casefold() not in {"deleted", "inactive", "archived"}
    }


def _recall_subject_id(subject: str) -> str:
    normalized = str(subject or "").strip()
    return "subject-pmp" if normalized.upper() == "PMP" else normalized


async def _effective_recall_node_ids(
    db: AsyncSession,
    subject: str,
    incoming_library: dict[str, Any] | None,
) -> set[str]:
    library: Any = incoming_library
    if library in (None, {}):
        key = RECALL_LIBRARY_KEY_PREFIX + quote(_recall_subject_id(subject), safe="")
        row = await db.get(SharedRuntimeState, key)
        if row is None:
            raise ValueError("recall library row missing")
        library = _decode_json(row.value)
    if not isinstance(library, dict) or not isinstance(library.get("nodes"), list):
        raise ValueError("recall library unavailable")
    return _active_node_ids(library["nodes"])


def _principle_references(metadata: dict) -> list[tuple[str, str]]:
    references: list[tuple[str, str]] = []
    for index, principle_id in enumerate(metadata.get("stemPrincipleIds") or []):
        if principle_id:
            references.append(
                (f"metadata.stemPrincipleIds[{index}]", str(principle_id))
            )
    for index, principle_id in enumerate(metadata.get("principleIds") or []):
        if principle_id:
            references.append((f"metadata.principleIds[{index}]", str(principle_id)))
    option_map = metadata.get("optionPrincipleMap")
    if isinstance(option_map, dict):
        for option_id, principle_ids in option_map.items():
            for index, principle_id in enumerate(principle_ids or []):
                if principle_id:
                    references.append(
                        (
                            f"metadata.optionPrincipleMap.{option_id}[{index}]",
                            str(principle_id),
                        )
                    )
    return references


def _subject_facet_references(metadata: dict) -> list[tuple[str, str]]:
    references: list[tuple[str, str]] = []
    raw_facets = metadata.get("subjectFacets")
    if not isinstance(raw_facets, list):
        return references
    for index, raw_facet in enumerate(raw_facets):
        facet_id = (
            raw_facet
            if isinstance(raw_facet, str)
            else raw_facet.get("facetId")
            if isinstance(raw_facet, dict)
            else ""
        )
        normalized = str(facet_id or "").strip()
        if normalized:
            references.append((f"metadata.subjectFacets[{index}]", normalized))
    return references


def _facet_schema_matches_subject(row: SubjectFacetSchema, subject: str) -> bool:
    normalized = str(subject or "").strip().casefold()
    candidates = {
        str(row.subject_id or "").strip().casefold(),
        *(str(code or "").strip().casefold() for code in (row.subject_codes or [])),
    }
    return normalized in candidates or f"subject-{normalized}" in candidates


async def _effective_subject_facet_ids(
    db: AsyncSession, subject: str
) -> set[str] | None:
    rows = (await db.execute(select(SubjectFacetSchema))).scalars().all()
    matching = [row for row in rows if _facet_schema_matches_subject(row, subject)]
    if not matching:
        return None
    facet_ids: set[str] = set()
    for row in matching:
        subject_slug = str(row.subject_id or "").removeprefix("subject-")
        for dimension in row.dimensions or []:
            if not isinstance(dimension, dict):
                continue
            dimension_id = str(dimension.get("id") or "").strip()
            for value in dimension.get("values") or []:
                if not isinstance(value, dict):
                    continue
                value_id = str(value.get("id") or "").strip()
                if subject_slug and dimension_id and value_id:
                    facet_ids.add(
                        f"subject/{subject_slug}/{dimension_id}/{value_id}"
                    )
    return facet_ids


async def validate_recall_references(
    db: AsyncSession,
    subject: str,
    payload: dict,
    *,
    recall_library: dict[str, Any] | None = None,
) -> list[CatalogIssue]:
    question_id = str(payload.get("id") or "").strip() or None
    recall_references = [
        (index, str(clue.get("recallNodeId") or "").strip())
        for index, clue in enumerate(payload.get("clues") or [])
        if isinstance(clue, dict) and clue.get("recallNodeId")
    ]
    if not recall_references:
        return []
    try:
        recall_ids = await _effective_recall_node_ids(db, subject, recall_library)
    except (TypeError, ValueError, json.JSONDecodeError):
        return [
            _issue(
                "clues",
                "REFERENCE_CATALOG_UNAVAILABLE",
                "当前科目联想库不可用",
                question_id,
            )
        ]
    return [
        _issue(
            f"clues[{index}].recallNodeId",
            "REFERENCE_NOT_FOUND",
            f"联想节点不存在：{recall_id}",
            question_id,
        )
        for index, recall_id in recall_references
        if recall_id not in recall_ids
    ]


async def validate_question_references(
    db: AsyncSession,
    actor_username: str,
    subject: str,
    payload: dict,
    *,
    incoming_principle_ids: set[str] | None = None,
    recall_library: dict[str, Any] | None = None,
) -> list[CatalogIssue]:
    """Validate references without mutating taxonomy or association data."""

    del actor_username  # Actor is intentionally not used to choose published content.
    question_id = str(payload.get("id") or "").strip() or None
    metadata = payload.get("metadata") if isinstance(payload.get("metadata"), dict) else {}
    knowledge = metadata.get("knowledge") if isinstance(metadata.get("knowledge"), dict) else {}
    primary_id = str(knowledge.get("primaryNodeId") or "").strip()
    related_ids = [str(value).strip() for value in (knowledge.get("relatedNodeIds") or []) if value]
    issues: list[CatalogIssue] = []

    taxonomy_row: SharedRuntimeState | None = None
    selected_taxonomy: dict | None = None
    if primary_id or related_ids:
        taxonomy_row = await db.get(SharedRuntimeState, TAXONOMY_KEY)
        try:
            if taxonomy_row is None:
                raise ValueError("taxonomy row missing")
            selected_taxonomy = _current_taxonomy(taxonomy_row.value, subject)
        except (TypeError, ValueError, json.JSONDecodeError):
            issues.append(
                _issue(
                    "metadata.knowledge",
                    "REFERENCE_CATALOG_UNAVAILABLE",
                    "当前发布的知识目录不可用",
                    question_id,
                )
            )

    if selected_taxonomy is not None:
        knowledge_ids = _active_node_ids(selected_taxonomy["nodes"])
        if primary_id and primary_id not in knowledge_ids:
            issues.append(
                _issue(
                    "metadata.knowledge.primaryNodeId",
                    "REFERENCE_NOT_FOUND",
                    f"知识点不存在：{primary_id}",
                    question_id,
                )
            )
        for index, node_id in enumerate(related_ids):
            if node_id not in knowledge_ids:
                issues.append(
                    _issue(
                        f"metadata.knowledge.relatedNodeIds[{index}]",
                        "REFERENCE_NOT_FOUND",
                        f"关联知识点不存在：{node_id}",
                        question_id,
                    )
                )

    issues.extend(
        await validate_recall_references(
            db,
            subject,
            payload,
            recall_library=recall_library,
        )
    )

    facet_references = _subject_facet_references(metadata)
    if facet_references:
        allowed_facet_ids = await _effective_subject_facet_ids(db, subject)
        if allowed_facet_ids is None:
            issues.append(
                _issue(
                    "metadata.subjectFacets",
                    "SUBJECT_FACET_CATALOG_UNAVAILABLE",
                    "当前科目分类 Schema 不可用",
                    question_id,
                )
            )
        else:
            for field, facet_id in facet_references:
                if facet_id not in allowed_facet_ids:
                    issues.append(
                        _issue(
                            field,
                            "SUBJECT_FACET_REFERENCE_NOT_FOUND",
                            f"科目分类不存在：{facet_id}",
                            question_id,
                        )
                    )

    principle_references = _principle_references(metadata)
    if principle_references:
        requested_ids = {principle_id for _, principle_id in principle_references}
        existing_ids = set(
            (
                await db.execute(select(Principle.id).where(Principle.id.in_(requested_ids)))
            ).scalars().all()
        )
        allowed_ids = existing_ids | set(incoming_principle_ids or set())
        already_reported: set[str] = set()
        for field, principle_id in principle_references:
            if principle_id not in allowed_ids and principle_id not in already_reported:
                issues.append(
                    _issue(
                        field,
                        "REFERENCE_NOT_FOUND",
                        f"原则不存在：{principle_id}",
                        question_id,
                    )
                )
                already_reported.add(principle_id)

    return issues
